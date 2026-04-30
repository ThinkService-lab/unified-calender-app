/**
 * Unit tests for EventEditorViewModel.
 * Tests pure logic: validation, event building, recurrence rules,
 * conflict detection, and exception creation.
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 7.2, 7.3
 */

import {
  validateEventForm,
  buildEventFromForm,
  buildRecurrenceRule,
  buildExceptionEvent,
  detectFormConflicts,
  isRecurringEvent,
  getActiveAccounts,
  createDefaultForm,
  createFormFromEvent,
} from '../eventEditorViewModel';
import type { EventFormData } from '../eventEditorViewModel';
import type { CalendarEvent, CalendarAccount } from '../../../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDate(offset: number = 0): Date {
  const d = new Date('2025-06-15T10:00:00Z');
  d.setHours(d.getHours() + offset);
  return d;
}

function makeValidForm(overrides: Partial<EventFormData> = {}): EventFormData {
  return {
    title: 'Team Meeting',
    description: 'Weekly sync',
    location: 'Room 101',
    startTime: makeDate(0),
    endTime: makeDate(1),
    isAllDay: false,
    calendarAccountId: 'account-1',
    recurrenceFrequency: 'none',
    recurrenceInterval: 1,
    recurrenceEndCondition: 'never',
    recurrenceCount: null,
    recurrenceUntil: null,
    recurrenceByDay: null,
    recurrenceByMonthDay: null,
    attendees: [],
    ...overrides,
  };
}

function makeEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'event-1',
    providerEventId: 'prov-1',
    calendarAccountId: 'account-1',
    title: 'Existing Event',
    description: null,
    location: null,
    startTime: makeDate(0),
    endTime: makeDate(1),
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

function makeAccount(overrides: Partial<CalendarAccount> = {}): CalendarAccount {
  return {
    id: 'account-1',
    userId: 'user-1',
    providerId: 'google',
    displayName: 'Work Calendar',
    email: 'user@example.com',
    color: '#4285F4',
    visibility: 'public',
    syncToken: null,
    lastSyncedAt: null,
    status: 'active',
    createdAt: new Date(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// validateEventForm
// ---------------------------------------------------------------------------

describe('validateEventForm', () => {
  it('returns valid for a complete form', () => {
    const result = validateEventForm(makeValidForm());
    expect(result.valid).toBe(true);
    expect(Object.keys(result.errors)).toHaveLength(0);
  });

  it('requires a title', () => {
    const result = validateEventForm(makeValidForm({ title: '' }));
    expect(result.valid).toBe(false);
    expect(result.errors.title).toBeDefined();
  });

  it('requires a title with non-whitespace content', () => {
    const result = validateEventForm(makeValidForm({ title: '   ' }));
    expect(result.valid).toBe(false);
    expect(result.errors.title).toBeDefined();
  });

  it('requires a calendar account', () => {
    const result = validateEventForm(makeValidForm({ calendarAccountId: '' }));
    expect(result.valid).toBe(false);
    expect(result.errors.calendarAccountId).toBeDefined();
  });

  it('requires end time after start time', () => {
    const start = makeDate(2);
    const end = makeDate(1);
    const result = validateEventForm(makeValidForm({ startTime: start, endTime: end }));
    expect(result.valid).toBe(false);
    expect(result.errors.endTime).toBeDefined();
  });

  it('allows equal start and end time for all-day events', () => {
    const time = makeDate(0);
    const result = validateEventForm(
      makeValidForm({ startTime: time, endTime: time, isAllDay: true }),
    );
    expect(result.valid).toBe(true);
  });

  it('validates recurrence count when end condition is count', () => {
    const result = validateEventForm(
      makeValidForm({
        recurrenceFrequency: 'weekly',
        recurrenceEndCondition: 'count',
        recurrenceCount: 0,
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.recurrenceCount).toBeDefined();
  });

  it('validates recurrence count null when end condition is count', () => {
    const result = validateEventForm(
      makeValidForm({
        recurrenceFrequency: 'daily',
        recurrenceEndCondition: 'count',
        recurrenceCount: null,
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.recurrenceCount).toBeDefined();
  });

  it('validates recurrence until date is required', () => {
    const result = validateEventForm(
      makeValidForm({
        recurrenceFrequency: 'monthly',
        recurrenceEndCondition: 'until',
        recurrenceUntil: null,
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.recurrenceUntil).toBeDefined();
  });

  it('validates recurrence until date must be after start', () => {
    const result = validateEventForm(
      makeValidForm({
        recurrenceFrequency: 'yearly',
        recurrenceEndCondition: 'until',
        recurrenceUntil: new Date('2025-01-01T00:00:00Z'), // before start
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.recurrenceUntil).toBeDefined();
  });

  it('does not validate recurrence fields when frequency is none', () => {
    const result = validateEventForm(
      makeValidForm({
        recurrenceFrequency: 'none',
        recurrenceEndCondition: 'count',
        recurrenceCount: null,
      }),
    );
    expect(result.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildRecurrenceRule
// ---------------------------------------------------------------------------

describe('buildRecurrenceRule', () => {
  it('returns null for frequency none', () => {
    const form = makeValidForm({ recurrenceFrequency: 'none' });
    expect(buildRecurrenceRule(form)).toBeNull();
  });

  it('builds a daily rule', () => {
    const form = makeValidForm({
      recurrenceFrequency: 'daily',
      recurrenceInterval: 2,
      recurrenceEndCondition: 'never',
    });
    const rule = buildRecurrenceRule(form);
    expect(rule).not.toBeNull();
    expect(rule!.frequency).toBe('daily');
    expect(rule!.interval).toBe(2);
    expect(rule!.count).toBeNull();
    expect(rule!.until).toBeNull();
  });

  it('builds a weekly rule with count', () => {
    const form = makeValidForm({
      recurrenceFrequency: 'weekly',
      recurrenceInterval: 1,
      recurrenceEndCondition: 'count',
      recurrenceCount: 10,
    });
    const rule = buildRecurrenceRule(form);
    expect(rule!.frequency).toBe('weekly');
    expect(rule!.count).toBe(10);
    expect(rule!.until).toBeNull();
  });

  it('builds a monthly rule with until date', () => {
    const until = new Date('2026-01-01T00:00:00Z');
    const form = makeValidForm({
      recurrenceFrequency: 'monthly',
      recurrenceEndCondition: 'until',
      recurrenceUntil: until,
    });
    const rule = buildRecurrenceRule(form);
    expect(rule!.frequency).toBe('monthly');
    expect(rule!.count).toBeNull();
    expect(rule!.until).toEqual(until);
  });

  it('builds a yearly rule', () => {
    const form = makeValidForm({
      recurrenceFrequency: 'yearly',
      recurrenceInterval: 1,
    });
    const rule = buildRecurrenceRule(form);
    expect(rule!.frequency).toBe('yearly');
    expect(rule!.wkst).toBe('MO');
  });

  it('includes byDay when provided', () => {
    const form = makeValidForm({
      recurrenceFrequency: 'weekly',
      recurrenceByDay: ['MO', 'WE', 'FR'],
    });
    const rule = buildRecurrenceRule(form);
    expect(rule!.byDay).toEqual(['MO', 'WE', 'FR']);
  });

  it('includes byMonthDay when provided', () => {
    const form = makeValidForm({
      recurrenceFrequency: 'monthly',
      recurrenceByMonthDay: [1, 15],
    });
    const rule = buildRecurrenceRule(form);
    expect(rule!.byMonthDay).toEqual([1, 15]);
  });

  it('enforces minimum interval of 1', () => {
    const form = makeValidForm({
      recurrenceFrequency: 'daily',
      recurrenceInterval: 0,
    });
    const rule = buildRecurrenceRule(form);
    expect(rule!.interval).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// buildEventFromForm
// ---------------------------------------------------------------------------

describe('buildEventFromForm', () => {
  it('builds a new event from form data', () => {
    const form = makeValidForm();
    const event = buildEventFromForm(form);

    expect(event.title).toBe('Team Meeting');
    expect(event.description).toBe('Weekly sync');
    expect(event.location).toBe('Room 101');
    expect(event.startTime).toEqual(form.startTime);
    expect(event.endTime).toEqual(form.endTime);
    expect(event.isAllDay).toBe(false);
    expect(event.calendarAccountId).toBe('account-1');
    expect(event.recurrenceRule).toBeNull();
    expect(event.attendees).toEqual([]);
  });

  it('trims whitespace from title, description, and location', () => {
    const form = makeValidForm({
      title: '  Meeting  ',
      description: '  Notes  ',
      location: '  Room  ',
    });
    const event = buildEventFromForm(form);
    expect(event.title).toBe('Meeting');
    expect(event.description).toBe('Notes');
    expect(event.location).toBe('Room');
  });

  it('sets description and location to null when empty', () => {
    const form = makeValidForm({ description: '', location: '' });
    const event = buildEventFromForm(form);
    expect(event.description).toBeNull();
    expect(event.location).toBeNull();
  });

  it('preserves existing event fields when editing', () => {
    const existing = makeEvent({ sequence: 3 });
    const form = makeValidForm({ title: 'Updated Title' });
    const event = buildEventFromForm(form, existing);

    expect(event.id).toBe('event-1');
    expect(event.providerEventId).toBe('prov-1');
    expect(event.sequence).toBe(4); // incremented
    expect(event.title).toBe('Updated Title');
  });

  it('includes recurrence rule when frequency is set', () => {
    const form = makeValidForm({
      recurrenceFrequency: 'weekly',
      recurrenceInterval: 2,
    });
    const event = buildEventFromForm(form);
    expect(event.recurrenceRule).not.toBeNull();
    expect(event.recurrenceRule!.frequency).toBe('weekly');
  });
});

// ---------------------------------------------------------------------------
// buildExceptionEvent
// ---------------------------------------------------------------------------

describe('buildExceptionEvent', () => {
  it('creates an exception with parent reference and exception date', () => {
    const parent = makeEvent({
      id: 'recurring-1',
      recurrenceRule: {
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
      },
    });
    const exceptionDate = new Date('2025-06-22T10:00:00Z');
    const form = makeValidForm({ title: 'Modified Instance' });

    const exception = buildExceptionEvent(form, parent, exceptionDate);

    expect(exception.parentRecurringEventId).toBe('recurring-1');
    expect(exception.recurrenceExceptionDate).toEqual(exceptionDate);
    expect(exception.recurrenceRule).toBeNull();
    expect(exception.title).toBe('Modified Instance');
    expect(exception.id).toBeUndefined(); // new ID will be generated
  });
});

// ---------------------------------------------------------------------------
// detectFormConflicts
// ---------------------------------------------------------------------------

describe('detectFormConflicts', () => {
  it('detects overlapping events', () => {
    const form = makeValidForm({
      startTime: makeDate(0),
      endTime: makeDate(1),
    });
    const existing = [
      makeEvent({
        id: 'other-1',
        startTime: makeDate(0.5),
        endTime: makeDate(1.5),
      }),
    ];

    const result = detectFormConflicts(form, existing);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].eventB.id).toBe('other-1');
    expect(result.conflicts[0].overlapMinutes).toBeGreaterThan(0);
  });

  it('does not detect non-overlapping events', () => {
    const form = makeValidForm({
      startTime: makeDate(0),
      endTime: makeDate(1),
    });
    const existing = [
      makeEvent({
        id: 'other-1',
        startTime: makeDate(2),
        endTime: makeDate(3),
      }),
    ];

    const result = detectFormConflicts(form, existing);
    expect(result.conflicts).toHaveLength(0);
  });

  it('excludes the event being edited from conflict detection', () => {
    const form = makeValidForm({
      startTime: makeDate(0),
      endTime: makeDate(1),
    });
    const existing = [
      makeEvent({
        id: 'editing-event',
        startTime: makeDate(0),
        endTime: makeDate(1),
      }),
    ];

    const result = detectFormConflicts(form, existing, 'editing-event');
    expect(result.conflicts).toHaveLength(0);
  });

  it('suggests alternatives when conflicts exist', () => {
    const form = makeValidForm({
      startTime: makeDate(0),
      endTime: makeDate(1),
    });
    const existing = [
      makeEvent({
        id: 'other-1',
        startTime: makeDate(0),
        endTime: makeDate(1),
      }),
    ];

    const result = detectFormConflicts(form, existing);
    expect(result.conflicts).toHaveLength(1);
    expect(result.alternatives.length).toBeGreaterThan(0);
    expect(result.alternatives.length).toBeLessThanOrEqual(3);
  });

  it('alternative suggestions do not overlap with existing events', () => {
    const form = makeValidForm({
      startTime: makeDate(0),
      endTime: makeDate(1),
    });
    const existing = [
      makeEvent({
        id: 'other-1',
        startTime: makeDate(0),
        endTime: makeDate(2),
      }),
    ];

    const result = detectFormConflicts(form, existing);
    for (const alt of result.alternatives) {
      for (const ev of existing) {
        const overlaps =
          alt.start.getTime() < ev.endTime.getTime() &&
          ev.startTime.getTime() < alt.end.getTime();
        expect(overlaps).toBe(false);
      }
    }
  });

  it('detects multiple conflicts', () => {
    const form = makeValidForm({
      startTime: makeDate(0),
      endTime: makeDate(3),
    });
    const existing = [
      makeEvent({ id: 'a', startTime: makeDate(0.5), endTime: makeDate(1) }),
      makeEvent({ id: 'b', startTime: makeDate(1.5), endTime: makeDate(2) }),
      makeEvent({ id: 'c', startTime: makeDate(5), endTime: makeDate(6) }),
    ];

    const result = detectFormConflicts(form, existing);
    expect(result.conflicts).toHaveLength(2);
  });

  it('returns no alternatives when there are no conflicts', () => {
    const form = makeValidForm({
      startTime: makeDate(0),
      endTime: makeDate(1),
    });
    const result = detectFormConflicts(form, []);
    expect(result.conflicts).toHaveLength(0);
    expect(result.alternatives).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// isRecurringEvent
// ---------------------------------------------------------------------------

describe('isRecurringEvent', () => {
  it('returns true for events with a recurrence rule', () => {
    const event = makeEvent({
      recurrenceRule: {
        frequency: 'daily',
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
      },
    });
    expect(isRecurringEvent(event)).toBe(true);
  });

  it('returns true for exception instances', () => {
    const event = makeEvent({
      parentRecurringEventId: 'parent-1',
      recurrenceExceptionDate: new Date(),
    });
    expect(isRecurringEvent(event)).toBe(true);
  });

  it('returns false for non-recurring events', () => {
    const event = makeEvent();
    expect(isRecurringEvent(event)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getActiveAccounts
// ---------------------------------------------------------------------------

describe('getActiveAccounts', () => {
  it('filters to only active accounts', () => {
    const accounts = [
      makeAccount({ id: 'a1', status: 'active' }),
      makeAccount({ id: 'a2', status: 'revoked' }),
      makeAccount({ id: 'a3', status: 'active' }),
      makeAccount({ id: 'a4', status: 'error' }),
    ];
    const active = getActiveAccounts(accounts);
    expect(active).toHaveLength(2);
    expect(active.map((a) => a.id)).toEqual(['a1', 'a3']);
  });

  it('returns empty array when no accounts are active', () => {
    const accounts = [
      makeAccount({ id: 'a1', status: 'revoked' }),
    ];
    expect(getActiveAccounts(accounts)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// createDefaultForm
// ---------------------------------------------------------------------------

describe('createDefaultForm', () => {
  it('creates a form with default values', () => {
    const form = createDefaultForm('acc-1');
    expect(form.title).toBe('');
    expect(form.calendarAccountId).toBe('acc-1');
    expect(form.recurrenceFrequency).toBe('none');
    expect(form.attendees).toEqual([]);
    expect(form.endTime.getTime()).toBeGreaterThan(form.startTime.getTime());
  });

  it('uses empty string for account when none provided', () => {
    const form = createDefaultForm();
    expect(form.calendarAccountId).toBe('');
  });
});

// ---------------------------------------------------------------------------
// createFormFromEvent
// ---------------------------------------------------------------------------

describe('createFormFromEvent', () => {
  it('populates form from an existing event', () => {
    const event = makeEvent({
      title: 'Lunch',
      description: 'With team',
      location: 'Cafe',
      isAllDay: false,
      attendees: [
        { email: 'a@b.com', displayName: 'A', status: 'accepted', role: 'required' },
      ],
    });
    const form = createFormFromEvent(event);

    expect(form.title).toBe('Lunch');
    expect(form.description).toBe('With team');
    expect(form.location).toBe('Cafe');
    expect(form.calendarAccountId).toBe('account-1');
    expect(form.attendees).toHaveLength(1);
    expect(form.recurrenceFrequency).toBe('none');
  });

  it('populates recurrence config from event with recurrence rule', () => {
    const event = makeEvent({
      recurrenceRule: {
        frequency: 'weekly',
        interval: 2,
        count: 5,
        until: null,
        bySecond: null,
        byMinute: null,
        byHour: null,
        byDay: ['MO', 'FR'],
        byMonthDay: null,
        byYearDay: null,
        byWeekNo: null,
        byMonth: null,
        bySetPos: null,
        wkst: 'MO',
        exceptions: [],
      },
    });
    const form = createFormFromEvent(event);

    expect(form.recurrenceFrequency).toBe('weekly');
    expect(form.recurrenceInterval).toBe(2);
    expect(form.recurrenceEndCondition).toBe('count');
    expect(form.recurrenceCount).toBe(5);
    expect(form.recurrenceByDay).toEqual(['MO', 'FR']);
  });

  it('handles null description and location', () => {
    const event = makeEvent({ description: null, location: null });
    const form = createFormFromEvent(event);
    expect(form.description).toBe('');
    expect(form.location).toBe('');
  });
});
