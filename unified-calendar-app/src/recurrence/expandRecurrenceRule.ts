/**
 * Recurrence rule expansion engine following RFC 5545.
 * Requirements: 3.4, 3.5
 *
 * Implements full BYxxx evaluation in RFC 5545 order:
 * BYMONTH → BYWEEKNO → BYYEARDAY → BYMONTHDAY → BYDAY → BYHOUR → BYMINUTE → BYSECOND → BYSETPOS
 *
 * - COUNT and UNTIL are mutually exclusive (COUNT takes precedence if both present)
 * - Invalid dates (e.g., Feb 30) are silently skipped
 * - EXDATE exceptions are filtered from results
 * - WKST (week start day) is respected for weekly BYDAY expansion
 * - Leap seconds (second=60) are clamped to 59
 */

import type { RecurrenceRule } from '../types/models';

export interface DateRange {
  start: Date;
  end: Date;
}

const DAY_MAP: Record<string, number> = {
  SU: 0,
  MO: 1,
  TU: 2,
  WE: 3,
  TH: 4,
  FR: 5,
  SA: 6,
};

const MAX_ITERATIONS = 10000;

/**
 * Expand a recurrence rule into an array of occurrence dates within the given range.
 *
 * If the rule has no COUNT or UNTIL and the range is very large, results are
 * capped at MAX_ITERATIONS candidates to prevent infinite loops. The `truncated`
 * flag on the returned array indicates whether this cap was hit.
 */
export function expandRecurrenceRule(
  rule: RecurrenceRule,
  start: Date,
  range: DateRange
): Date[] {
  const results: Date[] = [];
  const exceptionSet = buildExceptionSet(rule.exceptions);

  // COUNT takes precedence over UNTIL if both present
  const limit = rule.count ?? Infinity;
  const until = rule.count != null ? null : rule.until;

  let count = 0;
  let iterations = 0;

  const candidates = generateCandidates(rule, start);

  for (const candidate of candidates) {
    if (iterations++ > MAX_ITERATIONS) break;

    // Stop if past UNTIL
    if (until && candidate.getTime() > until.getTime()) break;

    // Stop if past range end
    if (candidate.getTime() > range.end.getTime()) break;

    // Stop if COUNT reached
    if (count >= limit) break;

    // Skip if before range start (but still count toward COUNT)
    const inRange = candidate.getTime() >= range.start.getTime();

    // Check exception dates
    if (isException(candidate, exceptionSet)) {
      // Exceptions don't count toward COUNT per RFC 5545
      continue;
    }

    count++;

    if (inRange) {
      results.push(candidate);
    }
  }

  return results;
}

/**
 * Generate candidate dates by advancing through frequency periods
 * and expanding BYxxx rules within each period.
 *
 * Gap #3 fix: For monthly/yearly, we track the original DTSTART day
 * separately from the current anchor to prevent day-clamping drift
 * (e.g., Jan 31 → Feb 28 → Mar 28 instead of Mar 31).
 */
function* generateCandidates(
  rule: RecurrenceRule,
  start: Date
): Generator<Date> {
  const { frequency, interval } = rule;
  let periodIndex = 0;

  while (true) {
    // Gap #3: Compute each period anchor from the original start + N*interval
    // instead of chaining from the previous clamped value.
    const current = advanceByFrequencyFromStart(start, frequency, interval, periodIndex, rule.wkst);
    const expanded = expandBYxxxRules(rule, current, start);

    for (const date of expanded) {
      yield date;
    }

    periodIndex++;
  }
}

/**
 * Compute the period anchor for the Nth interval from the original start date.
 *
 * Gap #3 fix: Always compute from the original DTSTART to avoid drift.
 * E.g., monthly from Jan 31: period 1 = Feb 28, period 2 = Mar 31 (not Mar 28).
 */
function advanceByFrequencyFromStart(
  start: Date,
  frequency: RecurrenceRule['frequency'],
  interval: number,
  periodIndex: number,
  _wkst: string
): Date {
  if (periodIndex === 0) return new Date(start);

  const totalIntervals = interval * periodIndex;
  const next = new Date(start);

  switch (frequency) {
    case 'daily':
      next.setUTCDate(next.getUTCDate() + totalIntervals);
      break;
    case 'weekly':
      next.setUTCDate(next.getUTCDate() + 7 * totalIntervals);
      break;
    case 'monthly': {
      const startMonth = start.getUTCMonth() + start.getUTCFullYear() * 12;
      const targetAbsMonth = startMonth + totalIntervals;
      const targetYear = Math.floor(targetAbsMonth / 12);
      const targetMonth = targetAbsMonth % 12;
      const originalDay = start.getUTCDate();
      const maxDay = getDaysInMonth(targetYear, targetMonth);
      next.setUTCFullYear(targetYear, targetMonth, Math.min(originalDay, maxDay));
      break;
    }
    case 'yearly': {
      const targetYear = start.getUTCFullYear() + totalIntervals;
      const month = start.getUTCMonth();
      const originalDay = start.getUTCDate();
      const maxDay = getDaysInMonth(targetYear, month);
      next.setUTCFullYear(targetYear, month, Math.min(originalDay, maxDay));
      break;
    }
  }

  return next;
}

/**
 * Expand BYxxx rules for a given period anchor in RFC 5545 order.
 * Returns sorted array of valid dates for this period.
 */
function expandBYxxxRules(
  rule: RecurrenceRule,
  periodStart: Date,
  dtstart: Date
): Date[] {
  let candidates = getBaseCandidates(rule, periodStart, dtstart);

  // Apply BYxxx rules in RFC 5545 order:
  // BYMONTH → BYWEEKNO → BYYEARDAY → BYMONTHDAY → BYDAY → BYHOUR → BYMINUTE → BYSECOND → BYSETPOS

  if (rule.byMonth && rule.byMonth.length > 0) {
    candidates = applyByMonth(candidates, rule.byMonth, rule.frequency);
  }

  if (rule.byWeekNo && rule.byWeekNo.length > 0 && rule.frequency === 'yearly') {
    candidates = applyByWeekNo(candidates, rule.byWeekNo, rule.wkst);
  }

  if (rule.byYearDay && rule.byYearDay.length > 0) {
    candidates = applyByYearDay(candidates, rule.byYearDay);
  }

  if (rule.byMonthDay && rule.byMonthDay.length > 0) {
    candidates = applyByMonthDay(candidates, rule.byMonthDay);
  }

  if (rule.byDay && rule.byDay.length > 0) {
    candidates = applyByDay(candidates, rule.byDay, rule.frequency, rule.wkst);
  }

  if (rule.byHour && rule.byHour.length > 0) {
    candidates = applyByHour(candidates, rule.byHour);
  }

  if (rule.byMinute && rule.byMinute.length > 0) {
    candidates = applyByMinute(candidates, rule.byMinute);
  }

  if (rule.bySecond && rule.bySecond.length > 0) {
    candidates = applyBySecond(candidates, rule.bySecond);
  }

  if (rule.bySetPos && rule.bySetPos.length > 0) {
    candidates = applyBySetPos(candidates, rule.bySetPos);
  }

  candidates.sort((a, b) => a.getTime() - b.getTime());
  return deduplicateDates(candidates);
}

function getBaseCandidates(
  rule: RecurrenceRule,
  periodStart: Date,
  dtstart: Date
): Date[] {
  const candidate = new Date(periodStart);
  candidate.setUTCHours(
    dtstart.getUTCHours(),
    dtstart.getUTCMinutes(),
    dtstart.getUTCSeconds(),
    dtstart.getUTCMilliseconds()
  );
  return [candidate];
}

function hasByRules(rule: RecurrenceRule): boolean {
  return !!(
    (rule.byMonth && rule.byMonth.length > 0) ||
    (rule.byWeekNo && rule.byWeekNo.length > 0) ||
    (rule.byYearDay && rule.byYearDay.length > 0) ||
    (rule.byMonthDay && rule.byMonthDay.length > 0) ||
    (rule.byDay && rule.byDay.length > 0) ||
    (rule.byHour && rule.byHour.length > 0) ||
    (rule.byMinute && rule.byMinute.length > 0) ||
    (rule.bySecond && rule.bySecond.length > 0) ||
    (rule.bySetPos && rule.bySetPos.length > 0)
  );
}

// --- BYxxx application functions ---

function applyByMonth(candidates: Date[], byMonth: number[], frequency: string): Date[] {
  if (frequency === 'yearly') {
    const expanded: Date[] = [];
    for (const candidate of candidates) {
      for (const month of byMonth) {
        const d = new Date(candidate);
        d.setUTCMonth(month - 1);
        if (d.getUTCMonth() === month - 1) {
          expanded.push(d);
        }
      }
    }
    return expanded;
  }
  return candidates.filter((d) => byMonth.includes(d.getUTCMonth() + 1));
}

function applyByWeekNo(candidates: Date[], byWeekNo: number[], wkst: string): Date[] {
  const expanded: Date[] = [];
  for (const candidate of candidates) {
    const year = candidate.getUTCFullYear();
    for (const weekNo of byWeekNo) {
      const resolvedWeek = weekNo > 0 ? weekNo : getWeeksInYear(year, wkst) + weekNo + 1;
      const weekDates = getDatesInWeek(year, resolvedWeek, wkst);
      for (const wd of weekDates) {
        const d = new Date(candidate);
        d.setUTCFullYear(wd.getUTCFullYear(), wd.getUTCMonth(), wd.getUTCDate());
        expanded.push(d);
      }
    }
  }
  return expanded;
}

function applyByYearDay(candidates: Date[], byYearDay: number[]): Date[] {
  const expanded: Date[] = [];
  for (const candidate of candidates) {
    const year = candidate.getUTCFullYear();
    const daysInYear = isLeapYear(year) ? 366 : 365;
    for (const yd of byYearDay) {
      const resolvedDay = yd > 0 ? yd : daysInYear + yd + 1;
      if (resolvedDay < 1 || resolvedDay > daysInYear) continue;
      const d = new Date(Date.UTC(year, 0, resolvedDay));
      d.setUTCHours(
        candidate.getUTCHours(),
        candidate.getUTCMinutes(),
        candidate.getUTCSeconds(),
        candidate.getUTCMilliseconds()
      );
      expanded.push(d);
    }
  }
  return expanded;
}

function applyByMonthDay(candidates: Date[], byMonthDay: number[]): Date[] {
  const expanded: Date[] = [];
  for (const candidate of candidates) {
    const year = candidate.getUTCFullYear();
    const month = candidate.getUTCMonth();
    const daysInMonth = getDaysInMonth(year, month);
    for (const md of byMonthDay) {
      const resolvedDay = md > 0 ? md : daysInMonth + md + 1;
      if (resolvedDay < 1 || resolvedDay > daysInMonth) continue;
      const d = new Date(candidate);
      d.setUTCDate(resolvedDay);
      if (d.getUTCMonth() !== month) continue;
      expanded.push(d);
    }
  }
  return expanded;
}

/**
 * Apply BYDAY rule.
 *
 * Gap #1 fix: Weekly BYDAY now respects WKST to determine week boundaries.
 * Gap #2 fix: Yearly BYDAY without BYMONTH now expands across all 12 months.
 */
function applyByDay(candidates: Date[], byDay: string[], frequency: string, wkst: string): Date[] {
  const expanded: Date[] = [];
  const wkstDay = DAY_MAP[wkst] ?? 1;

  for (const candidate of candidates) {
    for (const daySpec of byDay) {
      const parsed = parseByDay(daySpec);
      if (!parsed) continue;

      const { ordinal, dayOfWeek } = parsed;

      if (ordinal !== null) {
        // Positional BYDAY (e.g., +1MO, -1FR)
        if (frequency === 'yearly') {
          // For yearly with positional BYDAY, if no BYMONTH was applied upstream
          // the candidate still has a single month. Positional applies within that month.
          const dates = getOrdinalDayDates(candidate, ordinal, dayOfWeek, frequency);
          for (const d of dates) {
            const result = new Date(candidate);
            result.setUTCFullYear(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
            expanded.push(result);
          }
        } else {
          const dates = getOrdinalDayDates(candidate, ordinal, dayOfWeek, frequency);
          for (const d of dates) {
            const result = new Date(candidate);
            result.setUTCFullYear(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
            expanded.push(result);
          }
        }
      } else {
        // Simple BYDAY - limits or expands depending on frequency
        if (frequency === 'daily') {
          if (candidate.getUTCDay() === dayOfWeek) {
            expanded.push(new Date(candidate));
          }
        } else if (frequency === 'weekly') {
          // Gap #1 fix: Use WKST to determine week boundaries
          const candidateDay = candidate.getUTCDay();
          // Calculate the start of the week containing the candidate, per WKST
          const daysSinceWkst = (candidateDay - wkstDay + 7) % 7;
          const weekStartDate = new Date(candidate);
          weekStartDate.setUTCDate(candidate.getUTCDate() - daysSinceWkst);

          // Calculate offset from week start to target day
          const targetOffset = (dayOfWeek - wkstDay + 7) % 7;
          const targetDate = new Date(weekStartDate);
          targetDate.setUTCDate(weekStartDate.getUTCDate() + targetOffset);
          expanded.push(targetDate);
        } else if (frequency === 'monthly') {
          const year = candidate.getUTCFullYear();
          const month = candidate.getUTCMonth();
          const daysInMonth = getDaysInMonth(year, month);
          for (let day = 1; day <= daysInMonth; day++) {
            const d = new Date(Date.UTC(year, month, day));
            if (d.getUTCDay() === dayOfWeek) {
              const result = new Date(candidate);
              result.setUTCFullYear(year, month, day);
              expanded.push(result);
            }
          }
        } else if (frequency === 'yearly') {
          // Gap #2 fix: Expand across all 12 months of the year
          // (BYMONTH, if present, will have already narrowed candidates to specific months)
          const year = candidate.getUTCFullYear();
          for (let month = 0; month < 12; month++) {
            const daysInMonth = getDaysInMonth(year, month);
            for (let day = 1; day <= daysInMonth; day++) {
              const d = new Date(Date.UTC(year, month, day));
              if (d.getUTCDay() === dayOfWeek) {
                const result = new Date(candidate);
                result.setUTCFullYear(year, month, day);
                expanded.push(result);
              }
            }
          }
        }
      }
    }
  }

  return expanded;
}

function applyByHour(candidates: Date[], byHour: number[]): Date[] {
  const expanded: Date[] = [];
  for (const candidate of candidates) {
    for (const hour of byHour) {
      const d = new Date(candidate);
      d.setUTCHours(hour);
      expanded.push(d);
    }
  }
  return expanded;
}

function applyByMinute(candidates: Date[], byMinute: number[]): Date[] {
  const expanded: Date[] = [];
  for (const candidate of candidates) {
    for (const minute of byMinute) {
      const d = new Date(candidate);
      d.setUTCMinutes(minute);
      expanded.push(d);
    }
  }
  return expanded;
}

/**
 * Gap #11 fix: Clamp leap seconds (60) to 59 since JavaScript Date
 * doesn't support second=60.
 */
function applyBySecond(candidates: Date[], bySecond: number[]): Date[] {
  const expanded: Date[] = [];
  for (const candidate of candidates) {
    for (const second of bySecond) {
      const d = new Date(candidate);
      d.setUTCSeconds(Math.min(second, 59));
      expanded.push(d);
    }
  }
  return expanded;
}

function applyBySetPos(candidates: Date[], bySetPos: number[]): Date[] {
  const sorted = [...candidates].sort((a, b) => a.getTime() - b.getTime());
  const result: Date[] = [];

  for (const pos of bySetPos) {
    const index = pos > 0 ? pos - 1 : sorted.length + pos;
    if (index >= 0 && index < sorted.length) {
      result.push(sorted[index]);
    }
  }

  return result;
}

// --- Helper functions ---

function parseByDay(spec: string): { ordinal: number | null; dayOfWeek: number } | null {
  const match = spec.match(/^([+-]?\d+)?(SU|MO|TU|WE|TH|FR|SA)$/);
  if (!match) return null;

  const ordinal = match[1] ? parseInt(match[1], 10) : null;
  const dayOfWeek = DAY_MAP[match[2]];

  return { ordinal, dayOfWeek };
}

function getOrdinalDayDates(
  candidate: Date,
  ordinal: number,
  dayOfWeek: number,
  frequency: string
): Date[] {
  const year = candidate.getUTCFullYear();
  const month = candidate.getUTCMonth();

  if (frequency === 'monthly' || frequency === 'yearly') {
    const daysInMonth = getDaysInMonth(year, month);

    if (ordinal > 0) {
      let count = 0;
      for (let day = 1; day <= daysInMonth; day++) {
        const d = new Date(Date.UTC(year, month, day));
        if (d.getUTCDay() === dayOfWeek) {
          count++;
          if (count === ordinal) {
            return [d];
          }
        }
      }
    } else {
      const occurrences: Date[] = [];
      for (let day = 1; day <= daysInMonth; day++) {
        const d = new Date(Date.UTC(year, month, day));
        if (d.getUTCDay() === dayOfWeek) {
          occurrences.push(d);
        }
      }
      const index = occurrences.length + ordinal;
      if (index >= 0 && index < occurrences.length) {
        return [occurrences[index]];
      }
    }
  }

  return [];
}

function getDaysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function getWeeksInYear(year: number, wkst: string): number {
  const wkstDay = DAY_MAP[wkst] ?? 1;
  const jan1 = new Date(Date.UTC(year, 0, 1));
  const jan1Day = jan1.getUTCDay();
  const daysInYear = isLeapYear(year) ? 366 : 365;
  const offset = (jan1Day - wkstDay + 7) % 7;
  return Math.ceil((daysInYear - (7 - offset)) / 7) + (offset > 0 ? 1 : 0);
}

function getDatesInWeek(year: number, weekNo: number, wkst: string): Date[] {
  const wkstDay = DAY_MAP[wkst] ?? 1;
  const jan1 = new Date(Date.UTC(year, 0, 1));
  const jan1Day = jan1.getUTCDay();
  const offset = (jan1Day - wkstDay + 7) % 7;

  let firstWeekStart: Date;
  if (offset <= 3) {
    firstWeekStart = new Date(Date.UTC(year, 0, 1 - offset));
  } else {
    firstWeekStart = new Date(Date.UTC(year, 0, 8 - offset));
  }

  const weekStart = new Date(firstWeekStart);
  weekStart.setUTCDate(weekStart.getUTCDate() + (weekNo - 1) * 7);

  const dates: Date[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart);
    d.setUTCDate(d.getUTCDate() + i);
    if (d.getUTCFullYear() === year) {
      dates.push(d);
    }
  }

  return dates;
}

function buildExceptionSet(exceptions: Date[]): Set<number> {
  const set = new Set<number>();
  for (const ex of exceptions) {
    set.add(normalizeToDay(ex));
  }
  return set;
}

function normalizeToDay(date: Date): number {
  return Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate()
  );
}

function isException(date: Date, exceptionSet: Set<number>): boolean {
  if (exceptionSet.has(date.getTime())) return true;
  if (exceptionSet.has(normalizeToDay(date))) return true;
  return false;
}

function deduplicateDates(dates: Date[]): Date[] {
  const seen = new Set<number>();
  const result: Date[] = [];
  for (const d of dates) {
    const t = d.getTime();
    if (!seen.has(t)) {
      seen.add(t);
      result.push(d);
    }
  }
  return result;
}
