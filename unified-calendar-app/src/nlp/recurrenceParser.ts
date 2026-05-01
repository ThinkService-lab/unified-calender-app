/**
 * Recurrence NL Parser.
 *
 * Converts natural-language recurrence expressions like
 *   "every weekday"
 *   "every 2 weeks"
 *   "every Tuesday and Thursday"
 *   "every first Monday of the month"
 *   "every last Friday"
 * into a structured {@link RecurrenceRule} following RFC 5545 semantics.
 *
 * Requirements: 17.1, 17.2, 17.3, 17.4, 17.5
 *
 * Design notes:
 * - Pure function. Safe to call on every keystroke in the Live Preview Panel.
 * - Returns null when no pattern matches. The NL Parser (Task 6.3)
 *   distinguishes "no recurrence keyword" (confidence.recurrence === 'none')
 *   from "keyword detected but unparseable" (confidence.recurrence ===
 *   'attempted_unresolved') at the call site — this module only reports
 *   "parsed vs not parsed".
 * - BYDAY ordinals are emitted without an explicit '+' sign (e.g. '1MO',
 *   '-1FR') so the output matches the design doc's examples. The
 *   expansion engine in src/recurrence/expandRecurrenceRule.ts accepts
 *   both signed and unsigned positives via `[+-]?\d+`.
 */

import type { RecurrenceRule } from '../types/models';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** RFC 5545 two-letter day codes in weekday order starting Sunday. */
const DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;

/** Lookup from lowercased weekday name → RFC 5545 code. */
const DAY_NAME_TO_CODE: Record<string, (typeof DAY_CODES)[number]> = {
  sunday: 'SU',
  monday: 'MO',
  tuesday: 'TU',
  wednesday: 'WE',
  thursday: 'TH',
  friday: 'FR',
  saturday: 'SA',
};

/** Lookup from lowercased ordinal word → numeric ordinal. */
const ORDINAL_WORD_TO_NUMBER: Record<string, number> = {
  first: 1,
  second: 2,
  third: 3,
  fourth: 4,
  fifth: 5,
  last: -1,
};

// Patterns built from the constants above, kept here so the regex strings
// remain readable.
const DAY_NAME_PATTERN = Object.keys(DAY_NAME_TO_CODE).join('|'); // sunday|monday|...
const ORDINAL_WORD_PATTERN = Object.keys(ORDINAL_WORD_TO_NUMBER).join('|');

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse a natural-language recurrence expression into a {@link RecurrenceRule}.
 *
 * Returns `null` when the input does not match any supported pattern.
 * The caller (the NL Parser in Task 6.3) treats a null return as the
 * "attempted but unresolved" signal when a recurrence keyword was
 * detected upstream.
 *
 * Patterns are tried most-specific first so that
 *   "every first Monday of the month"
 * matches the ordinal-monthly branch rather than the weekly-by-day branch.
 */
export function parseRecurrence(input: string): RecurrenceRule | null {
  const raw = (input ?? '').trim().toLowerCase();
  if (raw.length === 0) return null;

  // Normalise leading synonyms so the pattern branches only need to
  // handle the canonical phrasings. "each" is a direct synonym for
  // "every". "repeats" is a trigger word that typically precedes
  // another recurrence phrasing ("repeats daily", "repeats every
  // Monday", "repeats every 2 weeks"), so stripping it leaves the
  // downstream phrase to match as-is.
  let lower = raw
    .replace(/^each\b\s*/, 'every ')
    .replace(/^repeats\b\s*/, '');

  lower = lower.trim();
  if (lower.length === 0) return null;

  // Try parsers in order of specificity. The first non-null wins.
  return (
    parseOrdinalMonthly(lower) ??
    parseEveryWeekday(lower) ??
    parseEveryNamedDays(lower) ??
    parseEveryInterval(lower) ??
    parseEveryFrequency(lower) ??
    parseBareFrequency(lower) ??
    null
  );
}

// ---------------------------------------------------------------------------
// Pattern matchers
// ---------------------------------------------------------------------------

/**
 * "every first Monday of the month", "every last Friday", "every 2nd Tuesday".
 *
 * Produces FREQ=MONTHLY;BYDAY=<ordinal><day>.
 */
function parseOrdinalMonthly(lower: string): RecurrenceRule | null {
  // Accept either a word ordinal ("first", "last") or a numeric ordinal with
  // an optional suffix ("1st", "2nd", "3rd", "4th", "5"). Negative numeric
  // ordinals ("-1") are intentionally NOT accepted here; "last" is the
  // canonical way to express that.
  const ordinal = `(${ORDINAL_WORD_PATTERN}|\\d+(?:st|nd|rd|th)?)`;
  const day = `(${DAY_NAME_PATTERN})`;
  // The "of the month" suffix is optional so both phrasings work.
  const re = new RegExp(`^every\\s+${ordinal}\\s+${day}(?:\\s+of\\s+the\\s+month)?\\s*$`);

  const m = re.exec(lower);
  if (!m) return null;

  const ordinalValue = resolveOrdinal(m[1]);
  if (ordinalValue === null) return null;

  const dayCode = DAY_NAME_TO_CODE[m[2]];
  if (!dayCode) return null;

  // ordinalValue is already signed ('first' → 1, 'last' → -1) so
  // string-interpolating it produces the correct RFC 5545 spec
  // (e.g. '1MO' or '-1FR') without further massaging.
  return baseRule({
    frequency: 'monthly',
    interval: 1,
    byDay: [`${ordinalValue}${dayCode}`],
  });
}

/**
 * "every weekday" → FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR.
 */
function parseEveryWeekday(lower: string): RecurrenceRule | null {
  if (!/^every\s+weekday\s*$/.test(lower)) return null;
  return baseRule({
    frequency: 'weekly',
    interval: 1,
    byDay: ['MO', 'TU', 'WE', 'TH', 'FR'],
  });
}

/**
 * "every Monday", "every Tuesday and Thursday", "every Monday, Wednesday, and Friday".
 */
function parseEveryNamedDays(lower: string): RecurrenceRule | null {
  // Wrap the day-name alternation in a non-capturing group so the
  // trailing tail regex applies to the ALTERNATION as a whole. The
  // separator matches a comma, the word "and", or an Oxford "," + "and"
  // combined (plus surrounding whitespace).
  const dayAlt = `(?:${DAY_NAME_PATTERN})`;
  const separator = `(?:\\s*,\\s*(?:and\\s+)?|\\s+and\\s+)`;
  const re = new RegExp(`^every\\s+(${dayAlt}(?:${separator}${dayAlt})*)\\s*$`);
  const m = re.exec(lower);
  if (!m) return null;

  const codes = splitDayList(m[1]);
  if (codes.length === 0) return null;

  // Sort by weekday order so that
  //   "every Thursday and Tuesday"
  // round-trips to the same rule as
  //   "every Tuesday and Thursday".
  codes.sort((a, b) => DAY_CODES.indexOf(a) - DAY_CODES.indexOf(b));

  return baseRule({
    frequency: 'weekly',
    interval: 1,
    byDay: codes,
  });
}

/**
 * "every 2 days", "every 3 weeks", "every 4 months", "every 2 years".
 */
function parseEveryInterval(lower: string): RecurrenceRule | null {
  const m = /^every\s+(\d+)\s+(day|days|week|weeks|month|months|year|years)\s*$/.exec(lower);
  if (!m) return null;

  const interval = Number.parseInt(m[1], 10);
  if (!Number.isFinite(interval) || interval < 1) return null;

  const freq = singularFrequency(m[2]);
  if (!freq) return null;

  return baseRule({ frequency: freq, interval });
}

/**
 * "every day", "every week", "every month", "every year".
 */
function parseEveryFrequency(lower: string): RecurrenceRule | null {
  const m = /^every\s+(day|week|month|year)\s*$/.exec(lower);
  if (!m) return null;

  const freq = singularFrequency(m[1]);
  if (!freq) return null;

  return baseRule({ frequency: freq, interval: 1 });
}

/**
 * Bare frequency keywords: "daily", "weekly", "biweekly", "monthly",
 * "yearly", "annually". These are accepted so the NL Parser can detect
 * them as recurrence keywords upstream and still get a successful parse
 * down here.
 */
function parseBareFrequency(lower: string): RecurrenceRule | null {
  switch (lower) {
    case 'daily':
      return baseRule({ frequency: 'daily', interval: 1 });
    case 'weekly':
      return baseRule({ frequency: 'weekly', interval: 1 });
    case 'biweekly':
      return baseRule({ frequency: 'weekly', interval: 2 });
    case 'monthly':
      return baseRule({ frequency: 'monthly', interval: 1 });
    case 'yearly':
    case 'annually':
      return baseRule({ frequency: 'yearly', interval: 1 });
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a {@link RecurrenceRule} with the mandatory fields filled from
 * `overrides` and the optional RFC 5545 fields defaulted to their
 * "no constraint" values (null arrays and empty exception list). Keeping
 * this helper in one place means every emitted rule has the same shape
 * regardless of which pattern matched.
 */
function baseRule(
  overrides: Partial<RecurrenceRule> & Pick<RecurrenceRule, 'frequency' | 'interval'>,
): RecurrenceRule {
  return {
    frequency: overrides.frequency,
    interval: overrides.interval,
    count: overrides.count ?? null,
    until: overrides.until ?? null,
    bySecond: overrides.bySecond ?? null,
    byMinute: overrides.byMinute ?? null,
    byHour: overrides.byHour ?? null,
    byDay: overrides.byDay ?? null,
    byMonthDay: overrides.byMonthDay ?? null,
    byYearDay: overrides.byYearDay ?? null,
    byWeekNo: overrides.byWeekNo ?? null,
    byMonth: overrides.byMonth ?? null,
    bySetPos: overrides.bySetPos ?? null,
    // Monday is the RFC 5545 default when WKST is unspecified.
    wkst: overrides.wkst ?? 'MO',
    exceptions: overrides.exceptions ?? [],
  };
}

/**
 * Convert a singular-or-plural frequency word ("day", "weeks", etc.)
 * into the RecurrenceRule frequency literal. Returns null on unknown input.
 */
function singularFrequency(word: string): RecurrenceRule['frequency'] | null {
  switch (word) {
    case 'day':
    case 'days':
      return 'daily';
    case 'week':
    case 'weeks':
      return 'weekly';
    case 'month':
    case 'months':
      return 'monthly';
    case 'year':
    case 'years':
      return 'yearly';
    default:
      return null;
  }
}

/**
 * Resolve an ordinal token — either a word ("first", "last") or a
 * numeric form ("1", "1st", "2nd") — to a signed integer. Word forms
 * may be negative ("last" = -1); numeric forms are always positive.
 * Returns null on unknown input.
 */
function resolveOrdinal(token: string): number | null {
  const word = ORDINAL_WORD_TO_NUMBER[token];
  if (typeof word === 'number') return word;

  const numericMatch = /^(\d+)(?:st|nd|rd|th)?$/.exec(token);
  if (!numericMatch) return null;

  const n = Number.parseInt(numericMatch[1], 10);
  if (!Number.isFinite(n) || n < 1) return null;
  return n;
}

/**
 * Split a day-list chunk like "Monday, Wednesday and Friday" into
 * the RFC 5545 codes ['MO','WE','FR']. Accepts mixed commas,
 * "and", and Oxford commas. Unknown names are dropped silently
 * (the caller will typically have matched the names already, so
 * dropping is defensive only).
 */
function splitDayList(chunk: string): Array<(typeof DAY_CODES)[number]> {
  // Replace " and " and "&" with commas so the split does all the work.
  const normalised = chunk
    .replace(/\s*,?\s+and\s+/g, ',')
    .replace(/\s*&\s*/g, ',');

  const codes: Array<(typeof DAY_CODES)[number]> = [];
  const seen = new Set<string>();

  for (const part of normalised.split(',')) {
    const name = part.trim();
    if (name.length === 0) continue;
    const code = DAY_NAME_TO_CODE[name];
    if (code && !seen.has(code)) {
      codes.push(code);
      seen.add(code);
    }
  }

  return codes;
}
