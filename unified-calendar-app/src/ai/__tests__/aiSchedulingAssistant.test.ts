/**
 * Unit tests for AISchedulingAssistant service.
 * Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6
 */

import {
  createAISchedulingAssistant,
  buildAnonymizedAvailability,
  MAX_SUGGESTIONS,
} from '../aiSchedulingAssistant';
import type { AISchedulingAssistant, AIHttpClient, AISchedulingAssistantDeps } from '../aiSchedulingAssistant';
import type { CalendarEvent, MeetingRequest, SchedulingPreferences, FreeBusySlot } from '../../types';
import type { DatabaseDriver } from '../../db/database';
import type { SubscriptionManager } from '../../subscription/subscriptionManager';
import type { CalendarProviderAdapter } from '../../providers/types';
import { createOnDeviceModel } from '../onDeviceModel';
import type { OnDeviceModel } from '../onDeviceModel';

// --- Test Helpers ---

function makeEvent(overrides: Partial<CalendarEvent> & { id: string; startTime: Date; endTime: Date }): CalendarEvent {
  return {
    providerEventId: `provider-${overrides.id}`,
    calendarAccountId: 'cal-1',
    title: `Event ${overrides.id}`,
    description: null,
    location: null,
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
    ...overrides,
  };
}

function makePreferences(overrides?: Partial<SchedulingPreferences>): SchedulingPreferences {
  return {
    userId: 'user-1',
    preferredStartHour: 9,
    preferredEndHour: 17,
    minimumBufferMinutes: 15,
    maxMeetingsPerDay: 8,
    focusTimeBlocks: [],
    learnedPatterns: [],
    ...overrides,
  };
}

function makeRequest(overrides?: Partial<MeetingRequest>): MeetingRequest {
  return {
    title: 'Team Standup',
    duration: 30,
    attendeeEmails: [],
    dateRange: {
      // Monday Jan 6, 2025 8:00 to 18:00
      start: new Date('2025-01-06T08:00:00Z'),
      end: new Date('2025-01-06T18:00:00Z'),
    },
    priority: 'normal',
    ...overrides,
  };
}

function createMockDb(): DatabaseDriver {
  return {
    execute: jest.fn().mockResolvedValue(undefined),
    query: jest.fn().mockResolvedValue([]),
    close: jest.fn().mockResolvedValue(undefined),
    isOpen: jest.fn().mockReturnValue(true),
    supportsTransactions: false,
    transaction: jest.fn(),
  };
}

function createMockSubscriptionManager(tier: 'free' | 'pro' | 'team'): SubscriptionManager {
  const features: Record<string, string[]> = {
    free: [],
    pro: ['unlimited_accounts', 'ai_assistant', 'conflict_detection', 'advanced_privacy'],
    team: ['unlimited_accounts', 'ai_assistant', 'conflict_detection', 'advanced_privacy', 'shared_views', 'delegation'],
  };

  return {
    getCurrentTier: jest.fn().mockReturnValue(tier),
    getCurrentTierFromDb: jest.fn().mockResolvedValue(tier),
    validateReceipt: jest.fn(),
    checkFeatureAccess: jest.fn((userId: string, feature: string) =>
      features[tier].includes(feature),
    ),
    handleDowngrade: jest.fn(),
    getGracePeriodEnd: jest.fn().mockReturnValue(null),
  };
}

describe('AISchedulingAssistant', () => {
  let assistant: AISchedulingAssistant;
  let mockDb: DatabaseDriver;
  let mockSubManager: SubscriptionManager;

  beforeEach(() => {
    mockDb = createMockDb();
    mockSubManager = createMockSubscriptionManager('pro');
    assistant = createAISchedulingAssistant({
      db: mockDb,
      subscriptionManager: mockSubManager,
    });
  });

  describe('Tier gating (Req 8.1)', () => {
    it('rejects Free tier users with upgrade prompt', async () => {
      const freeSubManager = createMockSubscriptionManager('free');
      const freeAssistant = createAISchedulingAssistant({
        db: mockDb,
        subscriptionManager: freeSubManager,
      });

      await expect(
        freeAssistant.suggestSlots(makeRequest(), [], makePreferences()),
      ).rejects.toThrow(/Pro or Team subscription/);
    });

    it('allows Pro tier users', async () => {
      const result = await assistant.suggestSlots(
        makeRequest(),
        [],
        makePreferences(),
      );
      expect(Array.isArray(result)).toBe(true);
    });

    it('allows Team tier users', async () => {
      const teamSubManager = createMockSubscriptionManager('team');
      const teamAssistant = createAISchedulingAssistant({
        db: mockDb,
        subscriptionManager: teamSubManager,
      });

      const result = await teamAssistant.suggestSlots(
        makeRequest(),
        [],
        makePreferences(),
      );
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('suggestSlots (Req 8.2)', () => {
    it('returns at most 3 suggestions', async () => {
      const result = await assistant.suggestSlots(
        makeRequest(),
        [],
        makePreferences(),
      );
      expect(result.length).toBeLessThanOrEqual(MAX_SUGGESTIONS);
    });

    it('returns conflict-free slots', async () => {
      const existingEvent = makeEvent({
        id: 'existing-1',
        startTime: new Date('2025-01-06T10:00:00Z'),
        endTime: new Date('2025-01-06T11:00:00Z'),
      });

      const result = await assistant.suggestSlots(
        makeRequest({ duration: 60 }),
        [existingEvent],
        makePreferences(),
      );

      for (const slot of result) {
        const overlaps =
          slot.start.getTime() < existingEvent.endTime.getTime() &&
          existingEvent.startTime.getTime() < slot.end.getTime();
        expect(overlaps).toBe(false);
      }
    });

    it('includes score between 0 and 1 for each suggestion', async () => {
      const result = await assistant.suggestSlots(
        makeRequest(),
        [],
        makePreferences(),
      );

      for (const slot of result) {
        expect(slot.score).toBeGreaterThanOrEqual(0);
        expect(slot.score).toBeLessThanOrEqual(1);
      }
    });

    it('includes tradeoff explanations for slots outside preferences', async () => {
      // Request a range that only has slots outside preferred hours
      const result = await assistant.suggestSlots(
        makeRequest({
          dateRange: {
            start: new Date('2025-01-06T05:00:00Z'),
            end: new Date('2025-01-06T08:00:00Z'),
          },
        }),
        [],
        makePreferences({ preferredStartHour: 9, preferredEndHour: 17 }),
      );

      if (result.length > 0) {
        // At least some slots should have tradeoffs since they're before 9am
        const hasTradeoffs = result.some((s) => s.tradeoffs.length > 0);
        expect(hasTradeoffs).toBe(true);
      }
    });
  });

  describe('Preference respect (Req 8.5)', () => {
    it('prefers slots within preferred hours', async () => {
      const result = await assistant.suggestSlots(
        makeRequest({
          dateRange: {
            start: new Date('2025-01-06T06:00:00Z'),
            end: new Date('2025-01-06T20:00:00Z'),
          },
        }),
        [],
        makePreferences({ preferredStartHour: 9, preferredEndHour: 17 }),
      );

      // First suggestion should be within preferred hours (highest score)
      if (result.length > 0) {
        const firstSlot = result[0];
        const startHour = firstSlot.start.getUTCHours();
        expect(startHour).toBeGreaterThanOrEqual(9);
        expect(startHour).toBeLessThan(17);
      }
    });

    it('respects focus time blocks', async () => {
      const prefs = makePreferences({
        focusTimeBlocks: [
          { dayOfWeek: 1, startHour: 14, endHour: 16, label: 'Deep Work' }, // Monday 14-16
        ],
      });

      const result = await assistant.suggestSlots(
        makeRequest({
          duration: 30,
          dateRange: {
            start: new Date('2025-01-06T09:00:00Z'), // Monday
            end: new Date('2025-01-06T17:00:00Z'),
          },
        }),
        [],
        prefs,
      );

      // Slots during focus time should have tradeoffs mentioning focus time
      const focusTimeSlots = result.filter((s) => {
        const hour = s.start.getUTCHours();
        return hour >= 14 && hour < 16;
      });

      for (const slot of focusTimeSlots) {
        expect(slot.tradeoffs).toEqual(
          expect.arrayContaining([
            expect.stringContaining('focus time'),
          ]),
        );
      }
    });
  });

  describe('Privacy - anonymized API calls (Req 13.3)', () => {
    it('strips event titles, descriptions, and attendee names from server requests', async () => {
      const events = [
        makeEvent({
          id: 'e1',
          title: 'Secret Meeting',
          description: 'Confidential discussion',
          startTime: new Date('2025-01-06T10:00:00Z'),
          endTime: new Date('2025-01-06T11:00:00Z'),
          attendees: [
            { email: 'alice@example.com', displayName: 'Alice', status: 'accepted', role: 'required' },
          ],
        }),
      ];

      const anonymized = buildAnonymizedAvailability(events);

      expect(anonymized).toHaveLength(1);
      expect(anonymized[0]).toEqual({
        start: expect.any(String),
        end: expect.any(String),
      });
      // Should NOT contain any event details
      const serialized = JSON.stringify(anonymized);
      expect(serialized).not.toContain('Secret Meeting');
      expect(serialized).not.toContain('Confidential');
      expect(serialized).not.toContain('Alice');
      expect(serialized).not.toContain('alice@example.com');
    });

    it('sends anonymized data to server-side AI service', async () => {
      let capturedBody: any = null;
      const mockHttp = {
        post: jest.fn(async (_url: string, body: unknown) => {
          capturedBody = body;
          return { data: [] };
        }),
      } as unknown as AIHttpClient;

      const assistantWithHttp = createAISchedulingAssistant({
        db: mockDb,
        subscriptionManager: mockSubManager,
        http: mockHttp,
      });

      const events = [
        makeEvent({
          id: 'e1',
          title: 'Private Event',
          description: 'Do not share',
          startTime: new Date('2025-01-06T10:00:00Z'),
          endTime: new Date('2025-01-06T11:00:00Z'),
        }),
      ];

      await assistantWithHttp.suggestSlots(
        makeRequest({ attendeeEmails: ['alice@example.com'] }),
        events,
        makePreferences(),
      );

      expect(mockHttp.post).toHaveBeenCalledWith('/ai/suggest-slots', expect.any(Object));
      const bodyStr = JSON.stringify(capturedBody);
      expect(bodyStr).not.toContain('Private Event');
      expect(bodyStr).not.toContain('Do not share');
      // Attendee emails must NOT be sent to the server (privacy requirement)
      expect(bodyStr).not.toContain('alice@example.com');
      expect(capturedBody.attendeeEmails).toBeUndefined();
      expect(capturedBody.availabilityWindows).toBeDefined();
    });
  });

  describe('Fallback when no preferred slots (Req 8.6)', () => {
    it('suggests alternatives with tradeoff explanations when no ideal slot exists', async () => {
      // Fill the entire preferred window with events
      const events = [];
      for (let h = 9; h < 17; h++) {
        events.push(
          makeEvent({
            id: `block-${h}`,
            startTime: new Date(`2025-01-06T${String(h).padStart(2, '0')}:00:00Z`),
            endTime: new Date(`2025-01-06T${String(h + 1).padStart(2, '0')}:00:00Z`),
          }),
        );
      }

      const result = await assistant.suggestSlots(
        makeRequest({
          duration: 30,
          dateRange: {
            start: new Date('2025-01-06T06:00:00Z'),
            end: new Date('2025-01-06T20:00:00Z'),
          },
        }),
        events,
        makePreferences(),
      );

      // Should still return suggestions (outside preferred hours)
      expect(result.length).toBeGreaterThan(0);
      // These should have tradeoff explanations
      const hasTradeoffs = result.some((s) => s.tradeoffs.length > 0);
      expect(hasTradeoffs).toBe(true);
    });
  });

  describe('learnFromPattern (Req 8.3)', () => {
    it('records accepted events for pattern learning', async () => {
      // Mock the DB to return a userId for the calendar account lookup
      (mockDb.query as jest.Mock).mockImplementation((sql: string) => {
        if (sql.includes('calendar_accounts')) {
          return Promise.resolve([{ user_id: 'user-1' }]);
        }
        if (sql.includes('scheduling_preferences')) {
          return Promise.resolve([]);
        }
        return Promise.resolve([]);
      });

      const event = makeEvent({
        id: 'learn-1',
        startTime: new Date('2025-01-06T10:00:00Z'), // Monday 10am
        endTime: new Date('2025-01-06T10:30:00Z'),
      });

      // Should not throw
      expect(() => assistant.learnFromPattern(event, 'accepted')).not.toThrow();

      // Allow async persistence to complete
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    it('records declined events for pattern learning', async () => {
      (mockDb.query as jest.Mock).mockImplementation((sql: string) => {
        if (sql.includes('calendar_accounts')) {
          return Promise.resolve([{ user_id: 'user-1' }]);
        }
        if (sql.includes('scheduling_preferences')) {
          return Promise.resolve([]);
        }
        return Promise.resolve([]);
      });

      const event = makeEvent({
        id: 'learn-2',
        startTime: new Date('2025-01-07T14:00:00Z'), // Tuesday 2pm
        endTime: new Date('2025-01-07T15:00:00Z'),
      });

      expect(() => assistant.learnFromPattern(event, 'declined')).not.toThrow();
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    it('records rescheduled events for pattern learning', async () => {
      (mockDb.query as jest.Mock).mockImplementation((sql: string) => {
        if (sql.includes('calendar_accounts')) {
          return Promise.resolve([{ user_id: 'user-1' }]);
        }
        if (sql.includes('scheduling_preferences')) {
          return Promise.resolve([]);
        }
        return Promise.resolve([]);
      });

      const event = makeEvent({
        id: 'learn-3',
        startTime: new Date('2025-01-08T09:00:00Z'),
        endTime: new Date('2025-01-08T09:30:00Z'),
      });

      expect(() => assistant.learnFromPattern(event, 'rescheduled')).not.toThrow();
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    it('aggregates patterns at user level across multiple calendar accounts', async () => {
      (mockDb.query as jest.Mock).mockImplementation((sql: string) => {
        if (sql.includes('calendar_accounts')) {
          return Promise.resolve([{ user_id: 'user-1' }]);
        }
        if (sql.includes('SELECT user_id FROM scheduling_preferences')) {
          return Promise.resolve([{ user_id: 'user-1' }]);
        }
        return Promise.resolve([]);
      });

      // Learn from events on different calendar accounts but same user
      const event1 = makeEvent({
        id: 'learn-multi-1',
        calendarAccountId: 'cal-account-A',
        startTime: new Date('2025-01-06T10:00:00Z'),
        endTime: new Date('2025-01-06T10:30:00Z'),
      });
      const event2 = makeEvent({
        id: 'learn-multi-2',
        calendarAccountId: 'cal-account-B',
        startTime: new Date('2025-01-06T10:00:00Z'),
        endTime: new Date('2025-01-06T11:00:00Z'),
      });

      assistant.learnFromPattern(event1, 'accepted');
      assistant.learnFromPattern(event2, 'accepted');

      // Allow async persistence to complete
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Both should have been persisted under the same userId
      expect(mockDb.execute).toHaveBeenCalled();
    });
  });

  describe('getPreferences (Req 8.5)', () => {
    it('returns defaults for new users', async () => {
      (mockDb.query as jest.Mock).mockResolvedValue([]);

      const prefs = await assistant.getPreferences('new-user');

      expect(prefs.userId).toBe('new-user');
      expect(prefs.preferredStartHour).toBe(9);
      expect(prefs.preferredEndHour).toBe(17);
      expect(prefs.minimumBufferMinutes).toBe(15);
      expect(prefs.maxMeetingsPerDay).toBe(8);
      expect(prefs.focusTimeBlocks).toEqual([]);
      expect(prefs.learnedPatterns).toEqual([]);
    });

    it('loads preferences from database', async () => {
      (mockDb.query as jest.Mock).mockResolvedValue([
        {
          user_id: 'user-1',
          preferred_start_hour: 8,
          preferred_end_hour: 16,
          minimum_buffer_minutes: 10,
          max_meetings_per_day: 6,
          focus_time_blocks: JSON.stringify([
            { dayOfWeek: 1, startHour: 9, endHour: 11, label: 'Focus' },
          ]),
          learned_patterns: JSON.stringify([
            { dayOfWeek: 1, hourSlot: 10, acceptanceRate: 0.8, averageDuration: 30, sampleCount: 10 },
          ]),
        },
      ]);

      const prefs = await assistant.getPreferences('user-1');

      expect(prefs.preferredStartHour).toBe(8);
      expect(prefs.preferredEndHour).toBe(16);
      expect(prefs.minimumBufferMinutes).toBe(10);
      expect(prefs.maxMeetingsPerDay).toBe(6);
      expect(prefs.focusTimeBlocks).toHaveLength(1);
      expect(prefs.learnedPatterns).toHaveLength(1);
    });

    it('handles malformed JSON in database gracefully', async () => {
      (mockDb.query as jest.Mock).mockResolvedValue([
        {
          user_id: 'user-1',
          preferred_start_hour: 9,
          preferred_end_hour: 17,
          minimum_buffer_minutes: 15,
          max_meetings_per_day: 8,
          focus_time_blocks: 'not-valid-json',
          learned_patterns: null,
        },
      ]);

      const prefs = await assistant.getPreferences('user-1');

      expect(prefs.focusTimeBlocks).toEqual([]);
      expect(prefs.learnedPatterns).toEqual([]);
    });
  });

  describe('External attendee free/busy (Req 8.4)', () => {
    it('excludes slots that conflict with external attendee busy times', async () => {
      const mockAdapter: Partial<CalendarProviderAdapter> = {
        providerId: 'google' as any,
        listCalendars: jest.fn().mockResolvedValue([{ id: 'cal-ext-1' }]),
        getFreeBusy: jest.fn().mockResolvedValue([
          {
            start: new Date('2025-01-06T10:00:00Z'),
            end: new Date('2025-01-06T11:00:00Z'),
            status: 'busy',
          },
        ] as FreeBusySlot[]),
      };

      const adapters = new Map<string, CalendarProviderAdapter>();
      adapters.set('account-1', mockAdapter as CalendarProviderAdapter);

      const assistantWithAdapters = createAISchedulingAssistant({
        db: mockDb,
        subscriptionManager: mockSubManager,
        providerAdapters: adapters,
      });

      const result = await assistantWithAdapters.suggestSlots(
        makeRequest({
          duration: 60,
          attendeeEmails: ['external@example.com'],
          dateRange: {
            start: new Date('2025-01-06T09:00:00Z'),
            end: new Date('2025-01-06T12:00:00Z'),
          },
        }),
        [],
        makePreferences(),
      );

      // No suggested slot should overlap with the attendee's busy time (10:00-11:00)
      for (const slot of result) {
        const overlaps =
          slot.start.getTime() < new Date('2025-01-06T11:00:00Z').getTime() &&
          new Date('2025-01-06T10:00:00Z').getTime() < slot.end.getTime();
        expect(overlaps).toBe(false);
      }
    });

    it('gracefully handles provider adapter failures', async () => {
      const mockAdapter: Partial<CalendarProviderAdapter> = {
        providerId: 'google' as any,
        listCalendars: jest.fn().mockRejectedValue(new Error('Network error')),
        getFreeBusy: jest.fn(),
      };

      const adapters = new Map<string, CalendarProviderAdapter>();
      adapters.set('account-1', mockAdapter as CalendarProviderAdapter);

      const assistantWithAdapters = createAISchedulingAssistant({
        db: mockDb,
        subscriptionManager: mockSubManager,
        providerAdapters: adapters,
      });

      // Should not throw — falls back to ignoring external busy times
      const result = await assistantWithAdapters.suggestSlots(
        makeRequest({ attendeeEmails: ['external@example.com'] }),
        [],
        makePreferences(),
      );

      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe('Model initialization from persisted patterns (Req 8.3)', () => {
    it('loads learned patterns from DB on first suggestSlots call', async () => {
      const patterns = [];
      for (let i = 0; i < 10; i++) {
        patterns.push({
          dayOfWeek: 1,
          hourSlot: 10,
          acceptanceRate: 0.9,
          averageDuration: 30,
          sampleCount: 1,
        });
      }

      const dbWithPatterns = createMockDb();
      (dbWithPatterns.query as jest.Mock).mockResolvedValue([
        { learned_patterns: JSON.stringify(patterns) },
      ]);

      const assistantWithPatterns = createAISchedulingAssistant({
        db: dbWithPatterns,
        subscriptionManager: mockSubManager,
      });

      await assistantWithPatterns.suggestSlots(
        makeRequest(),
        [],
        makePreferences(),
      );

      // Verify the DB was queried for learned patterns
      expect(dbWithPatterns.query).toHaveBeenCalledWith(
        expect.stringContaining('scheduling_preferences'),
        expect.any(Array),
      );
    });
  });

  describe('Server-side AI integration', () => {
    it('uses server response when available', async () => {
      const mockHttp = {
        post: jest.fn().mockResolvedValue({
          data: [
            {
              start: '2025-01-06T10:00:00Z',
              end: '2025-01-06T10:30:00Z',
              score: 0.95,
              tradeoffs: [],
            },
          ],
        }),
      } as unknown as AIHttpClient;

      const assistantWithHttp = createAISchedulingAssistant({
        db: mockDb,
        subscriptionManager: mockSubManager,
        http: mockHttp,
      });

      const result = await assistantWithHttp.suggestSlots(
        makeRequest(),
        [],
        makePreferences(),
      );

      expect(result).toHaveLength(1);
      expect(result[0].score).toBe(0.95);
    });

    it('falls back to local heuristic when server fails', async () => {
      const mockHttp = {
        post: jest.fn().mockRejectedValue(new Error('Network error')),
      } as unknown as AIHttpClient;

      const assistantWithHttp = createAISchedulingAssistant({
        db: mockDb,
        subscriptionManager: mockSubManager,
        http: mockHttp,
      });

      const result = await assistantWithHttp.suggestSlots(
        makeRequest(),
        [],
        makePreferences(),
      );

      // Should still return results from local heuristic
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe('Performance (Req 7.5 - 500ms budget)', () => {
    it('suggestSlots completes within 500ms for a typical workday with 10 events', async () => {
      // Simulate a realistic scenario: 10 existing events spread across a workday
      const events: CalendarEvent[] = [];
      for (let h = 8; h < 18; h++) {
        if (h % 2 === 0) {
          events.push(
            makeEvent({
              id: `perf-${h}`,
              startTime: new Date(`2025-01-06T${String(h).padStart(2, '0')}:00:00Z`),
              endTime: new Date(`2025-01-06T${String(h).padStart(2, '0')}:30:00Z`),
            }),
          );
        }
      }

      const start = performance.now();
      const result = await assistant.suggestSlots(
        makeRequest({
          duration: 30,
          dateRange: {
            start: new Date('2025-01-06T06:00:00Z'),
            end: new Date('2025-01-06T22:00:00Z'),
          },
        }),
        events,
        makePreferences(),
      );
      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(500);
      expect(result.length).toBeGreaterThan(0);
    });

    it('suggestSlots completes within 500ms for a week-long range with 30 events', async () => {
      // Simulate a week-long search with 30 events
      const events: CalendarEvent[] = [];
      for (let d = 6; d <= 10; d++) {
        for (let h = 9; h < 15; h++) {
          events.push(
            makeEvent({
              id: `perf-week-${d}-${h}`,
              startTime: new Date(`2025-01-${String(d).padStart(2, '0')}T${String(h).padStart(2, '0')}:00:00Z`),
              endTime: new Date(`2025-01-${String(d).padStart(2, '0')}T${String(h).padStart(2, '0')}:45:00Z`),
            }),
          );
        }
      }

      const start = performance.now();
      const result = await assistant.suggestSlots(
        makeRequest({
          duration: 60,
          dateRange: {
            start: new Date('2025-01-06T00:00:00Z'),
            end: new Date('2025-01-11T00:00:00Z'),
          },
        }),
        events,
        makePreferences(),
      );
      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(500);
      expect(result.length).toBeLessThanOrEqual(3);
    });
  });
});
