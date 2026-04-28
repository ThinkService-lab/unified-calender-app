/**
 * Mutation hook for deleting events with optimistic updates.
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

export interface DeleteEventInput {
  accountId: string;
  eventId: string;
}

export interface UseDeleteEventOptions {
  adapter: CalendarProviderAdapter;
  syncEngine?: SyncEngine;
}

/**
 * Mutation hook that deletes an event on the provider,
 * optimistically removes it from the query cache and Zustand store,
 * and queues the change for sync.
 */
export function useDeleteEvent({ adapter, syncEngine }: UseDeleteEventOptions) {
  const queryClient = useQueryClient();

  return useMutation<void, Error, DeleteEventInput>({
    mutationFn: ({ accountId, eventId }) =>
      adapter.deleteEvent(accountId, eventId),
    networkMode: 'offlineFirst',

    onMutate: async ({ accountId, eventId }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.events.byAccount(accountId) });

      // Snapshot previous events queries for rollback
      const previousQueries = queryClient.getQueriesData<RawEventData[]>({
        queryKey: queryKeys.events.byAccount(accountId),
      });

      // Snapshot previous Zustand state for rollback
      const previousEvent = useEventsStore.getState().events[eventId];

      // Optimistically update sync status then remove from store
      useEventsStore.getState().setSyncStatus(eventId, 'pending_delete');
      useEventsStore.getState().removeEvent(eventId);

      // Queue for sync engine immediately (offline-first: persist intent before network call)
      if (syncEngine) {
        syncEngine.queueLocalChange({
          calendarAccountId: accountId,
          eventId,
          operation: 'delete',
          payload: '{}',
        });
      }

      return { previousQueries, previousEvent, accountId };
    },

    onError: (_error, { accountId }, context) => {
      // Rollback query cache
      if (context?.previousQueries) {
        for (const [queryKey, data] of context.previousQueries) {
          queryClient.setQueryData(queryKey, data);
        }
      }
      // Rollback Zustand store — re-add the event
      if (context?.previousEvent) {
        useEventsStore.getState().addEvent(context.previousEvent);
      }
    },

    onSuccess: (_data, { accountId, eventId }) => {
      // No additional action needed — sync engine was already queued in onMutate
    },

    onSettled: (_data, _error, { accountId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.events.byAccount(accountId) });
    },
  });
}
