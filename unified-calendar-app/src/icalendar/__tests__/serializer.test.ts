/**
 * Unit tests for EventSerializer - RFC 5545 compliance.
 * Requirements: 12.2
 */

import {
  serialize,
  serializeComponent,
  eventToVEvent,
  escapeText,
  foldLine,
  formatDateTimeUTC,
  serializeRRule,
} from '../serializer';
import { CalendarEvent, RecurrenceRule } from '../../types/models';
import { VEvent } from '../types';

/** Unfolds iCalendar content lines (reverses line folding). */
function unfold(text: string): string {
  return text.replace(/\r\n[ \t]/g, '');
}

function makeEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'test-uid-123@example.com',
    providerEventId: 'provider-123',
    calendarAccountId: 'account-1',
    title: 'Team Meeting',
    description: 'Weekly sync',
    location: 'Room 101',
    startTime: new Date('2024-03-15T10:00:00Z'),
    endTime: new Date('2024-03-15T11:00:00Z'),
    timeZone: 'America/New_York',
    isAllDay: false,
    recurrenceRule: null,
    recurrenceExceptionDate: null,
    parentRecurringEventId: null,
    organizer: null,
    attendees: [],
    sequence: 0,
    dtstamp: new Date('2024-03-01T00:00:00Z'),
    status: 'confirmed',
    visibility: null,
    opaqueFields: new Map(),
    syncStatus: 'synced',
    localVersion: 1,
    remoteEtag: null,
    modifiedBy: null,
    createdAt: new Date('2024-03-01T00:00:00Z'),
    updatedAt: new Date('2024-03-01T00:00:00Z'),
    ...overrides,
  };
}

describe('escapeText', () => {
  it('escapes backslashes', () => {
    expect(escapeText('path\\to\\file')).toBe('path\\\\to\\\\file');
  });

  it('escapes semicolons', () => {
    expect(escapeText('a;b;c')).toBe('a\\;b\\;c');
  });

  it('escapes commas', () => {
    expect(escapeText('one,two,three')).toBe('one\\,two\\,three');
  });

  it('escapes newlines', () => {
    expect(escapeText('line1\nline2')).toBe('line1\\nline2');
  });

  it('escapes CRLF', () => {
    expect(escapeText('line1\r\nline2')).toBe('line1\\nline2');
  });

  it('does NOT escape colons', () => {
    expect(escapeText('key:value')).toBe('key:value');
  });

  it('handles combined special characters', () => {
    expect(escapeText('a\\b;c,d\ne')).toBe('a\\\\b\\;c\\,d\\ne');
  });
});

describe('foldLine', () => {
  it('does not fold lines within 75 octets', () => {
    const short = 'SUMMARY:Short title';
    expect(foldLine(short)).toBe(short);
  });

  it('folds lines exceeding 75 octets', () => {
    const long = 'DESCRIPTION:' + 'A'.repeat(100);
    const folded = foldLine(long);
    const parts = folded.split('\r\n');
    expect(parts.length).toBeGreaterThan(1);

    const encoder = new TextEncoder();
    // First line must be <= 75 octets
    expect(encoder.encode(parts[0]).length).toBeLessThanOrEqual(75);
    // Continuation lines must be <= 75 octets (including leading space)
    for (let i = 1; i < parts.length; i++) {
      expect(encoder.encode(parts[i]).length).toBeLessThanOrEqual(75);
      expect(parts[i][0]).toBe(' ');
    }
  });

  it('handles multi-byte UTF-8 characters correctly', () => {
    // Each emoji is 4 bytes in UTF-8
    const line = 'SUMMARY:' + '🎉'.repeat(20);
    const folded = foldLine(line);
    const encoder = new TextEncoder();
    const parts = folded.split('\r\n');
    for (let i = 0; i < parts.length; i++) {
      expect(encoder.encode(parts[i]).length).toBeLessThanOrEqual(75);
    }
  });
});

describe('formatDateTimeUTC', () => {
  it('formats a date as UTC iCalendar format', () => {
    const date = new Date('2024-03-15T10:30:45Z');
    expect(formatDateTimeUTC(date)).toBe('20240315T103045Z');
  });

  it('pads single-digit values', () => {
    const date = new Date('2024-01-05T09:05:03Z');
    expect(formatDateTimeUTC(date)).toBe('20240105T090503Z');
  });
});

describe('serializeRRule', () => {
  it('serializes a basic daily rule', () => {
    const rule: RecurrenceRule = {
      frequency: 'daily',
      interval: 1,
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
    expect(serializeRRule(rule)).toBe('FREQ=DAILY;COUNT=10');
  });

  it('puts FREQ first', () => {
    const rule: RecurrenceRule = {
      frequency: 'weekly',
      interval: 2,
      count: null,
      until: new Date('2024-12-31T23:59:59Z'),
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
    const result = serializeRRule(rule);
    expect(result.startsWith('FREQ=WEEKLY')).toBe(true);
    expect(result).toContain('INTERVAL=2');
    expect(result).toContain('UNTIL=20241231T235959Z');
    expect(result).toContain('BYDAY=MO,WE,FR');
  });

  it('omits INTERVAL when 1', () => {
    const rule: RecurrenceRule = {
      frequency: 'monthly',
      interval: 1,
      count: 5,
      until: null,
      bySecond: null,
      byMinute: null,
      byHour: null,
      byDay: null,
      byMonthDay: [1, 15],
      byYearDay: null,
      byWeekNo: null,
      byMonth: null,
      bySetPos: null,
      wkst: 'MO',
      exceptions: [],
    };
    const result = serializeRRule(rule);
    expect(result).not.toContain('INTERVAL');
    expect(result).toContain('BYMONTHDAY=1,15');
  });

  it('includes WKST only when not MO', () => {
    const rule: RecurrenceRule = {
      frequency: 'weekly',
      interval: 1,
      count: null,
      until: null,
      bySecond: null,
      byMinute: null,
      byHour: null,
      byDay: ['SU'],
      byMonthDay: null,
      byYearDay: null,
      byWeekNo: null,
      byMonth: null,
      bySetPos: null,
      wkst: 'SU',
      exceptions: [],
    };
    const result = serializeRRule(rule);
    expect(result).toContain('WKST=SU');
  });

  it('serializes all BYxxx parts', () => {
    const rule: RecurrenceRule = {
      frequency: 'yearly',
      interval: 1,
      count: null,
      until: null,
      bySecond: [0, 30],
      byMinute: [0, 15],
      byHour: [9, 17],
      byDay: ['MO'],
      byMonthDay: [1],
      byYearDay: [1, 100],
      byWeekNo: [1, 52],
      byMonth: [1, 6],
      bySetPos: [1, -1],
      wkst: 'MO',
      exceptions: [],
    };
    const result = serializeRRule(rule);
    expect(result).toContain('BYSECOND=0,30');
    expect(result).toContain('BYMINUTE=0,15');
    expect(result).toContain('BYHOUR=9,17');
    expect(result).toContain('BYDAY=MO');
    expect(result).toContain('BYMONTHDAY=1');
    expect(result).toContain('BYYEARDAY=1,100');
    expect(result).toContain('BYWEEKNO=1,52');
    expect(result).toContain('BYMONTH=1,6');
    expect(result).toContain('BYSETPOS=1,-1');
  });
});


describe('serializeComponent', () => {
  it('produces valid VEVENT with required fields', () => {
    const vevent: VEvent = {
      uid: 'test-uid@example.com',
      dtstamp: '20240301T000000Z',
      dtstart: '20240315T100000Z',
      dtend: '20240315T110000Z',
      summary: 'Test Event',
    };
    const result = serializeComponent(vevent);
    expect(result).toContain('BEGIN:VEVENT');
    expect(result).toContain('END:VEVENT');
    expect(result).toContain('UID:test-uid@example.com');
    expect(result).toContain('DTSTAMP:20240301T000000Z');
    expect(result).toContain('DTSTART:20240315T100000Z');
    expect(result).toContain('DTEND:20240315T110000Z');
    expect(result).toContain('SUMMARY:Test Event');
  });

  it('serializes opaque fields', () => {
    const opaqueFields = new Map<string, string>();
    opaqueFields.set('X-CUSTOM-PROP', 'custom-value');
    opaqueFields.set('X-ANOTHER', 'another-value');

    const vevent: VEvent = {
      uid: 'uid@example.com',
      dtstamp: '20240301T000000Z',
      dtstart: '20240315T100000Z',
      opaqueFields,
    };
    const result = serializeComponent(vevent);
    expect(result).toContain('X-CUSTOM-PROP:custom-value');
    expect(result).toContain('X-ANOTHER:another-value');
  });

  it('serializes organizer with parameters', () => {
    const vevent: VEvent = {
      uid: 'uid@example.com',
      dtstamp: '20240301T000000Z',
      dtstart: '20240315T100000Z',
      organizer: {
        email: 'boss@example.com',
        cn: 'The Boss',
        sentBy: 'assistant@example.com',
      },
    };
    const result = serializeComponent(vevent);
    const unfolded = unfold(result);
    expect(unfolded).toContain('ORGANIZER;CN=The Boss;SENT-BY="mailto:assistant@example.com":mailto:boss@example.com');
  });

  it('serializes attendees with parameters', () => {
    const vevent: VEvent = {
      uid: 'uid@example.com',
      dtstamp: '20240301T000000Z',
      dtstart: '20240315T100000Z',
      attendees: [
        { email: 'alice@example.com', cn: 'Alice', partstat: 'ACCEPTED', role: 'REQ-PARTICIPANT' },
        { email: 'bob@example.com', cn: 'Bob', partstat: 'TENTATIVE', role: 'OPT-PARTICIPANT' },
      ],
    };
    const result = serializeComponent(vevent);
    const unfolded = unfold(result);
    expect(unfolded).toContain('ATTENDEE;CN=Alice;PARTSTAT=ACCEPTED;ROLE=REQ-PARTICIPANT:mailto:alice@example.com');
    expect(unfolded).toContain('ATTENDEE;CN=Bob;PARTSTAT=TENTATIVE;ROLE=OPT-PARTICIPANT:mailto:bob@example.com');
  });
});

describe('serialize', () => {
  it('wraps event in VCALENDAR with VERSION and PRODID', () => {
    const event = makeEvent();
    const result = serialize(event);
    expect(result).toContain('BEGIN:VCALENDAR');
    expect(result).toContain('VERSION:2.0');
    expect(result).toContain('PRODID:-//UnifiedCalendarApp//EN');
    expect(result).toContain('END:VCALENDAR');
  });

  it('contains VEVENT block', () => {
    const event = makeEvent();
    const result = serialize(event);
    expect(result).toContain('BEGIN:VEVENT');
    expect(result).toContain('END:VEVENT');
  });

  it('serializes DTSTART and DTEND as UTC when timeZone is UTC', () => {
    const event = makeEvent({
      startTime: new Date('2024-06-20T14:30:00Z'),
      endTime: new Date('2024-06-20T15:30:00Z'),
      timeZone: 'UTC',
    });
    const result = serialize(event);
    expect(result).toContain('DTSTART:20240620T143000Z');
    expect(result).toContain('DTEND:20240620T153000Z');
  });

  it('serializes DTSTART and DTEND with TZID when timeZone is non-UTC', () => {
    const event = makeEvent({
      startTime: new Date('2024-06-20T14:30:00Z'),
      endTime: new Date('2024-06-20T15:30:00Z'),
      timeZone: 'America/New_York',
    });
    const result = serialize(event);
    expect(result).toContain('DTSTART;TZID=America/New_York:');
    expect(result).toContain('DTEND;TZID=America/New_York:');
    // Should NOT have UTC Z suffix
    expect(result).not.toMatch(/DTSTART;TZID=.*Z/);
  });

  it('serializes DTSTAMP, UID, SEQUENCE', () => {
    const event = makeEvent({
      id: 'unique-id-456@calendar.app',
      dtstamp: new Date('2024-02-28T12:00:00Z'),
      sequence: 3,
    });
    const result = serialize(event);
    expect(result).toContain('UID:unique-id-456@calendar.app');
    expect(result).toContain('DTSTAMP:20240228T120000Z');
    expect(result).toContain('SEQUENCE:3');
  });

  it('serializes SUMMARY with text escaping', () => {
    const event = makeEvent({ title: 'Meeting; with, special\\chars\nand newline' });
    const result = serialize(event);
    expect(result).toContain('SUMMARY:Meeting\\; with\\, special\\\\chars\\nand newline');
  });

  it('serializes DESCRIPTION and LOCATION', () => {
    const event = makeEvent({
      description: 'Discuss Q1 goals',
      location: 'Conference Room A, Floor 3',
    });
    const result = serialize(event);
    expect(result).toContain('DESCRIPTION:Discuss Q1 goals');
    expect(result).toContain('LOCATION:Conference Room A\\, Floor 3');
  });

  it('serializes STATUS', () => {
    const event = makeEvent({ status: 'tentative' });
    const result = serialize(event);
    expect(result).toContain('STATUS:TENTATIVE');
  });

  it('serializes RRULE', () => {
    const event = makeEvent({
      recurrenceRule: {
        frequency: 'weekly',
        interval: 1,
        count: 10,
        until: null,
        bySecond: null,
        byMinute: null,
        byHour: null,
        byDay: ['TU', 'TH'],
        byMonthDay: null,
        byYearDay: null,
        byWeekNo: null,
        byMonth: null,
        bySetPos: null,
        wkst: 'MO',
        exceptions: [],
      },
    });
    const result = serialize(event);
    expect(result).toContain('RRULE:FREQ=WEEKLY;COUNT=10;BYDAY=TU,TH');
  });

  it('serializes ORGANIZER', () => {
    const event = makeEvent({
      organizer: {
        email: 'organizer@example.com',
        displayName: 'Jane Doe',
        sentBy: null,
      },
    });
    const result = serialize(event);
    expect(result).toContain('ORGANIZER;CN=Jane Doe:mailto:organizer@example.com');
  });

  it('serializes ATTENDEE list', () => {
    const event = makeEvent({
      attendees: [
        { email: 'alice@example.com', displayName: 'Alice', status: 'accepted', role: 'required' },
        { email: 'bob@example.com', displayName: null, status: 'needs-action', role: 'optional' },
      ],
    });
    const result = serialize(event);
    const unfolded = unfold(result);
    expect(unfolded).toContain('ATTENDEE;CN=Alice;PARTSTAT=ACCEPTED;ROLE=REQ-PARTICIPANT:mailto:alice@example.com');
    expect(unfolded).toContain('ATTENDEE;PARTSTAT=NEEDS-ACTION;ROLE=OPT-PARTICIPANT:mailto:bob@example.com');
  });

  it('serializes opaque fields from the opaqueFields Map', () => {
    const opaqueFields = new Map<string, string>();
    opaqueFields.set('X-MICROSOFT-CDO-BUSYSTATUS', 'BUSY');
    opaqueFields.set('X-GOOGLE-CONFERENCE', 'https://meet.google.com/abc');

    const event = makeEvent({ opaqueFields });
    const result = serialize(event);
    expect(result).toContain('X-MICROSOFT-CDO-BUSYSTATUS:BUSY');
    expect(result).toContain('X-GOOGLE-CONFERENCE:https://meet.google.com/abc');
  });

  it('applies line folding to long lines', () => {
    const longDescription = 'A'.repeat(200);
    const event = makeEvent({ description: longDescription });
    const result = serialize(event);

    // Check that no raw line exceeds 75 octets
    const lines = result.split('\r\n');
    const encoder = new TextEncoder();
    for (const line of lines) {
      if (line.length > 0) {
        expect(encoder.encode(line).length).toBeLessThanOrEqual(75);
      }
    }
  });

  it('uses CRLF line endings', () => {
    const event = makeEvent();
    const result = serialize(event);
    // Should contain CRLF
    expect(result).toContain('\r\n');
    // Should not have bare LF (except within CRLF)
    const withoutCRLF = result.replace(/\r\n/g, '');
    expect(withoutCRLF).not.toContain('\n');
  });

  it('ends with CRLF', () => {
    const event = makeEvent();
    const result = serialize(event);
    expect(result.endsWith('\r\n')).toBe(true);
  });

  it('omits null description and location', () => {
    const event = makeEvent({ description: null, location: null });
    const result = serialize(event);
    expect(result).not.toContain('DESCRIPTION');
    expect(result).not.toContain('LOCATION');
  });

  it('serializes EXDATE lines for recurrence exceptions', () => {
    const event = makeEvent({
      recurrenceRule: {
        frequency: 'daily',
        interval: 1,
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
        exceptions: [
          new Date('2024-03-17T10:00:00Z'),
          new Date('2024-03-20T10:00:00Z'),
        ],
      },
    });
    const result = serialize(event);
    expect(result).toContain('EXDATE:20240317T100000Z');
    expect(result).toContain('EXDATE:20240320T100000Z');
  });

  it('serializes all-day event with DTSTART;VALUE=DATE format', () => {
    const event = makeEvent({
      isAllDay: true,
      startTime: new Date('2024-03-15T00:00:00Z'),
      endTime: new Date('2024-03-16T00:00:00Z'),
    });
    const result = serialize(event);
    expect(result).toContain('DTSTART;VALUE=DATE:20240315');
    expect(result).toContain('DTEND;VALUE=DATE:20240316');
    expect(result).not.toContain('DTSTART:2024');
  });
});

describe('round-trip: serialize then parse', () => {
  it('preserves EXDATE exceptions through round-trip', () => {
    const event = makeEvent({
      recurrenceRule: {
        frequency: 'weekly',
        interval: 1,
        count: 10,
        until: null,
        bySecond: null,
        byMinute: null,
        byHour: null,
        byDay: ['MO', 'WE'],
        byMonthDay: null,
        byYearDay: null,
        byWeekNo: null,
        byMonth: null,
        bySetPos: null,
        wkst: 'MO',
        exceptions: [
          new Date('2024-03-18T10:00:00Z'),
          new Date('2024-03-20T10:00:00Z'),
        ],
      },
    });

    const { parse } = require('../parser');
    const serialized = serialize(event);
    const parsed = parse(serialized);

    expect(parsed.success).toBe(true);
    expect(parsed.value?.recurrenceRule?.exceptions).toHaveLength(2);
    expect(parsed.value?.recurrenceRule?.exceptions[0]).toEqual(new Date('2024-03-18T10:00:00Z'));
    expect(parsed.value?.recurrenceRule?.exceptions[1]).toEqual(new Date('2024-03-20T10:00:00Z'));
  });

  it('preserves all fields through full round-trip (serialize → parse)', () => {
    const { parse } = require('../parser');

    const opaqueFields = new Map<string, string>();
    opaqueFields.set('X-MICROSOFT-CDO-BUSYSTATUS', 'BUSY');
    opaqueFields.set('X-CUSTOM-FIELD', 'custom-value-123');

    const event = makeEvent({
      id: 'roundtrip-full-test@calendar.app',
      title: 'Quarterly Review; Planning, Session',
      description: 'Discuss Q1 goals\nand Q2 planning',
      location: 'Room 101, Building A',
      startTime: new Date('2024-06-15T14:30:00Z'),
      endTime: new Date('2024-06-15T16:00:00Z'),
      timeZone: 'UTC',
      isAllDay: false,
      status: 'tentative',
      sequence: 5,
      organizer: {
        email: 'boss@example.com',
        displayName: 'The Boss',
        sentBy: 'assistant@example.com',
      },
      attendees: [
        { email: 'alice@example.com', displayName: 'Alice Smith', status: 'accepted', role: 'required' },
        { email: 'bob@example.com', displayName: 'Bob Jones', status: 'tentative', role: 'optional' },
        { email: 'carol@example.com', displayName: null, status: 'needs-action', role: 'chair' },
      ],
      recurrenceRule: {
        frequency: 'weekly',
        interval: 2,
        count: 12,
        until: null,
        bySecond: null,
        byMinute: null,
        byHour: null,
        byDay: ['TU', 'TH'],
        byMonthDay: null,
        byYearDay: null,
        byWeekNo: null,
        byMonth: null,
        bySetPos: null,
        wkst: 'MO',
        exceptions: [
          new Date('2024-06-18T14:30:00Z'),
          new Date('2024-06-25T14:30:00Z'),
        ],
      },
      opaqueFields,
    });

    const serialized = serialize(event);
    const parsed = parse(serialized);

    expect(parsed.success).toBe(true);
    const result = parsed.value!;

    // Core fields
    expect(result.id).toBe('roundtrip-full-test@calendar.app');
    expect(result.title).toBe('Quarterly Review; Planning, Session');
    expect(result.description).toBe('Discuss Q1 goals\nand Q2 planning');
    expect(result.location).toBe('Room 101, Building A');
    expect(result.startTime).toEqual(new Date('2024-06-15T14:30:00Z'));
    expect(result.endTime).toEqual(new Date('2024-06-15T16:00:00Z'));
    expect(result.status).toBe('tentative');
    expect(result.sequence).toBe(5);

    // Organizer
    expect(result.organizer?.email).toBe('boss@example.com');
    expect(result.organizer?.displayName).toBe('The Boss');
    expect(result.organizer?.sentBy).toBe('assistant@example.com');

    // Attendees
    expect(result.attendees).toHaveLength(3);
    expect(result.attendees[0].email).toBe('alice@example.com');
    expect(result.attendees[0].displayName).toBe('Alice Smith');
    expect(result.attendees[0].status).toBe('accepted');
    expect(result.attendees[0].role).toBe('required');
    expect(result.attendees[1].status).toBe('tentative');
    expect(result.attendees[1].role).toBe('optional');
    expect(result.attendees[2].status).toBe('needs-action');
    expect(result.attendees[2].role).toBe('chair');

    // Recurrence rule
    expect(result.recurrenceRule).not.toBeNull();
    expect(result.recurrenceRule?.frequency).toBe('weekly');
    expect(result.recurrenceRule?.interval).toBe(2);
    expect(result.recurrenceRule?.count).toBe(12);
    expect(result.recurrenceRule?.byDay).toEqual(['TU', 'TH']);
    expect(result.recurrenceRule?.exceptions).toHaveLength(2);

    // Opaque fields
    expect(result.opaqueFields.get('X-MICROSOFT-CDO-BUSYSTATUS')).toBe('BUSY');
    expect(result.opaqueFields.get('X-CUSTOM-FIELD')).toBe('custom-value-123');
  });

  it('preserves timezone through round-trip with VTIMEZONE', () => {
    const { parse } = require('../parser');

    const event = makeEvent({
      timeZone: 'America/New_York',
      startTime: new Date('2024-01-15T14:00:00Z'), // 9am EST
      endTime: new Date('2024-01-15T15:00:00Z'),   // 10am EST
    });

    const serialized = serialize(event);

    // Verify VTIMEZONE is emitted
    expect(serialized).toContain('BEGIN:VTIMEZONE');
    expect(serialized).toContain('TZID:America/New_York');
    expect(serialized).toContain('END:VTIMEZONE');

    // Verify DTSTART has TZID parameter
    expect(serialized).toContain('DTSTART;TZID=America/New_York:');

    // Parse it back
    const parsed = parse(serialized);
    expect(parsed.success).toBe(true);
    expect(parsed.value?.timeZone).toBe('America/New_York');
    // Times should be equivalent (converted back to UTC)
    expect(parsed.value?.startTime).toEqual(new Date('2024-01-15T14:00:00Z'));
    expect(parsed.value?.endTime).toEqual(new Date('2024-01-15T15:00:00Z'));
  });
});
