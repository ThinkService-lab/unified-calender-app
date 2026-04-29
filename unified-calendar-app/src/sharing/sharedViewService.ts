/**
 * SharedViewService — manages shared calendar views for Team tier users.
 *
 * - Create shared views with designated members
 * - Enforce 20-member limit per shared view
 * - Apply privacy layer visibility rules for shared view members
 *
 * Requirements: 14.1, 14.6
 */

import type { DatabaseDriver } from '../db/database';
import type { PrivacyLayer } from '../privacy/privacyLayer';
import type {
  SharedCalendarView,
  SharedViewMember,
  CalendarEvent,
  Audience,
} from '../types';

/** Maximum members per shared view on Team tier */
export const MAX_SHARED_VIEW_MEMBERS = 20;

export interface SharedViewResult {
  success: boolean;
  viewId?: string;
  error?: string;
}

export interface SharedViewService {
  createSharedView(
    ownerId: string,
    name: string,
    calendarIds: string[],
  ): Promise<SharedViewResult>;

  addMember(
    viewId: string,
    member: { userId: string; permission: 'read-only' | 'read-write' },
  ): Promise<SharedViewResult>;

  removeMember(viewId: string, userId: string): Promise<SharedViewResult>;

  getSharedView(viewId: string): Promise<SharedCalendarView | null>;

  getSharedViewsForOwner(ownerId: string): Promise<SharedCalendarView[]>;

  getEventsForMember(
    viewId: string,
    memberId: string,
  ): Promise<CalendarEvent[]>;
}

function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export interface SharedViewServiceConfig {
  db: DatabaseDriver;
  privacyLayer: PrivacyLayer;
  /** Check if user has Team tier access */
  checkTeamAccess: (userId: string) => boolean;
}

/**
 * Creates a SharedViewService instance.
 */
export function createSharedViewService(
  config: SharedViewServiceConfig,
): SharedViewService {
  const { db, privacyLayer, checkTeamAccess } = config;

  async function createSharedView(
    ownerId: string,
    name: string,
    calendarIds: string[],
  ): Promise<SharedViewResult> {
    if (!checkTeamAccess(ownerId)) {
      return {
        success: false,
        error: 'Shared views require a Team tier subscription',
      };
    }

    const viewId = generateUUID();
    const now = Date.now();

    try {
      await db.execute(
        `INSERT INTO shared_views (id, owner_id, name, calendar_ids, max_members, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [viewId, ownerId, name, JSON.stringify(calendarIds), MAX_SHARED_VIEW_MEMBERS, now],
      );

      return { success: true, viewId };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return { success: false, error: message };
    }
  }

  async function addMember(
    viewId: string,
    member: { userId: string; permission: 'read-only' | 'read-write' },
  ): Promise<SharedViewResult> {
    try {
      // Verify view exists and get owner
      const viewRows = await db.query<{ id: string; owner_id: string }>(
        'SELECT id, owner_id FROM shared_views WHERE id = ?',
        [viewId],
      );
      if (viewRows.length === 0) {
        return { success: false, error: `Shared view ${viewId} not found` };
      }

      // Re-validate that the owner still has Team tier access (Req 14.1)
      const ownerId = viewRows[0].owner_id;
      if (!checkTeamAccess(ownerId)) {
        return {
          success: false,
          error: 'Shared views require a Team tier subscription',
        };
      }

      // Get current member count
      const countRows = await db.query<{ cnt: number }>(
        'SELECT COUNT(*) as cnt FROM shared_view_members WHERE view_id = ?',
        [viewId],
      );
      const currentCount = countRows.length > 0 ? countRows[0].cnt : 0;

      if (currentCount >= MAX_SHARED_VIEW_MEMBERS) {
        return {
          success: false,
          error: `Shared view member limit reached (maximum ${MAX_SHARED_VIEW_MEMBERS})`,
        };
      }

      const now = Date.now();
      await db.execute(
        `INSERT INTO shared_view_members (view_id, user_id, permission, added_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(view_id, user_id) DO UPDATE SET permission = excluded.permission`,
        [viewId, member.userId, member.permission, now],
      );

      return { success: true, viewId };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return { success: false, error: message };
    }
  }

  async function removeMember(
    viewId: string,
    userId: string,
  ): Promise<SharedViewResult> {
    try {
      await db.execute(
        'DELETE FROM shared_view_members WHERE view_id = ? AND user_id = ?',
        [viewId, userId],
      );
      return { success: true, viewId };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return { success: false, error: message };
    }
  }

  async function getSharedView(
    viewId: string,
  ): Promise<SharedCalendarView | null> {
    const rows = await db.query<{
      id: string;
      owner_id: string;
      name: string;
      calendar_ids: string;
      max_members: number;
      created_at: number;
    }>('SELECT * FROM shared_views WHERE id = ?', [viewId]);

    if (rows.length === 0) return null;

    const row = rows[0];
    const memberRows = await db.query<{
      user_id: string;
      permission: string;
      added_at: number;
    }>('SELECT * FROM shared_view_members WHERE view_id = ?', [viewId]);

    return {
      id: row.id,
      ownerId: row.owner_id,
      name: row.name,
      calendarIds: JSON.parse(row.calendar_ids),
      members: memberRows.map((m) => ({
        userId: m.user_id,
        permission: m.permission as 'read-only' | 'read-write',
        addedAt: new Date(m.added_at),
      })),
      maxMembers: row.max_members,
      createdAt: new Date(row.created_at),
    };
  }

  async function getSharedViewsForOwner(
    ownerId: string,
  ): Promise<SharedCalendarView[]> {
    const rows = await db.query<{
      id: string;
      owner_id: string;
      name: string;
      calendar_ids: string;
      max_members: number;
      created_at: number;
    }>('SELECT * FROM shared_views WHERE owner_id = ?', [ownerId]);

    const views: SharedCalendarView[] = [];
    for (const row of rows) {
      const memberRows = await db.query<{
        user_id: string;
        permission: string;
        added_at: number;
      }>('SELECT * FROM shared_view_members WHERE view_id = ?', [row.id]);

      views.push({
        id: row.id,
        ownerId: row.owner_id,
        name: row.name,
        calendarIds: JSON.parse(row.calendar_ids),
        members: memberRows.map((m) => ({
          userId: m.user_id,
          permission: m.permission as 'read-only' | 'read-write',
          addedAt: new Date(m.added_at),
        })),
        maxMembers: row.max_members,
        createdAt: new Date(row.created_at),
      });
    }

    return views;
  }

  async function getEventsForMember(
    viewId: string,
    memberId: string,
  ): Promise<CalendarEvent[]> {
    const view = await getSharedView(viewId);
    if (!view) return [];

    // Check if user is a member
    const member = view.members.find((m) => m.userId === memberId);
    if (!member) return [];

    // Load events from all calendars in the shared view
    if (view.calendarIds.length === 0) return [];

    const placeholders = view.calendarIds.map(() => '?').join(',');
    const rows = await db.query<Record<string, unknown>>(
      `SELECT * FROM events WHERE calendar_account_id IN (${placeholders})`,
      view.calendarIds,
    );

    const events: CalendarEvent[] = rows.map(mapRowToEvent);

    // Apply privacy layer filtering for the member's audience
    const audience: Audience = {
      type: 'shared-view-member',
      userId: memberId,
      permissionLevel: member.permission,
    };

    return privacyLayer.filterForAudience(events, audience);
  }

  return {
    createSharedView,
    addMember,
    removeMember,
    getSharedView,
    getSharedViewsForOwner,
    getEventsForMember,
  };
}

/** Maps a raw database row to a CalendarEvent object. */
function mapRowToEvent(row: Record<string, unknown>): CalendarEvent {
  return {
    id: row.id as string,
    providerEventId: (row.provider_event_id as string) ?? '',
    calendarAccountId: row.calendar_account_id as string,
    title: row.title as string,
    description: (row.description as string) ?? null,
    location: (row.location as string) ?? null,
    startTime: new Date(row.start_time as number),
    endTime: new Date(row.end_time as number),
    timeZone: (row.time_zone as string) ?? 'UTC',
    isAllDay: (row.is_all_day as number) === 1,
    recurrenceRule: row.recurrence_rule
      ? JSON.parse(row.recurrence_rule as string)
      : null,
    recurrenceExceptionDate: row.recurrence_exception_date
      ? new Date(row.recurrence_exception_date as number)
      : null,
    parentRecurringEventId:
      (row.parent_recurring_event_id as string) ?? null,
    organizer: row.organizer
      ? JSON.parse(row.organizer as string)
      : null,
    attendees: row.attendees
      ? JSON.parse(row.attendees as string)
      : [],
    sequence: (row.sequence as number) ?? 0,
    dtstamp: new Date(row.dtstamp as number),
    status:
      (row.status as CalendarEvent['status']) ?? 'confirmed',
    visibility:
      (row.visibility_override as CalendarEvent['visibility']) ?? null,
    opaqueFields: row.opaque_fields
      ? new Map(Object.entries(JSON.parse(row.opaque_fields as string)))
      : new Map(),
    syncStatus:
      (row.sync_status as CalendarEvent['syncStatus']) ?? 'synced',
    localVersion: (row.local_version as number) ?? 1,
    remoteEtag: (row.remote_etag as string) ?? null,
    modifiedBy: (row.modified_by as string) ?? null,
    createdAt: new Date(row.created_at as number),
    updatedAt: new Date(row.updated_at as number),
  };
}
