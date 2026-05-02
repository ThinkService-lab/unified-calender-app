/**
 * Unit tests for convertParsedEventToCreateInput — converts a ParsedEvent
 * from the NL parser into a CreateEventInput for the EventCRUDService.
 *
 * Requirements: 5.2, 5.8
 */

import { convertParsedEventToCreateInput } from '../convertParsedEvent';
import type { ParsedEvent } from '../naturalLanguageParser';
import type { RecurrenceRule } from '../../types/models';

describe('convertParsedEventToCreateInput', () => {
  const calendarAccountId = 'account-123';

  const baseConfidence = {
    date: true,
    time: true,
    duration: true,
    location: false,
    recurrence: 'none' as const,
  };

  function makeParsedEvent(overrides: Partial<ParsedEvent> = {}): ParsedEvent {
    return {
      title: 'Team standup',
      date: new Date(2025, 0, 15), // Jan 15, 2025
      time: { hours: 9, minutes: 0 },
      duration: 60,
      location: null,
      attendees: [],
      recurrence: null,
      confidence: baseConfidence,
      ...overrides,
    };
  }

  it('returns null when date is missing', () => {
    const parsed = makeParsedEvent({ date: null });
    const result = convertParsedEventToCreateInput(parsed, calendarAccountId);
    expect(result).toBeNull();
  });

  it('returns null when time is missing', () => {
    const parsed = makeParsedEvent({ time: null });
    const result = convertParsedEventToCreateInput(parsed, calendarAccountId);
    expect(result).toBeNull();
  });

  it('converts a full parsed event with all fields present', () => {
    const recurrence: RecurrenceRule = {
      frequency: 'weekly',
      interval: 1,
      count: null,
      until: null,
      bySecond: null,
      byMinute: null,
      byHour: null,
      byDay: ['MO', 'WE', 'FR'],
      byMonthDay: null,
      byYearDay: null,
      byWeekNo: null,
      byMonth: null,
      bySetPos: null,
      wkst: 'MO',
      exceptions: [],
    };

    const parsed = makeParsedEvent({
      title: 'Lunch with Sarah',
      date: new Date(2025, 0, 15),
      time: { hours: 12, minutes: 0 },
      duration: 90,
      location: 'Cafe Roma',
      attendees: ['Sarah', 'Tom'],
      recurrence,
      confidence: {
        date: true,
        time: true,
        duration: true,
        location: true,
        recurrence: 'parsed',
      },
    });

    const result = convertParsedEventToCreateInput(parsed, calendarAccountId);

    expect(result).not.toBeNull();
    expect(result!.calendarAccountId).toBe(calendarAccountId);
    expect(result!.title).toBe('Lunch with Sarah');

    // startTime = Jan 15, 2025 12:00
    expect(result!.startTime.getFullYear()).toBe(2025);
    expect(result!.startTime.getMonth()).toBe(0);
    expect(result!.startTime.getDate()).toBe(15);
    expect(result!.startTime.getHours()).toBe(12);
    expect(result!.startTime.getMinutes()).toBe(0);

    // endTime = 12:00 + 90 min = 13:30
    expect(result!.endTime.getHours()).toBe(13);
    expect(result!.endTime.getMinutes()).toBe(30);

    expect(result!.description).toBeNull();
    expect(result!.location).toBe('Cafe Roma');
    expect(result!.isAllDay).toBe(false);
    expect(result!.organizer).toBeNull();
    expect(result!.visibility).toBeNull();
    expect(result!.opaqueFields).toBeNull();
    expect(result!.recurrenceExceptionDate).toBeNull();
    expect(result!.parentRecurringEventId).toBeNull();

    // Recurrence is JSON-serialized
    expect(result!.recurrenceRule).toBe(JSON.stringify(recurrence));

    // Attendees are JSON-serialized Attendee objects
    const attendees = JSON.parse(result!.attendees!);
    expect(attendees).toHaveLength(2);
    expect(attendees[0]).toEqual({
      email: '',
      displayName: 'Sarah',
      status: 'needs-action',
      role: 'required',
    });
    expect(attendees[1]).toEqual({
      email: '',
      displayName: 'Tom',
      status: 'needs-action',
      role: 'required',
    });
  });

  it('sets correct timezone from device', () => {
    const parsed = makeParsedEvent();
    const result = convertParsedEventToCreateInput(parsed, calendarAccountId);

    expect(result).not.toBeNull();
    // Should match the device timezone
    const expectedTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    expect(result!.timeZone).toBe(expectedTz);
  });

  it('maps attendee with empty string name to null displayName', () => {
    const parsed = makeParsedEvent({
      attendees: ['Alice', '', 'Bob'],
    });
    const result = convertParsedEventToCreateInput(parsed, calendarAccountId);

    expect(result).not.toBeNull();
    const attendees = JSON.parse(result!.attendees!);
    expect(attendees).toHaveLength(3);
    expect(attendees[0].displayName).toBe('Alice');
    expect(attendees[1].displayName).toBeNull();
    expect(attendees[2].displayName).toBe('Bob');
  });

  it('serializes recurrence when present', () => {
    const recurrence: RecurrenceRule = {
      frequency: 'daily',
      interval: 2,
      count: 10,
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
    };

    const parsed = makeParsedEvent({ recurrence });
    const result = convertParsedEventToCreateInput(parsed, calendarAccountId);

    expect(result).not.toBeNull();
    expect(result!.recurrenceRule).toBe(JSON.stringify(recurrence));
  });

  it('sets recurrenceRule to null when recurrence is not present', () => {
    const parsed = makeParsedEvent({ recurrence: null });
    const result = convertParsedEventToCreateInput(parsed, calendarAccountId);

    expect(result).not.toBeNull();
    expect(result!.recurrenceRule).toBeNull();
  });

  it('uses default duration of 60 minutes when not specified', () => {
    const parsed = makeParsedEvent({
      time: { hours: 14, minutes: 0 },
      duration: 60, // default
    });
    const result = convertParsedEventToCreateInput(parsed, calendarAccountId);

    expect(result).not.toBeNull();
    // 14:00 + 60 min = 15:00
    expect(result!.endTime.getHours()).toBe(15);
    expect(result!.endTime.getMinutes()).toBe(0);
  });

  it('sets attendees to null when attendees array is empty', () => {
    const parsed = makeParsedEvent({ attendees: [] });
    const result = convertParsedEventToCreateInput(parsed, calendarAccountId);

    expect(result).not.toBeNull();
    expect(result!.attendees).toBeNull();
  });

  it('sets location to null when not parsed', () => {
    const parsed = makeParsedEvent({ location: null });
    const result = convertParsedEventToCreateInput(parsed, calendarAccountId);

    expect(result).not.toBeNull();
    expect(result!.location).toBeNull();
  });

  it('passes location through when present', () => {
    const parsed = makeParsedEvent({ location: 'Conference Room B' });
    const result = convertParsedEventToCreateInput(parsed, calendarAccountId);

    expect(result).not.toBeNull();
    expect(result!.location).toBe('Conference Room B');
  });

  it('always sets isAllDay to false', () => {
    const parsed = makeParsedEvent();
    const result = convertParsedEventToCreateInput(parsed, calendarAccountId);

    expect(result).not.toBeNull();
    expect(result!.isAllDay).toBe(false);
  });
});
