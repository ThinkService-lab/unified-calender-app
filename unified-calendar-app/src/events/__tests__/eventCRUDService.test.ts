/**
 * Unit tests for EventCRUDService.
 * Requirements: 3.1, 3.2, 3.3, 3.6
 */

import { createEventCRUDService } from '../eventCRUDService';
import type { EventCRUDService, CreateEventInput, EventNotificationCallback, EventsStoreAdapter } from '../eventCRUDService';
import type { DatabaseDriver } from '../../db/database';
import type { SyncEngine, LocalChange } from '../../sync/types';
import type { CalendarEvent } from '../../types/models';

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

function createMockSyncEngine(): SyncEngine & {
  queuedChanges: LocalChange[];
} {
  const queuedChanges: LocalChange[] = [];

  return {
    queuedChanges,
    start: jest.fn(),
    stop: jest.fn(),
    queueLocalChange: jest.fn((change: LocalChange) => {
      queuedChanges.push(change);
    }),
    processOutboundQueue: jest.fn().mockResolvedValue({
      success: true, syncedCount: 0, failedCount: 0, conflicts: [],
    }),
    handleWebhookNotification: jest.fn().mockResolvedValue(undefined),
    pollProvider: jest.fn().mockResolvedValue({
      created: [], updated: [], deleted: [], nextSyncToken: '',
    }),
    pollingIntervalMs: 300_000,
    getConflicts: jest.fn().mockReturnValue([]),
    resolveConflict: jest.fn().mockResolvedValue(undefined),
    fullSync: jest.fn().mockResolvedValue({
      success: true, syncedCount: 0, failedCount: 0, conflicts: [],
    }),
    syncAllPending: jest.fn().mockResolvedValue({
      success: true, syncedCount: 0, failedCount: 0, conflicts: [],
    }),
    state: 'Idle',
  };
}

const baseCreateInput: CreateEventInput = {
  calendarAccountId: 'account-1',
  title: 'Team Standup',
  description: 'Daily standup meeting',
  location: 'Room 42',
  startTime: new Date('2025-01-15T09:00:00Z'),
  endTime: new Date('2025-01-15T09:30:00Z'),
  timeZone: 'America/New_York',
  isAllDay: false,
};

// ── Tests ──

describe('EventCRUDService', () => {
  let db: ReturnType<typeof createMockDb>;
  let syncEngine: ReturnType<typeof createMockSyncEngine>;
  let service: EventCRUDService;
  let notifySpy: jest.Mock;

  beforeEach(() => {
    db = createMockDb();
    syncEngine = createMockSyncEngine();
    notifySpy = jest.fn();

    // Default: account exists and is active
    db.queryResults.set('FROM calendar_accounts WHERE id', [
      { id: 'account-1', status: 'active' },
    ]);

    service = createEventCRUDService({
      db,
      syncEngine,
      onNotification: notifySpy,
    });
  });

  describe('createEvent', () => {
    it('should write event to local SQLite and return success', async () => {
      const result = await service.createEvent(baseCreateInput);

      expect(result.success).toBe(true);
      expect(result.eventId).toBeDefined();

      const insertCall = db.executeCalls.find((c) => c.sql.includes('INSERT INTO events'));
      expect(insertCall).toBeDefined();
    });

    it('should set sync_status to pending_create', async () => {
      await service.createEvent(baseCreateInput);

      const insertCall = db.executeCalls.find((c) => c.sql.includes('INSERT INTO events'));
      expect(insertCall).toBeDefined();
      // Verify pending_create is in the params (avoid brittle index checks)
      expect(insertCall!.params).toContain('pending_create');
    });

    it('should store the correct calendar account ID (Req 3.1)', async () => {
      await service.createEvent(baseCreateInput);

      const insertCall = db.executeCalls.find((c) => c.sql.includes('INSERT INTO events'));
      // calendar_account_id is the 3rd param (index 2)
      expect(insertCall!.params![2]).toBe('account-1');
    });

    it('should queue outbound sync to provider (Req 3.1)', async () => {
      await service.createEvent(baseCreateInput);

      expect(syncEngine.queueLocalChange).toHaveBeenCalledTimes(1);
      const queuedChange = syncEngine.queuedChanges[0];
      expect(queuedChange.calendarAccountId).toBe('account-1');
      expect(queuedChange.operation).toBe('create');
    });

    it('should support selecting target calendar account', async () => {
      db.queryResults.set('FROM calendar_accounts WHERE id', [
        { id: 'account-2', status: 'active' },
      ]);

      const result = await service.createEvent({
        ...baseCreateInput,
        calendarAccountId: 'account-2',
      });

      expect(result.success).toBe(true);
      const queuedChange = syncEngine.queuedChanges[0];
      expect(queuedChange.calendarAccountId).toBe('account-2');
    });

    it('should fail if calendar account does not exist', async () => {
      db.queryResults.delete('FROM calendar_accounts WHERE id');

      const result = await service.createEvent({
        ...baseCreateInput,
        calendarAccountId: 'nonexistent',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found or inactive');
    });

    it('should fail if calendar account is not active', async () => {
      db.queryResults.set('FROM calendar_accounts WHERE id', [
        { id: 'account-1', status: 'revoked' },
      ]);

      const result = await service.createEvent(baseCreateInput);

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found or inactive');
    });

    it('should use default values for optional fields', async () => {
      const result = await service.createEvent({
        calendarAccountId: 'account-1',
        title: 'Minimal Event',
        startTime: new Date('2025-01-15T10:00:00Z'),
        endTime: new Date('2025-01-15T11:00:00Z'),
      });

      expect(result.success).toBe(true);
      const insertCall = db.executeCalls.find((c) => c.sql.includes('INSERT INTO events'));
      // timeZone defaults to 'UTC' (index 8)
      expect(insertCall!.params![8]).toBe('UTC');
      // isAllDay defaults to 0 (index 9)
      expect(insertCall!.params![9]).toBe(0);
    });

    it('should include event payload in sync queue entry', async () => {
      await service.createEvent(baseCreateInput);

      const queuedChange = syncEngine.queuedChanges[0];
      const payload = JSON.parse(queuedChange.payload);
      expect(payload.title).toBe('Team Standup');
      expect(payload.startTime).toBe('2025-01-15T09:00:00.000Z');
    });
  });

  describe('updateEvent', () => {
    const fullEventRow = {
      id: 'event-1',
      provider_event_id: 'prov-1',
      calendar_account_id: 'account-1',
      title: 'Original Title',
      description: null,
      location: null,
      start_time: new Date('2025-01-15T09:00:00Z').getTime(),
      end_time: new Date('2025-01-15T09:30:00Z').getTime(),
      time_zone: 'UTC',
      is_all_day: 0,
      recurrence_rule: null,
      recurrence_exception_date: null,
      parent_recurring_event_id: null,
      organizer: null,
      attendees: null,
      sequence: 0,
      dtstamp: Date.now(),
      status: 'confirmed',
      visibility_override: null,
      opaque_fields: null,
      sync_status: 'synced',
      local_version: 1,
      remote_etag: null,
      modified_by: null,
      created_at: Date.now(),
      updated_at: Date.now(),
    };

    beforeEach(() => {
      // Return full row for all event queries — the initial SELECT only reads
      // id, calendar_account_id, local_version, sequence from it, and getEvent
      // reads all fields. Using the full row for both avoids pattern conflicts.
      db.queryResults.set('FROM events WHERE id', [fullEventRow]);
    });

    it('should update event in local SQLite', async () => {
      const result = await service.updateEvent('event-1', { title: 'Updated Title' });

      expect(result.success).toBe(true);
      expect(result.eventId).toBe('event-1');

      const updateCall = db.executeCalls.find((c) => c.sql.includes('UPDATE events SET'));
      expect(updateCall).toBeDefined();
    });

    it('should set sync_status to pending_update', async () => {
      await service.updateEvent('event-1', { title: 'Updated' });

      const updateCall = db.executeCalls.find((c) => c.sql.includes('UPDATE events SET'));
      expect(updateCall!.sql).toContain('sync_status');
      // pending_update should be in params
      expect(updateCall!.params).toContain('pending_update');
    });

    it('should increment local_version', async () => {
      await service.updateEvent('event-1', { title: 'Updated' });

      const updateCall = db.executeCalls.find((c) => c.sql.includes('UPDATE events SET'));
      // new version should be 2 (1 + 1)
      expect(updateCall!.params).toContain(2);
    });

    it('should increment sequence (RFC 5545 SEQUENCE)', async () => {
      await service.updateEvent('event-1', { title: 'Updated' });

      const updateCall = db.executeCalls.find((c) => c.sql.includes('UPDATE events SET'));
      expect(updateCall!.sql).toContain('sequence = ?');
      // new sequence should be 1 (0 + 1)
      expect(updateCall!.params).toContain(1);
    });

    it('should update dtstamp on modification (RFC 5545 DTSTAMP)', async () => {
      const beforeUpdate = Date.now();
      await service.updateEvent('event-1', { title: 'Updated' });

      const updateCall = db.executeCalls.find((c) => c.sql.includes('UPDATE events SET'));
      expect(updateCall!.sql).toContain('dtstamp = ?');
      // dtstamp should be a recent timestamp
      const dtstampParam = updateCall!.params!.find(
        (p) => typeof p === 'number' && (p as number) >= beforeUpdate,
      );
      expect(dtstampParam).toBeDefined();
    });

    it('should queue outbound sync for propagation (Req 3.2)', async () => {
      await service.updateEvent('event-1', { title: 'Updated' });

      expect(syncEngine.queueLocalChange).toHaveBeenCalledTimes(1);
      const queuedChange = syncEngine.queuedChanges[0];
      expect(queuedChange.calendarAccountId).toBe('account-1');
      expect(queuedChange.eventId).toBe('event-1');
      expect(queuedChange.operation).toBe('update');
    });

    it('should send full event state in sync payload (Gap #5 fix)', async () => {
      await service.updateEvent('event-1', { title: 'Updated' });

      const queuedChange = syncEngine.queuedChanges[0];
      const payload = JSON.parse(queuedChange.payload);
      // Full event state should include all fields, not just the changed ones
      // Note: mock DB returns pre-update row since it doesn't apply UPDATEs
      expect(payload.title).toBeDefined();
      expect(payload.startTime).toBeDefined();
      expect(payload.endTime).toBeDefined();
      expect(payload.timeZone).toBe('UTC');
      expect(payload.sequence).toBeDefined();
      expect(payload).toHaveProperty('description');
      expect(payload).toHaveProperty('location');
      expect(payload).toHaveProperty('isAllDay');
      expect(payload).toHaveProperty('organizer');
      expect(payload).toHaveProperty('attendees');
      expect(payload).toHaveProperty('visibility');
    });

    it('should fail if event does not exist', async () => {
      db.queryResults.delete('FROM events WHERE id');

      const result = await service.updateEvent('nonexistent', { title: 'X' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should only update provided fields', async () => {
      await service.updateEvent('event-1', { title: 'New Title' });

      const updateCall = db.executeCalls.find((c) => c.sql.includes('UPDATE events SET'));
      expect(updateCall!.sql).toContain('title = ?');
      expect(updateCall!.sql).not.toContain('description = ?');
      expect(updateCall!.sql).not.toContain('location = ?');
    });

    it('should update multiple fields at once', async () => {
      await service.updateEvent('event-1', {
        title: 'New Title',
        description: 'New Desc',
        location: 'New Location',
      });

      const updateCall = db.executeCalls.find((c) => c.sql.includes('UPDATE events SET'));
      expect(updateCall!.sql).toContain('title = ?');
      expect(updateCall!.sql).toContain('description = ?');
      expect(updateCall!.sql).toContain('location = ?');
    });

    it('should update time fields correctly', async () => {
      const newStart = new Date('2025-02-01T14:00:00Z');
      const newEnd = new Date('2025-02-01T15:00:00Z');

      await service.updateEvent('event-1', {
        startTime: newStart,
        endTime: newEnd,
      });

      const updateCall = db.executeCalls.find((c) => c.sql.includes('UPDATE events SET'));
      expect(updateCall!.params).toContain(newStart.getTime());
      expect(updateCall!.params).toContain(newEnd.getTime());
    });
  });

  describe('deleteEvent', () => {
    beforeEach(() => {
      db.queryResults.set('FROM events WHERE id', [
        { id: 'event-1', calendar_account_id: 'account-1' },
      ]);
    });

    it('should mark event as pending_delete locally', async () => {
      const result = await service.deleteEvent('event-1');

      expect(result.success).toBe(true);
      expect(result.eventId).toBe('event-1');

      const updateCall = db.executeCalls.find(
        (c) => c.sql.includes("sync_status = 'pending_delete'"),
      );
      expect(updateCall).toBeDefined();
    });

    it('should queue outbound sync for deletion (Req 3.3)', async () => {
      await service.deleteEvent('event-1');

      expect(syncEngine.queueLocalChange).toHaveBeenCalledTimes(1);
      const queuedChange = syncEngine.queuedChanges[0];
      expect(queuedChange.calendarAccountId).toBe('account-1');
      expect(queuedChange.eventId).toBe('event-1');
      expect(queuedChange.operation).toBe('delete');
    });

    it('should fail if event does not exist', async () => {
      db.queryResults.delete('FROM events WHERE id');

      const result = await service.deleteEvent('nonexistent');

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('getEvent', () => {
    it('should return null for nonexistent event', async () => {
      const event = await service.getEvent('nonexistent');
      expect(event).toBeNull();
    });

    it('should return mapped CalendarEvent for existing event', async () => {
      const now = Date.now();
      db.queryResults.set('FROM events WHERE id', [
        {
          id: 'event-1',
          provider_event_id: 'prov-1',
          calendar_account_id: 'account-1',
          title: 'Test Event',
          description: 'A test',
          location: 'Room 1',
          start_time: now,
          end_time: now + 3600000,
          time_zone: 'UTC',
          is_all_day: 0,
          recurrence_rule: null,
          recurrence_exception_date: null,
          parent_recurring_event_id: null,
          organizer: null,
          attendees: null,
          sequence: 0,
          dtstamp: now,
          status: 'confirmed',
          visibility_override: null,
          opaque_fields: null,
          sync_status: 'synced',
          local_version: 1,
          remote_etag: null,
          modified_by: null,
          created_at: now,
          updated_at: now,
        },
      ]);

      const event = await service.getEvent('event-1');

      expect(event).not.toBeNull();
      expect(event!.id).toBe('event-1');
      expect(event!.title).toBe('Test Event');
      expect(event!.calendarAccountId).toBe('account-1');
      expect(event!.startTime).toBeInstanceOf(Date);
    });
  });

  describe('getEventsByAccount', () => {
    it('should return empty array when no events', async () => {
      const events = await service.getEventsByAccount('account-1');
      expect(events).toEqual([]);
    });

    it('should return mapped events for account', async () => {
      const now = Date.now();
      db.queryResults.set('FROM events WHERE calendar_account_id', [
        {
          id: 'event-1',
          provider_event_id: '',
          calendar_account_id: 'account-1',
          title: 'Event 1',
          description: null,
          location: null,
          start_time: now,
          end_time: now + 3600000,
          time_zone: 'UTC',
          is_all_day: 0,
          recurrence_rule: null,
          recurrence_exception_date: null,
          parent_recurring_event_id: null,
          organizer: null,
          attendees: null,
          sequence: 0,
          dtstamp: now,
          status: 'confirmed',
          visibility_override: null,
          opaque_fields: null,
          sync_status: 'pending_create',
          local_version: 1,
          remote_etag: null,
          modified_by: null,
          created_at: now,
          updated_at: now,
        },
      ]);

      const events = await service.getEventsByAccount('account-1');

      expect(events.length).toBe(1);
      expect(events[0].title).toBe('Event 1');
      expect(events[0].syncStatus).toBe('pending_create');
    });
  });

  describe('Failed operation retry with notification (Req 3.6)', () => {
    it('should notify user when DB write fails on create', async () => {
      const failDb = createMockDb();
      failDb.queryResults.set('FROM calendar_accounts WHERE id', [
        { id: 'account-1', status: 'active' },
      ]);
      // Override execute to throw on INSERT INTO events
      const originalExecute = failDb.execute.bind(failDb);
      failDb.execute = async (sql: string, params?: unknown[]) => {
        if (sql.includes('INSERT INTO events')) {
          throw new Error('Disk full');
        }
        return originalExecute(sql, params);
      };

      const failService = createEventCRUDService({
        db: failDb,
        syncEngine,
        onNotification: notifySpy,
      });

      const result = await failService.createEvent(baseCreateInput);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Disk full');
      expect(notifySpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to create event'),
        'error',
      );
    });

    it('should notify user when sync queue fails', async () => {
      const failingSyncEngine = createMockSyncEngine();
      failingSyncEngine.queueLocalChange = jest.fn(() => {
        throw new Error('Queue full');
      });

      const failService = createEventCRUDService({
        db,
        syncEngine: failingSyncEngine,
        onNotification: notifySpy,
      });

      const result = await failService.createEvent(baseCreateInput);

      // Event should still be created locally
      expect(result.success).toBe(true);
      // But user should be notified about sync queue failure
      expect(notifySpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to queue'),
        'warning',
      );
    });

    it('should notify user when DB write fails on update', async () => {
      const failDb = createMockDb();
      failDb.queryResults.set('FROM events WHERE id', [
        {
          id: 'event-1', provider_event_id: '', calendar_account_id: 'account-1',
          title: 'Test', description: null, location: null,
          start_time: Date.now(), end_time: Date.now() + 3600000,
          time_zone: 'UTC', is_all_day: 0, recurrence_rule: null,
          recurrence_exception_date: null, parent_recurring_event_id: null,
          organizer: null, attendees: null, sequence: 0, dtstamp: Date.now(),
          status: 'confirmed', visibility_override: null, opaque_fields: null,
          sync_status: 'synced', local_version: 1, remote_etag: null,
          modified_by: null, created_at: Date.now(), updated_at: Date.now(),
        },
      ]);
      const originalExecute = failDb.execute.bind(failDb);
      failDb.execute = async (sql: string, params?: unknown[]) => {
        if (sql.includes('UPDATE events SET')) {
          throw new Error('DB locked');
        }
        return originalExecute(sql, params);
      };

      const failService = createEventCRUDService({
        db: failDb,
        syncEngine,
        onNotification: notifySpy,
      });

      const result = await failService.updateEvent('event-1', { title: 'X' });

      expect(result.success).toBe(false);
      expect(notifySpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to update event'),
        'error',
      );
    });

    it('should notify user when DB write fails on delete', async () => {
      const failDb = createMockDb();
      failDb.queryResults.set('FROM events WHERE id', [
        { id: 'event-1', calendar_account_id: 'account-1' },
      ]);
      const originalExecute = failDb.execute.bind(failDb);
      failDb.execute = async (sql: string, params?: unknown[]) => {
        if (sql.includes('sync_status')) {
          throw new Error('DB error');
        }
        return originalExecute(sql, params);
      };

      const failService = createEventCRUDService({
        db: failDb,
        syncEngine,
        onNotification: notifySpy,
      });

      const result = await failService.deleteEvent('event-1');

      expect(result.success).toBe(false);
      expect(notifySpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to delete event'),
        'error',
      );
    });
  });

  describe('Service without notification callback', () => {
    it('should not throw when no notification callback is provided', async () => {
      const silentService = createEventCRUDService({ db, syncEngine });

      const result = await silentService.createEvent(baseCreateInput);
      expect(result.success).toBe(true);
    });
  });

  describe('Zustand store integration (Gap #1 fix)', () => {
    let mockStore: EventsStoreAdapter & {
      addedEvents: CalendarEvent[];
      updatedEvents: Array<{ id: string; updates: Partial<CalendarEvent> }>;
      removedIds: string[];
      syncStatuses: Array<{ id: string; status: string }>;
    };
    let storeService: EventCRUDService;

    beforeEach(() => {
      mockStore = {
        addedEvents: [],
        updatedEvents: [],
        removedIds: [],
        syncStatuses: [],
        addEvent: jest.fn((event: CalendarEvent) => { mockStore.addedEvents.push(event); }),
        updateEvent: jest.fn((id: string, updates: Partial<CalendarEvent>) => {
          mockStore.updatedEvents.push({ id, updates });
        }),
        removeEvent: jest.fn((id: string) => { mockStore.removedIds.push(id); }),
        setSyncStatus: jest.fn((id: string, status: CalendarEvent['syncStatus']) => {
          mockStore.syncStatuses.push({ id, status });
        }),
      };

      storeService = createEventCRUDService({
        db,
        syncEngine,
        eventsStore: mockStore,
        onNotification: notifySpy,
      });
    });

    it('should add event to Zustand store on create', async () => {
      const result = await storeService.createEvent(baseCreateInput);

      expect(result.success).toBe(true);
      expect(mockStore.addEvent).toHaveBeenCalledTimes(1);
      expect(mockStore.addedEvents[0].title).toBe('Team Standup');
      expect(mockStore.addedEvents[0].syncStatus).toBe('pending_create');
      expect(mockStore.addedEvents[0].calendarAccountId).toBe('account-1');
    });

    it('should update event in Zustand store on update', async () => {
      db.queryResults.set('FROM events WHERE id', [
        {
          id: 'event-1', provider_event_id: '', calendar_account_id: 'account-1',
          title: 'Test', description: null, location: null,
          start_time: Date.now(), end_time: Date.now() + 3600000,
          time_zone: 'UTC', is_all_day: 0, recurrence_rule: null,
          recurrence_exception_date: null, parent_recurring_event_id: null,
          organizer: null, attendees: null, sequence: 0, dtstamp: Date.now(),
          status: 'confirmed', visibility_override: null, opaque_fields: null,
          sync_status: 'synced', local_version: 1, remote_etag: null,
          modified_by: null, created_at: Date.now(), updated_at: Date.now(),
        },
      ]);

      await storeService.updateEvent('event-1', { title: 'Updated Title' });

      expect(mockStore.updateEvent).toHaveBeenCalledTimes(1);
      expect(mockStore.updatedEvents[0].id).toBe('event-1');
      expect(mockStore.updatedEvents[0].updates.title).toBe('Updated Title');
      expect(mockStore.updatedEvents[0].updates.syncStatus).toBe('pending_update');
      expect(mockStore.updatedEvents[0].updates.sequence).toBe(1);
      expect(mockStore.updatedEvents[0].updates.dtstamp).toBeInstanceOf(Date);
    });

    it('should remove event from Zustand store on delete', async () => {
      db.queryResults.set('FROM events WHERE id', [
        { id: 'event-1', calendar_account_id: 'account-1' },
      ]);

      await storeService.deleteEvent('event-1');

      expect(mockStore.removeEvent).toHaveBeenCalledTimes(1);
      expect(mockStore.removedIds[0]).toBe('event-1');
    });
  });

  describe('UUID generation (Gap #2 fix)', () => {
    it('should generate UUID v4 format event IDs', async () => {
      const result = await service.createEvent(baseCreateInput);

      expect(result.success).toBe(true);
      // UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
      expect(result.eventId).toMatch(uuidRegex);
    });
  });

  describe('Complete sync payload (Gap #3 fix)', () => {
    it('should include all fields in create sync payload', async () => {
      await service.createEvent({
        ...baseCreateInput,
        recurrenceRule: '{"frequency":"weekly"}',
        attendees: '[{"email":"a@b.com"}]',
        organizer: '{"email":"org@b.com"}',
        visibility: 'private',
      });

      const queuedChange = syncEngine.queuedChanges[0];
      const payload = JSON.parse(queuedChange.payload);
      expect(payload.recurrenceRule).toBe('{"frequency":"weekly"}');
      expect(payload.attendees).toBe('[{"email":"a@b.com"}]');
      expect(payload.organizer).toBe('{"email":"org@b.com"}');
      expect(payload.visibility).toBe('private');
    });
  });

  describe('Recurring event exception creation (Gap #6 fix)', () => {
    it('should store recurrenceExceptionDate and parentRecurringEventId', async () => {
      const exceptionDate = new Date('2025-01-22T09:00:00Z');
      await service.createEvent({
        ...baseCreateInput,
        recurrenceExceptionDate: exceptionDate,
        parentRecurringEventId: 'parent-event-1',
      });

      const insertCall = db.executeCalls.find((c) => c.sql.includes('INSERT INTO events'));
      expect(insertCall!.sql).toContain('recurrence_exception_date');
      expect(insertCall!.sql).toContain('parent_recurring_event_id');
      expect(insertCall!.params).toContain(exceptionDate.getTime());
      expect(insertCall!.params).toContain('parent-event-1');
    });

    it('should default exception fields to null for regular events', async () => {
      await service.createEvent(baseCreateInput);

      const insertCall = db.executeCalls.find((c) => c.sql.includes('INSERT INTO events'));
      expect(insertCall!.sql).toContain('recurrence_exception_date');
      expect(insertCall!.sql).toContain('parent_recurring_event_id');
    });
  });

  describe('5-second propagation SLA (Req 3.2, 3.3)', () => {
    it('should queue sync immediately on create (< 100ms)', async () => {
      const start = Date.now();
      await service.createEvent(baseCreateInput);
      const elapsed = Date.now() - start;

      expect(syncEngine.queueLocalChange).toHaveBeenCalledTimes(1);
      // The queue call should happen within the same async tick — well under 5 seconds
      expect(elapsed).toBeLessThan(100);
    });

    it('should queue sync immediately on update (< 100ms)', async () => {
      db.queryResults.set('FROM events WHERE id', [
        {
          id: 'event-1', provider_event_id: '', calendar_account_id: 'account-1',
          title: 'Test', description: null, location: null,
          start_time: Date.now(), end_time: Date.now() + 3600000,
          time_zone: 'UTC', is_all_day: 0, recurrence_rule: null,
          recurrence_exception_date: null, parent_recurring_event_id: null,
          organizer: null, attendees: null, sequence: 0, dtstamp: Date.now(),
          status: 'confirmed', visibility_override: null, opaque_fields: null,
          sync_status: 'synced', local_version: 1, remote_etag: null,
          modified_by: null, created_at: Date.now(), updated_at: Date.now(),
        },
      ]);

      const start = Date.now();
      await service.updateEvent('event-1', { title: 'Updated' });
      const elapsed = Date.now() - start;

      expect(syncEngine.queueLocalChange).toHaveBeenCalledTimes(1);
      expect(elapsed).toBeLessThan(100);
    });

    it('should queue sync immediately on delete (< 100ms)', async () => {
      db.queryResults.set('FROM events WHERE id', [
        { id: 'event-1', calendar_account_id: 'account-1' },
      ]);

      const start = Date.now();
      await service.deleteEvent('event-1');
      const elapsed = Date.now() - start;

      expect(syncEngine.queueLocalChange).toHaveBeenCalledTimes(1);
      expect(elapsed).toBeLessThan(100);
    });
  });

  describe('Opaque fields support (Gap #4 fix)', () => {
    it('should store opaque_fields in SQLite on create', async () => {
      const opaqueData = '{"X-CUSTOM-PROP":"custom-value"}';
      await service.createEvent({
        ...baseCreateInput,
        opaqueFields: opaqueData,
      });

      const insertCall = db.executeCalls.find((c) => c.sql.includes('INSERT INTO events'));
      expect(insertCall!.sql).toContain('opaque_fields');
      expect(insertCall!.params).toContain(opaqueData);
    });

    it('should default opaque_fields to null when not provided', async () => {
      await service.createEvent(baseCreateInput);

      const insertCall = db.executeCalls.find((c) => c.sql.includes('INSERT INTO events'));
      expect(insertCall!.sql).toContain('opaque_fields');
      // opaque_fields is right before sync_status in the VALUES
      const opaqueIdx = insertCall!.params!.indexOf('pending_create') - 1;
      expect(insertCall!.params![opaqueIdx]).toBeNull();
    });
  });
});
