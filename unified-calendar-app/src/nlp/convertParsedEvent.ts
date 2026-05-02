/**
 * Converts a ParsedEvent from the NL parser into a CreateEventInput
 * suitable for the EventCRUDService.
 *
 * Returns null when date or time is missing — the caller (Quick Create Bar)
 * uses this as a signal to fall back to the EventEditor.
 *
 * Requirements: 5.2, 5.8
 */

import type { ParsedEvent } from './naturalLanguageParser';
import type { CreateEventInput } from '../events/eventCRUDService';
import type { Attendee } from '../types/models';

/**
 * Convert a ParsedEvent into a CreateEventInput for the CRUD service.
 *
 * @param parsedEvent - The structured output from the NL parser
 * @param calendarAccountId - The target calendar account ID
 * @returns A CreateEventInput ready for EventCRUDService.createEvent(),
 *          or null if date or time is missing (signals EventEditor fallback)
 */
export function convertParsedEventToCreateInput(
  parsedEvent: ParsedEvent,
  calendarAccountId: string,
): CreateEventInput | null {
  // Return null if date or time is missing — signals EventEditor fallback (Req 5.8)
  if (parsedEvent.date === null || parsedEvent.time === null) {
    return null;
  }

  // Combine date + time into startTime
  const startTime = new Date(
    parsedEvent.date.getFullYear(),
    parsedEvent.date.getMonth(),
    parsedEvent.date.getDate(),
    parsedEvent.time.hours,
    parsedEvent.time.minutes,
  );

  // Compute endTime from duration (in minutes)
  const endTime = new Date(startTime.getTime() + parsedEvent.duration * 60 * 1000);

  // Device timezone
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  // Serialize recurrence if present
  const recurrenceRule = parsedEvent.recurrence !== null
    ? JSON.stringify(parsedEvent.recurrence)
    : null;

  // Map attendee names to Attendee objects and JSON-serialize
  const attendees = parsedEvent.attendees.length > 0
    ? JSON.stringify(
        parsedEvent.attendees.map((name): Attendee => ({
          email: '',
          displayName: name.length > 0 ? name : null,
          status: 'needs-action',
          role: 'required',
        })),
      )
    : null;

  return {
    calendarAccountId,
    title: parsedEvent.title,
    startTime,
    endTime,
    description: null,
    location: parsedEvent.location ?? null,
    timeZone,
    isAllDay: false,
    recurrenceRule,
    attendees,
    organizer: null,
    visibility: null,
    opaqueFields: null,
    recurrenceExceptionDate: null,
    parentRecurringEventId: null,
  };
}
