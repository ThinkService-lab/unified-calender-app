/**
 * iOS background sync using BackgroundFetch API.
 * Registers for periodic background fetch with a minimum 15-minute interval.
 *
 * Requirements: 16.5
 *
 * On background fetch trigger, calls the sync engine's syncAllPending() method
 * to synchronize any pending changes.
 */

import type {
  BackgroundSyncManager,
  BackgroundSyncConfig,
  BackgroundSyncResult,
} from './backgroundSync';
import {
  BACKGROUND_SYNC_INTERVAL_SECONDS,
  BACKGROUND_SYNC_TASK_NAME,
} from './backgroundSync';

/**
 * Dependencies for the iOS background sync handler.
 * Injected for testability — avoids direct dependency on expo-background-fetch.
 */
export interface IOSBackgroundSyncDeps {
  /** Define a background fetch task with a given name and executor */
  defineTask: (
    taskName: string,
    executor: () => Promise<BackgroundSyncResult>,
  ) => void;
  /** Register a background fetch task with the OS */
  registerTask: (
    taskName: string,
    options: { minimumInterval: number; stopOnTerminate?: boolean; startOnBoot?: boolean },
  ) => Promise<void>;
  /** Unregister a background fetch task */
  unregisterTask: (taskName: string) => Promise<void>;
  /** Check if a background fetch task is registered */
  isTaskRegistered: (taskName: string) => Promise<boolean>;
}

/**
 * Creates an iOS BackgroundSyncManager that uses BackgroundFetch.
 */
export function createIOSBackgroundSync(
  config: BackgroundSyncConfig,
  deps: IOSBackgroundSyncDeps,
): BackgroundSyncManager {
  const { syncEngine } = config;
  let _isRegistered = false;

  // Define the background task executor
  deps.defineTask(BACKGROUND_SYNC_TASK_NAME, async (): Promise<BackgroundSyncResult> => {
    try {
      const result = await syncEngine.syncAllPending();
      return result.syncedCount > 0 ? 'new-data' : 'no-data';
    } catch {
      return 'failed';
    }
  });

  return {
    async register(): Promise<boolean> {
      try {
        await deps.registerTask(BACKGROUND_SYNC_TASK_NAME, {
          minimumInterval: BACKGROUND_SYNC_INTERVAL_SECONDS,
          stopOnTerminate: false,
          startOnBoot: true,
        });
        _isRegistered = true;
        return true;
      } catch {
        _isRegistered = false;
        return false;
      }
    },

    async unregister(): Promise<void> {
      try {
        await deps.unregisterTask(BACKGROUND_SYNC_TASK_NAME);
      } catch {
        // Best-effort unregister
      }
      _isRegistered = false;
    },

    get isRegistered(): boolean {
      return _isRegistered;
    },
  };
}
