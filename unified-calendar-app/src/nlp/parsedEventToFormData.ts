/**
 * parsedEventToFormData — Pure function that maps a Partial<ParsedEvent>
 * into a Partial<EventFormData> suitable for passing as `initialValues`
 * to the EventEditor in 'create' mode.
 *
 * Used by the Quick Create Bar when the NL Parser cannot fully resolve
 * all required fields (date, time, or recurrence) and falls back to
 * opening the EventEditor pre-populated with whatever was successfully
 * parsed.
 *
 * Requirements: 5.8, 17.8
 */

import type { ParsedEvent } from './naturalLanguageParser';
import type { EventFormData } from '../ui/editor/eventEditorViewModel';
import type { Attendee, RecurrenceRule } from '../types/models';

/**
 * Convert a partial NL-parsed event into partial EventFormData fields.
 *
 * Mapping:
 * - title → form.title
 * - date + time combined → form.startTime (only when BOTH are non-null)
 * - date + time + duration → form.endTime (only when startTime was set)
 * - location → form.location
 * - attendees → form.attendees (mapped to Attendee shape)
 * - recurrence (only when confidence.recurrence === 'parsed') →
 *   form recurrence fields (recurrenceFrequency, recurrenceInterval, etc.)
 *
 * Fields that cannot be determined are omitted from the returned object
 * so that `createDefaultForm` defaults fill in the gaps when the editor
 * shallow-merges.
 */
export function parsedEventToFormData(
  parsed: Partial<ParsedEvent>,
): Partial<EventFormData> {
  const result: Partial<EventFormData> = {};

  // title
  if (parsed.title != null && parsed.title.length > 0) {
    result.title = parsed.title;
  }

  // startTime: only when both date AND time are present
  if (parsed.date != null && parsed.time != null) {
    const start = new Date(parsed.date);
    start.setHours(parsed.time.hours, parsed.time.minutes, 0, 0);
    result.startTime = start;

    // endTime: startTime + duration (duration defaults to 60 in ParsedEvent)
    const durationMinutes = parsed.duration ?? 60;
    const end = new Date(start.getTime() + durationMinutes * 60 * 1000);
    result.endTime = end;
  }

  // location
  if (parsed.location != null) {
    result.location = parsed.location;
  }

  // attendees — map string names to Attendee shape
  if (parsed.attendees != null && parsed.attendees.length > 0) {
    result.attendees = parsed.attendees.map(mapNameToAttendee);
  }

  // recurrence — only when confidence.recurrence === 'parsed'
  if (
    parsed.confidence?.recurrence === 'parsed' &&
    parsed.recurrence != null
  ) {
    applyRecurrenceToForm(result, parsed.recurrence);
  }

  return result;
}

/**
 * Map an attendee name string to the Attendee model shape.
 * Uses the same mapping as convertParsedEventToCreateInput (Task 12.1):
 * - email: '' (NL parser only extracts names, not emails)
 * - displayName: the name (non-empty strings as-is, empty → null)
 * - status: 'needs-action'
 * - role: 'required'
 */
function mapNameToAttendee(name: string): Attendee {
  return {
    email: '',
    displayName: name.length > 0 ? name : null,
    status: 'needs-action',
    role: 'required',
  };
}

/**
 * Apply a parsed RecurrenceRule to the form data's recurrence fields.
 */
function applyRecurrenceToForm(
  result: Partial<EventFormData>,
  rule: RecurrenceRule,
): void {
  result.recurrenceFrequency = rule.frequency;
  result.recurrenceInterval = rule.interval;

  if (rule.count != null) {
    result.recurrenceEndCondition = 'count';
    result.recurrenceCount = rule.count;
  } else if (rule.until != null) {
    result.recurrenceEndCondition = 'until';
    result.recurrenceUntil = rule.until instanceof Date ? rule.until : new Date(rule.until);
  } else {
    result.recurrenceEndCondition = 'never';
  }

  if (rule.byDay != null) {
    result.recurrenceByDay = rule.byDay;
  }

  if (rule.byMonthDay != null) {
    result.recurrenceByMonthDay = rule.byMonthDay;
  }
}
