/**
 * Pure helper extracted from `ConflictIndicatorOverlay.tsx` so it can
 * be imported by both the overlay component and the gesture
 * controllers (`useDragReschedule`, `useDragResize` — Task 9.11)
 * without pulling the JSX + Reanimated runtime along.
 *
 * This module has NO React / React Native imports so it is trivial
 * to unit-test (Task 9.19).
 *
 * Requirements: 4.4, 13.5
 */

/**
 * Build the accessibility label with correct singular/plural grammar.
 *
 * Used in two places:
 *   1. `ConflictIndicatorOverlay` renders this string as its
 *      `accessibilityLabel` so assistive tech can read it if the
 *      user focuses the overlay.
 *   2. `useDragReschedule` / `useDragResize` pass the same string to
 *      `useScreenReaderAnnouncement.announce` on the rising edge of
 *      `hasConflict` so the live region and the overlay label match
 *      exactly (Task 9.11).
 *
 * Negative and non-integer counts are clamped to a non-negative
 * integer so the output is always sensible regardless of caller bug.
 */
export function buildConflictAccessibilityLabel(conflictCount: number): string {
  const safeCount = Math.max(0, Math.floor(conflictCount));
  const noun = safeCount === 1 ? 'existing event' : 'existing events';
  return `Conflict with ${safeCount} ${noun}`;
}
