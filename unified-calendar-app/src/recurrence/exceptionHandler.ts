/**
 * Recurring event exception handling.
 * Requirements: 3.5
 *
 * Manages single-instance modifications of recurring events by creating
 * exception events that override specific occurrences.
 *
 * Gap #7 fix: createRecurrenceException no longer mutates the parent event.
 * It returns both the exception event and the updated EXDATE list.
 *
 * Gap #8 fix: getEffectiveOccurrences now injects exception events for dates
 * that were excluded by EXDATE, so modified exceptions are not silently lost.
 */

import type { CalendarEvent } from '../types/models';
import { expandRecurrenceRule, type DateRange } from './expandRecurrenceRule';

/**
 * Result of creating a recurrence exception.
 * Contains the new exception event and the updated exceptions list
 * that should be applied to the parent's recurrenceRule.
 */
export interface RecurrenceExceptionResult {
  /** The new exception event */
  exceptionEvent: CalendarEvent;
  /** Updated EXDATE list to set on the parent's recurrenceRule.exceptions */
  updatedExceptions: Date[];
}

/**
 * Generate a simple unique ID for exception events.
 */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * Creates a new exception event that overrides a single occurrence of a recurring event.
 *
 * Gap #7 fix: Does NOT mutate the parent event. Returns a result object containing
 * the exception event and the updated EXDATE list. The caller is responsible for
 * applying the updated exceptions to the parent.
 *
 * The exception event:
 * 1. Has a new unique ID
 * 2. Sets parentRecurringEventId to the parent event's ID
 * 3. Sets recurrenceExceptionDate to the date being overridden
 * 4. Has recurrenceRule set to null (exceptions are not recurring)
 * 5. Copies all other fields from the parent event, then applies modifications
 */
export function createRecurrenceException(
  parentEvent: CalendarEvent,
  exceptionDate: Date,
  modifications: Partial<CalendarEvent>
): RecurrenceExceptionResult {
  if (!parentEvent.recurrenceRule) {
    throw new Error('Cannot create exception for a non-recurring event');
  }

  // Gap #7: Build updated exceptions list without mutating parent
  const updatedExceptions = [
    ...parentEvent.recurrenceRule.exceptions,
    exceptionDate,
  ];

  const now = new Date();

  const exceptionEvent: CalendarEvent = {
    ...parentEvent,
    ...modifications,
    id: generateId(),
    recurrenceRule: null,
    recurrenceExceptionDate: exceptionDate,
    parentRecurringEventId: parentEvent.id,
    syncStatus: 'pending_create',
    localVersion: 1,
    createdAt: now,
    updatedAt: now,
  };

  return { exceptionEvent, updatedExceptions };
}

/**
 * Returns the effective list of occurrences for a recurring event within a date range,
 * with exceptions applied.
 *
 * Gap #8 fix: After expanding the recurrence rule (which filters out EXDATE dates),
 * we inject non-cancelled exception events for dates that were excluded by EXDATE.
 * This ensures modified exceptions are included in the result even when their date
 * is in the parent's EXDATE list.
 *
 * For each expanded occurrence date:
 * - If an exception exists and is not cancelled, use the exception event instead
 * - If an exception exists and is cancelled (status: 'cancelled'), skip that occurrence
 * - Otherwise, use the generated occurrence from the parent event
 *
 * Additionally, for each exception event whose date is NOT in the expanded set
 * (because it was excluded by EXDATE), if the exception is not cancelled and
 * falls within the range, it is injected into the results.
 */
export function getEffectiveOccurrences(
  parentEvent: CalendarEvent,
  exceptions: CalendarEvent[],
  range: DateRange
): CalendarEvent[] {
  if (!parentEvent.recurrenceRule) {
    return [];
  }

  // Expand the recurrence rule to get occurrence dates
  const occurrenceDates = expandRecurrenceRule(
    parentEvent.recurrenceRule,
    parentEvent.startTime,
    range
  );

  // Build a map of exception dates (normalized to day) -> exception event
  const exceptionMap = buildExceptionMap(exceptions);

  const results: CalendarEvent[] = [];
  const matchedExceptionDays = new Set<number>();

  for (const occurrenceDate of occurrenceDates) {
    const dayKey = normalizeToDay(occurrenceDate);
    const exception = exceptionMap.get(dayKey);

    if (exception) {
      matchedExceptionDays.add(dayKey);
      if (exception.status === 'cancelled') {
        continue;
      }
      results.push(exception);
    } else {
      const occurrence = buildOccurrenceFromParent(parentEvent, occurrenceDate);
      results.push(occurrence);
    }
  }

  // Gap #8: Inject non-cancelled exceptions whose dates were excluded by EXDATE
  for (const [dayKey, exception] of exceptionMap.entries()) {
    if (matchedExceptionDays.has(dayKey)) continue;
    if (exception.status === 'cancelled') continue;

    // Check if the exception falls within the requested range
    const exDate = exception.recurrenceExceptionDate;
    if (!exDate) continue;
    if (exDate.getTime() < range.start.getTime()) continue;
    if (exDate.getTime() > range.end.getTime()) continue;

    results.push(exception);
  }

  // Sort by start time to maintain chronological order
  results.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());

  return results;
}

/**
 * Build a map from normalized day timestamps to exception events.
 */
function buildExceptionMap(exceptions: CalendarEvent[]): Map<number, CalendarEvent> {
  const map = new Map<number, CalendarEvent>();
  for (const ex of exceptions) {
    if (ex.recurrenceExceptionDate) {
      const dayKey = normalizeToDay(ex.recurrenceExceptionDate);
      map.set(dayKey, ex);
    }
  }
  return map;
}

/**
 * Normalize a date to the start of its UTC day for comparison.
 */
function normalizeToDay(date: Date): number {
  return Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate()
  );
}

/**
 * Build a virtual occurrence event from the parent event for a specific date.
 * Adjusts start/end times to the occurrence date while preserving duration.
 */
function buildOccurrenceFromParent(
  parentEvent: CalendarEvent,
  occurrenceDate: Date
): CalendarEvent {
  const duration = parentEvent.endTime.getTime() - parentEvent.startTime.getTime();
  const startTime = new Date(occurrenceDate);
  const endTime = new Date(startTime.getTime() + duration);

  return {
    ...parentEvent,
    startTime,
    endTime,
    recurrenceExceptionDate: null,
    parentRecurringEventId: null,
  };
}
