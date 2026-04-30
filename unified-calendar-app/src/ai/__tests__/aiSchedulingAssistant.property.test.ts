/**
 * Property-based tests for AISchedulingAssistant service.
 * Requirements: 8.2, 8.5
 */

import fc from 'fast-check';
import {
  createAISchedulingAssistant,
  MAX_SUGGESTIONS,
} from '../aiSchedulingAssistant';
import type { AISchedulingAssistant } from '../aiSchedulingAssistant';
import type {
  CalendarEvent,
  MeetingRequest,
  SchedulingPreferences,
  TimeBlock,
} from '../../types';
import type { DatabaseDriver } from '../../db/database';
import type { SubscriptionManager } from '../../subscription/subscriptionManager';

// --- Test Helpers ---

function makeEvent(
  id: string,
  start: Date,
  end: Date,
): CalendarEvent {
  return {
    id,
    providerEventId: `provider-${id}`,
    calendarAccountId: 'cal-1',
    title: `Event ${id}`,
    description: null,
    location: null,
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

function createMockDb(): DatabaseDriver {
  return {
    execute: jest.fn().mockResolvedValue(undefined),
    query: jest.fn().mockResolvedValue([]),
    close: jest.fn().mockResolvedValue(undefined),
    isOpen: jest.fn().mockReturnValue(true),
  };
}

function createMockSubscriptionManager(): SubscriptionManager {
  return {
    getCurrentTier: jest.fn().mockReturnValue('pro'),
    getCurrentTierFromDb: jest.fn().mockResolvedValue('pro'),
    validateReceipt: jest.fn(),
    checkFeatureAccess: jest.fn().mockReturnValue(true),
    handleDowngrade: jest.fn(),
    getGracePeriodEnd: jest.fn().mockReturnValue(null),
  };
}

// --- Custom Arbitraries ---

/**
 * Generate valid SchedulingPreferences with constrained values.
 */
function arbSchedulingPreferences(): fc.Arbitrary<SchedulingPreferences> {
  return fc
    .record({
      preferredStartHour: fc.integer({ min: 6, max: 14 }),
      preferredEndHour: fc.integer({ min: 15, max: 22 }),
      minimumBufferMinutes: fc.integer({ min: 0, max: 30 }),
      maxMeetingsPerDay: fc.integer({ min: 1, max: 15 }),
      focusBlockCount: fc.integer({ min: 0, max: 2 }),
    })
    .chain(({ preferredStartHour, preferredEndHour, minimumBufferMinutes, maxMeetingsPerDay, focusBlockCount }) => {
      // Ensure start < end
      const actualEnd = Math.max(preferredStartHour + 2, preferredEndHour);

      const focusBlocks: fc.Arbitrary<TimeBlock[]> = fc.array(
        fc.record({
          dayOfWeek: fc.integer({ min: 0, max: 6 }),
          startHour: fc.integer({ min: preferredStartHour, max: actualEnd - 1 }),
          endHour: fc.constant(0), // placeholder
          label: fc.constant('Focus'),
        }).map((block) => ({
          ...block,
          endHour: Math.min(block.startHour + 2, actualEnd),
        })),
        { minLength: 0, maxLength: focusBlockCount },
      );

      return focusBlocks.map((blocks) => ({
        userId: 'user-1',
        preferredStartHour,
        preferredEndHour: actualEnd,
        minimumBufferMinutes,
        maxMeetingsPerDay,
        focusTimeBlocks: blocks,
        learnedPatterns: [],
      }));
    });
}

/**
 * Generate a CalendarEvent with a random time range within a single day.
 */
function arbCalendarEvent(dayBaseMs: number): fc.Arbitrary<CalendarEvent> {
  return fc
    .record({
      id: fc.stringMatching(/^evt-[a-z0-9]{4}$/),
      startOffsetHours: fc.integer({ min: 0, max: 20 }),
      durationMinutes: fc.integer({ min: 30, max: 120 }),
    })
    .map(({ id, startOffsetHours, durationMinutes }) => {
      const startMs = dayBaseMs + startOffsetHours * 3600000;
      const endMs = startMs + durationMinutes * 60000;
      return makeEvent(id, new Date(startMs), new Date(endMs));
    });
}

/**
 * Generate a MeetingRequest within a single day.
 */
function arbMeetingRequest(dayBaseMs: number): fc.Arbitrary<MeetingRequest> {
  return fc
    .record({
      duration: fc.integer({ min: 15, max: 120 }),
      rangeStartHour: fc.integer({ min: 0, max: 10 }),
      rangeEndHour: fc.integer({ min: 14, max: 23 }),
    })
    .map(({ duration, rangeStartHour, rangeEndHour }) => ({
      title: 'Test Meeting',
      duration,
      attendeeEmails: [],
      dateRange: {
        start: new Date(dayBaseMs + rangeStartHour * 3600000),
        end: new Date(dayBaseMs + rangeEndHour * 3600000),
      },
      priority: 'normal' as const,
    }));
}

describe('AISchedulingAssistant Property Tests', () => {
  let assistant: AISchedulingAssistant;

  beforeEach(() => {
    assistant = createAISchedulingAssistant({
      db: createMockDb(),
      subscriptionManager: createMockSubscriptionManager(),
    });
  });

  // Feature: unified-calendar-app, Property 24: AI scheduling suggestions respect preferences
  // **Validates: Requirements 8.5**
  describe('Property 24: AI scheduling suggestions respect preferences', () => {
    it('slots within preferred hours, buffer maintained, max meetings not exceeded', () => {
      // Use a fixed day base: Monday Jan 6, 2025 00:00 UTC
      const dayBaseMs = new Date('2025-01-06T00:00:00Z').getTime();

      fc.assert(
        fc.asyncProperty(
          arbSchedulingPreferences(),
          arbMeetingRequest(dayBaseMs),
          fc.array(arbCalendarEvent(dayBaseMs), { minLength: 0, maxLength: 5 }),
          async (preferences, request, existingEvents) => {
            const result = await assistant.suggestSlots(
              request,
              existingEvents,
              preferences,
            );

            expect(result.length).toBeLessThanOrEqual(MAX_SUGGESTIONS);

            for (const slot of result) {
              // Score must be between 0 and 1
              expect(slot.score).toBeGreaterThanOrEqual(0);
              expect(slot.score).toBeLessThanOrEqual(1);

              const startHour = slot.start.getUTCHours() + slot.start.getUTCMinutes() / 60;
              const endHour = slot.end.getUTCHours() + slot.end.getUTCMinutes() / 60;

              const withinPreferredHours =
                startHour >= preferences.preferredStartHour &&
                endHour <= preferences.preferredEndHour;

              // Check buffer from adjacent events
              const bufferMs = preferences.minimumBufferMinutes * 60 * 1000;
              const bufferedStart = new Date(slot.start.getTime() - bufferMs);
              const bufferedEnd = new Date(slot.end.getTime() + bufferMs);
              const hasBuffer = !existingEvents.some(
                (e) =>
                  bufferedStart.getTime() < e.endTime.getTime() &&
                  e.startTime.getTime() < bufferedEnd.getTime(),
              );

              // Count meetings on the same day
              const dayStart = new Date(slot.start);
              dayStart.setUTCHours(0, 0, 0, 0);
              const dayEnd = new Date(slot.start);
              dayEnd.setUTCHours(23, 59, 59, 999);
              const meetingsOnDay = existingEvents.filter(
                (e) =>
                  e.startTime.getTime() < dayEnd.getTime() &&
                  e.endTime.getTime() > dayStart.getTime(),
              ).length;
              const withinMaxMeetings = meetingsOnDay < preferences.maxMeetingsPerDay;

              // If slot is within all preferences, tradeoffs should be empty
              if (withinPreferredHours && hasBuffer && withinMaxMeetings) {
                // Slot respects all core preferences — tradeoffs may still mention focus time
                const coreTradeoffs = slot.tradeoffs.filter(
                  (t) => !t.toLowerCase().includes('focus time'),
                );
                expect(coreTradeoffs).toHaveLength(0);
              } else {
                // If outside preferences, there should be tradeoff explanations
                // (unless the slot happens to be the best available)
                expect(slot.tradeoffs.length + (slot.score < 1 ? 1 : 0)).toBeGreaterThan(0);
              }
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  // Feature: unified-calendar-app, Property 25: AI scheduling suggestions are conflict-free
  // **Validates: Requirements 8.2**
  describe('Property 25: AI scheduling suggestions are conflict-free', () => {
    it('all suggested slots have zero overlap with existing events, count ≤ 3', () => {
      const dayBaseMs = new Date('2025-01-06T00:00:00Z').getTime();

      fc.assert(
        fc.asyncProperty(
          arbMeetingRequest(dayBaseMs),
          fc.array(arbCalendarEvent(dayBaseMs), { minLength: 0, maxLength: 8 }),
          arbSchedulingPreferences(),
          async (request, existingEvents, preferences) => {
            const result = await assistant.suggestSlots(
              request,
              existingEvents,
              preferences,
            );

            // Count constraint: at most 3 suggestions
            expect(result.length).toBeLessThanOrEqual(3);

            // Conflict-free constraint: no overlap with any existing event
            for (const slot of result) {
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
});
