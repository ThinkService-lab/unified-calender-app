/**
 * Property-based tests for the SyncEngine.
 * Requirements: 3.6, 4.5, 6.1, 6.2, 6.5
 */

import fc from 'fast-check';
import { createSyncEngine, generateId } from '../syncEngine';
import type { SyncEngineConfig } from '../syncEngine';
import type { SyncEngine, LocalChange, SyncConflict } from '../types';
import type { DatabaseDriver } from '../../db/database';
import type { CalendarProviderAdapter, ChangeSet } from '../../providers/types';

// ── Mock helpers (matching patterns from syncEngine.test.ts) ──

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
    authenticate: jest.fn().mockResolvedValue({
      accessToken: 'tok', refreshToken: 'ref', expiresIn: 3600, tokenType: 'Bearer',
    }),
    refreshToken: jest.fn().mockResolvedValue({
      accessToken: 'tok', refreshToken: 'ref', expiresIn: 3600, tokenType: 'Bearer',
    }),
    revokeAccess: jest.fn().mockResolvedValue(undefined),
    listCalendars: jest.fn().mockResolvedValue([]),
    listEvents: jest.fn().mockResolvedValue([]),
    createEvent: jest.fn().mockResolvedValue('new-event-id'),
    updateEvent: jest.fn().mockResolvedValue(undefined),
    deleteEvent: jest.fn().mockResolvedValue(undefined),
    getChanges: jest.fn().mockResolvedValue({
      created: [], updated: [], deleted: [], nextSyncToken: 'token-1',
    } as ChangeSet),
    ...overrides,
  };
}

// ── Custom Arbitraries ──

/** Arbitrary for a valid sync operation type */
const arbOperation = fc.constantFrom<'create' | 'update' | 'delete'>('create', 'update', 'delete');

/** Arbitrary for a LocalChange with random but valid fields */
function arbLocalChange(): fc.Arbitrary<LocalChange> {
  return fc.record({
    calendarAccountId: fc.constant('account-1'),
    eventId: fc.uuid(),
    operation: arbOperation,
    payload: fc.json({ maxDepth: 1 }),
  });
}

/** Arbitrary for a pair of JSON version strings (local and remote) */
function arbVersionPair(): fc.Arbitrary<{ local: string; remote: string }> {
  return fc.record({
    local: fc.record({
      title: fc.string({ minLength: 1, maxLength: 50 }),
      description: fc.option(fc.string({ maxLength: 100 }), { nil: undefined }),
    }).map((obj) => JSON.stringify(obj)),
    remote: fc.record({
      title: fc.string({ minLength: 1, maxLength: 50 }),
      description: fc.option(fc.string({ maxLength: 100 }), { nil: undefined }),
    }).map((obj) => JSON.stringify(obj)),
  });
}

// ── Property Tests ──

// Use fake timers to prevent open handles from the SyncEngine's internal
// setTimeout / setInterval calls (outbound processing, retry, polling).
beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
});

// Feature: unified-calendar-app, Property 15: Failed write operations are queued
// **Validates: Requirements 3.6**
describe('Property 15: Failed write operations are queued', () => {
  it('failed write creates exactly one SyncQueueEntry with status pending, retryCount 0', async () => {
    await fc.assert(
      fc.asyncProperty(arbLocalChange(), async (change) => {
        const db = createMockDb();
        const failingAdapter = createMockAdapter({
          createEvent: jest.fn().mockRejectedValue(new Error('Network error')),
          updateEvent: jest.fn().mockRejectedValue(new Error('Network error')),
          deleteEvent: jest.fn().mockRejectedValue(new Error('Network error')),
        });
        const adapters = new Map<string, CalendarProviderAdapter>();
        adapters.set('account-1', failingAdapter);

        const engine = createSyncEngine({ db, adapters });
        engine.start();

        // Queue the change — this inserts into sync_queue
        engine.queueLocalChange(change);

        // Flush the microtask queue so the async db.execute() resolves
        await Promise.resolve();

        // Find the INSERT call for this change
        const insertCalls = db.executeCalls.filter(
          (c) => c.sql.includes('INSERT INTO sync_queue'),
        );

        // Exactly one sync_queue entry was created
        expect(insertCalls).toHaveLength(1);

        const params = insertCalls[0].params!;
        // params layout: [id, calendarAccountId, eventId, operation, payload, retryCount, maxRetries, nextRetryAt, status, createdAt]
        expect(params[1]).toBe(change.calendarAccountId);
        expect(params[2]).toBe(change.eventId);
        expect(params[3]).toBe(change.operation);
        expect(params[5]).toBe(0);         // retryCount = 0
        expect(params[8]).toBe('pending'); // status = pending

        engine.stop();
      }),
      { numRuns: 100, seed: 42 },
    );
  }, 30_000);
});

// Feature: unified-calendar-app, Property 16: Sync conflict detection preserves both versions
// **Validates: Requirements 4.5, 6.5**
describe('Property 16: Sync conflict detection preserves both versions', () => {
  it('conflict object contains both local and remote versions', () => {
    fc.assert(
      fc.asyncProperty(arbVersionPair(), async ({ local, remote }) => {
        const db = createMockDb();

        // Simulate an existing event with a pending local update
        db.queryResults.set('FROM events WHERE provider_event_id', [
          { id: 'local-event-1', sync_status: 'pending_update', local_version: 2 },
        ]);

        // Adapter returns a remote update for the same event
        const conflictAdapter = createMockAdapter({
          getChanges: jest.fn().mockResolvedValue({
            created: [],
            updated: [{ id: 'provider-event-1', providerData: JSON.parse(remote) }],
            deleted: [],
            nextSyncToken: 'tok-conflict',
          } as ChangeSet),
        });

        const adapters = new Map<string, CalendarProviderAdapter>();
        adapters.set('account-1', conflictAdapter);

        const engine = createSyncEngine({ db, adapters });
        engine.start();

        await engine.handleWebhookNotification({
          accountId: 'account-1',
          changeType: 'updated',
          syncToken: 'tok-0',
        });

        // Flush any pending microtasks
        await Promise.resolve();

        const conflicts = engine.getConflicts();

        // A conflict must be detected
        expect(conflicts).toHaveLength(1);

        const conflict = conflicts[0];

        // Both versions must be present and non-empty
        expect(conflict.localVersion).toBeDefined();
        expect(conflict.remoteVersion).toBeDefined();
        expect(conflict.localVersion.length).toBeGreaterThan(0);
        expect(conflict.remoteVersion.length).toBeGreaterThan(0);

        // Versions must be valid JSON
        expect(() => JSON.parse(conflict.localVersion)).not.toThrow();
        expect(() => JSON.parse(conflict.remoteVersion)).not.toThrow();

        // Conflict metadata must be populated
        expect(conflict.id).toBeDefined();
        expect(conflict.eventId).toBe('local-event-1');
        expect(conflict.calendarAccountId).toBe('account-1');
        expect(conflict.detectedAt).toBeInstanceOf(Date);

        engine.stop();
      }),
      { numRuns: 100, seed: 42 },
    );
  });
});

// Feature: unified-calendar-app, Property 19: Offline CRUD operations and sync queue consistency
// **Validates: Requirements 6.1, 6.2**
describe('Property 19: Offline CRUD and sync queue consistency', () => {
  it('offline CRUD reflects locally immediately, sync queue has exactly one matching entry', async () => {
    await fc.assert(
      fc.asyncProperty(arbLocalChange(), async (change) => {
        const db = createMockDb();

        // No adapter available — simulates offline (no provider to push to)
        const adapters = new Map<string, CalendarProviderAdapter>();

        const engine = createSyncEngine({ db, adapters });
        engine.start();

        // Queue the local change (offline CRUD)
        engine.queueLocalChange(change);

        // Flush the microtask queue so the async db.execute() resolves
        await Promise.resolve();

        // The sync queue must have exactly one INSERT for this change
        const insertCalls = db.executeCalls.filter(
          (c) => c.sql.includes('INSERT INTO sync_queue'),
        );
        expect(insertCalls).toHaveLength(1);

        const params = insertCalls[0].params!;

        // The entry must match the original change
        expect(params[1]).toBe(change.calendarAccountId);
        expect(params[2]).toBe(change.eventId);
        expect(params[3]).toBe(change.operation);
        expect(params[4]).toBe(change.payload);

        // Entry must be immediately pending (ready for sync when online)
        expect(params[5]).toBe(0);         // retryCount = 0
        expect(params[8]).toBe('pending'); // status = pending

        // nextRetryAt should be <= now (immediately eligible)
        const nextRetryAt = params[7] as number;
        expect(nextRetryAt).toBeLessThanOrEqual(Date.now() + 1000);

        // createdAt should be recent
        const createdAt = params[9] as number;
        expect(createdAt).toBeLessThanOrEqual(Date.now() + 1000);
        expect(createdAt).toBeGreaterThan(Date.now() - 5000);

        engine.stop();
      }),
      { numRuns: 100, seed: 42 },
    );
  }, 30_000);
});
