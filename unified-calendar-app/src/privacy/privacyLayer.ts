/**
 * PrivacyLayer service implementation.
 * Controls visibility and sharing rules for calendars and events per audience.
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5
 */

import { DatabaseDriver } from '../db';
import { CalendarEvent, VisibilityLevel, Audience } from '../types';

export interface PrivacyLayer {
  getVisibility(calendarId: string): Promise<VisibilityLevel>;
  setVisibility(calendarId: string, level: VisibilityLevel): Promise<void>;
  getEventOverride(eventId: string): Promise<VisibilityLevel | null>;
  setEventOverride(eventId: string, level: VisibilityLevel): Promise<void>;
  /** Remove a per-event visibility override, reverting to calendar-level default. */
  removeEventOverride(eventId: string): Promise<void>;
  filterForAudience(events: CalendarEvent[], audience: Audience): Promise<CalendarEvent[]>;
}

/**
 * Creates a PrivacyLayer service backed by SQLite tables.
 */
export function createPrivacyLayer(driver: DatabaseDriver): PrivacyLayer {
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
      // to avoid N+2 queries per event (Gap #1 fix)
      const calendarIds = [...new Set(events.map((e) => e.calendarAccountId))];
      const eventIds = events.map((e) => e.id);

      const calendarVisibilityMap = await batchLoadCalendarVisibility(driver, calendarIds);
      const eventOverrideMap = await batchLoadEventOverrides(driver, eventIds);

      const result: CalendarEvent[] = [];

      for (const event of events) {
        // Determine effective visibility: event override takes precedence over calendar-level
        const eventOverride = eventOverrideMap.get(event.id) ?? null;
        const calendarVisibility = calendarVisibilityMap.get(event.calendarAccountId) ?? 'public';
        const effectiveVisibility = eventOverride ?? calendarVisibility;

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
