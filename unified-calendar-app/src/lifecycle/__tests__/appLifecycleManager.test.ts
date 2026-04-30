/**
 * Unit tests for AppLifecycleManager.
 * Requirements: 16.1, 16.2, 16.3, 16.4, 16.6
 */

import {
  createAppLifecycleManager,
  type AppLifecycleManagerConfig,
  type WebSocketManager,
  type AppStateListener,
  type AppLifecycleState,
} from '../appLifecycleManager';
import type { DatabaseDriver } from '../../db/database';
import type { SyncEngine, SyncState, SyncResult } from '../../sync/types';
import type { ChangeSet } from '../../providers/types';

// ── Mock helpers ──

function createMockDb() {
  const executedSql: string[] = [];
  const queryResults: Record<string, unknown>[] = [];

  const execute = jest.fn(async (sql: string): Promise<void> => {
    executedSql.push(sql);
  });

  const query = jest.fn(async (): Promise<Record<string, unknown>[]> => {
    return queryResults;
  });

  const close = jest.fn(async (): Promise<void> => {});
  const isOpen = jest.fn((): boolean => true);

  return {
    execute,
    query,
    close,
    isOpen,
    executedSql,
    queryResults,
  } as unknown as DatabaseDriver & {
    execute: jest.Mock;
    query: jest.Mock;
    close: jest.Mock;
    isOpen: jest.Mock;
    executedSql: string[];
    queryResults: Record<string, unknown>[];
  };
}

function createMockSyncEngine(overrides?: Partial<{ state: SyncState }>) {
  let state: SyncState = overrides?.state ?? 'Idle';

  const start = jest.fn();
  const stop = jest.fn();
  const queueLocalChange = jest.fn();
  const processOutboundQueue = jest.fn(async (): Promise<SyncResult> => ({
    success: true,
    syncedCount: 0,
    failedCount: 0,
    conflicts: [],
  }));
  const handleWebhookNotification = jest.fn(async (): Promise<void> => {});
  const pollProvider = jest.fn(async (): Promise<ChangeSet> => ({
    created: [],
    updated: [],
    deleted: [],
    nextSyncToken: 'token',
  }));
  const getConflicts = jest.fn(() => []);
  const resolveConflict = jest.fn(async (): Promise<void> => {});
  const fullSync = jest.fn(async (): Promise<SyncResult> => ({
    success: true,
    syncedCount: 0,
    failedCount: 0,
    conflicts: [],
  }));
  const syncAllPending = jest.fn(async (): Promise<SyncResult> => ({
    success: true,
    syncedCount: 0,
    failedCount: 0,
    conflicts: [],
  }));

  return {
    get state() {
      return state;
    },
    set state(s: SyncState) {
      state = s;
    },
    pollingIntervalMs: 300_000,
    start,
    stop,
    queueLocalChange,
    processOutboundQueue,
    handleWebhookNotification,
    pollProvider,
    getConflicts,
    resolveConflict,
    fullSync,
    syncAllPending,
  } as unknown as SyncEngine & {
    start: jest.Mock;
    stop: jest.Mock;
    queueLocalChange: jest.Mock;
    processOutboundQueue: jest.Mock;
    handleWebhookNotification: jest.Mock;
    pollProvider: jest.Mock;
    getConflicts: jest.Mock;
    resolveConflict: jest.Mock;
    fullSync: jest.Mock;
    syncAllPending: jest.Mock;
    state: SyncState;
  };
}

function createMockWebSocketManager() {
  let connected = false;

  const connect = jest.fn(async (): Promise<void> => {
    connected = true;
  });
  const disconnect = jest.fn(async (): Promise<void> => {
    connected = false;
  });
  const isConnected = jest.fn((): boolean => connected);

  return {
    connect,
    disconnect,
    isConnected,
  } as unknown as WebSocketManager & {
    connect: jest.Mock;
    disconnect: jest.Mock;
    isConnected: jest.Mock;
  };
}

function createMockAppStateListener(initialState: AppLifecycleState = 'active') {
  const callbacks: Array<(state: AppLifecycleState) => void> = [];

  const addEventListener = jest.fn(
    (callback: (state: AppLifecycleState) => void): (() => void) => {
      callbacks.push(callback);
      return () => {
        const idx = callbacks.indexOf(callback);
        if (idx >= 0) callbacks.splice(idx, 1);
      };
    },
  );
  const currentState = jest.fn((): AppLifecycleState => initialState);

  function simulateStateChange(state: AppLifecycleState): void {
    for (const cb of callbacks) {
      cb(state);
    }
  }

  return {
    addEventListener,
    currentState,
    simulateStateChange,
    get _callbacks() {
      return callbacks;
    },
  } as AppStateListener & {
    addEventListener: jest.Mock;
    currentState: jest.Mock;
    simulateStateChange: (state: AppLifecycleState) => void;
    _callbacks: Array<(state: AppLifecycleState) => void>;
  };
}

function createConfig(overrides?: Partial<{
  syncEngineState: SyncState;
  initialAppState: AppLifecycleState;
  deltaSyncTimeoutMs: number;
  pendingEntries: Record<string, unknown>[];
}>) {
  const mockDb = createMockDb();
  if (overrides?.pendingEntries) {
    (mockDb as any).queryResults.push(...overrides.pendingEntries);
  }
  const mockSyncEngine = createMockSyncEngine({
    state: overrides?.syncEngineState,
  });
  const mockWs = createMockWebSocketManager();
  const mockAppState = createMockAppStateListener(
    overrides?.initialAppState ?? 'active',
  );

  return {
    db: mockDb as unknown as DatabaseDriver,
    syncEngine: mockSyncEngine as unknown as SyncEngine,
    webSocketManager: mockWs as unknown as WebSocketManager,
    appStateListener: mockAppState as unknown as AppStateListener,
    deltaSyncTimeoutMs: overrides?.deltaSyncTimeoutMs,
    mockDb,
    mockSyncEngine,
    mockWs,
    mockAppState,
  };
}

// ── Tests ──

describe('AppLifecycleManager', () => {
  describe('initialize', () => {
    it('should register app state listener and mark as initialized', async () => {
      const cfg = createConfig();
      const manager = createAppLifecycleManager(cfg);

      expect(manager.isInitialized).toBe(false);
      await manager.initialize();
      expect(manager.isInitialized).toBe(true);
      expect(cfg.mockAppState.addEventListener).toHaveBeenCalledTimes(1);
    });

    it('should process pending sync queue on initialization (launch recovery)', async () => {
      const cfg = createConfig({
        pendingEntries: [{ id: 'entry-1' }, { id: 'entry-2' }],
      });
      const manager = createAppLifecycleManager(cfg);

      await manager.initialize();

      expect(manager.isLaunchRecoveryComplete).toBe(true);
      expect(cfg.mockSyncEngine.syncAllPending).toHaveBeenCalledTimes(1);
    });

    it('should not re-initialize if already initialized', async () => {
      const cfg = createConfig();
      const manager = createAppLifecycleManager(cfg);

      await manager.initialize();
      await manager.initialize();

      expect(cfg.mockAppState.addEventListener).toHaveBeenCalledTimes(1);
    });

    it('should set current state from appStateListener on init', async () => {
      const cfg = createConfig({ initialAppState: 'background' });
      const manager = createAppLifecycleManager(cfg);

      await manager.initialize();

      expect(cfg.mockAppState.currentState).toHaveBeenCalled();
    });
  });

  describe('handleBackground (Req 16.1, 16.2)', () => {
    it('should complete in-progress sync before suspending', async () => {
      const cfg = createConfig({ syncEngineState: 'SyncingOutbound' });
      const manager = createAppLifecycleManager(cfg);

      await manager.handleBackground();

      expect(cfg.mockSyncEngine.processOutboundQueue).toHaveBeenCalledTimes(1);
    });

    it('should close WebSocket connection', async () => {
      const cfg = createConfig();
      const manager = createAppLifecycleManager(cfg);

      await manager.handleBackground();

      expect(cfg.mockWs.disconnect).toHaveBeenCalledTimes(1);
    });

    it('should not attempt sync completion when engine is idle', async () => {
      const cfg = createConfig({ syncEngineState: 'Idle' });
      const manager = createAppLifecycleManager(cfg);

      await manager.handleBackground();

      expect(cfg.mockSyncEngine.processOutboundQueue).not.toHaveBeenCalled();
    });

    it('should handle sync failure gracefully during backgrounding', async () => {
      const cfg = createConfig({ syncEngineState: 'SyncingOutbound' });
      cfg.mockSyncEngine.processOutboundQueue.mockRejectedValueOnce(
        new Error('sync failed'),
      );
      const manager = createAppLifecycleManager(cfg);

      // Should not throw
      await manager.handleBackground();

      expect(cfg.mockWs.disconnect).toHaveBeenCalledTimes(1);
    });

    it('should handle WebSocket disconnect failure gracefully', async () => {
      const cfg = createConfig();
      cfg.mockWs.disconnect.mockRejectedValueOnce(new Error('ws error'));
      const manager = createAppLifecycleManager(cfg);

      // Should not throw
      await manager.handleBackground();
    });

    it('should set current state to background', async () => {
      const cfg = createConfig();
      const manager = createAppLifecycleManager(cfg);

      await manager.handleBackground();

      expect(manager.currentState).toBe('background');
    });

    it('should complete sync when engine is in SyncingInbound state', async () => {
      const cfg = createConfig({ syncEngineState: 'SyncingInbound' });
      const manager = createAppLifecycleManager(cfg);

      await manager.handleBackground();

      expect(cfg.mockSyncEngine.processOutboundQueue).toHaveBeenCalledTimes(1);
    });
  });

  describe('handleForeground (Req 16.3)', () => {
    it('should reconnect WebSocket', async () => {
      const cfg = createConfig();
      const manager = createAppLifecycleManager(cfg);

      await manager.handleForeground();

      expect(cfg.mockWs.connect).toHaveBeenCalledTimes(1);
    });

    it('should trigger delta sync', async () => {
      const cfg = createConfig();
      const manager = createAppLifecycleManager(cfg);

      await manager.handleForeground();

      expect(cfg.mockSyncEngine.processOutboundQueue).toHaveBeenCalledTimes(1);
    });

    it('should set current state to active', async () => {
      const cfg = createConfig();
      const manager = createAppLifecycleManager(cfg);

      await manager.handleForeground();

      expect(manager.currentState).toBe('active');
    });

    it('should handle WebSocket reconnect failure gracefully', async () => {
      const cfg = createConfig();
      cfg.mockWs.connect.mockRejectedValueOnce(new Error('ws connect failed'));
      const manager = createAppLifecycleManager(cfg);

      // Should not throw, and delta sync should still run
      await manager.handleForeground();

      expect(cfg.mockSyncEngine.processOutboundQueue).toHaveBeenCalledTimes(1);
    });

    it('should handle delta sync failure gracefully', async () => {
      const cfg = createConfig();
      cfg.mockSyncEngine.processOutboundQueue.mockRejectedValueOnce(
        new Error('sync failed'),
      );
      const manager = createAppLifecycleManager(cfg);

      // Should not throw
      await manager.handleForeground();
    });

    it('should respect delta sync timeout', async () => {
      const cfg = createConfig({ deltaSyncTimeoutMs: 50 });
      // Make sync take longer than timeout
      cfg.mockSyncEngine.processOutboundQueue.mockImplementation(
        () =>
          new Promise<SyncResult>((resolve) =>
            setTimeout(
              () =>
                resolve({
                  success: true,
                  syncedCount: 0,
                  failedCount: 0,
                  conflicts: [],
                }),
              200,
            ),
          ),
      );
      const manager = createAppLifecycleManager(cfg);

      const start = Date.now();
      await manager.handleForeground();
      const elapsed = Date.now() - start;

      // Should resolve around the timeout, not wait for the full sync
      expect(elapsed).toBeLessThan(150);
    });
  });

  describe('handleTermination (Req 16.4)', () => {
    it('should persist pending sync queue entries to SQLite', async () => {
      const cfg = createConfig();
      const manager = createAppLifecycleManager(cfg);

      await manager.handleTermination();

      // Should update in_progress entries back to pending
      expect(cfg.mockDb.execute).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE sync_queue'),
      );
    });

    it('should stop the sync engine', async () => {
      const cfg = createConfig();
      const manager = createAppLifecycleManager(cfg);

      await manager.handleTermination();

      expect(cfg.mockSyncEngine.stop).toHaveBeenCalledTimes(1);
    });

    it('should close WebSocket connection', async () => {
      const cfg = createConfig();
      const manager = createAppLifecycleManager(cfg);

      await manager.handleTermination();

      expect(cfg.mockWs.disconnect).toHaveBeenCalledTimes(1);
    });

    it('should handle WebSocket disconnect failure on termination', async () => {
      const cfg = createConfig();
      cfg.mockWs.disconnect.mockRejectedValueOnce(new Error('ws error'));
      const manager = createAppLifecycleManager(cfg);

      // Should not throw
      await manager.handleTermination();

      expect(cfg.mockSyncEngine.stop).toHaveBeenCalledTimes(1);
    });
  });

  describe('handleLaunchAfterTermination (Req 16.6)', () => {
    it('should process all pending sync queue entries', async () => {
      const cfg = createConfig({
        pendingEntries: [{ id: 'entry-1' }],
      });
      const manager = createAppLifecycleManager(cfg);

      await manager.handleLaunchAfterTermination();

      expect(cfg.mockSyncEngine.syncAllPending).toHaveBeenCalledTimes(1);
      expect(manager.isLaunchRecoveryComplete).toBe(true);
    });

    it('should skip sync when no pending entries exist', async () => {
      const cfg = createConfig({ pendingEntries: [] });
      const manager = createAppLifecycleManager(cfg);

      await manager.handleLaunchAfterTermination();

      expect(cfg.mockSyncEngine.syncAllPending).not.toHaveBeenCalled();
      expect(manager.isLaunchRecoveryComplete).toBe(true);
    });

    it('should mark launch recovery complete even if sync fails', async () => {
      const cfg = createConfig({
        pendingEntries: [{ id: 'entry-1' }],
      });
      cfg.mockSyncEngine.syncAllPending.mockRejectedValueOnce(
        new Error('sync failed'),
      );
      const manager = createAppLifecycleManager(cfg);

      await expect(
        manager.handleLaunchAfterTermination(),
      ).rejects.toThrow('sync failed');

      expect(manager.isLaunchRecoveryComplete).toBe(true);
    });
  });

  describe('AppState listener integration', () => {
    it('should call handleBackground when state changes from active to background', async () => {
      const cfg = createConfig({ initialAppState: 'active' });
      const manager = createAppLifecycleManager(cfg);
      await manager.initialize();

      // Simulate going to background
      cfg.mockAppState.simulateStateChange('background');

      // Give the async handler time to execute
      await new Promise((r) => setTimeout(r, 50));

      expect(cfg.mockWs.disconnect).toHaveBeenCalled();
    });

    it('should call handleForeground when state changes from background to active', async () => {
      const cfg = createConfig({ initialAppState: 'active' });
      const manager = createAppLifecycleManager(cfg);
      await manager.initialize();

      // First go to background
      await manager.handleBackground();
      cfg.mockWs.connect.mockClear();
      cfg.mockSyncEngine.processOutboundQueue.mockClear();

      // Then simulate coming back to foreground
      cfg.mockAppState.simulateStateChange('active');

      await new Promise((r) => setTimeout(r, 50));

      expect(cfg.mockWs.connect).toHaveBeenCalled();
    });
  });

  describe('teardown', () => {
    it('should unsubscribe from app state changes', async () => {
      const cfg = createConfig();
      const manager = createAppLifecycleManager(cfg);
      await manager.initialize();

      manager.teardown();

      expect(manager.isInitialized).toBe(false);
      // Verify listener was removed
      expect(cfg.mockAppState._callbacks).toHaveLength(0);
    });

    it('should be safe to call teardown without initialize', () => {
      const cfg = createConfig();
      const manager = createAppLifecycleManager(cfg);

      // Should not throw
      manager.teardown();
    });
  });

  describe('delta sync inbound pull (Req 16.3)', () => {
    it('should poll all active accounts on foreground return', async () => {
      const cfg = createConfig();
      // Mock db.query to return active accounts
      cfg.mockDb.query.mockResolvedValueOnce([]); // launch recovery (no pending)
      cfg.mockDb.query.mockResolvedValueOnce([
        { id: 'account-1' },
        { id: 'account-2' },
      ]);
      const manager = createAppLifecycleManager(cfg);
      await manager.initialize();

      cfg.mockSyncEngine.processOutboundQueue.mockClear();
      cfg.mockSyncEngine.pollProvider.mockClear();

      await manager.handleForeground();

      expect(cfg.mockSyncEngine.pollProvider).toHaveBeenCalledWith('account-1');
      expect(cfg.mockSyncEngine.pollProvider).toHaveBeenCalledWith('account-2');
    });

    it('should handle pollProvider failures gracefully during foreground', async () => {
      const cfg = createConfig();
      cfg.mockDb.query.mockResolvedValueOnce([]); // launch recovery
      cfg.mockDb.query.mockResolvedValueOnce([{ id: 'account-1' }]);
      cfg.mockSyncEngine.pollProvider.mockRejectedValueOnce(new Error('poll failed'));
      const manager = createAppLifecycleManager(cfg);
      await manager.initialize();

      // Should not throw
      await manager.handleForeground();
    });
  });

  describe('termination flush (Req 16.4)', () => {
    it('should attempt to flush outbound queue before resetting statuses', async () => {
      const cfg = createConfig();
      const manager = createAppLifecycleManager(cfg);

      await manager.handleTermination();

      // processOutboundQueue should be called as part of flush
      expect(cfg.mockSyncEngine.processOutboundQueue).toHaveBeenCalled();
      // Then status reset should happen
      expect(cfg.mockDb.execute).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE sync_queue'),
      );
    });

    it('should still reset statuses even if outbound flush fails', async () => {
      const cfg = createConfig();
      cfg.mockSyncEngine.processOutboundQueue.mockRejectedValueOnce(
        new Error('flush failed'),
      );
      const manager = createAppLifecycleManager(cfg);

      await manager.handleTermination();

      // Status reset should still happen
      expect(cfg.mockDb.execute).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE sync_queue'),
      );
    });
  });

  describe('mutation blocking (Req 16.6)', () => {
    it('should block mutations during launch recovery', async () => {
      const cfg = createConfig({
        pendingEntries: [{ id: 'entry-1' }],
      });
      // Make syncAllPending take some time
      let resolveSyncAll: (() => void) | null = null;
      cfg.mockSyncEngine.syncAllPending.mockImplementation(
        () =>
          new Promise<SyncResult>((resolve) => {
            resolveSyncAll = () =>
              resolve({
                success: true,
                syncedCount: 1,
                failedCount: 0,
                conflicts: [],
              });
          }),
      );
      const manager = createAppLifecycleManager(cfg);

      // Start initialization (which triggers launch recovery)
      const initPromise = manager.initialize();

      // Wait a tick for the async flow to reach syncAllPending
      await new Promise((r) => setTimeout(r, 10));

      // During recovery, canAcceptMutations should be false
      expect(manager.canAcceptMutations()).toBe(false);

      // Complete the sync
      resolveSyncAll!();
      await initPromise;

      // After recovery, canAcceptMutations should be true
      expect(manager.canAcceptMutations()).toBe(true);
    });

    it('waitForLaunchRecovery should resolve immediately if already complete', async () => {
      const cfg = createConfig({ pendingEntries: [] });
      const manager = createAppLifecycleManager(cfg);
      await manager.initialize();

      // Should resolve immediately
      await manager.waitForLaunchRecovery();
      expect(manager.canAcceptMutations()).toBe(true);
    });

    it('waitForLaunchRecovery should wait until recovery completes', async () => {
      const cfg = createConfig({
        pendingEntries: [{ id: 'entry-1' }],
      });
      let resolveSyncAll: (() => void) | null = null;
      cfg.mockSyncEngine.syncAllPending.mockImplementation(
        () =>
          new Promise<SyncResult>((resolve) => {
            resolveSyncAll = () =>
              resolve({
                success: true,
                syncedCount: 1,
                failedCount: 0,
                conflicts: [],
              });
          }),
      );
      const manager = createAppLifecycleManager(cfg);

      // Start initialization
      const initPromise = manager.initialize();

      // waitForLaunchRecovery should not resolve yet
      let waitResolved = false;
      const waitPromise = manager.waitForLaunchRecovery().then(() => {
        waitResolved = true;
      });

      // Give microtasks a chance to run
      await new Promise((r) => setTimeout(r, 10));
      expect(waitResolved).toBe(false);

      // Complete recovery
      resolveSyncAll!();
      await initPromise;
      await waitPromise;

      expect(waitResolved).toBe(true);
    });

    it('canAcceptMutations should return true when no pending entries', async () => {
      const cfg = createConfig({ pendingEntries: [] });
      const manager = createAppLifecycleManager(cfg);
      await manager.initialize();

      expect(manager.canAcceptMutations()).toBe(true);
    });
  });
});
