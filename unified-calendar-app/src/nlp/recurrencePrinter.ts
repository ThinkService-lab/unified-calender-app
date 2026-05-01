/**
 * Recurrence NL Printer.
 *
 * Converts a structured {@link RecurrenceRule} back into a human-readable
 * natural-language expression. Pairs with {@link ./recurrenceParser | parseRecurrence}
 * to provide a round-trip guarantee:
 *
 *   parseRecurrence(printRecurrence(rule))  ≅  rule
 *
 * for all rules that the parser is capable of producing.
 *
 * Requirements: 17.6, 17.7
 *
 * Design notes:
 * - Output format matches the phrasings accepted by `parseRecurrence`
 *   exactly, so the round-trip closes cleanly. In particular, day lists
 *   use Oxford-comma-free joining ("Tuesday and Thursday"), and BYDAY
 *   entries are sorted into weekday order (SU..SA) before printing.
 * - Rules that the parser cannot produce (e.g. mixed BYMONTHDAY with
 *   BYMONTH constraints, or BYHOUR/BYMINUTE specifications) fall back
 *   to the bare-frequency phrasing ("monthly", "weekly", ...). This is
 *   a lossy print, but it keeps the function total and the round-trip
 *   property well-defined: the printer only promises closure for the
 *   rule space its paired parser can emit.
 */

import type { RecurrenceRule } from '../types/models';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * RFC 5545 day codes in weekday order. Used both to sort BYDAY entries
 * and to resolve codes back to their full names.
 */
const DAY_ORDER = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;

const DAY_CODE_TO_NAME: Record<(typeof DAY_ORDER)[number], string> = {
  SU: 'Sunday',
  MO: 'Monday',
  TU: 'Tuesday',
  WE: 'Wednesday',
  TH: 'Thursday',
  FR: 'Friday',
  SA: 'Saturday',
};

/** Numeric ordinals spelled out for ordinal-monthly printing. */
const ORDINAL_WORDS: Record<number, string> = {
  1: 'first',
  2: 'second',
  3: 'third',
  4: 'fourth',
  5: 'fifth',
};

const WEEKDAY_SET: ReadonlySet<string> = new Set(['MO', 'TU', 'WE', 'TH', 'FR']);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Convert a {@link RecurrenceRule} into a human-readable natural-language
 * string (e.g. "every weekday", "every 2 weeks", "every first Monday").
 *
 * The emitted phrasing is always one the parser accepts, so
 *
 *   parseRecurrence(printRecurrence(rule))
 *
 * produces an equivalent rule for any rule the parser can produce.
 */
export function printRecurrence(rule: RecurrenceRule): string {
  // Ordinal-monthly (e.g. "every first Monday") takes precedence —
  // it only applies when frequency is monthly, interval is 1, and
  // BYDAY carries exactly one ordinalised entry.
  const ordinalPhrase = printOrdinalMonthly(rule);
  if (ordinalPhrase) return ordinalPhrase;

  // Weekday shorthand ("every weekday") when frequency is weekly with
  // BYDAY = MO,TU,WE,TH,FR and interval 1.
  if (isEveryWeekday(rule)) {
    return 'every weekday';
  }

  // Named-days weekly ("every Monday", "every Tuesday and Thursday").
  const namedDaysPhrase = printEveryNamedDays(rule);
  if (namedDaysPhrase) return namedDaysPhrase;

  // Interval-based ("every 2 weeks") when interval > 1 and no other
  // constraints are active.
  if (isPlainFrequency(rule) && rule.interval > 1) {
    return `every ${rule.interval} ${pluralUnit(rule.frequency, rule.interval)}`;
  }

  // Bare "every day|week|month|year" when interval is 1.
  if (isPlainFrequency(rule) && rule.interval === 1) {
    return `every ${singularUnit(rule.frequency)}`;
  }

  // Fallback: any rule shape the parser cannot directly reproduce still
  // gets a best-effort frequency label rather than throwing. This keeps
  // the printer total; callers that need tighter round-trip guarantees
  // should validate the rule up-front.
  return bareFrequencyFallback(rule);
}

// ---------------------------------------------------------------------------
// Printers
// ---------------------------------------------------------------------------

/**
 * Emit "every first Monday" / "every last Friday" when the rule is a
 * monthly ordinal-BYDAY pattern with a single entry.
 */
function printOrdinalMonthly(rule: RecurrenceRule): string | null {
  if (rule.frequency !== 'monthly') return null;
  if (rule.interval !== 1) return null;
  if (!rule.byDay || rule.byDay.length !== 1) return null;

  const parsed = parseByDayEntry(rule.byDay[0]);
  if (!parsed || parsed.ordinal === null) return null;

  const word = ordinalToWord(parsed.ordinal);
  if (!word) return null;

  const dayName = DAY_CODE_TO_NAME[parsed.code];
  // Omit the "of the month" suffix — the parser accepts both phrasings,
  // and the shorter form round-trips just as cleanly while being more
  // natural to read.
  return `every ${word} ${dayName}`;
}

/**
 * Emit "every Monday", "every Tuesday and Thursday", or
 * "every Monday, Wednesday, and Friday" for a weekly frequency with
 * a non-ordinal BYDAY list.
 */
function printEveryNamedDays(rule: RecurrenceRule): string | null {
  if (rule.frequency !== 'weekly') return null;
  if (rule.interval !== 1) return null;
  if (!rule.byDay || rule.byDay.length === 0) return null;

  // Reject any ordinal entries — they are not valid in a named-days
  // weekly pattern; fall back to the bare frequency phrasing instead.
  const codes: Array<(typeof DAY_ORDER)[number]> = [];
  for (const entry of rule.byDay) {
    const parsed = parseByDayEntry(entry);
    if (!parsed || parsed.ordinal !== null) return null;
    codes.push(parsed.code);
  }

  // Sort into weekday order so outputs are deterministic regardless of
  // the input order.
  codes.sort((a, b) => DAY_ORDER.indexOf(a) - DAY_ORDER.indexOf(b));

  // The exact MO,TU,WE,TH,FR combination is handled by the weekday
  // shorthand branch above; if we somehow reach here with that set it
  // is still correct to render as a named list.
  const names = codes.map((c) => DAY_CODE_TO_NAME[c]);
  return `every ${joinNames(names)}`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * True when the rule is a plain FREQ rule — no BYxxx constraints, no
 * COUNT, no UNTIL, no exceptions. These are the rules the bare-frequency
 * and interval-based parsers emit.
 */
function isPlainFrequency(rule: RecurrenceRule): boolean {
  return (
    rule.byDay === null &&
    rule.byMonthDay === null &&
    rule.byMonth === null &&
    rule.byYearDay === null &&
    rule.byWeekNo === null &&
    rule.byHour === null &&
    rule.byMinute === null &&
    rule.bySecond === null &&
    rule.bySetPos === null &&
    rule.count === null &&
    rule.until === null &&
    rule.exceptions.length === 0
  );
}

/**
 * True when the rule is exactly the "every weekday" shorthand — weekly
 * frequency, interval 1, BYDAY = MO..FR.
 */
function isEveryWeekday(rule: RecurrenceRule): boolean {
  if (rule.frequency !== 'weekly') return false;
  if (rule.interval !== 1) return false;
  if (!rule.byDay || rule.byDay.length !== 5) return false;

  const set = new Set(rule.byDay);
  for (const d of WEEKDAY_SET) {
    if (!set.has(d)) return false;
  }
  return true;
}

/**
 * Parse a BYDAY entry like "MO", "1MO", "+1MO", or "-1FR" into a
 * `{ ordinal, code }` pair. Returns null if the entry is malformed.
 */
function parseByDayEntry(
  entry: string,
): { ordinal: number | null; code: (typeof DAY_ORDER)[number] } | null {
  const match = /^([+-]?\d+)?(SU|MO|TU|WE|TH|FR|SA)$/.exec(entry);
  if (!match) return null;

  const code = match[2] as (typeof DAY_ORDER)[number];
  const ordinal = match[1] ? Number.parseInt(match[1], 10) : null;
  // Reject NaN defensively — parseInt("+foo") returns NaN.
  if (ordinal !== null && !Number.isFinite(ordinal)) return null;
  return { ordinal, code };
}

/**
 * Map a numeric ordinal (positive 1..5 or negative -1) to the word form
 * the parser expects ("first", "second", ..., "last"). Returns null for
 * values the parser does not recognise so the caller can fall back.
 */
function ordinalToWord(n: number): string | null {
  if (n === -1) return 'last';
  return ORDINAL_WORDS[n] ?? null;
}

/** "day" | "week" | "month" | "year" for interval=1. */
function singularUnit(freq: RecurrenceRule['frequency']): string {
  switch (freq) {
    case 'daily':
      return 'day';
    case 'weekly':
      return 'week';
    case 'monthly':
      return 'month';
    case 'yearly':
      return 'year';
  }
}

/** "days" | "weeks" | "months" | "years" for interval > 1. */
function pluralUnit(freq: RecurrenceRule['frequency'], interval: number): string {
  const base = singularUnit(freq);
  return interval === 1 ? base : `${base}s`;
}

/**
 * Join a list of names using sentence-case conjunction:
 *   ["Monday"] → "Monday"
 *   ["Monday","Wednesday"] → "Monday and Wednesday"
 *   ["Monday","Wednesday","Friday"] → "Monday, Wednesday, and Friday"
 */
function joinNames(names: string[]): string {
  if (names.length === 0) return '';
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  const head = names.slice(0, -1).join(', ');
  const tail = names[names.length - 1];
  return `${head}, and ${tail}`;
}

/**
 * Last-resort phrasing used when the rule does not fit any pattern the
 * parser can reproduce. We degrade to a bare frequency word so the
 * output is still valid English and the caller can always show
 * something — even if a subsequent `parseRecurrence` will lose the
 * BYxxx details.
 */
function bareFrequencyFallback(rule: RecurrenceRule): string {
  switch (rule.frequency) {
    case 'daily':
      return 'daily';
    case 'weekly':
      return 'weekly';
    case 'monthly':
      return 'monthly';
    case 'yearly':
      return 'yearly';
  }
}
