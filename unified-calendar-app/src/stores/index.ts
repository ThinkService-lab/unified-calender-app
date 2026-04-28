/**
 * Zustand stores - central export.
 * Requirements: 2.1, 6.1
 */

// Storage adapter
export { createSQLiteStorage, ensureKVTable } from './sqliteStorageAdapter';

// Calendar accounts store
export {
  useCalendarAccountsStore,
  createCalendarAccountsStore,
  useAccountIds,
  useAccount,
  useAccountCount,
  useAccountSummary,
} from './calendarAccountsStore';
export type { CalendarAccountsState } from './calendarAccountsStore';

// Events store
export {
  useEventsStore,
  createEventsStore,
  useEventIds,
  useEvent,
  useEventCount,
  useEventSummary,
} from './eventsStore';
export type { EventsState, EventSyncStatus } from './eventsStore';

// Sync status store (vanilla)
export {
  syncStatusStore,
  useSyncStatusStore,
  useSyncStatusRef,
  useAccountSyncStatusRef,
} from './syncStatusStore';
export type { SyncStatusState, AccountSyncInfo } from './syncStatusStore';

// Subscription store
export {
  useSubscriptionStore,
  createSubscriptionStore,
  useTier,
  useIsProOrAbove,
  useSubscriptionSummary,
  TIER_FEATURES,
} from './subscriptionStore';
export type { SubscriptionState } from './subscriptionStore';
