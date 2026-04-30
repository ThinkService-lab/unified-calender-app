/**
 * Query hook for fetching events with date range.
 * Populates the Zustand events store on successful fetch so the local
 * store stays in sync with provider data (Req 2.1, 6.1).
 * Automatically disables fetching when offline via onlineManager.
 * Requirements: 4.1, 4.2, 7.4
 */

import { useQuery, onlineManager } from '@tanstack/react-query';
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
  /**
   * Optional transform from provider raw data to local CalendarEvent.
   *
   * INVARIANT: callers providing a custom `transform` are responsible
   * for producing **stable** event ids — i.e. the same raw input must
   * map to the same `CalendarEvent.id` across refetches. Unstable ids
   * cause duplicate `addEvents` calls and repeatedly re-fire the
   * `syncAppear` animation (Req 7.4). The built-in
   * {@link defaultTransform} synthesizes a deterministic id via a
   * content hash when `raw.id` is absent.
   */
  transform?: (raw: RawEventData, accountId: string) => CalendarEvent;
}

/**
 * Simple deterministic 32-bit string hash (FNV-1a). Used only to
 * synthesize stable fallback ids inside {@link defaultTransform} when
 * the provider omits `raw.id`. Not a cryptographic hash — collisions
 * are acceptable for the MVP fallback since real providers supply ids.
 */
function fnv1aHash(input: string): string {
  let hash = 0x811c9dc5; // FNV offset basis (32-bit)
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    // 32-bit FNV prime multiplication via Math.imul for correct overflow
    hash = Math.imul(hash, 0x01000193);
  }
  // Unsigned 32-bit, rendered as hex for compact output
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Module-level tracker of query keys that have already produced at
 * least one successful settlement. We use this to suppress the
 * `syncAppear` trigger on the initial cold-start load for a given
 * (accountId, range) pair — that initial payload is cached/first-fetch
 * data, not a user-perceived arrival.
 *
 * Keyed by the serialized query key so we share identity with
 * TanStack Query's own cache keying scheme. Entries are never removed:
 * the map is bounded by the finite set of (accountId, range) pairs a
 * session explores, and each entry stores only `true`. `QueryKey` is
 * an array type and therefore not usable as a `WeakMap` key, so a
 * stringified `Map` is the practical choice.
 */
const hasSettledOnce = new Map<string, true>();

/** Testing helper — clears cold-start tracking between test cases. */
export function __resetUseEventsSettleTrackerForTests(): void {
  hasSettledOnce.clear();
}

/**
 * Pure function that encapsulates the sync-arrival-tracking decision
 * the `useEffect` inside {@link useEvents} makes on each data change.
 *
 * Extracted for direct testability — `useEvents` itself requires a
 * React runtime (it's a hook), so this helper carries the
 * business-logic contract in a form that can be unit-tested without
 * rendering. Task 2.5B covers this function with dedicated tests.
 *
 * Algorithm:
 *   1. If the event list is empty, do nothing.
 *   2. Snapshot `storeEvents` BEFORE any mutation so we can identify
 *      ids that are genuinely new (not already in the store).
 *   3. Always add all events to the store via `addEvents`.
 *   4. If this is the first successful settlement for the query key,
 *      record the key and SKIP the syncAppear trigger — the first
 *      load is never treated as an arrival (cold-start suppression).
 *   5. Otherwise, if any ids are new, call `markArrivedFromSync(newIds)`.
 *
 * Side effects:
 *   - `addEvents(events)` is always invoked when `events.length > 0`.
 *   - `markArrivedFromSync(newIds)` is invoked only when both (a)
 *     this is not the first settlement, AND (b) `newIds.length > 0`.
 *   - The `hasSettledOnce` map is mutated on first settlement per key.
 */
export function applySyncArrivalEffect(params: {
  events: CalendarEvent[];
  settleKey: string;
  storeEvents: Record<string, CalendarEvent>;
  addEvents: (events: CalendarEvent[]) => void;
  markArrivedFromSync: (ids: string[]) => void;
}): void {
  const { events, settleKey, storeEvents, addEvents, markArrivedFromSync } =
    params;

  if (events.length === 0) return;

  const newIds = events.map((e) => e.id).filter((id) => !storeEvents[id]);

  addEvents(events);

  const isFirstSettlement = !hasSettledOnce.has(settleKey);
  if (isFirstSettlement) {
    hasSettledOnce.set(settleKey, true);
    return;
  }

  if (newIds.length > 0) {
    markArrivedFromSync(newIds);
  }
}

/**
 * Default transform that maps RawEventData to a minimal CalendarEvent.
 * Consumers should provide their own transform for full fidelity.
 *
 * When `raw.id` is missing, synthesizes a **stable** id from a
 * content hash of `(accountId, raw.title, raw.startTime)` instead of
 * `Date.now() + Math.random()`. Stability matters because
 * {@link useEvents} uses the event id as the identity key for the
 * delta diff against the Zustand store — unstable ids would treat
 * every refetch as a fresh arrival and re-fire the `syncAppear`
 * animation indefinitely (Req 7.4).
 */
function defaultTransform(raw: RawEventData, accountId: string): CalendarEvent {
  const now = new Date();
  const rawRecord = raw as Record<string, unknown>;
  const title = (rawRecord.title as string) ?? 'Untitled';
  const startTimeRaw = rawRecord.startTime;
  // Encode startTime consistently whether it arrives as Date, string, or undefined
  const startTimeKey =
    startTimeRaw instanceof Date
      ? startTimeRaw.toISOString()
      : typeof startTimeRaw === 'string'
        ? startTimeRaw
        : '';
  const fallbackId = `synth-${fnv1aHash(`${accountId}|${title}|${startTimeKey}`)}`;
  return {
    id: raw.id ?? fallbackId,
    providerEventId: raw.id ?? '',
    calendarAccountId: accountId,
    title,
    description: (rawRecord.description as string | null) ?? null,
    location: (rawRecord.location as string | null) ?? null,
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
 * Automatically disabled when offline (uses cached data from Zustand store).
 */
export function useEvents({
  accountId,
  range,
  adapter,
  enabled = true,
  transform = defaultTransform,
}: UseEventsOptions) {
  const isOnline = onlineManager.isOnline();

  const queryKey = queryKeys.events.byRange(
    accountId,
    range.start.toISOString(),
    range.end.toISOString(),
  );
  const settleKey = JSON.stringify(queryKey);

  const query = useQuery<RawEventData[], Error>({
    queryKey,
    queryFn: () => adapter.listEvents(accountId, range),
    staleTime: STALE_TIMES.events,
    enabled: enabled && isOnline,
  });

  // Populate the Zustand events store when query data changes.
  //
  // Sync-arrival tracking (Req 7.4):
  //
  //   The previous implementation called `markArrivedFromSync` for
  //   EVERY query data change — including the first cold-start
  //   settlement and every background refetch of already-known events.
  //   That flooded every `staleTime` boundary with the `syncAppear`
  //   animation, which is user-surprising and contrary to the intent
  //   of Req 7.4 ("a new event appears in the view due to a sync
  //   operation"). Two guards now scope the flag to genuinely new
  //   remote arrivals:
  //
  //     1. Cold-start suppression — the module-level `hasSettledOnce`
  //        map records which serialized query keys have already
  //        produced a successful settlement in this session. The first
  //        settlement for a given (accountId, range) pair records the
  //        key and skips `markArrivedFromSync`; subsequent settlements
  //        proceed to the delta diff below. The animation should
  //        represent arrivals while the app is running, not cached
  //        data replayed on launch.
  //
  //     2. Per-id delta diff — we capture the store snapshot BEFORE
  //        calling `addEvents`, then flag only ids that were not
  //        already present. Refetches that return unchanged sets
  //        produce an empty delta and skip the call. This relies on
  //        `CalendarEvent.id` being stable across refetches, which the
  //        built-in `defaultTransform` now guarantees via the FNV-1a
  //        content hash above (callers providing a custom `transform`
  //        must uphold the same invariant — see JSDoc on
  //        `UseEventsOptions.transform`).
  useEffect(() => {
    if (!query.data || query.data.length === 0) return;

    const events = query.data.map((raw) => transform(raw, accountId));
    const store = useEventsStore.getState();
    applySyncArrivalEffect({
      events,
      settleKey,
      storeEvents: store.events,
      addEvents: store.addEvents,
      markArrivedFromSync: store.markArrivedFromSync,
    });
  }, [query.data, accountId, transform, settleKey]);

  return query;
}

// Also export defaultTransform and fnv1aHash for direct unit testing
// in `__tests__/useEvents.syncArrival.test.ts` (Task 2.5B). They are
// not part of the public API — underscore prefixes signal "internal".
export { defaultTransform as __defaultTransformForTests };
export { fnv1aHash as __fnv1aHashForTests };
