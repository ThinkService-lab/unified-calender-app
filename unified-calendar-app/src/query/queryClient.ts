/**
 * TanStack Query client configuration.
 * Configures staleTime, gcTime, and retry logic per query type.
 * Requirements: 4.1, 4.2
 */

import { QueryClient } from '@tanstack/react-query';

/** Stale times per query type */
export const STALE_TIMES = {
  calendars: 30_000,  // 30 seconds
  events: 10_000,     // 10 seconds
} as const;

/** Garbage collection time (how long inactive data stays in cache) */
export const GC_TIME = 5 * 60 * 1000; // 5 minutes

/** Retry configuration with exponential backoff */
function retryDelay(attemptIndex: number): number {
  return Math.min(1000 * 2 ** attemptIndex, 30_000);
}

export function createAppQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: STALE_TIMES.events,
        gcTime: GC_TIME,
        retry: 3,
        retryDelay,
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
      },
      mutations: {
        retry: 1,
        retryDelay,
      },
    },
  });
}

/** Default singleton query client */
export const appQueryClient = createAppQueryClient();
