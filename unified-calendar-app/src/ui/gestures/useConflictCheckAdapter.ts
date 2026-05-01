/**
 * useConflictCheckAdapter
 *
 * Adapter hook that exposes the existing `ConflictDetector` (from
 * `src/conflicts/conflictDetector.ts`) in the shape required by
 * `DragRescheduleConfig.onConflictCheck` and `DragResizeConfig.onConflictCheck`.
 *
 * Requirements: 4.4, 13.5
 *
 * The adapter:
 * 1. Constructs a synthetic `CalendarEvent` from the drag's proposed start/end
 *    (carrying the dragged event's id and calendarAccountId), so
 *    `detectConflicts` can run its existing overlap logic unmodified.
 * 2. Filters out any conflict whose "other" event id matches the dragged
 *    `eventId` — a drag must not conflict with itself.
 * 3. Returns a `ConflictCheckResult` with `hasConflict`, `conflictingEventIds`,
 *    and `conflictCount`.
 *
 * The adapter uses ONLY the synchronous `detectConflicts` method — not
 * `detectConflictsWithTravel` — so it is safe to invoke on every frame of
 * a pan gesture without triggering network or async travel-time estimation.
 *
 * Performance: O(N) in the number of events by default. For N > 200 events,
 * the adapter pre-indexes events by UTC-day bucket via `useMemo`, so a check
 * only scans events whose day bucket(s) intersect the proposed time range.
 * The index is rebuilt only when the `allEvents` reference changes.
 */

import { useCallback, useMemo, useRef } from 'react';
import { createConflictDetector } from '../../conflicts/conflictDetector';
import type { CalendarEvent } from '../../types';

/**
 * Result shape returned by the `check` method of `ConflictCheckAdapter`.
 *
 * Note: the design document's `ConflictCheckResult` defines `hasConflict` and
 * `conflictingEventIds`. We additionally expose `conflictCount` (derived) so
 * that accessibility callers (e.g. `ConflictIndicatorOverlay`) don't have to
 * compute `.length` at every render.
 */
export interface ConflictCheckResult {
  hasConflict: boolean;
  conflictingEventIds: string[];
  conflictCount: number;
}

export interface ConflictCheckAdapter {
  /** Check whether a proposed time range conflicts with any existing event. */
  check(
    eventId: string,
    proposedStart: Date,
    proposedEnd: Date,
    calendarAccountId: string,
  ): ConflictCheckResult;
}

/** Threshold above which the adapter switches to a day-bucketed index. */
const BUCKET_INDEX_THRESHOLD = 200;

/**
 * Format a Date as its UTC day key (`YYYY-MM-DD`).
 *
 * Using UTC avoids local-DST edge cases. Bucket membership is a conservative
 * index: callers unioning adjacent day buckets will still see all candidate
 * events. The actual overlap check (`detectConflicts`) is exact.
 */
function utcDayKey(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** One UTC-day, in milliseconds. */
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Build a Map<dayKey, CalendarEvent[]> that buckets every event into every
 * UTC day it spans (from `startTime` day through `endTime` day, inclusive).
 *
 * This correctly handles multi-day events: a week-long event appears in all
 * 7 of its day buckets, so a check for any day in that range finds it.
 *
 * To bound worst-case memory for pathological inputs, event spans are capped
 * at 30 days of buckets per event; events longer than 30 days fall back to
 * being bucketed only on their start day (and callers will still find them
 * via a linear scan fallback — see `check`).
 */
function buildDayBucketIndex(events: CalendarEvent[]): Map<string, CalendarEvent[]> {
  const index = new Map<string, CalendarEvent[]>();
  const MAX_SPAN_DAYS = 30;

  for (const event of events) {
    const startMs = event.startTime.getTime();
    const endMs = event.endTime.getTime();

    // Defensive: skip events with invalid time ranges.
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) continue;

    // Number of UTC-day boundaries the event touches.
    // We compare the day-of-year keys rather than raw ms so DST is a non-issue.
    const startDayMs = Date.UTC(
      event.startTime.getUTCFullYear(),
      event.startTime.getUTCMonth(),
      event.startTime.getUTCDate(),
    );
    const endDayMs = Date.UTC(
      event.endTime.getUTCFullYear(),
      event.endTime.getUTCMonth(),
      event.endTime.getUTCDate(),
    );
    const spanDays = Math.max(0, Math.round((endDayMs - startDayMs) / ONE_DAY_MS));

    if (spanDays > MAX_SPAN_DAYS) {
      // Pathologically long event: bucket only on start day. A linear fallback
      // in `check` is not needed because we simultaneously index such events
      // into a special "__all__" bucket that is always scanned.
      const startKey = utcDayKey(event.startTime);
      pushToBucket(index, startKey, event);
      pushToBucket(index, '__all__', event);
      continue;
    }

    for (let i = 0; i <= spanDays; i++) {
      const dayMs = startDayMs + i * ONE_DAY_MS;
      const key = utcDayKey(new Date(dayMs));
      pushToBucket(index, key, event);
    }
  }

  return index;
}

function pushToBucket(
  index: Map<string, CalendarEvent[]>,
  key: string,
  event: CalendarEvent,
): void {
  const existing = index.get(key);
  if (existing) {
    existing.push(event);
  } else {
    index.set(key, [event]);
  }
}

/**
 * Given a proposed time range and a day-bucket index, return the set of
 * candidate events that could possibly overlap. The caller is responsible
 * for running the exact overlap check on this candidate list.
 */
function candidatesForRange(
  index: Map<string, CalendarEvent[]>,
  proposedStart: Date,
  proposedEnd: Date,
): CalendarEvent[] {
  const startDayMs = Date.UTC(
    proposedStart.getUTCFullYear(),
    proposedStart.getUTCMonth(),
    proposedStart.getUTCDate(),
  );
  const endDayMs = Date.UTC(
    proposedEnd.getUTCFullYear(),
    proposedEnd.getUTCMonth(),
    proposedEnd.getUTCDate(),
  );
  const spanDays = Math.max(0, Math.round((endDayMs - startDayMs) / ONE_DAY_MS));

  // Dedupe events that appear in multiple day buckets.
  const seen = new Set<string>();
  const candidates: CalendarEvent[] = [];

  const collect = (bucket: CalendarEvent[] | undefined): void => {
    if (!bucket) return;
    for (const ev of bucket) {
      if (!seen.has(ev.id)) {
        seen.add(ev.id);
        candidates.push(ev);
      }
    }
  };

  // Always include the "__all__" bucket (pathologically long events).
  collect(index.get('__all__'));

  for (let i = 0; i <= spanDays; i++) {
    const dayMs = startDayMs + i * ONE_DAY_MS;
    const key = utcDayKey(new Date(dayMs));
    collect(index.get(key));
  }

  return candidates;
}

/**
 * Construct a synthetic `CalendarEvent` suitable for passing to
 * `ConflictDetector.detectConflicts`. Only the `id`, `calendarAccountId`,
 * `startTime`, and `endTime` fields drive conflict detection logic; all
 * other fields are populated with minimal valid defaults.
 */
function buildSyntheticEvent(
  eventId: string,
  proposedStart: Date,
  proposedEnd: Date,
  calendarAccountId: string,
): CalendarEvent {
  return {
    id: eventId,
    providerEventId: eventId,
    calendarAccountId,
    title: '',
    description: null,
    location: null,
    startTime: proposedStart,
    endTime: proposedEnd,
    timeZone: 'UTC',
    isAllDay: false,
    recurrenceRule: null,
    recurrenceExceptionDate: null,
    parentRecurringEventId: null,
    organizer: null,
    attendees: [],
    sequence: 0,
    dtstamp: proposedStart,
    status: 'confirmed',
    visibility: null,
    opaqueFields: new Map(),
    syncStatus: 'synced',
    localVersion: 0,
    remoteEtag: null,
    modifiedBy: null,
    createdAt: proposedStart,
    updatedAt: proposedStart,
  };
}

/**
 * Hook that creates a memoized `ConflictCheckAdapter` for the current
 * visible-events array. Returns a stable `check` function suitable for
 * passing to `useDragReschedule({ onConflictCheck })` and
 * `useDragResize({ onConflictCheck })`.
 *
 * The returned adapter object (and its `check` method) is referentially
 * stable across renders as long as `allEvents` is stable.
 */
export function useConflictCheckAdapter(
  allEvents: CalendarEvent[],
): ConflictCheckAdapter {
  // A single detector instance per hook call is kept in a ref so the same
  // detector is reused across every `check` invocation. This avoids the
  // allocation cost (conflict ID seed, scanning state) on every frame.
  const detectorRef = useRef<ReturnType<typeof createConflictDetector> | null>(null);
  if (detectorRef.current === null) {
    detectorRef.current = createConflictDetector();
  }

  // Pre-index by day bucket when there are enough events to make it
  // worthwhile. `useMemo` recomputes only when the `allEvents` reference
  // changes, matching the task's caching contract.
  const dayBucketIndex = useMemo<Map<string, CalendarEvent[]> | null>(() => {
    if (allEvents.length <= BUCKET_INDEX_THRESHOLD) return null;
    return buildDayBucketIndex(allEvents);
  }, [allEvents]);

  const check = useCallback(
    (
      eventId: string,
      proposedStart: Date,
      proposedEnd: Date,
      calendarAccountId: string,
    ): ConflictCheckResult => {
      const detector = detectorRef.current;
      // Should never be null because we initialize it above, but satisfy TS.
      if (detector === null) {
        return { hasConflict: false, conflictingEventIds: [], conflictCount: 0 };
      }

      const syntheticEvent = buildSyntheticEvent(
        eventId,
        proposedStart,
        proposedEnd,
        calendarAccountId,
      );

      // Use the pre-indexed candidate list when available; otherwise scan all.
      const candidateEvents =
        dayBucketIndex !== null
          ? candidatesForRange(dayBucketIndex, proposedStart, proposedEnd)
          : allEvents;

      const conflicts = detector.detectConflicts(syntheticEvent, candidateEvents);

      // Self-filter: for each Conflict, pick the "other" event id (the one
      // that is NOT the dragged event) and exclude conflicts where the other
      // id is also the dragged event (shouldn't happen but defends against
      // duplicates in allEvents).
      const conflictingEventIds: string[] = [];
      const seen = new Set<string>();

      for (const conflict of conflicts) {
        const otherId =
          conflict.eventA.id === eventId ? conflict.eventB.id : conflict.eventA.id;

        // A drag must not conflict with itself.
        if (otherId === eventId) continue;

        // Dedupe in case the same event appears twice in allEvents.
        if (seen.has(otherId)) continue;
        seen.add(otherId);

        conflictingEventIds.push(otherId);
      }

      return {
        hasConflict: conflictingEventIds.length > 0,
        conflictingEventIds,
        conflictCount: conflictingEventIds.length,
      };
    },
    [allEvents, dayBucketIndex],
  );

  // Wrap in a memoized object so the adapter's identity is stable and gesture
  // controllers that compare prop identity don't needlessly restart worklets.
  return useMemo<ConflictCheckAdapter>(() => ({ check }), [check]);
}
