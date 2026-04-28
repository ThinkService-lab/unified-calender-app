/**
 * Intermediate iCalendar representation types.
 * VEvent represents the parsed/serializable form of a VEVENT component.
 * Requirements: 12.1, 12.2
 */

export interface VEvent {
  uid: string;
  dtstamp: string; // UTC format: YYYYMMDDTHHMMSSZ
  dtstart: string; // UTC format: YYYYMMDDTHHMMSSZ or YYYYMMDD for all-day
  dtend?: string; // UTC format: YYYYMMDDTHHMMSSZ or YYYYMMDD for all-day
  summary?: string;
  description?: string;
  location?: string;
  status?: string;
  sequence?: number;
  rrule?: string;
  exdates?: string[]; // EXDATE values in UTC format: YYYYMMDDTHHMMSSZ
  isAllDay?: boolean;
  timeZone?: string; // Original TZID from DTSTART
  organizer?: VOrganizer;
  attendees?: VAttendee[];
  opaqueFields?: Map<string, string>;
}

export interface VOrganizer {
  email: string;
  cn?: string;
  sentBy?: string;
}

export interface VAttendee {
  email: string;
  cn?: string;
  partstat?: string;
  role?: string;
}
