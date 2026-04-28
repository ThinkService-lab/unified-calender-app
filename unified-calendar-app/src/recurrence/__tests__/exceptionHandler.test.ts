/**
 * Unit tests for recurring event exception handling.
 * Requirements: 3.5
 *
 * Covers gaps:
 * - Gap #7: createRecurrenceException no longer mutates parent
 * - Gap #8: getEffectiveOccurrences injects exceptions excluded by EXDATE
 * - Gap #9: Multiple exceptions on same parent
 */

import { createRecurrenceException, getEffectiveOccurrences } from '../exceptionHandler';
import type { CalendarEvent, RecurrenceRule } from '../../types/models';
import type { DateRange } from '../expandRecurrenceRule';

function makeRecurrenceRule(overrides: Partial<RecurrenceRule> = {}): RecurrenceRule {
  return {
    frequency: 'weekly',
    interval: 1,
    count: null,
    until: null,
    bySecond: null,
    byMinute: null,
    byHour: null,
    byDay: null,
    byMonthDay: null,
    byYearDay: null,
    byWeekNo: null,
    byMonth: null,
    bySetPos: null,
    wkst: 'MO',
    exceptions: [],
    ...overrides,
  };
}

function makeParentEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'parent-event-1',
    providerEventId: 'provider-123',
    calendarAccountId: 'account-1',
    title: 'Weekly Standup',
    description: 'Team standup meeting',
    location: 'Room A',
    startTime: new Date('2025-01-06T09:00:00Z'), // Monday
    endTime: new Date('2025-01-06T09:30:00Z'),
    timeZone: 'UTC',
    isAllDay: false,
    recurrenceRule: makeRecurrenceRule(),
    recurrenceExceptionDate: null,
    parentRecurringEventId: null,
    organizer: { email: 'organizer@example.com', displayName: 'Organizer', sentBy: null },
    attendees: [{ email: 'attendee@example.com', displayName: 'Attendee', status: 'accepted', role: 'required' }],
    sequence: 0,
    dtstamp: new Date('2025-01-01T00:00:00Z'),
    status: 'confirmed',
    visibility: null,
    opaqueFields: new Map(),
    syncStatus: 'synced',
    localVersion: 1,
    remoteEtag: null,
    modifiedBy: null,
    createdAt: new Date('2025-01-01T00:00:00Z'),
    updatedAt: new Date('2025-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('createRecurrenceException', () => {
  it('creates an exception event with a new unique ID', () => {
    const parent = makeParentEvent();
    const exceptionDate = new Date('2025-01-13T09:00:00Z');

    const { exceptionEvent } = createRecurrenceException(parent, exceptionDate, { title: 'Modified Standup' });

    expect(exceptionEvent.id).not.toBe(parent.id);
    expect(exceptionEvent.id.length).toBeGreaterThan(0);
  });

  it('sets parentRecurringEventId to the parent event ID', () => {
    const parent = makeParentEvent();
    const exceptionDate = new Date('2025-01-13T09:00:00Z');

    const { exceptionEvent } = createRecurrenceException(parent, exceptionDate, {});

    expect(exceptionEvent.parentRecurringEventId).toBe('parent-event-1');
  });

  it('sets recurrenceExceptionDate to the overridden date', () => {
    const parent = makeParentEvent();
    const exceptionDate = new Date('2025-01-13T09:00:00Z');

    const { exceptionEvent } = createRecurrenceException(parent, exceptionDate, {});

    expect(exceptionEvent.recurrenceExceptionDate).toEqual(exceptionDate);
  });

  it('sets recurrenceRule to null', () => {
    const parent = makeParentEvent();
    const exceptionDate = new Date('2025-01-13T09:00:00Z');

    const { exceptionEvent } = createRecurrenceException(parent, exceptionDate, {});

    expect(exceptionEvent.recurrenceRule).toBeNull();
  });

  it('copies fields from parent and applies modifications', () => {
    const parent = makeParentEvent();
    const exceptionDate = new Date('2025-01-13T09:00:00Z');

    const { exceptionEvent } = createRecurrenceException(parent, exceptionDate, {
      title: 'Special Standup',
      location: 'Room B',
    });

    expect(exceptionEvent.title).toBe('Special Standup');
    expect(exceptionEvent.location).toBe('Room B');
    expect(exceptionEvent.description).toBe('Team standup meeting');
    expect(exceptionEvent.calendarAccountId).toBe('account-1');
  });

  // Gap #7: Does NOT mutate parent
  it('does NOT mutate the parent event (Gap #7)', () => {
    const parent = makeParentEvent();
    const originalExceptions = [...parent.recurrenceRule!.exceptions];
    const exceptionDate = new Date('2025-01-13T09:00:00Z');

    const { updatedExceptions } = createRecurrenceException(parent, exceptionDate, {});

    // Parent's exceptions array should be unchanged
    expect(parent.recurrenceRule!.exceptions).toEqual(originalExceptions);
    // The returned updatedExceptions should contain the new date
    expect(updatedExceptions).toContainEqual(exceptionDate);
    expect(updatedExceptions.length).toBe(originalExceptions.length + 1);
  });

  it('returns updatedExceptions that includes the new exception date', () => {
    const parent = makeParentEvent();
    const exceptionDate = new Date('2025-01-13T09:00:00Z');

    const { updatedExceptions } = createRecurrenceException(parent, exceptionDate, {});

    expect(updatedExceptions).toEqual([exceptionDate]);
  });

  it('does not allow modifications to override critical exception fields', () => {
    const parent = makeParentEvent();
    const exceptionDate = new Date('2025-01-13T09:00:00Z');

    const { exceptionEvent } = createRecurrenceException(parent, exceptionDate, {
      parentRecurringEventId: 'hacked-id',
      recurrenceExceptionDate: new Date('2099-01-01T00:00:00Z'),
      recurrenceRule: makeRecurrenceRule({ frequency: 'daily' }),
    } as Partial<CalendarEvent>);

    expect(exceptionEvent.parentRecurringEventId).toBe('parent-event-1');
    expect(exceptionEvent.recurrenceExceptionDate).toEqual(exceptionDate);
    expect(exceptionEvent.recurrenceRule).toBeNull();
  });

  it('throws if parent event has no recurrence rule', () => {
    const parent = makeParentEvent({ recurrenceRule: null });
    const exceptionDate = new Date('2025-01-13T09:00:00Z');

    expect(() => createRecurrenceException(parent, exceptionDate, {})).toThrow(
      'Cannot create exception for a non-recurring event'
    );
  });

  it('sets syncStatus to pending_create on the exception', () => {
    const parent = makeParentEvent();
    const exceptionDate = new Date('2025-01-13T09:00:00Z');

    const { exceptionEvent } = createRecurrenceException(parent, exceptionDate, {});

    expect(exceptionEvent.syncStatus).toBe('pending_create');
  });

  // Gap #9: Multiple exceptions on same parent
  it('accumulates exception dates across multiple calls (Gap #9)', () => {
    const parent = makeParentEvent();
    const date1 = new Date('2025-01-13T09:00:00Z');
    const date2 = new Date('2025-01-20T09:00:00Z');

    const result1 = createRecurrenceException(parent, date1, { title: 'Exception 1' });
    // Simulate caller applying the updated exceptions to parent
    const parentWithEx1 = {
      ...parent,
      recurrenceRule: { ...parent.recurrenceRule!, exceptions: result1.updatedExceptions },
    };

    const result2 = createRecurrenceException(parentWithEx1, date2, { title: 'Exception 2' });

    expect(result2.updatedExceptions).toHaveLength(2);
    expect(result2.updatedExceptions).toContainEqual(date1);
    expect(result2.updatedExceptions).toContainEqual(date2);
    // Original parent still untouched
    expect(parent.recurrenceRule!.exceptions).toHaveLength(0);
  });
});

describe('getEffectiveOccurrences', () => {
  const range: DateRange = {
    start: new Date('2025-01-06T00:00:00Z'),
    end: new Date('2025-02-03T00:00:00Z'),
  };

  it('returns expanded occurrences when no exceptions exist', () => {
    const parent = makeParentEvent();
    const occurrences = getEffectiveOccurrences(parent, [], range);

    expect(occurrences.length).toBe(4);
    expect(occurrences[0].startTime).toEqual(new Date('2025-01-06T09:00:00Z'));
    expect(occurrences[1].startTime).toEqual(new Date('2025-01-13T09:00:00Z'));
    expect(occurrences[2].startTime).toEqual(new Date('2025-01-20T09:00:00Z'));
    expect(occurrences[3].startTime).toEqual(new Date('2025-01-27T09:00:00Z'));
  });

  // Gap #8: Exception with EXDATE set on parent — exception is still included
  it('includes modified exception even when EXDATE excludes the date (Gap #8)', () => {
    const parent = makeParentEvent();
    const exceptionDate = new Date('2025-01-13T09:00:00Z');

    const exceptionEvent = makeParentEvent({
      id: 'exception-1',
      title: 'Modified Standup',
      recurrenceRule: null,
      recurrenceExceptionDate: exceptionDate,
      parentRecurringEventId: 'parent-event-1',
      startTime: new Date('2025-01-13T10:00:00Z'),
      endTime: new Date('2025-01-13T10:30:00Z'),
    });

    // EXDATE is set — expansion will skip Jan 13
    parent.recurrenceRule!.exceptions = [exceptionDate];

    const occurrences = getEffectiveOccurrences(parent, [exceptionEvent], range);

    // Gap #8 fix: Should still have 4 occurrences — the exception is injected
    expect(occurrences.length).toBe(4);
    expect(occurrences[0].startTime).toEqual(new Date('2025-01-06T09:00:00Z'));
    // The exception event is injected for Jan 13 even though EXDATE excluded it
    expect(occurrences[1].title).toBe('Modified Standup');
    expect(occurrences[1].startTime).toEqual(new Date('2025-01-13T10:00:00Z'));
    expect(occurrences[2].startTime).toEqual(new Date('2025-01-20T09:00:00Z'));
    expect(occurrences[3].startTime).toEqual(new Date('2025-01-27T09:00:00Z'));
  });

  it('replaces occurrence with exception when EXDATE is not set on parent', () => {
    const parent = makeParentEvent();
    const exceptionDate = new Date('2025-01-13T09:00:00Z');

    const exceptionEvent = makeParentEvent({
      id: 'exception-1',
      title: 'Modified Standup',
      recurrenceRule: null,
      recurrenceExceptionDate: exceptionDate,
      parentRecurringEventId: 'parent-event-1',
      startTime: new Date('2025-01-13T10:00:00Z'),
      endTime: new Date('2025-01-13T10:30:00Z'),
    });

    const occurrences = getEffectiveOccurrences(parent, [exceptionEvent], range);

    expect(occurrences.length).toBe(4);
    expect(occurrences[0].title).toBe('Weekly Standup');
    expect(occurrences[1].title).toBe('Modified Standup');
    expect(occurrences[1].startTime).toEqual(new Date('2025-01-13T10:00:00Z'));
    expect(occurrences[2].title).toBe('Weekly Standup');
    expect(occurrences[3].title).toBe('Weekly Standup');
  });

  it('skips cancelled exception occurrences', () => {
    const parent = makeParentEvent();
    const exceptionDate = new Date('2025-01-20T09:00:00Z');

    const cancelledException = makeParentEvent({
      id: 'exception-cancelled',
      recurrenceRule: null,
      recurrenceExceptionDate: exceptionDate,
      parentRecurringEventId: 'parent-event-1',
      status: 'cancelled',
    });

    const occurrences = getEffectiveOccurrences(parent, [cancelledException], range);

    expect(occurrences.length).toBe(3);
    expect(occurrences[0].startTime).toEqual(new Date('2025-01-06T09:00:00Z'));
    expect(occurrences[1].startTime).toEqual(new Date('2025-01-13T09:00:00Z'));
    expect(occurrences[2].startTime).toEqual(new Date('2025-01-27T09:00:00Z'));
  });

  it('skips cancelled exception even when EXDATE is set', () => {
    const parent = makeParentEvent();
    const exceptionDate = new Date('2025-01-20T09:00:00Z');
    parent.recurrenceRule!.exceptions = [exceptionDate];

    const cancelledException = makeParentEvent({
      id: 'exception-cancelled',
      recurrenceRule: null,
      recurrenceExceptionDate: exceptionDate,
      parentRecurringEventId: 'parent-event-1',
      status: 'cancelled',
    });

    const occurrences = getEffectiveOccurrences(parent, [cancelledException], range);

    // EXDATE removes Jan 20 from expansion, cancelled exception is NOT injected
    expect(occurrences.length).toBe(3);
    const dates = occurrences.map(o => o.startTime.toISOString());
    expect(dates).not.toContain('2025-01-20T09:00:00.000Z');
  });

  it('leaves other occurrences unmodified when one is excepted', () => {
    const parent = makeParentEvent();
    const exceptionDate = new Date('2025-01-13T09:00:00Z');

    const exceptionEvent = makeParentEvent({
      id: 'exception-1',
      title: 'Special Meeting',
      location: 'Room Z',
      recurrenceRule: null,
      recurrenceExceptionDate: exceptionDate,
      parentRecurringEventId: 'parent-event-1',
    });

    const occurrences = getEffectiveOccurrences(parent, [exceptionEvent], range);

    const nonExceptions = occurrences.filter(o => o.id !== 'exception-1');
    for (const occ of nonExceptions) {
      expect(occ.title).toBe('Weekly Standup');
      expect(occ.location).toBe('Room A');
    }
  });

  it('returns empty array for non-recurring parent event', () => {
    const parent = makeParentEvent({ recurrenceRule: null });
    const occurrences = getEffectiveOccurrences(parent, [], range);
    expect(occurrences).toEqual([]);
  });

  it('preserves event duration in generated occurrences', () => {
    const parent = makeParentEvent();
    const occurrences = getEffectiveOccurrences(parent, [], range);

    for (const occ of occurrences) {
      const duration = occ.endTime.getTime() - occ.startTime.getTime();
      expect(duration).toBe(30 * 60 * 1000);
    }
  });

  it('handles multiple exceptions in the same range', () => {
    const parent = makeParentEvent();
    const exDate1 = new Date('2025-01-13T09:00:00Z');
    const exDate2 = new Date('2025-01-27T09:00:00Z');

    const exception1 = makeParentEvent({
      id: 'ex-1',
      title: 'Exception 1',
      recurrenceRule: null,
      recurrenceExceptionDate: exDate1,
      parentRecurringEventId: 'parent-event-1',
    });

    const exception2 = makeParentEvent({
      id: 'ex-2',
      title: 'Exception 2',
      recurrenceRule: null,
      recurrenceExceptionDate: exDate2,
      parentRecurringEventId: 'parent-event-1',
      status: 'cancelled',
    });

    const occurrences = getEffectiveOccurrences(parent, [exception1, exception2], range);

    // Jan 6: normal, Jan 13: exception1, Jan 20: normal, Jan 27: cancelled (skipped)
    expect(occurrences.length).toBe(3);
    expect(occurrences[0].title).toBe('Weekly Standup');
    expect(occurrences[1].title).toBe('Exception 1');
    expect(occurrences[2].title).toBe('Weekly Standup');
    expect(occurrences[2].startTime).toEqual(new Date('2025-01-20T09:00:00Z'));
  });

  it('results are sorted chronologically', () => {
    const parent = makeParentEvent();
    const occurrences = getEffectiveOccurrences(parent, [], range);

    for (let i = 1; i < occurrences.length; i++) {
      expect(occurrences[i].startTime.getTime()).toBeGreaterThan(
        occurrences[i - 1].startTime.getTime()
      );
    }
  });
});
