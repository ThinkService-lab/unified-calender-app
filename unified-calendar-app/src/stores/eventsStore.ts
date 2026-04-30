/**
 * Events Zustand store with time-range queries and sync status tracking.
 * Uses immer + devtools middleware.
 * Requirements: 2.1, 6.1
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { devtools } from 'zustand/middleware';
import { useShallow } from 'zustand/react/shallow';
import type { CalendarEvent } from '../types/models';
import type { StateStorage } from 'zustand/middleware';

export type EventSyncStatus = CalendarEvent['syncStatus'];

/**
 * How long a newly-arrived-from-sync event ID stays in the
 * `recentlyArrivedFromSync` set before auto-expiry. Matches the
 * `syncAppear` animation duration plus a small buffer so the EventCard
 * finishes the slide-in before the flag clears.
 */
export const RECENTLY_ARRIVED_TTL_MS = 1000;

export interface EventsState {
  events: Record<string, CalendarEvent>;
  eventIds: string[];

  /**
   * Transient (NOT persisted) set of event IDs that arrived from a sync
   * pull operation within the last {@link RECENTLY_ARRIVED_TTL_MS}
   * milliseconds. Drives the `syncAppear` micro-interaction on EventCards
   * — see `src/ui/animation/microInteractions.ts`.
   *
   * Requirement: 7.4
   */
  recentlyArrivedFromSync: ReadonlySet<string>;

  /**
   * Transient (NOT persisted) set of event IDs currently playing the
   * `eventDeleted` animation. The `useAnimatedEventDelete` hook adds an
   * id to this set before awaiting the animation, then calls
   * `EventCRUDService.deleteEvent` which removes the event from the
   * store — unmounting the EventCard after the animation completes.
   *
   * Requirement: 7.3
   */
  pendingAnimatedDelete: ReadonlySet<string>;

  // Actions
  addEvent: (event: CalendarEvent) => void;
  addEvents: (events: CalendarEvent[]) => void;
  removeEvent: (id: string) => void;
  updateEvent: (id: string, updates: Partial<CalendarEvent>) => void;
  setSyncStatus: (id: string, status: EventSyncStatus) => void;
  removeEventsByAccount: (calendarAccountId: string) => void;

  /**
   * Flag the given event IDs as "just arrived from sync" so EventCards
   * observing this field via {@link useIsRecentlyArrivedFromSync} can
   * play the `syncAppear` animation. IDs are automatically cleared
   * after {@link RECENTLY_ARRIVED_TTL_MS} ms via a scheduled timer, so
   * the set does not grow unbounded.
   */
  markArrivedFromSync: (ids: string[]) => void;

  /** Flag an event as about to be deleted (triggers shrink+fade). */
  markPendingAnimatedDelete: (eventId: string) => void;

  /** Clear a pending delete flag (used on failure to revert visuals). */
  clearPendingAnimatedDelete: (eventId: string) => void;

  // Queries
  getEventsByTimeRange: (start: Date, end: Date) => CalendarEvent[];
  getEventsByAccount: (calendarAccountId: string) => CalendarEvent[];
  getEventsBySyncStatus: (status: EventSyncStatus) => CalendarEvent[];
  getPendingEvents: () => CalendarEvent[];

  clear: () => void;
}

const initialState = {
  events: {} as Record<string, CalendarEvent>,
  eventIds: [] as string[],
  recentlyArrivedFromSync: new Set<string>() as ReadonlySet<string>,
  pendingAnimatedDelete: new Set<string>() as ReadonlySet<string>,
};

/**
 * Creates the events store.
 * Accepts an optional custom storage for persist middleware (defaults to no-op for testing).
 */
export function createEventsStore(storage?: StateStorage) {
  return create<EventsState>()(
    devtools(
      persist(
        immer((set, get) => ({
          ...initialState,

      addEvent: (event: CalendarEvent) =>
        set((state) => {
          state.events[event.id] = event;
          if (!state.eventIds.includes(event.id)) {
            state.eventIds.push(event.id);
          }
        }),

      addEvents: (events: CalendarEvent[]) =>
        set((state) => {
          for (const event of events) {
            state.events[event.id] = event;
            if (!state.eventIds.includes(event.id)) {
              state.eventIds.push(event.id);
            }
          }
        }),

      removeEvent: (id: string) =>
        set((state) => {
          delete state.events[id];
          state.eventIds = state.eventIds.filter((eid) => eid !== id);
        }),

      updateEvent: (id: string, updates: Partial<CalendarEvent>) =>
        set((state) => {
          if (state.events[id]) {
            Object.assign(state.events[id], updates);
          }
        }),

      setSyncStatus: (id: string, status: EventSyncStatus) =>
        set((state) => {
          if (state.events[id]) {
            state.events[id].syncStatus = status;
          }
        }),

      removeEventsByAccount: (calendarAccountId: string) =>
        set((state) => {
          const idsToRemove = state.eventIds.filter(
            (eid) => state.events[eid]?.calendarAccountId === calendarAccountId
          );
          for (const id of idsToRemove) {
            delete state.events[id];
          }
          state.eventIds = state.eventIds.filter((eid) => !idsToRemove.includes(eid));
        }),

      getEventsByTimeRange: (start: Date, end: Date) => {
        const { events } = get();
        const startMs = start.getTime();
        const endMs = end.getTime();
        return Object.values(events).filter(
          (e) => e.startTime.getTime() < endMs && e.endTime.getTime() > startMs
        );
      },

      getEventsByAccount: (calendarAccountId: string) => {
        const { events } = get();
        return Object.values(events).filter((e) => e.calendarAccountId === calendarAccountId);
      },

      getEventsBySyncStatus: (status: EventSyncStatus) => {
        const { events } = get();
        return Object.values(events).filter((e) => e.syncStatus === status);
      },

      getPendingEvents: () => {
        const { events } = get();
        return Object.values(events).filter((e) =>
          e.syncStatus === 'pending_create' ||
          e.syncStatus === 'pending_update' ||
          e.syncStatus === 'pending_delete'
        );
      },

      /**
       * Add each id to `recentlyArrivedFromSync` and schedule its
       * removal after {@link RECENTLY_ARRIVED_TTL_MS} milliseconds via
       * `setTimeout`. Called by the sync/query wiring when remote events
       * arrive from a pull operation — NOT for user-created events.
       */
      markArrivedFromSync: (ids: string[]) =>
        set((state) => {
          // Immer wraps ReadonlySet as a normal Set so we can mutate.
          const next = new Set(state.recentlyArrivedFromSync);
          for (const id of ids) next.add(id);
          state.recentlyArrivedFromSync = next;
          // Schedule expiry outside of the immer producer — setTimeout
          // here references the live store via closure over `set`/`get`.
          for (const id of ids) {
            setTimeout(() => {
              set((s) => {
                const pruned = new Set(s.recentlyArrivedFromSync);
                pruned.delete(id);
                s.recentlyArrivedFromSync = pruned;
              });
            }, RECENTLY_ARRIVED_TTL_MS);
          }
        }),

      markPendingAnimatedDelete: (eventId: string) =>
        set((state) => {
          const next = new Set(state.pendingAnimatedDelete);
          next.add(eventId);
          state.pendingAnimatedDelete = next;
        }),

      clearPendingAnimatedDelete: (eventId: string) =>
        set((state) => {
          const next = new Set(state.pendingAnimatedDelete);
          next.delete(eventId);
          state.pendingAnimatedDelete = next;
        }),

      clear: () => set(initialState),
        })),
        {
          name: 'events-storage',
          storage: storage ? createJSONStorage(() => storage) : undefined,
          // Transient tracking sets are NOT persisted — they are
          // purely UI-cycle state that would otherwise replay stale
          // `syncAppear` / `eventDeleted` animations on app startup.
          partialize: (state) => ({
            events: state.events,
            eventIds: state.eventIds,
          }),
        }
      ),
      { name: 'EventsStore', enabled: process.env.NODE_ENV !== 'production' }
    )
  );
}

/** Default store instance (created without persistence for import convenience) */
export const useEventsStore = createEventsStore();

/** Atomic selector hooks */
export const useEventIds = () => useEventsStore((s) => s.eventIds);
export const useEvent = (id: string) => useEventsStore((s) => s.events[id]);
export const useEventCount = () => useEventsStore((s) => s.eventIds.length);

/**
 * Returns `true` when the event with the given id arrived from a sync
 * pull within the last {@link RECENTLY_ARRIVED_TTL_MS} ms. EventCards
 * use this flag to trigger the `syncAppear` animation.
 *
 * Requirement: 7.4
 */
export const useIsRecentlyArrivedFromSync = (eventId: string) =>
  useEventsStore((s) => s.recentlyArrivedFromSync.has(eventId));

/**
 * Returns `true` when the event with the given id is currently playing
 * the `eventDeleted` animation. EventCards use this flag to trigger
 * shrink + fade before the event is removed from the store.
 *
 * Requirement: 7.3
 */
export const useIsPendingAnimatedDelete = (eventId: string) =>
  useEventsStore((s) => s.pendingAnimatedDelete.has(eventId));

/** Multi-field selector with useShallow */
export const useEventSummary = (id: string) =>
  useEventsStore(
    useShallow((s) => {
      const event = s.events[id];
      if (!event) return null;
      return {
        title: event.title,
        startTime: event.startTime,
        endTime: event.endTime,
        syncStatus: event.syncStatus,
        calendarAccountId: event.calendarAccountId,
      };
    })
  );
