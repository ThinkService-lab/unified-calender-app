/**
 * Shared event mapping utility.
 *
 * Maps raw database rows to CalendarEvent objects with safe JSON parsing.
 * Used by sharedViewService, delegationService, and any other module that
 * reads events from the database.
 *
 * Security Review 2026-05-01: Findings C2 (safe JSON parsing) and L2 (deduplication)
 */

import type { CalendarEvent, Attendee } from '../types';
import { safeJsonParse } from './safeJsonParse';

/**
 * Maps a raw database row to a CalendarEvent object.
 *
 * All JSON columns are parsed with safeJsonParse to prevent crashes
 * from corrupted or malformed data.
 */
export function mapRowToEvent(row: Record<string, unknown>): CalendarEvent {
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
    recurrenceRule: safeJsonParse(row.recurrence_rule as string | null, null),
    recurrenceExceptionDate: row.recurrence_exception_date
      ? new Date(row.recurrence_exception_date as number)
      : null,
    parentRecurringEventId:
      (row.parent_recurring_event_id as string) ?? null,
    organizer: safeJsonParse(row.organizer as string | null, null),
    attendees: safeJsonParse<Attendee[]>(row.attendees as string | null, []),
    sequence: (row.sequence as number) ?? 0,
    dtstamp: new Date(row.dtstamp as number),
    status:
      (row.status as CalendarEvent['status']) ?? 'confirmed',
    visibility:
      (row.visibility_override as CalendarEvent['visibility']) ?? null,
    opaqueFields: (() => {
      const parsed = safeJsonParse<Record<string, unknown>>(
        row.opaque_fields as string | null,
      );
      return parsed ? new Map(Object.entries(parsed)) : new Map();
    })(),
    syncStatus:
      (row.sync_status as CalendarEvent['syncStatus']) ?? 'synced',
    localVersion: (row.local_version as number) ?? 1,
    remoteEtag: (row.remote_etag as string) ?? null,
    modifiedBy: (row.modified_by as string) ?? null,
    createdAt: new Date(row.created_at as number),
    updatedAt: new Date(row.updated_at as number),
  };
}
