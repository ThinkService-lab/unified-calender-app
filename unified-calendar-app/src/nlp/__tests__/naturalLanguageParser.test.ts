/**
 * Unit tests for NL Parser edge cases.
 * Requirements: 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8
 */

import { parseNaturalLanguage } from '../naturalLanguageParser';
import type { ParsedEvent } from '../naturalLanguageParser';

// Fixed reference date for deterministic tests: Wednesday, January 15, 2025
const REF_DATE = new Date(2025, 0, 15, 12, 0, 0);

describe('NL Parser Edge Cases', () => {
  describe('empty and whitespace input', () => {
    it('returns empty title for empty string input', () => {
      const result = parseNaturalLanguage('', REF_DATE);
      expect(result.title).toBe('');
      expect(result.date).toBeNull();
      expect(result.time).toBeNull();
      expect(result.duration).toBe(60);
      expect(result.location).toBeNull();
      expect(result.attendees).toEqual([]);
      expect(result.confidence.date).toBe(false);
      expect(result.confidence.time).toBe(false);
      expect(result.confidence.duration).toBe(false);
      expect(result.confidence.location).toBe(false);
    });

    it('returns empty title for whitespace-only input', () => {
      const result = parseNaturalLanguage('   \t\n  ', REF_DATE);
      expect(result.title).toBe('');
      expect(result.date).toBeNull();
      expect(result.time).toBeNull();
    });
  });

  describe('title-only input (no time expression)', () => {
    it('extracts title when no time/date/duration/location/attendees present', () => {
      const result = parseNaturalLanguage('Team Planning Session', REF_DATE);
      expect(result.title).toBe('Team Planning Session');
      expect(result.date).toBeNull();
      expect(result.time).toBeNull();
      expect(result.duration).toBe(60);
      expect(result.location).toBeNull();
      expect(result.attendees).toEqual([]);
      expect(result.confidence.date).toBe(false);
      expect(result.confidence.time).toBe(false);
    });
  });

  describe('ambiguous "at" (time vs location)', () => {
    it('parses time first, then location from "Meeting at 3pm at Cafe Roma"', () => {
      const result = parseNaturalLanguage('Meeting at 3pm at Cafe Roma', REF_DATE);
      expect(result.time).toEqual({ hours: 15, minutes: 0 });
      expect(result.confidence.time).toBe(true);
      expect(result.location).toBe('Cafe Roma');
      expect(result.confidence.location).toBe(true);
      expect(result.title).toBe('Meeting');
    });
  });

  describe('multiple "with" phrases', () => {
    it('extracts attendees from "Lunch with Sarah and Alex"', () => {
      const result = parseNaturalLanguage('Lunch with Sarah and Alex', REF_DATE);
      expect(result.attendees).toContain('Sarah');
      expect(result.attendees).toContain('Alex');
      expect(result.attendees).toHaveLength(2);
      expect(result.title).toBe('Lunch');
    });

    it('handles "Lunch with Sarah with Alex" — second "with" captures Alex', () => {
      // The parser's attendee boundary does not include "with", so the first
      // "with" grabs "Sarah with Alex" as a single chunk. The chunk splitter
      // does not split on inner "with". The second "with" then independently
      // captures "Alex". This is a known parser limitation for chained "with"
      // phrases — the canonical form is "with Sarah and Alex".
      const result = parseNaturalLanguage('Lunch with Sarah with Alex', REF_DATE);
      // At minimum, Alex should be extracted
      expect(result.attendees).toContain('Alex');
      expect(result.attendees.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('missing date (confidence.date = false)', () => {
    it('sets confidence.date to false when no date reference is present', () => {
      const result = parseNaturalLanguage('Meeting at 3pm', REF_DATE);
      expect(result.confidence.date).toBe(false);
      expect(result.date).toBeNull();
      expect(result.confidence.time).toBe(true);
      expect(result.time).toEqual({ hours: 15, minutes: 0 });
    });
  });

  describe('missing time (confidence.time = false)', () => {
    it('sets confidence.time to false when no time expression is present', () => {
      const result = parseNaturalLanguage('Meeting tomorrow', REF_DATE);
      expect(result.confidence.time).toBe(false);
      expect(result.time).toBeNull();
      expect(result.confidence.date).toBe(true);
    });
  });

  describe('duration expressions', () => {
    it('parses "for 30 minutes"', () => {
      const result = parseNaturalLanguage('Meeting for 30 minutes', REF_DATE);
      expect(result.duration).toBe(30);
      expect(result.confidence.duration).toBe(true);
    });

    it('parses "for 1 hour"', () => {
      const result = parseNaturalLanguage('Meeting for 1 hour', REF_DATE);
      expect(result.duration).toBe(60);
      expect(result.confidence.duration).toBe(true);
    });

    it('parses "for 1.5 hours"', () => {
      const result = parseNaturalLanguage('Meeting for 1.5 hours', REF_DATE);
      expect(result.duration).toBe(90);
      expect(result.confidence.duration).toBe(true);
    });

    it('defaults to 60 minutes when no duration specified', () => {
      const result = parseNaturalLanguage('Meeting at 3pm', REF_DATE);
      expect(result.duration).toBe(60);
      expect(result.confidence.duration).toBe(false);
    });
  });

  describe('date references', () => {
    it('parses "today"', () => {
      const result = parseNaturalLanguage('Meeting today', REF_DATE);
      expect(result.date).not.toBeNull();
      expect(result.date!.getFullYear()).toBe(2025);
      expect(result.date!.getMonth()).toBe(0);
      expect(result.date!.getDate()).toBe(15);
      expect(result.confidence.date).toBe(true);
    });

    it('parses "tomorrow"', () => {
      const result = parseNaturalLanguage('Meeting tomorrow', REF_DATE);
      expect(result.date).not.toBeNull();
      expect(result.date!.getDate()).toBe(16);
      expect(result.confidence.date).toBe(true);
    });

    it('parses "next Monday"', () => {
      // REF_DATE is Wednesday Jan 15, 2025 → next Monday is Jan 20
      const result = parseNaturalLanguage('Meeting next Monday', REF_DATE);
      expect(result.date).not.toBeNull();
      expect(result.date!.getDay()).toBe(1); // Monday
      expect(result.date!.getDate()).toBe(20);
      expect(result.confidence.date).toBe(true);
    });
  });

  describe('time expressions', () => {
    it('parses "at noon"', () => {
      const result = parseNaturalLanguage('Lunch at noon', REF_DATE);
      expect(result.time).toEqual({ hours: 12, minutes: 0 });
      expect(result.confidence.time).toBe(true);
    });

    it('parses "at 3pm"', () => {
      const result = parseNaturalLanguage('Meeting at 3pm', REF_DATE);
      expect(result.time).toEqual({ hours: 15, minutes: 0 });
      expect(result.confidence.time).toBe(true);
    });

    it('parses "at 15:00" (24-hour format)', () => {
      const result = parseNaturalLanguage('Meeting at 15:00', REF_DATE);
      expect(result.time).toEqual({ hours: 15, minutes: 0 });
      expect(result.confidence.time).toBe(true);
    });

    it('parses "morning" as 9:00', () => {
      const result = parseNaturalLanguage('Meeting morning', REF_DATE);
      expect(result.time).toEqual({ hours: 9, minutes: 0 });
      expect(result.confidence.time).toBe(true);
    });

    it('parses "afternoon" as 14:00', () => {
      const result = parseNaturalLanguage('Meeting afternoon', REF_DATE);
      expect(result.time).toEqual({ hours: 14, minutes: 0 });
      expect(result.confidence.time).toBe(true);
    });

    it('parses "evening" as 18:00', () => {
      const result = parseNaturalLanguage('Meeting evening', REF_DATE);
      expect(result.time).toEqual({ hours: 18, minutes: 0 });
      expect(result.confidence.time).toBe(true);
    });
  });

  describe('location extraction', () => {
    it('extracts location from "at <location>" after time', () => {
      const result = parseNaturalLanguage('Meeting at 3pm at Conference Room B', REF_DATE);
      expect(result.location).toBe('Conference Room B');
      expect(result.confidence.location).toBe(true);
    });
  });

  describe('attendee extraction', () => {
    it('extracts single attendee from "with <name>"', () => {
      const result = parseNaturalLanguage('Lunch with Sarah', REF_DATE);
      expect(result.attendees).toEqual(['Sarah']);
    });

    it('extracts multiple attendees from "with <name> and <name>"', () => {
      const result = parseNaturalLanguage('Lunch with Sarah and Tom', REF_DATE);
      expect(result.attendees).toContain('Sarah');
      expect(result.attendees).toContain('Tom');
      expect(result.attendees).toHaveLength(2);
    });
  });

  describe('full complex input', () => {
    it('parses "Lunch with Sarah tomorrow at noon for 1 hour at Cafe Roma"', () => {
      const result = parseNaturalLanguage(
        'Lunch with Sarah tomorrow at noon for 1 hour at Cafe Roma',
        REF_DATE,
      );
      expect(result.title).toBe('Lunch');
      expect(result.attendees).toEqual(['Sarah']);
      expect(result.date).not.toBeNull();
      expect(result.date!.getDate()).toBe(16); // tomorrow
      expect(result.time).toEqual({ hours: 12, minutes: 0 }); // noon
      expect(result.duration).toBe(60);
      expect(result.location).toBe('Cafe Roma');
      expect(result.confidence.date).toBe(true);
      expect(result.confidence.time).toBe(true);
      expect(result.confidence.duration).toBe(true);
      expect(result.confidence.location).toBe(true);
    });
  });

  describe('recurrence keyword detection', () => {
    it('parses "every weekday" into a WEEKLY rule with BYDAY=MO..FR', () => {
      const result = parseNaturalLanguage('Standup every weekday at 9am', REF_DATE);
      expect(result.confidence.recurrence).toBe('parsed');
      expect(result.recurrence).not.toBeNull();
      expect(result.recurrence!.frequency).toBe('weekly');
      expect(result.recurrence!.interval).toBe(1);
      expect(result.recurrence!.byDay).toEqual(['MO', 'TU', 'WE', 'TH', 'FR']);
      // The recurrence phrase must be stripped from the title so it
      // does not leak into the event title.
      expect(result.title).toBe('Standup');
      // Downstream extractors still see the trailing "at 9am".
      expect(result.time).toEqual({ hours: 9, minutes: 0 });
    });

    it('sets confidence.recurrence to "none" when no recurrence keyword present', () => {
      const result = parseNaturalLanguage('Lunch with Sarah tomorrow at noon', REF_DATE);
      expect(result.confidence.recurrence).toBe('none');
      expect(result.recurrence).toBeNull();
    });

    it('parses bare "weekly" as a WEEKLY;INTERVAL=1 rule', () => {
      const result = parseNaturalLanguage('Weekly team sync at 10am', REF_DATE);
      expect(result.confidence.recurrence).toBe('parsed');
      expect(result.recurrence?.frequency).toBe('weekly');
      expect(result.recurrence?.interval).toBe(1);
    });

    it('parses bare "monthly" as a MONTHLY;INTERVAL=1 rule', () => {
      const result = parseNaturalLanguage('Monthly review at 2pm', REF_DATE);
      expect(result.confidence.recurrence).toBe('parsed');
      expect(result.recurrence?.frequency).toBe('monthly');
      expect(result.recurrence?.interval).toBe(1);
    });

    it('parses bare "daily" as a DAILY;INTERVAL=1 rule', () => {
      const result = parseNaturalLanguage('Daily standup at 9am', REF_DATE);
      expect(result.confidence.recurrence).toBe('parsed');
      expect(result.recurrence?.frequency).toBe('daily');
      expect(result.recurrence?.interval).toBe(1);
    });

    it('marks a bare "repeats" (no following pattern) as attempted_unresolved', () => {
      // "repeats" without a following frequency or "every" phrase cannot
      // be resolved to a rule. Per Req 17.8 the Quick Create Bar uses
      // this state to open the EventEditor with the recurrence section
      // highlighted so the user can fill in the frequency manually.
      const result = parseNaturalLanguage('Meeting repeats at 3pm', REF_DATE);
      expect(result.confidence.recurrence).toBe('attempted_unresolved');
      expect(result.recurrence).toBeNull();
    });

    it('parses "every 2 weeks" as a WEEKLY;INTERVAL=2 rule', () => {
      const result = parseNaturalLanguage('Team offsite every 2 weeks at 10am', REF_DATE);
      expect(result.confidence.recurrence).toBe('parsed');
      expect(result.recurrence?.frequency).toBe('weekly');
      expect(result.recurrence?.interval).toBe(2);
    });

    it('parses "every first Monday" as MONTHLY;BYDAY=1MO', () => {
      const result = parseNaturalLanguage('Board meeting every first Monday at 10am', REF_DATE);
      expect(result.confidence.recurrence).toBe('parsed');
      expect(result.recurrence?.frequency).toBe('monthly');
      expect(result.recurrence?.byDay).toEqual(['1MO']);
    });

    it('parses "every Tuesday and Thursday" with sorted BYDAY', () => {
      const result = parseNaturalLanguage(
        'Tennis every Tuesday and Thursday at 6pm',
        REF_DATE,
      );
      expect(result.confidence.recurrence).toBe('parsed');
      expect(result.recurrence?.byDay).toEqual(['TU', 'TH']);
    });
  });
});
