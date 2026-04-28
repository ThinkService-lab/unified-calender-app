/**
 * iCalendar Event Serializer - RFC 5545 compliant.
 * Produces valid iCalendar output from CalendarEvent objects.
 * Requirements: 12.2
 */

import { CalendarEvent, RecurrenceRule, Attendee, Organizer } from '../types/models';
import { VEvent, VAttendee, VOrganizer } from './types';

const CRLF = '\r\n';
const MAX_LINE_OCTETS = 75;
const PRODID = '-//UnifiedCalendarApp//EN';

/**
 * Escapes text values per RFC 5545 Section 3.3.11.
 * Escapes: backslash, semicolon, comma, newline.
 * Does NOT escape colons.
 */
export function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/**
 * Folds a content line so no line exceeds 75 octets.
 * Uses CRLF followed by a single space for continuation.
 */
export function foldLine(line: string): string {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(line);

  if (bytes.length <= MAX_LINE_OCTETS) {
    return line;
  }

  const parts: string[] = [];
  let currentStart = 0;

  // First line: up to 75 octets
  let cutPoint = findCutPoint(line, currentStart, MAX_LINE_OCTETS);
  parts.push(line.slice(currentStart, cutPoint));
  currentStart = cutPoint;

  // Continuation lines: up to 74 octets of content (75 - 1 for leading space)
  while (currentStart < line.length) {
    cutPoint = findCutPoint(line, currentStart, MAX_LINE_OCTETS - 1);
    parts.push(' ' + line.slice(currentStart, cutPoint));
    currentStart = cutPoint;
  }

  return parts.join(CRLF);
}

/**
 * Finds the maximum character index such that the UTF-8 byte length
 * of line.slice(start, index) does not exceed maxOctets.
 */
function findCutPoint(line: string, start: number, maxOctets: number): number {
  const encoder = new TextEncoder();
  let end = start;

  while (end < line.length) {
    const nextEnd = end + 1;
    const slice = line.slice(start, nextEnd);
    if (encoder.encode(slice).length > maxOctets) {
      break;
    }
    end = nextEnd;
  }

  return end === start ? start + 1 : end;
}

/**
 * Formats a Date as UTC iCalendar date-time: YYYYMMDDTHHMMSSZ
 */
export function formatDateTimeUTC(date: Date): string {
  const y = date.getUTCFullYear().toString().padStart(4, '0');
  const m = (date.getUTCMonth() + 1).toString().padStart(2, '0');
  const d = date.getUTCDate().toString().padStart(2, '0');
  const h = date.getUTCHours().toString().padStart(2, '0');
  const min = date.getUTCMinutes().toString().padStart(2, '0');
  const s = date.getUTCSeconds().toString().padStart(2, '0');
  return `${y}${m}${d}T${h}${min}${s}Z`;
}

/**
 * Serializes a RecurrenceRule to an RRULE value string.
 * FREQ is always first per RFC 5545.
 */
export function serializeRRule(rule: RecurrenceRule): string {
  const parts: string[] = [];

  parts.push(`FREQ=${rule.frequency.toUpperCase()}`);

  if (rule.interval > 1) {
    parts.push(`INTERVAL=${rule.interval}`);
  }

  if (rule.count != null) {
    parts.push(`COUNT=${rule.count}`);
  } else if (rule.until != null) {
    parts.push(`UNTIL=${formatDateTimeUTC(rule.until)}`);
  }

  if (rule.bySecond?.length) {
    parts.push(`BYSECOND=${rule.bySecond.join(',')}`);
  }
  if (rule.byMinute?.length) {
    parts.push(`BYMINUTE=${rule.byMinute.join(',')}`);
  }
  if (rule.byHour?.length) {
    parts.push(`BYHOUR=${rule.byHour.join(',')}`);
  }
  if (rule.byDay?.length) {
    parts.push(`BYDAY=${rule.byDay.join(',')}`);
  }
  if (rule.byMonthDay?.length) {
    parts.push(`BYMONTHDAY=${rule.byMonthDay.join(',')}`);
  }
  if (rule.byYearDay?.length) {
    parts.push(`BYYEARDAY=${rule.byYearDay.join(',')}`);
  }
  if (rule.byWeekNo?.length) {
    parts.push(`BYWEEKNO=${rule.byWeekNo.join(',')}`);
  }
  if (rule.byMonth?.length) {
    parts.push(`BYMONTH=${rule.byMonth.join(',')}`);
  }
  if (rule.bySetPos?.length) {
    parts.push(`BYSETPOS=${rule.bySetPos.join(',')}`);
  }

  if (rule.wkst && rule.wkst !== 'MO') {
    parts.push(`WKST=${rule.wkst}`);
  }

  return parts.join(';');
}


/**
 * Maps attendee status from model to iCalendar PARTSTAT value.
 */
function mapPartstat(status: Attendee['status']): string {
  switch (status) {
    case 'accepted': return 'ACCEPTED';
    case 'declined': return 'DECLINED';
    case 'tentative': return 'TENTATIVE';
    case 'needs-action': return 'NEEDS-ACTION';
    default: return 'NEEDS-ACTION';
  }
}

/**
 * Maps attendee role from model to iCalendar ROLE value.
 */
function mapRole(role: Attendee['role']): string {
  switch (role) {
    case 'required': return 'REQ-PARTICIPANT';
    case 'optional': return 'OPT-PARTICIPANT';
    case 'chair': return 'CHAIR';
    default: return 'REQ-PARTICIPANT';
  }
}

/**
 * Maps event status from model to iCalendar STATUS value.
 */
function mapStatus(status: CalendarEvent['status']): string {
  switch (status) {
    case 'confirmed': return 'CONFIRMED';
    case 'tentative': return 'TENTATIVE';
    case 'cancelled': return 'CANCELLED';
    default: return 'CONFIRMED';
  }
}

/**
 * Serializes an ORGANIZER property line with parameters.
 */
function serializeOrganizer(organizer: Organizer): string {
  const params: string[] = [];

  if (organizer.displayName) {
    params.push(`CN=${organizer.displayName}`);
  }
  if (organizer.sentBy) {
    params.push(`SENT-BY="mailto:${organizer.sentBy}"`);
  }

  const paramStr = params.length > 0 ? ';' + params.join(';') : '';
  return `ORGANIZER${paramStr}:mailto:${organizer.email}`;
}

/**
 * Adds a content line to the output, applying line folding.
 */
function addLine(lines: string[], line: string): void {
  lines.push(foldLine(line));
}

/**
 * Formats a Date as date-only iCalendar format: YYYYMMDD
 */
function formatDateOnly(date: Date): string {
  const y = date.getUTCFullYear().toString().padStart(4, '0');
  const m = (date.getUTCMonth() + 1).toString().padStart(2, '0');
  const d = date.getUTCDate().toString().padStart(2, '0');
  return `${y}${m}${d}`;
}

/**
 * Formats a UTC Date as a local date-time string in the given timezone.
 * Output format: YYYYMMDDTHHMMSS (no trailing Z, used with TZID parameter).
 */
function formatDateTimeLocal(date: Date, timeZone: string): string {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    const parts = formatter.formatToParts(date);
    const get = (type: string) => parts.find(p => p.type === type)?.value ?? '00';
    const h = get('hour') === '24' ? '00' : get('hour');
    return `${get('year')}${get('month')}${get('day')}T${h}${get('minute')}${get('second')}`;
  } catch {
    // Fallback to UTC if timezone is not recognized
    return formatDateTimeUTC(date);
  }
}

/**
 * Converts a CalendarEvent to a VEvent intermediate representation.
 */
export function eventToVEvent(event: CalendarEvent): VEvent {
  const hasNonUtcTz = event.timeZone && event.timeZone !== 'UTC' && !event.isAllDay;

  const vevent: VEvent = {
    uid: event.id,
    dtstamp: formatDateTimeUTC(event.dtstamp),
    dtstart: event.isAllDay
      ? formatDateOnly(event.startTime)
      : hasNonUtcTz
        ? formatDateTimeLocal(event.startTime, event.timeZone)
        : formatDateTimeUTC(event.startTime),
    dtend: event.isAllDay
      ? formatDateOnly(event.endTime)
      : hasNonUtcTz
        ? formatDateTimeLocal(event.endTime, event.timeZone)
        : formatDateTimeUTC(event.endTime),
    summary: event.title,
    description: event.description ?? undefined,
    location: event.location ?? undefined,
    status: mapStatus(event.status),
    sequence: event.sequence,
    isAllDay: event.isAllDay || undefined,
    timeZone: event.timeZone !== 'UTC' ? event.timeZone : undefined,
    opaqueFields: event.opaqueFields,
  };

  if (event.recurrenceRule) {
    vevent.rrule = serializeRRule(event.recurrenceRule);
    // Serialize EXDATE exceptions
    if (event.recurrenceRule.exceptions.length > 0) {
      vevent.exdates = event.recurrenceRule.exceptions.map((d) => formatDateTimeUTC(d));
    }
  }

  if (event.organizer) {
    vevent.organizer = {
      email: event.organizer.email,
      cn: event.organizer.displayName ?? undefined,
      sentBy: event.organizer.sentBy ?? undefined,
    };
  }

  if (event.attendees.length > 0) {
    vevent.attendees = event.attendees.map((a) => ({
      email: a.email,
      cn: a.displayName ?? undefined,
      partstat: mapPartstat(a.status),
      role: mapRole(a.role),
    }));
  }

  return vevent;
}

/**
 * Serializes a VEvent to iCalendar VEVENT component lines (without BEGIN/END wrappers).
 */
export function serializeComponent(vevent: VEvent): string {
  const lines: string[] = [];

  addLine(lines, 'BEGIN:VEVENT');
  addLine(lines, `UID:${vevent.uid}`);
  addLine(lines, `DTSTAMP:${vevent.dtstamp}`);

  if (vevent.isAllDay) {
    addLine(lines, `DTSTART;VALUE=DATE:${vevent.dtstart}`);
  } else if (vevent.timeZone) {
    addLine(lines, `DTSTART;TZID=${vevent.timeZone}:${vevent.dtstart}`);
  } else {
    addLine(lines, `DTSTART:${vevent.dtstart}`);
  }

  if (vevent.dtend) {
    if (vevent.isAllDay) {
      addLine(lines, `DTEND;VALUE=DATE:${vevent.dtend}`);
    } else if (vevent.timeZone) {
      addLine(lines, `DTEND;TZID=${vevent.timeZone}:${vevent.dtend}`);
    } else {
      addLine(lines, `DTEND:${vevent.dtend}`);
    }
  }

  if (vevent.summary) {
    addLine(lines, `SUMMARY:${escapeText(vevent.summary)}`);
  }

  if (vevent.description) {
    addLine(lines, `DESCRIPTION:${escapeText(vevent.description)}`);
  }

  if (vevent.location) {
    addLine(lines, `LOCATION:${escapeText(vevent.location)}`);
  }

  if (vevent.status) {
    addLine(lines, `STATUS:${vevent.status}`);
  }

  if (vevent.sequence != null) {
    addLine(lines, `SEQUENCE:${vevent.sequence}`);
  }

  if (vevent.rrule) {
    addLine(lines, `RRULE:${vevent.rrule}`);
  }

  // Serialize EXDATE lines
  if (vevent.exdates) {
    for (const exdate of vevent.exdates) {
      addLine(lines, `EXDATE:${exdate}`);
    }
  }

  if (vevent.organizer) {
    addLine(lines, serializeOrganizer({
      email: vevent.organizer.email,
      displayName: vevent.organizer.cn ?? null,
      sentBy: vevent.organizer.sentBy ?? null,
    }));
  }

  if (vevent.attendees) {
    for (const att of vevent.attendees) {
      const params: string[] = [];
      if (att.cn) params.push(`CN=${att.cn}`);
      if (att.partstat) params.push(`PARTSTAT=${att.partstat}`);
      if (att.role) params.push(`ROLE=${att.role}`);
      const paramStr = params.length > 0 ? ';' + params.join(';') : '';
      addLine(lines, `ATTENDEE${paramStr}:mailto:${att.email}`);
    }
  }

  // Serialize opaque fields (preserved unknown properties)
  if (vevent.opaqueFields) {
    vevent.opaqueFields.forEach((value, key) => {
      addLine(lines, `${key}:${value}`);
    });
  }

  addLine(lines, 'END:VEVENT');

  return lines.join(CRLF);
}

/**
 * Generates a minimal VTIMEZONE component for the given IANA timezone ID.
 * Uses Intl.DateTimeFormat to determine standard/daylight offsets.
 */
function generateVTimezone(tzid: string): string {
  const lines: string[] = [];
  addLine(lines, 'BEGIN:VTIMEZONE');
  addLine(lines, `TZID:${tzid}`);

  // Determine offsets for January (standard) and July (daylight)
  try {
    const janOffset = getUtcOffsetString(tzid, new Date(Date.UTC(2024, 0, 15)));
    const julOffset = getUtcOffsetString(tzid, new Date(Date.UTC(2024, 6, 15)));

    if (janOffset !== julOffset) {
      // Has daylight saving time
      addLine(lines, 'BEGIN:STANDARD');
      addLine(lines, 'DTSTART:19701101T020000');
      addLine(lines, `TZOFFSETFROM:${julOffset}`);
      addLine(lines, `TZOFFSETTO:${janOffset}`);
      addLine(lines, 'END:STANDARD');
      addLine(lines, 'BEGIN:DAYLIGHT');
      addLine(lines, 'DTSTART:19700308T020000');
      addLine(lines, `TZOFFSETFROM:${janOffset}`);
      addLine(lines, `TZOFFSETTO:${julOffset}`);
      addLine(lines, 'END:DAYLIGHT');
    } else {
      // No DST — single STANDARD component
      addLine(lines, 'BEGIN:STANDARD');
      addLine(lines, 'DTSTART:19700101T000000');
      addLine(lines, `TZOFFSETFROM:${janOffset}`);
      addLine(lines, `TZOFFSETTO:${janOffset}`);
      addLine(lines, 'END:STANDARD');
    }
  } catch {
    // Fallback: emit a minimal STANDARD component with +0000
    addLine(lines, 'BEGIN:STANDARD');
    addLine(lines, 'DTSTART:19700101T000000');
    addLine(lines, 'TZOFFSETFROM:+0000');
    addLine(lines, 'TZOFFSETTO:+0000');
    addLine(lines, 'END:STANDARD');
  }

  addLine(lines, 'END:VTIMEZONE');
  return lines.join(CRLF);
}

/**
 * Returns the UTC offset string (e.g., "-0500", "+0530") for a timezone at a given date.
 */
function getUtcOffsetString(tzid: string, date: Date): string {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: tzid,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const get = (type: string) => parseInt(parts.find(p => p.type === type)?.value ?? '0', 10);

  const localH = get('hour') === 24 ? 0 : get('hour');
  const localAsUTC = new Date(Date.UTC(get('year'), get('month') - 1, get('day'), localH, get('minute'), get('second')));
  const offsetMs = localAsUTC.getTime() - date.getTime();
  const totalMinutes = Math.round(offsetMs / 60000);
  const sign = totalMinutes >= 0 ? '+' : '-';
  const absMinutes = Math.abs(totalMinutes);
  const hours = Math.floor(absMinutes / 60).toString().padStart(2, '0');
  const minutes = (absMinutes % 60).toString().padStart(2, '0');
  return `${sign}${hours}${minutes}`;
}

/**
 * Serializes a CalendarEvent to a full iCalendar document string.
 * Wraps the VEVENT in BEGIN:VCALENDAR / END:VCALENDAR with VERSION and PRODID.
 * Emits a VTIMEZONE component when the event uses a non-UTC timezone.
 */
export function serialize(event: CalendarEvent): string {
  const vevent = eventToVEvent(event);
  const lines: string[] = [];

  addLine(lines, 'BEGIN:VCALENDAR');
  addLine(lines, 'VERSION:2.0');
  addLine(lines, `PRODID:${PRODID}`);

  // Emit VTIMEZONE if the event has a non-UTC timezone
  if (vevent.timeZone && !event.isAllDay) {
    lines.push(generateVTimezone(vevent.timeZone));
  }

  lines.push(serializeComponent(vevent));
  addLine(lines, 'END:VCALENDAR');

  return lines.join(CRLF) + CRLF;
}
