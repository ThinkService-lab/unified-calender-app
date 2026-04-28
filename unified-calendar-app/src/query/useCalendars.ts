/**
 * Query hook for fetching calendars from a provider.
 * Requirements: 4.1, 4.2
 */

import { useQuery } from '@tanstack/react-query';
import { queryKeys } from './queryKeys';
import { STALE_TIMES } from './queryClient';
import type { CalendarProviderAdapter, Calendar } from '../providers/types';

export interface UseCalendarsOptions {
  accountId: string;
  adapter: CalendarProviderAdapter;
  enabled?: boolean;
}

/**
 * Fetches the list of calendars for a given account.
 * Uses a 30-second staleTime since calendar lists change infrequently.
 */
export function useCalendars({ accountId, adapter, enabled = true }: UseCalendarsOptions) {
  return useQuery<Calendar[], Error>({
    queryKey: queryKeys.calendars.byAccount(accountId),
    queryFn: () => adapter.listCalendars(accountId),
    staleTime: STALE_TIMES.calendars,
    enabled,
  });
}
