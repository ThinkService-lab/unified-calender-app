/**
 * Unit tests for the pure helpers exported by `useDragReschedule`.
 *
 * The hook itself requires a full React + Reanimated runtime to exercise
 * (gesture machinery, animated styles, worklet runtime), which is covered
 * by the downstream integration task 18.1 once the hook is wired into
 * EventCards. These tests lock in the pure coordinate-math helper that
 * drives cross-day drag detection in week view.
 *
 * Requirements: 4.1, 4.2, 4.3, 4.5
 */

import { computeProposedColumnIndex } from '../dragRescheduleMath';

describe('computeProposedColumnIndex', () => {
  const visibleDayCount = 7; // week view
  const dayColumnWidth = 80;

  it('returns the initial column when there is no horizontal translation', () => {
    expect(computeProposedColumnIndex(0, dayColumnWidth, 3, visibleDayCount)).toBe(3);
  });

  it('advances one column when translationX equals dayColumnWidth', () => {
    expect(computeProposedColumnIndex(80, dayColumnWidth, 3, visibleDayCount)).toBe(4);
  });

  it('retreats one column on negative translation', () => {
    expect(computeProposedColumnIndex(-80, dayColumnWidth, 3, visibleDayCount)).toBe(2);
  });

  it('rounds to the nearest column (translations near half-width)', () => {
    // 41 / 80 = 0.5125 → rounds to 1
    expect(computeProposedColumnIndex(41, dayColumnWidth, 3, visibleDayCount)).toBe(4);
    // 39 / 80 = 0.4875 → rounds to 0
    expect(computeProposedColumnIndex(39, dayColumnWidth, 3, visibleDayCount)).toBe(3);
  });

  it('clamps to the left edge (column 0)', () => {
    // From column 0, dragging left should stay at 0.
    expect(computeProposedColumnIndex(-500, dayColumnWidth, 0, visibleDayCount)).toBe(0);
  });

  it('clamps to the right edge (column count - 1)', () => {
    expect(computeProposedColumnIndex(5000, dayColumnWidth, 3, visibleDayCount)).toBe(6);
  });

  it('handles day view (single column) by always returning 0', () => {
    expect(computeProposedColumnIndex(200, dayColumnWidth, 0, 1)).toBe(0);
    expect(computeProposedColumnIndex(-200, dayColumnWidth, 0, 1)).toBe(0);
  });

  it('returns the initial column when dayColumnWidth is zero or negative (guard)', () => {
    expect(computeProposedColumnIndex(100, 0, 3, visibleDayCount)).toBe(3);
    expect(computeProposedColumnIndex(100, -10, 3, visibleDayCount)).toBe(3);
  });

  it('returns the initial column when translationX is non-finite', () => {
    expect(computeProposedColumnIndex(Number.NaN, dayColumnWidth, 3, visibleDayCount)).toBe(3);
    expect(
      computeProposedColumnIndex(Number.POSITIVE_INFINITY, dayColumnWidth, 3, visibleDayCount),
    ).toBe(3);
  });

  it('handles zero visible day count without crashing', () => {
    // With no visible days, there's no valid column — result stays clamped at 0
    // (which is also the floor of the empty range).
    expect(computeProposedColumnIndex(100, dayColumnWidth, 0, 0)).toBe(0);
  });
});
