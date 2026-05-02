/**
 * Unit tests for SyncEngine state machine.
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.6, 6.3
 */

import { createSyncEngine, calculateRetryDelay, generateId } from '../syncEngine';
import type { SyncEngineConfig } from '../syncEngine';
import type { SyncEngine, LocalChange, WebhookPayload } from '../types';
import type { DatabaseDriver } from '../../db/database';
import type { CalendarProviderAdapter, ChangeSet, RawEventData } from '../../providers/types';

// ── Test helpers ──

function createMockDb(): DatabaseDriver & {
  executeCalls: Array<{ sql: string; params?: unknown[] }>;
  queryResults: Map<string, unknown[]>;
} {
  const executeCalls: Array<{ sql: string; params?: unknown[] }> = [];
  const queryResults = new Map<string, unknown[]>();

  return {
    executeCalls,
    queryResults,
    async execute(sql: string, params?: unknown[]): Promise<void> {
      executeCalls.push({ sql, params });
    },
    async query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
      // Return configured results or empty array
      for (const [pattern, results] of queryResults) {
        if (sql.includes(pattern)) {
          return results as T[];
        }
      }
      return [] as T[];
    },
    async close(): Promise<void> {},
    isOpen(): boolean {
      return true;
    },
    supportsTransactions: false,
    async transaction<T>(fn: (tx: any) => Promise<T>): Promise<T> {
      return fn({ execute: this.execute.bind(this), query: this.query.bind(this) });
    },
  };
}

function createMockAdapter(overrides?: Partial<CalendarProviderAdapter>): CalendarProviderAdapter {
  return {
    providerId: 'google',
    authenticate: jest.fn().mockResolvedValue({ accessToken: 'tok', refreshToken: 'ref', expiresIn: 3600, tokenType: 'Bearer' }),
    refreshToken: jest.fn().mockResolvedValue({ accessToken: 'tok', refreshToken: 'ref', expiresIn: 3600, tokenType: 'Bearer' }),
    revokeAccess: jest.fn().mockResolvedValue(undefined),
    listCalendars: jest.fn().mockResolvedValue([]),
    listEvents: jest.fn().mockResolvedValue([]),
    createEvent: jest.fn().mockResolvedValue('new-event-id'),
    updateEvent: jest.fn().mockResolvedValue(undefined),
    deleteEvent: jest.fn().mockResolvedValue(undefined),
    getChanges: jest.fn().mockResolvedValue({
      created: [],
      updated: [],
      deleted: [],
      nextSyncToken: 'token-1',
    } as ChangeSet),
    ...overrides,
  };
}


// ── Tests ──

describe('SyncEngine', () => {
  let db: ReturnType<typeof createMockDb>;
  let adapter: CalendarProviderAdapter;
  let engine: SyncEngine;

  beforeEach(() => {
    db = createMockDb();
    adapter = createMockAdapter();
    const adapters = new Map<string, CalendarProviderAdapter>();
    adapters.set('account-1', adapter);

    engine = createSyncEngine({ db, adapters });
    engine.start();
  });

  afterEach(() => {
    engine.stop();
  });

  describe('State machine initial state', () => {
    it('should start in Idle state', () => {
      expect(engine.state).toBe('Idle');
    });

    it('should have default polling interval of 5 minutes', () => {
      expect(engine.pollingIntervalMs).toBe(300_000);
    });

    it('should accept custom polling interval', () => {
      const customEngine = createSyncEngine({
        db,
        adapters: new Map(),
        pollingIntervalMs: 60_000,
      });
      expect(customEngine.pollingIntervalMs).toBe(60_000);
    });
  });

  describe('queueLocalChange', () => {
    it('should insert a sync_queue entry with pending status', async () => {
      const change: LocalChange = {
        calendarAccountId: 'account-1',
        eventId: 'event-1',
        operation: 'create',
        payload: JSON.stringify({ title: 'Test Event' }),
      };

      engine.queueLocalChange(change);

      // Allow the async insert to complete
      await new Promise((r) => setTimeout(r, 50));

      const insertCall = db.executeCalls.find((c) => c.sql.includes('INSERT INTO sync_queue'));
      expect(insertCall).toBeDefined();
      expect(insertCall!.params).toBeDefined();
      // Verify params: [id, calendarAccountId, eventId, operation, payload, retryCount, maxRetries, nextRetryAt, status, createdAt]
      const params = insertCall!.params!;
      expect(params[1]).toBe('account-1');
      expect(params[2]).toBe('event-1');
      expect(params[3]).toBe('create');
      expect(params[5]).toBe(0); // retryCount
      expect(params[8]).toBe('pending'); // status
    });

    it('should queue multiple changes independently', async () => {
      engine.queueLocalChange({
        calendarAccountId: 'account-1',
        eventId: 'event-1',
        operation: 'create',
        payload: '{}',
      });
      engine.queueLocalChange({
        calendarAccountId: 'account-1',
        eventId: 'event-2',
        operation: 'update',
        payload: '{}',
      });

      await new Promise((r) => setTimeout(r, 50));

      const insertCalls = db.executeCalls.filter((c) => c.sql.includes('INSERT INTO sync_queue'));
      expect(insertCalls.length).toBe(2);
    });
  });

  describe('processOutboundQueue', () => {
    it('should transition to SyncingOutbound then back to Idle on success', async () => {
      // Set up pending entries in the mock DB
      db.queryResults.set('FROM sync_queue', [
        {
          id: 'sq-1',
          calendar_account_id: 'account-1',
          event_id: 'event-1',
          operation: 'create',
          payload: JSON.stringify({ title: 'New Event' }),
          retry_count: 0,
          max_retries: 5,
        },
      ]);

      const result = await engine.processOutboundQueue();

      expect(result.syncedCount).toBe(1);
      expect(result.failedCount).toBe(0);
      expect(result.success).toBe(true);
      expect(engine.state).toBe('Idle');
      expect(adapter.createEvent).toHaveBeenCalled();
    });

    it('should call updateEvent for update operations', async () => {
      db.queryResults.set('FROM sync_queue', [
        {
          id: 'sq-2',
          calendar_account_id: 'account-1',
          event_id: 'event-2',
          operation: 'update',
          payload: JSON.stringify({ title: 'Updated' }),
          retry_count: 0,
          max_retries: 5,
        },
      ]);

      await engine.processOutboundQueue();
      expect(adapter.updateEvent).toHaveBeenCalled();
    });

    it('should call deleteEvent for delete operations', async () => {
      db.queryResults.set('FROM sync_queue', [
        {
          id: 'sq-3',
          calendar_account_id: 'account-1',
          event_id: 'event-3',
          operation: 'delete',
          payload: '{}',
          retry_count: 0,
          max_retries: 5,
        },
      ]);

      await engine.processOutboundQueue();
      expect(adapter.deleteEvent).toHaveBeenCalled();
    });

    it('should transition to RetryQueue when push fails', async () => {
      const failingAdapter = createMockAdapter({
        createEvent: jest.fn().mockRejectedValue(new Error('Network error')),
      });
      const adapters = new Map<string, CalendarProviderAdapter>();
      adapters.set('account-1', failingAdapter);

      const failEngine = createSyncEngine({ db, adapters });
      failEngine.start();

      db.queryResults.set('FROM sync_queue', [
        {
          id: 'sq-4',
          calendar_account_id: 'account-1',
          event_id: 'event-4',
          operation: 'create',
          payload: '{}',
          retry_count: 0,
          max_retries: 5,
        },
      ]);

      const result = await failEngine.processOutboundQueue();

      expect(result.failedCount).toBe(1);
      expect(failEngine.state).toBe('RetryQueue');

      failEngine.stop();
    });

    it('should return empty result when no pending entries', async () => {
      const result = await engine.processOutboundQueue();

      expect(result.syncedCount).toBe(0);
      expect(result.failedCount).toBe(0);
      expect(result.success).toBe(true);
      expect(engine.state).toBe('Idle');
    });

    it('should mark entry completed on success', async () => {
      db.queryResults.set('FROM sync_queue', [
        {
          id: 'sq-5',
          calendar_account_id: 'account-1',
          event_id: 'event-5',
          operation: 'create',
          payload: '{}',
          retry_count: 0,
          max_retries: 5,
        },
      ]);

      await engine.processOutboundQueue();

      const completedCall = db.executeCalls.find(
        (c) => c.sql.includes("status = 'completed'") && c.params?.includes('sq-5'),
      );
      expect(completedCall).toBeDefined();
    });
  });


  describe('handleWebhookNotification', () => {
    it('should transition to SyncingInbound then Idle when no conflicts', async () => {
      const notification: WebhookPayload = {
        accountId: 'account-1',
        changeType: 'updated',
        syncToken: 'token-abc',
      };

      await engine.handleWebhookNotification(notification);

      expect(adapter.getChanges).toHaveBeenCalled();
      expect(engine.state).toBe('Idle');
    });

    it('should transition to ConflictResolution when conflicts detected', async () => {
      // Set up adapter to return an update for an event that has a pending local change
      const conflictAdapter = createMockAdapter({
        getChanges: jest.fn().mockResolvedValue({
          created: [],
          updated: [{ id: 'provider-event-1', providerData: { title: 'Remote Version' } }],
          deleted: [],
          nextSyncToken: 'token-2',
        } as ChangeSet),
      });

      const adapters = new Map<string, CalendarProviderAdapter>();
      adapters.set('account-1', conflictAdapter);

      const conflictEngine = createSyncEngine({ db, adapters });
      conflictEngine.start();

      // Simulate existing event with pending local change
      db.queryResults.set('FROM events WHERE provider_event_id', [
        { id: 'local-event-1', sync_status: 'pending_update', local_version: 2 },
      ]);

      await conflictEngine.handleWebhookNotification({
        accountId: 'account-1',
        changeType: 'updated',
        syncToken: 'token-1',
      });

      expect(conflictEngine.state).toBe('ConflictResolution');
      expect(conflictEngine.getConflicts().length).toBe(1);

      conflictEngine.stop();
    });

    it('should handle missing adapter gracefully', async () => {
      const emptyEngine = createSyncEngine({ db, adapters: new Map() });
      emptyEngine.start();

      await emptyEngine.handleWebhookNotification({
        accountId: 'nonexistent',
        changeType: 'sync',
      });

      expect(emptyEngine.state).toBe('Idle');
      emptyEngine.stop();
    });
  });

  describe('pollProvider', () => {
    it('should fetch changes and return them', async () => {
      db.queryResults.set('FROM calendar_accounts', [{ sync_token: 'old-token' }]);

      const changes = await engine.pollProvider('account-1');

      expect(adapter.getChanges).toHaveBeenCalledWith('account-1', 'old-token');
      expect(changes.nextSyncToken).toBe('token-1');
      expect(engine.state).toBe('Idle');
    });

    it('should update sync token after polling', async () => {
      db.queryResults.set('FROM calendar_accounts', [{ sync_token: null }]);

      await engine.pollProvider('account-1');

      const updateCall = db.executeCalls.find(
        (c) => c.sql.includes('UPDATE calendar_accounts SET sync_token'),
      );
      expect(updateCall).toBeDefined();
    });

    it('should return empty changeset for unknown account', async () => {
      const changes = await engine.pollProvider('unknown-account');

      expect(changes.created).toEqual([]);
      expect(changes.updated).toEqual([]);
      expect(changes.deleted).toEqual([]);
    });
  });

  describe('fullSync', () => {
    it('should push pending outbound and pull inbound changes', async () => {
      // Pending outbound entries
      db.queryResults.set('FROM sync_queue', [
        {
          id: 'sq-full-1',
          event_id: 'event-full-1',
          operation: 'update',
          payload: JSON.stringify({ title: 'Updated locally' }),
          retry_count: 0,
          max_retries: 5,
        },
      ]);
      db.queryResults.set('FROM calendar_accounts', [{ sync_token: 'old' }]);

      const result = await engine.fullSync('account-1');

      expect(result.syncedCount).toBeGreaterThanOrEqual(1);
      expect(adapter.updateEvent).toHaveBeenCalled();
      expect(adapter.getChanges).toHaveBeenCalled();
    });

    it('should return failure for unknown account', async () => {
      const result = await engine.fullSync('unknown-account');

      expect(result.success).toBe(false);
    });

    it('should transition to Idle when all synced without conflicts', async () => {
      db.queryResults.set('FROM calendar_accounts', [{ sync_token: null }]);

      const result = await engine.fullSync('account-1');

      expect(engine.state).toBe('Idle');
      expect(result.conflicts).toEqual([]);
    });
  });

  describe('syncAllPending', () => {
    it('should sync all accounts with pending entries', async () => {
      db.queryResults.set('DISTINCT calendar_account_id', [
        { calendar_account_id: 'account-1' },
      ]);
      db.queryResults.set('FROM calendar_accounts', [{ sync_token: null }]);

      const result = await engine.syncAllPending();

      expect(result).toBeDefined();
      expect(typeof result.syncedCount).toBe('number');
    });

    it('should return to Idle when no pending entries', async () => {
      const result = await engine.syncAllPending();

      expect(engine.state).toBe('Idle');
      expect(result.syncedCount).toBe(0);
    });
  });

  describe('Conflict resolution', () => {
    it('should return empty conflicts initially', () => {
      expect(engine.getConflicts()).toEqual([]);
    });

    it('should resolve conflict with keep_remote and transition to Idle', async () => {
      // Create a conflict scenario
      const conflictAdapter = createMockAdapter({
        getChanges: jest.fn().mockResolvedValue({
          created: [],
          updated: [{ id: 'prov-1', providerData: { title: 'Remote' } }],
          deleted: [],
          nextSyncToken: 'tok',
        } as ChangeSet),
      });

      const adapters = new Map<string, CalendarProviderAdapter>();
      adapters.set('account-1', conflictAdapter);
      const conflictEngine = createSyncEngine({ db, adapters });
      conflictEngine.start();

      db.queryResults.set('FROM events WHERE provider_event_id', [
        { id: 'local-1', sync_status: 'pending_update', local_version: 2 },
      ]);

      await conflictEngine.handleWebhookNotification({
        accountId: 'account-1',
        changeType: 'updated',
      });

      const conflicts = conflictEngine.getConflicts();
      expect(conflicts.length).toBe(1);

      await conflictEngine.resolveConflict(conflicts[0].id, 'keep_remote');

      expect(conflictEngine.getConflicts().length).toBe(0);
      expect(conflictEngine.state).toBe('Idle');

      // Verify event was marked as synced
      const syncedCall = db.executeCalls.find(
        (c) => c.sql.includes("sync_status = 'synced'") && c.params?.includes('local-1'),
      );
      expect(syncedCall).toBeDefined();

      conflictEngine.stop();
    });

    it('should resolve conflict with keep_local and re-queue outbound', async () => {
      const conflictAdapter = createMockAdapter({
        getChanges: jest.fn().mockResolvedValue({
          created: [],
          updated: [{ id: 'prov-2', providerData: { title: 'Remote' } }],
          deleted: [],
          nextSyncToken: 'tok',
        } as ChangeSet),
      });

      const adapters = new Map<string, CalendarProviderAdapter>();
      adapters.set('account-1', conflictAdapter);
      const conflictEngine = createSyncEngine({ db, adapters });
      conflictEngine.start();

      db.queryResults.set('FROM events WHERE provider_event_id', [
        { id: 'local-2', sync_status: 'pending_update', local_version: 3 },
      ]);

      await conflictEngine.handleWebhookNotification({
        accountId: 'account-1',
        changeType: 'updated',
      });

      const conflicts = conflictEngine.getConflicts();
      await conflictEngine.resolveConflict(conflicts[0].id, 'keep_local');

      // Should have re-queued a sync entry
      const insertCall = db.executeCalls.find(
        (c) => c.sql.includes('INSERT INTO sync_queue') && c.params?.includes('local-2'),
      );
      expect(insertCall).toBeDefined();

      conflictEngine.stop();
    });

    it('should no-op when resolving nonexistent conflict', async () => {
      await engine.resolveConflict('nonexistent-id', 'keep_remote');
      // Should not throw
      expect(engine.state).toBe('Idle');
    });
  });

  describe('Lifecycle', () => {
    it('should stop all timers on stop()', () => {
      engine.stop();
      expect(engine.state).toBe('Idle');
    });

    it('should be restartable', () => {
      engine.stop();
      engine.start();
      expect(engine.state).toBe('Idle');
    });
  });

  describe('Retry logic', () => {
    it('should increment retry count on failure', async () => {
      const failAdapter = createMockAdapter({
        createEvent: jest.fn().mockRejectedValue(new Error('fail')),
      });
      const adapters = new Map<string, CalendarProviderAdapter>();
      adapters.set('account-1', failAdapter);
      const retryEngine = createSyncEngine({ db, adapters });
      retryEngine.start();

      db.queryResults.set('FROM sync_queue', [
        {
          id: 'sq-retry',
          calendar_account_id: 'account-1',
          event_id: 'ev-retry',
          operation: 'create',
          payload: '{}',
          retry_count: 0,
          max_retries: 5,
        },
      ]);

      await retryEngine.processOutboundQueue();

      // Should have updated retry_count
      const retryCall = db.executeCalls.find(
        (c) => c.sql.includes('retry_count') && c.params?.includes('sq-retry'),
      );
      expect(retryCall).toBeDefined();

      retryEngine.stop();
    });

    it('should notify user when max retries exceeded', async () => {
      const notifySpy = jest.fn();
      const failAdapter = createMockAdapter({
        createEvent: jest.fn().mockRejectedValue(new Error('fail')),
      });
      const adapters = new Map<string, CalendarProviderAdapter>();
      adapters.set('account-1', failAdapter);
      const retryEngine = createSyncEngine({
        db,
        adapters,
        onNotification: notifySpy,
      });
      retryEngine.start();

      db.queryResults.set('FROM sync_queue', [
        {
          id: 'sq-maxretry',
          calendar_account_id: 'account-1',
          event_id: 'ev-maxretry',
          operation: 'create',
          payload: '{}',
          retry_count: 4, // Already at 4, next will be 5 = max
          max_retries: 5,
        },
      ]);

      await retryEngine.processOutboundQueue();

      expect(notifySpy).toHaveBeenCalledWith(
        expect.stringContaining('maximum retries'),
        'error',
      );

      // Should mark as failed
      const failedCall = db.executeCalls.find(
        (c) => c.sql.includes("status = 'failed'") && c.params?.includes('sq-maxretry'),
      );
      expect(failedCall).toBeDefined();

      retryEngine.stop();
    });
  });
});

describe('Utility functions', () => {
  describe('calculateRetryDelay', () => {
    it('should return a positive number', () => {
      const delay = calculateRetryDelay(0);
      expect(delay).toBeGreaterThan(0);
    });

    it('should increase with retry count (exponential backoff)', () => {
      // Run multiple times and check average trend
      const delays = Array.from({ length: 20 }, () => ({
        d0: calculateRetryDelay(0),
        d3: calculateRetryDelay(3),
      }));
      const avgD0 = delays.reduce((s, d) => s + d.d0, 0) / delays.length;
      const avgD3 = delays.reduce((s, d) => s + d.d3, 0) / delays.length;
      expect(avgD3).toBeGreaterThan(avgD0);
    });

    it('should not exceed max delay', () => {
      const delay = calculateRetryDelay(100);
      expect(delay).toBeLessThanOrEqual(70_000); // 60000 + 10% jitter
    });
  });

  describe('generateId', () => {
    it('should return a non-empty string', () => {
      expect(generateId().length).toBeGreaterThan(0);
    });

    it('should generate unique IDs', () => {
      const ids = new Set(Array.from({ length: 100 }, () => generateId()));
      expect(ids.size).toBe(100);
    });
  });
});
