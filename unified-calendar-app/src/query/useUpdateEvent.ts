/**
 * Mutation hook for updating events with optimistic updates.
 * Updates both the TanStack Query cache and the Zustand events store.
 * Queues local changes via the sync engine for outbound push.
 * Requirements: 4.1, 4.2
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from './queryKeys';
import { useEventsStore } from '../stores/eventsStore';
import type { CalendarProviderAdapter, RawEventData } from '../providers/types';
import type { CalendarEvent } from '../types/models';
import type { SyncEngine } from '../sync/types';

export interface UpdateEventInput {
  accountId: string;
  eventId: string;
  event: RawEventData;
  /** Partial local updates for optimistic Zustand store update */
  localUpdates: Partial<CalendarEvent>;
}

export interface UseUpdateEventOptions {
  adapter: CalendarProviderAdapter;
  syncEngine?: SyncEngine;
}

/**
 * Mutation hook that updates an event on the provider,
 * optimistically updates the query cache and Zustand store,
 * and queues the change for sync.
 */
export function useUpdateEvent({ adapter, syncEngine }: UseUpdateEventOptions) {
  const queryClient = useQueryClient();

  return useMutation<void, Error, UpdateEventInput>({
    mutationFn: ({ accountId, eventId, event }) =>
      adapter.updateEvent(accountId, eventId, event),
    networkMode: 'offlineFirst',

    onMutate: async ({ accountId, eventId, localUpdates }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.events.byAccount(accountId) });

      // Snapshot previous events queries for rollback
      const previousQueries = queryClient.getQueriesData<RawEventData[]>({
        queryKey: queryKeys.events.byAccount(accountId),
      });

      // Snapshot previous Zustand state for rollback
      const previousEvent = useEventsStore.getState().events[eventId];

      // Optimistically update Zustand store
      useEventsStore.getState().updateEvent(eventId, {
        ...localUpdates,
        syncStatus: 'pending_update',
      });

      // Queue for sync engine immediately (offline-first: persist intent before network call)
      if (syncEngine) {
        syncEngine.queueLocalChange({
          calendarAccountId: accountId,
          eventId,
          operation: 'update',
          payload: JSON.stringify(localUpdates),
        });
      }

      return { previousQueries, previousEvent, accountId };
    },

    onError: (_error, { accountId, eventId }, context) => {
      // Rollback query cache
      if (context?.previousQueries) {
        for (const [queryKey, data] of context.previousQueries) {
          queryClient.setQueryData(queryKey, data);
        }
      }
      // Rollback Zustand store
      if (context?.previousEvent) {
        useEventsStore.getState().updateEvent(eventId, context.previousEvent);
      }
    },

    onSuccess: (_data, { accountId, eventId }) => {
      // Mark as synced — provider confirmed the update
      useEventsStore.getState().setSyncStatus(eventId, 'synced');
    },

    onSettled: (_data, _error, { accountId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.events.byAccount(accountId) });
    },
  });
}
