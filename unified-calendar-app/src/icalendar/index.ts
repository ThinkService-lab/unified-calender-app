/**
 * iCalendar module - RFC 5545 parser and serializer.
 * Requirements: 12.1, 12.2
 */

export {
  serialize,
  serializeComponent,
  eventToVEvent,
  escapeText,
  foldLine,
  formatDateTimeUTC,
  serializeRRule,
} from './serializer';

export {
  parse,
  parseComponent,
  unfoldLines,
  unescapeText,
  parsePropertyLine,
  parseDateTime,
  parseRRule,
  vEventToCalendarEvent,
} from './parser';

export type { VEvent, VOrganizer, VAttendee } from './types';
