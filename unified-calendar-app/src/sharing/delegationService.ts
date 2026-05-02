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
import type { PrivacyLayer } from '../privacy/privacyLayer';
import type { DelegationGrant, CalendarEvent, Audience } from '../types';
// Security Review 2026-05-01: Findings C2 + L2 — shared safe event mapper
import { mapRowToEvent } from '../utils/eventMapper';
import { safeJsonParse } from '../utils/safeJsonParse';

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

// Security Review 2026-05-01: Finding H2 — replaced Math.random() UUID with crypto
import { cryptoUUID } from '../utils/cryptoId';

export interface DelegationServiceConfig {
  db: DatabaseDriver;
  /** Privacy layer for filtering events based on visibility rules (Req 5.5) */
  privacyLayer?: PrivacyLayer;
}

/**
 * Creates a DelegationService instance.
 */
export function createDelegationService(
  config: DelegationServiceConfig,
): DelegationService {
  const { db, privacyLayer } = config;

  async function grantDelegation(
    delegatorId: string,
    delegateId: string,
    calendarIds: string[],
    permission: 'read-only' | 'read-write',
  ): Promise<DelegationResult> {
    const grantId = cryptoUUID();
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

    const eventId = cryptoUUID();
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

    const events: CalendarEvent[] = rows.map(mapRowToEvent);

    // Apply privacy layer filtering for the delegate's audience (Req 5.5).
    // This ensures delegates only see events according to the calendar owner's
    // visibility rules (private calendars hidden, busy-only stripped, etc.).
    if (privacyLayer) {
      // Determine the delegate's permission level from their active grant
      const grants = await getActiveDelegationsForDelegate(delegateId);
      const grant = grants.find((g) => g.calendarIds.includes(calendarAccountId));
      const permissionLevel = grant?.permission ?? 'read-only';

      const audience: Audience = {
        type: 'delegate',
        userId: delegateId,
        permissionLevel,
      };

      return privacyLayer.filterForAudience(events, audience);
    }

    return events;
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

// mapRowToEvent is imported from '../utils/eventMapper'

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
    calendarIds: safeJsonParse<string[]>(row.calendar_ids, []),
    permission: row.permission as 'read-only' | 'read-write',
    grantedAt: new Date(row.granted_at),
    revokedAt: row.revoked_at ? new Date(row.revoked_at) : null,
  };
}

// Local mapRowToEvent removed — using shared import from '../utils/eventMapper'
