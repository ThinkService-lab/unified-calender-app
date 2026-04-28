/**
 * Mutation hook for creating events with optimistic updates.
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

export interface CreateEventInput {
  accountId: string;
  event: RawEventData;
  /** Local CalendarEvent representation for optimistic store update */
  localEvent: CalendarEvent;
}

export interface UseCreateEventOptions {
  adapter: CalendarProviderAdapter;
  syncEngine?: SyncEngine;
}

/**
 * Mutation hook that creates an event on the provider,
 * optimistically updates the query cache and Zustand store,
 * and queues the change for sync.
 */
export function useCreateEvent({ adapter, syncEngine }: UseCreateEventOptions) {
  const queryClient = useQueryClient();

  return useMutation<string, Error, CreateEventInput>({
    mutationFn: ({ accountId, event }) =>
      adapter.createEvent(accountId, event),
    networkMode: 'offlineFirst',

    onMutate: async ({ accountId, localEvent }) => {
      // Cancel outgoing refetches so they don't overwrite our optimistic update
      await queryClient.cancelQueries({ queryKey: queryKeys.events.byAccount(accountId) });

      // Snapshot previous events queries for rollback
      const previousQueries = queryClient.getQueriesData<RawEventData[]>({
        queryKey: queryKeys.events.byAccount(accountId),
      });

      // Optimistically add to Zustand store
      useEventsStore.getState().addEvent({
        ...localEvent,
        syncStatus: 'pending_create',
      });

      // Queue for sync engine immediately (offline-first: persist intent before network call)
      if (syncEngine) {
        syncEngine.queueLocalChange({
          calendarAccountId: accountId,
          eventId: localEvent.id,
          operation: 'create',
          payload: JSON.stringify(localEvent),
        });
      }

      return { previousQueries, accountId };
    },

    onError: (_error, { accountId, localEvent }, context) => {
      // Rollback query cache
      if (context?.previousQueries) {
        for (const [queryKey, data] of context.previousQueries) {
          queryClient.setQueryData(queryKey, data);
        }
      }
      // Rollback Zustand store
      useEventsStore.getState().removeEvent(localEvent.id);
    },

    onSuccess: (_providerEventId, { accountId, localEvent }) => {
      // Update sync status in Zustand store — provider confirmed the create
      useEventsStore.getState().setSyncStatus(localEvent.id, 'synced');
    },

    onSettled: (_data, _error, { accountId }) => {
      // Invalidate to refetch fresh data
      queryClient.invalidateQueries({ queryKey: queryKeys.events.byAccount(accountId) });
    },
  });
}
