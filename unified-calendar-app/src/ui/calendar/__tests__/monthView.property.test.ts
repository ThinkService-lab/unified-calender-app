/**
 * Property-based tests for Month View grid correctness.
 *
 * Feature: competitive-ui-overhaul, Property 9: Month grid correctness
 *
 * **Validates: Requirements 6.3**
 *
 * Generate random months (1–12) and years (1970–2099), verify
 * buildMonthGridData produces 42 cells with correct day numbers.
 */

import fc from 'fast-check';
import { buildMonthGridData, getMonthGridDates } from '../calendarViewModel';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Number of days in a given month (1-indexed month) */
function daysInMonth(year: number, month: number): number {
  // month is 1-indexed; Date constructor uses 0-indexed months.
  // Day 0 of the next month gives the last day of the target month.
  return new Date(year, month, 0).getDate();
}

/** Check if a year is a leap year */
function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

// ─── Property 9: Month grid correctness for any valid month ──────────────────

describe('Property 9: Month grid correctness for any valid month', () => {
  // Feature: competitive-ui-overhaul, Property 9: Month grid correctness
  // **Validates: Requirements 6.3**

  it('buildMonthGridData always produces exactly 42 cells for any valid month/year', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1970, max: 2099 }),  // year
        fc.integer({ min: 0, max: 11 }),        // month (0-indexed for Date constructor)
        (year, month) => {
          const date = new Date(year, month, 1);
          const gridData = buildMonthGridData(date, []);

          // Must always produce exactly 42 cells (6 weeks × 7 days)
          expect(gridData).toHaveLength(42);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('first cell of the grid is always a Sunday', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1970, max: 2099 }),
        fc.integer({ min: 0, max: 11 }),
        (year, month) => {
          const date = new Date(year, month, 1);
          const gridData = buildMonthGridData(date, []);

          // First cell should be a Sunday (day 0)
          expect(gridData[0].date.getDay()).toBe(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('last cell of the grid is always a Saturday', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1970, max: 2099 }),
        fc.integer({ min: 0, max: 11 }),
        (year, month) => {
          const date = new Date(year, month, 1);
          const gridData = buildMonthGridData(date, []);

          // Last cell should be a Saturday (day 6)
          expect(gridData[41].date.getDay()).toBe(6);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('grid cells are consecutive days (each cell is exactly 1 day after the previous)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1970, max: 2099 }),
        fc.integer({ min: 0, max: 11 }),
        (year, month) => {
          const date = new Date(year, month, 1);
          const gridData = buildMonthGridData(date, []);

          for (let i = 1; i < gridData.length; i++) {
            const prevDate = gridData[i - 1].date;
            const currDate = gridData[i].date;
            const diffMs = currDate.getTime() - prevDate.getTime();
            const diffDays = diffMs / (1000 * 60 * 60 * 24);

            // Each cell should be exactly 1 day after the previous
            expect(diffDays).toBeCloseTo(1, 0);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('all days of the target month appear in the grid with isCurrentMonth=true', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1970, max: 2099 }),
        fc.integer({ min: 0, max: 11 }),
        (year, month) => {
          const date = new Date(year, month, 1);
          const gridData = buildMonthGridData(date, []);

          const expectedDays = daysInMonth(year, month + 1); // daysInMonth uses 1-indexed month
          const currentMonthCells = gridData.filter((cell) => cell.isCurrentMonth);

          // All days of the month should be present
          expect(currentMonthCells).toHaveLength(expectedDays);

          // Day numbers should be 1 through expectedDays
          const dayNumbers = currentMonthCells.map((cell) => cell.date.getDate());
          for (let d = 1; d <= expectedDays; d++) {
            expect(dayNumbers).toContain(d);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('cells outside the target month have isCurrentMonth=false', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1970, max: 2099 }),
        fc.integer({ min: 0, max: 11 }),
        (year, month) => {
          const date = new Date(year, month, 1);
          const gridData = buildMonthGridData(date, []);

          const outsideCells = gridData.filter((cell) => !cell.isCurrentMonth);

          // All outside cells should have a different month
          for (const cell of outsideCells) {
            expect(cell.date.getMonth()).not.toBe(month);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('empty events array produces cells with empty event arrays (Req 6.1)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1970, max: 2099 }),
        fc.integer({ min: 0, max: 11 }),
        (year, month) => {
          const date = new Date(year, month, 1);
          const gridData = buildMonthGridData(date, []);

          // Every cell should have an empty events array
          for (const cell of gridData) {
            expect(cell.events).toEqual([]);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('February has 29 days in leap years and 28 in non-leap years', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1970, max: 2099 }),
        (year) => {
          const date = new Date(year, 1, 1); // February (0-indexed)
          const gridData = buildMonthGridData(date, []);
          const febCells = gridData.filter((cell) => cell.isCurrentMonth);

          if (isLeapYear(year)) {
            expect(febCells).toHaveLength(29);
          } else {
            expect(febCells).toHaveLength(28);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
