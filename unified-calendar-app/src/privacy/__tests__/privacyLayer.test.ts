/**
 * Unit tests for PrivacyLayer service.
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 10.2
 */

import { createPrivacyLayer, PrivacyLayer } from '../privacyLayer';
import { DatabaseDriver } from '../../db';
import { CalendarEvent, VisibilityLevel, Audience } from '../../types';

/** In-memory mock database driver for testing */
function createMockDriver(calendarOwners?: Record<string, string>): DatabaseDriver {
  const tables: Record<string, Record<string, Record<string, unknown>>> = {
    privacy_preferences: {},
    event_visibility_overrides: {},
  };

  // Default calendar owners: cal-1 → user-1, etc.
  const owners = calendarOwners ?? {};

  return {
    async execute(sql: string, params?: unknown[]): Promise<void> {
      const insertPrivacy = sql.match(/INSERT INTO privacy_preferences/i);
      const insertOverride = sql.match(/INSERT INTO event_visibility_overrides/i);
      const deleteOverride = sql.match(/DELETE FROM event_visibility_overrides/i);

      if (insertPrivacy && params) {
        const [calendarId, visibility] = params as string[];
        tables.privacy_preferences[calendarId] = { calendar_id: calendarId, visibility };
      } else if (deleteOverride && params) {
        const [eventId] = params as string[];
        delete tables.event_visibility_overrides[eventId];
      } else if (insertOverride && params) {
        const [eventId, visibility] = params as string[];
        tables.event_visibility_overrides[eventId] = { event_id: eventId, visibility };
      }
    },

    async query<T>(sql: string, params?: unknown[]): Promise<T[]> {
      // Batch query: SELECT ... FROM calendar_accounts WHERE id IN (?, ?, ...)
      if (sql.match(/FROM calendar_accounts.*IN/i) && params) {
        const results: T[] = [];
        for (const calendarId of params as string[]) {
          const userId = owners[calendarId];
          if (userId) {
            results.push({ id: calendarId, user_id: userId } as T);
          }
        }
        return results;
      }

      // Batch query: SELECT ... WHERE calendar_id IN (?, ?, ...)
      if (sql.match(/FROM privacy_preferences.*IN/i) && params) {
        const results: T[] = [];
        for (const calendarId of params as string[]) {
          const row = tables.privacy_preferences[calendarId];
          if (row) {
            results.push({ calendar_id: row.calendar_id, visibility: row.visibility } as T);
          }
        }
        return results;
      }

      // Batch query: SELECT ... WHERE event_id IN (?, ?, ...)
      if (sql.match(/FROM event_visibility_overrides.*IN/i) && params) {
        const results: T[] = [];
        for (const eventId of params as string[]) {
          const row = tables.event_visibility_overrides[eventId];
          if (row) {
            results.push({ event_id: row.event_id, visibility: row.visibility } as T);
          }
        }
        return results;
      }

      // Single-row query for privacy_preferences
      if (sql.match(/FROM privacy_preferences/i) && params) {
        const calendarId = params[0] as string;
        const row = tables.privacy_preferences[calendarId];
        if (row) {
          return [{ visibility: row.visibility }] as T[];
        }
        return [] as T[];
      }

      // Single-row query for event_visibility_overrides
      if (sql.match(/FROM event_visibility_overrides/i) && params) {
        const eventId = params[0] as string;
        const row = tables.event_visibility_overrides[eventId];
        if (row) {
          return [{ visibility: row.visibility }] as T[];
        }
        return [] as T[];
      }

      return [] as T[];
    },

    async close(): Promise<void> {},
    isOpen(): boolean { return true; },
  };
}

function makeEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'event-1',
    providerEventId: 'provider-event-1',
    calendarAccountId: 'cal-1',
    title: 'Team Meeting',
    description: 'Weekly sync',
    location: 'Room 42',
    startTime: new Date('2025-01-15T10:00:00Z'),
    endTime: new Date('2025-01-15T11:00:00Z'),
    timeZone: 'UTC',
    isAllDay: false,
    recurrenceRule: null,
    recurrenceExceptionDate: null,
    parentRecurringEventId: null,
    organizer: { email: 'org@example.com', displayName: 'Organizer', sentBy: null },
    attendees: [
      { email: 'a@example.com', displayName: 'Alice', status: 'accepted', role: 'required' },
    ],
    sequence: 0,
    dtstamp: new Date('2025-01-15T09:00:00Z'),
    status: 'confirmed',
    visibility: null,
    opaqueFields: new Map(),
    syncStatus: 'synced',
    localVersion: 1,
    remoteEtag: null,
    modifiedBy: null,
    createdAt: new Date('2025-01-01T00:00:00Z'),
    updatedAt: new Date('2025-01-15T09:00:00Z'),
    ...overrides,
  };
}

describe('PrivacyLayer', () => {
  let driver: DatabaseDriver;
  let privacyLayer: PrivacyLayer;

  beforeEach(() => {
    driver = createMockDriver();
    privacyLayer = createPrivacyLayer(driver);
  });

  describe('getVisibility / setVisibility', () => {
    it('returns "public" by default when no preference is set', async () => {
      const visibility = await privacyLayer.getVisibility('cal-1');
      expect(visibility).toBe('public');
    });

    it('returns the set visibility level', async () => {
      await privacyLayer.setVisibility('cal-1', 'private');
      const visibility = await privacyLayer.getVisibility('cal-1');
      expect(visibility).toBe('private');
    });

    it('updates visibility when called again', async () => {
      await privacyLayer.setVisibility('cal-1', 'private');
      await privacyLayer.setVisibility('cal-1', 'busy-only');
      const visibility = await privacyLayer.getVisibility('cal-1');
      expect(visibility).toBe('busy-only');
    });
  });

  describe('getEventOverride / setEventOverride / removeEventOverride', () => {
    it('returns null when no override is set', async () => {
      const override = await privacyLayer.getEventOverride('event-1');
      expect(override).toBeNull();
    });

    it('returns the set override level', async () => {
      await privacyLayer.setEventOverride('event-1', 'busy-only');
      const override = await privacyLayer.getEventOverride('event-1');
      expect(override).toBe('busy-only');
    });

    it('updates override when called again', async () => {
      await privacyLayer.setEventOverride('event-1', 'busy-only');
      await privacyLayer.setEventOverride('event-1', 'public');
      const override = await privacyLayer.getEventOverride('event-1');
      expect(override).toBe('public');
    });

    it('removeEventOverride reverts to null (calendar default)', async () => {
      await privacyLayer.setEventOverride('event-1', 'private');
      expect(await privacyLayer.getEventOverride('event-1')).toBe('private');

      await privacyLayer.removeEventOverride('event-1');
      expect(await privacyLayer.getEventOverride('event-1')).toBeNull();
    });

    it('removeEventOverride on non-existent override is a no-op', async () => {
      // Should not throw
      await privacyLayer.removeEventOverride('nonexistent');
      expect(await privacyLayer.getEventOverride('nonexistent')).toBeNull();
    });

    it('removed override causes filterForAudience to use calendar-level visibility', async () => {
      await privacyLayer.setVisibility('cal-1', 'public');
      await privacyLayer.setEventOverride('event-1', 'private');

      const sharedAudience: Audience = {
        type: 'shared-view-member',
        userId: 'user-2',
        permissionLevel: 'read-only',
      };

      // With override: private → hidden
      let filtered = await privacyLayer.filterForAudience([makeEvent()], sharedAudience);
      expect(filtered).toHaveLength(0);

      // Remove override → falls back to calendar-level public
      await privacyLayer.removeEventOverride('event-1');
      filtered = await privacyLayer.filterForAudience([makeEvent()], sharedAudience);
      expect(filtered).toHaveLength(1);
      expect(filtered[0].title).toBe('Team Meeting');
    });
  });

  describe('filterForAudience', () => {
    const ownerAudience: Audience = {
      type: 'owner',
      userId: 'user-1',
      permissionLevel: 'read-write',
    };

    const sharedViewAudience: Audience = {
      type: 'shared-view-member',
      userId: 'user-2',
      permissionLevel: 'read-only',
    };

    const delegateAudience: Audience = {
      type: 'delegate',
      userId: 'user-3',
      permissionLevel: 'read-write',
    };

    it('returns all events with full details for owner audience', async () => {
      await privacyLayer.setVisibility('cal-1', 'private');
      const events = [makeEvent()];
      const filtered = await privacyLayer.filterForAudience(events, ownerAudience);
      expect(filtered).toHaveLength(1);
      expect(filtered[0].title).toBe('Team Meeting');
      expect(filtered[0].description).toBe('Weekly sync');
      expect(filtered[0].attendees).toHaveLength(1);
    });

    it('returns zero events for private calendars with non-owner audience', async () => {
      await privacyLayer.setVisibility('cal-1', 'private');
      const events = [makeEvent()];
      const filtered = await privacyLayer.filterForAudience(events, sharedViewAudience);
      expect(filtered).toHaveLength(0);
    });

    it('strips title, description, attendees, location, organizer for busy-only calendars', async () => {
      await privacyLayer.setVisibility('cal-1', 'busy-only');
      const events = [makeEvent()];
      const filtered = await privacyLayer.filterForAudience(events, sharedViewAudience);
      expect(filtered).toHaveLength(1);
      expect(filtered[0].title).toBe('Busy');
      expect(filtered[0].description).toBeNull();
      expect(filtered[0].attendees).toEqual([]);
      expect(filtered[0].location).toBeNull();
      expect(filtered[0].organizer).toBeNull();
      // Time blocks are preserved
      expect(filtered[0].startTime).toEqual(new Date('2025-01-15T10:00:00Z'));
      expect(filtered[0].endTime).toEqual(new Date('2025-01-15T11:00:00Z'));
    });

    it('returns full event details for public calendars', async () => {
      await privacyLayer.setVisibility('cal-1', 'public');
      const events = [makeEvent()];
      const filtered = await privacyLayer.filterForAudience(events, sharedViewAudience);
      expect(filtered).toHaveLength(1);
      expect(filtered[0].title).toBe('Team Meeting');
      expect(filtered[0].description).toBe('Weekly sync');
      expect(filtered[0].attendees).toHaveLength(1);
    });

    it('defaults to public when no privacy preference is set', async () => {
      const events = [makeEvent()];
      const filtered = await privacyLayer.filterForAudience(events, delegateAudience);
      expect(filtered).toHaveLength(1);
      expect(filtered[0].title).toBe('Team Meeting');
    });

    it('event-level override takes precedence over calendar-level visibility', async () => {
      // Calendar is public, but event is overridden to private
      await privacyLayer.setVisibility('cal-1', 'public');
      await privacyLayer.setEventOverride('event-1', 'private');
      const events = [makeEvent()];
      const filtered = await privacyLayer.filterForAudience(events, sharedViewAudience);
      expect(filtered).toHaveLength(0);
    });

    it('event override to public overrides calendar-level private', async () => {
      await privacyLayer.setVisibility('cal-1', 'private');
      await privacyLayer.setEventOverride('event-1', 'public');
      const events = [makeEvent()];
      const filtered = await privacyLayer.filterForAudience(events, sharedViewAudience);
      expect(filtered).toHaveLength(1);
      expect(filtered[0].title).toBe('Team Meeting');
    });

    it('event override to busy-only overrides calendar-level public', async () => {
      await privacyLayer.setVisibility('cal-1', 'public');
      await privacyLayer.setEventOverride('event-1', 'busy-only');
      const events = [makeEvent()];
      const filtered = await privacyLayer.filterForAudience(events, delegateAudience);
      expect(filtered).toHaveLength(1);
      expect(filtered[0].title).toBe('Busy');
      expect(filtered[0].description).toBeNull();
    });

    it('handles mixed visibility across multiple events', async () => {
      await privacyLayer.setVisibility('cal-1', 'public');
      await privacyLayer.setVisibility('cal-2', 'private');
      await privacyLayer.setVisibility('cal-3', 'busy-only');

      const events = [
        makeEvent({ id: 'e1', calendarAccountId: 'cal-1', title: 'Public Event' }),
        makeEvent({ id: 'e2', calendarAccountId: 'cal-2', title: 'Private Event' }),
        makeEvent({ id: 'e3', calendarAccountId: 'cal-3', title: 'Busy Event' }),
      ];

      const filtered = await privacyLayer.filterForAudience(events, sharedViewAudience);
      expect(filtered).toHaveLength(2);
      expect(filtered[0].title).toBe('Public Event');
      expect(filtered[1].title).toBe('Busy');
    });

    it('applies event override independently per event', async () => {
      await privacyLayer.setVisibility('cal-1', 'private');
      await privacyLayer.setEventOverride('e1', 'public');
      // e2 has no override, inherits calendar-level private

      const events = [
        makeEvent({ id: 'e1', calendarAccountId: 'cal-1', title: 'Visible' }),
        makeEvent({ id: 'e2', calendarAccountId: 'cal-1', title: 'Hidden' }),
      ];

      const filtered = await privacyLayer.filterForAudience(events, sharedViewAudience);
      expect(filtered).toHaveLength(1);
      expect(filtered[0].title).toBe('Visible');
    });

    it('returns empty array for empty events input', async () => {
      const filtered = await privacyLayer.filterForAudience([], sharedViewAudience);
      expect(filtered).toEqual([]);
    });
  });

  describe('subscription tier gating (Req 10.2)', () => {
    const sharedViewAudience: Audience = {
      type: 'shared-view-member',
      userId: 'user-2',
      permissionLevel: 'read-only',
    };

    const delegateAudience: Audience = {
      type: 'delegate',
      userId: 'user-3',
      permissionLevel: 'read-write',
    };

    it('degrades private to public when owner lacks advanced_privacy', async () => {
      const driverWithOwners = createMockDriver({ 'cal-1': 'owner-free' });
      const layer = createPrivacyLayer({
        driver: driverWithOwners,
        checkAdvancedPrivacyAccess: (_ownerId) => false, // Free tier
      });

      await layer.setVisibility('cal-1', 'private');
      const events = [makeEvent()];
      const filtered = await layer.filterForAudience(events, sharedViewAudience);

      // Private should be degraded to public — events visible with full details
      expect(filtered).toHaveLength(1);
      expect(filtered[0].title).toBe('Team Meeting');
      expect(filtered[0].description).toBe('Weekly sync');
    });

    it('degrades busy-only to public when owner lacks advanced_privacy', async () => {
      const driverWithOwners = createMockDriver({ 'cal-1': 'owner-free' });
      const layer = createPrivacyLayer({
        driver: driverWithOwners,
        checkAdvancedPrivacyAccess: (_ownerId) => false,
      });

      await layer.setVisibility('cal-1', 'busy-only');
      const events = [makeEvent()];
      const filtered = await layer.filterForAudience(events, delegateAudience);

      // Busy-only should be degraded to public — full details visible
      expect(filtered).toHaveLength(1);
      expect(filtered[0].title).toBe('Team Meeting');
      expect(filtered[0].attendees).toHaveLength(1);
    });

    it('enforces private visibility when owner has advanced_privacy', async () => {
      const driverWithOwners = createMockDriver({ 'cal-1': 'owner-pro' });
      const layer = createPrivacyLayer({
        driver: driverWithOwners,
        checkAdvancedPrivacyAccess: (_ownerId) => true, // Pro tier
      });

      await layer.setVisibility('cal-1', 'private');
      const events = [makeEvent()];
      const filtered = await layer.filterForAudience(events, sharedViewAudience);

      expect(filtered).toHaveLength(0);
    });

    it('enforces busy-only visibility when owner has advanced_privacy', async () => {
      const driverWithOwners = createMockDriver({ 'cal-1': 'owner-pro' });
      const layer = createPrivacyLayer({
        driver: driverWithOwners,
        checkAdvancedPrivacyAccess: (_ownerId) => true,
      });

      await layer.setVisibility('cal-1', 'busy-only');
      const events = [makeEvent()];
      const filtered = await layer.filterForAudience(events, sharedViewAudience);

      expect(filtered).toHaveLength(1);
      expect(filtered[0].title).toBe('Busy');
      expect(filtered[0].description).toBeNull();
    });

    it('ignores event overrides when owner lacks advanced_privacy', async () => {
      const driverWithOwners = createMockDriver({ 'cal-1': 'owner-free' });
      const layer = createPrivacyLayer({
        driver: driverWithOwners,
        checkAdvancedPrivacyAccess: (_ownerId) => false,
      });

      await layer.setVisibility('cal-1', 'public');
      await layer.setEventOverride('event-1', 'private');
      const events = [makeEvent()];
      const filtered = await layer.filterForAudience(events, sharedViewAudience);

      // Event override to private should be ignored — degraded to public
      expect(filtered).toHaveLength(1);
      expect(filtered[0].title).toBe('Team Meeting');
    });

    it('handles mixed tiers across calendars', async () => {
      const driverWithOwners = createMockDriver({
        'cal-pro': 'owner-pro',
        'cal-free': 'owner-free',
      });
      const layer = createPrivacyLayer({
        driver: driverWithOwners,
        checkAdvancedPrivacyAccess: (ownerId) => ownerId === 'owner-pro',
      });

      await layer.setVisibility('cal-pro', 'private');
      await layer.setVisibility('cal-free', 'private');

      const events = [
        makeEvent({ id: 'e1', calendarAccountId: 'cal-pro', title: 'Pro Private' }),
        makeEvent({ id: 'e2', calendarAccountId: 'cal-free', title: 'Free Private' }),
      ];

      const filtered = await layer.filterForAudience(events, sharedViewAudience);

      // Pro owner's private calendar: hidden (0 events)
      // Free owner's private calendar: degraded to public (visible)
      expect(filtered).toHaveLength(1);
      expect(filtered[0].title).toBe('Free Private');
    });

    it('owner audience bypasses tier check entirely', async () => {
      const driverWithOwners = createMockDriver({ 'cal-1': 'owner-free' });
      const layer = createPrivacyLayer({
        driver: driverWithOwners,
        checkAdvancedPrivacyAccess: (_ownerId) => false,
      });

      await layer.setVisibility('cal-1', 'private');
      const ownerAudience: Audience = {
        type: 'owner',
        userId: 'owner-free',
        permissionLevel: 'read-write',
      };

      const events = [makeEvent()];
      const filtered = await layer.filterForAudience(events, ownerAudience);

      // Owner always sees everything regardless of tier
      expect(filtered).toHaveLength(1);
      expect(filtered[0].title).toBe('Team Meeting');
    });

    it('backward-compatible: no checker means all visibility rules enforced', async () => {
      // Using the bare driver (no config object) — backward-compatible path
      const bareDriver = createMockDriver();
      const layer = createPrivacyLayer(bareDriver);

      await layer.setVisibility('cal-1', 'private');
      const events = [makeEvent()];
      const filtered = await layer.filterForAudience(events, sharedViewAudience);

      // Without a checker, private is enforced as before
      expect(filtered).toHaveLength(0);
    });
  });
});
