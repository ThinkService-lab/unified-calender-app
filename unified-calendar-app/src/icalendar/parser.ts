/**
 * iCalendar Event Parser - RFC 5545 compliant.
 * Parses iCalendar data into CalendarEvent objects.
 * Requirements: 12.1, 12.3, 12.4, 12.6
 */

import { CalendarEvent, RecurrenceRule, Attendee, Organizer } from '../types/models';
import { ParseResult, ParseError } from '../types/parser';
import { VEvent, VAttendee, VOrganizer } from './types';

/**
 * Unfolds content lines per RFC 5545 Section 3.1.
 * Removes CRLF followed by a single whitespace (SPACE or HTAB).
 */
export function unfoldLines(icsData: string): string {
  // Normalize line endings to CRLF first
  const normalized = icsData.replace(/\r\n|\r|\n/g, '\r\n');
  // Remove CRLF followed by a single space or tab (line continuation)
  return normalized.replace(/\r\n[ \t]/g, '');
}

/**
 * Unescapes text values per RFC 5545 Section 3.3.11.
 * Double-backslash must be processed first to avoid incorrect matches.
 */
export function unescapeText(value: string): string {
  return value
    .replace(/\\\\/g, '\0ESCAPED_BACKSLASH\0')
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\0ESCAPED_BACKSLASH\0/g, '\\');
}

/**
 * Parses a property line into name, parameters, and value.
 * Format: NAME;PARAM1=VAL1;PARAM2=VAL2:VALUE
 */
export function parsePropertyLine(line: string): { name: string; params: Map<string, string>; value: string } | null {
  // Find the colon that separates name+params from value
  // Must handle quoted parameter values that may contain colons
  let colonIndex = -1;
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ':' && !inQuotes) {
      colonIndex = i;
      break;
    }
  }

  if (colonIndex === -1) {
    return null;
  }

  const nameAndParams = line.slice(0, colonIndex);
  const value = line.slice(colonIndex + 1);

  // Split name from parameters
  const params = new Map<string, string>();
  let name: string;

  const semiIndex = findUnquotedSemicolon(nameAndParams);
  if (semiIndex === -1) {
    name = nameAndParams.toUpperCase();
  } else {
    name = nameAndParams.slice(0, semiIndex).toUpperCase();
    const paramStr = nameAndParams.slice(semiIndex + 1);
    parseParams(paramStr, params);
  }

  return { name, params, value };
}

/**
 * Finds the first unquoted semicolon in a string.
 */
function findUnquotedSemicolon(str: string): number {
  let inQuotes = false;
  for (let i = 0; i < str.length; i++) {
    if (str[i] === '"') {
      inQuotes = !inQuotes;
    } else if (str[i] === ';' && !inQuotes) {
      return i;
    }
  }
  return -1;
}

/**
 * Parses parameter string into a Map.
 * Handles quoted values and multiple parameters separated by semicolons.
 */
function parseParams(paramStr: string, params: Map<string, string>): void {
  // Split on unquoted semicolons
  const parts: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < paramStr.length; i++) {
    const ch = paramStr[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      current += ch;
    } else if (ch === ';' && !inQuotes) {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current) {
    parts.push(current);
  }

  for (const part of parts) {
    const eqIndex = part.indexOf('=');
    if (eqIndex === -1) continue;
    const key = part.slice(0, eqIndex).toUpperCase();
    let val = part.slice(eqIndex + 1);
    // Remove surrounding quotes
    if (val.startsWith('"') && val.endsWith('"')) {
      val = val.slice(1, -1);
    }
    params.set(key, val);
  }
}

/**
 * Parses a date-time string in iCalendar format.
 * Supports: YYYYMMDDTHHMMSSZ (UTC), YYYYMMDDTHHMMSS (local/floating), YYYYMMDD (date only)
 */
export function parseDateTime(value: string, tzid?: string): Date {
  // Date only: YYYYMMDD
  if (value.length === 8 && !value.includes('T')) {
    const y = parseInt(value.slice(0, 4), 10);
    const m = parseInt(value.slice(4, 6), 10) - 1;
    const d = parseInt(value.slice(6, 8), 10);
    return new Date(Date.UTC(y, m, d));
  }

  // Date-time: YYYYMMDDTHHMMSS or YYYYMMDDTHHMMSSZ
  const dateStr = value.replace('Z', '');
  const y = parseInt(dateStr.slice(0, 4), 10);
  const m = parseInt(dateStr.slice(4, 6), 10) - 1;
  const d = parseInt(dateStr.slice(6, 8), 10);
  const h = parseInt(dateStr.slice(9, 11), 10);
  const min = parseInt(dateStr.slice(11, 13), 10);
  const s = parseInt(dateStr.slice(13, 15), 10);

  if (value.endsWith('Z')) {
    // UTC time
    return new Date(Date.UTC(y, m, d, h, min, s));
  }

  if (tzid) {
    // Try to use the timezone to convert to UTC
    return convertTzToUTC(y, m, d, h, min, s, tzid);
  }

  // Floating time - treat as UTC
  return new Date(Date.UTC(y, m, d, h, min, s));
}

/**
 * Converts a local time with timezone to UTC.
 * Uses Intl.DateTimeFormat for well-known IANA timezone IDs.
 *
 * Two-pass approach to handle DST boundary edge cases:
 * Pass 1: Estimate the UTC offset using the target local time interpreted as UTC.
 * Pass 2: Re-check the offset at the corrected UTC time. If the offset changed
 *         (because the initial guess landed on the wrong side of a DST transition),
 *         apply the corrected offset instead.
 */
function convertTzToUTC(y: number, m: number, d: number, h: number, min: number, s: number, tzid: string): Date {
  try {
    const targetLocalMs = Date.UTC(y, m, d, h, min, s);

    // Pass 1: estimate offset using the target local time as if it were UTC
    const offset1 = getUtcOffsetMs(new Date(targetLocalMs), tzid);
    const utcEstimate = new Date(targetLocalMs - offset1);

    // Pass 2: re-check offset at the estimated UTC time
    const offset2 = getUtcOffsetMs(utcEstimate, tzid);

    if (offset1 === offset2) {
      return utcEstimate;
    }

    // Offsets differ — we crossed a DST boundary. Use the corrected offset.
    return new Date(targetLocalMs - offset2);
  } catch {
    // If timezone is not recognized, treat as UTC
    return new Date(Date.UTC(y, m, d, h, min, s));
  }
}

/**
 * Returns the UTC offset in milliseconds for a given timezone at a specific UTC instant.
 * Positive means ahead of UTC (e.g., +5:30 for Asia/Kolkata), negative means behind.
 */
function getUtcOffsetMs(utcDate: Date, tzid: string): number {
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

  const parts = formatter.formatToParts(utcDate);
  const getPart = (type: string) => parseInt(parts.find(p => p.type === type)?.value ?? '0', 10);

  const localH = getPart('hour') === 24 ? 0 : getPart('hour');
  const localAsUTC = new Date(Date.UTC(
    getPart('year'),
    getPart('month') - 1,
    getPart('day'),
    localH,
    getPart('minute'),
    getPart('second')
  ));

  return localAsUTC.getTime() - utcDate.getTime();
}

/**
 * Parses an RRULE value string into a RecurrenceRule object.
 */
export function parseRRule(value: string): RecurrenceRule {
  const parts = value.split(';');
  const rule: RecurrenceRule = {
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
  };

  for (const part of parts) {
    const eqIndex = part.indexOf('=');
    if (eqIndex === -1) continue;
    const key = part.slice(0, eqIndex).toUpperCase();
    const val = part.slice(eqIndex + 1);

    switch (key) {
      case 'FREQ':
        rule.frequency = val.toLowerCase() as RecurrenceRule['frequency'];
        break;
      case 'INTERVAL':
        rule.interval = parseInt(val, 10);
        break;
      case 'COUNT':
        rule.count = parseInt(val, 10);
        break;
      case 'UNTIL':
        rule.until = parseDateTime(val);
        break;
      case 'BYSECOND':
        rule.bySecond = val.split(',').map(Number);
        break;
      case 'BYMINUTE':
        rule.byMinute = val.split(',').map(Number);
        break;
      case 'BYHOUR':
        rule.byHour = val.split(',').map(Number);
        break;
      case 'BYDAY':
        rule.byDay = val.split(',');
        break;
      case 'BYMONTHDAY':
        rule.byMonthDay = val.split(',').map(Number);
        break;
      case 'BYYEARDAY':
        rule.byYearDay = val.split(',').map(Number);
        break;
      case 'BYWEEKNO':
        rule.byWeekNo = val.split(',').map(Number);
        break;
      case 'BYMONTH':
        rule.byMonth = val.split(',').map(Number);
        break;
      case 'BYSETPOS':
        rule.bySetPos = val.split(',').map(Number);
        break;
      case 'WKST':
        rule.wkst = val;
        break;
    }
  }

  return rule;
}

/**
 * Parses an ATTENDEE or ORGANIZER mailto: value.
 */
function parseMailto(value: string): string {
  return value.replace(/^mailto:/i, '');
}

/**
 * Maps iCalendar PARTSTAT to model attendee status.
 */
function mapPartstatToStatus(partstat: string): Attendee['status'] {
  switch (partstat.toUpperCase()) {
    case 'ACCEPTED': return 'accepted';
    case 'DECLINED': return 'declined';
    case 'TENTATIVE': return 'tentative';
    case 'NEEDS-ACTION': return 'needs-action';
    default: return 'needs-action';
  }
}

/**
 * Maps iCalendar ROLE to model attendee role.
 */
function mapRoleToModel(role: string): Attendee['role'] {
  switch (role.toUpperCase()) {
    case 'REQ-PARTICIPANT': return 'required';
    case 'OPT-PARTICIPANT': return 'optional';
    case 'CHAIR': return 'chair';
    default: return 'required';
  }
}

/**
 * Maps iCalendar STATUS to model event status.
 */
function mapStatusToModel(status: string): CalendarEvent['status'] {
  switch (status.toUpperCase()) {
    case 'CONFIRMED': return 'confirmed';
    case 'TENTATIVE': return 'tentative';
    case 'CANCELLED': return 'cancelled';
    default: return 'confirmed';
  }
}

/**
 * Parses a DURATION value (e.g., PT1H30M, P1D) and returns milliseconds.
 */
function parseDuration(value: string): number {
  let ms = 0;
  const match = value.match(/^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!match) return 0;

  const [, weeks, days, hours, minutes, seconds] = match;
  if (weeks) ms += parseInt(weeks, 10) * 7 * 24 * 60 * 60 * 1000;
  if (days) ms += parseInt(days, 10) * 24 * 60 * 60 * 1000;
  if (hours) ms += parseInt(hours, 10) * 60 * 60 * 1000;
  if (minutes) ms += parseInt(minutes, 10) * 60 * 1000;
  if (seconds) ms += parseInt(seconds, 10) * 1000;

  return ms;
}

/**
 * Extracts component blocks (VEVENT, VTIMEZONE) from unfolded lines.
 */
function extractComponents(lines: string[]): { vevents: string[][]; vtimezones: string[][] } {
  const vevents: string[][] = [];
  const vtimezones: string[][] = [];
  let current: string[] | null = null;
  let componentType: string | null = null;

  for (const line of lines) {
    const upper = line.toUpperCase();
    if (upper === 'BEGIN:VEVENT') {
      current = [];
      componentType = 'VEVENT';
    } else if (upper === 'BEGIN:VTIMEZONE') {
      current = [];
      componentType = 'VTIMEZONE';
    } else if (upper === 'END:VEVENT' && componentType === 'VEVENT') {
      if (current) vevents.push(current);
      current = null;
      componentType = null;
    } else if (upper === 'END:VTIMEZONE' && componentType === 'VTIMEZONE') {
      if (current) vtimezones.push(current);
      current = null;
      componentType = null;
    } else if (current) {
      current.push(line);
    }
  }

  return { vevents, vtimezones };
}

/**
 * Parses VTIMEZONE components to extract TZID mappings.
 * Returns a Map of TZID → timezone data for conversion.
 */
function parseVTimezones(vtimezones: string[][]): Map<string, string> {
  const tzMap = new Map<string, string>();

  for (const tzLines of vtimezones) {
    let tzid: string | null = null;
    for (const line of tzLines) {
      const parsed = parsePropertyLine(line);
      if (parsed && parsed.name === 'TZID') {
        tzid = parsed.value;
        break;
      }
    }
    if (tzid) {
      tzMap.set(tzid, tzid);
    }
  }

  return tzMap;
}

/**
 * Known properties that map to VEvent fields.
 */
const KNOWN_PROPERTIES = new Set([
  'UID', 'DTSTAMP', 'DTSTART', 'DTEND', 'DURATION',
  'SUMMARY', 'DESCRIPTION', 'LOCATION', 'STATUS',
  'SEQUENCE', 'RRULE', 'ORGANIZER', 'ATTENDEE', 'EXDATE',
]);

/**
 * Finds the 1-based line number where a property would be expected.
 * Returns the line after the last property if not found.
 */
function findPropertyLine(lines: string[], _propertyName: string, lineOffset: number): number {
  // Return the line number of the last line + 1 (where the property should have been)
  return lineOffset + lines.length;
}

/**
 * Parses VEVENT property lines into a VEvent object.
 */
function parseVEventLines(
  lines: string[],
  tzMap: Map<string, string>,
  lineOffset: number
): ParseResult<VEvent> {
  let uid: string | undefined;
  let dtstamp: string | undefined;
  let dtstart: string | undefined;
  let dtend: string | undefined;
  let duration: string | undefined;
  let summary: string | undefined;
  let description: string | undefined;
  let location: string | undefined;
  let status: string | undefined;
  let sequence: number | undefined;
  let rrule: string | undefined;
  let organizer: VOrganizer | undefined;
  let isAllDay = false;
  let timeZone: string | undefined;
  const exdates: string[] = [];
  const attendees: VAttendee[] = [];
  const opaqueFields = new Map<string, string>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const parsed = parsePropertyLine(line);
    if (!parsed) {
      return {
        success: false,
        error: {
          line: lineOffset + i + 1,
          message: `Invalid property line: missing colon separator`,
          raw: line,
        },
      };
    }

    const { name, params, value } = parsed;

    switch (name) {
      case 'UID':
        uid = value;
        break;
      case 'DTSTAMP': {
        const tzid = params.get('TZID') ?? undefined;
        const resolvedTz = tzid ? (tzMap.get(tzid) ?? tzid) : undefined;
        const dt = parseDateTime(value, resolvedTz);
        dtstamp = formatUTC(dt);
        break;
      }
      case 'DTSTART': {
        const tzid = params.get('TZID') ?? undefined;
        const resolvedTz = tzid ? (tzMap.get(tzid) ?? tzid) : undefined;
        const valueType = params.get('VALUE') ?? undefined;
        // Detect all-day: VALUE=DATE parameter or 8-char date-only value
        if (valueType === 'DATE' || (value.length === 8 && !value.includes('T'))) {
          isAllDay = true;
        }
        // Preserve original timezone
        if (tzid) {
          timeZone = tzMap.get(tzid) ?? tzid;
        }
        const dt = parseDateTime(value, resolvedTz);
        dtstart = isAllDay ? value : formatUTC(dt);
        break;
      }
      case 'DTEND': {
        const tzid = params.get('TZID') ?? undefined;
        const resolvedTz = tzid ? (tzMap.get(tzid) ?? tzid) : undefined;
        const valueType = params.get('VALUE') ?? undefined;
        const dtendIsAllDay = valueType === 'DATE' || (value.length === 8 && !value.includes('T'));
        const dt = parseDateTime(value, resolvedTz);
        dtend = dtendIsAllDay ? value : formatUTC(dt);
        break;
      }
      case 'DURATION':
        duration = value;
        break;
      case 'SUMMARY':
        summary = unescapeText(value);
        break;
      case 'DESCRIPTION':
        description = unescapeText(value);
        break;
      case 'LOCATION':
        location = unescapeText(value);
        break;
      case 'STATUS':
        status = value.toUpperCase();
        break;
      case 'SEQUENCE':
        sequence = parseInt(value, 10);
        break;
      case 'RRULE':
        rrule = value;
        break;
      case 'EXDATE': {
        const tzid = params.get('TZID') ?? undefined;
        const resolvedTz = tzid ? (tzMap.get(tzid) ?? tzid) : undefined;
        // EXDATE can have multiple comma-separated values
        const dateValues = value.split(',');
        for (const dv of dateValues) {
          const dt = parseDateTime(dv.trim(), resolvedTz);
          exdates.push(formatUTC(dt));
        }
        break;
      }
      case 'ORGANIZER': {
        const email = parseMailto(value);
        const cn = params.get('CN') ?? undefined;
        const sentBy = params.get('SENT-BY')
          ? parseMailto(params.get('SENT-BY')!)
          : undefined;
        organizer = { email, cn, sentBy };
        break;
      }
      case 'ATTENDEE': {
        const email = parseMailto(value);
        const cn = params.get('CN') ?? undefined;
        const partstat = params.get('PARTSTAT') ?? 'NEEDS-ACTION';
        const role = params.get('ROLE') ?? 'REQ-PARTICIPANT';
        attendees.push({ email, cn, partstat, role });
        break;
      }
      default:
        // Preserve unrecognized fields
        if (!KNOWN_PROPERTIES.has(name)) {
          // Reconstruct the full property line for opaque storage
          const originalNameAndParams = line.slice(0, line.indexOf(':'));
          opaqueFields.set(originalNameAndParams, value);
        }
        break;
    }
  }

  // Validate required fields
  if (!uid) {
    // Find the line where UID would be expected (scan for closest relevant line)
    const uidLine = findPropertyLine(lines, 'UID', lineOffset);
    return {
      success: false,
      error: {
        line: uidLine > 0 ? uidLine : lineOffset + 1,
        message: 'Missing required property: UID',
        raw: lines.join('\r\n'),
      },
    };
  }

  if (!dtstamp) {
    const dtstampLine = findPropertyLine(lines, 'DTSTAMP', lineOffset);
    return {
      success: false,
      error: {
        line: dtstampLine > 0 ? dtstampLine : lineOffset + 1,
        message: 'Missing required property: DTSTAMP',
        raw: lines.join('\r\n'),
      },
    };
  }

  if (!dtstart) {
    const dtstartLine = findPropertyLine(lines, 'DTSTART', lineOffset);
    return {
      success: false,
      error: {
        line: dtstartLine > 0 ? dtstartLine : lineOffset + 1,
        message: 'Missing required property: DTSTART',
        raw: lines.join('\r\n'),
      },
    };
  }

  // Enforce mutual exclusivity of DTEND and DURATION
  if (dtend && duration) {
    // Find the DURATION line for accurate error reporting
    let durationLine = lineOffset + 1;
    for (let i = 0; i < lines.length; i++) {
      const parsed = parsePropertyLine(lines[i]);
      if (parsed && parsed.name === 'DURATION') {
        durationLine = lineOffset + i + 1;
        break;
      }
    }
    return {
      success: false,
      error: {
        line: durationLine,
        message: 'DTEND and DURATION must not both appear in the same event',
        raw: lines.join('\r\n'),
      },
    };
  }

  // If DURATION is present, compute DTEND from DTSTART + DURATION
  if (duration && !dtend) {
    const startDate = parseDateTime(dtstart);
    const durationMs = parseDuration(duration);
    const endDate = new Date(startDate.getTime() + durationMs);
    dtend = formatUTC(endDate);
  }

  const vevent: VEvent = {
    uid,
    dtstamp,
    dtstart,
    dtend,
    summary,
    description,
    location,
    status,
    sequence,
    rrule,
    exdates: exdates.length > 0 ? exdates : undefined,
    isAllDay: isAllDay || undefined,
    timeZone,
    organizer,
    attendees: attendees.length > 0 ? attendees : undefined,
    opaqueFields: opaqueFields.size > 0 ? opaqueFields : undefined,
  };

  return { success: true, value: vevent };
}

/**
 * Formats a Date as UTC iCalendar date-time: YYYYMMDDTHHMMSSZ
 */
function formatUTC(date: Date): string {
  const y = date.getUTCFullYear().toString().padStart(4, '0');
  const m = (date.getUTCMonth() + 1).toString().padStart(2, '0');
  const d = date.getUTCDate().toString().padStart(2, '0');
  const h = date.getUTCHours().toString().padStart(2, '0');
  const min = date.getUTCMinutes().toString().padStart(2, '0');
  const s = date.getUTCSeconds().toString().padStart(2, '0');
  return `${y}${m}${d}T${h}${min}${s}Z`;
}

/**
 * Converts a VEvent to a CalendarEvent.
 */
export function vEventToCalendarEvent(vevent: VEvent): CalendarEvent {
  const startTime = parseDateTime(vevent.dtstart);
  const endTime = vevent.dtend ? parseDateTime(vevent.dtend) : startTime;
  const dtstamp = parseDateTime(vevent.dtstamp);

  let organizer: Organizer | null = null;
  if (vevent.organizer) {
    organizer = {
      email: vevent.organizer.email,
      displayName: vevent.organizer.cn ?? null,
      sentBy: vevent.organizer.sentBy ?? null,
    };
  }

  const attendees: Attendee[] = (vevent.attendees ?? []).map((a) => ({
    email: a.email,
    displayName: a.cn ?? null,
    status: mapPartstatToStatus(a.partstat ?? 'NEEDS-ACTION'),
    role: mapRoleToModel(a.role ?? 'REQ-PARTICIPANT'),
  }));

  let recurrenceRule: RecurrenceRule | null = null;
  if (vevent.rrule) {
    recurrenceRule = parseRRule(vevent.rrule);
    // Merge EXDATE values into recurrenceRule.exceptions
    if (vevent.exdates && vevent.exdates.length > 0) {
      recurrenceRule.exceptions = vevent.exdates.map((d) => parseDateTime(d));
    }
  }

  const now = new Date();

  return {
    id: vevent.uid,
    providerEventId: vevent.uid,
    calendarAccountId: '',
    title: vevent.summary ?? '',
    description: vevent.description ?? null,
    location: vevent.location ?? null,
    startTime,
    endTime,
    timeZone: vevent.timeZone ?? 'UTC',
    isAllDay: vevent.isAllDay ?? false,
    recurrenceRule,
    recurrenceExceptionDate: null,
    parentRecurringEventId: null,
    organizer,
    attendees,
    sequence: vevent.sequence ?? 0,
    dtstamp,
    status: vevent.status ? mapStatusToModel(vevent.status) : 'confirmed',
    visibility: null,
    opaqueFields: vevent.opaqueFields ?? new Map<string, string>(),
    syncStatus: 'synced',
    localVersion: 1,
    remoteEtag: null,
    modifiedBy: null,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Parses a VEVENT component string into a VEvent.
 * The input should be the content between BEGIN:VEVENT and END:VEVENT (exclusive).
 */
export function parseComponent(component: string): ParseResult<VEvent> {
  const unfolded = unfoldLines(component);
  const lines = unfolded.split('\r\n').filter((l) => l.length > 0);

  // Remove BEGIN:VEVENT and END:VEVENT if present
  const filteredLines: string[] = [];
  for (const line of lines) {
    const upper = line.toUpperCase();
    if (upper === 'BEGIN:VEVENT' || upper === 'END:VEVENT') continue;
    filteredLines.push(line);
  }

  return parseVEventLines(filteredLines, new Map(), 0);
}

/**
 * Parses a full iCalendar document string into a CalendarEvent.
 * Handles VCALENDAR wrapper, VTIMEZONE components, and VEVENT extraction.
 */
export function parse(icsData: string): ParseResult<CalendarEvent> {
  // Step 1: Unfold lines
  const unfolded = unfoldLines(icsData);
  const lines = unfolded.split('\r\n').filter((l) => l.length > 0);

  // Step 2: Validate VCALENDAR wrapper
  if (lines.length < 2) {
    return {
      success: false,
      error: {
        line: 1,
        message: 'Invalid iCalendar data: too few lines',
        raw: icsData.slice(0, 100),
      },
    };
  }

  const firstLine = lines[0].toUpperCase();
  const lastLine = lines[lines.length - 1].toUpperCase();

  if (firstLine !== 'BEGIN:VCALENDAR') {
    return {
      success: false,
      error: {
        line: 1,
        message: 'Missing BEGIN:VCALENDAR',
        raw: lines[0],
      },
    };
  }

  if (lastLine !== 'END:VCALENDAR') {
    return {
      success: false,
      error: {
        line: lines.length,
        message: 'Missing END:VCALENDAR',
        raw: lines[lines.length - 1],
      },
    };
  }

  // Step 3: Extract components
  const { vevents, vtimezones } = extractComponents(lines);

  if (vevents.length === 0) {
    return {
      success: false,
      error: {
        line: 1,
        message: 'No VEVENT component found',
        raw: icsData.slice(0, 100),
      },
    };
  }

  // Step 4: Parse VTIMEZONE components
  const tzMap = parseVTimezones(vtimezones);

  // Step 5: Parse the first VEVENT
  // Calculate line offset for error reporting
  let lineOffset = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].toUpperCase() === 'BEGIN:VEVENT') {
      lineOffset = i + 1; // +1 because we skip BEGIN:VEVENT itself
      break;
    }
  }

  const veventResult = parseVEventLines(vevents[0], tzMap, lineOffset);
  if (!veventResult.success) {
    return {
      success: false,
      error: veventResult.error,
    };
  }

  // Step 6: Convert VEvent to CalendarEvent
  const event = vEventToCalendarEvent(veventResult.value!);

  return { success: true, value: event };
}
