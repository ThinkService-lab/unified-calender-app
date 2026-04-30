/**
 * Unit tests for calendarViewModel – event filtering, grouping, date helpers.
 * Requirements: 2.1, 2.2, 2.4, 2.6
 */

import type { CalendarEvent } from '../../../types/models';
import {
  startOfDay,
  endOfDay,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  getMonthGridDates,
  getWeekDates,
  isSameDay,
  formatTime,
  formatShortDate,
  formatMonthYear,
  filterVisibleEvents,
  filterEventsByTimeRange,
  getEventsForDay,
  getDateRangeForViewMode,
  groupEventsByDay,
  buildMonthGridData,
  sortEventsByTime,
} from '../calendarViewModel';

/* ------------------------------------------------------------------ */
/*  Test helpers                                                       */
/* ------------------------------------------------------------------ */

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
/*  Date helpers                                                       */
/* ------------------------------------------------------------------ */

describe('Date helpers', () => {
  test('startOfDay returns midnight', () => {
    const d = new Date('2025-06-15T14:30:00');
    const result = startOfDay(d);
    expect(result.getHours()).toBe(0);
    expect(result.getMinutes()).toBe(0);
    expect(result.getSeconds()).toBe(0);
    expect(result.getMilliseconds()).toBe(0);
    expect(result.getDate()).toBe(15);
  });

  test('endOfDay returns 23:59:59.999', () => {
    const d = new Date('2025-06-15T14:30:00');
    const result = endOfDay(d);
    expect(result.getHours()).toBe(23);
    expect(result.getMinutes()).toBe(59);
    expect(result.getSeconds()).toBe(59);
    expect(result.getMilliseconds()).toBe(999);
  });

  test('startOfWeek returns Sunday', () => {
    // June 18, 2025 is a Wednesday
    const d = new Date(2025, 5, 18);
    const result = startOfWeek(d);
    expect(result.getDay()).toBe(0); // Sunday
    expect(result.getDate()).toBe(15);
  });

  test('endOfWeek returns Saturday', () => {
    const d = new Date(2025, 5, 18);
    const result = endOfWeek(d);
    expect(result.getDay()).toBe(6); // Saturday
    expect(result.getDate()).toBe(21);
  });

  test('startOfMonth returns first day', () => {
    const d = new Date(2025, 5, 15);
    const result = startOfMonth(d);
    expect(result.getDate()).toBe(1);
    expect(result.getMonth()).toBe(5);
  });

  test('endOfMonth returns last day', () => {
    const d = new Date(2025, 5, 15); // June
    const result = endOfMonth(d);
    expect(result.getDate()).toBe(30); // June has 30 days
  });

  test('getMonthGridDates returns 42 dates (6 weeks)', () => {
    const d = new Date(2025, 5, 1); // June 2025
    const dates = getMonthGridDates(d);
    expect(dates).toHaveLength(42);
    // First date should be a Sunday
    expect(dates[0].getDay()).toBe(0);
  });

  test('getWeekDates returns 7 dates starting from Sunday', () => {
    const d = new Date(2025, 5, 18); // Wednesday
    const dates = getWeekDates(d);
    expect(dates).toHaveLength(7);
    expect(dates[0].getDay()).toBe(0); // Sunday
    expect(dates[6].getDay()).toBe(6); // Saturday
  });

  test('isSameDay correctly compares dates', () => {
    const a = new Date(2025, 5, 15, 10, 0);
    const b = new Date(2025, 5, 15, 22, 30);
    const c = new Date(2025, 5, 16, 10, 0);
    expect(isSameDay(a, b)).toBe(true);
    expect(isSameDay(a, c)).toBe(false);
  });

  test('formatTime formats as HH:MM', () => {
    expect(formatTime(new Date(2025, 0, 1, 9, 5))).toBe('09:05');
    expect(formatTime(new Date(2025, 0, 1, 14, 30))).toBe('14:30');
    expect(formatTime(new Date(2025, 0, 1, 0, 0))).toBe('00:00');
  });

  test('formatShortDate returns day name and date', () => {
    // June 15, 2025 is a Sunday
    const d = new Date(2025, 5, 15);
    expect(formatShortDate(d)).toBe('Sun 15');
  });

  test('formatMonthYear returns month and year', () => {
    const d = new Date(2025, 5, 15);
    expect(formatMonthYear(d)).toBe('June 2025');
  });
});

/* ------------------------------------------------------------------ */
/*  Visibility filtering                                               */
/* ------------------------------------------------------------------ */

describe('filterVisibleEvents', () => {
  const events = [
    makeEvent({ id: 'e1', calendarAccountId: 'acc-1' }),
    makeEvent({ id: 'e2', calendarAccountId: 'acc-2' }),
    makeEvent({ id: 'e3', calendarAccountId: 'acc-1' }),
    makeEvent({ id: 'e4', calendarAccountId: 'acc-3' }),
  ];

  test('returns all events when no accounts are hidden', () => {
    const result = filterVisibleEvents(events, new Set());
    expect(result).toHaveLength(4);
  });

  test('filters out events from hidden accounts', () => {
    const result = filterVisibleEvents(events, new Set(['acc-1']));
    expect(result).toHaveLength(2);
    expect(result.every((e) => e.calendarAccountId !== 'acc-1')).toBe(true);
  });

  test('filters out multiple hidden accounts', () => {
    const result = filterVisibleEvents(events, new Set(['acc-1', 'acc-3']));
    expect(result).toHaveLength(1);
    expect(result[0].calendarAccountId).toBe('acc-2');
  });

  test('returns empty array when all accounts are hidden', () => {
    const result = filterVisibleEvents(events, new Set(['acc-1', 'acc-2', 'acc-3']));
    expect(result).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/*  Time-range filtering                                               */
/* ------------------------------------------------------------------ */

describe('filterEventsByTimeRange', () => {
  const events = [
    makeEvent({
      id: 'e1',
      startTime: new Date('2025-06-15T08:00:00Z'),
      endTime: new Date('2025-06-15T09:00:00Z'),
    }),
    makeEvent({
      id: 'e2',
      startTime: new Date('2025-06-15T10:00:00Z'),
      endTime: new Date('2025-06-15T11:00:00Z'),
    }),
    makeEvent({
      id: 'e3',
      startTime: new Date('2025-06-16T10:00:00Z'),
      endTime: new Date('2025-06-16T11:00:00Z'),
    }),
  ];

  test('returns events within range', () => {
    const result = filterEventsByTimeRange(
      events,
      new Date('2025-06-15T00:00:00Z'),
      new Date('2025-06-15T23:59:59Z')
    );
    expect(result).toHaveLength(2);
  });

  test('returns empty for range with no events', () => {
    const result = filterEventsByTimeRange(
      events,
      new Date('2025-06-17T00:00:00Z'),
      new Date('2025-06-17T23:59:59Z')
    );
    expect(result).toHaveLength(0);
  });

  test('includes events that partially overlap the range', () => {
    const result = filterEventsByTimeRange(
      events,
      new Date('2025-06-15T08:30:00Z'),
      new Date('2025-06-15T10:30:00Z')
    );
    // e1 ends at 09:00 > 08:30 start, and e2 starts at 10:00 < 10:30 end
    expect(result).toHaveLength(2);
  });
});

/* ------------------------------------------------------------------ */
/*  getDateRangeForViewMode                                            */
/* ------------------------------------------------------------------ */

describe('getDateRangeForViewMode', () => {
  const anchor = new Date(2025, 5, 15, 12, 0); // June 15, 2025

  test('day mode returns single day range', () => {
    const range = getDateRangeForViewMode('day', anchor);
    expect(range.start.getDate()).toBe(15);
    expect(range.end.getDate()).toBe(15);
    expect(range.start.getHours()).toBe(0);
    expect(range.end.getHours()).toBe(23);
  });

  test('week mode returns 7-day range', () => {
    const range = getDateRangeForViewMode('week', anchor);
    expect(range.start.getDay()).toBe(0); // Sunday
    expect(range.end.getDay()).toBe(6); // Saturday
  });

  test('month mode returns full month range', () => {
    const range = getDateRangeForViewMode('month', anchor);
    expect(range.start.getDate()).toBe(1);
    expect(range.end.getDate()).toBe(30); // June has 30 days
  });

  test('agenda mode returns approximately 30-day range', () => {
    const range = getDateRangeForViewMode('agenda', anchor);
    const diffMs = range.end.getTime() - range.start.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    // 30 days from start-of-day to end-of-day+30 ≈ 31 days
    expect(diffDays).toBeGreaterThanOrEqual(30);
    expect(diffDays).toBeLessThanOrEqual(31);
  });
});

/* ------------------------------------------------------------------ */
/*  groupEventsByDay                                                   */
/* ------------------------------------------------------------------ */

describe('groupEventsByDay', () => {
  test('groups events by their start date', () => {
    const events = [
      makeEvent({ id: 'e1', startTime: new Date(2025, 5, 15, 10, 0) }),
      makeEvent({ id: 'e2', startTime: new Date(2025, 5, 15, 14, 0) }),
      makeEvent({ id: 'e3', startTime: new Date(2025, 5, 16, 9, 0) }),
    ];
    const groups = groupEventsByDay(events);
    expect(groups).toHaveLength(2);
    expect(groups[0].events).toHaveLength(2);
    expect(groups[1].events).toHaveLength(1);
  });

  test('sorts groups by date ascending', () => {
    const events = [
      makeEvent({ id: 'e1', startTime: new Date(2025, 5, 17, 10, 0) }),
      makeEvent({ id: 'e2', startTime: new Date(2025, 5, 15, 10, 0) }),
    ];
    const groups = groupEventsByDay(events);
    expect(groups[0].date.getDate()).toBe(15);
    expect(groups[1].date.getDate()).toBe(17);
  });

  test('sorts events within a group by start time', () => {
    const events = [
      makeEvent({ id: 'e1', startTime: new Date(2025, 5, 15, 14, 0) }),
      makeEvent({ id: 'e2', startTime: new Date(2025, 5, 15, 9, 0) }),
    ];
    const groups = groupEventsByDay(events);
    expect(groups[0].events[0].id).toBe('e2');
    expect(groups[0].events[1].id).toBe('e1');
  });

  test('returns empty array for no events', () => {
    expect(groupEventsByDay([])).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/*  buildMonthGridData                                                 */
/* ------------------------------------------------------------------ */

describe('buildMonthGridData', () => {
  test('returns 42 day cells', () => {
    const data = buildMonthGridData(new Date(2025, 5, 1), []);
    expect(data).toHaveLength(42);
  });

  test('marks current month days correctly', () => {
    const data = buildMonthGridData(new Date(2025, 5, 1), []);
    const juneDays = data.filter((d) => d.isCurrentMonth);
    expect(juneDays.length).toBe(30); // June has 30 days
  });

  test('assigns events to correct days', () => {
    const events = [
      makeEvent({ id: 'e1', startTime: new Date(2025, 5, 15, 10, 0), endTime: new Date(2025, 5, 15, 11, 0) }),
    ];
    const data = buildMonthGridData(new Date(2025, 5, 1), events);
    const june15 = data.find((d) => d.isCurrentMonth && d.date.getDate() === 15);
    expect(june15?.events).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------ */
/*  sortEventsByTime                                                   */
/* ------------------------------------------------------------------ */

describe('sortEventsByTime', () => {
  test('sorts events by start time ascending', () => {
    const events = [
      makeEvent({ id: 'e1', startTime: new Date('2025-06-15T14:00:00Z') }),
      makeEvent({ id: 'e2', startTime: new Date('2025-06-15T09:00:00Z') }),
      makeEvent({ id: 'e3', startTime: new Date('2025-06-15T11:00:00Z') }),
    ];
    const sorted = sortEventsByTime(events);
    expect(sorted[0].id).toBe('e2');
    expect(sorted[1].id).toBe('e3');
    expect(sorted[2].id).toBe('e1');
  });

  test('does not mutate original array', () => {
    const events = [
      makeEvent({ id: 'e1', startTime: new Date('2025-06-15T14:00:00Z') }),
      makeEvent({ id: 'e2', startTime: new Date('2025-06-15T09:00:00Z') }),
    ];
    const sorted = sortEventsByTime(events);
    expect(sorted).not.toBe(events);
    expect(events[0].id).toBe('e1'); // original unchanged
  });
});
