/**
 * Unit tests for timeSlotUtils – time snapping and coordinate conversion.
 *
 * These complement the property-based tests in timeSlotUtils.property.test.ts
 * by targeting specific edge cases and boundary conditions in the snapping
 * and conversion logic.
 *
 * Requirements: 4.2, 12.1, 12.2, 13.2
 */

import {
  snapToIncrement,
  yToMinutes,
  minutesToY,
  DEFAULT_SNAP_INCREMENT_MINUTES,
  TimeSlotPosition,
} from '../timeSlotUtils';

// ─── snapToIncrement ─────────────────────────────────────────────────────────

describe('snapToIncrement', () => {
  describe('basic snapping with 15-minute increments', () => {
    test('snaps 0 to 0', () => {
      expect(snapToIncrement(0, 15)).toBe(0);
    });

    test('snaps exact multiples of 15 to themselves', () => {
      expect(snapToIncrement(15, 15)).toBe(15);
      expect(snapToIncrement(60, 15)).toBe(60);
      expect(snapToIncrement(720, 15)).toBe(720);
      expect(snapToIncrement(1425, 15)).toBe(1425);
    });

    test('rounds to nearest 15-minute boundary', () => {
      expect(snapToIncrement(7, 15)).toBe(0);    // closer to 0 than 15
      expect(snapToIncrement(8, 15)).toBe(15);   // closer to 15 than 0
      expect(snapToIncrement(22, 15)).toBe(15);  // closer to 15 than 30
      expect(snapToIncrement(23, 15)).toBe(30);  // closer to 30 than 15
    });

    test('snaps midpoint values (rounding up per Math.round)', () => {
      // Math.round rounds 0.5 up
      expect(snapToIncrement(7.5, 15)).toBe(15);
    });
  });

  describe('boundary conditions at day limits', () => {
    test('values at or near 1440 clamp to 1425 (last valid 15-min slot)', () => {
      expect(snapToIncrement(1440, 15)).toBe(1425);
      expect(snapToIncrement(1439, 15)).toBe(1425);
      expect(snapToIncrement(1438, 15)).toBe(1425);
      expect(snapToIncrement(1433, 15)).toBe(1425);
    });

    test('values above 1440 clamp to 1425', () => {
      expect(snapToIncrement(1500, 15)).toBe(1425);
      expect(snapToIncrement(2000, 15)).toBe(1425);
      expect(snapToIncrement(100000, 15)).toBe(1425);
    });

    test('negative values clamp to 0', () => {
      expect(snapToIncrement(-1, 15)).toBe(0);
      expect(snapToIncrement(-100, 15)).toBe(0);
      expect(snapToIncrement(-999999, 15)).toBe(0);
    });
  });

  describe('non-standard increments', () => {
    test('works with 30-minute increments', () => {
      expect(snapToIncrement(0, 30)).toBe(0);
      expect(snapToIncrement(14, 30)).toBe(0);
      expect(snapToIncrement(16, 30)).toBe(30);
      expect(snapToIncrement(1420, 30)).toBe(1410);
    });

    test('works with 60-minute increments', () => {
      expect(snapToIncrement(0, 60)).toBe(0);
      expect(snapToIncrement(29, 60)).toBe(0);
      expect(snapToIncrement(31, 60)).toBe(60);
      expect(snapToIncrement(1400, 60)).toBe(1380);
    });

    test('works with 1-minute increments', () => {
      expect(snapToIncrement(0, 1)).toBe(0);
      expect(snapToIncrement(0.4, 1)).toBe(0);
      expect(snapToIncrement(0.6, 1)).toBe(1);
      expect(snapToIncrement(1439, 1)).toBe(1439);
    });

    test('increment of 1440 clamps result to 0', () => {
      // Only one multiple of 1440 fits in [0, 1440): that's 0
      expect(snapToIncrement(0, 1440)).toBe(0);
      expect(snapToIncrement(720, 1440)).toBe(0);
      expect(snapToIncrement(1439, 1440)).toBe(0);
    });

    test('increment larger than 1440 is treated as 1440', () => {
      expect(snapToIncrement(500, 2000)).toBe(0);
      expect(snapToIncrement(1000, 5000)).toBe(0);
    });
  });

  describe('invalid inputs (safety fallbacks)', () => {
    test('returns 0 for NaN minutes', () => {
      expect(snapToIncrement(NaN, 15)).toBe(0);
    });

    test('returns 0 for Infinity minutes', () => {
      expect(snapToIncrement(Infinity, 15)).toBe(0);
      expect(snapToIncrement(-Infinity, 15)).toBe(0);
    });

    test('returns 0 for NaN increment', () => {
      expect(snapToIncrement(100, NaN)).toBe(0);
    });

    test('returns 0 for Infinity increment', () => {
      expect(snapToIncrement(100, Infinity)).toBe(0);
    });

    test('returns 0 for zero increment', () => {
      expect(snapToIncrement(100, 0)).toBe(0);
    });

    test('returns 0 for negative increment', () => {
      expect(snapToIncrement(100, -15)).toBe(0);
    });

    test('returns 0 when both inputs are NaN', () => {
      expect(snapToIncrement(NaN, NaN)).toBe(0);
    });
  });
});

// ─── yToMinutes ──────────────────────────────────────────────────────────────

describe('yToMinutes', () => {
  describe('basic conversion', () => {
    test('y=0 maps to 0 minutes', () => {
      expect(yToMinutes(0, 60)).toBe(0);
    });

    test('y=hourHeight maps to 60 minutes (1 hour)', () => {
      expect(yToMinutes(60, 60)).toBe(60);
      expect(yToMinutes(80, 80)).toBe(60);
    });

    test('y=hourHeight/4 maps to 15 minutes (one snap increment)', () => {
      expect(yToMinutes(15, 60)).toBe(15);
      expect(yToMinutes(20, 80)).toBe(15);
    });

    test('y at 12 hours maps to 720 minutes', () => {
      expect(yToMinutes(720, 60)).toBe(720);
    });
  });

  describe('snapping behavior', () => {
    test('non-aligned Y positions snap to nearest 15-minute boundary', () => {
      // With hourHeight=60: 1px = 1min, so y=7 → 7min → snaps to 0
      expect(yToMinutes(7, 60)).toBe(0);
      // y=8 → 8min → snaps to 15
      expect(yToMinutes(8, 60)).toBe(15);
    });

    test('uses DEFAULT_SNAP_INCREMENT_MINUTES (15)', () => {
      expect(DEFAULT_SNAP_INCREMENT_MINUTES).toBe(15);
    });
  });

  describe('edge cases', () => {
    test('returns 0 for negative Y', () => {
      expect(yToMinutes(-10, 60)).toBe(0);
      expect(yToMinutes(-1000, 60)).toBe(0);
    });

    test('clamps large Y to max valid snap (1425)', () => {
      // y=2000 with hourHeight=60 → 2000min → clamps to 1425
      expect(yToMinutes(2000, 60)).toBe(1425);
    });

    test('returns 0 for hourHeight <= 0', () => {
      expect(yToMinutes(100, 0)).toBe(0);
      expect(yToMinutes(100, -1)).toBe(0);
    });

    test('returns 0 for non-finite inputs', () => {
      expect(yToMinutes(NaN, 60)).toBe(0);
      expect(yToMinutes(100, NaN)).toBe(0);
      expect(yToMinutes(Infinity, 60)).toBe(0);
      expect(yToMinutes(100, Infinity)).toBe(0);
    });
  });
});

// ─── minutesToY ──────────────────────────────────────────────────────────────

describe('minutesToY', () => {
  describe('basic conversion', () => {
    test('0 minutes maps to y=0', () => {
      expect(minutesToY(0, 60)).toBe(0);
    });

    test('60 minutes maps to y=hourHeight', () => {
      expect(minutesToY(60, 60)).toBe(60);
      expect(minutesToY(60, 80)).toBe(80);
    });

    test('15 minutes maps to y=hourHeight/4', () => {
      expect(minutesToY(15, 60)).toBe(15);
      expect(minutesToY(15, 80)).toBe(20);
    });

    test('720 minutes (noon) maps correctly', () => {
      expect(minutesToY(720, 60)).toBe(720);
      expect(minutesToY(720, 80)).toBe(960);
    });
  });

  describe('edge cases', () => {
    test('negative minutes return 0', () => {
      expect(minutesToY(-15, 60)).toBe(0);
      expect(minutesToY(-1000, 60)).toBe(0);
    });

    test('returns 0 for hourHeight <= 0', () => {
      expect(minutesToY(100, 0)).toBe(0);
      expect(minutesToY(100, -1)).toBe(0);
    });

    test('returns 0 for non-finite inputs', () => {
      expect(minutesToY(NaN, 60)).toBe(0);
      expect(minutesToY(100, NaN)).toBe(0);
      expect(minutesToY(Infinity, 60)).toBe(0);
    });
  });

  describe('inverse relationship with yToMinutes', () => {
    test('minutesToY → yToMinutes round-trips for aligned values', () => {
      const hourHeight = 60;
      for (let m = 0; m < 1440; m += 15) {
        const y = minutesToY(m, hourHeight);
        const roundTripped = yToMinutes(y, hourHeight);
        expect(roundTripped).toBe(m);
      }
    });

    test('round-trip works with different hourHeight values', () => {
      for (const hourHeight of [30, 48, 60, 80, 100, 120]) {
        for (const minutes of [0, 15, 60, 360, 720, 1425]) {
          const y = minutesToY(minutes, hourHeight);
          const roundTripped = yToMinutes(y, hourHeight);
          expect(roundTripped).toBe(minutes);
        }
      }
    });
  });
});

// ─── TimeSlotPosition interface ──────────────────────────────────────────────

describe('TimeSlotPosition', () => {
  test('interface can be constructed with valid values', () => {
    const slot: TimeSlotPosition = {
      date: new Date(2026, 3, 30),
      startMinutes: 540,  // 9:00 AM
      endMinutes: 600,    // 10:00 AM
      y: 540,             // with hourHeight=60
    };

    expect(slot.startMinutes).toBe(540);
    expect(slot.endMinutes).toBe(600);
    expect(slot.endMinutes).toBeGreaterThanOrEqual(slot.startMinutes);
  });
});

// ─── DEFAULT_SNAP_INCREMENT_MINUTES export ───────────────────────────────────

describe('DEFAULT_SNAP_INCREMENT_MINUTES', () => {
  test('is 15 (matching Req 4.2, 13.2)', () => {
    expect(DEFAULT_SNAP_INCREMENT_MINUTES).toBe(15);
  });

  test('divides evenly into 1440 (minutes per day)', () => {
    expect(1440 % DEFAULT_SNAP_INCREMENT_MINUTES).toBe(0);
  });
});
