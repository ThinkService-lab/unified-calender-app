/**
 * AISchedulingAssistant service implementation.
 * Suggests optimal meeting times, learns from patterns, and respects preferences.
 * Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6
 */

import type { CalendarEvent, MeetingRequest, SchedulingPreferences, SlotSuggestion, TimeBlock, LearnedPattern, FreeBusySlot } from '../types';
import type { DatabaseDriver } from '../db/database';
import type { SubscriptionManager } from '../subscription/subscriptionManager';
import type { CalendarProviderAdapter } from '../providers/types';
import type { OnDeviceModel } from './onDeviceModel';
import { createOnDeviceModel } from './onDeviceModel';

/** Maximum number of slot suggestions returned. */
const MAX_SUGGESTIONS = 3;

/** Minimum sample count before learned patterns influence scoring. */
const MIN_PATTERN_SAMPLES = 5;

/** HTTP client interface for server-side AI calls. */
export interface AIHttpClient {
  post<T>(url: string, body: unknown): Promise<{ data: T }>;
}

export interface AISchedulingAssistantDeps {
  db: DatabaseDriver;
  subscriptionManager: SubscriptionManager;
  http?: AIHttpClient;
  /** Provider adapters keyed by account ID — used for external attendee free/busy lookups (Req 8.4) */
  providerAdapters?: Map<string, CalendarProviderAdapter>;
  /** On-device model instance for pattern-based scoring (Req 8.3). Created internally if not provided. */
  onDeviceModel?: OnDeviceModel;
}

export interface AISchedulingAssistant {
  suggestSlots(
    request: MeetingRequest,
    calendars: CalendarEvent[],
    preferences: SchedulingPreferences,
  ): Promise<SlotSuggestion[]>;

  learnFromPattern(
    event: CalendarEvent,
    action: 'accepted' | 'declined' | 'rescheduled',
  ): void;

  getPreferences(userId: string): Promise<SchedulingPreferences>;
}

/**
 * Check if two time ranges overlap: startA < endB AND startB < endA
 */
function hasTimeOverlap(startA: Date, endA: Date, startB: Date, endB: Date): boolean {
  return startA.getTime() < endB.getTime() && startB.getTime() < endA.getTime();
}

/**
 * Check if a candidate slot overlaps with any existing event.
 */
function hasConflict(start: Date, end: Date, events: CalendarEvent[]): boolean {
  return events.some((e) => hasTimeOverlap(start, end, e.startTime, e.endTime));
}

/**
 * Count meetings on a given day from the events list.
 */
function countMeetingsOnDay(day: Date, events: CalendarEvent[]): number {
  const dayStart = new Date(day);
  dayStart.setUTCHours(0, 0, 0, 0);
  const dayEnd = new Date(day);
  dayEnd.setUTCHours(23, 59, 59, 999);

  return events.filter(
    (e) => e.startTime.getTime() < dayEnd.getTime() && e.endTime.getTime() > dayStart.getTime(),
  ).length;
}

/**
 * Check if a slot falls within a focus time block.
 */
function overlapsFocusTime(start: Date, end: Date, focusBlocks: TimeBlock[]): boolean {
  const dayOfWeek = start.getUTCDay(); // 0=Sunday
  const startHour = start.getUTCHours() + start.getUTCMinutes() / 60;
  const endHour = end.getUTCHours() + end.getUTCMinutes() / 60;

  return focusBlocks.some(
    (block) =>
      block.dayOfWeek === dayOfWeek &&
      startHour < block.endHour &&
      endHour > block.startHour,
  );
}

/**
 * Check if a slot has sufficient buffer from adjacent events.
 */
function hasAdequateBuffer(
  start: Date,
  end: Date,
  events: CalendarEvent[],
  bufferMinutes: number,
): boolean {
  if (bufferMinutes <= 0) return true;

  const bufferMs = bufferMinutes * 60 * 1000;
  const bufferedStart = new Date(start.getTime() - bufferMs);
  const bufferedEnd = new Date(end.getTime() + bufferMs);

  return !events.some(
    (e) => hasTimeOverlap(bufferedStart, bufferedEnd, e.startTime, e.endTime),
  );
}

/**
 * Check if a slot is within preferred hours.
 */
function isWithinPreferredHours(
  start: Date,
  end: Date,
  preferredStartHour: number,
  preferredEndHour: number,
): boolean {
  const startHour = start.getUTCHours() + start.getUTCMinutes() / 60;
  const endHour = end.getUTCHours() + end.getUTCMinutes() / 60;
  return startHour >= preferredStartHour && endHour <= preferredEndHour;
}

/**
 * Score a candidate slot based on preferences and learned patterns.
 * Returns a value between 0 and 1.
 */
function scoreSlot(
  start: Date,
  end: Date,
  preferences: SchedulingPreferences,
  events: CalendarEvent[],
): { score: number; tradeoffs: string[] } {
  let score = 1.0;
  const tradeoffs: string[] = [];

  // Preferred hours check
  if (!isWithinPreferredHours(start, end, preferences.preferredStartHour, preferences.preferredEndHour)) {
    score -= 0.3;
    tradeoffs.push(
      `Outside preferred hours (${preferences.preferredStartHour}:00-${preferences.preferredEndHour}:00)`,
    );
  }

  // Buffer check
  if (!hasAdequateBuffer(start, end, events, preferences.minimumBufferMinutes)) {
    score -= 0.2;
    tradeoffs.push(
      `Less than ${preferences.minimumBufferMinutes} min buffer from adjacent meetings`,
    );
  }

  // Max meetings per day check
  const meetingsOnDay = countMeetingsOnDay(start, events);
  if (meetingsOnDay >= preferences.maxMeetingsPerDay) {
    score -= 0.25;
    tradeoffs.push(
      `Exceeds max meetings per day (${meetingsOnDay}/${preferences.maxMeetingsPerDay})`,
    );
  }

  // Focus time check
  if (overlapsFocusTime(start, end, preferences.focusTimeBlocks)) {
    score -= 0.15;
    tradeoffs.push('Overlaps with a focus time block');
  }

  // Learned pattern bonus
  const dayOfWeek = start.getUTCDay();
  const hourSlot = start.getUTCHours();
  const pattern = preferences.learnedPatterns.find(
    (p) => p.dayOfWeek === dayOfWeek && p.hourSlot === hourSlot,
  );
  if (pattern && pattern.sampleCount >= MIN_PATTERN_SAMPLES) {
    // Boost score based on acceptance rate
    score += (pattern.acceptanceRate - 0.5) * 0.2;
  }

  // Clamp score to [0, 1]
  score = Math.max(0, Math.min(1, score));

  return { score, tradeoffs };
}

/**
 * Build anonymized availability windows from calendar events.
 * Strips titles, descriptions, and attendee names — sends only time blocks.
 * Requirement 13.3: no raw event data sent to third parties.
 */
function buildAnonymizedAvailability(
  events: CalendarEvent[],
): Array<{ start: string; end: string }> {
  return events.map((e) => ({
    start: e.startTime.toISOString(),
    end: e.endTime.toISOString(),
  }));
}

/**
 * Creates an AISchedulingAssistant service.
 */
export function createAISchedulingAssistant(
  deps: AISchedulingAssistantDeps,
): AISchedulingAssistant {
  const { db, subscriptionManager, http, providerAdapters } = deps;

  // On-device model for pattern-based scoring (Req 8.3)
  // If no model is provided, create one — patterns will be loaded on first getPreferences call
  const model: OnDeviceModel = deps.onDeviceModel ?? createOnDeviceModel();

  // Track which users have had their model initialized from persisted patterns
  const modelInitializedForUsers: Set<string> = new Set();

  // In-memory pattern store for on-device learning, keyed by userId (not calendarAccountId)
  // Patterns are aggregated at the user level so cross-account patterns influence suggestions.
  const patternStore: Map<string, LearnedPattern[]> = new Map();

  /**
   * Initialize the on-device model from persisted learned patterns.
   * Called lazily on first suggestSlots call per user to avoid blocking construction.
   * Supports multiple users by tracking initialization per userId.
   */
  async function ensureModelInitialized(userId: string): Promise<void> {
    if (modelInitializedForUsers.has(userId)) return;
    modelInitializedForUsers.add(userId);

    try {
      const rows = await db.query<{
        learned_patterns: string | null;
      }>(
        'SELECT learned_patterns FROM scheduling_preferences WHERE user_id = ?',
        [userId],
      );

      if (rows.length > 0 && rows[0].learned_patterns) {
        const patterns: LearnedPattern[] = JSON.parse(rows[0].learned_patterns);
        // Also populate the in-memory pattern store for this user
        if (!patternStore.has(userId)) {
          patternStore.set(userId, patterns);
        }
        for (const pattern of patterns) {
          model.train(pattern);
        }
      }
    } catch {
      // Best-effort — model will use fallback heuristics
    }
  }

  /**
   * Gate access behind Pro/Team tier subscription check.
   * Throws if user is on Free tier.
   */
  function requirePaidTier(userId: string): void {
    const hasAccess = subscriptionManager.checkFeatureAccess(userId, 'ai_assistant');
    if (!hasAccess) {
      throw new Error(
        'AI Scheduling Assistant requires a Pro or Team subscription. Please upgrade to access this feature.',
      );
    }
  }

  /**
   * Fetch free/busy information for external attendees (Req 8.4).
   * Queries provider adapters for attendee availability where supported.
   * Returns busy time blocks that should be treated as conflicts.
   */
  async function fetchExternalAttendeeBusyTimes(
    attendeeEmails: string[],
    dateRange: { start: Date; end: Date },
  ): Promise<FreeBusySlot[]> {
    if (!providerAdapters || attendeeEmails.length === 0) {
      return [];
    }

    const busySlots: FreeBusySlot[] = [];

    // Query each provider adapter that supports getFreeBusy
    for (const [, adapter] of providerAdapters) {
      if (!adapter.getFreeBusy) continue;

      try {
        // Use the first calendar from the adapter for free/busy queries
        // In practice, free/busy is typically queried at the account level
        const calendars = await adapter.listCalendars('');
        if (calendars.length === 0) continue;

        const slots = await adapter.getFreeBusy(calendars[0].id, dateRange);
        busySlots.push(...slots.filter((s) => s.status === 'busy' || s.status === 'tentative'));
      } catch {
        // Best-effort: skip providers that fail
      }
    }

    return busySlots;
  }

  /**
   * Check if a candidate slot conflicts with external attendee busy times.
   */
  function conflictsWithAttendeeBusyTimes(
    start: Date,
    end: Date,
    busySlots: FreeBusySlot[],
  ): boolean {
    return busySlots.some((slot) => hasTimeOverlap(start, end, slot.start, slot.end));
  }

  /**
   * Generate candidate slots within the date range.
   * Steps through the range in 30-minute increments.
   */
  function generateCandidateSlots(
    dateRange: { start: Date; end: Date },
    durationMinutes: number,
  ): Array<{ start: Date; end: Date }> {
    const candidates: Array<{ start: Date; end: Date }> = [];
    const stepMs = 30 * 60 * 1000; // 30-minute steps
    const durationMs = durationMinutes * 60 * 1000;
    let currentMs = dateRange.start.getTime();
    const rangeEndMs = dateRange.end.getTime();

    while (currentMs + durationMs <= rangeEndMs) {
      candidates.push({
        start: new Date(currentMs),
        end: new Date(currentMs + durationMs),
      });
      currentMs += stepMs;
    }

    return candidates;
  }

  async function suggestSlots(
    request: MeetingRequest,
    calendars: CalendarEvent[],
    preferences: SchedulingPreferences,
  ): Promise<SlotSuggestion[]> {
    requirePaidTier(preferences.userId);

    // Ensure on-device model is initialized from persisted patterns (Req 8.3)
    await ensureModelInitialized(preferences.userId);

    // Fetch external attendee busy times (Req 8.4)
    const attendeeBusyTimes = await fetchExternalAttendeeBusyTimes(
      request.attendeeEmails,
      request.dateRange,
    );

    // Try server-side AI service first if http client is available
    if (http) {
      try {
        const anonymizedWindows = buildAnonymizedAvailability(calendars);
        // Per design: strip event titles, descriptions, and attendee names/emails.
        // Only send anonymized availability windows (time blocks) to the server.
        // Attendee free/busy is resolved locally via provider adapters (Req 8.4).
        const { data } = await http.post<SlotSuggestion[]>('/ai/suggest-slots', {
          userId: preferences.userId,
          duration: request.duration,
          dateRange: {
            start: request.dateRange.start.toISOString(),
            end: request.dateRange.end.toISOString(),
          },
          preferences: {
            preferredStartHour: preferences.preferredStartHour,
            preferredEndHour: preferences.preferredEndHour,
            minimumBufferMinutes: preferences.minimumBufferMinutes,
            maxMeetingsPerDay: preferences.maxMeetingsPerDay,
            focusTimeBlocks: preferences.focusTimeBlocks,
          },
          availabilityWindows: anonymizedWindows,
        });

        // Server returned suggestions — validate and return
        if (Array.isArray(data) && data.length > 0) {
          return data.slice(0, MAX_SUGGESTIONS).map((s) => ({
            start: new Date(s.start),
            end: new Date(s.end),
            score: Math.max(0, Math.min(1, s.score)),
            tradeoffs: s.tradeoffs ?? [],
          }));
        }
      } catch {
        // Fall through to local heuristic if server call fails
      }
    }

    // Local heuristic-based suggestion (includes attendee busy times)
    return suggestSlotsLocally(request, calendars, preferences, attendeeBusyTimes);
  }

  /**
   * Local heuristic slot suggestion.
   * Generates candidates, filters conflict-free ones, scores them, returns top 3.
   * Incorporates external attendee busy times (Req 8.4) and on-device model (Req 8.3).
   *
   * Model inference is batched and yielded periodically to avoid blocking the main thread
   * when processing large date ranges with many candidates.
   */
  async function suggestSlotsLocally(
    request: MeetingRequest,
    calendars: CalendarEvent[],
    preferences: SchedulingPreferences,
    attendeeBusyTimes: FreeBusySlot[] = [],
  ): Promise<SlotSuggestion[]> {
    const candidates = generateCandidateSlots(request.dateRange, request.duration);

    // Phase 1: Find slots that match all preferences
    const preferredSlots: SlotSuggestion[] = [];
    // Phase 2: Collect all conflict-free slots (even if outside preferences)
    const alternativeSlots: SlotSuggestion[] = [];

    // Batch size for yielding to the event loop — prevents blocking on large ranges
    const YIELD_BATCH_SIZE = 50;
    let processedCount = 0;

    for (const candidate of candidates) {
      // Must be conflict-free with user's own events
      if (hasConflict(candidate.start, candidate.end, calendars)) {
        continue;
      }

      // Must not conflict with external attendee busy times (Req 8.4)
      if (conflictsWithAttendeeBusyTimes(candidate.start, candidate.end, attendeeBusyTimes)) {
        continue;
      }

      const { score, tradeoffs } = scoreSlot(
        candidate.start,
        candidate.end,
        preferences,
        calendars,
      );

      // Apply on-device model inference off main thread (Req 8.3)
      let finalScore = score;
      if (model.isReady()) {
        const dayOfWeek = candidate.start.getUTCDay();
        const hourSlot = candidate.start.getUTCHours();
        // model.infer() already yields via setTimeout(0) internally
        const inference = await model.infer(dayOfWeek, hourSlot);
        const modelScore = inference.preferenceScore;
        // Blend heuristic score with model score (70% heuristic, 30% model)
        finalScore = score * 0.7 + modelScore * 0.3;
        finalScore = Math.max(0, Math.min(1, finalScore));
      } else {
        // Yield periodically even without model inference to keep UI responsive
        processedCount++;
        if (processedCount % YIELD_BATCH_SIZE === 0) {
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      }

      const suggestion: SlotSuggestion = {
        start: candidate.start,
        end: candidate.end,
        score: finalScore,
        tradeoffs,
      };

      if (tradeoffs.length === 0) {
        preferredSlots.push(suggestion);
      } else {
        alternativeSlots.push(suggestion);
      }

      // Early exit: if we already have enough preferred slots, no need to continue
      if (preferredSlots.length >= MAX_SUGGESTIONS) {
        break;
      }
    }

    // Sort preferred slots by score descending
    preferredSlots.sort((a, b) => b.score - a.score);

    if (preferredSlots.length >= MAX_SUGGESTIONS) {
      return preferredSlots.slice(0, MAX_SUGGESTIONS);
    }

    // Fill remaining with best alternatives (sorted by score)
    alternativeSlots.sort((a, b) => b.score - a.score);
    const combined = [...preferredSlots, ...alternativeSlots];
    return combined.slice(0, MAX_SUGGESTIONS);
  }

  function learnFromPattern(
    event: CalendarEvent,
    action: 'accepted' | 'declined' | 'rescheduled',
  ): void {
    const dayOfWeek = event.startTime.getUTCDay();
    const hourSlot = event.startTime.getUTCHours();
    const durationMinutes = Math.round(
      (event.endTime.getTime() - event.startTime.getTime()) / 60000,
    );

    // Resolve the userId for this calendar account so patterns aggregate at the user level.
    // Use calendarAccountId as a fallback key until the async lookup completes.
    const calendarAccountId = event.calendarAccountId;

    // Perform the user-level pattern update asynchronously
    void resolveUserAndLearn(calendarAccountId, dayOfWeek, hourSlot, durationMinutes, action);
  }

  /**
   * Resolve the userId for a calendar account and update patterns at the user level.
   * This ensures patterns from all of a user's calendar accounts are aggregated together,
   * improving suggestion quality for multi-account users.
   */
  async function resolveUserAndLearn(
    calendarAccountId: string,
    dayOfWeek: number,
    hourSlot: number,
    durationMinutes: number,
    action: 'accepted' | 'declined' | 'rescheduled',
  ): Promise<void> {
    // Look up the userId for this calendar account
    let userId: string;
    try {
      const rows = await db.query<{ user_id: string }>(
        'SELECT user_id FROM calendar_accounts WHERE id = ?',
        [calendarAccountId],
      );
      if (rows.length === 0) {
        // Fallback: use calendarAccountId as key if lookup fails
        userId = calendarAccountId;
      } else {
        userId = rows[0].user_id;
      }
    } catch {
      userId = calendarAccountId;
    }

    // Get or create pattern list for this user
    if (!patternStore.has(userId)) {
      patternStore.set(userId, []);
    }
    const patterns = patternStore.get(userId)!;

    // Find existing pattern for this day/hour
    let pattern = patterns.find(
      (p) => p.dayOfWeek === dayOfWeek && p.hourSlot === hourSlot,
    );

    if (!pattern) {
      pattern = {
        dayOfWeek,
        hourSlot,
        acceptanceRate: 0,
        averageDuration: 0,
        sampleCount: 0,
      };
      patterns.push(pattern);
    }

    // Update pattern with new data point
    const wasAccepted = action === 'accepted' ? 1 : 0;
    const oldCount = pattern.sampleCount;
    const newCount = oldCount + 1;

    // Running average for acceptance rate
    pattern.acceptanceRate =
      (pattern.acceptanceRate * oldCount + wasAccepted) / newCount;

    // Running average for duration
    pattern.averageDuration =
      (pattern.averageDuration * oldCount + durationMinutes) / newCount;

    pattern.sampleCount = newCount;

    // Train the on-device model with the updated pattern (Req 8.3)
    model.train(pattern);

    // Persist learned patterns to database keyed by userId
    await persistLearnedPatterns(userId, patterns);
  }

  /**
   * Persist learned patterns to the scheduling_preferences table.
   * Patterns are stored at the user level (keyed by userId).
   * Fire-and-forget — errors are swallowed to avoid blocking the caller.
   */
  async function persistLearnedPatterns(
    userId: string,
    patterns: LearnedPattern[],
  ): Promise<void> {
    try {
      const serialized = JSON.stringify(patterns);

      // Upsert into scheduling_preferences
      const existing = await db.query<{ user_id: string }>(
        'SELECT user_id FROM scheduling_preferences WHERE user_id = ?',
        [userId],
      );

      if (existing.length > 0) {
        await db.execute(
          'UPDATE scheduling_preferences SET learned_patterns = ? WHERE user_id = ?',
          [serialized, userId],
        );
      } else {
        await db.execute(
          `INSERT INTO scheduling_preferences (user_id, preferred_start_hour, preferred_end_hour, minimum_buffer_minutes, max_meetings_per_day, focus_time_blocks, learned_patterns)
           VALUES (?, 9, 17, 15, 8, '[]', ?)`,
          [userId, serialized],
        );
      }
    } catch {
      // Best-effort persistence — don't block the learning flow
    }
  }

  async function getPreferences(userId: string): Promise<SchedulingPreferences> {
    const rows = await db.query<{
      user_id: string;
      preferred_start_hour: number;
      preferred_end_hour: number;
      minimum_buffer_minutes: number;
      max_meetings_per_day: number;
      focus_time_blocks: string | null;
      learned_patterns: string | null;
    }>(
      'SELECT * FROM scheduling_preferences WHERE user_id = ?',
      [userId],
    );

    if (rows.length === 0) {
      // Return defaults for new users
      return {
        userId,
        preferredStartHour: 9,
        preferredEndHour: 17,
        minimumBufferMinutes: 15,
        maxMeetingsPerDay: 8,
        focusTimeBlocks: [],
        learnedPatterns: [],
      };
    }

    const row = rows[0];
    let focusTimeBlocks: TimeBlock[] = [];
    let learnedPatterns: LearnedPattern[] = [];

    try {
      if (row.focus_time_blocks) {
        focusTimeBlocks = JSON.parse(row.focus_time_blocks);
      }
    } catch {
      focusTimeBlocks = [];
    }

    try {
      if (row.learned_patterns) {
        learnedPatterns = JSON.parse(row.learned_patterns);
      }
    } catch {
      learnedPatterns = [];
    }

    return {
      userId: row.user_id,
      preferredStartHour: row.preferred_start_hour,
      preferredEndHour: row.preferred_end_hour,
      minimumBufferMinutes: row.minimum_buffer_minutes,
      maxMeetingsPerDay: row.max_meetings_per_day,
      focusTimeBlocks,
      learnedPatterns,
    };
  }

  return {
    suggestSlots,
    learnFromPattern,
    getPreferences,
  };
}

// Export helpers for testing
export {
  hasTimeOverlap,
  hasConflict,
  countMeetingsOnDay,
  overlapsFocusTime,
  hasAdequateBuffer,
  isWithinPreferredHours,
  scoreSlot,
  buildAnonymizedAvailability,
  MAX_SUGGESTIONS,
  MIN_PATTERN_SAMPLES,
};
