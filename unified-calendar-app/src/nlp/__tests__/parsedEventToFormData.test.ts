/**
 * Unit tests for parsedEventToFormData — the pure function that maps
 * a Partial<ParsedEvent> into Partial<EventFormData> for the EventEditor
 * pre-population flow.
 *
 * Requirements: 5.8, 17.8
 */

import { parsedEventToFormData } from '../parsedEventToFormData';
import type { ParsedEvent } from '../naturalLanguageParser';
import type { RecurrenceRule } from '../../types/models';

describe('parsedEventToFormData', () => {
  const baseConfidence = {
    date: false,
    time: false,
    duration: false,
    location: false,
    recurrence: 'none' as const,
  };

  it('maps title from parsed event', () => {
    const parsed: Partial<ParsedEvent> = {
      title: 'Team standup',
      confidence: baseConfidence,
    };
    const result = parsedEventToFormData(parsed);
    expect(result.title).toBe('Team standup');
  });

  it('omits title when empty', () => {
    const parsed: Partial<ParsedEvent> = {
      title: '',
      confidence: baseConfidence,
    };
    const result = parsedEventToFormData(parsed);
    expect(result.title).toBeUndefined();
  });

  it('maps startTime and endTime when both date and time are present', () => {
    const parsed: Partial<ParsedEvent> = {
      date: new Date(2025, 0, 15), // Jan 15, 2025
      time: { hours: 14, minutes: 30 },
      duration: 90,
      confidence: { ...baseConfidence, date: true, time: true, duration: true },
    };
    const result = parsedEventToFormData(parsed);

    expect(result.startTime).toBeDefined();
    expect(result.startTime!.getFullYear()).toBe(2025);
    expect(result.startTime!.getMonth()).toBe(0);
    expect(result.startTime!.getDate()).toBe(15);
    expect(result.startTime!.getHours()).toBe(14);
    expect(result.startTime!.getMinutes()).toBe(30);

    expect(result.endTime).toBeDefined();
    // 14:30 + 90 min = 16:00
    expect(result.endTime!.getHours()).toBe(16);
    expect(result.endTime!.getMinutes()).toBe(0);
  });

  it('does not set startTime when date is null', () => {
    const parsed: Partial<ParsedEvent> = {
      date: null,
      time: { hours: 14, minutes: 0 },
      duration: 60,
      confidence: { ...baseConfidence, time: true },
    };
    const result = parsedEventToFormData(parsed);
    expect(result.startTime).toBeUndefined();
    expect(result.endTime).toBeUndefined();
  });

  it('does not set startTime when time is null', () => {
    const parsed: Partial<ParsedEvent> = {
      date: new Date(2025, 0, 15),
      time: null,
      duration: 60,
      confidence: { ...baseConfidence, date: true },
    };
    const result = parsedEventToFormData(parsed);
    expect(result.startTime).toBeUndefined();
    expect(result.endTime).toBeUndefined();
  });

  it('defaults duration to 60 minutes when not provided', () => {
    const parsed: Partial<ParsedEvent> = {
      date: new Date(2025, 0, 15),
      time: { hours: 9, minutes: 0 },
      confidence: { ...baseConfidence, date: true, time: true },
    };
    const result = parsedEventToFormData(parsed);
    // 9:00 + 60 min = 10:00
    expect(result.endTime!.getHours()).toBe(10);
    expect(result.endTime!.getMinutes()).toBe(0);
  });

  it('maps location when present', () => {
    const parsed: Partial<ParsedEvent> = {
      location: 'Cafe Roma',
      confidence: { ...baseConfidence, location: true },
    };
    const result = parsedEventToFormData(parsed);
    expect(result.location).toBe('Cafe Roma');
  });

  it('does not set location when null', () => {
    const parsed: Partial<ParsedEvent> = {
      location: null,
      confidence: baseConfidence,
    };
    const result = parsedEventToFormData(parsed);
    expect(result.location).toBeUndefined();
  });

  it('maps attendees to Attendee shape', () => {
    const parsed: Partial<ParsedEvent> = {
      attendees: ['Sarah', 'Tom'],
      confidence: baseConfidence,
    };
    const result = parsedEventToFormData(parsed);
    expect(result.attendees).toHaveLength(2);
    expect(result.attendees![0]).toEqual({
      email: '',
      displayName: 'Sarah',
      status: 'needs-action',
      role: 'required',
    });
    expect(result.attendees![1]).toEqual({
      email: '',
      displayName: 'Tom',
      status: 'needs-action',
      role: 'required',
    });
  });

  it('maps empty attendee name to null displayName', () => {
    const parsed: Partial<ParsedEvent> = {
      attendees: [''],
      confidence: baseConfidence,
    };
    const result = parsedEventToFormData(parsed);
    expect(result.attendees![0].displayName).toBeNull();
  });

  it('does not set attendees when array is empty', () => {
    const parsed: Partial<ParsedEvent> = {
      attendees: [],
      confidence: baseConfidence,
    };
    const result = parsedEventToFormData(parsed);
    expect(result.attendees).toBeUndefined();
  });

  it('maps recurrence when confidence.recurrence is "parsed"', () => {
    const rule: RecurrenceRule = {
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
    const parsed: Partial<ParsedEvent> = {
      recurrence: rule,
      confidence: { ...baseConfidence, recurrence: 'parsed' },
    };
    const result = parsedEventToFormData(parsed);
    expect(result.recurrenceFrequency).toBe('weekly');
    expect(result.recurrenceInterval).toBe(1);
    expect(result.recurrenceEndCondition).toBe('never');
    expect(result.recurrenceByDay).toEqual(['MO', 'WE', 'FR']);
  });

  it('does not map recurrence when confidence.recurrence is "none"', () => {
    const parsed: Partial<ParsedEvent> = {
      recurrence: null,
      confidence: { ...baseConfidence, recurrence: 'none' },
    };
    const result = parsedEventToFormData(parsed);
    expect(result.recurrenceFrequency).toBeUndefined();
  });

  it('does not map recurrence when confidence.recurrence is "attempted_unresolved"', () => {
    const parsed: Partial<ParsedEvent> = {
      recurrence: null,
      confidence: { ...baseConfidence, recurrence: 'attempted_unresolved' },
    };
    const result = parsedEventToFormData(parsed);
    expect(result.recurrenceFrequency).toBeUndefined();
  });

  it('maps recurrence with count end condition', () => {
    const rule: RecurrenceRule = {
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
    const parsed: Partial<ParsedEvent> = {
      recurrence: rule,
      confidence: { ...baseConfidence, recurrence: 'parsed' },
    };
    const result = parsedEventToFormData(parsed);
    expect(result.recurrenceFrequency).toBe('daily');
    expect(result.recurrenceInterval).toBe(2);
    expect(result.recurrenceEndCondition).toBe('count');
    expect(result.recurrenceCount).toBe(10);
  });

  it('returns empty object for completely empty parsed event', () => {
    const result = parsedEventToFormData({});
    expect(Object.keys(result)).toHaveLength(0);
  });

  it('maps all fields together in a full parsed event', () => {
    const rule: RecurrenceRule = {
      frequency: 'weekly',
      interval: 1,
      count: null,
      until: null,
      bySecond: null,
      byMinute: null,
      byHour: null,
      byDay: ['MO', 'TU', 'WE', 'TH', 'FR'],
      byMonthDay: null,
      byYearDay: null,
      byWeekNo: null,
      byMonth: null,
      bySetPos: null,
      wkst: 'MO',
      exceptions: [],
    };
    const parsed: Partial<ParsedEvent> = {
      title: 'Team standup',
      date: new Date(2025, 0, 15),
      time: { hours: 9, minutes: 0 },
      duration: 30,
      location: 'Room 42',
      attendees: ['Alice', 'Bob'],
      recurrence: rule,
      confidence: {
        date: true,
        time: true,
        duration: true,
        location: true,
        recurrence: 'parsed',
      },
    };
    const result = parsedEventToFormData(parsed);

    expect(result.title).toBe('Team standup');
    expect(result.startTime).toBeDefined();
    expect(result.endTime).toBeDefined();
    expect(result.location).toBe('Room 42');
    expect(result.attendees).toHaveLength(2);
    expect(result.recurrenceFrequency).toBe('weekly');
    expect(result.recurrenceByDay).toEqual(['MO', 'TU', 'WE', 'TH', 'FR']);
  });
});
