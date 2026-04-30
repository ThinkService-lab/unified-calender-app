/**
 * Natural Language Printer.
 *
 * Converts a structured {@link ParsedEvent} back into a human-readable
 * sentence. Pairs with {@link ./naturalLanguageParser | parseNaturalLanguage}
 * to provide a round-trip guarantee:
 *
 *   parseNaturalLanguage(printEvent(e))  ≅  e
 *
 * where "≅" is field-wise equivalence for title, date (same calendar day),
 * time (same hours/minutes), duration, location, and attendees.
 *
 * Requirements: 5.9, 5.10
 */

import type { ParsedEvent } from './naturalLanguageParser';

const MONTH_NAMES_FULL = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/**
 * Pure function. Convert a {@link ParsedEvent} into a natural-language
 * string using a canonical format:
 *
 *   "<title> on <Month Day> at <H:MMam/pm> for <N> hour(s)/minute(s)
 *    at <location> with <attendee1> and <attendee2>"
 *
 * Only fields that are present (non-null / non-empty) are emitted. The
 * canonical format is chosen so that the parser can recover the same
 * fields on a subsequent parse.
 */
export function printEvent(event: ParsedEvent): string {
  const parts: string[] = [];

  const title = (event.title ?? '').trim();
  if (title.length > 0) {
    parts.push(title);
  }

  if (event.date) {
    parts.push(`on ${formatDate(event.date)}`);
  }

  if (event.time) {
    parts.push(`at ${formatTime(event.time.hours, event.time.minutes)}`);
  }

  // Only emit duration when it differs from the implicit default so
  // round-trips with default durations do not accumulate noise. The
  // parser treats a missing duration as 60 minutes; we still emit it
  // when the caller explicitly produced 60 minutes because it is
  // informationally lossless either way.
  if (Number.isFinite(event.duration) && event.duration > 0) {
    parts.push(`for ${formatDuration(event.duration)}`);
  }

  if (event.location && event.location.trim().length > 0) {
    parts.push(`at ${event.location.trim()}`);
  }

  if (event.attendees && event.attendees.length > 0) {
    parts.push(`with ${formatAttendees(event.attendees)}`);
  }

  return parts.join(' ');
}

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

function formatDate(d: Date): string {
  const month = MONTH_NAMES_FULL[d.getMonth()];
  const day = d.getDate();
  return `${month} ${day}`;
}

function formatTime(hours: number, minutes: number): string {
  const h24 = ((hours % 24) + 24) % 24;
  const meridiem = h24 >= 12 ? 'pm' : 'am';
  let h12 = h24 % 12;
  if (h12 === 0) h12 = 12;
  const minuteStr = minutes > 0 ? `:${String(minutes).padStart(2, '0')}` : '';
  return `${h12}${minuteStr}${meridiem}`;
}

function formatDuration(totalMinutes: number): string {
  // Prefer whole-hour rendering for multiples of 60 minutes so the
  // parser reads back the same value. Fractional hours (e.g. 90 minutes)
  // are rendered as minutes to avoid emitting "1.5 hours" which the
  // parser supports but which is noisier to round-trip.
  if (totalMinutes % 60 === 0) {
    const hours = totalMinutes / 60;
    return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
  }
  return `${totalMinutes} ${totalMinutes === 1 ? 'minute' : 'minutes'}`;
}

function formatAttendees(names: string[]): string {
  const cleaned = names.map((n) => n.trim()).filter((n) => n.length > 0);
  if (cleaned.length === 0) return '';
  if (cleaned.length === 1) return cleaned[0];
  if (cleaned.length === 2) return `${cleaned[0]} and ${cleaned[1]}`;
  // Oxford-comma style so the parser's splitter handles it symmetrically.
  const head = cleaned.slice(0, -1).join(', ');
  const tail = cleaned[cleaned.length - 1];
  return `${head}, and ${tail}`;
}
