/**
 * Unit tests for SyncConflictResolver.
 * Requirements: 4.5, 6.5
 */

import { createConflictResolver } from '../conflictResolver';
import type { SyncConflictResolver, ConflictResolverConfig } from '../conflictResolver';
import type { SyncConflict } from '../types';
import type { DatabaseDriver } from '../../db/database';

// ── Test helpers ──

function createMockDb(): DatabaseDriver & {
  executeCalls: Array<{ sql: string; params?: unknown[] }>;
} {
  const executeCalls: Array<{ sql: string; params?: unknown[] }> = [];
  return {
    executeCalls,
    async execute(sql: string, params?: unknown[]): Promise<void> {
      executeCalls.push({ sql, params });
    },
    async query<T = Record<string, unknown>>(): Promise<T[]> {
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

function makeConflict(overrides?: Partial<SyncConflict>): SyncConflict {
  return {
    id: 'conflict-1',
    eventId: 'event-1',
    calendarAccountId: 'account-1',
    localVersion: JSON.stringify({ title: 'Local Title', location: 'Office' }),
    remoteVersion: JSON.stringify({ title: 'Remote Title', location: 'Home' }),
    detectedAt: new Date('2025-01-15T10:00:00Z'),
    ...overrides,
  };
}

function createResolver(
  dbOverride?: ReturnType<typeof createMockDb>,
  requeueSpy?: jest.Mock,
): { resolver: SyncConflictResolver; db: ReturnType<typeof createMockDb>; requeueSpy: jest.Mock } {
  const db = dbOverride ?? createMockDb();
  const spy = requeueSpy ?? jest.fn().mockResolvedValue(undefined);
  const resolver = createConflictResolver({ db, onRequeueLocal: spy });
  return { resolver, db, requeueSpy: spy };
}

// ── Tests ──

describe('SyncConflictResolver', () => {
  describe('addConflict', () => {
    it('should track a new conflict as pending', () => {
      const { resolver } = createResolver();
      const conflict = makeConflict();

      resolver.addConflict(conflict);

      expect(resolver.pendingCount()).toBe(1);
      expect(resolver.hasPendingConflicts()).toBe(true);
    });

    it('should not duplicate an already-tracked conflict', () => {
      const { resolver } = createResolver();
      const conflict = makeConflict();

      resolver.addConflict(conflict);
      resolver.addConflict(conflict);

      expect(resolver.pendingCount()).toBe(1);
      expect(resolver.getAllConflicts().length).toBe(1);
    });

    it('should track multiple distinct conflicts', () => {
      const { resolver } = createResolver();

      resolver.addConflict(makeConflict({ id: 'c-1', eventId: 'e-1' }));
      resolver.addConflict(makeConflict({ id: 'c-2', eventId: 'e-2' }));
      resolver.addConflict(makeConflict({ id: 'c-3', eventId: 'e-3' }));

      expect(resolver.pendingCount()).toBe(3);
      expect(resolver.getAllConflicts().length).toBe(3);
    });
  });

  describe('getPendingConflicts', () => {
    it('should return empty array when no conflicts exist', () => {
      const { resolver } = createResolver();
      expect(resolver.getPendingConflicts()).toEqual([]);
    });

    it('should return only pending conflicts', async () => {
      const { resolver } = createResolver();

      resolver.addConflict(makeConflict({ id: 'c-1' }));
      resolver.addConflict(makeConflict({ id: 'c-2' }));

      // Resolve one
      await resolver.resolveConflict('c-1', 'keep_remote');

      const pending = resolver.getPendingConflicts();
      expect(pending.length).toBe(1);
      expect(pending[0].conflict.id).toBe('c-2');
    });
  });

  describe('getAllConflicts', () => {
    it('should return both pending and resolved conflicts', async () => {
      const { resolver } = createResolver();

      resolver.addConflict(makeConflict({ id: 'c-1' }));
      resolver.addConflict(makeConflict({ id: 'c-2' }));

      await resolver.resolveConflict('c-1', 'keep_remote');

      const all = resolver.getAllConflicts();
      expect(all.length).toBe(2);
      expect(all.find((t) => t.conflict.id === 'c-1')!.state).toBe('resolved');
      expect(all.find((t) => t.conflict.id === 'c-2')!.state).toBe('pending');
    });
  });

  describe('getConflictDetails', () => {
    it('should return null for unknown conflict id', () => {
      const { resolver } = createResolver();
      expect(resolver.getConflictDetails('nonexistent')).toBeNull();
    });

    it('should parse local and remote versions into structured objects', () => {
      const { resolver } = createResolver();
      const conflict = makeConflict({
        localVersion: JSON.stringify({ title: 'My Meeting', startTime: '2025-01-15T09:00:00Z' }),
        remoteVersion: JSON.stringify({ title: 'Team Standup', startTime: '2025-01-15T10:00:00Z' }),
      });

      resolver.addConflict(conflict);
      const details = resolver.getConflictDetails(conflict.id);

      expect(details).not.toBeNull();
      expect(details!.localVersion.title).toBe('My Meeting');
      expect(details!.localVersion.startTime).toBe('2025-01-15T09:00:00Z');
      expect(details!.remoteVersion.title).toBe('Team Standup');
      expect(details!.remoteVersion.startTime).toBe('2025-01-15T10:00:00Z');
    });

    it('should handle malformed JSON gracefully', () => {
      const { resolver } = createResolver();
      const conflict = makeConflict({
        localVersion: 'not-valid-json',
        remoteVersion: '{ broken',
      });

      resolver.addConflict(conflict);
      const details = resolver.getConflictDetails(conflict.id);

      expect(details).not.toBeNull();
      expect(details!.localVersion).toEqual({});
      expect(details!.remoteVersion).toEqual({});
    });

    it('should include conflict metadata', () => {
      const { resolver } = createResolver();
      const conflict = makeConflict();

      resolver.addConflict(conflict);
      const details = resolver.getConflictDetails(conflict.id);

      expect(details!.id).toBe(conflict.id);
      expect(details!.eventId).toBe(conflict.eventId);
      expect(details!.calendarAccountId).toBe(conflict.calendarAccountId);
      expect(details!.detectedAt).toEqual(conflict.detectedAt);
      expect(details!.state).toBe('pending');
    });

    it('should reflect resolved state after resolution', async () => {
      const { resolver } = createResolver();
      const conflict = makeConflict();

      resolver.addConflict(conflict);
      await resolver.resolveConflict(conflict.id, 'keep_remote');

      const details = resolver.getConflictDetails(conflict.id);
      expect(details!.state).toBe('resolved');
    });
  });

  describe('resolveConflict — keep_remote', () => {
    it('should mark event as synced in the database', async () => {
      const { resolver, db } = createResolver();
      const conflict = makeConflict();

      resolver.addConflict(conflict);
      await resolver.resolveConflict(conflict.id, 'keep_remote');

      const syncedCall = db.executeCalls.find(
        (c) => c.sql.includes("sync_status = 'synced'") && c.params?.includes('event-1'),
      );
      expect(syncedCall).toBeDefined();
    });

    it('should mark the conflict as resolved', async () => {
      const { resolver } = createResolver();
      const conflict = makeConflict();

      resolver.addConflict(conflict);
      await resolver.resolveConflict(conflict.id, 'keep_remote');

      expect(resolver.pendingCount()).toBe(0);
      expect(resolver.hasPendingConflicts()).toBe(false);

      const all = resolver.getAllConflicts();
      expect(all[0].state).toBe('resolved');
      expect(all[0].resolvedAt).toBeInstanceOf(Date);
      expect(all[0].resolution).toBe('keep_remote');
    });

    it('should not call onRequeueLocal', async () => {
      const { resolver, requeueSpy } = createResolver();
      const conflict = makeConflict();

      resolver.addConflict(conflict);
      await resolver.resolveConflict(conflict.id, 'keep_remote');

      expect(requeueSpy).not.toHaveBeenCalled();
    });
  });

  describe('resolveConflict — keep_local', () => {
    it('should set event sync_status to pending_update', async () => {
      const { resolver, db } = createResolver();
      const conflict = makeConflict();

      resolver.addConflict(conflict);
      await resolver.resolveConflict(conflict.id, 'keep_local');

      const pendingCall = db.executeCalls.find(
        (c) => c.sql.includes("sync_status = 'pending_update'") && c.params?.includes('event-1'),
      );
      expect(pendingCall).toBeDefined();
    });

    it('should call onRequeueLocal with the conflict', async () => {
      const { resolver, requeueSpy } = createResolver();
      const conflict = makeConflict();

      resolver.addConflict(conflict);
      await resolver.resolveConflict(conflict.id, 'keep_local');

      expect(requeueSpy).toHaveBeenCalledWith(conflict);
    });

    it('should mark the conflict as resolved', async () => {
      const { resolver } = createResolver();
      const conflict = makeConflict();

      resolver.addConflict(conflict);
      await resolver.resolveConflict(conflict.id, 'keep_local');

      const all = resolver.getAllConflicts();
      expect(all[0].state).toBe('resolved');
      expect(all[0].resolution).toBe('keep_local');
    });
  });

  describe('resolveConflict — edge cases', () => {
    it('should no-op for unknown conflict id', async () => {
      const { resolver, db, requeueSpy } = createResolver();

      await resolver.resolveConflict('nonexistent', 'keep_remote');

      expect(db.executeCalls.length).toBe(0);
      expect(requeueSpy).not.toHaveBeenCalled();
    });

    it('should no-op for already-resolved conflict', async () => {
      const { resolver, db, requeueSpy } = createResolver();
      const conflict = makeConflict();

      resolver.addConflict(conflict);
      await resolver.resolveConflict(conflict.id, 'keep_remote');

      const callCountAfterFirst = db.executeCalls.length;

      // Try resolving again
      await resolver.resolveConflict(conflict.id, 'keep_local');

      expect(db.executeCalls.length).toBe(callCountAfterFirst);
      expect(requeueSpy).not.toHaveBeenCalled();
    });
  });

  describe('hasPendingConflicts / pendingCount', () => {
    it('should return false/0 when empty', () => {
      const { resolver } = createResolver();
      expect(resolver.hasPendingConflicts()).toBe(false);
      expect(resolver.pendingCount()).toBe(0);
    });

    it('should update correctly as conflicts are added and resolved', async () => {
      const { resolver } = createResolver();

      resolver.addConflict(makeConflict({ id: 'c-1' }));
      resolver.addConflict(makeConflict({ id: 'c-2' }));
      expect(resolver.pendingCount()).toBe(2);

      await resolver.resolveConflict('c-1', 'keep_remote');
      expect(resolver.pendingCount()).toBe(1);
      expect(resolver.hasPendingConflicts()).toBe(true);

      await resolver.resolveConflict('c-2', 'keep_local');
      expect(resolver.pendingCount()).toBe(0);
      expect(resolver.hasPendingConflicts()).toBe(false);
    });
  });

  describe('never auto-resolves', () => {
    it('conflicts remain pending until explicitly resolved', () => {
      const { resolver } = createResolver();

      resolver.addConflict(makeConflict({ id: 'c-1' }));
      resolver.addConflict(makeConflict({ id: 'c-2' }));

      // No auto-resolution should happen
      expect(resolver.pendingCount()).toBe(2);
      expect(resolver.getPendingConflicts().every((t) => t.state === 'pending')).toBe(true);
    });
  });
});
