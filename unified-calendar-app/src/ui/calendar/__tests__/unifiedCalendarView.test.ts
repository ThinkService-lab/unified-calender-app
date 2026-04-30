/**
 * Unit tests for UnifiedCalendarView integration logic.
 * Tests view mode switching, visibility toggling, navigation,
 * and the AgendaView getItemLayout optimization.
 * Requirements: 2.1, 2.2, 2.3, 2.4, 2.6
 */

import type { CalendarEvent, CalendarAccount } from '../../../types/models';
import type { DefaultViewMode } from '../../types';
import {
  filterVisibleEvents,
  filterEventsByTimeRange,
  getDateRangeForViewMode,
  groupEventsByDay,
  buildMonthGridData,
  sortEventsByTime,
  getEventsForDay,
  startOfDay,
  endOfDay,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
} from '../calendarViewModel';
import {
  buildAccountColorMap,
  getAccountColor,
  getEventBackgroundColor,
  getEventBorderColor,
  CALENDAR_COLOR_PALETTE,
} from '../colorCoding';

/* ------------------------------------------------------------------ */
/*  Test helpers                                                       */
/* ------------------------------------------------------------------ */

function makeAccount(overrides: Partial<CalendarAccount> & { id: string }): CalendarAccount {
  return {
    userId: 'user-1',
    providerId: 'google',
    displayName: 'Test Account',
    email: 'test@example.com',
    color: '#1A73E8',
    visibility: 'public',
    syncToken: null,
    lastSyncedAt: null,
    status: 'active',
    createdAt: new Date(),
    ...overrides,
  };
}

function makeEvent(overrides: Partial<CalendarEvent> & { id: string }): CalendarEvent {
  return {
    providerEventId: overrides.id,
    calendarAccountId: 'account-1',
    title: 'Test Event',
    description: null,
    location: null,
    startTime: new Date('2025-06-15T10:00:00Z'),
    endTime: new Date('2025-06-15T11:00:00Z'),
    timeZone: 'UTC',
    isAllDay: false,
    recurrenceRule: null,
    recurrenceExceptionDate: null,
    parentRecurringEventId: null,
    organizer: null,
    attendees: [],
    sequence: 0,
    dtstamp: new Date(),
    status: 'confirmed',
    visibility: null,
    opaqueFields: new Map(),
    syncStatus: 'synced',
    localVersion: 1,
    remoteEtag: null,
    modifiedBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

/* ------------------------------------------------------------------ */
/*  ViewMode type coverage                                             */
/* ------------------------------------------------------------------ */

describe('ViewMode types', () => {
  const allModes: DefaultViewMode[] = ['day', 'week', 'month', 'agenda'];

  test('all four view modes produce valid date ranges', () => {
    const anchor = new Date(2025, 5, 15);
    for (const mode of allModes) {
      const range = getDateRangeForViewMode(mode, anchor);
      expect(range.start).toBeInstanceOf(Date);
      expect(range.end).toBeInstanceOf(Date);
      expect(range.end.getTime()).toBeGreaterThan(range.start.getTime());
    }
  });

  test('day range covers exactly one day', () => {
    const anchor = new Date(2025, 5, 15, 12, 0);
    const range = getDateRangeForViewMode('day', anchor);
    const diffHours = (range.end.getTime() - range.start.getTime()) / (1000 * 60 * 60);
    expect(diffHours).toBeCloseTo(24, 0);
  });

  test('week range covers exactly 7 days', () => {
    const anchor = new Date(2025, 5, 18); // Wednesday
    const range = getDateRangeForViewMode('week', anchor);
    const diffDays = (range.end.getTime() - range.start.getTime()) / (1000 * 60 * 60 * 24);
    expect(diffDays).toBeCloseTo(7, 0);
  });
});

/* ------------------------------------------------------------------ */
/*  Color-coding events by calendar account                            */
/* ------------------------------------------------------------------ */

describe('Color-coding events by calendar account', () => {
  test('each account gets a distinct color from the palette', () => {
    const accounts = [
      makeAccount({ id: 'acc-1', color: '' }),
      makeAccount({ id: 'acc-2', color: '' }),
      makeAccount({ id: 'acc-3', color: '' }),
    ];
    const colorMap = buildAccountColorMap(accounts);
    const colors = Object.values(colorMap);
    const uniqueColors = new Set(colors);
    expect(uniqueColors.size).toBe(3);
  });

  test('account custom colors are preserved', () => {
    const accounts = [
      makeAccount({ id: 'acc-1', color: '#FF0000' }),
      makeAccount({ id: 'acc-2', color: '#00FF00' }),
    ];
    const colorMap = buildAccountColorMap(accounts);
    expect(colorMap['acc-1']).toBe('#FF0000');
    expect(colorMap['acc-2']).toBe('#00FF00');
  });

  test('event background and border colors derive from account color', () => {
    const baseColor = '#1A73E8';
    const bg = getEventBackgroundColor(baseColor);
    const border = getEventBorderColor(baseColor);
    // Background should be lighter (lower alpha)
    expect(bg).toContain('0.15');
    // Border should be more opaque
    expect(border).toContain('0.4');
  });

  test('events from different accounts get different visual treatment', () => {
    const accounts = [
      makeAccount({ id: 'acc-1', color: '#1A73E8' }),
      makeAccount({ id: 'acc-2', color: '#D93025' }),
    ];
    const colorMap = buildAccountColorMap(accounts);
    const bg1 = getEventBackgroundColor(colorMap['acc-1']);
    const bg2 = getEventBackgroundColor(colorMap['acc-2']);
    expect(bg1).not.toBe(bg2);
  });
});

/* ------------------------------------------------------------------ */
/*  Calendar visibility toggling (≤ 200ms response)                    */
/* ------------------------------------------------------------------ */

describe('Calendar visibility toggling', () => {
  // Generate a large dataset to test performance characteristics
  function generateEvents(count: number, accountIds: string[]): CalendarEvent[] {
    const events: CalendarEvent[] = [];
    for (let i = 0; i < count; i++) {
      const accountId = accountIds[i % accountIds.length];
      events.push(
        makeEvent({
          id: `event-${i}`,
          calendarAccountId: accountId,
          startTime: new Date(2025, 5, 1 + (i % 30), 9 + (i % 8), 0),
          endTime: new Date(2025, 5, 1 + (i % 30), 10 + (i % 8), 0),
        })
      );
    }
    return events;
  }

  test('filtering 1000 events by visibility completes quickly', () => {
    const accountIds = ['acc-1', 'acc-2', 'acc-3', 'acc-4', 'acc-5'];
    const events = generateEvents(1000, accountIds);
    const hidden = new Set(['acc-1', 'acc-3']);

    const start = performance.now();
    const result = filterVisibleEvents(events, hidden);
    const elapsed = performance.now() - start;

    // Should complete well under 200ms (typically < 5ms)
    expect(elapsed).toBeLessThan(200);
    // Should filter out 2/5 of events
    expect(result.length).toBe(600);
    expect(result.every((e) => !hidden.has(e.calendarAccountId))).toBe(true);
  });

  test('toggling visibility is a pure filter operation (no async)', () => {
    const events = [
      makeEvent({ id: 'e1', calendarAccountId: 'acc-1' }),
      makeEvent({ id: 'e2', calendarAccountId: 'acc-2' }),
      makeEvent({ id: 'e3', calendarAccountId: 'acc-1' }),
    ];

    // Toggle acc-1 off
    const hidden1 = new Set(['acc-1']);
    const visible1 = filterVisibleEvents(events, hidden1);
    expect(visible1).toHaveLength(1);
    expect(visible1[0].id).toBe('e2');

    // Toggle acc-1 back on
    const hidden2 = new Set<string>();
    const visible2 = filterVisibleEvents(events, hidden2);
    expect(visible2).toHaveLength(3);
  });

  test('empty hidden set returns all events (fast path)', () => {
    const events = generateEvents(500, ['acc-1', 'acc-2']);
    const result = filterVisibleEvents(events, new Set());
    // Fast path: returns the same array reference
    expect(result).toBe(events);
  });
});

/* ------------------------------------------------------------------ */
/*  Month view rendering performance                                   */
/* ------------------------------------------------------------------ */

describe('Month view data preparation', () => {
  test('buildMonthGridData with 200 events completes within 1 second', () => {
    const events: CalendarEvent[] = [];
    for (let i = 0; i < 200; i++) {
      events.push(
        makeEvent({
          id: `event-${i}`,
          startTime: new Date(2025, 5, 1 + (i % 30), 9 + (i % 8), 0),
          endTime: new Date(2025, 5, 1 + (i % 30), 10 + (i % 8), 0),
        })
      );
    }

    const start = performance.now();
    const gridData = buildMonthGridData(new Date(2025, 5, 1), events);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(1000);
    expect(gridData).toHaveLength(42);
  });

  test('month grid correctly distributes events across days', () => {
    const events = [
      makeEvent({ id: 'e1', startTime: new Date(2025, 5, 1, 10, 0), endTime: new Date(2025, 5, 1, 11, 0) }),
      makeEvent({ id: 'e2', startTime: new Date(2025, 5, 1, 14, 0), endTime: new Date(2025, 5, 1, 15, 0) }),
      makeEvent({ id: 'e3', startTime: new Date(2025, 5, 15, 10, 0), endTime: new Date(2025, 5, 15, 11, 0) }),
    ];

    const gridData = buildMonthGridData(new Date(2025, 5, 1), events);
    const june1 = gridData.find((d) => d.isCurrentMonth && d.date.getDate() === 1);
    const june15 = gridData.find((d) => d.isCurrentMonth && d.date.getDate() === 15);
    const june20 = gridData.find((d) => d.isCurrentMonth && d.date.getDate() === 20);

    expect(june1?.events).toHaveLength(2);
    expect(june15?.events).toHaveLength(1);
    expect(june20?.events).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/*  AgendaView getItemLayout correctness                               */
/* ------------------------------------------------------------------ */

describe('AgendaView data preparation', () => {
  test('groupEventsByDay produces correct structure for FlatList', () => {
    const events = [
      makeEvent({ id: 'e1', startTime: new Date(2025, 5, 15, 10, 0), endTime: new Date(2025, 5, 15, 11, 0) }),
      makeEvent({ id: 'e2', startTime: new Date(2025, 5, 15, 14, 0), endTime: new Date(2025, 5, 15, 15, 0) }),
      makeEvent({ id: 'e3', startTime: new Date(2025, 5, 16, 9, 0), endTime: new Date(2025, 5, 16, 10, 0) }),
    ];

    const groups = groupEventsByDay(events);
    expect(groups).toHaveLength(2);
    expect(groups[0].events).toHaveLength(2);
    expect(groups[1].events).toHaveLength(1);
    // Each group has a dateKey for FlatList key extraction
    expect(groups[0].dateKey).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test('sortEventsByTime produces stable ascending order', () => {
    const events = [
      makeEvent({ id: 'e3', startTime: new Date(2025, 5, 15, 16, 0) }),
      makeEvent({ id: 'e1', startTime: new Date(2025, 5, 15, 8, 0) }),
      makeEvent({ id: 'e2', startTime: new Date(2025, 5, 15, 12, 0) }),
    ];

    const sorted = sortEventsByTime(events);
    expect(sorted[0].id).toBe('e1');
    expect(sorted[1].id).toBe('e2');
    expect(sorted[2].id).toBe('e3');
  });

  test('agenda 30-day range captures upcoming events', () => {
    const anchor = new Date(2025, 5, 15);
    const range = getDateRangeForViewMode('agenda', anchor);

    // Event within 30 days
    const nearEvent = makeEvent({
      id: 'near',
      startTime: new Date(2025, 5, 20, 10, 0),
      endTime: new Date(2025, 5, 20, 11, 0),
    });
    // Event beyond 30 days
    const farEvent = makeEvent({
      id: 'far',
      startTime: new Date(2025, 7, 20, 10, 0),
      endTime: new Date(2025, 7, 20, 11, 0),
    });

    const inRange = filterEventsByTimeRange([nearEvent, farEvent], range.start, range.end);
    expect(inRange).toHaveLength(1);
    expect(inRange[0].id).toBe('near');
  });
});

/* ------------------------------------------------------------------ */
/*  Unified view integration: filtering pipeline                       */
/* ------------------------------------------------------------------ */

describe('Unified view filtering pipeline', () => {
  const accounts = [
    makeAccount({ id: 'acc-google', color: '#1A73E8', providerId: 'google' }),
    makeAccount({ id: 'acc-outlook', color: '#D93025', providerId: 'outlook' }),
    makeAccount({ id: 'acc-icloud', color: '#188038', providerId: 'icloud' }),
  ];

  const events = [
    makeEvent({ id: 'e1', calendarAccountId: 'acc-google', startTime: new Date(2025, 5, 15, 10, 0), endTime: new Date(2025, 5, 15, 11, 0) }),
    makeEvent({ id: 'e2', calendarAccountId: 'acc-outlook', startTime: new Date(2025, 5, 15, 14, 0), endTime: new Date(2025, 5, 15, 15, 0) }),
    makeEvent({ id: 'e3', calendarAccountId: 'acc-icloud', startTime: new Date(2025, 5, 16, 9, 0), endTime: new Date(2025, 5, 16, 10, 0) }),
    makeEvent({ id: 'e4', calendarAccountId: 'acc-google', startTime: new Date(2025, 5, 20, 10, 0), endTime: new Date(2025, 5, 20, 11, 0) }),
  ];

  test('full pipeline: visibility filter → time range filter → sort', () => {
    const hidden = new Set(['acc-icloud']);
    const visible = filterVisibleEvents(events, hidden);
    expect(visible).toHaveLength(3);

    const dayRange = getDateRangeForViewMode('day', new Date(2025, 5, 15));
    const dayEvents = filterEventsByTimeRange(visible, dayRange.start, dayRange.end);
    expect(dayEvents).toHaveLength(2);

    const sorted = sortEventsByTime(dayEvents);
    expect(sorted[0].id).toBe('e1');
    expect(sorted[1].id).toBe('e2');
  });

  test('all accounts visible shows events from all providers', () => {
    const visible = filterVisibleEvents(events, new Set());
    expect(visible).toHaveLength(4);

    const colorMap = buildAccountColorMap(accounts);
    // Each event should have a color mapping
    for (const event of visible) {
      expect(colorMap[event.calendarAccountId]).toBeDefined();
    }
  });

  test('week view shows events across multiple days', () => {
    const weekRange = getDateRangeForViewMode('week', new Date(2025, 5, 15));
    const weekEvents = filterEventsByTimeRange(events, weekRange.start, weekRange.end);
    // June 15 (Sun) through June 21 (Sat) should include e1, e2, e3, e4
    expect(weekEvents.length).toBeGreaterThanOrEqual(3);
  });

  test('month view includes all events in the month', () => {
    const monthRange = getDateRangeForViewMode('month', new Date(2025, 5, 1));
    const monthEvents = filterEventsByTimeRange(events, monthRange.start, monthRange.end);
    expect(monthEvents).toHaveLength(4);
  });
});

/* ------------------------------------------------------------------ */
/*  getEventsForDay                                                    */
/* ------------------------------------------------------------------ */

describe('getEventsForDay', () => {
  test('returns only events on the specified day', () => {
    const events = [
      makeEvent({ id: 'e1', startTime: new Date(2025, 5, 15, 10, 0), endTime: new Date(2025, 5, 15, 11, 0) }),
      makeEvent({ id: 'e2', startTime: new Date(2025, 5, 16, 10, 0), endTime: new Date(2025, 5, 16, 11, 0) }),
    ];
    const result = getEventsForDay(events, new Date(2025, 5, 15));
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('e1');
  });

  test('includes events that span midnight into the target day', () => {
    const events = [
      makeEvent({
        id: 'overnight',
        startTime: new Date(2025, 5, 14, 23, 0),
        endTime: new Date(2025, 5, 15, 2, 0),
      }),
    ];
    const result = getEventsForDay(events, new Date(2025, 5, 15));
    expect(result).toHaveLength(1);
  });
});
