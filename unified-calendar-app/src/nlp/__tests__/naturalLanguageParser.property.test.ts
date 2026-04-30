/**
 * Property-based tests for NL Parser and Printer.
 * Requirements: 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.10
 */

import * as fc from 'fast-check';
import { parseNaturalLanguage } from '../naturalLanguageParser';
import type { ParsedEvent } from '../naturalLanguageParser';
import { printEvent } from '../naturalLanguagePrinter';

// Fixed reference date for deterministic tests: Wednesday, January 15, 2025
const REF_DATE = new Date(2025, 0, 15, 12, 0, 0);

// ---------------------------------------------------------------------------
// Custom Arbitraries
// ---------------------------------------------------------------------------

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

/** Generate a simple title (alphabetic words, no structural keywords) */
function arbTitle(): fc.Arbitrary<string> {
  // Avoid words that are structural keywords for the parser
  const KEYWORDS = new Set([
    'at', 'for', 'with', 'on', 'in', 'tomorrow', 'today', 'next',
    'every', 'each', 'daily', 'weekly', 'biweekly', 'monthly', 'yearly',
    'annually', 'repeats', 'noon', 'midnight', 'morning', 'afternoon',
    'evening', 'night', 'am', 'pm',
    'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
    'january', 'february', 'march', 'april', 'may', 'june',
    'july', 'august', 'september', 'october', 'november', 'december',
    'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept',
    'oct', 'nov', 'dec',
  ]);

  return fc.array(
    fc.stringMatching(/^[A-Z][a-z]{2,8}$/).filter(
      (w) => !KEYWORDS.has(w.toLowerCase()),
    ),
    { minLength: 1, maxLength: 3 },
  ).map((words) => words.join(' '));
}

/** Generate a valid date in the canonical "Month Day" format */
function arbDateComponent(): fc.Arbitrary<{ text: string; month: number; day: number }> {
  return fc.integer({ min: 0, max: 11 }).chain((month) => {
    // Days valid for each month (simplified — use 28 for Feb)
    const maxDay = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month];
    return fc.integer({ min: 1, max: maxDay }).map((day) => ({
      text: `${MONTH_NAMES[month]} ${day}`,
      month,
      day,
    }));
  });
}

/** Generate a time in canonical "H:MMam/pm" format */
function arbTimeComponent(): fc.Arbitrary<{ text: string; hours: number; minutes: number }> {
  return fc.record({
    hours: fc.integer({ min: 0, max: 23 }),
    minutes: fc.integer({ min: 0, max: 59 }),
  }).map(({ hours, minutes }) => {
    const h24 = ((hours % 24) + 24) % 24;
    const meridiem = h24 >= 12 ? 'pm' : 'am';
    let h12 = h24 % 12;
    if (h12 === 0) h12 = 12;
    const minuteStr = minutes > 0 ? `:${String(minutes).padStart(2, '0')}` : '';
    return {
      text: `${h12}${minuteStr}${meridiem}`,
      hours: h24,
      minutes,
    };
  });
}

/** Generate a duration in canonical format */
function arbDurationComponent(): fc.Arbitrary<{ text: string; minutes: number }> {
  return fc.oneof(
    // Whole hours: "N hour(s)"
    fc.integer({ min: 1, max: 8 }).map((h) => ({
      text: `${h} ${h === 1 ? 'hour' : 'hours'}`,
      minutes: h * 60,
    })),
    // Minutes (non-multiples of 60): "N minutes"
    fc.integer({ min: 15, max: 120 }).filter((m) => m % 60 !== 0).map((m) => ({
      text: `${m} ${m === 1 ? 'minute' : 'minutes'}`,
      minutes: m,
    })),
  );
}

/** Generate a simple location name (no structural keywords) */
function arbLocation(): fc.Arbitrary<string> {
  return fc.stringMatching(/^[A-Z][a-z]{2,8}( [A-Z][a-z]{2,8})?$/).filter(
    (loc) => {
      const lower = loc.toLowerCase();
      return !['at', 'for', 'with', 'on', 'in', 'tomorrow', 'today', 'next'].some(
        (kw) => lower.split(' ').includes(kw),
      );
    },
  );
}

/** Generate a simple attendee name (no structural keywords) */
function arbAttendee(): fc.Arbitrary<string> {
  return fc.stringMatching(/^[A-Z][a-z]{2,8}$/).filter(
    (name) => {
      const lower = name.toLowerCase();
      return !['at', 'for', 'with', 'on', 'in', 'tomorrow', 'today', 'next',
        'noon', 'midnight', 'morning', 'afternoon', 'evening', 'night',
        'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
      ].includes(lower);
    },
  );
}

// Feature: unified-calendar-app, Property 7: NL Parser extracts fields from valid natural language input
describe('Property 7: NL Parser extracts fields from valid natural language input', () => {
  it('extracts all fields from canonical format input', () => {
    fc.assert(
      fc.property(
        arbTitle(),
        arbDateComponent(),
        arbTimeComponent(),
        arbDurationComponent(),
        arbLocation(),
        arbAttendee(),
        (title, dateComp, timeComp, durationComp, location, attendee) => {
          // Build input in canonical format:
          // "<title> on <Month Day> at <H:MMam/pm> for <N> hour(s) at <location> with <attendee>"
          const input = `${title} on ${dateComp.text} at ${timeComp.text} for ${durationComp.text} at ${location} with ${attendee}`;

          const result = parseNaturalLanguage(input, REF_DATE);

          // Title should be extracted (may have minor whitespace differences)
          expect(result.title.length).toBeGreaterThan(0);
          expect(result.title).toContain(title.split(' ')[0]);

          // Date should match
          expect(result.confidence.date).toBe(true);
          expect(result.date).not.toBeNull();
          expect(result.date!.getMonth()).toBe(dateComp.month);
          expect(result.date!.getDate()).toBe(dateComp.day);

          // Time should match
          expect(result.confidence.time).toBe(true);
          expect(result.time).not.toBeNull();
          expect(result.time!.hours).toBe(timeComp.hours);
          expect(result.time!.minutes).toBe(timeComp.minutes);

          // Duration should match
          expect(result.confidence.duration).toBe(true);
          expect(result.duration).toBe(durationComp.minutes);

          // Location should be extracted
          expect(result.confidence.location).toBe(true);
          expect(result.location).not.toBeNull();
          expect(result.location!.trim()).toBe(location);

          // Attendee should be extracted
          expect(result.attendees).toContain(attendee);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// Feature: unified-calendar-app, Property 8: NL Parser/Printer round-trip
describe('Property 8: NL Parser/Printer round-trip', () => {
  /**
   * Generate a random ParsedEvent with all confidence flags true.
   * Uses the printer's canonical format to ensure round-trip fidelity.
   */
  function arbParsedEvent(): fc.Arbitrary<ParsedEvent> {
    return fc.record({
      title: arbTitle(),
      dateComp: arbDateComponent(),
      timeComp: arbTimeComponent(),
      durationComp: arbDurationComponent(),
      location: arbLocation(),
      attendee: arbAttendee(),
    }).map(({ title, dateComp, timeComp, durationComp, location, attendee }) => {
      const date = new Date(REF_DATE.getFullYear(), dateComp.month, dateComp.day);
      return {
        title,
        date,
        time: { hours: timeComp.hours, minutes: timeComp.minutes },
        duration: durationComp.minutes,
        location,
        attendees: [attendee],
        recurrence: null,
        confidence: {
          date: true,
          time: true,
          duration: true,
          location: true,
          recurrence: 'none' as const,
        },
      };
    });
  }

  it('parseNaturalLanguage(printEvent(event)) produces an equivalent event', () => {
    fc.assert(
      fc.property(arbParsedEvent(), (event) => {
        const printed = printEvent(event);
        const reparsed = parseNaturalLanguage(printed, REF_DATE);

        // Title: should match
        expect(reparsed.title).toBe(event.title);

        // Date: same calendar day
        expect(reparsed.date).not.toBeNull();
        expect(reparsed.date!.getMonth()).toBe(event.date!.getMonth());
        expect(reparsed.date!.getDate()).toBe(event.date!.getDate());

        // Time: same hours and minutes
        expect(reparsed.time).not.toBeNull();
        expect(reparsed.time!.hours).toBe(event.time!.hours);
        expect(reparsed.time!.minutes).toBe(event.time!.minutes);

        // Duration: same value
        expect(reparsed.duration).toBe(event.duration);

        // Location: same value
        expect(reparsed.location).toBe(event.location);

        // Attendees: same set
        expect(reparsed.attendees.sort()).toEqual(event.attendees.sort());
      }),
      { numRuns: 100 },
    );
  });
});
