/**
 * Pure utility functions for time-slot snapping and coordinate conversion.
 *
 * Used by the drag-to-reschedule, drag-to-resize, and inline-event-creator
 * gesture controllers to map between pixel positions in the day/week timeline
 * and minutes-from-midnight.
 *
 * All functions in this module are pure: they have no side effects, no
 * external dependencies beyond pure math, and always return the same output
 * for the same input.
 *
 * Requirements: 4.2, 12.1, 12.2, 13.2
 */

/**
 * Total minutes in a day. Time values are expressed as an integer offset
 * from midnight in the half-open range [0, MINUTES_PER_DAY).
 */
const MINUTES_PER_DAY = 1440;
const MINUTES_PER_HOUR = 60;

/** Default snap resolution used by {@link yToMinutes}. Matches Req 4.2, 13.2. */
export const DEFAULT_SNAP_INCREMENT_MINUTES = 15;

/**
 * A time slot in a day view timeline.
 *
 * `startMinutes` and `endMinutes` are minutes from midnight in [0, 1440].
 * `y` is the pixel position of `startMinutes` in the timeline's coordinate
 * space (origin at the top of the timeline, increasing downward).
 */
export interface TimeSlotPosition {
  /** The calendar day this slot belongs to. */
  date: Date;
  /** Slot start, in minutes from midnight. */
  startMinutes: number;
  /** Slot end, in minutes from midnight. Always >= startMinutes. */
  endMinutes: number;
  /** Pixel position of `startMinutes` in the timeline. */
  y: number;
}

/**
 * Snap a minute value to the nearest multiple of `incrementMinutes`, clamped
 * into the valid day range.
 *
 * Guarantees (for any finite `minutes` and `incrementMinutes > 0`):
 *   - The result is a non-negative integer multiple of `incrementMinutes`.
 *   - The result is strictly less than {@link MINUTES_PER_DAY} (1440).
 *   - `snapToIncrement(m, 15)` is always in `{0, 15, 30, ..., 1425}`.
 *
 * Edge cases:
 *   - Negative `minutes` are clamped up to 0.
 *   - Values >= 1440 are clamped down to the largest valid multiple.
 *   - Non-integer `minutes` are rounded to the nearest multiple.
 *   - `incrementMinutes <= 0` or non-finite: returns 0 (safe fallback so
 *     callers never observe NaN or out-of-range values).
 *   - `incrementMinutes` larger than 1440: treated as 1440, which clamps
 *     the result to 0 (the only multiple of a >=1440 increment that fits
 *     in the half-open day range).
 */
export function snapToIncrement(
  minutes: number,
  incrementMinutes: number,
): number {
  // Guard against invalid inputs to keep callers (gesture controllers running
  // on the UI thread) free of NaN/Infinity propagation.
  if (!Number.isFinite(minutes) || !Number.isFinite(incrementMinutes)) {
    return 0;
  }
  if (incrementMinutes <= 0) {
    return 0;
  }

  // Effective increment cannot exceed a full day; a larger increment would
  // allow no non-zero multiples in the [0, 1440) half-open range.
  const effectiveIncrement = Math.min(incrementMinutes, MINUTES_PER_DAY);

  // The largest valid multiple of `effectiveIncrement` that is strictly less
  // than MINUTES_PER_DAY. For increment=15 this is 1425; for increment=60
  // this is 1380; for increment=1440 this is 0.
  const maxMultiple =
    (Math.floor((MINUTES_PER_DAY - 1) / effectiveIncrement)) * effectiveIncrement;

  // Clamp raw minutes into a range that cannot round up past maxMultiple.
  // Using `maxMultiple + effectiveIncrement / 2 - 1e-9` as the upper bound
  // would be fragile with floating-point rounding, so we clamp to
  // MINUTES_PER_DAY first, snap, then clamp down to maxMultiple.
  const clamped = Math.max(0, Math.min(minutes, MINUTES_PER_DAY));

  const snapped = Math.round(clamped / effectiveIncrement) * effectiveIncrement;

  // After rounding, `snapped` may equal MINUTES_PER_DAY (e.g., minutes=1438,
  // increment=15 → Math.round(95.866...) * 15 = 96*15 = 1440). Clamp down
  // into the half-open day range.
  if (snapped < 0) return 0;
  if (snapped > maxMultiple) return maxMultiple;
  return snapped;
}

/**
 * Convert a Y pixel position in the timeline to minutes from midnight.
 *
 * The returned value is clamped into [0, 1440) and snapped to the nearest
 * {@link DEFAULT_SNAP_INCREMENT_MINUTES} (15-minute) boundary, matching the
 * snapping behavior required by drag-to-reschedule / drag-to-resize
 * (Req 4.2, 13.2) and inline event creation (Req 12.1, 12.2).
 *
 * Callers that need the raw (non-snapped) minute value can compute
 * `(y / hourHeight) * 60` directly.
 *
 * Edge cases:
 *   - `hourHeight <= 0` or non-finite: returns 0.
 *   - Negative `y`: clamped to 0.
 *   - `y` beyond the timeline end: clamped to the largest snap multiple
 *     less than 1440 (e.g., 1425 for a 15-minute snap).
 */
export function yToMinutes(y: number, hourHeight: number): number {
  if (!Number.isFinite(y) || !Number.isFinite(hourHeight) || hourHeight <= 0) {
    return 0;
  }
  const rawMinutes = (y / hourHeight) * MINUTES_PER_HOUR;
  return snapToIncrement(rawMinutes, DEFAULT_SNAP_INCREMENT_MINUTES);
}

/**
 * Convert minutes from midnight to a Y pixel position in the timeline.
 *
 * Inverse of {@link yToMinutes} for inputs that are already valid snapped
 * minute values (i.e., non-negative multiples of
 * {@link DEFAULT_SNAP_INCREMENT_MINUTES} in [0, 1440)):
 *
 *     yToMinutes(minutesToY(m, h), h) === m
 *
 * Edge cases:
 *   - `hourHeight <= 0` or non-finite: returns 0.
 *   - Non-finite `minutes`: returns 0.
 *   - Negative `minutes`: returns 0 (keeps the result in the visible range).
 */
export function minutesToY(minutes: number, hourHeight: number): number {
  if (!Number.isFinite(minutes) || !Number.isFinite(hourHeight) || hourHeight <= 0) {
    return 0;
  }
  if (minutes <= 0) return 0;
  return (minutes / MINUTES_PER_HOUR) * hourHeight;
}
