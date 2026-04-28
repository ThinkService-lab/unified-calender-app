/**
 * Tests for events store.
 */

import { useEventsStore } from '../eventsStore';
import type { CalendarEvent } from '../../types/models';

function makeEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'evt-1',
    providerEventId: 'prov-1',
    calendarAccountId: 'acc-1',
    title: 'Meeting',
    description: null,
    location: null,
    startTime: new Date('2024-06-15T10:00:00Z'),
    endTime: new Date('2024-06-15T11:00:00Z'),
    timeZone: 'UTC',
    isAllDay: false,
    recurrenceRule: null,
    recurrenceExceptionDate: null,
    parentRecurringEventId: null,
    organizer: null,
    attendees: [],
    sequence: 0,
    dtstamp: new Date('2024-06-15T09:00:00Z'),
    status: 'confirmed',
    visibility: null,
    opaqueFields: new Map(),
    syncStatus: 'synced',
    localVersion: 1,
    remoteEtag: null,
    modifiedBy: null,
    createdAt: new Date('2024-06-15T09:00:00Z'),
    updatedAt: new Date('2024-06-15T09:00:00Z'),
    ...overrides,
  };
}

describe('EventsStore', () => {
  beforeEach(() => {
    useEventsStore.getState().clear();
  });

  test('starts with empty state', () => {
    const state = useEventsStore.getState();
    expect(state.eventIds).toEqual([]);
    expect(state.events).toEqual({});
  });

  test('addEvent adds a single event', () => {
    useEventsStore.getState().addEvent(makeEvent());

    const state = useEventsStore.getState();
    expect(state.eventIds).toEqual(['evt-1']);
    expect(state.events['evt-1'].title).toBe('Meeting');
  });

  test('addEvents adds multiple events', () => {
    useEventsStore.getState().addEvents([
      makeEvent({ id: 'e1' }),
      makeEvent({ id: 'e2', title: 'Lunch' }),
    ]);

    expect(useEventsStore.getState().eventIds).toHaveLength(2);
  });

  test('addEvent does not duplicate IDs', () => {
    useEventsStore.getState().addEvent(makeEvent());
    useEventsStore.getState().addEvent(makeEvent());

    expect(useEventsStore.getState().eventIds).toEqual(['evt-1']);
  });

  test('removeEvent removes an event', () => {
    useEventsStore.getState().addEvent(makeEvent());
    useEventsStore.getState().removeEvent('evt-1');

    expect(useEventsStore.getState().eventIds).toEqual([]);
    expect(useEventsStore.getState().events['evt-1']).toBeUndefined();
  });

  test('updateEvent updates fields', () => {
    useEventsStore.getState().addEvent(makeEvent());
    useEventsStore.getState().updateEvent('evt-1', { title: 'Updated Meeting' });

    expect(useEventsStore.getState().events['evt-1'].title).toBe('Updated Meeting');
  });

  test('setSyncStatus updates sync status', () => {
    useEventsStore.getState().addEvent(makeEvent());
    useEventsStore.getState().setSyncStatus('evt-1', 'pending_update');

    expect(useEventsStore.getState().events['evt-1'].syncStatus).toBe('pending_update');
  });

  test('removeEventsByAccount removes all events for an account', () => {
    useEventsStore.getState().addEvents([
      makeEvent({ id: 'e1', calendarAccountId: 'acc-1' }),
      makeEvent({ id: 'e2', calendarAccountId: 'acc-2' }),
      makeEvent({ id: 'e3', calendarAccountId: 'acc-1' }),
    ]);

    useEventsStore.getState().removeEventsByAccount('acc-1');

    const state = useEventsStore.getState();
    expect(state.eventIds).toEqual(['e2']);
    expect(state.events['e1']).toBeUndefined();
    expect(state.events['e3']).toBeUndefined();
  });

  test('getEventsByTimeRange returns overlapping events', () => {
    useEventsStore.getState().addEvents([
      makeEvent({
        id: 'e1',
        startTime: new Date('2024-06-15T10:00:00Z'),
        endTime: new Date('2024-06-15T11:00:00Z'),
      }),
      makeEvent({
        id: 'e2',
        startTime: new Date('2024-06-15T14:00:00Z'),
        endTime: new Date('2024-06-15T15:00:00Z'),
      }),
      makeEvent({
        id: 'e3',
        startTime: new Date('2024-06-16T10:00:00Z'),
        endTime: new Date('2024-06-16T11:00:00Z'),
      }),
    ]);

    const results = useEventsStore.getState().getEventsByTimeRange(
      new Date('2024-06-15T09:00:00Z'),
      new Date('2024-06-15T12:00:00Z')
    );

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('e1');
  });

  test('getEventsByTimeRange returns events that partially overlap', () => {
    useEventsStore.getState().addEvent(
      makeEvent({
        id: 'e1',
        startTime: new Date('2024-06-15T08:00:00Z'),
        endTime: new Date('2024-06-15T10:30:00Z'),
      })
    );

    const results = useEventsStore.getState().getEventsByTimeRange(
      new Date('2024-06-15T10:00:00Z'),
      new Date('2024-06-15T12:00:00Z')
    );

    expect(results).toHaveLength(1);
  });

  test('getEventsByAccount filters by account', () => {
    useEventsStore.getState().addEvents([
      makeEvent({ id: 'e1', calendarAccountId: 'acc-1' }),
      makeEvent({ id: 'e2', calendarAccountId: 'acc-2' }),
    ]);

    const results = useEventsStore.getState().getEventsByAccount('acc-1');
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('e1');
  });

  test('getEventsBySyncStatus filters by sync status', () => {
    useEventsStore.getState().addEvents([
      makeEvent({ id: 'e1', syncStatus: 'synced' }),
      makeEvent({ id: 'e2', syncStatus: 'pending_create' }),
      makeEvent({ id: 'e3', syncStatus: 'pending_update' }),
    ]);

    const pending = useEventsStore.getState().getEventsBySyncStatus('pending_create');
    expect(pending).toHaveLength(1);
    expect(pending[0].id).toBe('e2');
  });

  test('getPendingEvents returns all pending events', () => {
    useEventsStore.getState().addEvents([
      makeEvent({ id: 'e1', syncStatus: 'synced' }),
      makeEvent({ id: 'e2', syncStatus: 'pending_create' }),
      makeEvent({ id: 'e3', syncStatus: 'pending_update' }),
      makeEvent({ id: 'e4', syncStatus: 'pending_delete' }),
      makeEvent({ id: 'e5', syncStatus: 'conflict' }),
    ]);

    const pending = useEventsStore.getState().getPendingEvents();
    expect(pending).toHaveLength(3);
    expect(pending.map((e) => e.id).sort()).toEqual(['e2', 'e3', 'e4']);
  });

  test('clear resets to initial state', () => {
    useEventsStore.getState().addEvent(makeEvent());
    useEventsStore.getState().clear();

    expect(useEventsStore.getState().eventIds).toEqual([]);
    expect(useEventsStore.getState().events).toEqual({});
  });
});
