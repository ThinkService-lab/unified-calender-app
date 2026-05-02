/**
 * Unit tests for the pure helpers exported by `useDragResize` via
 * `./dragResizeMath`.
 *
 * The hook itself requires a full React + Reanimated + gesture-handler
 * runtime to exercise end-to-end, which is covered by the downstream
 * integration task (Task 18.1) once it is wired into EventCards. These
 * tests lock in the pure JS-thread helpers that drive the snap math,
 * DST-safe end-time construction, and minutes-of-day conversion so a
 * regression in the math is caught at unit-test time.
 *
 * Requirements: 13.2, 13.4, 13.7
 */

import { buildProposedEnd, dateToMinutesOfDay } from '../dragResizeMath';

describe('dateToMinutesOfDay', () => {
  it('returns 0 for midnight local time', () => {
    const midnight = new Date(2025, 0, 1, 0, 0, 0, 0);
    expect(dateToMinutesOfDay(midnight)).toBe(0);
  });

  it('returns 60 for 01:00 local time', () => {
    const oneAm = new Date(2025, 0, 1, 1, 0, 0, 0);
    expect(dateToMinutesOfDay(oneAm)).toBe(60);
  });

  it('returns 1439 for 23:59 local time', () => {
    const justBeforeMidnight = new Date(2025, 0, 1, 23, 59, 0, 0);
    expect(dateToMinutesOfDay(justBeforeMidnight)).toBe(23 * 60 + 59);
  });

  it('returns 10 * 60 + 7 = 607 for 10:07 (non-grid-aligned)', () => {
    // Task 9.14 context: non-grid-aligned end times are the scenario
    // that used to fire a spurious activation-frame haptic before the
    // snap-seeding fix landed. The helper itself does NOT snap — that
    // is snapToIncrement's job — so 10:07 stays 10:07 here.
    const tenOhSeven = new Date(2025, 0, 1, 10, 7, 0, 0);
    expect(dateToMinutesOfDay(tenOhSeven)).toBe(607);
  });

  it('ignores seconds and milliseconds (minutes-of-day only)', () => {
    const withSubMinute = new Date(2025, 0, 1, 14, 23, 45, 500);
    expect(dateToMinutesOfDay(withSubMinute)).toBe(14 * 60 + 23);
  });
});

describe('buildProposedEnd', () => {
  it('preserves the start date Y-M-D and applies the proposed H-M', () => {
    const start = new Date(2025, 5, 15, 9, 30, 0, 0); // June 15, 09:30
    const end = buildProposedEnd(start, 10 * 60 + 45); // 10:45

    expect(end.getFullYear()).toBe(2025);
    expect(end.getMonth()).toBe(5);
    expect(end.getDate()).toBe(15);
    expect(end.getHours()).toBe(10);
    expect(end.getMinutes()).toBe(45);
    expect(end.getSeconds()).toBe(0);
    expect(end.getMilliseconds()).toBe(0);
  });

  it('supports a proposed end exactly one minute after the start', () => {
    const start = new Date(2025, 5, 15, 9, 30, 0, 0);
    const end = buildProposedEnd(start, 9 * 60 + 31); // 09:31 — 1 minute after

    expect(end.getTime()).toBe(start.getTime() + 60 * 1000);
  });

  it('rolls the end forward by one day when proposedEndMin produces an end ≤ start', () => {
    // This only happens in pathological DST-rollback scenarios where
    // the local clock moves backward. We simulate by asking for an end
    // identical to the start time (0-minute duration) and verifying the
    // helper bumps the date forward rather than returning an end that
    // equals the start.
    const start = new Date(2025, 5, 15, 9, 30, 0, 0);
    const end = buildProposedEnd(start, 9 * 60 + 30); // exactly 09:30

    expect(end.getTime()).toBeGreaterThan(start.getTime());
    expect(end.getDate()).toBe(16); // rolled to the next day
    expect(end.getHours()).toBe(9);
    expect(end.getMinutes()).toBe(30);
  });

  it('does NOT roll forward when proposedEnd is strictly after start on the same day', () => {
    const start = new Date(2025, 5, 15, 9, 30, 0, 0);
    const end = buildProposedEnd(start, 15 * 60); // 15:00

    expect(end.getDate()).toBe(15); // same day
    expect(end.getHours()).toBe(15);
    expect(end.getMinutes()).toBe(0);
  });

  it('handles a proposed end at end-of-day (1439 minutes → 23:59)', () => {
    const start = new Date(2025, 5, 15, 0, 0, 0, 0);
    const end = buildProposedEnd(start, 23 * 60 + 59);

    expect(end.getDate()).toBe(15);
    expect(end.getHours()).toBe(23);
    expect(end.getMinutes()).toBe(59);
  });

  it('handles a proposed end at midnight (1440 minutes) by rolling to next day 00:00', () => {
    // `Date.setHours(24, 0)` rolls naturally to next-day 00:00, which
    // is strictly after the start — so no explicit bump is needed.
    const start = new Date(2025, 5, 15, 10, 0, 0, 0);
    const end = buildProposedEnd(start, 24 * 60);

    expect(end.getDate()).toBe(16);
    expect(end.getHours()).toBe(0);
    expect(end.getMinutes()).toBe(0);
  });
});
