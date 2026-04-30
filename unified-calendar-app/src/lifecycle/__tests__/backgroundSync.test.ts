/**
 * Unit tests for BackgroundSyncManager (all platforms).
 * Requirements: 16.5
 */

import type { SyncEngine, SyncResult, SyncState } from '../../sync/types';
import type { ChangeSet } from '../../providers/types';
import type { BackgroundSyncConfig, BackgroundSyncResult } from '../backgroundSync';
import {
  BACKGROUND_SYNC_INTERVAL_SECONDS,
  BACKGROUND_SYNC_TASK_NAME,
} from '../backgroundSync';
import {
  createIOSBackgroundSync,
  type IOSBackgroundSyncDeps,
} from '../backgroundSync.ios';
import {
  createAndroidBackgroundSync,
  type AndroidBackgroundSyncDeps,
} from '../backgroundSync.android';
import {
  createWebBackgroundSync,
  type WebBackgroundSyncDeps,
} from '../backgroundSync.web';

// ── Mock helpers ──

function createMockSyncEngine(overrides?: { syncedCount?: number; shouldFail?: boolean }) {
  const syncAllPending = jest.fn(async (): Promise<SyncResult> => {
    if (overrides?.shouldFail) {
      throw new Error('sync failed');
    }
    return {
      success: true,
      syncedCount: overrides?.syncedCount ?? 0,
      failedCount: 0,
      conflicts: [],
    };
  });

  return {
    state: 'Idle' as SyncState,
    pollingIntervalMs: 300_000,
    start: jest.fn(),
    stop: jest.fn(),
    queueLocalChange: jest.fn(),
    processOutboundQueue: jest.fn(async (): Promise<SyncResult> => ({
      success: true, syncedCount: 0, failedCount: 0, conflicts: [],
    })),
    handleWebhookNotification: jest.fn(async (): Promise<void> => {}),
    pollProvider: jest.fn(async (): Promise<ChangeSet> => ({
      created: [], updated: [], deleted: [], nextSyncToken: 'token',
    })),
    getConflicts: jest.fn(() => []),
    resolveConflict: jest.fn(async (): Promise<void> => {}),
    fullSync: jest.fn(async (): Promise<SyncResult> => ({
      success: true, syncedCount: 0, failedCount: 0, conflicts: [],
    })),
    syncAllPending,
  } as unknown as SyncEngine & { syncAllPending: jest.Mock };
}

function createMockNativeDeps() {
  let definedExecutor: (() => Promise<BackgroundSyncResult>) | null = null;

  const defineTask = jest.fn(
    (_name: string, executor: () => Promise<BackgroundSyncResult>) => {
      definedExecutor = executor;
    },
  );
  const registerTask = jest.fn(async () => {});
  const unregisterTask = jest.fn(async () => {});
  const isTaskRegistered = jest.fn(async () => false);

  return {
    defineTask,
    registerTask,
    unregisterTask,
    isTaskRegistered,
    /** Simulate the OS triggering the background task */
    triggerTask: async (): Promise<BackgroundSyncResult> => {
      if (!definedExecutor) throw new Error('No task defined');
      return definedExecutor();
    },
  };
}

// ── iOS Tests ──

describe('iOS BackgroundSyncManager', () => {
  function setup(syncOverrides?: { syncedCount?: number; shouldFail?: boolean }) {
    const syncEngine = createMockSyncEngine(syncOverrides);
    const deps = createMockNativeDeps();
    const config: BackgroundSyncConfig = { syncEngine };
    const manager = createIOSBackgroundSync(config, deps);
    return { syncEngine, deps, manager };
  }

  describe('register', () => {
    it('should register background fetch with 15-minute minimum interval', async () => {
      const { deps, manager } = setup();

      const result = await manager.register();

      expect(result).toBe(true);
      expect(manager.isRegistered).toBe(true);
      expect(deps.registerTask).toHaveBeenCalledWith(
        BACKGROUND_SYNC_TASK_NAME,
        expect.objectContaining({
          minimumInterval: BACKGROUND_SYNC_INTERVAL_SECONDS,
        }),
      );
    });

    it('should define the background task on creation', () => {
      const { deps } = setup();

      expect(deps.defineTask).toHaveBeenCalledWith(
        BACKGROUND_SYNC_TASK_NAME,
        expect.any(Function),
      );
    });

    it('should return false when registration fails', async () => {
      const { deps, manager } = setup();
      deps.registerTask.mockRejectedValueOnce(new Error('not supported'));

      const result = await manager.register();

      expect(result).toBe(false);
      expect(manager.isRegistered).toBe(false);
    });
  });

  describe('unregister', () => {
    it('should unregister the background fetch task', async () => {
      const { deps, manager } = setup();
      await manager.register();

      await manager.unregister();

      expect(deps.unregisterTask).toHaveBeenCalledWith(BACKGROUND_SYNC_TASK_NAME);
      expect(manager.isRegistered).toBe(false);
    });

    it('should handle unregister failure gracefully', async () => {
      const { deps, manager } = setup();
      await manager.register();
      deps.unregisterTask.mockRejectedValueOnce(new Error('failed'));

      await manager.unregister();

      expect(manager.isRegistered).toBe(false);
    });
  });

  describe('background task execution', () => {
    it('should call syncAllPending when background fetch triggers', async () => {
      const { syncEngine, deps } = setup({ syncedCount: 3 });

      const result = await deps.triggerTask();

      expect(syncEngine.syncAllPending).toHaveBeenCalledTimes(1);
      expect(result).toBe('new-data');
    });

    it('should return no-data when nothing was synced', async () => {
      const { deps } = setup({ syncedCount: 0 });

      const result = await deps.triggerTask();

      expect(result).toBe('no-data');
    });

    it('should return failed when sync throws', async () => {
      const { deps } = setup({ shouldFail: true });

      const result = await deps.triggerTask();

      expect(result).toBe('failed');
    });
  });
});

// ── Android Tests ──

describe('Android BackgroundSyncManager', () => {
  function setup(syncOverrides?: { syncedCount?: number; shouldFail?: boolean }) {
    const syncEngine = createMockSyncEngine(syncOverrides);
    const deps = createMockNativeDeps();
    const config: BackgroundSyncConfig = { syncEngine };
    const manager = createAndroidBackgroundSync(config, deps);
    return { syncEngine, deps, manager };
  }

  describe('register', () => {
    it('should register WorkManager periodic sync with 15-minute minimum interval', async () => {
      const { deps, manager } = setup();

      const result = await manager.register();

      expect(result).toBe(true);
      expect(manager.isRegistered).toBe(true);
      expect(deps.registerTask).toHaveBeenCalledWith(
        BACKGROUND_SYNC_TASK_NAME,
        expect.objectContaining({
          minimumInterval: BACKGROUND_SYNC_INTERVAL_SECONDS,
          stopOnTerminate: false,
          startOnBoot: true,
        }),
      );
    });

    it('should define the background task on creation', () => {
      const { deps } = setup();

      expect(deps.defineTask).toHaveBeenCalledWith(
        BACKGROUND_SYNC_TASK_NAME,
        expect.any(Function),
      );
    });

    it('should return false when registration fails', async () => {
      const { deps, manager } = setup();
      deps.registerTask.mockRejectedValueOnce(new Error('not supported'));

      const result = await manager.register();

      expect(result).toBe(false);
      expect(manager.isRegistered).toBe(false);
    });
  });

  describe('unregister', () => {
    it('should cancel the WorkManager periodic work request', async () => {
      const { deps, manager } = setup();
      await manager.register();

      await manager.unregister();

      expect(deps.unregisterTask).toHaveBeenCalledWith(BACKGROUND_SYNC_TASK_NAME);
      expect(manager.isRegistered).toBe(false);
    });

    it('should handle unregister failure gracefully', async () => {
      const { deps, manager } = setup();
      await manager.register();
      deps.unregisterTask.mockRejectedValueOnce(new Error('failed'));

      await manager.unregister();

      expect(manager.isRegistered).toBe(false);
    });
  });

  describe('background task execution', () => {
    it('should call syncAllPending when WorkManager triggers', async () => {
      const { syncEngine, deps } = setup({ syncedCount: 5 });

      const result = await deps.triggerTask();

      expect(syncEngine.syncAllPending).toHaveBeenCalledTimes(1);
      expect(result).toBe('new-data');
    });

    it('should return no-data when nothing was synced', async () => {
      const { deps } = setup({ syncedCount: 0 });

      const result = await deps.triggerTask();

      expect(result).toBe('no-data');
    });

    it('should return failed when sync throws', async () => {
      const { deps } = setup({ shouldFail: true });

      const result = await deps.triggerTask();

      expect(result).toBe('failed');
    });
  });
});

// ── Web Tests ──

describe('Web BackgroundSyncManager', () => {
  function createMockPeriodicSync() {
    const registeredTags = new Set<string>();
    return {
      register: jest.fn(async (tag: string) => {
        registeredTags.add(tag);
      }),
      unregister: jest.fn(async (tag: string) => {
        registeredTags.delete(tag);
      }),
      getTags: jest.fn(async () => Array.from(registeredTags)),
      _registeredTags: registeredTags,
    };
  }

  function setup(options?: { hasPeriodicSync?: boolean; registrationAvailable?: boolean }) {
    const hasPeriodicSync = options?.hasPeriodicSync ?? true;
    const registrationAvailable = options?.registrationAvailable ?? true;
    const periodicSync = createMockPeriodicSync();

    const mockRegistration = registrationAvailable
      ? (hasPeriodicSync
          ? { periodicSync } as unknown as ServiceWorkerRegistration
          : {} as ServiceWorkerRegistration)
      : null;

    const deps: WebBackgroundSyncDeps = {
      getServiceWorkerRegistration: jest.fn(async () => mockRegistration),
    };

    const syncEngine = createMockSyncEngine();
    const config: BackgroundSyncConfig = { syncEngine };
    const manager = createWebBackgroundSync(config, deps);

    return { syncEngine, deps, manager, periodicSync };
  }

  describe('register', () => {
    it('should register periodic sync when API is available', async () => {
      const { manager, periodicSync } = setup({ hasPeriodicSync: true });

      const result = await manager.register();

      expect(result).toBe(true);
      expect(manager.isRegistered).toBe(true);
      expect(periodicSync.register).toHaveBeenCalledWith(
        BACKGROUND_SYNC_TASK_NAME,
        { minInterval: BACKGROUND_SYNC_INTERVAL_SECONDS * 1000 },
      );
    });

    it('should return false when Periodic Background Sync API is not available', async () => {
      const { manager } = setup({ hasPeriodicSync: false });

      const result = await manager.register();

      expect(result).toBe(false);
      expect(manager.isRegistered).toBe(false);
    });

    it('should return false when no service worker registration is available', async () => {
      const { manager } = setup({ registrationAvailable: false });

      const result = await manager.register();

      expect(result).toBe(false);
      expect(manager.isRegistered).toBe(false);
    });

    it('should return false when registration throws', async () => {
      const { manager, periodicSync } = setup({ hasPeriodicSync: true });
      periodicSync.register.mockRejectedValueOnce(new Error('not allowed'));

      const result = await manager.register();

      expect(result).toBe(false);
      expect(manager.isRegistered).toBe(false);
    });
  });

  describe('unregister', () => {
    it('should unregister periodic sync when API is available', async () => {
      const { manager, periodicSync } = setup({ hasPeriodicSync: true });
      await manager.register();

      await manager.unregister();

      expect(periodicSync.unregister).toHaveBeenCalledWith(BACKGROUND_SYNC_TASK_NAME);
      expect(manager.isRegistered).toBe(false);
    });

    it('should handle unregister gracefully when API is not available', async () => {
      const { manager } = setup({ hasPeriodicSync: false });

      await manager.unregister();

      expect(manager.isRegistered).toBe(false);
    });

    it('should handle unregister gracefully when no service worker', async () => {
      const { manager } = setup({ registrationAvailable: false });

      await manager.unregister();

      expect(manager.isRegistered).toBe(false);
    });
  });
});

// ── Shared constant tests ──

describe('Background sync constants', () => {
  it('should have a 15-minute minimum interval in seconds', () => {
    expect(BACKGROUND_SYNC_INTERVAL_SECONDS).toBe(900);
  });

  it('should have a consistent task name', () => {
    expect(BACKGROUND_SYNC_TASK_NAME).toBe('com.unified-calendar.background-sync');
  });
});
