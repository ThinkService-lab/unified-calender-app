/**
 * Web background sync using the Periodic Background Sync API.
 * Falls back to a no-op if the API is not available (most browsers).
 *
 * Requirements: 16.5
 *
 * The Periodic Background Sync API is only available in Chromium-based browsers
 * with a service worker. On unsupported browsers, register() returns false
 * and all operations are no-ops.
 */

import type {
  BackgroundSyncManager,
  BackgroundSyncConfig,
} from './backgroundSync';
import {
  BACKGROUND_SYNC_INTERVAL_SECONDS,
  BACKGROUND_SYNC_TASK_NAME,
} from './backgroundSync';

/** Milliseconds equivalent of the minimum interval */
const BACKGROUND_SYNC_INTERVAL_MS = BACKGROUND_SYNC_INTERVAL_SECONDS * 1000;

/**
 * Dependencies for the Web background sync handler.
 * Injected for testability — avoids direct dependency on browser APIs.
 */
export interface WebBackgroundSyncDeps {
  /** Get the active service worker registration, or null if unavailable */
  getServiceWorkerRegistration: () => Promise<ServiceWorkerRegistration | null>;
}

/**
 * Check if the Periodic Background Sync API is available on a registration.
 */
function hasPeriodicSync(
  registration: ServiceWorkerRegistration,
): registration is ServiceWorkerRegistration & {
  periodicSync: {
    register: (tag: string, options: { minInterval: number }) => Promise<void>;
    unregister: (tag: string) => Promise<void>;
    getTags: () => Promise<string[]>;
  };
} {
  return 'periodicSync' in registration;
}

/**
 * Creates a Web BackgroundSyncManager.
 * Uses the Periodic Background Sync API when available, otherwise no-op.
 */
export function createWebBackgroundSync(
  _config: BackgroundSyncConfig,
  deps: WebBackgroundSyncDeps,
): BackgroundSyncManager {
  let _isRegistered = false;

  return {
    async register(): Promise<boolean> {
      try {
        const registration = await deps.getServiceWorkerRegistration();
        if (!registration || !hasPeriodicSync(registration)) {
          // Periodic Background Sync not supported — no-op
          _isRegistered = false;
          return false;
        }

        await registration.periodicSync.register(BACKGROUND_SYNC_TASK_NAME, {
          minInterval: BACKGROUND_SYNC_INTERVAL_MS,
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
        const registration = await deps.getServiceWorkerRegistration();
        if (registration && hasPeriodicSync(registration)) {
          await registration.periodicSync.unregister(BACKGROUND_SYNC_TASK_NAME);
        }
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
