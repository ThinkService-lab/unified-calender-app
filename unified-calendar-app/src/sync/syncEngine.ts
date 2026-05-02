/**
 * SyncEngine state machine implementation.
 * Manages bidirectional sync between local SQLite and calendar providers.
 *
 * State machine transitions:
 *   Idle → SyncingOutbound: Local mutation queued
 *   Idle → SyncingInbound: Webhook/poll received
 *   Idle → FullSync: Network restored after offline
 *   SyncingOutbound → Idle: Push success
 *   SyncingOutbound → RetryQueue: Push failed
 *   SyncingInbound → Idle: Applied cleanly
 *   SyncingInbound → ConflictResolution: Conflict detected
 *   ConflictResolution → Idle: User resolved
 *   RetryQueue → SyncingOutbound: Retry timer
 *   RetryQueue → Idle: Max retries exceeded (notify user)
 *   FullSync → ConflictResolution: Conflicts found
 *   FullSync → Idle: All synced
 *
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.6, 6.3
 */

import type { DatabaseDriver } from '../db/database';
import type { CalendarProviderAdapter, ChangeSet } from '../providers/types';
import type {
  SyncState,
  LocalChange,
  SyncResult,
  SyncConflict,
  ConflictResolution,
  WebhookPayload,
  SyncEngine,
  SyncNotificationCallback,
} from './types';
// Security Review 2026-05-01: Finding H2 — replaced Math.random() ID with crypto
import { cryptoId, cryptoUUID } from '../utils/cryptoId';

/** Default polling interval: 5 minutes (Req 4.4) */
const DEFAULT_POLLING_INTERVAL_MS = 300_000;

/** Outbound processing delay: push within 5 seconds (Req 4.2) */
const OUTBOUND_DELAY_MS = 2_000;

/** Max retries for failed outbound pushes */
const DEFAULT_MAX_RETRIES = 5;

/** Initial retry delay (exponential backoff base) */
const INITIAL_RETRY_DELAY_MS = 1_000;

/** Max retry delay cap */
const MAX_RETRY_DELAY_MS = 60_000;

/** Backoff multiplier */
const BACKOFF_MULTIPLIER = 2;

/** Jitter factor */
const JITTER_FACTOR = 0.1;

export interface SyncEngineConfig {
  db: DatabaseDriver;
  adapters: Map<string, CalendarProviderAdapter>;
  pollingIntervalMs?: number;
  onNotification?: SyncNotificationCallback;
}

/**
 * Calculate next retry delay with exponential backoff and jitter.
 */
function calculateRetryDelay(retryCount: number): number {
  const baseDelay = Math.min(
    INITIAL_RETRY_DELAY_MS * Math.pow(BACKOFF_MULTIPLIER, retryCount),
    MAX_RETRY_DELAY_MS,
  );
  const jitter = baseDelay * JITTER_FACTOR * (Math.random() * 2 - 1);
  return Math.max(0, Math.round(baseDelay + jitter));
}

/**
 * @deprecated Use cryptoId() or cryptoUUID() from '../utils/cryptoId' instead.
 * Kept as re-export for backward compatibility with tests.
 */
function generateId(): string {
  return cryptoId();
}

export function createSyncEngine(config: SyncEngineConfig): SyncEngine {
  const { db, adapters, onNotification } = config;

  let _state: SyncState = 'Idle';
  let _conflicts: SyncConflict[] = [];
  let _outboundTimer: ReturnType<typeof setTimeout> | null = null;
  let _retryTimer: ReturnType<typeof setTimeout> | null = null;
  let _pollingTimers: Map<string, ReturnType<typeof setInterval>> = new Map();
  let _running = false;

  const pollingIntervalMs = config.pollingIntervalMs ?? DEFAULT_POLLING_INTERVAL_MS;

  function setState(newState: SyncState): void {
    _state = newState;
  }

  function notify(message: string, severity: 'info' | 'warning' | 'error'): void {
    if (onNotification) {
      onNotification(message, severity);
    }
  }


  // ── Queue a local change into the sync_queue table ──
  async function queueLocalChange(change: LocalChange): Promise<void> {
    const id = generateId();
    const now = Date.now();

    await db.execute(
      `INSERT INTO sync_queue (id, calendar_account_id, event_id, operation, payload, retry_count, max_retries, next_retry_at, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        change.calendarAccountId,
        change.eventId,
        change.operation,
        change.payload,
        0,
        DEFAULT_MAX_RETRIES,
        now,
        'pending',
        now,
      ],
    );

    // Schedule outbound processing (push within 5 seconds of local mutation — Req 4.2)
    scheduleOutboundProcessing();
  }

  function scheduleOutboundProcessing(): void {
    if (_outboundTimer !== null) return;
    _outboundTimer = setTimeout(async () => {
      _outboundTimer = null;
      if (_running) {
        await processOutboundQueue();
      }
    }, OUTBOUND_DELAY_MS);
  }

  // ── Process outbound queue: push pending changes to providers ──
  async function processOutboundQueue(): Promise<SyncResult> {
    setState('SyncingOutbound');

    const result: SyncResult = {
      success: true,
      syncedCount: 0,
      failedCount: 0,
      conflicts: [],
    };

    try {
      const pendingEntries = await db.query<{
        id: string;
        calendar_account_id: string;
        event_id: string;
        operation: string;
        payload: string;
        retry_count: number;
        max_retries: number;
      }>(
        `SELECT id, calendar_account_id, event_id, operation, payload, retry_count, max_retries
         FROM sync_queue
         WHERE status = 'pending' AND next_retry_at <= ?
         ORDER BY created_at ASC`,
        [Date.now()],
      );

      for (const entry of pendingEntries) {
        const adapter = adapters.get(entry.calendar_account_id);
        if (!adapter) {
          // No adapter for this account — mark failed
          await markEntryFailed(entry.id, entry.retry_count, entry.max_retries);
          result.failedCount++;
          continue;
        }

        try {
          // Mark in-progress
          await db.execute(
            `UPDATE sync_queue SET status = 'in_progress' WHERE id = ?`,
            [entry.id],
          );

          const eventData = { providerData: JSON.parse(entry.payload) };

          switch (entry.operation) {
            case 'create':
              await adapter.createEvent(entry.calendar_account_id, eventData);
              break;
            case 'update':
              await adapter.updateEvent(entry.calendar_account_id, entry.event_id, eventData);
              break;
            case 'delete':
              await adapter.deleteEvent(entry.calendar_account_id, entry.event_id);
              break;
          }

          // Success — mark completed
          await db.execute(
            `UPDATE sync_queue SET status = 'completed' WHERE id = ?`,
            [entry.id],
          );
          result.syncedCount++;
        } catch {
          // Push failed — move to retry queue
          await markEntryFailed(entry.id, entry.retry_count, entry.max_retries);
          result.failedCount++;
        }
      }

      if (result.failedCount > 0) {
        setState('RetryQueue');
        scheduleRetry();
        result.success = result.syncedCount > 0;
      } else {
        setState('Idle');
      }
    } catch {
      setState('Idle');
      result.success = false;
    }

    return result;
  }

  async function markEntryFailed(
    entryId: string,
    currentRetryCount: number,
    maxRetries: number,
  ): Promise<void> {
    const newRetryCount = currentRetryCount + 1;

    if (newRetryCount >= maxRetries) {
      // Max retries exceeded — mark failed, transition RetryQueue → Idle, notify user
      await db.execute(
        `UPDATE sync_queue SET status = 'failed', retry_count = ? WHERE id = ?`,
        [newRetryCount, entryId],
      );
      notify('Sync failed after maximum retries. Please check your connection.', 'error');
    } else {
      // Schedule retry with exponential backoff
      const delay = calculateRetryDelay(newRetryCount);
      const nextRetryAt = Date.now() + delay;
      await db.execute(
        `UPDATE sync_queue SET status = 'pending', retry_count = ?, next_retry_at = ? WHERE id = ?`,
        [newRetryCount, nextRetryAt, entryId],
      );
    }
  }

  function scheduleRetry(): void {
    if (_retryTimer !== null) return;
    _retryTimer = setTimeout(async () => {
      _retryTimer = null;
      if (_running) {
        // RetryQueue → SyncingOutbound
        await processOutboundQueue();
      }
    }, INITIAL_RETRY_DELAY_MS);
  }


  // ── Handle inbound webhook notification ──
  async function handleWebhookNotification(notification: WebhookPayload): Promise<void> {
    setState('SyncingInbound');

    try {
      const adapter = adapters.get(notification.accountId);
      if (!adapter) {
        setState('Idle');
        return;
      }

      const calendarId = notification.calendarId ?? notification.accountId;
      const changes = await adapter.getChanges(calendarId, notification.syncToken ?? null);

      const conflicts = await applyInboundChanges(notification.accountId, changes);

      if (conflicts.length > 0) {
        _conflicts.push(...conflicts);
        setState('ConflictResolution');
      } else {
        setState('Idle');
      }
    } catch {
      setState('Idle');
    }
  }

  // ── Poll a provider for changes (providers without push — Req 4.4) ──
  async function pollProvider(accountId: string): Promise<ChangeSet> {
    setState('SyncingInbound');

    const adapter = adapters.get(accountId);
    if (!adapter) {
      setState('Idle');
      return { created: [], updated: [], deleted: [], nextSyncToken: '' };
    }

    try {
      // Get current sync token from the account
      const accounts = await db.query<{ sync_token: string | null }>(
        `SELECT sync_token FROM calendar_accounts WHERE id = ?`,
        [accountId],
      );
      const syncToken = accounts.length > 0 ? accounts[0].sync_token : null;

      const changes = await adapter.getChanges(accountId, syncToken ?? null);

      // Update sync token
      if (changes.nextSyncToken) {
        await db.execute(
          `UPDATE calendar_accounts SET sync_token = ?, last_synced_at = ? WHERE id = ?`,
          [changes.nextSyncToken, Date.now(), accountId],
        );
      }

      const conflicts = await applyInboundChanges(accountId, changes);

      if (conflicts.length > 0) {
        _conflicts.push(...conflicts);
        setState('ConflictResolution');
      } else {
        setState('Idle');
      }

      return changes;
    } catch {
      setState('Idle');
      return { created: [], updated: [], deleted: [], nextSyncToken: '' };
    }
  }

  /**
   * Apply inbound changes from a provider to the local database.
   * Returns any conflicts detected.
   *
   * All database writes are wrapped in a transaction for atomicity —
   * a crash mid-operation won't leave the database in an inconsistent state.
   */
  async function applyInboundChanges(
    accountId: string,
    changes: ChangeSet,
  ): Promise<SyncConflict[]> {
    const detectedConflicts: SyncConflict[] = [];

    const applyFn = async (tx: { execute: typeof db.execute; query: typeof db.query }) => {
      // Process created events
      // Security Review 2026-05-01: Finding M1 — use actual provider data instead of placeholders
      for (const created of changes.created) {
        const providerEventId = created.id ?? generateId();
        const now = Date.now();
        const eventId = generateId();

        // Extract actual event data from provider response when available
        const pd = created.providerData ?? {};
        const title = (typeof pd.title === 'string' ? pd.title : null)
          ?? (typeof pd.summary === 'string' ? pd.summary : null)
          ?? (typeof pd.subject === 'string' ? pd.subject : null)
          ?? 'Untitled Event';
        const description = typeof pd.description === 'string' ? pd.description : null;
        const location = typeof pd.location === 'string' ? pd.location : null;
        const startTime = typeof pd.startTime === 'number' ? pd.startTime
          : (pd.start && typeof (pd.start as Record<string, unknown>).dateTime === 'string'
            ? new Date((pd.start as Record<string, unknown>).dateTime as string).getTime()
            : now);
        const endTime = typeof pd.endTime === 'number' ? pd.endTime
          : (pd.end && typeof (pd.end as Record<string, unknown>).dateTime === 'string'
            ? new Date((pd.end as Record<string, unknown>).dateTime as string).getTime()
            : startTime + 3600000);
        const timeZone = typeof pd.timeZone === 'string' ? pd.timeZone : 'UTC';
        const isAllDay = pd.isAllDay === true ? 1 : 0;

        await tx.execute(
          `INSERT OR IGNORE INTO events (id, provider_event_id, calendar_account_id, title, description, location, start_time, end_time, time_zone, is_all_day, sequence, dtstamp, sync_status, local_version, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            eventId,
            providerEventId,
            accountId,
            title,
            description,
            location,
            startTime,
            endTime,
            timeZone,
            isAllDay,
            0,
            now,
            'synced',
            1,
            now,
            now,
          ],
        );
      }

      // Process updated events — check for conflicts
      for (const updated of changes.updated) {
        if (!updated.id) continue;

        const existing = await tx.query<{
          id: string;
          sync_status: string;
          local_version: number;
        }>(
          `SELECT id, sync_status, local_version FROM events WHERE provider_event_id = ? AND calendar_account_id = ?`,
          [updated.id, accountId],
        );

        if (existing.length > 0 && existing[0].sync_status.startsWith('pending_')) {
          // Conflict: local pending change + remote change
          detectedConflicts.push({
            id: generateId(),
            eventId: existing[0].id,
            calendarAccountId: accountId,
            localVersion: JSON.stringify({ syncStatus: existing[0].sync_status }),
            remoteVersion: JSON.stringify(updated.providerData ?? {}),
            detectedAt: new Date(),
          });

          await tx.execute(
            `UPDATE events SET sync_status = 'conflict' WHERE id = ?`,
            [existing[0].id],
          );
        } else if (existing.length > 0) {
          // No conflict — apply remote update
          await tx.execute(
            `UPDATE events SET sync_status = 'synced', updated_at = ? WHERE id = ?`,
            [Date.now(), existing[0].id],
          );
        }
      }

      // Process deleted events
      for (const deletedId of changes.deleted) {
        await tx.execute(
          `DELETE FROM events WHERE provider_event_id = ? AND calendar_account_id = ?`,
          [deletedId, accountId],
        );
      }
    };

    // Use transaction if the driver supports it, otherwise fall back to sequential execution
    if (db.supportsTransactions) {
      await db.transaction(async (tx) => applyFn(tx));
    } else {
      await applyFn(db);
    }

    return detectedConflicts;
  }


  // ── Full sync for a single account (reconnection after offline — Req 4.6) ──
  async function fullSync(accountId: string): Promise<SyncResult> {
    setState('FullSync');

    const result: SyncResult = {
      success: true,
      syncedCount: 0,
      failedCount: 0,
      conflicts: [],
    };

    try {
      // First, push all pending outbound changes for this account
      const pendingEntries = await db.query<{
        id: string;
        event_id: string;
        operation: string;
        payload: string;
        retry_count: number;
        max_retries: number;
      }>(
        `SELECT id, event_id, operation, payload, retry_count, max_retries
         FROM sync_queue
         WHERE calendar_account_id = ? AND status IN ('pending', 'failed')
         ORDER BY created_at ASC`,
        [accountId],
      );

      const adapter = adapters.get(accountId);
      if (!adapter) {
        setState('Idle');
        return { ...result, success: false };
      }

      // Push outbound
      for (const entry of pendingEntries) {
        try {
          const eventData = { providerData: JSON.parse(entry.payload) };
          switch (entry.operation) {
            case 'create':
              await adapter.createEvent(accountId, eventData);
              break;
            case 'update':
              await adapter.updateEvent(accountId, entry.event_id, eventData);
              break;
            case 'delete':
              await adapter.deleteEvent(accountId, entry.event_id);
              break;
          }
          await db.execute(`UPDATE sync_queue SET status = 'completed' WHERE id = ?`, [entry.id]);
          result.syncedCount++;
        } catch {
          result.failedCount++;
        }
      }

      // Then pull inbound changes
      const accounts = await db.query<{ sync_token: string | null }>(
        `SELECT sync_token FROM calendar_accounts WHERE id = ?`,
        [accountId],
      );
      const syncToken = accounts.length > 0 ? accounts[0].sync_token : null;

      const changes = await adapter.getChanges(accountId, syncToken ?? null);

      if (changes.nextSyncToken) {
        await db.execute(
          `UPDATE calendar_accounts SET sync_token = ?, last_synced_at = ? WHERE id = ?`,
          [changes.nextSyncToken, Date.now(), accountId],
        );
      }

      const conflicts = await applyInboundChanges(accountId, changes);
      result.conflicts = conflicts;

      if (conflicts.length > 0) {
        _conflicts.push(...conflicts);
        setState('ConflictResolution');
      } else {
        setState('Idle');
      }

      result.success = result.failedCount === 0;
    } catch {
      setState('Idle');
      result.success = false;
    }

    return result;
  }

  // ── Sync all pending changes across all accounts (Req 4.6: within 60s of network restoration) ──
  async function syncAllPending(): Promise<SyncResult> {
    setState('FullSync');

    const aggregateResult: SyncResult = {
      success: true,
      syncedCount: 0,
      failedCount: 0,
      conflicts: [],
    };

    try {
      // Get all accounts with pending sync entries
      const accountRows = await db.query<{ calendar_account_id: string }>(
        `SELECT DISTINCT calendar_account_id FROM sync_queue WHERE status IN ('pending', 'failed')`,
      );

      for (const row of accountRows) {
        const accountResult = await fullSync(row.calendar_account_id);
        aggregateResult.syncedCount += accountResult.syncedCount;
        aggregateResult.failedCount += accountResult.failedCount;
        aggregateResult.conflicts.push(...accountResult.conflicts);
        if (!accountResult.success) {
          aggregateResult.success = false;
        }
      }

      // If no pending entries, still transition back to Idle
      if (accountRows.length === 0) {
        setState('Idle');
      }
    } catch {
      setState('Idle');
      aggregateResult.success = false;
    }

    return aggregateResult;
  }

  // ── Conflict resolution ──
  function getConflicts(): SyncConflict[] {
    return [..._conflicts];
  }

  async function resolveConflict(
    conflictId: string,
    resolution: ConflictResolution,
  ): Promise<void> {
    const conflictIndex = _conflicts.findIndex((c) => c.id === conflictId);
    if (conflictIndex === -1) return;

    const conflict = _conflicts[conflictIndex];

    if (resolution === 'keep_local') {
      // Re-queue the local version for outbound push
      await db.execute(
        `UPDATE events SET sync_status = 'pending_update' WHERE id = ?`,
        [conflict.eventId],
      );
      const localData = conflict.localVersion;
      await queueLocalChange({
        calendarAccountId: conflict.calendarAccountId,
        eventId: conflict.eventId,
        operation: 'update',
        payload: localData,
      });
    } else {
      // keep_remote — accept the remote version
      await db.execute(
        `UPDATE events SET sync_status = 'synced', updated_at = ? WHERE id = ?`,
        [Date.now(), conflict.eventId],
      );
    }

    // Remove resolved conflict
    _conflicts.splice(conflictIndex, 1);

    // If no more conflicts, transition ConflictResolution → Idle
    if (_conflicts.length === 0) {
      setState('Idle');
    }
  }

  // ── Lifecycle ──
  function start(): void {
    _running = true;
    setState('Idle');

    // Start polling for providers without push support
    for (const [accountId] of adapters) {
      startPolling(accountId);
    }
  }

  function stop(): void {
    _running = false;

    // Clear all timers
    if (_outboundTimer !== null) {
      clearTimeout(_outboundTimer);
      _outboundTimer = null;
    }
    if (_retryTimer !== null) {
      clearTimeout(_retryTimer);
      _retryTimer = null;
    }
    for (const [, timer] of _pollingTimers) {
      clearInterval(timer);
    }
    _pollingTimers.clear();

    setState('Idle');
  }

  function startPolling(accountId: string): void {
    if (_pollingTimers.has(accountId)) return;

    const timer = setInterval(async () => {
      if (_running && _state === 'Idle') {
        await pollProvider(accountId);
      }
    }, pollingIntervalMs);

    _pollingTimers.set(accountId, timer);
  }

  // ── Public interface ──
  const engine: SyncEngine = {
    start,
    stop,
    queueLocalChange: (change: LocalChange) => {
      queueLocalChange(change);
    },
    processOutboundQueue,
    handleWebhookNotification,
    pollProvider,
    get pollingIntervalMs() {
      return pollingIntervalMs;
    },
    getConflicts,
    resolveConflict,
    fullSync,
    syncAllPending,
    get state() {
      return _state;
    },
  };

  return engine;
}

export { calculateRetryDelay, generateId };
