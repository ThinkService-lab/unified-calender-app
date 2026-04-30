/**
 * Property-based tests for time slot utility functions.
 *
 * Feature: competitive-ui-overhaul
 * Property 5: Time slot snapping to 15-minute increments
 * Property 6: Minimum event duration enforcement
 *
 * Requirements: 4.2, 12.1, 12.2, 12.7, 13.2, 13.4
 */

import fc from 'fast-check';
import {
  snapToIncrement,
  yToMinutes,
  minutesToY,
  DEFAULT_SNAP_INCREMENT_MINUTES,
} from '../timeSlotUtils';

// ─── Constants ───────────────────────────────────────────────────────────────

const MINUTES_PER_DAY = 1440;
const MIN_EVENT_DURATION_MINUTES = 15;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Compute the end time for a drag-to-resize or click-to-create operation,
 * enforcing the minimum 15-minute event duration required by Reqs 12.7 and 13.4.
 *
 * This is the composition that the Drag Resize Controller (Task 9.4) and
 * Inline Event Creator (Task 9.10) will use. We test it here because the
 * enforcement depends on `snapToIncrement` producing correct values.
 */
function computeEndMinutes(startMinutes: number, dragEndMinutes: number): number {
  const snappedEnd = snapToIncrement(dragEndMinutes, DEFAULT_SNAP_INCREMENT_MINUTES);
  const minimumEnd = startMinutes + MIN_EVENT_DURATION_MINUTES;
  return Math.max(snappedEnd, minimumEnd);
}

// ─── Property 5: Time slot snapping to 15-minute increments ──────────────────

describe('Property 5: Time slot snapping to 15-minute increments', () => {
  // Feature: competitive-ui-overhaul, Property 5: Time slot snapping
  // **Validates: Requirements 4.2, 12.1, 12.2, 13.2**

  it('snapToIncrement(m, 15) always produces a non-negative multiple of 15 in [0, 1440)', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1000, max: 3000, noNaN: true }),
        (minutes) => {
          const result = snapToIncrement(minutes, 15);

          // Must be non-negative
          expect(result).toBeGreaterThanOrEqual(0);
          // Must be strictly less than 1440
          expect(result).toBeLessThan(MINUTES_PER_DAY);
          // Must be a multiple of 15
          expect(result % 15).toBe(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('yToMinutes produces a non-negative multiple of 15 in [0, 1440) for any valid Y and hourHeight', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1440, noNaN: true }),   // Y position (pixels)
        fc.double({ min: 30, max: 120, noNaN: true }),    // hourHeight (pixels)
        (y, hourHeight) => {
          const result = yToMinutes(y, hourHeight);

          expect(result).toBeGreaterThanOrEqual(0);
          expect(result).toBeLessThan(MINUTES_PER_DAY);
          expect(result % DEFAULT_SNAP_INCREMENT_MINUTES).toBe(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('yToMinutes produces valid results for extreme Y positions', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -5000, max: 50000, noNaN: true }),  // extreme Y
        fc.double({ min: 30, max: 120, noNaN: true }),
        (y, hourHeight) => {
          const result = yToMinutes(y, hourHeight);

          expect(result).toBeGreaterThanOrEqual(0);
          expect(result).toBeLessThan(MINUTES_PER_DAY);
          expect(result % DEFAULT_SNAP_INCREMENT_MINUTES).toBe(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('snapToIncrement works for arbitrary positive increments', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -500, max: 2000, noNaN: true }),
        fc.integer({ min: 1, max: 1440 }),
        (minutes, increment) => {
          const result = snapToIncrement(minutes, increment);

          expect(result).toBeGreaterThanOrEqual(0);
          expect(result).toBeLessThan(MINUTES_PER_DAY);
          // Must be a multiple of the increment (within floating-point tolerance)
          expect(result % increment).toBeCloseTo(0, 10);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('yToMinutes → minutesToY → yToMinutes round-trips for valid snapped inputs', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 30, max: 120, noNaN: true }),  // hourHeight
        fc.integer({ min: 0, max: 95 }),                 // snap index (0..95 → 0..1425)
        (hourHeight, snapIndex) => {
          const originalMinutes = snapIndex * DEFAULT_SNAP_INCREMENT_MINUTES;
          const y = minutesToY(originalMinutes, hourHeight);
          const roundTripped = yToMinutes(y, hourHeight);

          expect(roundTripped).toBe(originalMinutes);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── Property 6: Minimum event duration enforcement ──────────────────────────

describe('Property 6: Minimum event duration enforcement', () => {
  // Feature: competitive-ui-overhaul, Property 6: Minimum event duration
  // **Validates: Requirements 13.4, 12.7**

  it('computed end time is always >= start + 15 minutes', () => {
    fc.assert(
      fc.property(
        // startMinutes: a valid snapped start time in [0, 1425]
        fc.integer({ min: 0, max: 95 }).map((i) => i * 15),
        // dragEndMinutes: any raw minute value the user might drag to
        fc.double({ min: -100, max: 1600, noNaN: true }),
        (startMinutes, dragEndMinutes) => {
          const endMinutes = computeEndMinutes(startMinutes, dragEndMinutes);

          // End must be at least start + 15 minutes (minimum duration)
          expect(endMinutes).toBeGreaterThanOrEqual(startMinutes + MIN_EVENT_DURATION_MINUTES);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('computed end time is a valid snapped value or the minimum-duration floor', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 95 }).map((i) => i * 15),
        fc.double({ min: 0, max: 1440, noNaN: true }),
        (startMinutes, dragEndMinutes) => {
          const endMinutes = computeEndMinutes(startMinutes, dragEndMinutes);
          const minimumEnd = startMinutes + MIN_EVENT_DURATION_MINUTES;

          // The result is either the snapped drag position (if it's above the floor)
          // or the minimum-duration floor
          if (endMinutes > minimumEnd) {
            // When above the floor, it should be a snapped value
            expect(endMinutes % DEFAULT_SNAP_INCREMENT_MINUTES).toBe(0);
          } else {
            // When at the floor, it equals exactly start + 15
            expect(endMinutes).toBe(minimumEnd);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('dragging below the start time still produces minimum 15-minute duration', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 15, max: 95 }).map((i) => i * 15), // start >= 15 so drag can go below
        fc.double({ min: -100, max: 0, noNaN: true }),         // drag to negative / zero
        (startMinutes, dragEndMinutes) => {
          // Drag position is before the start time
          fc.pre(dragEndMinutes < startMinutes);

          const endMinutes = computeEndMinutes(startMinutes, dragEndMinutes);
          expect(endMinutes).toBeGreaterThanOrEqual(startMinutes + MIN_EVENT_DURATION_MINUTES);
        },
      ),
      { numRuns: 100 },
    );
  });
});
