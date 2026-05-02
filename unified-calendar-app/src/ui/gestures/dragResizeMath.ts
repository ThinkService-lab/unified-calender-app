/**
 * Pure JS-thread helpers shared between `useDragResize` and its test
 * suite. Kept in a dedicated module so they can be unit-tested without
 * pulling in the react-native-gesture-handler / react-native-reanimated
 * runtime (which Jest's default config cannot transform).
 *
 * Requirements: 13.2, 13.4, 13.7
 */

/**
 * Convert a `Date` to minutes-from-midnight using the Date's LOCAL time
 * zone (matching the convention used by the reschedule controller and
 * the timeline renderers).
 *
 * `getHours()` / `getMinutes()` return values in the device's local time
 * zone. Tests that want a specific zone should construct the Date in
 * UTC terms and accept that the result will reflect the host's TZ
 * offset — the helper's contract is "minutes-of-local-day", not "UTC".
 */
export function dateToMinutesOfDay(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

/**
 * Build a `Date` representing the proposed end time for a resize gesture.
 *
 * Preserves the Y-M-D components from `startTime` (resize never changes
 * the day) and applies the proposed end's H-M derived from
 * `proposedEndMin` (0–1440). If `proposedEndMin` produces a `Date`
 * whose time is at or before the start (rare — can happen across a
 * DST rollback that momentarily moves the clock backward), rolls the
 * end forward by one day so the duration stays positive.
 */
export function buildProposedEnd(startTime: Date, proposedEndMin: number): Date {
  const proposedEnd = new Date(startTime);
  proposedEnd.setHours(
    Math.floor(proposedEndMin / 60),
    proposedEndMin % 60,
    0,
    0,
  );
  if (proposedEnd.getTime() <= startTime.getTime()) {
    proposedEnd.setDate(proposedEnd.getDate() + 1);
  }
  return proposedEnd;
}
