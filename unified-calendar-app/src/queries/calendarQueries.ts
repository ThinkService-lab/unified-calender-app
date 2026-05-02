/**
 * TanStack Query hooks for calendar data.
 *
 * Bridges the Zustand stores and SyncEngine with React Query's server-state
 * management. Provides caching, automatic refetching, and the standard
 * isPending → isError → data rendering pattern at the UI layer.
 *
 * Usage:
 *   const { data, isPending, isError } = useCalendarEvents(accountId, dateRange);
 *   const createMutation = useCreateEvent();
 *   createMutation.mutate({ accountId, event });
 *
 * Requirements: 2.1, 4.1, 6.1
 */

import {
  useQuery,
  useMutation,
  useQueryClient,
  type QueryClient,
  type UseQueryOptions,
} from '@tanstack/react-query';
import type { CalendarEvent, CalendarAccount } from '../types/models';
import type { SyncEngine } from '../sync/types';
import type { DatabaseDriver } from '../db/database';
import type { PrivacyLayer } from '../privacy/privacyLayer';
import type { Audience } from '../types';

// ── Query Key Factories ────────────────────────────────────────────────

export const calendarKeys = {
  all: ['calendars'] as const,
  accounts: () => [...calendarKeys.all, 'accounts'] as const,
  account: (accountId: string) => [...calendarKeys.accounts(), accountId] as const,
  events: () => [...calendarKeys.all, 'events'] as const,
  eventsByAccount: (accountId: string) =>
    [...calendarKeys.events(), 'account', accountId] as const,
  eventsByRange: (accountId: string, start: string, end: string) =>
    [...calendarKeys.events(), accountId, start, end] as const,
  allEvents: (start: string, end: string) =>
    [...calendarKeys.events(), 'all', start, end] as const,
  syncStatus: () => [...calendarKeys.all, 'syncStatus'] as const,
  conflicts: () => [...calendarKeys.all, 'conflicts'] as const,
};

// ── Service Dependencies ───────────────────────────────────────────────

/**
 * Dependencies injected once at app bootstrap via `createCalendarQueryHooks`.
 * Avoids prop-drilling services through every component.
 */
export interface CalendarQueryDeps {
  db: DatabaseDriver;
  syncEngine: SyncEngine;
  privacyLayer?: PrivacyLayer;
}

let _deps: CalendarQueryDeps | null = null;

/**
 * Initialize the query hooks with service dependencies.
 * Call once during app bootstrap after services are created.
 */
export function initCalendarQueries(deps: CalendarQueryDeps): void {
  _deps = deps;
}

function getDeps(): CalendarQueryDeps {
  if (!_deps) {
    throw new Error(
      'Calendar queries not initialized. Call initCalendarQueries() during bootstrap.',
    );
  }
  return _deps;
}

// ── Query Hooks ────────────────────────────────────────────────────────

/**
 * Fetches all calendar accounts from the local database.
 * Uses staleTime of 30s — accounts rarely change.
 */
export function useCalendarAccounts() {
  const { db } = getDeps();

  return useQuery({
    queryKey: calendarKeys.accounts(),
    queryFn: async (): Promise<CalendarAccount[]> => {
      const rows = await db.query<{
        id: string;
        user_id: string;
        provider_id: string;
        display_name: string;
        email: string;
        color: string;
        visibility: string;
        sync_token: string | null;
        last_synced_at: number | null;
        status: string;
        created_at: number;
      }>('SELECT * FROM calendar_accounts ORDER BY created_at ASC');

      return rows.map((row) => ({
        id: row.id,
        userId: row.user_id,
        providerId: row.provider_id as CalendarAccount['providerId'],
        displayName: row.display_name,
        email: row.email,
        color: row.color,
        visibility: row.visibility as CalendarAccount['visibility'],
        syncToken: row.sync_token,
        lastSyncedAt: row.last_synced_at ? new Date(row.last_synced_at) : null,
        status: row.status as CalendarAccount['status'],
        createdAt: new Date(row.created_at),
      }));
    },
    staleTime: 30_000,
  });
}

/**
 * Fetches events for a specific time range across all accounts.
 * The primary query for the Unified Calendar View.
 *
 * @param start - Range start (inclusive)
 * @param end   - Range end (exclusive, per RFC 5545 DTEND semantics)
 */
export function useCalendarEvents(start: Date, end: Date) {
  const { db } = getDeps();

  return useQuery({
    queryKey: calendarKeys.allEvents(start.toISOString(), end.toISOString()),
    queryFn: async (): Promise<CalendarEvent[]> => {
      const rows = await db.query<Record<string, unknown>>(
        `SELECT * FROM events
         WHERE start_time < ? AND end_time > ?
         ORDER BY start_time ASC`,
        [end.getTime(), start.getTime()],
      );

      return rows.map(mapRowToCalendarEvent);
    },
    staleTime: 10_000, // Events change more frequently — 10s stale time
  });
}

/**
 * Fetches events for a single account within a time range.
 * Useful for per-account views or sync status displays.
 */
export function useAccountEvents(accountId: string, start: Date, end: Date) {
  const { db } = getDeps();

  return useQuery({
    queryKey: calendarKeys.eventsByRange(accountId, start.toISOString(), end.toISOString()),
    queryFn: async (): Promise<CalendarEvent[]> => {
      const rows = await db.query<Record<string, unknown>>(
        `SELECT * FROM events
         WHERE calendar_account_id = ? AND start_time < ? AND end_time > ?
         ORDER BY start_time ASC`,
        [accountId, end.getTime(), start.getTime()],
      );

      return rows.map(mapRowToCalendarEvent);
    },
    staleTime: 10_000,
    enabled: !!accountId,
  });
}

/**
 * Fetches current sync conflicts from the sync engine.
 */
export function useSyncConflicts() {
  const { syncEngine } = getDeps();

  return useQuery({
    queryKey: calendarKeys.conflicts(),
    queryFn: async () => syncEngine.getConflicts(),
    staleTime: 5_000,
    refetchInterval: 10_000, // Poll for new conflicts every 10s
  });
}

// ── Mutation Hooks ─────────────────────────────────────────────────────

/**
 * Creates a new event locally and queues it for outbound sync.
 * Invalidates event queries on success so the UI refreshes.
 */
export function useCreateEvent() {
  const queryClient = useQueryClient();
  const { db, syncEngine } = getDeps();

  return useMutation({
    mutationFn: async (params: {
      event: CalendarEvent;
    }): Promise<CalendarEvent> => {
      const { event } = params;
      const now = Date.now();

      await db.execute(
        `INSERT INTO events (id, provider_event_id, calendar_account_id, title, description, location, start_time, end_time, time_zone, is_all_day, recurrence_rule, sequence, dtstamp, sync_status, local_version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          event.id,
          event.providerEventId ?? null,
          event.calendarAccountId,
          event.title,
          event.description ?? null,
          event.location ?? null,
          event.startTime.getTime(),
          event.endTime.getTime(),
          event.timeZone,
          event.isAllDay ? 1 : 0,
          event.recurrenceRule ? JSON.stringify(event.recurrenceRule) : null,
          0,
          now,
          'pending_create',
          1,
          now,
          now,
        ],
      );

      // Queue for outbound sync
      syncEngine.queueLocalChange({
        calendarAccountId: event.calendarAccountId,
        eventId: event.id,
        operation: 'create',
        payload: JSON.stringify(event),
      });

      return event;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: calendarKeys.events() });
    },
  });
}

/**
 * Updates an existing event locally and queues the change for outbound sync.
 */
export function useUpdateEvent() {
  const queryClient = useQueryClient();
  const { db, syncEngine } = getDeps();

  return useMutation({
    mutationFn: async (params: {
      eventId: string;
      updates: Partial<CalendarEvent>;
      calendarAccountId: string;
    }): Promise<void> => {
      const { eventId, updates, calendarAccountId } = params;
      const now = Date.now();

      // Build SET clause dynamically from provided updates
      const setClauses: string[] = ['sync_status = ?', 'updated_at = ?'];
      const values: unknown[] = ['pending_update', now];

      if (updates.title !== undefined) { setClauses.push('title = ?'); values.push(updates.title); }
      if (updates.description !== undefined) { setClauses.push('description = ?'); values.push(updates.description); }
      if (updates.location !== undefined) { setClauses.push('location = ?'); values.push(updates.location); }
      if (updates.startTime !== undefined) { setClauses.push('start_time = ?'); values.push(updates.startTime.getTime()); }
      if (updates.endTime !== undefined) { setClauses.push('end_time = ?'); values.push(updates.endTime.getTime()); }
      if (updates.isAllDay !== undefined) { setClauses.push('is_all_day = ?'); values.push(updates.isAllDay ? 1 : 0); }

      values.push(eventId);

      await db.execute(
        `UPDATE events SET ${setClauses.join(', ')} WHERE id = ?`,
        values,
      );

      syncEngine.queueLocalChange({
        calendarAccountId,
        eventId,
        operation: 'update',
        payload: JSON.stringify(updates),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: calendarKeys.events() });
    },
  });
}

/**
 * Deletes an event locally and queues the deletion for outbound sync.
 */
export function useDeleteEvent() {
  const queryClient = useQueryClient();
  const { db, syncEngine } = getDeps();

  return useMutation({
    mutationFn: async (params: {
      eventId: string;
      calendarAccountId: string;
    }): Promise<void> => {
      const { eventId, calendarAccountId } = params;

      // Mark as pending delete (don't remove yet — sync engine needs the record)
      await db.execute(
        `UPDATE events SET sync_status = 'pending_delete', updated_at = ? WHERE id = ?`,
        [Date.now(), eventId],
      );

      syncEngine.queueLocalChange({
        calendarAccountId,
        eventId,
        operation: 'delete',
        payload: JSON.stringify({ eventId }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: calendarKeys.events() });
    },
  });
}

/**
 * Resolves a sync conflict (keep local or keep remote).
 */
export function useResolveConflict() {
  const queryClient = useQueryClient();
  const { syncEngine } = getDeps();

  return useMutation({
    mutationFn: async (params: {
      conflictId: string;
      resolution: 'keep_local' | 'keep_remote';
    }): Promise<void> => {
      await syncEngine.resolveConflict(params.conflictId, params.resolution);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: calendarKeys.events() });
      queryClient.invalidateQueries({ queryKey: calendarKeys.conflicts() });
    },
  });
}

// ── Helpers ─────────────────────────────────────────────────────────────

/** Maps a raw database row to a CalendarEvent. */
function mapRowToCalendarEvent(row: Record<string, unknown>): CalendarEvent {
  let recurrenceRule = null;
  if (row.recurrence_rule && typeof row.recurrence_rule === 'string') {
    try {
      recurrenceRule = JSON.parse(row.recurrence_rule);
    } catch {
      recurrenceRule = null;
    }
  }

  let organizer = null;
  if (row.organizer && typeof row.organizer === 'string') {
    try {
      organizer = JSON.parse(row.organizer);
    } catch {
      organizer = null;
    }
  }

  let attendees = null;
  if (row.attendees && typeof row.attendees === 'string') {
    try {
      attendees = JSON.parse(row.attendees);
    } catch {
      attendees = null;
    }
  }

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
    isAllDay: row.is_all_day === 1,
    recurrenceRule,
    recurrenceExceptionDate: row.recurrence_exception_date
      ? new Date(row.recurrence_exception_date as number)
      : null,
    parentRecurringEventId: (row.parent_recurring_event_id as string) ?? null,
    organizer,
    attendees: attendees ?? [],
    sequence: (row.sequence as number) ?? 0,
    dtstamp: row.dtstamp ? new Date(row.dtstamp as number) : new Date(),
    status: (row.status as CalendarEvent['status']) ?? 'confirmed',
    visibility: (row.visibility as CalendarEvent['visibility']) ?? null,
    opaqueFields: new Map<string, string>(),
    syncStatus: (row.sync_status as CalendarEvent['syncStatus']) ?? 'synced',
    localVersion: (row.local_version as number) ?? 1,
    remoteEtag: (row.remote_etag as string) ?? null,
    modifiedBy: (row.modified_by as string) ?? null,
    createdAt: new Date(row.created_at as number),
    updatedAt: new Date(row.updated_at as number),
  };
}
