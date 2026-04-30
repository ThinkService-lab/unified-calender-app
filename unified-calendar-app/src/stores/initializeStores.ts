/**
 * Store initialization module.
 *
 * Wires the SQLite-backed storage adapter into all Zustand stores that use
 * the `persist` middleware. Must be called once at app startup (after the
 * database driver is ready) to ensure state survives app restarts.
 *
 * Without this initialization, the default store singletons use in-memory
 * storage only and lose state on restart.
 *
 * Requirements: 6.1 (offline store caches all events for offline access)
 */

import type { DatabaseDriver } from '../db/database';
import type { StateStorage } from 'zustand/middleware';
import { createSQLiteStorage, ensureKVTable } from './sqliteStorageAdapter';
import { createCalendarAccountsStore } from './calendarAccountsStore';
import { createEventsStore } from './eventsStore';
import { createSubscriptionStore } from './subscriptionStore';
import {
  createUIPreferencesStore,
  rebindDefaultUIPreferencesStore,
} from './uiPreferencesStore';
import type { CalendarAccountsState } from './calendarAccountsStore';
import type { EventsState } from './eventsStore';
import type { SubscriptionState } from './subscriptionStore';

export interface InitializedStores {
  calendarAccountsStore: ReturnType<typeof createCalendarAccountsStore>;
  eventsStore: ReturnType<typeof createEventsStore>;
  subscriptionStore: ReturnType<typeof createSubscriptionStore>;
  uiPreferencesStore: ReturnType<typeof createUIPreferencesStore>;
  storage: StateStorage;
}

/** Singleton reference so stores are only initialized once. */
let _initialized: InitializedStores | null = null;

/**
 * Initializes all persisted Zustand stores with the SQLite-backed storage adapter.
 *
 * Call this once during app bootstrap after the DatabaseDriver is ready.
 * Subsequent calls return the same stores (idempotent).
 */
export async function initializeStores(db: DatabaseDriver): Promise<InitializedStores> {
  if (_initialized) return _initialized;

  // Ensure the key-value table exists for the persist middleware
  await ensureKVTable(db);

  const storage = createSQLiteStorage(db);

  const calendarAccountsStore = createCalendarAccountsStore(storage);
  const eventsStore = createEventsStore(storage);
  const subscriptionStore = createSubscriptionStore(storage);
  const uiPreferencesStore = createUIPreferencesStore(storage);

  // Rebind the default `useUIPreferencesStore` singleton so consumers that
  // import the hook directly (e.g. `useTokens()`) pick up the SQLite-backed
  // instance without needing the InitializedStores reference.
  rebindDefaultUIPreferencesStore(uiPreferencesStore);

  _initialized = {
    calendarAccountsStore,
    eventsStore,
    subscriptionStore,
    uiPreferencesStore,
    storage,
  };

  return _initialized;
}

/**
 * Returns the initialized stores. Throws if `initializeStores` hasn't been called yet.
 * Use this in non-async contexts where you know initialization has already completed.
 */
export function getInitializedStores(): InitializedStores {
  if (!_initialized) {
    throw new Error(
      'Stores have not been initialized. Call initializeStores(db) during app bootstrap.',
    );
  }
  return _initialized;
}

/**
 * Resets the initialization state. Only use in tests.
 */
export function resetStoreInitialization(): void {
  _initialized = null;
}
