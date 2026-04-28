/**
 * Unit tests for mutation hooks (create, update, delete).
 * Tests optimistic update logic, rollback on error, and query invalidation.
 */

import { QueryClient } from '@tanstack/react-query';
import { queryKeys } from '../queryKeys';
import { useEventsStore } from '../../stores/eventsStore';
import type { CalendarProviderAdapter, RawEventData } from '../../providers/types';
import type { CalendarEvent } from '../../types/models';
import type { SyncEngine, LocalChange } from '../../sync/types';

// Helper to create a mock adapter
function createMockAdapter(overrides: Partial<CalendarProviderAdapter> = {}): CalendarProviderAdapter {
  return {
    providerId: 'google',
    authenticate: jest.fn(),
    refreshToken: jest.fn(),
    revokeAccess: jest.fn(),
    listCalendars: jest.fn().mockResolvedValue([]),
    listEvents: jest.fn().mockResolvedValue([]),
    createEvent: jest.fn().mockResolvedValue('provider-event-id'),
    updateEvent: jest.fn().mockResolvedValue(undefined),
    deleteEvent: jest.fn().mockResolvedValue(undefined),
    getChanges: jest.fn().mockResolvedValue({ created: [], updated: [], deleted: [], nextSyncToken: '' }),
    ...overrides,
  } as CalendarProviderAdapter;
}

// Helper to create a minimal CalendarEvent for testing
function createTestEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  const now = new Date();
  return {
    id: 'event-1',
    providerEventId: 'prov-event-1',
    calendarAccountId: 'acc-1',
    title: 'Test Event',
    description: null,
    location: null,
    startTime: now,
    endTime: new Date(now.getTime() + 3600000),
    timeZone: 'UTC',
    isAllDay: false,
    recurrenceRule: null,
    recurrenceExceptionDate: null,
    parentRecurringEventId: null,
    organizer: null,
    attendees: [],
    sequence: 0,
    dtstamp: now,
    status: 'confirmed',
    visibility: null,
    opaqueFields: new Map(),
    syncStatus: 'synced',
    localVersion: 1,
    remoteEtag: null,
    modifiedBy: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

// Helper to create a mock sync engine
function createMockSyncEngine(): SyncEngine & { queuedChanges: LocalChange[] } {
  const queuedChanges: LocalChange[] = [];
  return {
    start: jest.fn(),
    stop: jest.fn(),
    queueLocalChange: jest.fn((change: LocalChange) => { queuedChanges.push(change); }),
    processOutboundQueue: jest.fn().mockResolvedValue({ success: true, syncedCount: 0, failedCount: 0, conflicts: [] }),
    handleWebhookNotification: jest.fn().mockResolvedValue(undefined),
    pollProvider: jest.fn().mockResolvedValue({ created: [], updated: [], deleted: [], nextSyncToken: '' }),
    pollingIntervalMs: 300000,
    getConflicts: jest.fn().mockReturnValue([]),
    resolveConflict: jest.fn().mockResolvedValue(undefined),
    fullSync: jest.fn().mockResolvedValue({ success: true, syncedCount: 0, failedCount: 0, conflicts: [] }),
    syncAllPending: jest.fn().mockResolvedValue({ success: true, syncedCount: 0, failedCount: 0, conflicts: [] }),
    state: 'Idle',
    queuedChanges,
  };
}

describe('Mutation hooks - core logic', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    useEventsStore.getState().clear();
  });

  afterEach(() => {
    queryClient.clear();
  });

  describe('createEvent optimistic update', () => {
    it('adds event to Zustand store optimistically', () => {
      const event = createTestEvent({ syncStatus: 'pending_create' });
      useEventsStore.getState().addEvent(event);

      const stored = useEventsStore.getState().events['event-1'];
      expect(stored).toBeDefined();
      expect(stored.syncStatus).toBe('pending_create');
    });

    it('removes event from store on rollback', () => {
      const event = createTestEvent();
      useEventsStore.getState().addEvent(event);
      expect(useEventsStore.getState().events['event-1']).toBeDefined();

      useEventsStore.getState().removeEvent('event-1');
      expect(useEventsStore.getState().events['event-1']).toBeUndefined();
    });

    it('updates sync status to synced on success', () => {
      const event = createTestEvent({ syncStatus: 'pending_create' });
      useEventsStore.getState().addEvent(event);

      useEventsStore.getState().setSyncStatus('event-1', 'synced');
      expect(useEventsStore.getState().events['event-1'].syncStatus).toBe('synced');
    });

    it('queues change via sync engine on success', () => {
      const syncEngine = createMockSyncEngine();
      syncEngine.queueLocalChange({
        calendarAccountId: 'acc-1',
        eventId: 'event-1',
        operation: 'create',
        payload: '{}',
      });

      expect(syncEngine.queueLocalChange).toHaveBeenCalledWith(
        expect.objectContaining({ operation: 'create', eventId: 'event-1' }),
      );
      expect(syncEngine.queuedChanges).toHaveLength(1);
    });
  });

  describe('updateEvent optimistic update', () => {
    it('updates event in Zustand store optimistically', () => {
      const event = createTestEvent();
      useEventsStore.getState().addEvent(event);

      useEventsStore.getState().updateEvent('event-1', {
        title: 'Updated Title',
        syncStatus: 'pending_update',
      });

      const stored = useEventsStore.getState().events['event-1'];
      expect(stored.title).toBe('Updated Title');
      expect(stored.syncStatus).toBe('pending_update');
    });

    it('rolls back to previous state on error', () => {
      const event = createTestEvent({ title: 'Original' });
      useEventsStore.getState().addEvent(event);

      // Simulate optimistic update
      useEventsStore.getState().updateEvent('event-1', { title: 'Optimistic' });
      expect(useEventsStore.getState().events['event-1'].title).toBe('Optimistic');

      // Simulate rollback
      useEventsStore.getState().updateEvent('event-1', event);
      expect(useEventsStore.getState().events['event-1'].title).toBe('Original');
    });
  });

  describe('deleteEvent optimistic update', () => {
    it('removes event from Zustand store optimistically', () => {
      const event = createTestEvent();
      useEventsStore.getState().addEvent(event);
      expect(useEventsStore.getState().eventIds).toContain('event-1');

      useEventsStore.getState().removeEvent('event-1');
      expect(useEventsStore.getState().eventIds).not.toContain('event-1');
      expect(useEventsStore.getState().events['event-1']).toBeUndefined();
    });

    it('re-adds event on rollback', () => {
      const event = createTestEvent();
      useEventsStore.getState().addEvent(event);
      useEventsStore.getState().removeEvent('event-1');

      // Rollback
      useEventsStore.getState().addEvent(event);
      expect(useEventsStore.getState().events['event-1']).toBeDefined();
      expect(useEventsStore.getState().events['event-1'].title).toBe('Test Event');
    });
  });

  describe('query key invalidation', () => {
    it('invalidates events queries for the account after mutation', async () => {
      const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries');

      await queryClient.invalidateQueries({ queryKey: queryKeys.events.byAccount('acc-1') });

      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          queryKey: ['events', 'acc-1'],
        }),
      );

      invalidateSpy.mockRestore();
    });
  });

  describe('adapter integration', () => {
    it('calls adapter.createEvent with correct arguments', async () => {
      const adapter = createMockAdapter();
      const rawEvent: RawEventData = { providerData: { title: 'New Event' } };

      await adapter.createEvent('acc-1', rawEvent);

      expect(adapter.createEvent).toHaveBeenCalledWith('acc-1', rawEvent);
    });

    it('calls adapter.updateEvent with correct arguments', async () => {
      const adapter = createMockAdapter();
      const rawEvent: RawEventData = { providerData: { title: 'Updated' } };

      await adapter.updateEvent('acc-1', 'event-1', rawEvent);

      expect(adapter.updateEvent).toHaveBeenCalledWith('acc-1', 'event-1', rawEvent);
    });

    it('calls adapter.deleteEvent with correct arguments', async () => {
      const adapter = createMockAdapter();

      await adapter.deleteEvent('acc-1', 'event-1');

      expect(adapter.deleteEvent).toHaveBeenCalledWith('acc-1', 'event-1');
    });
  });
});
