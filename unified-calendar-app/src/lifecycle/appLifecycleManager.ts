/**
 * App lifecycle manager.
 * Handles background, foreground, termination, and launch transitions.
 *
 * - On background: complete in-progress sync, close WebSocket, rely on push notifications
 * - On foreground: reconnect WebSocket, delta sync within 10 seconds
 * - On termination: persist all pending sync queue entries to SQLite
 * - On launch after termination: process all pending sync queue entries before accepting new mutations
 *
 * Requirements: 16.1, 16.2, 16.3, 16.4, 16.6
 */

import type { DatabaseDriver } from '../db/database';
import type { SyncEngine } from '../sync/types';

/** App lifecycle states */
export type AppLifecycleState = 'active' | 'background' | 'inactive' | 'unknown';

/**
 * WebSocket connection manager interface.
 * Abstracted so the actual WebSocket implementation (task 20.3) can be plugged in later.
 */
export interface WebSocketManager {
  /** Connect/reconnect the WebSocket */
  connect(): Promise<void>;
  /** Gracefully close the WebSocket connection */
  disconnect(): Promise<void>;
  /** Whether the WebSocket is currently connected */
  isConnected(): boolean;
}

/**
 * AppState listener abstraction.
 * On React Native this wraps AppState from 'react-native'.
 * In tests we provide a mock implementation.
 */
export interface AppStateListener {
  /** Register a callback for app state changes. Returns an unsubscribe function. */
  addEventListener(
    callback: (nextState: AppLifecycleState) => void,
  ): () => void;
  /** Get the current app state */
  currentState(): AppLifecycleState;
}

/** Configuration for the lifecycle manager */
export interface AppLifecycleManagerConfig {
  db: DatabaseDriver;
  syncEngine: SyncEngine;
  webSocketManager: WebSocketManager;
  appStateListener: AppStateListener;
  /** Maximum time (ms) allowed for delta sync on foreground return. Default: 10000 */
  deltaSyncTimeoutMs?: number;
}

/** Public interface for the lifecycle manager */
export interface AppLifecycleManager {
  /** Initialize lifecycle listeners. Call once at app startup. */
  initialize(): Promise<void>;
  /** Tear down lifecycle listeners and clean up. */
  teardown(): void;
  /** Handle transition to background */
  handleBackground(): Promise<void>;
  /** Handle transition to foreground */
  handleForeground(): Promise<void>;
  /** Handle app termination — persist pending sync queue */
  handleTermination(): Promise<void>;
  /** Handle launch after termination — process pending queue before accepting mutations */
  handleLaunchAfterTermination(): Promise<void>;
  /**
   * Returns a promise that resolves when launch recovery is complete.
   * Callers (e.g., event CRUD service) should await this before accepting
   * new user mutations to satisfy Req 16.6.
   */
  waitForLaunchRecovery(): Promise<void>;
  /**
   * Whether the manager is ready to accept new mutations.
   * Returns false during launch recovery (Req 16.6).
   */
  canAcceptMutations(): boolean;
  /** Whether the manager has been initialized */
  readonly isInitialized: boolean;
  /** Whether launch recovery (pending queue processing) is complete */
  readonly isLaunchRecoveryComplete: boolean;
  /** Current lifecycle state */
  readonly currentState: AppLifecycleState;
}

/** Default delta sync timeout: 10 seconds (Req 16.3) */
const DEFAULT_DELTA_SYNC_TIMEOUT_MS = 10_000;

/**
 * Creates an AppLifecycleManager instance.
 */
export function createAppLifecycleManager(
  config: AppLifecycleManagerConfig,
): AppLifecycleManager {
  const { db, syncEngine, webSocketManager, appStateListener } = config;
  const deltaSyncTimeoutMs =
    config.deltaSyncTimeoutMs ?? DEFAULT_DELTA_SYNC_TIMEOUT_MS;

  let _initialized = false;
  let _launchRecoveryComplete = false;
  let _currentState: AppLifecycleState = 'unknown';
  let _unsubscribeAppState: (() => void) | null = null;
  /** Resolvers waiting for launch recovery to complete */
  let _launchRecoveryResolvers: Array<() => void> = [];

  /**
   * Persist all pending sync queue entries to SQLite (Req 16.4).
   * Ensures any in-memory pending entries are flushed to the database
   * so they survive app termination.
   *
   * Note on architecture: In this offline-first design, queueLocalChange() writes
   * directly to the sync_queue table in SQLite (not held in memory). Therefore,
   * all pending changes are already persisted. This method handles the edge case
   * where entries were marked 'in_progress' (mid-flight) when termination occurs —
   * those are reset to 'pending' so they are retried on next launch.
   *
   * Additionally, we flush any outbound queue entries the sync engine may be
   * holding in its internal state by calling syncAllPending() with a best-effort
   * approach before resetting statuses.
   */
  async function persistPendingSyncQueue(): Promise<void> {
    // Best-effort: flush any sync engine internal state to SQLite
    try {
      await syncEngine.processOutboundQueue();
    } catch {
      // If outbound processing fails, entries remain in queue — that's fine
    }

    // Mark any in_progress entries back to pending so they are retried on next launch
    await db.execute(
      `UPDATE sync_queue SET status = 'pending' WHERE status = 'in_progress'`,
    );
  }

  /**
   * Process all pending sync queue entries (Req 16.6).
   * Must complete before accepting new user mutations after a terminated launch.
   */
  async function processPendingSyncQueue(): Promise<void> {
    const pendingEntries = await db.query<{ id: string }>(
      `SELECT id FROM sync_queue WHERE status = 'pending' OR status = 'in_progress' ORDER BY created_at ASC`,
    );

    if (pendingEntries.length > 0) {
      await syncEngine.syncAllPending();
    }
  }

  /**
   * Perform a full delta sync (outbound + inbound) with a timeout (Req 16.3).
   * Pushes any pending outbound changes AND pulls inbound changes from all
   * active accounts that arrived while the app was backgrounded.
   * Resolves when sync completes or the timeout is reached.
   */
  async function deltaSyncWithTimeout(): Promise<void> {
    const syncPromise = (async () => {
      // Push any pending outbound changes
      await syncEngine.processOutboundQueue();

      // Pull inbound changes from all active accounts (Req 16.3: "perform a delta sync")
      // Query active accounts and poll each for changes that arrived while backgrounded
      const accounts = await db.query<{ id: string }>(
        `SELECT id FROM calendar_accounts WHERE status = 'active'`,
      );
      await Promise.allSettled(
        accounts.map((account) => syncEngine.pollProvider(account.id)),
      );
    })();

    const timeoutPromise = new Promise<void>((resolve) => {
      setTimeout(resolve, deltaSyncTimeoutMs);
    });

    await Promise.race([syncPromise, timeoutPromise]);
  }

  /**
   * Handle transition to background (Req 16.1, 16.2).
   */
  async function handleBackground(): Promise<void> {
    _currentState = 'background';

    // Complete any in-progress sync before suspending (Req 16.1)
    if (syncEngine.state === 'SyncingOutbound' || syncEngine.state === 'SyncingInbound') {
      try {
        await syncEngine.processOutboundQueue();
      } catch {
        // Best-effort: if sync fails during backgrounding, entries remain in queue
      }
    }

    // Close WebSocket, rely on push notifications (Req 16.2)
    try {
      await webSocketManager.disconnect();
    } catch {
      // Best-effort disconnect
    }
  }

  /**
   * Handle transition to foreground (Req 16.3).
   */
  async function handleForeground(): Promise<void> {
    _currentState = 'active';

    // Reconnect WebSocket (Req 16.3)
    try {
      await webSocketManager.connect();
    } catch {
      // WebSocket reconnect failure is non-fatal; sync will still work via polling
    }

    // Delta sync within 10 seconds (Req 16.3)
    try {
      await deltaSyncWithTimeout();
    } catch {
      // Delta sync failure is non-fatal
    }
  }

  /**
   * Handle app termination (Req 16.4).
   */
  async function handleTermination(): Promise<void> {
    // Persist all pending sync queue entries to SQLite
    await persistPendingSyncQueue();

    // Stop the sync engine
    syncEngine.stop();

    // Close WebSocket
    try {
      await webSocketManager.disconnect();
    } catch {
      // Best-effort disconnect on termination
    }
  }

  /**
   * Handle launch after termination (Req 16.6).
   * Process all pending sync queue entries before accepting new mutations.
   */
  async function handleLaunchAfterTermination(): Promise<void> {
    _launchRecoveryComplete = false;

    try {
      await processPendingSyncQueue();
    } finally {
      _launchRecoveryComplete = true;
      // Notify all waiters that recovery is complete
      for (const resolve of _launchRecoveryResolvers) {
        resolve();
      }
      _launchRecoveryResolvers = [];
    }
  }

  /**
   * Returns a promise that resolves when launch recovery is complete (Req 16.6).
   * If recovery is already complete, resolves immediately.
   * Event CRUD services should await this before accepting new user mutations.
   */
  function waitForLaunchRecovery(): Promise<void> {
    if (_launchRecoveryComplete) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      _launchRecoveryResolvers.push(resolve);
    });
  }

  /**
   * Whether the manager is ready to accept new mutations (Req 16.6).
   * Returns false during launch recovery.
   */
  function canAcceptMutations(): boolean {
    return _launchRecoveryComplete;
  }

  /**
   * AppState change handler.
   */
  function onAppStateChange(nextState: AppLifecycleState): void {
    const previousState = _currentState;

    if (nextState === 'background' && previousState === 'active') {
      // Fire-and-forget background handling
      handleBackground().catch(() => {
        // Errors during background transition are non-fatal
      });
    } else if (nextState === 'active' && previousState === 'background') {
      // Fire-and-forget foreground handling
      handleForeground().catch(() => {
        // Errors during foreground transition are non-fatal
      });
    }

    _currentState = nextState;
  }

  /**
   * Initialize lifecycle listeners.
   */
  async function initialize(): Promise<void> {
    if (_initialized) return;

    _currentState = appStateListener.currentState();

    // Subscribe to app state changes
    _unsubscribeAppState = appStateListener.addEventListener(onAppStateChange);

    // Process any pending entries from a previous terminated session (Req 16.6)
    await handleLaunchAfterTermination();

    _initialized = true;
  }

  /**
   * Tear down lifecycle listeners.
   */
  function teardown(): void {
    if (_unsubscribeAppState) {
      _unsubscribeAppState();
      _unsubscribeAppState = null;
    }
    _initialized = false;
  }

  return {
    initialize,
    teardown,
    handleBackground,
    handleForeground,
    handleTermination,
    handleLaunchAfterTermination,
    waitForLaunchRecovery,
    canAcceptMutations,
    get isInitialized() {
      return _initialized;
    },
    get isLaunchRecoveryComplete() {
      return _launchRecoveryComplete;
    },
    get currentState() {
      return _currentState;
    },
  };
}
