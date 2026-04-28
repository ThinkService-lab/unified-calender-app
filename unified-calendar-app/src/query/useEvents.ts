/**
 * Query hook for fetching events with date range.
 * Populates the Zustand events store on successful fetch so the local
 * store stays in sync with provider data (Req 2.1, 6.1).
 * Requirements: 4.1, 4.2
 */

import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { queryKeys } from './queryKeys';
import { STALE_TIMES } from './queryClient';
import { useEventsStore } from '../stores/eventsStore';
import type { CalendarProviderAdapter, RawEventData, DateRange } from '../providers/types';
import type { CalendarEvent } from '../types/models';

export interface UseEventsOptions {
  accountId: string;
  range: DateRange;
  adapter: CalendarProviderAdapter;
  enabled?: boolean;
  /** Optional transform from provider raw data to local CalendarEvent */
  transform?: (raw: RawEventData, accountId: string) => CalendarEvent;
}

/**
 * Default transform that maps RawEventData to a minimal CalendarEvent.
 * Consumers should provide their own transform for full fidelity.
 */
function defaultTransform(raw: RawEventData, accountId: string): CalendarEvent {
  const now = new Date();
  return {
    id: raw.id ?? `${accountId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    providerEventId: raw.id ?? '',
    calendarAccountId: accountId,
    title: (raw as Record<string, unknown>).title as string ?? 'Untitled',
    description: (raw as Record<string, unknown>).description as string | null ?? null,
    location: (raw as Record<string, unknown>).location as string | null ?? null,
    startTime: now,
    endTime: new Date(now.getTime() + 3600000),
    timeZone: 'UTC',
    isAllDay: false,
    recurrenceRule: null,
    recurrenceExceptionDate: null,
    parentRecurringEventId: null,
    organizer: null,
    attendees: [],
    sequence: 0,
    dtstamp: now,
    status: 'confirmed',
    visibility: null,
    opaqueFields: new Map(),
    syncStatus: 'synced',
    localVersion: 1,
    remoteEtag: null,
    modifiedBy: null,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Fetches events for a given account within a date range.
 * Uses a 10-second staleTime since events change more frequently.
 * Query keys include the date range for proper cache segmentation.
 * On success, populates the Zustand events store.
 */
export function useEvents({
  accountId,
  range,
  adapter,
  enabled = true,
  transform = defaultTransform,
}: UseEventsOptions) {
  const query = useQuery<RawEventData[], Error>({
    queryKey: queryKeys.events.byRange(
      accountId,
      range.start.toISOString(),
      range.end.toISOString(),
    ),
    queryFn: () => adapter.listEvents(accountId, range),
    staleTime: STALE_TIMES.events,
    enabled,
  });

  // Populate Zustand events store when query data changes
  useEffect(() => {
    if (query.data && query.data.length > 0) {
      const events = query.data.map((raw) => transform(raw, accountId));
      useEventsStore.getState().addEvents(events);
    }
  }, [query.data, accountId, transform]);

  return query;
}
