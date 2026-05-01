/**
 * Pure coordinate-math helpers used by `useDragReschedule`.
 *
 * Kept in a dedicated module so they can be unit-tested without pulling
 * in the react-native-gesture-handler / react-native-reanimated runtime
 * transitively (which Jest's default config cannot transform).
 *
 * Requirements: 4.1, 4.2, 4.3, 4.5
 */

/**
 * JS-thread clamp used by the exported helpers. A matching worklet-flavored
 * clamp lives inside `useDragReschedule.ts` for use from gesture handlers.
 */
function clampJs(value: number, lo: number, hi: number): number {
  if (value < lo) return lo;
  if (value > hi) return hi;
  return value;
}

/**
 * Compute the proposed day-column index from a horizontal translation, the
 * pixel width of a single column, the column the event started in, and the
 * total number of visible columns.
 *
 * Returns a value in [0, visibleDayCount - 1], or 0 if visibleDayCount is
 * zero. The initial column is returned when the translation or column
 * width are non-finite or non-positive, so the caller never observes NaN
 * or out-of-range indices.
 */
export function computeProposedColumnIndex(
  translationX: number,
  dayColumnWidth: number,
  initialColumnIndex: number,
  visibleDayCount: number,
): number {
  if (
    !Number.isFinite(translationX) ||
    !Number.isFinite(dayColumnWidth) ||
    dayColumnWidth <= 0
  ) {
    return clampJs(initialColumnIndex, 0, Math.max(0, visibleDayCount - 1));
  }
  const columnDelta = Math.round(translationX / dayColumnWidth);
  return clampJs(
    initialColumnIndex + columnDelta,
    0,
    Math.max(0, visibleDayCount - 1),
  );
}
