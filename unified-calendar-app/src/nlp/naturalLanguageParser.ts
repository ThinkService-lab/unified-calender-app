/**
 * Natural Language Parser for the Quick Create Bar.
 *
 * Parses free-text event descriptions like
 *   "Lunch with Sarah tomorrow at noon for 1 hour at Cafe Roma"
 * into a structured {@link ParsedEvent}.
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 17.8
 *
 * Design notes:
 * - Pure function: no side effects, no I/O. Safe to call on every keystroke.
 * - `confidence.recurrence` is a three-state value (see {@link RecurrenceParseState}).
 *   Task 5 leaves recurrence detection unimplemented — Task 6 will integrate
 *   the recurrence parser and switch this value to 'parsed' /
 *   'attempted_unresolved' when appropriate.
 */

import type { RecurrenceRule } from '../types/models';
import { parseRecurrence } from './recurrenceParser';

/**
 * Three-state recurrence parsing outcome (Req 17.8).
 *
 * - `'none'`: No recurrence keyword detected. `recurrence` is null.
 * - `'parsed'`: Keyword detected AND frequency resolved. `recurrence` is non-null.
 * - `'attempted_unresolved'`: Keyword detected (e.g. "every", "each", "weekly",
 *   "monthly", "repeats") BUT frequency could not be determined. The Quick
 *   Create Bar uses this to trigger the EventEditor fallback with the
 *   recurrence section highlighted.
 */
export type RecurrenceParseState = 'none' | 'parsed' | 'attempted_unresolved';

export interface ParsedEvent {
  title: string;
  date: Date | null;
  time: { hours: number; minutes: number } | null;
  /** Event duration in minutes. Defaults to 60 when not specified. */
  duration: number;
  location: string | null;
  attendees: string[];
  recurrence: RecurrenceRule | null;
  /** Whether each field was successfully extracted (vs defaulted). */
  confidence: {
    date: boolean;
    time: boolean;
    duration: boolean;
    location: boolean;
    /**
     * Three-state recurrence outcome. Replaces a plain boolean so
     * "no recurrence attempted" can be distinguished from
     * "attempted but frequency unresolved".
     */
    recurrence: RecurrenceParseState;
  };
}

// ---------------------------------------------------------------------------
// Internal constants
// ---------------------------------------------------------------------------

const DEFAULT_DURATION_MINUTES = 60;

const DAY_NAMES = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const;

const MONTH_NAMES = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
] as const;

const MONTH_ABBREVIATIONS: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  sept: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

/** Maps colloquial time-of-day words to a fixed hour. */
const COLLOQUIAL_TIMES: Record<string, { hours: number; minutes: number }> = {
  noon: { hours: 12, minutes: 0 },
  midnight: { hours: 0, minutes: 0 },
  morning: { hours: 9, minutes: 0 },
  afternoon: { hours: 14, minutes: 0 },
  evening: { hours: 18, minutes: 0 },
  night: { hours: 20, minutes: 0 },
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse a natural-language event description into a {@link ParsedEvent}.
 *
 * Pure function — only inputs are the raw text and an optional reference date
 * (used to resolve relative expressions like "tomorrow" or "next Monday").
 * Defaults to `new Date()` when no reference date is given, which is the
 * only impurity in the call site; callers that need determinism should
 * pass an explicit reference date.
 */
export function parseNaturalLanguage(
  input: string,
  referenceDate: Date = new Date(),
): ParsedEvent {
  const raw = input ?? '';
  const trimmed = raw.trim();

  // Work on a mutable lowercased copy so we can "consume" matched phrases
  // by replacing them with spaces. The original-case version is retained
  // for extracting capitalised fragments (titles, locations, names).
  let lower = trimmed.toLowerCase();
  let original = trimmed;

  // The parsing order matters:
  //   1. Recurrence phrase (extracted first so its internal weekday name
  //      doesn't fool the date extractor into reading "every Tuesday" as
  //      "this upcoming Tuesday")
  //   2. Attendees ("with X [and Y]") — stable phrase boundary
  //   3. Duration ("for N ...")
  //   4. Time (must come before location so the trailing "at X" goes to location)
  //   5. Date
  //   6. Location ("at X")
  //   7. Remaining tokens → title

  // ---- Recurrence ----------------------------------------------------------
  const recurrenceResult = extractRecurrence(lower, original);
  const recurrence = recurrenceResult.rule;
  const recurrenceState = recurrenceResult.state;
  lower = recurrenceResult.lowerRemainder;
  original = recurrenceResult.originalRemainder;

  // ---- Attendees -----------------------------------------------------------
  const attendeeResult = extractAttendees(lower, original);
  const attendees = attendeeResult.names;
  lower = attendeeResult.lowerRemainder;
  original = attendeeResult.originalRemainder;

  // ---- Duration ------------------------------------------------------------
  const durationResult = extractDuration(lower, original);
  const duration = durationResult.minutes ?? DEFAULT_DURATION_MINUTES;
  const durationConfidence = durationResult.minutes !== null;
  lower = durationResult.lowerRemainder;
  original = durationResult.originalRemainder;

  // ---- Time ----------------------------------------------------------------
  const timeResult = extractTime(lower, original);
  const time = timeResult.time;
  const timeConfidence = time !== null;
  lower = timeResult.lowerRemainder;
  original = timeResult.originalRemainder;

  // ---- Date ----------------------------------------------------------------
  const dateResult = extractDate(lower, original, referenceDate);
  const date = dateResult.date;
  const dateConfidence = date !== null;
  lower = dateResult.lowerRemainder;
  original = dateResult.originalRemainder;

  // ---- Location (must be after time) --------------------------------------
  const locationResult = extractLocation(lower, original);
  const location = locationResult.location;
  const locationConfidence = location !== null;
  lower = locationResult.lowerRemainder;
  original = locationResult.originalRemainder;

  // ---- Title (leftovers) ---------------------------------------------------
  const title = normaliseWhitespace(original);

  return {
    title,
    date,
    time,
    duration,
    location,
    attendees,
    recurrence,
    confidence: {
      date: dateConfidence,
      time: timeConfidence,
      duration: durationConfidence,
      location: locationConfidence,
      recurrence: recurrenceState,
    },
  };
}

// ---------------------------------------------------------------------------
// Extraction helpers
// ---------------------------------------------------------------------------

interface ExtractionResult {
  lowerRemainder: string;
  originalRemainder: string;
}

/**
 * Remove characters at the given range from both the lowercase and original
 * strings, replacing them with a single space so subsequent parsing still
 * sees word boundaries.
 */
function excise(
  lower: string,
  original: string,
  start: number,
  end: number,
): { lowerRemainder: string; originalRemainder: string } {
  return {
    lowerRemainder: lower.slice(0, start) + ' ' + lower.slice(end),
    originalRemainder: original.slice(0, start) + ' ' + original.slice(end),
  };
}

function normaliseWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

// --- Recurrence extraction --------------------------------------------------

interface RecurrenceResult extends ExtractionResult {
  rule: RecurrenceRule | null;
  state: RecurrenceParseState;
}

/**
 * Recurrence keywords that can start a recurrence phrase. Order matters
 * only for the regex: all alternatives are anchored at word boundaries,
 * so longer words still match correctly.
 */
const RECURRENCE_KEYWORDS = [
  'every',
  'each',
  'weekly',
  'biweekly',
  'monthly',
  'yearly',
  'annually',
  'daily',
  'repeats',
];

/**
 * Find a recurrence phrase in the input, delegate to
 * {@link parseRecurrence} for structural parsing, and excise the span
 * so downstream extractors (date, location, title) do not see its
 * internal tokens.
 *
 * Three outcomes, mirroring {@link RecurrenceParseState}:
 *   - no keyword found → state='none', rule=null, text untouched
 *   - keyword found + parse succeeds → state='parsed', rule=<parsed>,
 *     phrase span excised
 *   - keyword found + parse fails → state='attempted_unresolved', rule=null,
 *     keyword alone excised (so the title doesn't end up with the
 *     keyword in it, but unrelated trailing text is preserved)
 *
 * Strategy — "maximal munch" phrase finder:
 *
 *   1. Find the first recurrence keyword in the input.
 *   2. Walk forward word-by-word from the keyword. For each prefix
 *      starting at the keyword, try `parseRecurrence(prefix)`. Keep
 *      the LONGEST prefix that parses successfully.
 *   3. If any prefix parsed, excise that exact span and return the
 *      parsed rule.
 *   4. If no prefix parsed, excise only the keyword itself and return
 *      state='attempted_unresolved'. This prevents the keyword from
 *      leaking into the title while preserving unrelated title words.
 *
 * This approach means "Daily standup at 9am" finds keyword="daily",
 * tries ["daily"] → parses ✓, tries ["daily","standup"] → fails, stops
 * at the single word. So "daily" alone is excised, leaving
 * "standup at 9am" for downstream extractors. The title becomes
 * "standup" and the time becomes 9am — both correct.
 */
function extractRecurrence(lower: string, original: string): RecurrenceResult {
  const keywordPattern = RECURRENCE_KEYWORDS.join('|');
  const keywordRe = new RegExp(`\\b(${keywordPattern})\\b`);
  const keywordMatch = keywordRe.exec(lower);

  if (!keywordMatch) {
    return { rule: null, state: 'none', lowerRemainder: lower, originalRemainder: original };
  }

  const phraseStart = keywordMatch.index;

  // Enumerate word boundaries AFTER the keyword so we can try prefixes
  // of increasing length. Each candidate end index is the position of a
  // whitespace-separated word boundary; we cap at a reasonable window
  // to avoid pathological scans on very long inputs.
  const MAX_PHRASE_WORDS = 8;
  const tail = lower.slice(phraseStart);

  // Build candidate end positions. Start with the end of the keyword
  // itself (shortest candidate = just the keyword), then extend through
  // up to MAX_PHRASE_WORDS additional words.
  const candidateEnds: number[] = [];
  const wordRe = /\s+\S+/g;
  // Position index in `tail` where the keyword ends.
  const keywordEndInTail = keywordMatch[0].length;
  candidateEnds.push(keywordEndInTail);
  let walked = 0;
  wordRe.lastIndex = keywordEndInTail;
  let m: RegExpExecArray | null;
  while ((m = wordRe.exec(tail)) !== null && walked < MAX_PHRASE_WORDS) {
    candidateEnds.push(m.index + m[0].length);
    walked++;
  }

  // Try candidates longest-first. The first one that parses wins.
  let bestEnd: number | null = null;
  let bestRule: RecurrenceRule | null = null;
  for (let i = candidateEnds.length - 1; i >= 0; i--) {
    const end = candidateEnds[i];
    const candidate = tail.slice(0, end).trim();
    const parsed = parseRecurrence(candidate);
    if (parsed) {
      bestEnd = end;
      bestRule = parsed;
      break;
    }
  }

  if (bestRule !== null && bestEnd !== null) {
    const phraseEnd = phraseStart + bestEnd;
    const { lowerRemainder, originalRemainder } = excise(lower, original, phraseStart, phraseEnd);
    return { rule: bestRule, state: 'parsed', lowerRemainder, originalRemainder };
  }

  // Nothing parsed. Excise only the keyword itself so it doesn't
  // pollute the title, and report the unresolved state.
  const keywordEnd = phraseStart + keywordMatch[0].length;
  const { lowerRemainder, originalRemainder } = excise(lower, original, phraseStart, keywordEnd);
  return {
    rule: null,
    state: 'attempted_unresolved',
    lowerRemainder,
    originalRemainder,
  };
}

// --- Attendee extraction ----------------------------------------------------

interface AttendeeResult extends ExtractionResult {
  names: string[];
}

/**
 * Extract attendee names from "with <Name>[ and <Name>[ and ...]]" phrases.
 *
 * Supports:
 *   "with Sarah"
 *   "with Sarah and Tom"
 *   "with Sarah, Tom, and Alice"
 *   "with Sarah, Tom and Alice"
 */
function extractAttendees(lower: string, original: string): AttendeeResult {
  const names: string[] = [];

  // `with <chunk>` — the chunk continues until the next structural keyword
  // (at/for/on/tomorrow/today/next/every/in) or end of string.
  // This regex is intentionally permissive: we grab the chunk and then
  // split it into names ourselves.
  const BOUNDARY = /\b(?:at|for|on|in|tomorrow|today|next|every|each|daily|weekly|biweekly|monthly|yearly|annually|repeats)\b|$/;

  const withRe = /\bwith\s+/g;
  let match: RegExpExecArray | null;
  const ranges: Array<{ start: number; end: number }> = [];

  while ((match = withRe.exec(lower)) !== null) {
    const phraseStart = match.index;
    const afterWith = phraseStart + match[0].length;

    // Find the boundary after `with ` in the substring.
    const searchArea = lower.slice(afterWith);
    const boundaryMatch = searchArea.match(BOUNDARY);
    const boundaryOffset = boundaryMatch ? boundaryMatch.index ?? searchArea.length : searchArea.length;

    const chunkEnd = afterWith + boundaryOffset;
    const chunk = original.slice(afterWith, chunkEnd);

    const parsedNames = splitAttendeeChunk(chunk);
    if (parsedNames.length > 0) {
      names.push(...parsedNames);
      ranges.push({ start: phraseStart, end: chunkEnd });
    }
  }

  // Excise in reverse order so earlier indices stay valid.
  let lowerRemainder = lower;
  let originalRemainder = original;
  for (const r of ranges.reverse()) {
    const sliced = excise(lowerRemainder, originalRemainder, r.start, r.end);
    lowerRemainder = sliced.lowerRemainder;
    originalRemainder = sliced.originalRemainder;
  }

  return { names, lowerRemainder, originalRemainder };
}

/**
 * Split a trimmed attendee chunk like "Sarah, Tom, and Alice" into
 * ["Sarah", "Tom", "Alice"].
 *
 * Handles commas, Oxford commas, and "and" separators.
 */
function splitAttendeeChunk(chunk: string): string[] {
  const trimmed = chunk.trim();
  if (trimmed.length === 0) return [];

  // Normalise " and " → "," then split on commas.
  const normalised = trimmed
    .replace(/,?\s+and\s+/gi, ',')
    .replace(/\s*&\s*/g, ',');

  return normalised
    .split(',')
    .map((n) => n.trim())
    .filter((n) => n.length > 0);
}

// --- Duration extraction ----------------------------------------------------

interface DurationResult extends ExtractionResult {
  /** Duration in minutes, or null when not specified. */
  minutes: number | null;
}

/**
 * Extract duration expressions like:
 *   "for 30 minutes", "for 1 hour", "for 2 hours", "for 1.5 hours",
 *   "for 90 mins", "for 45 min".
 */
function extractDuration(lower: string, original: string): DurationResult {
  // Accept integer or decimal values. The leading `\b` after "for" captures
  // cases like "for 1.5 hours".
  const re = /\bfor\s+(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m)\b/;
  const match = re.exec(lower);
  if (!match) {
    return { minutes: null, lowerRemainder: lower, originalRemainder: original };
  }

  const value = Number.parseFloat(match[1]);
  const unit = match[2];
  const isHours = /^(hours?|hrs?|h)$/.test(unit);

  const minutes = isHours ? Math.round(value * 60) : Math.round(value);
  const start = match.index;
  const end = start + match[0].length;
  const { lowerRemainder, originalRemainder } = excise(lower, original, start, end);

  return { minutes, lowerRemainder, originalRemainder };
}

// --- Time extraction --------------------------------------------------------

interface TimeResult extends ExtractionResult {
  time: { hours: number; minutes: number } | null;
}

/**
 * Extract a time expression. Supports:
 *   "at noon" / "at midnight" / "at 3pm" / "at 3:30pm" / "at 15:00"
 *   bare "noon"/"midnight"/"morning"/"afternoon"/"evening"
 *
 * Strategy:
 *   1. Look for a leading "at " followed by a recognised time (and excise
 *      the "at" too so it does not look like a location prefix).
 *   2. Otherwise look for a bare colloquial word anywhere in the string.
 */
function extractTime(lower: string, original: string): TimeResult {
  // 1. "at <time>" — numeric or colloquial.
  //    The numeric pattern must come first so "at 3pm" beats "at noon"
  //    when both somehow appear (it won't in practice).
  const numericAt = /\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?\b/;
  {
    const m = numericAt.exec(lower);
    if (m) {
      const parsed = parseNumericTime(m[1], m[2], m[3]);
      if (parsed) {
        const start = m.index;
        const end = start + m[0].length;
        const { lowerRemainder, originalRemainder } = excise(lower, original, start, end);
        return { time: parsed, lowerRemainder, originalRemainder };
      }
    }
  }

  // 2. "at <colloquial>" — e.g. "at noon".
  {
    const words = Object.keys(COLLOQUIAL_TIMES).join('|');
    const re = new RegExp(`\\bat\\s+(${words})\\b`);
    const m = re.exec(lower);
    if (m) {
      const time = COLLOQUIAL_TIMES[m[1]];
      const start = m.index;
      const end = start + m[0].length;
      const { lowerRemainder, originalRemainder } = excise(lower, original, start, end);
      return { time, lowerRemainder, originalRemainder };
    }
  }

  // 3. Bare numeric time like "3pm" (no "at" prefix). Only accept when the
  //    am/pm suffix is present to avoid swallowing dates or durations.
  {
    const re = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)\b/;
    const m = re.exec(lower);
    if (m) {
      const parsed = parseNumericTime(m[1], m[2], m[3]);
      if (parsed) {
        const start = m.index;
        const end = start + m[0].length;
        const { lowerRemainder, originalRemainder } = excise(lower, original, start, end);
        return { time: parsed, lowerRemainder, originalRemainder };
      }
    }
  }

  // 4. Bare colloquial words.
  {
    const words = Object.keys(COLLOQUIAL_TIMES).join('|');
    const re = new RegExp(`\\b(${words})\\b`);
    const m = re.exec(lower);
    if (m) {
      const time = COLLOQUIAL_TIMES[m[1]];
      const start = m.index;
      const end = start + m[0].length;
      const { lowerRemainder, originalRemainder } = excise(lower, original, start, end);
      return { time, lowerRemainder, originalRemainder };
    }
  }

  return { time: null, lowerRemainder: lower, originalRemainder: original };
}

function parseNumericTime(
  hourStr: string,
  minStr: string | undefined,
  meridiem: string | undefined,
): { hours: number; minutes: number } | null {
  let hours = Number.parseInt(hourStr, 10);
  const minutes = minStr ? Number.parseInt(minStr, 10) : 0;

  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  if (minutes < 0 || minutes > 59) return null;

  if (meridiem) {
    const isPm = /p/.test(meridiem);
    if (hours < 1 || hours > 12) return null;
    if (isPm && hours !== 12) hours += 12;
    if (!isPm && hours === 12) hours = 0;
  } else {
    // 24-hour clock
    if (hours < 0 || hours > 23) return null;
  }

  return { hours, minutes };
}

// --- Date extraction --------------------------------------------------------

interface DateResult extends ExtractionResult {
  date: Date | null;
}

/**
 * Extract a date reference. Supports:
 *   "today", "tomorrow"
 *   "next Monday" .. "next Sunday"
 *   "January 15", "Jan 15", "January 15 2026", "Jan 15, 2026"
 *   "in 3 days"
 *   bare weekday names ("Monday") — interpreted as the upcoming occurrence.
 */
function extractDate(
  lower: string,
  original: string,
  referenceDate: Date,
): DateResult {
  const refStart = startOfDay(referenceDate);

  // All date patterns allow an optional leading "on " so the printer's
  // canonical format ("on January 15", "on Monday") round-trips cleanly.
  const ON_PREFIX = '(?:\\bon\\s+)?';

  // "today"
  {
    const re = new RegExp(`${ON_PREFIX}\\btoday\\b`);
    const m = re.exec(lower);
    if (m) {
      const { lowerRemainder, originalRemainder } = excise(
        lower,
        original,
        m.index,
        m.index + m[0].length,
      );
      return { date: refStart, lowerRemainder, originalRemainder };
    }
  }

  // "tomorrow"
  {
    const re = new RegExp(`${ON_PREFIX}\\btomorrow\\b`);
    const m = re.exec(lower);
    if (m) {
      const date = addDays(refStart, 1);
      const { lowerRemainder, originalRemainder } = excise(
        lower,
        original,
        m.index,
        m.index + m[0].length,
      );
      return { date, lowerRemainder, originalRemainder };
    }
  }

  // "in N days"
  {
    const m = /\bin\s+(\d+)\s+days?\b/.exec(lower);
    if (m) {
      const n = Number.parseInt(m[1], 10);
      if (Number.isFinite(n)) {
        const date = addDays(refStart, n);
        const { lowerRemainder, originalRemainder } = excise(
          lower,
          original,
          m.index,
          m.index + m[0].length,
        );
        return { date, lowerRemainder, originalRemainder };
      }
    }
  }

  // "next <weekday>"
  {
    const dayPattern = DAY_NAMES.join('|');
    const re = new RegExp(`${ON_PREFIX}\\bnext\\s+(${dayPattern})\\b`);
    const m = re.exec(lower);
    if (m) {
      const targetDay = DAY_NAMES.indexOf(m[1] as (typeof DAY_NAMES)[number]);
      const date = nextOccurrenceOfWeekday(refStart, targetDay);
      const { lowerRemainder, originalRemainder } = excise(
        lower,
        original,
        m.index,
        m.index + m[0].length,
      );
      return { date, lowerRemainder, originalRemainder };
    }
  }

  // "<Month> <day>[, <year>]" — full month name or 3-letter abbreviation,
  // optionally preceded by "on ".
  {
    const monthPattern = [
      ...MONTH_NAMES,
      ...Object.keys(MONTH_ABBREVIATIONS),
    ].join('|');
    const re = new RegExp(
      `${ON_PREFIX}\\b(${monthPattern})\\s+(\\d{1,2})(?:(?:st|nd|rd|th))?(?:\\s*,?\\s*(\\d{4}))?\\b`,
    );
    const m = re.exec(lower);
    if (m) {
      const monthIndex = resolveMonth(m[1]);
      const day = Number.parseInt(m[2], 10);
      const year = m[3] ? Number.parseInt(m[3], 10) : referenceDate.getFullYear();
      if (monthIndex !== null && isValidDayOfMonth(year, monthIndex, day)) {
        const date = new Date(year, monthIndex, day);
        const { lowerRemainder, originalRemainder } = excise(
          lower,
          original,
          m.index,
          m.index + m[0].length,
        );
        return { date, lowerRemainder, originalRemainder };
      }
    }
  }

  // Bare weekday — "Monday" etc. Interpreted as the next occurrence
  // strictly after today (matches common UI expectation). Only match
  // when preceded by whitespace / "on " / start-of-string to avoid
  // catching it inside other words.
  {
    const dayPattern = DAY_NAMES.join('|');
    const re = new RegExp(`${ON_PREFIX}\\b(${dayPattern})\\b`);
    const m = re.exec(lower);
    if (m) {
      const targetDay = DAY_NAMES.indexOf(m[1] as (typeof DAY_NAMES)[number]);
      const date = nextOccurrenceOfWeekday(refStart, targetDay);
      const { lowerRemainder, originalRemainder } = excise(
        lower,
        original,
        m.index,
        m.index + m[0].length,
      );
      return { date, lowerRemainder, originalRemainder };
    }
  }

  return { date: null, lowerRemainder: lower, originalRemainder: original };
}

function resolveMonth(name: string): number | null {
  const lower = name.toLowerCase();
  const full = MONTH_NAMES.indexOf(lower as (typeof MONTH_NAMES)[number]);
  if (full !== -1) return full;
  const abbr = MONTH_ABBREVIATIONS[lower];
  return typeof abbr === 'number' ? abbr : null;
}

function isValidDayOfMonth(year: number, monthIndex: number, day: number): boolean {
  if (day < 1 || day > 31) return false;
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  return day <= lastDay;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(d: Date, n: number): Date {
  const result = new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  return result;
}

/**
 * Return the next occurrence of the given weekday STRICTLY AFTER `from`.
 * If `from` itself is that weekday, the returned date is 7 days later.
 */
function nextOccurrenceOfWeekday(from: Date, targetDay: number): Date {
  const currentDay = from.getDay();
  let diff = targetDay - currentDay;
  if (diff <= 0) diff += 7;
  return addDays(from, diff);
}

// --- Location extraction ----------------------------------------------------

interface LocationResult extends ExtractionResult {
  location: string | null;
}

/**
 * Extract the location from a trailing "at <place>" phrase.
 *
 * This is called AFTER time extraction, so any "at <time>" phrase has
 * already been consumed and only location-style "at" phrases remain.
 */
function extractLocation(lower: string, original: string): LocationResult {
  // Take the first "at " that is still present — treat everything until
  // the next structural keyword (or end of string) as the location.
  const re = /\bat\s+/;
  const m = re.exec(lower);
  if (!m) {
    return { location: null, lowerRemainder: lower, originalRemainder: original };
  }

  const afterAt = m.index + m[0].length;
  const BOUNDARY = /\b(?:for|with|on|tomorrow|today|next|every|each|daily|weekly|biweekly|monthly|yearly|annually|repeats|in)\b/;
  const searchArea = lower.slice(afterAt);
  const boundaryMatch = searchArea.match(BOUNDARY);
  const boundaryOffset = boundaryMatch ? boundaryMatch.index ?? searchArea.length : searchArea.length;

  const chunkEnd = afterAt + boundaryOffset;
  const location = original.slice(afterAt, chunkEnd).trim();

  if (location.length === 0) {
    return { location: null, lowerRemainder: lower, originalRemainder: original };
  }

  const { lowerRemainder, originalRemainder } = excise(
    lower,
    original,
    m.index,
    chunkEnd,
  );

  return { location, lowerRemainder, originalRemainder };
}
