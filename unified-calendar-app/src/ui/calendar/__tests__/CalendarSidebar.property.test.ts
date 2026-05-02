/**
 * Property-based tests for CalendarSidebar upcoming events logic.
 * Feature: unified-calendar-app, Property 17: Upcoming events list is sorted and limited
 *
 * **Validates: Requirements 19.6**
 */

import fc from 'fast-check';
import { getUpcomingEvents } from '../calendarSidebarUtils';
import type { CalendarEvent } from '../../../types/models';

// --- Custom Arbitraries ---

/**
 * Build a CalendarEvent arbitrary with random startTime/endTime.
 * The startTime is drawn from a wide range around "now" so that some events
 * fall before now (past) and some after (upcoming).
 */
function arbCalendarEvent(): fc.Arbitrary<CalendarEvent> {
  // Range: 2024-01-01 to 2026-01-01 in ms
  const minMs = new Date('2024-01-01T00:00:00Z').getTime();
  const maxMs = new Date('2026-01-01T00:00:00Z').getTime();

  return fc
    .record({
      id: fc.uuid(),
      startMs: fc.integer({ min: minMs, max: maxMs }),
      durationMs: fc.integer({ min: 60_000, max: 8 * 3_600_000 }), // 1 min – 8 hours
      title: fc.string({ minLength: 1, maxLength: 50 }),
      calendarAccountId: fc.uuid(),
      isAllDay: fc.boolean(),
    })
    .map(({ id, startMs, durationMs, title, calendarAccountId, isAllDay }) => ({
      id,
      providerEventId: `provider-${id}`,
      calendarAccountId,
      title,
      description: null,
      location: null,
      startTime: new Date(startMs),
      endTime: new Date(startMs + durationMs),
      timeZone: 'UTC',
      isAllDay,
      recurrenceRule: null,
      recurrenceExceptionDate: null,
      parentRecurringEventId: null,
      organizer: null,
      attendees: [],
      sequence: 0,
      dtstamp: new Date('2025-01-01T00:00:00Z'),
      status: 'confirmed' as const,
      visibility: null,
      opaqueFields: new Map<string, string>(),
      syncStatus: 'synced' as const,
      localVersion: 1,
      remoteEtag: null,
      modifiedBy: null,
      createdAt: new Date('2025-01-01T00:00:00Z'),
      updatedAt: new Date('2025-01-01T00:00:00Z'),
    }));
}

// Feature: unified-calendar-app, Property 17: Upcoming events list is sorted and limited
describe('Property 17: Upcoming events list is sorted and limited', () => {
  it('returns ≤10 events, all with startTime ≥ now, sorted by startTime ascending', () => {
    // Use a fixed "now" so the property is deterministic across runs
    const now = new Date('2025-06-01T12:00:00Z');

    fc.assert(
      fc.property(
        fc.array(arbCalendarEvent(), { minLength: 0, maxLength: 100 }),
        (events) => {
          const result = getUpcomingEvents(events, now);

          // 1. At most 10 events
          expect(result.length).toBeLessThanOrEqual(10);

          // 2. All events have startTime >= now
          for (const event of result) {
            expect(event.startTime.getTime()).toBeGreaterThanOrEqual(now.getTime());
          }

          // 3. Sorted by startTime ascending
          for (let i = 1; i < result.length; i++) {
            expect(result[i].startTime.getTime()).toBeGreaterThanOrEqual(
              result[i - 1].startTime.getTime(),
            );
          }

          // 4. Result length equals min(eligible count, 10)
          const eligibleCount = events.filter(
            (e) => e.startTime.getTime() >= now.getTime(),
          ).length;
          expect(result.length).toBe(Math.min(eligibleCount, 10));
        },
      ),
      { numRuns: 100 },
    );
  });
});
