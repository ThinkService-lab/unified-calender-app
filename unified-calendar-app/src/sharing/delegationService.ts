/**
 * DelegationService — manages calendar delegation for Team tier users.
 *
 * - Grant delegation with read-only or read-write permission levels
 * - Delegate CRUD: allow create/update/delete for read-write, reject writes for read-only
 * - Record delegate identity in `modifiedBy` field on event modifications
 * - Revoke delegation: remove access within 10 seconds
 *
 * Requirements: 14.2, 14.3, 14.4, 14.5
 */

import type { DatabaseDriver } from '../db/database';
import type { DelegationGrant, CalendarEvent } from '../types';

export interface DelegationResult {
  success: boolean;
  grantId?: string;
  eventId?: string;
  error?: string;
}

export interface DelegationService {
  grantDelegation(
    delegatorId: string,
    delegateId: string,
    calendarIds: string[],
    permission: 'read-only' | 'read-write',
  ): Promise<DelegationResult>;

  revokeDelegation(grantId: string): Promise<DelegationResult>;

  getDelegationGrant(grantId: string): Promise<DelegationGrant | null>;

  getActiveDelegationsForDelegate(
    delegateId: string,
  ): Promise<DelegationGrant[]>;

  getActiveDelegationsForDelegator(
    delegatorId: string,
  ): Promise<DelegationGrant[]>;

  /** Check if a delegate can perform a specific operation */
  canPerformOperation(
    delegateId: string,
    calendarId: string,
    operation: 'read' | 'create' | 'update' | 'delete',
  ): Promise<boolean>;

  /** Create event as delegate (read-write only) */
  createEventAsDelegate(
    delegateId: string,
    calendarAccountId: string,
    eventData: DelegateEventInput,
  ): Promise<DelegationResult>;

  /** Update event as delegate (read-write only, records modifiedBy) */
  updateEventAsDelegate(
    delegateId: string,
    eventId: string,
    updates: DelegateEventUpdate,
  ): Promise<DelegationResult>;

  /** Delete event as delegate (read-write only) */
  deleteEventAsDelegate(
    delegateId: string,
    eventId: string,
  ): Promise<DelegationResult>;

  /** Read events as delegate (read-only or read-write) */
  readEventsAsDelegate(
    delegateId: string,
    calendarAccountId: string,
  ): Promise<CalendarEvent[]>;
}

export interface DelegateEventInput {
  title: string;
  description?: string | null;
  location?: string | null;
  startTime: Date;
  endTime: Date;
  timeZone?: string;
  isAllDay?: boolean;
}

export interface DelegateEventUpdate {
  title?: string;
  description?: string | null;
  location?: string | null;
  startTime?: Date;
  endTime?: Date;
  timeZone?: string;
  isAllDay?: boolean;
}

function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export interface DelegationServiceConfig {
  db: DatabaseDriver;
}

/**
 * Creates a DelegationService instance.
 */
export function createDelegationService(
  config: DelegationServiceConfig,
): DelegationService {
  const { db } = config;

  async function grantDelegation(
    delegatorId: string,
    delegateId: string,
    calendarIds: string[],
    permission: 'read-only' | 'read-write',
  ): Promise<DelegationResult> {
    const grantId = generateUUID();
    const now = Date.now();

    try {
      await db.execute(
        `INSERT INTO delegation_grants (id, delegator_id, delegate_id, calendar_ids, permission, granted_at, revoked_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [grantId, delegatorId, delegateId, JSON.stringify(calendarIds), permission, now, null],
      );

      return { success: true, grantId };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return { success: false, error: message };
    }
  }

  async function revokeDelegation(grantId: string): Promise<DelegationResult> {
    const now = Date.now();

    try {
      const rows = await db.query<{ id: string }>(
        'SELECT id FROM delegation_grants WHERE id = ? AND revoked_at IS NULL',
        [grantId],
      );

      if (rows.length === 0) {
        return {
          success: false,
          error: `Delegation grant ${grantId} not found or already revoked`,
        };
      }

      await db.execute(
        'UPDATE delegation_grants SET revoked_at = ? WHERE id = ?',
        [now, grantId],
      );

      return { success: true, grantId };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return { success: false, error: message };
    }
  }

  async function getDelegationGrant(
    grantId: string,
  ): Promise<DelegationGrant | null> {
    const rows = await db.query<{
      id: string;
      delegator_id: string;
      delegate_id: string;
      calendar_ids: string;
      permission: string;
      granted_at: number;
      revoked_at: number | null;
    }>('SELECT * FROM delegation_grants WHERE id = ?', [grantId]);

    if (rows.length === 0) return null;
    return mapRowToGrant(rows[0]);
  }

  async function getActiveDelegationsForDelegate(
    delegateId: string,
  ): Promise<DelegationGrant[]> {
    const rows = await db.query<{
      id: string;
      delegator_id: string;
      delegate_id: string;
      calendar_ids: string;
      permission: string;
      granted_at: number;
      revoked_at: number | null;
    }>(
      'SELECT * FROM delegation_grants WHERE delegate_id = ? AND revoked_at IS NULL',
      [delegateId],
    );

    return rows.map(mapRowToGrant);
  }

  async function getActiveDelegationsForDelegator(
    delegatorId: string,
  ): Promise<DelegationGrant[]> {
    const rows = await db.query<{
      id: string;
      delegator_id: string;
      delegate_id: string;
      calendar_ids: string;
      permission: string;
      granted_at: number;
      revoked_at: number | null;
    }>(
      'SELECT * FROM delegation_grants WHERE delegator_id = ? AND revoked_at IS NULL',
      [delegatorId],
    );

    return rows.map(mapRowToGrant);
  }

  async function canPerformOperation(
    delegateId: string,
    calendarId: string,
    operation: 'read' | 'create' | 'update' | 'delete',
  ): Promise<boolean> {
    const grants = await getActiveDelegationsForDelegate(delegateId);

    for (const grant of grants) {
      if (!grant.calendarIds.includes(calendarId)) continue;

      // Revoked grants deny all operations
      if (grant.revokedAt !== null) continue;

      if (operation === 'read') {
        // Both read-only and read-write allow reads
        return true;
      }

      // Write operations require read-write permission
      if (grant.permission === 'read-write') {
        return true;
      }
    }

    return false;
  }

  async function createEventAsDelegate(
    delegateId: string,
    calendarAccountId: string,
    eventData: DelegateEventInput,
  ): Promise<DelegationResult> {
    const canCreate = await canPerformOperation(
      delegateId,
      calendarAccountId,
      'create',
    );
    if (!canCreate) {
      return {
        success: false,
        error: 'Delegate does not have write permission for this calendar',
      };
    }

    const eventId = generateUUID();
    const now = Date.now();

    try {
      await db.execute(
        `INSERT INTO events (
          id, provider_event_id, calendar_account_id, title, description, location,
          start_time, end_time, time_zone, is_all_day, recurrence_rule,
          organizer, attendees, sequence, dtstamp, status,
          sync_status, local_version, modified_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          eventId,
          '',
          calendarAccountId,
          eventData.title,
          eventData.description ?? null,
          eventData.location ?? null,
          eventData.startTime.getTime(),
          eventData.endTime.getTime(),
          eventData.timeZone ?? 'UTC',
          eventData.isAllDay ? 1 : 0,
          null,
          null,
          null,
          0,
          now,
          'confirmed',
          'pending_create',
          1,
          delegateId,
          now,
          now,
        ],
      );

      return { success: true, eventId };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return { success: false, error: message };
    }
  }

  async function updateEventAsDelegate(
    delegateId: string,
    eventId: string,
    updates: DelegateEventUpdate,
  ): Promise<DelegationResult> {
    // Get the event to find its calendar
    const eventRows = await db.query<{
      id: string;
      calendar_account_id: string;
      local_version: number;
    }>('SELECT id, calendar_account_id, local_version FROM events WHERE id = ?', [
      eventId,
    ]);

    if (eventRows.length === 0) {
      return { success: false, error: `Event ${eventId} not found` };
    }

    const event = eventRows[0];
    const canUpdate = await canPerformOperation(
      delegateId,
      event.calendar_account_id,
      'update',
    );
    if (!canUpdate) {
      return {
        success: false,
        error: 'Delegate does not have write permission for this calendar',
      };
    }

    const now = Date.now();
    const newVersion = event.local_version + 1;

    const setClauses: string[] = [];
    const params: unknown[] = [];

    if (updates.title !== undefined) {
      setClauses.push('title = ?');
      params.push(updates.title);
    }
    if (updates.description !== undefined) {
      setClauses.push('description = ?');
      params.push(updates.description);
    }
    if (updates.location !== undefined) {
      setClauses.push('location = ?');
      params.push(updates.location);
    }
    if (updates.startTime !== undefined) {
      setClauses.push('start_time = ?');
      params.push(updates.startTime.getTime());
    }
    if (updates.endTime !== undefined) {
      setClauses.push('end_time = ?');
      params.push(updates.endTime.getTime());
    }
    if (updates.timeZone !== undefined) {
      setClauses.push('time_zone = ?');
      params.push(updates.timeZone);
    }
    if (updates.isAllDay !== undefined) {
      setClauses.push('is_all_day = ?');
      params.push(updates.isAllDay ? 1 : 0);
    }

    // Always record delegate identity and update metadata
    setClauses.push('modified_by = ?');
    params.push(delegateId);
    setClauses.push('sync_status = ?');
    params.push('pending_update');
    setClauses.push('local_version = ?');
    params.push(newVersion);
    setClauses.push('updated_at = ?');
    params.push(now);

    params.push(eventId);

    try {
      await db.execute(
        `UPDATE events SET ${setClauses.join(', ')} WHERE id = ?`,
        params,
      );

      return { success: true, eventId };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return { success: false, error: message };
    }
  }

  async function deleteEventAsDelegate(
    delegateId: string,
    eventId: string,
  ): Promise<DelegationResult> {
    const eventRows = await db.query<{
      id: string;
      calendar_account_id: string;
    }>('SELECT id, calendar_account_id FROM events WHERE id = ?', [eventId]);

    if (eventRows.length === 0) {
      return { success: false, error: `Event ${eventId} not found` };
    }

    const event = eventRows[0];
    const canDelete = await canPerformOperation(
      delegateId,
      event.calendar_account_id,
      'delete',
    );
    if (!canDelete) {
      return {
        success: false,
        error: 'Delegate does not have write permission for this calendar',
      };
    }

    const now = Date.now();

    try {
      await db.execute(
        `UPDATE events SET sync_status = 'pending_delete', modified_by = ?, updated_at = ? WHERE id = ?`,
        [delegateId, now, eventId],
      );

      return { success: true, eventId };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return { success: false, error: message };
    }
  }

  async function readEventsAsDelegate(
    delegateId: string,
    calendarAccountId: string,
  ): Promise<CalendarEvent[]> {
    const canRead = await canPerformOperation(
      delegateId,
      calendarAccountId,
      'read',
    );
    if (!canRead) return [];

    const rows = await db.query<Record<string, unknown>>(
      'SELECT * FROM events WHERE calendar_account_id = ?',
      [calendarAccountId],
    );

    return rows.map(mapRowToEvent);
  }

  return {
    grantDelegation,
    revokeDelegation,
    getDelegationGrant,
    getActiveDelegationsForDelegate,
    getActiveDelegationsForDelegator,
    canPerformOperation,
    createEventAsDelegate,
    updateEventAsDelegate,
    deleteEventAsDelegate,
    readEventsAsDelegate,
  };
}

function mapRowToGrant(row: {
  id: string;
  delegator_id: string;
  delegate_id: string;
  calendar_ids: string;
  permission: string;
  granted_at: number;
  revoked_at: number | null;
}): DelegationGrant {
  return {
    id: row.id,
    delegatorId: row.delegator_id,
    delegateId: row.delegate_id,
    calendarIds: JSON.parse(row.calendar_ids),
    permission: row.permission as 'read-only' | 'read-write',
    grantedAt: new Date(row.granted_at),
    revokedAt: row.revoked_at ? new Date(row.revoked_at) : null,
  };
}

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
