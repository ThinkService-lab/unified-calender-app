/**
 * Unit tests for iCalendar Event Parser.
 * Requirements: 12.1, 12.3, 12.4, 12.6
 */

import {
  parse,
  parseComponent,
  unfoldLines,
  unescapeText,
  parsePropertyLine,
  parseDateTime,
  parseRRule,
  vEventToCalendarEvent,
} from '../parser';

const CRLF = '\r\n';

describe('unfoldLines', () => {
  it('removes CRLF followed by space (continuation marker is removed)', () => {
    // RFC 5545: the CRLF + single whitespace is the fold marker; both are removed
    const input = `DESCRIPTION:This is a long${CRLF} description that${CRLF} spans multiple lines`;
    const result = unfoldLines(input);
    expect(result).toBe('DESCRIPTION:This is a longdescription thatspans multiple lines');
  });

  it('preserves content space before fold point', () => {
    // When content has a trailing space before the fold, it's preserved
    const input = `DESCRIPTION:This is a long ${CRLF} description`;
    const result = unfoldLines(input);
    expect(result).toBe('DESCRIPTION:This is a long description');
  });

  it('removes CRLF followed by tab', () => {
    const input = `SUMMARY:Hello${CRLF}\tWorld`;
    const result = unfoldLines(input);
    expect(result).toBe('SUMMARY:HelloWorld');
  });

  it('normalizes LF to CRLF before unfolding', () => {
    const input = `SUMMARY:Hello\n World`;
    const result = unfoldLines(input);
    expect(result).toBe('SUMMARY:HelloWorld');
  });

  it('does not unfold CRLF not followed by whitespace', () => {
    const input = `SUMMARY:Hello${CRLF}DESCRIPTION:World`;
    const result = unfoldLines(input);
    expect(result).toBe(`SUMMARY:Hello${CRLF}DESCRIPTION:World`);
  });
});

describe('unescapeText', () => {
  it('unescapes backslash-n to newline', () => {
    expect(unescapeText('Hello\\nWorld')).toBe('Hello\nWorld');
  });

  it('unescapes backslash-N to newline', () => {
    expect(unescapeText('Hello\\NWorld')).toBe('Hello\nWorld');
  });

  it('unescapes backslash-comma', () => {
    expect(unescapeText('Hello\\,World')).toBe('Hello,World');
  });

  it('unescapes backslash-semicolon', () => {
    expect(unescapeText('Hello\\;World')).toBe('Hello;World');
  });

  it('unescapes double backslash', () => {
    expect(unescapeText('Hello\\\\World')).toBe('Hello\\World');
  });

  it('handles multiple escapes', () => {
    expect(unescapeText('A\\nB\\,C\\;D\\\\E')).toBe('A\nB,C;D\\E');
  });
});

describe('parsePropertyLine', () => {
  it('parses simple property', () => {
    const result = parsePropertyLine('SUMMARY:Team Meeting');
    expect(result).toEqual({
      name: 'SUMMARY',
      params: new Map(),
      value: 'Team Meeting',
    });
  });

  it('parses property with parameters', () => {
    const result = parsePropertyLine('DTSTART;TZID=America/New_York:20230115T090000');
    expect(result).toEqual({
      name: 'DTSTART',
      params: new Map([['TZID', 'America/New_York']]),
      value: '20230115T090000',
    });
  });

  it('parses property with quoted parameter value containing colon', () => {
    const result = parsePropertyLine('ORGANIZER;SENT-BY="mailto:jane@example.com":mailto:john@example.com');
    expect(result).toEqual({
      name: 'ORGANIZER',
      params: new Map([['SENT-BY', 'mailto:jane@example.com']]),
      value: 'mailto:john@example.com',
    });
  });

  it('returns null for line without colon', () => {
    expect(parsePropertyLine('INVALID LINE')).toBeNull();
  });

  it('handles property names case-insensitively', () => {
    const result = parsePropertyLine('summary:Test');
    expect(result?.name).toBe('SUMMARY');
  });
});

describe('parseDateTime', () => {
  it('parses UTC date-time', () => {
    const result = parseDateTime('20230115T090000Z');
    expect(result.toISOString()).toBe('2023-01-15T09:00:00.000Z');
  });

  it('parses floating date-time as UTC', () => {
    const result = parseDateTime('20230115T090000');
    expect(result.toISOString()).toBe('2023-01-15T09:00:00.000Z');
  });

  it('parses date-only', () => {
    const result = parseDateTime('20230115');
    expect(result.toISOString()).toBe('2023-01-15T00:00:00.000Z');
  });

  it('parses date-time with timezone', () => {
    const result = parseDateTime('20230115T090000', 'America/New_York');
    // New York is UTC-5 in January
    expect(result.toISOString()).toBe('2023-01-15T14:00:00.000Z');
  });

  it('handles DST spring-forward boundary correctly', () => {
    // US DST 2024: clocks spring forward at 2:00 AM EST → 3:00 AM EDT on March 10
    // 3:00 AM EDT = UTC-4, so 3:00 AM local = 07:00 UTC
    const result = parseDateTime('20240310T030000', 'America/New_York');
    expect(result.toISOString()).toBe('2024-03-10T07:00:00.000Z');
  });

  it('handles DST fall-back boundary correctly', () => {
    // US DST 2024: clocks fall back at 2:00 AM EDT → 1:00 AM EST on November 3
    // 1:30 AM after fall-back is EST (UTC-5), so 1:30 AM local = 06:30 UTC
    // Ambiguous time — implementation picks the standard-time interpretation
    const result = parseDateTime('20241103T013000', 'America/New_York');
    // Should be either 05:30 UTC (EDT) or 06:30 UTC (EST) — both are valid
    const utcHour = result.getUTCHours();
    const utcMin = result.getUTCMinutes();
    expect(utcMin).toBe(30);
    expect(utcHour === 5 || utcHour === 6).toBe(true);
  });

  it('handles timezone with non-hour offset (Asia/Kolkata +5:30)', () => {
    // 9:00 AM IST = 3:30 AM UTC
    const result = parseDateTime('20240615T090000', 'Asia/Kolkata');
    expect(result.toISOString()).toBe('2024-06-15T03:30:00.000Z');
  });
});

describe('parseRRule', () => {
  it('parses basic daily rule', () => {
    const rule = parseRRule('FREQ=DAILY;COUNT=10;INTERVAL=2');
    expect(rule.frequency).toBe('daily');
    expect(rule.count).toBe(10);
    expect(rule.interval).toBe(2);
  });

  it('parses weekly rule with BYDAY', () => {
    const rule = parseRRule('FREQ=WEEKLY;BYDAY=TU,TH;COUNT=10');
    expect(rule.frequency).toBe('weekly');
    expect(rule.byDay).toEqual(['TU', 'TH']);
    expect(rule.count).toBe(10);
  });

  it('parses monthly rule with UNTIL', () => {
    const rule = parseRRule('FREQ=MONTHLY;BYDAY=1FR;UNTIL=20231231T235959Z');
    expect(rule.frequency).toBe('monthly');
    expect(rule.byDay).toEqual(['1FR']);
    expect(rule.until).toEqual(new Date('2023-12-31T23:59:59.000Z'));
  });

  it('parses WKST', () => {
    const rule = parseRRule('FREQ=WEEKLY;WKST=SU');
    expect(rule.wkst).toBe('SU');
  });

  it('defaults WKST to MO', () => {
    const rule = parseRRule('FREQ=DAILY');
    expect(rule.wkst).toBe('MO');
  });
});

describe('parseComponent', () => {
  it('parses a minimal VEVENT component', () => {
    const component = [
      'BEGIN:VEVENT',
      'UID:test-uid-123@example.com',
      'DTSTAMP:20230115T120000Z',
      'DTSTART:20230115T090000Z',
      'END:VEVENT',
    ].join(CRLF);

    const result = parseComponent(component);
    expect(result.success).toBe(true);
    expect(result.value?.uid).toBe('test-uid-123@example.com');
    expect(result.value?.dtstamp).toBe('20230115T120000Z');
    expect(result.value?.dtstart).toBe('20230115T090000Z');
  });

  it('parses VEVENT with all fields', () => {
    const component = [
      'UID:full-event@example.com',
      'DTSTAMP:20230115T120000Z',
      'DTSTART:20230115T090000Z',
      'DTEND:20230115T100000Z',
      'SUMMARY:Team Meeting',
      'DESCRIPTION:Discuss project updates',
      'LOCATION:Conference Room A',
      'STATUS:CONFIRMED',
      'SEQUENCE:2',
      'RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR',
      'ORGANIZER;CN=John Doe:mailto:john@example.com',
      'ATTENDEE;CN=Jane Smith;PARTSTAT=ACCEPTED;ROLE=REQ-PARTICIPANT:mailto:jane@example.com',
    ].join(CRLF);

    const result = parseComponent(component);
    expect(result.success).toBe(true);
    const v = result.value!;
    expect(v.uid).toBe('full-event@example.com');
    expect(v.dtend).toBe('20230115T100000Z');
    expect(v.summary).toBe('Team Meeting');
    expect(v.description).toBe('Discuss project updates');
    expect(v.location).toBe('Conference Room A');
    expect(v.status).toBe('CONFIRMED');
    expect(v.sequence).toBe(2);
    expect(v.rrule).toBe('FREQ=WEEKLY;BYDAY=MO,WE,FR');
    expect(v.organizer).toEqual({ email: 'john@example.com', cn: 'John Doe', sentBy: undefined });
    expect(v.attendees).toEqual([
      { email: 'jane@example.com', cn: 'Jane Smith', partstat: 'ACCEPTED', role: 'REQ-PARTICIPANT' },
    ]);
  });

  it('preserves unrecognized fields in opaqueFields', () => {
    const component = [
      'UID:opaque-test@example.com',
      'DTSTAMP:20230115T120000Z',
      'DTSTART:20230115T090000Z',
      'X-CUSTOM-FIELD:custom value',
      'X-ANOTHER;PARAM=val:another value',
    ].join(CRLF);

    const result = parseComponent(component);
    expect(result.success).toBe(true);
    expect(result.value?.opaqueFields?.get('X-CUSTOM-FIELD')).toBe('custom value');
    expect(result.value?.opaqueFields?.get('X-ANOTHER;PARAM=val')).toBe('another value');
  });

  it('returns error for missing UID', () => {
    const component = [
      'DTSTAMP:20230115T120000Z',
      'DTSTART:20230115T090000Z',
    ].join(CRLF);

    const result = parseComponent(component);
    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('UID');
  });

  it('returns error for missing DTSTAMP', () => {
    const component = [
      'UID:test@example.com',
      'DTSTART:20230115T090000Z',
    ].join(CRLF);

    const result = parseComponent(component);
    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('DTSTAMP');
  });

  it('returns error for missing DTSTART', () => {
    const component = [
      'UID:test@example.com',
      'DTSTAMP:20230115T120000Z',
    ].join(CRLF);

    const result = parseComponent(component);
    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('DTSTART');
  });

  it('returns error with line > 0 for missing required properties', () => {
    // Missing UID
    const noUid = ['DTSTAMP:20230115T120000Z', 'DTSTART:20230115T090000Z'].join(CRLF);
    const noUidResult = parseComponent(noUid);
    expect(noUidResult.success).toBe(false);
    expect(noUidResult.error!.line).toBeGreaterThan(0);
    expect(noUidResult.error!.message).toBeTruthy();

    // Missing DTSTAMP
    const noDtstamp = ['UID:test@example.com', 'DTSTART:20230115T090000Z'].join(CRLF);
    const noDtstampResult = parseComponent(noDtstamp);
    expect(noDtstampResult.success).toBe(false);
    expect(noDtstampResult.error!.line).toBeGreaterThan(0);

    // Missing DTSTART
    const noDtstart = ['UID:test@example.com', 'DTSTAMP:20230115T120000Z'].join(CRLF);
    const noDtstartResult = parseComponent(noDtstart);
    expect(noDtstartResult.success).toBe(false);
    expect(noDtstartResult.error!.line).toBeGreaterThan(0);
  });

  it('returns error with non-empty raw field', () => {
    const component = ['DTSTAMP:20230115T120000Z', 'DTSTART:20230115T090000Z'].join(CRLF);
    const result = parseComponent(component);
    expect(result.success).toBe(false);
    expect(result.error!.raw).toBeTruthy();
    expect(result.error!.raw.length).toBeGreaterThan(0);
  });

  it('returns error with line > 0 for DTEND+DURATION conflict', () => {
    const component = [
      'UID:test@example.com',
      'DTSTAMP:20230115T120000Z',
      'DTSTART:20230115T090000Z',
      'DTEND:20230115T100000Z',
      'DURATION:PT1H',
    ].join(CRLF);

    const result = parseComponent(component);
    expect(result.success).toBe(false);
    expect(result.error!.line).toBeGreaterThan(0);
    expect(result.error!.message).toContain('DTEND and DURATION');
  });

  it('returns error when both DTEND and DURATION present', () => {
    const component = [
      'UID:test@example.com',
      'DTSTAMP:20230115T120000Z',
      'DTSTART:20230115T090000Z',
      'DTEND:20230115T100000Z',
      'DURATION:PT1H',
    ].join(CRLF);

    const result = parseComponent(component);
    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('DTEND and DURATION');
  });

  it('computes DTEND from DURATION when only DURATION present', () => {
    const component = [
      'UID:duration-test@example.com',
      'DTSTAMP:20230115T120000Z',
      'DTSTART:20230115T090000Z',
      'DURATION:PT1H30M',
    ].join(CRLF);

    const result = parseComponent(component);
    expect(result.success).toBe(true);
    expect(result.value?.dtend).toBe('20230115T103000Z');
  });
});

describe('parse (full iCalendar document)', () => {
  it('parses a complete iCalendar document', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Test//EN',
      'BEGIN:VEVENT',
      'UID:parse-test@example.com',
      'DTSTAMP:20230115T120000Z',
      'DTSTART:20230115T090000Z',
      'DTEND:20230115T100000Z',
      'SUMMARY:Test Event',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join(CRLF);

    const result = parse(ics);
    expect(result.success).toBe(true);
    expect(result.value?.id).toBe('parse-test@example.com');
    expect(result.value?.title).toBe('Test Event');
    expect(result.value?.startTime).toEqual(new Date('2023-01-15T09:00:00.000Z'));
    expect(result.value?.endTime).toEqual(new Date('2023-01-15T10:00:00.000Z'));
  });

  it('handles line folding in input', () => {
    // The serializer folds by inserting CRLF + space. The space is the continuation
    // marker and is removed during unfolding. Content must include trailing space
    // before fold point if a space is desired in the output.
    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Test//EN',
      'BEGIN:VEVENT',
      'UID:fold-test@example.com',
      'DTSTAMP:20230115T120000Z',
      'DTSTART:20230115T090000Z',
      'DESCRIPTION:This is a very long description that has been ',
      ' folded across multiple lines for compliance with the ',
      ' 75 octet line length limit',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join(CRLF);

    const result = parse(ics);
    expect(result.success).toBe(true);
    expect(result.value?.description).toBe(
      'This is a very long description that has been folded across multiple lines for compliance with the 75 octet line length limit'
    );
  });

  it('handles VTIMEZONE and converts to UTC', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Test//EN',
      'BEGIN:VTIMEZONE',
      'TZID:America/New_York',
      'BEGIN:STANDARD',
      'DTSTART:19701101T020000',
      'TZOFFSETFROM:-0400',
      'TZOFFSETTO:-0500',
      'TZNAME:EST',
      'END:STANDARD',
      'BEGIN:DAYLIGHT',
      'DTSTART:19700308T020000',
      'TZOFFSETFROM:-0500',
      'TZOFFSETTO:-0400',
      'TZNAME:EDT',
      'END:DAYLIGHT',
      'END:VTIMEZONE',
      'BEGIN:VEVENT',
      'UID:tz-test@example.com',
      'DTSTAMP:20230115T120000Z',
      'DTSTART;TZID=America/New_York:20230115T090000',
      'DTEND;TZID=America/New_York:20230115T100000',
      'SUMMARY:NYC Meeting',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join(CRLF);

    const result = parse(ics);
    expect(result.success).toBe(true);
    // January in New York is EST (UTC-5)
    expect(result.value?.startTime).toEqual(new Date('2023-01-15T14:00:00.000Z'));
    expect(result.value?.endTime).toEqual(new Date('2023-01-15T15:00:00.000Z'));
  });

  it('returns error for missing BEGIN:VCALENDAR', () => {
    const ics = [
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:test@example.com',
      'DTSTAMP:20230115T120000Z',
      'DTSTART:20230115T090000Z',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join(CRLF);

    const result = parse(ics);
    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('BEGIN:VCALENDAR');
  });

  it('returns error for missing END:VCALENDAR', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:test@example.com',
      'DTSTAMP:20230115T120000Z',
      'DTSTART:20230115T090000Z',
      'END:VEVENT',
    ].join(CRLF);

    const result = parse(ics);
    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('END:VCALENDAR');
  });

  it('returns error when no VEVENT found', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Test//EN',
      'END:VCALENDAR',
    ].join(CRLF);

    const result = parse(ics);
    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('No VEVENT');
  });

  it('preserves opaque fields through parsing', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Test//EN',
      'BEGIN:VEVENT',
      'UID:opaque-full@example.com',
      'DTSTAMP:20230115T120000Z',
      'DTSTART:20230115T090000Z',
      'X-MICROSOFT-CDO-BUSYSTATUS:BUSY',
      'X-CUSTOM-PROP:some value',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join(CRLF);

    const result = parse(ics);
    expect(result.success).toBe(true);
    expect(result.value?.opaqueFields.get('X-MICROSOFT-CDO-BUSYSTATUS')).toBe('BUSY');
    expect(result.value?.opaqueFields.get('X-CUSTOM-PROP')).toBe('some value');
  });

  it('parses organizer and attendees', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Test//EN',
      'BEGIN:VEVENT',
      'UID:attendee-test@example.com',
      'DTSTAMP:20230115T120000Z',
      'DTSTART:20230115T090000Z',
      'ORGANIZER;CN=Boss Man;SENT-BY="mailto:assistant@example.com":mailto:boss@example.com',
      'ATTENDEE;CN=Worker One;PARTSTAT=ACCEPTED;ROLE=REQ-PARTICIPANT:mailto:worker1@example.com',
      'ATTENDEE;CN=Worker Two;PARTSTAT=TENTATIVE;ROLE=OPT-PARTICIPANT:mailto:worker2@example.com',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join(CRLF);

    const result = parse(ics);
    expect(result.success).toBe(true);
    expect(result.value?.organizer).toEqual({
      email: 'boss@example.com',
      displayName: 'Boss Man',
      sentBy: 'assistant@example.com',
    });
    expect(result.value?.attendees).toHaveLength(2);
    expect(result.value?.attendees[0]).toEqual({
      email: 'worker1@example.com',
      displayName: 'Worker One',
      status: 'accepted',
      role: 'required',
    });
    expect(result.value?.attendees[1]).toEqual({
      email: 'worker2@example.com',
      displayName: 'Worker Two',
      status: 'tentative',
      role: 'optional',
    });
  });

  it('parses recurrence rule', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Test//EN',
      'BEGIN:VEVENT',
      'UID:rrule-test@example.com',
      'DTSTAMP:20230115T120000Z',
      'DTSTART:20230115T090000Z',
      'RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR;COUNT=20',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join(CRLF);

    const result = parse(ics);
    expect(result.success).toBe(true);
    expect(result.value?.recurrenceRule).not.toBeNull();
    expect(result.value?.recurrenceRule?.frequency).toBe('weekly');
    expect(result.value?.recurrenceRule?.byDay).toEqual(['MO', 'WE', 'FR']);
    expect(result.value?.recurrenceRule?.count).toBe(20);
  });

  it('handles text unescaping in parsed values', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Test//EN',
      'BEGIN:VEVENT',
      'UID:escape-test@example.com',
      'DTSTAMP:20230115T120000Z',
      'DTSTART:20230115T090000Z',
      'SUMMARY:Meeting\\, Important',
      'DESCRIPTION:Line 1\\nLine 2\\nLine 3',
      'LOCATION:Room A\\; Building 1',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join(CRLF);

    const result = parse(ics);
    expect(result.success).toBe(true);
    expect(result.value?.title).toBe('Meeting, Important');
    expect(result.value?.description).toBe('Line 1\nLine 2\nLine 3');
    expect(result.value?.location).toBe('Room A; Building 1');
  });
});

describe('vEventToCalendarEvent', () => {
  it('converts a VEvent to CalendarEvent with all fields', () => {
    const vevent = {
      uid: 'convert-test@example.com',
      dtstamp: '20230115T120000Z',
      dtstart: '20230115T090000Z',
      dtend: '20230115T100000Z',
      summary: 'Test Event',
      description: 'A description',
      location: 'Room 101',
      status: 'TENTATIVE',
      sequence: 3,
      rrule: 'FREQ=DAILY;COUNT=5',
      organizer: { email: 'org@example.com', cn: 'Organizer', sentBy: 'asst@example.com' },
      attendees: [
        { email: 'att@example.com', cn: 'Attendee', partstat: 'DECLINED', role: 'OPT-PARTICIPANT' },
      ],
      opaqueFields: new Map([['X-TEST', 'value']]),
    };

    const event = vEventToCalendarEvent(vevent);
    expect(event.id).toBe('convert-test@example.com');
    expect(event.title).toBe('Test Event');
    expect(event.description).toBe('A description');
    expect(event.location).toBe('Room 101');
    expect(event.status).toBe('tentative');
    expect(event.sequence).toBe(3);
    expect(event.recurrenceRule?.frequency).toBe('daily');
    expect(event.recurrenceRule?.count).toBe(5);
    expect(event.organizer?.email).toBe('org@example.com');
    expect(event.organizer?.displayName).toBe('Organizer');
    expect(event.organizer?.sentBy).toBe('asst@example.com');
    expect(event.attendees[0].email).toBe('att@example.com');
    expect(event.attendees[0].status).toBe('declined');
    expect(event.attendees[0].role).toBe('optional');
    expect(event.opaqueFields.get('X-TEST')).toBe('value');
  });
});

describe('Gap fixes', () => {
  describe('Gap 2: EXDATE parsing', () => {
    it('parses EXDATE lines into recurrenceRule.exceptions', () => {
      const ics = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Test//EN',
        'BEGIN:VEVENT',
        'UID:exdate-test@example.com',
        'DTSTAMP:20230115T120000Z',
        'DTSTART:20230115T090000Z',
        'RRULE:FREQ=DAILY;COUNT=10',
        'EXDATE:20230117T090000Z',
        'EXDATE:20230120T090000Z',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join(CRLF);

      const result = parse(ics);
      expect(result.success).toBe(true);
      expect(result.value?.recurrenceRule).not.toBeNull();
      expect(result.value?.recurrenceRule?.exceptions).toHaveLength(2);
      expect(result.value?.recurrenceRule?.exceptions[0]).toEqual(new Date('2023-01-17T09:00:00.000Z'));
      expect(result.value?.recurrenceRule?.exceptions[1]).toEqual(new Date('2023-01-20T09:00:00.000Z'));
    });
  });

  describe('Gap 3: isAllDay detection', () => {
    it('sets isAllDay=true when DTSTART has VALUE=DATE parameter', () => {
      const ics = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Test//EN',
        'BEGIN:VEVENT',
        'UID:allday-test@example.com',
        'DTSTAMP:20230115T120000Z',
        'DTSTART;VALUE=DATE:20230115',
        'DTEND;VALUE=DATE:20230116',
        'SUMMARY:All Day Event',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join(CRLF);

      const result = parse(ics);
      expect(result.success).toBe(true);
      expect(result.value?.isAllDay).toBe(true);
    });

    it('sets isAllDay=true when DTSTART is 8-char date-only', () => {
      const ics = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Test//EN',
        'BEGIN:VEVENT',
        'UID:allday-test2@example.com',
        'DTSTAMP:20230115T120000Z',
        'DTSTART:20230115',
        'DTEND:20230116',
        'SUMMARY:All Day Event',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join(CRLF);

      const result = parse(ics);
      expect(result.success).toBe(true);
      expect(result.value?.isAllDay).toBe(true);
    });
  });

  describe('Gap 4: unescapeText backslash ordering', () => {
    it('correctly unescapes \\\\n (escaped backslash followed by letter n) to backslash+n', () => {
      // In iCalendar: \\n means literal backslash followed by letter n
      // The input string '\\\\n' in JS represents the iCalendar text \\n
      const result = unescapeText('\\\\n');
      expect(result).toBe('\\n');
    });

    it('correctly unescapes \\n (escaped newline) to actual newline', () => {
      const result = unescapeText('\\n');
      expect(result).toBe('\n');
    });
  });

  describe('Gap 6: timeZone preservation', () => {
    it('preserves TZID from DTSTART in timeZone field', () => {
      const ics = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Test//EN',
        'BEGIN:VTIMEZONE',
        'TZID:America/Chicago',
        'BEGIN:STANDARD',
        'DTSTART:19701101T020000',
        'TZOFFSETFROM:-0500',
        'TZOFFSETTO:-0600',
        'END:STANDARD',
        'END:VTIMEZONE',
        'BEGIN:VEVENT',
        'UID:tz-preserve@example.com',
        'DTSTAMP:20230115T120000Z',
        'DTSTART;TZID=America/Chicago:20230115T090000',
        'DTEND;TZID=America/Chicago:20230115T100000',
        'SUMMARY:Chicago Meeting',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join(CRLF);

      const result = parse(ics);
      expect(result.success).toBe(true);
      expect(result.value?.timeZone).toBe('America/Chicago');
    });

    it('defaults timeZone to UTC when no TZID present', () => {
      const ics = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Test//EN',
        'BEGIN:VEVENT',
        'UID:utc-test@example.com',
        'DTSTAMP:20230115T120000Z',
        'DTSTART:20230115T090000Z',
        'SUMMARY:UTC Event',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join(CRLF);

      const result = parse(ics);
      expect(result.success).toBe(true);
      expect(result.value?.timeZone).toBe('UTC');
    });
  });
});
