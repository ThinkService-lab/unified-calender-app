/**
 * Centralized query key factory for TanStack Query.
 * Structured as arrays for proper invalidation granularity.
 * Requirements: 4.1, 4.2
 */

export const queryKeys = {
  calendars: {
    all: ['calendars'] as const,
    byAccount: (accountId: string) => ['calendars', accountId] as const,
  },
  events: {
    all: ['events'] as const,
    byAccount: (accountId: string) => ['events', accountId] as const,
    byRange: (accountId: string, start: string, end: string) =>
      ['events', accountId, start, end] as const,
  },
} as const;
