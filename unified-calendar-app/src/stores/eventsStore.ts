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

export interface EventsState {
  events: Record<string, CalendarEvent>;
  eventIds: string[];

  // Actions
  addEvent: (event: CalendarEvent) => void;
  addEvents: (events: CalendarEvent[]) => void;
  removeEvent: (id: string) => void;
  updateEvent: (id: string, updates: Partial<CalendarEvent>) => void;
  setSyncStatus: (id: string, status: EventSyncStatus) => void;
  removeEventsByAccount: (calendarAccountId: string) => void;

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

      clear: () => set(initialState),
        })),
        {
          name: 'events-storage',
          storage: storage ? createJSONStorage(() => storage) : undefined,
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
