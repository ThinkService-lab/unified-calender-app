/**
 * Unit tests for expandRecurrenceRule.
 * Requirements: 3.4, 3.5
 *
 * Covers all gaps identified in review:
 * - Gap #1: WKST respected in weekly BYDAY
 * - Gap #2: Yearly BYDAY without BYMONTH expands across all months
 * - Gap #3: Monthly day-clamping drift prevented
 * - Gap #4: BYSECOND test coverage
 * - Gap #5: BYWEEKNO and BYYEARDAY test coverage
 * - Gap #6: Combined BYxxx rules test coverage
 * - Gap #10: MAX_ITERATIONS guard
 * - Gap #11: Leap second (60) clamped to 59
 */

import { expandRecurrenceRule, DateRange } from '../expandRecurrenceRule';
import type { RecurrenceRule } from '../../types/models';

function makeRule(overrides: Partial<RecurrenceRule> = {}): RecurrenceRule {
  return {
    frequency: 'daily',
    interval: 1,
    count: null,
    until: null,
    bySecond: null,
    byMinute: null,
    byHour: null,
    byDay: null,
    byMonthDay: null,
    byYearDay: null,
    byWeekNo: null,
    byMonth: null,
    bySetPos: null,
    wkst: 'MO',
    exceptions: [],
    ...overrides,
  };
}

function utc(year: number, month: number, day: number, h = 0, m = 0, s = 0): Date {
  return new Date(Date.UTC(year, month - 1, day, h, m, s));
}

describe('expandRecurrenceRule', () => {
  const defaultRange: DateRange = {
    start: utc(2024, 1, 1),
    end: utc(2024, 12, 31),
  };

  describe('Daily frequency', () => {
    it('expands daily with interval 1', () => {
      const rule = makeRule({ frequency: 'daily', interval: 1, count: 5 });
      const start = utc(2024, 1, 1, 10, 0, 0);
      const results = expandRecurrenceRule(rule, start, defaultRange);

      expect(results).toHaveLength(5);
      expect(results[0]).toEqual(utc(2024, 1, 1, 10, 0, 0));
      expect(results[1]).toEqual(utc(2024, 1, 2, 10, 0, 0));
      expect(results[4]).toEqual(utc(2024, 1, 5, 10, 0, 0));
    });

    it('expands daily with interval 3', () => {
      const rule = makeRule({ frequency: 'daily', interval: 3, count: 4 });
      const start = utc(2024, 1, 1, 9, 0, 0);
      const results = expandRecurrenceRule(rule, start, defaultRange);

      expect(results).toHaveLength(4);
      expect(results[0]).toEqual(utc(2024, 1, 1, 9, 0, 0));
      expect(results[1]).toEqual(utc(2024, 1, 4, 9, 0, 0));
      expect(results[2]).toEqual(utc(2024, 1, 7, 9, 0, 0));
      expect(results[3]).toEqual(utc(2024, 1, 10, 9, 0, 0));
    });
  });

  describe('Weekly frequency', () => {
    it('expands weekly with interval 1', () => {
      const rule = makeRule({ frequency: 'weekly', interval: 1, count: 4 });
      const start = utc(2024, 1, 1, 10, 0, 0); // Monday
      const results = expandRecurrenceRule(rule, start, defaultRange);

      expect(results).toHaveLength(4);
      expect(results[0]).toEqual(utc(2024, 1, 1, 10, 0, 0));
      expect(results[1]).toEqual(utc(2024, 1, 8, 10, 0, 0));
      expect(results[2]).toEqual(utc(2024, 1, 15, 10, 0, 0));
      expect(results[3]).toEqual(utc(2024, 1, 22, 10, 0, 0));
    });

    it('expands weekly with BYDAY', () => {
      const rule = makeRule({
        frequency: 'weekly',
        interval: 1,
        count: 6,
        byDay: ['MO', 'WE', 'FR'],
      });
      const start = utc(2024, 1, 1, 10, 0, 0); // Monday
      const results = expandRecurrenceRule(rule, start, defaultRange);

      expect(results).toHaveLength(6);
      expect(results[0]).toEqual(utc(2024, 1, 1, 10, 0, 0));
      expect(results[1]).toEqual(utc(2024, 1, 3, 10, 0, 0));
      expect(results[2]).toEqual(utc(2024, 1, 5, 10, 0, 0));
      expect(results[3]).toEqual(utc(2024, 1, 8, 10, 0, 0));
      expect(results[4]).toEqual(utc(2024, 1, 10, 10, 0, 0));
      expect(results[5]).toEqual(utc(2024, 1, 12, 10, 0, 0));
    });
  });

  // Gap #1: WKST respected in weekly BYDAY
  describe('Weekly BYDAY with WKST (Gap #1)', () => {
    it('respects WKST=SU for week boundaries', () => {
      // Start on Wednesday Jan 3 2024, WKST=SU means week is Sun-Sat
      // BYDAY=MO,FR: In the week of Sun Dec 31 - Sat Jan 6:
      //   MO = Jan 1, FR = Jan 5
      // Range starts Jan 1, so both are in range.
      // count=4: Jan 1, Jan 5, Jan 8, Jan 12
      const rule = makeRule({
        frequency: 'weekly',
        interval: 1,
        count: 4,
        byDay: ['MO', 'FR'],
        wkst: 'SU',
      });
      const start = utc(2024, 1, 3, 10, 0, 0); // Wednesday
      const results = expandRecurrenceRule(rule, start, defaultRange);

      expect(results).toHaveLength(4);
      expect(results[0]).toEqual(utc(2024, 1, 1, 10, 0, 0));  // MO in week 1
      expect(results[1]).toEqual(utc(2024, 1, 5, 10, 0, 0));  // FR in week 1
      expect(results[2]).toEqual(utc(2024, 1, 8, 10, 0, 0));  // MO in week 2
      expect(results[3]).toEqual(utc(2024, 1, 12, 10, 0, 0)); // FR in week 2
    });

    it('WKST=MO produces different week grouping than WKST=SU', () => {
      // Start on Thursday Jan 4 2024
      // WKST=MO: week is Mon Jan 1 - Sun Jan 7
      // WKST=SU: week is Sun Dec 31 - Sat Jan 6
      // BYDAY=TU: With WKST=MO, TU in this week = Jan 2
      //           With WKST=SU, TU in this week = Jan 2 (same in this case)
      // But with BYDAY=SA:
      // WKST=MO: SA in week Mon Jan 1 - Sun Jan 7 = Jan 6
      // WKST=SU: SA in week Sun Dec 31 - Sat Jan 6 = Jan 6 (same)
      // Let's use a case where it matters: start on Sunday Jan 7
      // WKST=MO: week is Mon Jan 1 - Sun Jan 7, SA = Jan 6
      // WKST=SU: week is Sun Jan 7 - Sat Jan 13, SA = Jan 13
      const ruleMO = makeRule({
        frequency: 'weekly',
        interval: 1,
        count: 1,
        byDay: ['SA'],
        wkst: 'MO',
      });
      const ruleSU = makeRule({
        frequency: 'weekly',
        interval: 1,
        count: 1,
        byDay: ['SA'],
        wkst: 'SU',
      });
      const start = utc(2024, 1, 7, 10, 0, 0); // Sunday
      const range: DateRange = { start: utc(2024, 1, 1), end: utc(2024, 1, 31) };

      const resultsMO = expandRecurrenceRule(ruleMO, start, range);
      const resultsSU = expandRecurrenceRule(ruleSU, start, range);

      // WKST=MO: Sunday Jan 7 is in week Mon Jan 1 - Sun Jan 7, SA = Jan 6
      expect(resultsMO[0]).toEqual(utc(2024, 1, 6, 10, 0, 0));
      // WKST=SU: Sunday Jan 7 is in week Sun Jan 7 - Sat Jan 13, SA = Jan 13
      expect(resultsSU[0]).toEqual(utc(2024, 1, 13, 10, 0, 0));
    });
  });

  describe('Monthly frequency', () => {
    it('expands monthly with interval 1', () => {
      const rule = makeRule({ frequency: 'monthly', interval: 1, count: 3 });
      const start = utc(2024, 1, 15, 14, 0, 0);
      const results = expandRecurrenceRule(rule, start, defaultRange);

      expect(results).toHaveLength(3);
      expect(results[0]).toEqual(utc(2024, 1, 15, 14, 0, 0));
      expect(results[1]).toEqual(utc(2024, 2, 15, 14, 0, 0));
      expect(results[2]).toEqual(utc(2024, 3, 15, 14, 0, 0));
    });

    it('expands monthly with BYMONTHDAY', () => {
      const rule = makeRule({
        frequency: 'monthly',
        interval: 1,
        count: 3,
        byMonthDay: [1, 15],
      });
      const start = utc(2024, 1, 1, 10, 0, 0);
      const results = expandRecurrenceRule(rule, start, defaultRange);

      expect(results).toHaveLength(3);
      expect(results[0]).toEqual(utc(2024, 1, 1, 10, 0, 0));
      expect(results[1]).toEqual(utc(2024, 1, 15, 10, 0, 0));
      expect(results[2]).toEqual(utc(2024, 2, 1, 10, 0, 0));
    });

    it('expands monthly with positional BYDAY (+1MO = first Monday)', () => {
      const rule = makeRule({
        frequency: 'monthly',
        interval: 1,
        count: 3,
        byDay: ['+1MO'],
      });
      const start = utc(2024, 1, 1, 10, 0, 0);
      const results = expandRecurrenceRule(rule, start, defaultRange);

      expect(results).toHaveLength(3);
      expect(results[0]).toEqual(utc(2024, 1, 1, 10, 0, 0));
      expect(results[1]).toEqual(utc(2024, 2, 5, 10, 0, 0));
      expect(results[2]).toEqual(utc(2024, 3, 4, 10, 0, 0));
    });

    it('expands monthly with last Friday (-1FR)', () => {
      const rule = makeRule({
        frequency: 'monthly',
        interval: 1,
        count: 3,
        byDay: ['-1FR'],
      });
      const start = utc(2024, 1, 26, 10, 0, 0);
      const results = expandRecurrenceRule(rule, start, defaultRange);

      expect(results).toHaveLength(3);
      expect(results[0]).toEqual(utc(2024, 1, 26, 10, 0, 0));
      expect(results[1]).toEqual(utc(2024, 2, 23, 10, 0, 0));
      expect(results[2]).toEqual(utc(2024, 3, 29, 10, 0, 0));
    });
  });

  // Gap #3: Monthly day-clamping drift
  describe('Monthly day-clamping drift (Gap #3)', () => {
    it('preserves original day across months with fewer days', () => {
      // Jan 31 → Feb 29 (leap) → Mar 31 → Apr 30 → May 31
      const rule = makeRule({ frequency: 'monthly', interval: 1, count: 5 });
      const start = utc(2024, 1, 31, 10, 0, 0);
      const results = expandRecurrenceRule(rule, start, defaultRange);

      expect(results).toHaveLength(5);
      expect(results[0]).toEqual(utc(2024, 1, 31, 10, 0, 0)); // Jan 31
      expect(results[1]).toEqual(utc(2024, 2, 29, 10, 0, 0)); // Feb 29 (clamped)
      expect(results[2]).toEqual(utc(2024, 3, 31, 10, 0, 0)); // Mar 31 (NOT Mar 29!)
      expect(results[3]).toEqual(utc(2024, 4, 30, 10, 0, 0)); // Apr 30 (clamped)
      expect(results[4]).toEqual(utc(2024, 5, 31, 10, 0, 0)); // May 31 (NOT May 30!)
    });

    it('preserves day 30 across February', () => {
      const rule = makeRule({ frequency: 'monthly', interval: 1, count: 4 });
      const start = utc(2024, 1, 30, 10, 0, 0);
      const results = expandRecurrenceRule(rule, start, defaultRange);

      expect(results).toHaveLength(4);
      expect(results[0]).toEqual(utc(2024, 1, 30, 10, 0, 0)); // Jan 30
      expect(results[1]).toEqual(utc(2024, 2, 29, 10, 0, 0)); // Feb 29 (clamped)
      expect(results[2]).toEqual(utc(2024, 3, 30, 10, 0, 0)); // Mar 30 (NOT Mar 29!)
      expect(results[3]).toEqual(utc(2024, 4, 30, 10, 0, 0)); // Apr 30
    });
  });

  describe('Yearly frequency', () => {
    it('expands yearly with interval 1', () => {
      const rule = makeRule({ frequency: 'yearly', interval: 1, count: 3 });
      const start = utc(2024, 3, 15, 10, 0, 0);
      const range: DateRange = { start: utc(2024, 1, 1), end: utc(2030, 12, 31) };
      const results = expandRecurrenceRule(rule, start, range);

      expect(results).toHaveLength(3);
      expect(results[0]).toEqual(utc(2024, 3, 15, 10, 0, 0));
      expect(results[1]).toEqual(utc(2025, 3, 15, 10, 0, 0));
      expect(results[2]).toEqual(utc(2026, 3, 15, 10, 0, 0));
    });

    it('expands yearly with BYMONTH', () => {
      const rule = makeRule({
        frequency: 'yearly',
        interval: 1,
        count: 4,
        byMonth: [3, 9],
      });
      const start = utc(2024, 3, 15, 10, 0, 0);
      const range: DateRange = { start: utc(2024, 1, 1), end: utc(2030, 12, 31) };
      const results = expandRecurrenceRule(rule, start, range);

      expect(results).toHaveLength(4);
      expect(results[0].getUTCMonth()).toBe(2); // March
      expect(results[1].getUTCMonth()).toBe(8); // September
      expect(results[2].getUTCMonth()).toBe(2); // March next year
      expect(results[3].getUTCMonth()).toBe(8); // September next year
    });
  });

  // Gap #2: Yearly BYDAY without BYMONTH
  describe('Yearly BYDAY without BYMONTH (Gap #2)', () => {
    it('expands to all occurrences of the day across the entire year', () => {
      // YEARLY;BYDAY=MO;COUNT=3 should give the first 3 Mondays of the year
      const rule = makeRule({
        frequency: 'yearly',
        interval: 1,
        count: 3,
        byDay: ['MO'],
      });
      const start = utc(2024, 1, 1, 10, 0, 0); // Jan 1 2024 is a Monday
      const results = expandRecurrenceRule(rule, start, defaultRange);

      expect(results).toHaveLength(3);
      // First 3 Mondays of 2024: Jan 1, Jan 8, Jan 15
      expect(results[0]).toEqual(utc(2024, 1, 1, 10, 0, 0));
      expect(results[1]).toEqual(utc(2024, 1, 8, 10, 0, 0));
      expect(results[2]).toEqual(utc(2024, 1, 15, 10, 0, 0));
    });

    it('yearly BYDAY=MO without BYMONTH produces 52+ occurrences per year', () => {
      const rule = makeRule({
        frequency: 'yearly',
        interval: 1,
        byDay: ['MO'],
      });
      const start = utc(2024, 1, 1, 10, 0, 0);
      const range: DateRange = { start: utc(2024, 1, 1), end: utc(2024, 12, 31) };
      const results = expandRecurrenceRule(rule, start, range);

      // 2024 has 53 Mondays (Jan 1 is Monday, Dec 30 is Monday)
      expect(results.length).toBeGreaterThanOrEqual(52);
    });

    it('yearly BYDAY with BYMONTH narrows to that month only', () => {
      // YEARLY;BYMONTH=11;BYDAY=4TH (US Thanksgiving pattern)
      const rule = makeRule({
        frequency: 'yearly',
        interval: 1,
        count: 3,
        byMonth: [11],
        byDay: ['+4TH'],
      });
      const start = utc(2024, 11, 28, 10, 0, 0); // Nov 28 2024 is 4th Thursday
      const range: DateRange = { start: utc(2024, 1, 1), end: utc(2030, 12, 31) };
      const results = expandRecurrenceRule(rule, start, range);

      expect(results).toHaveLength(3);
      // 4th Thursday of November: 2024=Nov 28, 2025=Nov 27, 2026=Nov 26
      expect(results[0]).toEqual(utc(2024, 11, 28, 10, 0, 0));
      expect(results[1]).toEqual(utc(2025, 11, 27, 10, 0, 0));
      expect(results[2]).toEqual(utc(2026, 11, 26, 10, 0, 0));
    });
  });

  describe('COUNT and UNTIL limits', () => {
    it('respects COUNT limit', () => {
      const rule = makeRule({ frequency: 'daily', interval: 1, count: 3 });
      const start = utc(2024, 1, 1, 10, 0, 0);
      const results = expandRecurrenceRule(rule, start, defaultRange);
      expect(results).toHaveLength(3);
    });

    it('respects UNTIL limit', () => {
      const rule = makeRule({
        frequency: 'daily',
        interval: 1,
        until: utc(2024, 1, 5, 23, 59, 59),
      });
      const start = utc(2024, 1, 1, 10, 0, 0);
      const results = expandRecurrenceRule(rule, start, defaultRange);
      expect(results).toHaveLength(5);
      expect(results[4]).toEqual(utc(2024, 1, 5, 10, 0, 0));
    });

    it('COUNT takes precedence over UNTIL when both present', () => {
      const rule = makeRule({
        frequency: 'daily',
        interval: 1,
        count: 3,
        until: utc(2024, 1, 10),
      });
      const start = utc(2024, 1, 1, 10, 0, 0);
      const results = expandRecurrenceRule(rule, start, defaultRange);
      expect(results).toHaveLength(3);
    });
  });

  describe('EXDATE exceptions', () => {
    it('filters out exception dates', () => {
      const rule = makeRule({
        frequency: 'daily',
        interval: 1,
        count: 5,
        exceptions: [utc(2024, 1, 3)],
      });
      const start = utc(2024, 1, 1, 10, 0, 0);
      const results = expandRecurrenceRule(rule, start, defaultRange);
      expect(results.every((d) => d.getUTCDate() !== 3 || d.getUTCMonth() !== 0)).toBe(true);
    });

    it('exceptions do not count toward COUNT', () => {
      const rule = makeRule({
        frequency: 'daily',
        interval: 1,
        count: 3,
        exceptions: [utc(2024, 1, 2)],
      });
      const start = utc(2024, 1, 1, 10, 0, 0);
      const results = expandRecurrenceRule(rule, start, defaultRange);

      expect(results).toHaveLength(3);
      expect(results[0]).toEqual(utc(2024, 1, 1, 10, 0, 0));
      expect(results[1]).toEqual(utc(2024, 1, 3, 10, 0, 0));
      expect(results[2]).toEqual(utc(2024, 1, 4, 10, 0, 0));
    });
  });

  describe('Invalid dates handling', () => {
    it('silently skips Feb 30', () => {
      const rule = makeRule({
        frequency: 'monthly',
        interval: 1,
        count: 4,
        byMonthDay: [30],
      });
      const start = utc(2024, 1, 30, 10, 0, 0);
      const results = expandRecurrenceRule(rule, start, defaultRange);

      expect(results).toHaveLength(4);
      expect(results.every((d) => d.getUTCDate() === 30)).toBe(true);
      const months = results.map((d) => d.getUTCMonth());
      expect(months).not.toContain(1);
    });

    it('silently skips Feb 29 in non-leap years', () => {
      const rule = makeRule({
        frequency: 'yearly',
        interval: 1,
        count: 2,
        byMonth: [2],
        byMonthDay: [29],
      });
      const start = utc(2024, 2, 29, 10, 0, 0);
      const range: DateRange = { start: utc(2024, 1, 1), end: utc(2032, 12, 31) };
      const results = expandRecurrenceRule(rule, start, range);

      expect(results).toHaveLength(2);
      expect(results[0]).toEqual(utc(2024, 2, 29, 10, 0, 0));
      expect(results[1]).toEqual(utc(2028, 2, 29, 10, 0, 0));
    });
  });

  describe('BYSETPOS', () => {
    it('selects specific positions from expanded set', () => {
      const rule = makeRule({
        frequency: 'monthly',
        interval: 1,
        count: 2,
        byDay: ['MO', 'FR'],
        bySetPos: [-1],
      });
      const start = utc(2024, 1, 1, 10, 0, 0);
      const results = expandRecurrenceRule(rule, start, defaultRange);
      expect(results).toHaveLength(2);
    });
  });

  describe('Range filtering', () => {
    it('only returns dates within the specified range', () => {
      const rule = makeRule({ frequency: 'daily', interval: 1, count: 100 });
      const start = utc(2024, 1, 1, 10, 0, 0);
      const range: DateRange = { start: utc(2024, 1, 5), end: utc(2024, 1, 10) };
      const results = expandRecurrenceRule(rule, start, range);

      expect(results.length).toBeGreaterThan(0);
      for (const d of results) {
        expect(d.getTime()).toBeGreaterThanOrEqual(range.start.getTime());
        expect(d.getTime()).toBeLessThanOrEqual(range.end.getTime());
      }
    });

    it('returns empty array when no occurrences fall in range', () => {
      const rule = makeRule({ frequency: 'daily', interval: 1, count: 3 });
      const start = utc(2024, 1, 1, 10, 0, 0);
      const range: DateRange = { start: utc(2024, 6, 1), end: utc(2024, 6, 30) };
      const results = expandRecurrenceRule(rule, start, range);
      expect(results).toHaveLength(0);
    });
  });

  describe('BYHOUR, BYMINUTE, BYSECOND', () => {
    it('expands with BYHOUR', () => {
      const rule = makeRule({
        frequency: 'daily',
        interval: 1,
        count: 4,
        byHour: [9, 17],
      });
      const start = utc(2024, 1, 1, 9, 0, 0);
      const results = expandRecurrenceRule(rule, start, defaultRange);

      expect(results).toHaveLength(4);
      expect(results[0]).toEqual(utc(2024, 1, 1, 9, 0, 0));
      expect(results[1]).toEqual(utc(2024, 1, 1, 17, 0, 0));
      expect(results[2]).toEqual(utc(2024, 1, 2, 9, 0, 0));
      expect(results[3]).toEqual(utc(2024, 1, 2, 17, 0, 0));
    });

    it('expands with BYMINUTE', () => {
      const rule = makeRule({
        frequency: 'daily',
        interval: 1,
        count: 4,
        byMinute: [0, 30],
      });
      const start = utc(2024, 1, 1, 10, 0, 0);
      const results = expandRecurrenceRule(rule, start, defaultRange);

      expect(results).toHaveLength(4);
      expect(results[0]).toEqual(utc(2024, 1, 1, 10, 0, 0));
      expect(results[1]).toEqual(utc(2024, 1, 1, 10, 30, 0));
      expect(results[2]).toEqual(utc(2024, 1, 2, 10, 0, 0));
      expect(results[3]).toEqual(utc(2024, 1, 2, 10, 30, 0));
    });

    // Gap #4: BYSECOND test coverage
    it('expands with BYSECOND', () => {
      const rule = makeRule({
        frequency: 'daily',
        interval: 1,
        count: 4,
        bySecond: [0, 30],
      });
      const start = utc(2024, 1, 1, 10, 0, 0);
      const results = expandRecurrenceRule(rule, start, defaultRange);

      expect(results).toHaveLength(4);
      expect(results[0]).toEqual(utc(2024, 1, 1, 10, 0, 0));
      expect(results[1]).toEqual(utc(2024, 1, 1, 10, 0, 30));
      expect(results[2]).toEqual(utc(2024, 1, 2, 10, 0, 0));
      expect(results[3]).toEqual(utc(2024, 1, 2, 10, 0, 30));
    });

    // Gap #11: Leap second clamped to 59
    it('clamps leap second (60) to 59', () => {
      const rule = makeRule({
        frequency: 'daily',
        interval: 1,
        count: 2,
        bySecond: [59, 60],
      });
      const start = utc(2024, 1, 1, 10, 0, 0);
      const results = expandRecurrenceRule(rule, start, defaultRange);

      // 60 is clamped to 59, so both produce :59 — deduplicated to 1 per day
      // Actually: first candidate is day 1 with seconds [59, 59(clamped from 60)]
      // After dedup: just one per day. So count=2 means 2 unique dates.
      expect(results.length).toBe(2);
      expect(results[0].getUTCSeconds()).toBe(59);
      expect(results[1].getUTCSeconds()).toBe(59);
    });
  });

  describe('Negative BYMONTHDAY', () => {
    it('handles negative BYMONTHDAY (-1 = last day)', () => {
      const rule = makeRule({
        frequency: 'monthly',
        interval: 1,
        count: 3,
        byMonthDay: [-1],
      });
      const start = utc(2024, 1, 31, 10, 0, 0);
      const results = expandRecurrenceRule(rule, start, defaultRange);

      expect(results).toHaveLength(3);
      expect(results[0]).toEqual(utc(2024, 1, 31, 10, 0, 0));
      expect(results[1]).toEqual(utc(2024, 2, 29, 10, 0, 0));
      expect(results[2]).toEqual(utc(2024, 3, 31, 10, 0, 0));
    });
  });

  // Gap #5: BYWEEKNO and BYYEARDAY test coverage
  describe('BYWEEKNO (Gap #5)', () => {
    it('expands yearly with BYWEEKNO', () => {
      const rule = makeRule({
        frequency: 'yearly',
        interval: 1,
        count: 7,
        byWeekNo: [1],
      });
      const start = utc(2024, 1, 1, 10, 0, 0);
      const results = expandRecurrenceRule(rule, start, defaultRange);

      // Week 1 of 2024 (WKST=MO): Mon Dec 31 2023 - Sun Jan 7 2024
      // Only dates in 2024: Jan 1-7 = 7 dates
      expect(results).toHaveLength(7);
      for (const d of results) {
        expect(d.getUTCFullYear()).toBe(2024);
      }
    });
  });

  describe('BYYEARDAY (Gap #5)', () => {
    it('expands with positive BYYEARDAY', () => {
      const rule = makeRule({
        frequency: 'yearly',
        interval: 1,
        count: 2,
        byYearDay: [1, 365],
      });
      const start = utc(2024, 1, 1, 10, 0, 0);
      const range: DateRange = { start: utc(2024, 1, 1), end: utc(2025, 12, 31) };
      const results = expandRecurrenceRule(rule, start, range);

      expect(results).toHaveLength(2);
      expect(results[0]).toEqual(utc(2024, 1, 1, 10, 0, 0)); // Day 1 = Jan 1
      expect(results[1]).toEqual(utc(2024, 12, 30, 10, 0, 0)); // Day 365 of leap year = Dec 30
    });

    it('expands with negative BYYEARDAY (-1 = last day)', () => {
      const rule = makeRule({
        frequency: 'yearly',
        interval: 1,
        count: 1,
        byYearDay: [-1],
      });
      const start = utc(2024, 1, 1, 10, 0, 0);
      // Range must include Dec 31
      const range: DateRange = { start: utc(2024, 1, 1), end: utc(2024, 12, 31, 23, 59, 59) };
      const results = expandRecurrenceRule(rule, start, range);

      // Last day of 2024 (leap year, 366 days) = Dec 31
      expect(results).toHaveLength(1);
      expect(results[0]).toEqual(utc(2024, 12, 31, 10, 0, 0));
    });
  });

  // Gap #6: Combined BYxxx rules
  describe('Combined BYxxx rules (Gap #6)', () => {
    it('MONTHLY;BYDAY=MO,FR;BYSETPOS=1 gives first MO or FR of each month', () => {
      const rule = makeRule({
        frequency: 'monthly',
        interval: 1,
        count: 3,
        byDay: ['MO', 'FR'],
        bySetPos: [1],
      });
      const start = utc(2024, 1, 1, 10, 0, 0);
      const results = expandRecurrenceRule(rule, start, defaultRange);

      expect(results).toHaveLength(3);
      // Jan 2024: first MO=Jan 1, first FR=Jan 5 → BYSETPOS=1 → Jan 1
      expect(results[0]).toEqual(utc(2024, 1, 1, 10, 0, 0));
      // Feb 2024: first MO=Feb 5, first FR=Feb 2 → BYSETPOS=1 → Feb 2
      expect(results[1]).toEqual(utc(2024, 2, 2, 10, 0, 0));
      // Mar 2024: first MO=Mar 4, first FR=Mar 1 → BYSETPOS=1 → Mar 1
      expect(results[2]).toEqual(utc(2024, 3, 1, 10, 0, 0));
    });

    it('YEARLY;BYMONTH=11;BYDAY=+4TH (US Thanksgiving)', () => {
      const rule = makeRule({
        frequency: 'yearly',
        interval: 1,
        count: 2,
        byMonth: [11],
        byDay: ['+4TH'],
      });
      const start = utc(2024, 11, 28, 10, 0, 0);
      const range: DateRange = { start: utc(2024, 1, 1), end: utc(2030, 12, 31) };
      const results = expandRecurrenceRule(rule, start, range);

      expect(results).toHaveLength(2);
      expect(results[0]).toEqual(utc(2024, 11, 28, 10, 0, 0));
      expect(results[1]).toEqual(utc(2025, 11, 27, 10, 0, 0));
    });

    it('DAILY;BYHOUR=9,17;BYMINUTE=0,30 produces 4 occurrences per day', () => {
      const rule = makeRule({
        frequency: 'daily',
        interval: 1,
        count: 8,
        byHour: [9, 17],
        byMinute: [0, 30],
      });
      const start = utc(2024, 1, 1, 9, 0, 0);
      const results = expandRecurrenceRule(rule, start, defaultRange);

      expect(results).toHaveLength(8);
      // Day 1: 9:00, 9:30, 17:00, 17:30
      expect(results[0]).toEqual(utc(2024, 1, 1, 9, 0, 0));
      expect(results[1]).toEqual(utc(2024, 1, 1, 9, 30, 0));
      expect(results[2]).toEqual(utc(2024, 1, 1, 17, 0, 0));
      expect(results[3]).toEqual(utc(2024, 1, 1, 17, 30, 0));
      // Day 2: 9:00, 9:30, 17:00, 17:30
      expect(results[4]).toEqual(utc(2024, 1, 2, 9, 0, 0));
    });
  });

  // Gap #10: MAX_ITERATIONS guard
  describe('MAX_ITERATIONS guard (Gap #10)', () => {
    it('caps results when no COUNT/UNTIL and large range', () => {
      const rule = makeRule({
        frequency: 'daily',
        interval: 1,
        // No count, no until
      });
      const start = utc(2024, 1, 1, 10, 0, 0);
      const range: DateRange = { start: utc(2024, 1, 1), end: utc(2100, 12, 31) };
      const results = expandRecurrenceRule(rule, start, range);

      // Should be capped, not produce 28000+ results
      expect(results.length).toBeLessThanOrEqual(10001);
      expect(results.length).toBeGreaterThan(0);
    });
  });
});
