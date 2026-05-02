/**
 * EventCRUDService — full read-write event management.
 *
 * - Create: write to local SQLite + Zustand store, queue outbound sync to provider
 * - Update: local write + store update, propagate to provider within 5 seconds
 * - Delete: local delete + store update, propagate to provider within 5 seconds
 * - Supports selecting target calendar account on event creation
 * - Queues failed operations for retry with user notification
 *
 * Requirements: 3.1, 3.2, 3.3, 3.6
 */

import type { DatabaseDriver } from '../db/database';
import type { SyncEngine, LocalChange } from '../sync/types';
import type { CalendarEvent, VisibilityLevel } from '../types/models';
// Security Review 2026-05-02: Finding C3 — replaced Math.random() UUID with crypto
import { cryptoUUID } from '../utils/cryptoId';
// Security Review 2026-05-02: Finding H6 — dedup to shared safe event mapper
import { mapRowToEvent } from '../utils/eventMapper';

/**
 * Interface for the in-memory events store.
 * Decouples the service from the concrete Zustand store implementation,
 * enabling testability and use outside React components.
 */
export interface EventsStoreAdapter {
  addEvent(event: CalendarEvent): void;
  updateEvent(id: string, updates: Partial<CalendarEvent>): void;
  removeEvent(id: string): void;
  setSyncStatus(id: string, status: CalendarEvent['syncStatus']): void;
}

/** Notification callback for user-facing messages */
export type EventNotificationCallback = (
  message: string,
  severity: 'info' | 'warning' | 'error',
) => void;

/** Input for creating a new event */
export interface CreateEventInput {
  /** Target calendar account ID (Req 3.1: write to selected Calendar_Provider) */
  calendarAccountId: string;
  title: string;
  description?: string | null;
  location?: string | null;
  startTime: Date;
  endTime: Date;
  timeZone?: string;
  isAllDay?: boolean;
  recurrenceRule?: string | null;
  attendees?: string | null;
  organizer?: string | null;
  visibility?: string | null;
  /** Preserved unknown ICS fields for round-trip fidelity (Req 12.3) */
  opaqueFields?: string | null;
  /** If this event is an exception to a recurring event (Req 3.5) */
  recurrenceExceptionDate?: Date | null;
  /** Parent recurring event ID when creating an exception instance (Req 3.5) */
  parentRecurringEventId?: string | null;
}

/** Input for updating an existing event */
export interface UpdateEventInput {
  title?: string;
  description?: string | null;
  location?: string | null;
  startTime?: Date;
  endTime?: Date;
  timeZone?: string;
  isAllDay?: boolean;
  recurrenceRule?: string | null;
  attendees?: string | null;
  organizer?: string | null;
  visibility?: string | null;
}

/** Result of a CRUD operation */
export interface CRUDResult {
  success: boolean;
  eventId?: string;
  error?: string;
}

export interface EventCRUDServiceConfig {
  db: DatabaseDriver;
  syncEngine: SyncEngine;
  /** Optional Zustand store adapter for keeping in-memory state in sync with SQLite */
  eventsStore?: EventsStoreAdapter;
  onNotification?: EventNotificationCallback;
}

/**
 * Generate a UUID v4 compliant ID using crypto.randomUUID().
 * Security Review 2026-05-02: Finding C3 — replaced Math.random() with
 * cryptographically secure UUID generation.
 */
function generateUUID(): string {
  return cryptoUUID();
}

export interface EventCRUDService {
  createEvent(input: CreateEventInput): Promise<CRUDResult>;
  updateEvent(eventId: string, input: UpdateEventInput): Promise<CRUDResult>;
  deleteEvent(eventId: string): Promise<CRUDResult>;
  getEvent(eventId: string): Promise<CalendarEvent | null>;
  getEventsByAccount(calendarAccountId: string): Promise<CalendarEvent[]>;
}

/**
 * Creates an EventCRUDService instance.
 */
export function createEventCRUDService(config: EventCRUDServiceConfig): EventCRUDService {
  const { db, syncEngine, eventsStore, onNotification } = config;

  function notify(message: string, severity: 'info' | 'warning' | 'error'): void {
    if (onNotification) {
      onNotification(message, severity);
    }
  }

  /**
   * Validates that the target calendar account exists and is active.
   */
  async function validateAccount(calendarAccountId: string): Promise<boolean> {
    const rows = await db.query<{ id: string; status: string }>(
      `SELECT id, status FROM calendar_accounts WHERE id = ?`,
      [calendarAccountId],
    );
    return rows.length > 0 && rows[0].status === 'active';
  }

  /**
   * Queues a sync operation and notifies user on failure.
   * Req 3.6: Failed write operations queued for retry with user notification.
   */
  async function queueSyncWithNotification(change: LocalChange, operationLabel: string): Promise<void> {
    try {
      syncEngine.queueLocalChange(change);
    } catch {
      notify(
        `Failed to queue ${operationLabel} for sync. The change is saved locally and will retry automatically.`,
        'warning',
      );
    }
  }

  /**
   * Create event: write to local SQLite, queue outbound sync to provider.
   * Req 3.1: Write event to selected Calendar_Provider.
   */
  async function createEvent(input: CreateEventInput): Promise<CRUDResult> {
    const { calendarAccountId } = input;

    // Validate target account exists
    const accountValid = await validateAccount(calendarAccountId);
    if (!accountValid) {
      return {
        success: false,
        error: `Calendar account ${calendarAccountId} not found or inactive`,
      };
    }

    const eventId = generateUUID();
    const now = Date.now();

    try {
      // Write to local SQLite
      await db.execute(
        `INSERT INTO events (
          id, provider_event_id, calendar_account_id, title, description, location,
          start_time, end_time, time_zone, is_all_day, recurrence_rule,
          recurrence_exception_date, parent_recurring_event_id,
          organizer, attendees, sequence, dtstamp, status,
          visibility_override, opaque_fields, sync_status, local_version, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          eventId,
          '',  // provider_event_id assigned after sync
          calendarAccountId,
          input.title,
          input.description ?? null,
          input.location ?? null,
          input.startTime.getTime(),
          input.endTime.getTime(),
          input.timeZone ?? 'UTC',
          input.isAllDay ? 1 : 0,
          input.recurrenceRule ?? null,
          input.recurrenceExceptionDate ? input.recurrenceExceptionDate.getTime() : null,
          input.parentRecurringEventId ?? null,
          input.organizer ?? null,
          input.attendees ?? null,
          0,   // sequence
          now, // dtstamp
          'confirmed',
          input.visibility ?? null,
          input.opaqueFields ?? null,
          'pending_create',
          1,   // local_version
          now,
          now,
        ],
      );

      // Gap #1 fix: Update Zustand events store so UI reflects the new event immediately
      if (eventsStore) {
        eventsStore.addEvent(mapRowToEvent({
          id: eventId,
          provider_event_id: '',
          calendar_account_id: calendarAccountId,
          title: input.title,
          description: input.description ?? null,
          location: input.location ?? null,
          start_time: input.startTime.getTime(),
          end_time: input.endTime.getTime(),
          time_zone: input.timeZone ?? 'UTC',
          is_all_day: input.isAllDay ? 1 : 0,
          recurrence_rule: input.recurrenceRule ?? null,
          recurrence_exception_date: input.recurrenceExceptionDate ? input.recurrenceExceptionDate.getTime() : null,
          parent_recurring_event_id: input.parentRecurringEventId ?? null,
          organizer: input.organizer ?? null,
          attendees: input.attendees ?? null,
          sequence: 0,
          dtstamp: now,
          status: 'confirmed',
          visibility_override: input.visibility ?? null,
          opaque_fields: input.opaqueFields ?? null,
          sync_status: 'pending_create',
          local_version: 1,
          remote_etag: null,
          modified_by: null,
          created_at: now,
          updated_at: now,
        }));
      }

      // Gap #3 fix: Include ALL fields in sync payload so provider adapter has complete data
      await queueSyncWithNotification(
        {
          calendarAccountId,
          eventId,
          operation: 'create',
          payload: JSON.stringify({
            title: input.title,
            description: input.description ?? null,
            location: input.location ?? null,
            startTime: input.startTime.toISOString(),
            endTime: input.endTime.toISOString(),
            timeZone: input.timeZone ?? 'UTC',
            isAllDay: input.isAllDay ?? false,
            recurrenceRule: input.recurrenceRule ?? null,
            attendees: input.attendees ?? null,
            organizer: input.organizer ?? null,
            visibility: input.visibility ?? null,
          }),
        },
        'event creation',
      );

      return { success: true, eventId };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      notify(`Failed to create event: ${message}`, 'error');
      return { success: false, error: message };
    }
  }

  /**
   * Update event: local write, propagate to provider within 5 seconds.
   * Req 3.2: Propagate update to originating Calendar_Provider within 5 seconds.
   */
  async function updateEvent(eventId: string, input: UpdateEventInput): Promise<CRUDResult> {
    try {
      // Verify event exists
      const existing = await db.query<{
        id: string;
        calendar_account_id: string;
        local_version: number;
        sequence: number;
      }>(
        `SELECT id, calendar_account_id, local_version, sequence FROM events WHERE id = ?`,
        [eventId],
      );

      if (existing.length === 0) {
        return { success: false, error: `Event ${eventId} not found` };
      }

      const event = existing[0];
      const now = Date.now();
      const newVersion = event.local_version + 1;
      const newSequence = (event.sequence ?? 0) + 1;

      // Build SET clause dynamically from provided fields
      const setClauses: string[] = [];
      const params: unknown[] = [];

      if (input.title !== undefined) {
        setClauses.push('title = ?');
        params.push(input.title);
      }
      if (input.description !== undefined) {
        setClauses.push('description = ?');
        params.push(input.description);
      }
      if (input.location !== undefined) {
        setClauses.push('location = ?');
        params.push(input.location);
      }
      if (input.startTime !== undefined) {
        setClauses.push('start_time = ?');
        params.push(input.startTime.getTime());
      }
      if (input.endTime !== undefined) {
        setClauses.push('end_time = ?');
        params.push(input.endTime.getTime());
      }
      if (input.timeZone !== undefined) {
        setClauses.push('time_zone = ?');
        params.push(input.timeZone);
      }
      if (input.isAllDay !== undefined) {
        setClauses.push('is_all_day = ?');
        params.push(input.isAllDay ? 1 : 0);
      }
      if (input.recurrenceRule !== undefined) {
        setClauses.push('recurrence_rule = ?');
        params.push(input.recurrenceRule);
      }
      if (input.attendees !== undefined) {
        setClauses.push('attendees = ?');
        params.push(input.attendees);
      }
      if (input.organizer !== undefined) {
        setClauses.push('organizer = ?');
        params.push(input.organizer);
      }
      if (input.visibility !== undefined) {
        setClauses.push('visibility_override = ?');
        params.push(input.visibility);
      }

      // Always update sync status, version, sequence, dtstamp, and timestamp
      // RFC 5545: SEQUENCE must be incremented on significant changes
      // RFC 5545: DTSTAMP must be updated on modification
      setClauses.push('sequence = ?');
      params.push(newSequence);
      setClauses.push('dtstamp = ?');
      params.push(now);
      setClauses.push('sync_status = ?');
      params.push('pending_update');
      setClauses.push('local_version = ?');
      params.push(newVersion);
      setClauses.push('updated_at = ?');
      params.push(now);

      params.push(eventId);

      await db.execute(
        `UPDATE events SET ${setClauses.join(', ')} WHERE id = ?`,
        params,
      );

      // Gap #1 fix: Update Zustand events store so UI reflects the change immediately
      if (eventsStore) {
        const storeUpdates: Partial<CalendarEvent> = {
          syncStatus: 'pending_update',
          localVersion: newVersion,
          sequence: newSequence,
          dtstamp: new Date(now),
          updatedAt: new Date(now),
        };
        if (input.title !== undefined) storeUpdates.title = input.title;
        if (input.description !== undefined) storeUpdates.description = input.description;
        if (input.location !== undefined) storeUpdates.location = input.location;
        if (input.startTime !== undefined) storeUpdates.startTime = input.startTime;
        if (input.endTime !== undefined) storeUpdates.endTime = input.endTime;
        if (input.timeZone !== undefined) storeUpdates.timeZone = input.timeZone;
        if (input.isAllDay !== undefined) storeUpdates.isAllDay = input.isAllDay;
        if (input.visibility !== undefined) storeUpdates.visibility = input.visibility as VisibilityLevel | null;
        eventsStore.updateEvent(eventId, storeUpdates);
      }

      // Queue outbound sync — propagate within 5 seconds (Req 3.2)
      // Send the full event state so provider adapters (especially CalDAV)
      // can construct a complete update request.
      const fullEvent = await getEvent(eventId);
      await queueSyncWithNotification(
        {
          calendarAccountId: event.calendar_account_id,
          eventId,
          operation: 'update',
          payload: JSON.stringify({
            title: fullEvent?.title,
            description: fullEvent?.description ?? null,
            location: fullEvent?.location ?? null,
            startTime: fullEvent?.startTime.toISOString(),
            endTime: fullEvent?.endTime.toISOString(),
            timeZone: fullEvent?.timeZone ?? 'UTC',
            isAllDay: fullEvent?.isAllDay ?? false,
            recurrenceRule: fullEvent?.recurrenceRule ?? null,
            attendees: fullEvent?.attendees ?? null,
            organizer: fullEvent?.organizer ?? null,
            visibility: fullEvent?.visibility ?? null,
            sequence: fullEvent?.sequence ?? 0,
          }),
        },
        'event update',
      );

      return { success: true, eventId };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      notify(`Failed to update event: ${message}`, 'error');
      return { success: false, error: message };
    }
  }

  /**
   * Delete event: mark as pending_delete locally, queue outbound sync.
   * Req 3.3: Remove event from originating Calendar_Provider within 5 seconds.
   *
   * The event is marked as pending_delete rather than immediately removed,
   * because sync_queue has a CASCADE FK on events(id). The sync engine
   * will delete the local row after the provider confirms deletion.
   * If the caller needs immediate local removal, they can delete after
   * the sync queue entry is persisted.
   */
  async function deleteEvent(eventId: string): Promise<CRUDResult> {
    try {
      // Verify event exists and get account ID for sync
      const existing = await db.query<{
        id: string;
        calendar_account_id: string;
      }>(
        `SELECT id, calendar_account_id FROM events WHERE id = ?`,
        [eventId],
      );

      if (existing.length === 0) {
        return { success: false, error: `Event ${eventId} not found` };
      }

      const event = existing[0];
      const now = Date.now();

      // Mark event as pending_delete locally (keeps the row so CASCADE FK is satisfied)
      await db.execute(
        `UPDATE events SET sync_status = 'pending_delete', updated_at = ? WHERE id = ?`,
        [now, eventId],
      );

      // Update Zustand events store so UI hides the deleted event immediately.
      // We remove from the store (not just set status) because the user expects
      // the event to disappear. The SQLite row remains for sync_queue FK integrity
      // until the sync engine confirms deletion with the provider.
      if (eventsStore) {
        eventsStore.removeEvent(eventId);
      }

      // Queue outbound sync — propagate within 5 seconds (Req 3.3)
      await queueSyncWithNotification(
        {
          calendarAccountId: event.calendar_account_id,
          eventId,
          operation: 'delete',
          payload: '{}',
        },
        'event deletion',
      );

      return { success: true, eventId };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      notify(`Failed to delete event: ${message}`, 'error');
      return { success: false, error: message };
    }
  }

  /**
   * Get a single event by ID.
   */
  async function getEvent(eventId: string): Promise<CalendarEvent | null> {
    const rows = await db.query<Record<string, unknown>>(
      `SELECT * FROM events WHERE id = ?`,
      [eventId],
    );

    if (rows.length === 0) return null;
    return mapRowToEvent(rows[0]);
  }

  /**
   * Get all events for a calendar account.
   */
  async function getEventsByAccount(calendarAccountId: string): Promise<CalendarEvent[]> {
    const rows = await db.query<Record<string, unknown>>(
      `SELECT * FROM events WHERE calendar_account_id = ?`,
      [calendarAccountId],
    );

    return rows.map(mapRowToEvent);
  }

  return {
    createEvent,
    updateEvent,
    deleteEvent,
    getEvent,
    getEventsByAccount,
  };
}

// Security Review 2026-05-02: Finding H6 — mapRowToEvent moved to
// '../utils/eventMapper' (safe JSON parsing). Imported at top of file.
