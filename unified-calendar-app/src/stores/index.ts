/**
 * Zustand stores - central export.
 * Requirements: 1.7, 1.8 (UI preferences), 2.1, 6.1 (offline cache)
 */

// Store initialization (must be called at app startup with a DatabaseDriver)
export { initializeStores, getInitializedStores, resetStoreInitialization } from './initializeStores';
export type { InitializedStores } from './initializeStores';

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
  useIsAccountHidden,
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
  useIsRecentlyArrivedFromSync,
  useIsPendingAnimatedDelete,
  RECENTLY_ARRIVED_TTL_MS,
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

// UI preferences store
export {
  useUIPreferencesStore,
  createUIPreferencesStore,
  useColorSchemePreference,
  useShortcutOverrides,
  useResolvedSystemScheme,
  useUIPreferences,
  installAppearanceListener,
  rebindDefaultUIPreferencesStore,
  useEnsureDefaultAppearanceListener,
} from './uiPreferencesStore';
export type {
  UIPreferences,
  ColorScheme,
  ResolvedSystemScheme,
  UIPreferencesStore,
} from './uiPreferencesStore';
