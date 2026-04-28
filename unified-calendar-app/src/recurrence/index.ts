/**
 * Recurrence rule engine module.
 * Requirements: 3.4, 3.5
 */

export { expandRecurrenceRule } from './expandRecurrenceRule';
export type { DateRange } from './expandRecurrenceRule';
export { createRecurrenceException, getEffectiveOccurrences } from './exceptionHandler';
export type { RecurrenceExceptionResult } from './exceptionHandler';
