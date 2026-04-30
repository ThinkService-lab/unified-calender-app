/**
 * PrivacyLayer service implementation.
 * Controls visibility and sharing rules for calendars and events per audience.
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 10.2
 */

import { DatabaseDriver } from '../db';
import { CalendarEvent, VisibilityLevel, Audience } from '../types';

/**
 * Optional function that checks whether the calendar owner has access to
 * the 'advanced_privacy' feature (Pro/Team tier).  When the owner does NOT
 * have access, `filterForAudience` treats all calendars as `public` —
 * effectively disabling busy-only / private filtering for Free-tier users.
 *
 * The callback receives the `calendarOwnerId` so the caller can look up
 * the owner's subscription tier via `SubscriptionManager.checkFeatureAccess`.
 */
export type AdvancedPrivacyAccessChecker = (calendarOwnerId: string) => boolean;

export interface PrivacyLayer {
  getVisibility(calendarId: string): Promise<VisibilityLevel>;
  setVisibility(calendarId: string, level: VisibilityLevel): Promise<void>;
  getEventOverride(eventId: string): Promise<VisibilityLevel | null>;
  setEventOverride(eventId: string, level: VisibilityLevel): Promise<void>;
  /** Remove a per-event visibility override, reverting to calendar-level default. */
  removeEventOverride(eventId: string): Promise<void>;
  filterForAudience(events: CalendarEvent[], audience: Audience): Promise<CalendarEvent[]>;
}

export interface PrivacyLayerConfig {
  driver: DatabaseDriver;
  /**
   * Optional checker for 'advanced_privacy' feature access (Req 10.2).
   * When provided, `filterForAudience` will verify the calendar owner has
   * Pro/Team tier before enforcing busy-only or private visibility rules.
   * When omitted or when the checker returns `true`, all visibility rules
   * are enforced normally (backward-compatible default).
   */
  checkAdvancedPrivacyAccess?: AdvancedPrivacyAccessChecker;
}

/**
 * Creates a PrivacyLayer service backed by SQLite tables.
 *
 * Accepts either a bare `DatabaseDriver` (backward-compatible) or a
 * `PrivacyLayerConfig` object with optional subscription tier gating.
 */
export function createPrivacyLayer(driverOrConfig: DatabaseDriver | PrivacyLayerConfig): PrivacyLayer {
  const driver: DatabaseDriver =
    'driver' in (driverOrConfig as PrivacyLayerConfig)
      ? (driverOrConfig as PrivacyLayerConfig).driver
      : (driverOrConfig as DatabaseDriver);
  const checkAdvancedPrivacyAccess: AdvancedPrivacyAccessChecker | undefined =
    'checkAdvancedPrivacyAccess' in (driverOrConfig as PrivacyLayerConfig)
      ? (driverOrConfig as PrivacyLayerConfig).checkAdvancedPrivacyAccess
      : undefined;
  return {
    async getVisibility(calendarId: string): Promise<VisibilityLevel> {
      const rows = await driver.query<{ visibility: string }>(
        'SELECT visibility FROM privacy_preferences WHERE calendar_id = ?',
        [calendarId]
      );
      if (rows.length === 0) {
        return 'public';
      }
      return rows[0].visibility as VisibilityLevel;
    },

    async setVisibility(calendarId: string, level: VisibilityLevel): Promise<void> {
      await driver.execute(
        `INSERT INTO privacy_preferences (calendar_id, visibility) VALUES (?, ?)
         ON CONFLICT(calendar_id) DO UPDATE SET visibility = excluded.visibility`,
        [calendarId, level]
      );
    },

    async getEventOverride(eventId: string): Promise<VisibilityLevel | null> {
      const rows = await driver.query<{ visibility: string }>(
        'SELECT visibility FROM event_visibility_overrides WHERE event_id = ?',
        [eventId]
      );
      if (rows.length === 0) {
        return null;
      }
      return rows[0].visibility as VisibilityLevel;
    },

    async setEventOverride(eventId: string, level: VisibilityLevel): Promise<void> {
      await driver.execute(
        `INSERT INTO event_visibility_overrides (event_id, visibility) VALUES (?, ?)
         ON CONFLICT(event_id) DO UPDATE SET visibility = excluded.visibility`,
        [eventId, level]
      );
    },

    async removeEventOverride(eventId: string): Promise<void> {
      await driver.execute(
        'DELETE FROM event_visibility_overrides WHERE event_id = ?',
        [eventId]
      );
    },

    async filterForAudience(events: CalendarEvent[], audience: Audience): Promise<CalendarEvent[]> {
      // Owners always see full details
      if (audience.type === 'owner') {
        return events;
      }

      if (events.length === 0) {
        return [];
      }

      // Batch-load calendar visibility preferences and event overrides
      // to avoid N+2 queries per event
      const calendarIds = [...new Set(events.map((e) => e.calendarAccountId))];
      const eventIds = events.map((e) => e.id);

      const calendarVisibilityMap = await batchLoadCalendarVisibility(driver, calendarIds);
      const eventOverrideMap = await batchLoadEventOverrides(driver, eventIds);

      // Determine whether the calendar owner(s) have advanced_privacy access (Req 10.2).
      // If the checker is not provided, default to true (all visibility rules enforced).
      // We look up the owner via the calendar_accounts table for each distinct calendar.
      let perCalendarAccess: Map<string, boolean> | undefined;
      if (checkAdvancedPrivacyAccess) {
        const ownerIds = await batchLoadCalendarOwners(driver, calendarIds);
        // If ANY calendar owner lacks advanced_privacy, we degrade to public for
        // their calendars. Build a per-calendar access map.
        perCalendarAccess = new Map<string, boolean>();
        for (const calendarId of calendarIds) {
          const ownerId = ownerIds.get(calendarId);
          if (ownerId) {
            perCalendarAccess.set(calendarId, checkAdvancedPrivacyAccess(ownerId));
          } else {
            // Unknown owner — default to enforcing rules (safe default)
            perCalendarAccess.set(calendarId, true);
          }
        }
      }

      const result: CalendarEvent[] = [];

      for (const event of events) {
        // Determine effective visibility: event override takes precedence over calendar-level
        const eventOverride = eventOverrideMap.get(event.id) ?? null;
        const calendarVisibility = calendarVisibilityMap.get(event.calendarAccountId) ?? 'public';
        let effectiveVisibility: VisibilityLevel = eventOverride ?? calendarVisibility;

        // If the calendar owner doesn't have advanced_privacy, treat as public (Req 10.2).
        // This means Free-tier users cannot enforce busy-only or private visibility
        // on their calendars for shared/delegated audiences.
        if (perCalendarAccess) {
          const hasAccess = perCalendarAccess.get(event.calendarAccountId) ?? true;
          if (!hasAccess) {
            effectiveVisibility = 'public';
          }
        }

        switch (effectiveVisibility) {
          case 'private':
            // Private: return zero events for non-owner audiences
            break;

          case 'busy-only':
            // Busy-only: strip title, description, attendees — return time blocks only
            result.push({
              ...event,
              title: 'Busy',
              description: null,
              attendees: [],
              location: null,
              organizer: null,
            });
            break;

          case 'public':
            // Public: return full event details
            result.push(event);
            break;
        }
      }

      return result;
    },
  };
}

/**
 * Batch-loads calendar visibility preferences for a set of calendar IDs.
 * Returns a map of calendarId → VisibilityLevel. Missing entries default to 'public'.
 */
async function batchLoadCalendarVisibility(
  driver: DatabaseDriver,
  calendarIds: string[]
): Promise<Map<string, VisibilityLevel>> {
  const map = new Map<string, VisibilityLevel>();
  if (calendarIds.length === 0) return map;

  const placeholders = calendarIds.map(() => '?').join(',');
  const rows = await driver.query<{ calendar_id: string; visibility: string }>(
    `SELECT calendar_id, visibility FROM privacy_preferences WHERE calendar_id IN (${placeholders})`,
    calendarIds
  );

  for (const row of rows) {
    map.set(row.calendar_id, row.visibility as VisibilityLevel);
  }
  return map;
}

/**
 * Batch-loads event visibility overrides for a set of event IDs.
 * Returns a map of eventId → VisibilityLevel. Missing entries mean no override.
 */
async function batchLoadEventOverrides(
  driver: DatabaseDriver,
  eventIds: string[]
): Promise<Map<string, VisibilityLevel>> {
  const map = new Map<string, VisibilityLevel>();
  if (eventIds.length === 0) return map;

  const placeholders = eventIds.map(() => '?').join(',');
  const rows = await driver.query<{ event_id: string; visibility: string }>(
    `SELECT event_id, visibility FROM event_visibility_overrides WHERE event_id IN (${placeholders})`,
    eventIds
  );

  for (const row of rows) {
    map.set(row.event_id, row.visibility as VisibilityLevel);
  }
  return map;
}

/**
 * Batch-loads calendar owner user IDs for a set of calendar IDs.
 * Returns a map of calendarId → userId (the owner).
 */
async function batchLoadCalendarOwners(
  driver: DatabaseDriver,
  calendarIds: string[]
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (calendarIds.length === 0) return map;

  const placeholders = calendarIds.map(() => '?').join(',');
  const rows = await driver.query<{ id: string; user_id: string }>(
    `SELECT id, user_id FROM calendar_accounts WHERE id IN (${placeholders})`,
    calendarIds
  );

  for (const row of rows) {
    map.set(row.id, row.user_id);
  }
  return map;
}
