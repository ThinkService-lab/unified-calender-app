/**
 * Background sync shared types and interface.
 * Defines the BackgroundSyncManager contract for platform-specific implementations.
 *
 * Requirements: 16.5
 */

import type { SyncEngine } from '../sync/types';

/** Minimum background fetch interval in seconds (15 minutes) */
export const BACKGROUND_SYNC_INTERVAL_SECONDS = 15 * 60;

/** Background sync task identifier used across platforms */
export const BACKGROUND_SYNC_TASK_NAME = 'com.unified-calendar.background-sync';

/** Result of a background sync execution */
export type BackgroundSyncResult = 'new-data' | 'no-data' | 'failed';

/**
 * Configuration for the BackgroundSyncManager.
 * The sync engine is injected so the background task can call syncAllPending().
 */
export interface BackgroundSyncConfig {
  /** The sync engine instance to call syncAllPending() on background fetch */
  syncEngine: SyncEngine;
}

/**
 * Platform-specific background sync manager interface.
 * Each platform (iOS/Android/Web) implements this to handle
 * background fetch registration and execution.
 *
 * - iOS: uses expo-background-fetch / BackgroundFetch API
 * - Android: uses WorkManager for periodic sync
 * - Web: uses Periodic Background Sync API or no-op fallback
 */
export interface BackgroundSyncManager {
  /** Register for periodic background sync with a minimum 15-minute interval */
  register(): Promise<boolean>;
  /** Unregister background sync */
  unregister(): Promise<void>;
  /** Whether background sync is currently registered */
  readonly isRegistered: boolean;
}
