/**
 * Property-based tests for ConflictDetector service.
 * Requirements: 7.1, 7.3, 7.4, 7.6
 */

import fc from 'fast-check';
import { createConflictDetector, ConflictDetector } from '../conflictDetector';
import type { CalendarEvent } from '../../types';

// --- Custom Arbitraries ---

/** Generate a CalendarEvent with specified start/end times */
function arbEventWithTimes(
  id: string,
  start: Date,
  end: Date,
  location?: string,
): CalendarEvent {
  return {
    id,
    providerEventId: `provider-${id}`,
    calendarAccountId: 'cal-1',
    title: `Event ${id}`,
    description: null,
    location: location ?? null,
    startTime: start,
    endTime: end,
    timeZone: 'UTC',
    isAllDay: false,
    recurrenceRule: null,
    recurrenceExceptionDate: null,
    parentRecurringEventId: null,
    organizer: null,
    attendees: [],
    sequence: 0,
    dtstamp: new Date('2025-01-01T00:00:00Z'),
    status: 'confirmed',
    visibility: null,
    opaqueFields: new Map(),
    syncStatus: 'synced',
    localVersion: 1,
    remoteEtag: null,
    modifiedBy: null,
    createdAt: new Date('2025-01-01T00:00:00Z'),
    updatedAt: new Date('2025-01-01T00:00:00Z'),
  };
}

/**
 * Generate a pair of events with random time ranges.
 * Each event has start < end (duration between 1 minute and 8 hours).
 */
function arbEventPair(): fc.Arbitrary<{ eventA: CalendarEvent; eventB: CalendarEvent }> {
  return fc.record({
    startA: fc.integer({ min: 1704067200000, max: 1735600000000 }),
    durationA: fc.integer({ min: 60000, max: 8 * 3600000 }),
    startB: fc.integer({ min: 1704067200000, max: 1735600000000 }),
    durationB: fc.integer({ min: 60000, max: 8 * 3600000 }),
  }).map(({ startA, durationA, startB, durationB }) => ({
    eventA: arbEventWithTimes('a', new Date(startA), new Date(startA + durationA)),
    eventB: arbEventWithTimes('b', new Date(startB), new Date(startB + durationB)),
  }));
}

/** Generate a CalendarEvent with a random time range */
function arbCalendarEvent(id: string): fc.Arbitrary<CalendarEvent> {
  return fc.record({
    start: fc.integer({ min: 1704067200000, max: 1735600000000 }),
    duration: fc.integer({ min: 60000, max: 8 * 3600000 }),
  }).map(({ start, duration }) =>
    arbEventWithTimes(id, new Date(start), new Date(start + duration)),
  );
}

describe('ConflictDetector Property Tests', () => {
  let detector: ConflictDetector;

  beforeEach(() => {
    detector = createConflictDetector();
  });

  afterEach(() => {
    detector.stopContinuousScanning();
  });

  // Feature: unified-calendar-app, Property 7: Conflict detection correctness
  // **Validates: Requirements 7.1**
  describe('Property 7: Conflict detection correctness', () => {
    it('reports overlap iff startA < endB AND startB < endA', () => {
      fc.assert(
        fc.property(arbEventPair(), ({ eventA, eventB }) => {
          const conflicts = detector.detectConflicts(eventA, [eventA, eventB]);

          const startA = eventA.startTime.getTime();
          const endA = eventA.endTime.getTime();
          const startB = eventB.startTime.getTime();
          const endB = eventB.endTime.getTime();

          const shouldOverlap = startA < endB && startB < endA;

          if (shouldOverlap) {
            expect(conflicts).toHaveLength(1);
            expect(conflicts[0].eventA.id).toBe('a');
            expect(conflicts[0].eventB.id).toBe('b');
            expect(conflicts[0].overlapMinutes).toBeGreaterThan(0);
          } else {
            expect(conflicts).toHaveLength(0);
          }
        }),
        { numRuns: 100 },
      );
    });
  });

  // Feature: unified-calendar-app, Property 8: Alternative slot suggestions are conflict-free
  // **Validates: Requirements 7.3**
  describe('Property 8: Alternative slot suggestions are conflict-free', () => {
    it('every suggested slot has zero overlap with existing events', () => {
      fc.assert(
        fc.property(
          arbCalendarEvent('target'),
          fc.array(arbCalendarEvent('existing'), { minLength: 0, maxLength: 10 }).map(
            (events) => events.map((e, i) => ({ ...e, id: `existing-${i}` })),
          ),
          fc.integer({ min: 1, max: 5 }),
          (targetEvent, existingEvents, count) => {
            const allEvents = [...existingEvents, targetEvent];
            const suggestions = detector.suggestAlternatives(targetEvent, allEvents, count);

            for (const slot of suggestions) {
              for (const existing of existingEvents) {
                const overlaps =
                  slot.start.getTime() < existing.endTime.getTime() &&
                  existing.startTime.getTime() < slot.end.getTime();
                expect(overlaps).toBe(false);
              }
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  // Feature: unified-calendar-app, Property 9: Travel time conflict detection
  // **Validates: Requirements 7.4**
  // Design: "For any two consecutive events with different physical locations,
  // if the time gap between endA and startB is less than the estimated travel time,
  // the ConflictDetector SHALL report a travel-time conflict."
  describe('Property 9: Travel time conflict detection', () => {
    it('detectConflictsWithTravel reports travel-time conflict when gap < estimated travel time', () => {
      fc.assert(
        fc.asyncProperty(
          // Generate two non-overlapping consecutive events with different locations
          fc.integer({ min: 1704067200000, max: 1735500000000 }),
          fc.integer({ min: 60000, max: 4 * 3600000 }), // event A duration
          fc.integer({ min: 0, max: 3600000 }),           // gap (0 to 60 min)
          fc.integer({ min: 60000, max: 4 * 3600000 }), // event B duration
          fc.string({ minLength: 1, maxLength: 20 }),     // location A
          fc.string({ minLength: 1, maxLength: 20 }),     // location B
          async (startAMs, durationA, gapMs, durationB, locA, locB) => {
            const endAMs = startAMs + durationA;
            const startBMs = endAMs + gapMs;
            const endBMs = startBMs + durationB;

            const eventA = arbEventWithTimes('a', new Date(startAMs), new Date(endAMs), locA);
            const eventB = arbEventWithTimes('b', new Date(startBMs), new Date(endBMs), locB);

            const travelTimeMs = await detector.estimateTravelTime(locA, locB);

            // Skip if same location (travel time = 0, no travel conflict possible)
            if (travelTimeMs === 0) return;

            const conflicts = await detector.detectConflictsWithTravel(eventA, [eventB]);
            const travelConflicts = conflicts.filter((c) => c.travelTimeConflict);

            if (gapMs < travelTimeMs) {
              // Gap is insufficient for travel — must report travel conflict
              expect(travelConflicts).toHaveLength(1);
              expect(travelConflicts[0].travelTimeConflict).toBe(true);
              expect(travelConflicts[0].overlapMinutes).toBe(0);
            } else {
              // Sufficient gap — no travel conflict
              expect(travelConflicts).toHaveLength(0);
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  // Feature: unified-calendar-app, Property 28: Continuous conflict scanning detects new conflicts within 60 seconds
  // **Validates: Requirements 7.6**
  describe('Property 28: Continuous conflict scanning timing', () => {
    it('onConflictDetected fires within 60s of sync completing for overlapping events', () => {
      fc.assert(
        fc.property(arbEventPair(), ({ eventA, eventB }) => {
          const startA = eventA.startTime.getTime();
          const endA = eventA.endTime.getTime();
          const startB = eventB.startTime.getTime();
          const endB = eventB.endTime.getTime();

          const shouldOverlap = startA < endB && startB < endA;

          if (!shouldOverlap) {
            const detected: any[] = [];
            detector.onConflictDetected = (c) => detected.push(c);
            detector.startContinuousScanning([eventA, eventB]);
            detector.stopContinuousScanning();
            expect(detected).toHaveLength(0);
          } else {
            const detected: any[] = [];
            const startMs = Date.now();
            detector.onConflictDetected = (c) => detected.push(c);
            detector.startContinuousScanning([eventA, eventB]);
            detector.stopContinuousScanning();
            const elapsedMs = Date.now() - startMs;

            expect(detected.length).toBeGreaterThanOrEqual(1);
            expect(elapsedMs).toBeLessThan(60000);
          }
        }),
        { numRuns: 100 },
      );
    });
  });
});
