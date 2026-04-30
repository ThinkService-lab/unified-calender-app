/**
 * Android background sync using WorkManager for periodic sync.
 * Registers a periodic work request with a minimum 15-minute interval.
 *
 * Requirements: 16.5
 *
 * On background sync trigger, calls the sync engine's syncAllPending() method
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
 * Dependencies for the Android background sync handler.
 * Injected for testability — avoids direct dependency on native WorkManager bindings.
 */
export interface AndroidBackgroundSyncDeps {
  /** Define a background task with a given name and executor */
  defineTask: (
    taskName: string,
    executor: () => Promise<BackgroundSyncResult>,
  ) => void;
  /** Register a periodic work request with WorkManager */
  registerTask: (
    taskName: string,
    options: { minimumInterval: number; stopOnTerminate?: boolean; startOnBoot?: boolean },
  ) => Promise<void>;
  /** Cancel a periodic work request */
  unregisterTask: (taskName: string) => Promise<void>;
  /** Check if a periodic work request is enqueued */
  isTaskRegistered: (taskName: string) => Promise<boolean>;
}

/**
 * Creates an Android BackgroundSyncManager that uses WorkManager.
 */
export function createAndroidBackgroundSync(
  config: BackgroundSyncConfig,
  deps: AndroidBackgroundSyncDeps,
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
