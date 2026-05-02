/**
 * Unit tests for `ConflictIndicatorOverlay` (Task 9.19).
 *
 * The overlay's render output depends on Reanimated + react-native
 * platform primitives, so we focus the coverage on the exported pure
 * helper `buildConflictAccessibilityLabel` — which is the public
 * contract that downstream gesture controllers (`useDragReschedule` and
 * `useDragResize`) reuse to phrase their screen-reader announcements
 * (Task 9.11).
 *
 * Requirements: 4.4, 13.5
 */

import { buildConflictAccessibilityLabel } from '../conflictAccessibilityLabel';

describe('buildConflictAccessibilityLabel', () => {
  test('renders singular grammar for exactly one conflict', () => {
    expect(buildConflictAccessibilityLabel(1)).toBe(
      'Conflict with 1 existing event',
    );
  });

  test('renders plural grammar for two or more conflicts', () => {
    expect(buildConflictAccessibilityLabel(2)).toBe(
      'Conflict with 2 existing events',
    );
    expect(buildConflictAccessibilityLabel(3)).toBe(
      'Conflict with 3 existing events',
    );
    expect(buildConflictAccessibilityLabel(10)).toBe(
      'Conflict with 10 existing events',
    );
  });

  test('uses plural grammar for zero conflicts', () => {
    // Zero is a plural count in English ("0 events", not "0 event"),
    // matching the pluralisation rules the helper implements. The
    // parent gesture controllers should not normally call the helper
    // with a 0 count — they announce "No conflict" via a separate
    // code path — but the helper must still produce sensible output
    // if called.
    expect(buildConflictAccessibilityLabel(0)).toBe(
      'Conflict with 0 existing events',
    );
  });

  test('clamps negative counts to zero', () => {
    expect(buildConflictAccessibilityLabel(-1)).toBe(
      'Conflict with 0 existing events',
    );
    expect(buildConflictAccessibilityLabel(-100)).toBe(
      'Conflict with 0 existing events',
    );
  });

  test('floors non-integer counts', () => {
    // `Math.floor(1.7) === 1`, so the label still reads singular.
    expect(buildConflictAccessibilityLabel(1.7)).toBe(
      'Conflict with 1 existing event',
    );
    // `Math.floor(2.9) === 2`, so plural.
    expect(buildConflictAccessibilityLabel(2.9)).toBe(
      'Conflict with 2 existing events',
    );
  });

  test('handles very large counts without overflow or truncation', () => {
    expect(buildConflictAccessibilityLabel(999)).toBe(
      'Conflict with 999 existing events',
    );
  });
});
