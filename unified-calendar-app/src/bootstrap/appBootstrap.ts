/**
 * Application Bootstrap — Integration Wiring Module
 *
 * Central orchestration module that initializes all services and connects them
 * following the data flow described in the architecture diagram:
 *
 *   UI layer → Zustand stores → TanStack Query → SyncEngine → Provider Adapters
 *   SyncEngine → ConflictDetector → push notifications
 *   SubscriptionManager → feature gating across all components
 *   PrivacyLayer → Unified View filtering
 *   AISchedulingAssistant → event editor suggestions
 *   OnboardingManager → initial app flow
 *   TokenHealthMonitor → auth error UX
 *   WebSocket → SyncEngine inbound notifications
 *
 * Requirements: 2.1, 4.1, 7.1, 8.1, 10.1, 13.1, 13.3
 */

import type { DatabaseDriver } from '../db/database';
import type { CalendarProviderAdapter } from '../providers/types';
import type { SyncEngine, WebhookPayload } from '../sync/types';
import type { ConflictDetector } from '../conflicts/conflictDetector';
import type { PrivacyLayer } from '../privacy/privacyLayer';
import type { SubscriptionManager } from '../subscription/subscriptionManager';
import type { AISchedulingAssistant } from '../ai/aiSchedulingAssistant';
import type { OnboardingManager } from '../onboarding/onboardingManager';
import type { NotificationService } from '../notifications/notificationService';
import type { ErrorDisplayService } from '../errors/errorDisplayService';
import type { AppLifecycleManager, WebSocketManager } from '../lifecycle/appLifecycleManager';
import type { InitializedStores } from '../stores/initializeStores';
import type { TokenHealthMonitor as TokenHealthMonitorType } from '../providers/tokenHealthMonitor';
import type { CalendarEvent, CalendarAccount } from '../types/models';
import type { Feature } from '../types/subscription';
import type { PlatformNotificationHandler } from '../notifications/types';
import type { QueryClient } from '@tanstack/react-query';

// ── Configuration ──────────────────────────────────────────────────────

export interface AppBootstrapConfig {
  /** Initialized database driver (must be ready before bootstrap) */
  db: DatabaseDriver;
  /** User ID for the current session */
  userId: string;
  /** Device ID for WebSocket subscription */
  deviceId: string;
  /** WebSocket server URL (must use wss://) */
  webSocketUrl: string;
  /** Platform notification handler (iOS/Android/Web) */
  platformNotificationHandler: PlatformNotificationHandler;
  /** Optional: WebSocket factory for testing */
  createWebSocket?: (url: string) => WebSocket;
  /** Optional: Pre-configured provider adapters (for testing or pre-connected accounts) */
  initialAdapters?: Map<string, CalendarProviderAdapter>;
}

// ── Wired Application Context ──────────────────────────────────────────

export interface AppContext {
  /** Initialized Zustand stores (calendar accounts, events, subscription, sync status) */
  stores: InitializedStores;
  /** TanStack QueryClient for server-state management */
  queryClient: QueryClient;
  /** Bidirectional sync engine connected to provider adapters */
  syncEngine: SyncEngine;
  /** Conflict detector with continuous scanning wired to notifications */
  conflictDetector: ConflictDetector;
  /** Privacy layer for filtering events by audience */
  privacyLayer: PrivacyLayer;
  /** Subscription manager for tier enforcement and feature gating */
  subscriptionManager: SubscriptionManager;
  /** AI scheduling assistant (gated by subscription tier) */
  aiAssistant: AISchedulingAssistant;
  /** Onboarding manager controlling initial app flow */
  onboardingManager: OnboardingManager;
  /** Token health monitor detecting revoked tokens */
  tokenHealthMonitor: TokenHealthMonitorType;
  /** Push notification service */
  notificationService: NotificationService;
  /** Error display service for user-facing error UX */
  errorDisplayService: ErrorDisplayService;
  /** App lifecycle manager (background/foreground/termination) */
  lifecycleManager: AppLifecycleManager;
  /** WebSocket manager for real-time inbound notifications */
  webSocketManager: WebSocketManager;
  /** Provider adapters keyed by account ID */
  providerAdapters: Map<string, CalendarProviderAdapter>;
  /** Register a provider adapter for an account (called when accounts are connected) */
  registerAdapter: (accountId: string, adapter: CalendarProviderAdapter) => void;
  /** Unregister a provider adapter (called when accounts are removed) */
  unregisterAdapter: (accountId: string) => void;
  /** Teardown all services (for cleanup/testing) */
  teardown: () => void;
  /** Check if a feature is accessible for the current user */
  checkFeatureAccess: (feature: Feature) => boolean;
  /** Get privacy-filtered events for the unified view */
  getFilteredEventsForView: (events: CalendarEvent[], viewerType?: 'owner' | 'delegate' | 'shared-view-member') => Promise<CalendarEvent[]>;
}

// ── Bootstrap Function ─────────────────────────────────────────────────

/**
 * Bootstraps the entire application by initializing all services and wiring
 * them together. This is the single entry point for app initialization.
 *
 * Call order:
 * 1. Initialize database and stores
 * 2. Create provider adapters
 * 3. Create sync engine with adapters
 * 4. Create conflict detector and wire to sync engine + notifications
 * 5. Create subscription manager and wire feature gating
 * 6. Create privacy layer
 * 7. Create AI assistant (gated by subscription)
 * 8. Create onboarding manager
 * 9. Create token health monitor and wire to error UX
 * 10. Create WebSocket manager and wire to sync engine
 * 11. Create lifecycle manager and wire to WebSocket + sync engine
 */
export async function bootstrapApp(config: AppBootstrapConfig): Promise<AppContext> {
  const { db, userId, deviceId, webSocketUrl, platformNotificationHandler } = config;

  // ── 1. Initialize Zustand stores with SQLite persistence ──
  const { initializeStores } = await import('../stores/initializeStores');
  const stores = await initializeStores(db);

  // ── 2. Create provider adapters map (populated via registerAdapter or initial config) ──
  const providerAdapters: Map<string, CalendarProviderAdapter> = config.initialAdapters
    ? new Map(config.initialAdapters)
    : new Map();

  // ── 3. Create TanStack QueryClient for server-state management ──
  const { QueryClient: QC } = await import('@tanstack/react-query');
  const queryClient: QueryClient = new QC({
    defaultOptions: {
      queries: {
        staleTime: 30_000,       // 30s before refetch
        gcTime: 5 * 60_000,     // 5 min garbage collection
        retry: 2,
        networkMode: 'offlineFirst',
      },
      mutations: {
        networkMode: 'offlineFirst',
      },
    },
  });

  // ── 3b. Initialize TanStack Query hooks with service dependencies ──
  // This must happen after the QueryClient is created but before any
  // React components mount, so the hooks have access to db and syncEngine.
  const { initCalendarQueries } = await import('../queries/calendarQueries');
  // Note: syncEngine is created in step 6 below — we defer the init call
  // until after step 6 completes. See "Wire query hooks" below.

  // ── 4. Create error display service (needed by other services for error reporting) ──
  const { createErrorStore } = await import('../errors/errorStore');
  const errorStore = createErrorStore();
  const { createErrorDisplayService } = await import('../errors/errorDisplayService');
  const errorDisplayService = createErrorDisplayService({
    addError: (entry) => errorStore.getState().addError(entry),
    dismissError: (id) => errorStore.getState().dismissError(id),
    dismissErrorsByCategory: (cat) => errorStore.getState().dismissErrorsByCategory(cat),
    dismissErrorsByAccount: (accId) => errorStore.getState().dismissErrorsByAccount(accId),
    setOffline: (offline) => errorStore.getState().setOffline(offline),
    resolveError: (id) => errorStore.getState().resolveError(id),
  });

  // ── 5. Create notification service ──
  const { createNotificationPreferencesStore } = await import(
    '../notifications/notificationPreferencesStore'
  );
  const notifPrefsStore = createNotificationPreferencesStore();
  const { createNotificationService } = await import('../notifications/notificationService');
  const notificationService = createNotificationService({
    platformHandler: platformNotificationHandler,
    getPreferences: () => notifPrefsStore.getState().preferences,
    setPermissionStatus: (status) => notifPrefsStore.getState().setPermissionStatus(status),
  });

  // ── 6. Create sync engine with provider adapters ──
  const { createSyncEngine } = await import('../sync/syncEngine');
  const syncEngine = createSyncEngine({
    db,
    adapters: providerAdapters,
    onNotification: (message, severity) => {
      // Wire sync notifications to error display service
      if (severity === 'error') {
        errorDisplayService.showSyncError({
          category: 'sync',
        });
      }
    },
  });

  // ── 7. Create conflict detector and wire to sync engine + notifications ──
  const { createConflictDetector } = await import('../conflicts/conflictDetector');
  const conflictDetector = createConflictDetector();

  // ── 7b. Wire TanStack Query hooks (deferred from step 3b) ──
  initCalendarQueries({ db, syncEngine });

  // Track notified conflict pairs to prevent O(n²) notification spam
  const notifiedConflictPairs = new Set<string>();

  // Wire: SyncEngine → ConflictDetector → push notifications
  // Override handleWebhookNotification on the sync engine to run conflict
  // detection after inbound changes are processed.
  const originalHandleWebhook = syncEngine.handleWebhookNotification.bind(syncEngine);
  (syncEngine as any).handleWebhookNotification = async (payload: WebhookPayload) => {
    await originalHandleWebhook(payload);
    // After sync processes inbound changes, run conflict detection
    await runConflictScanAfterSync(conflictDetector, notificationService, stores, notifiedConflictPairs);
  };

  // ── 8. Create subscription manager and wire feature gating ──
  const { createSubscriptionManager } = await import('../subscription/subscriptionManager');
  const subscriptionManager = createSubscriptionManager({
    db,
    store: stores.subscriptionStore,
    http: { post: async () => ({ data: {} as any }) }, // Placeholder HTTP client
  });

  // ── 9. Create privacy layer (with subscription tier gating for advanced privacy, Req 10.2) ──
  const { createPrivacyLayer } = await import('../privacy/privacyLayer');
  const privacyLayer = createPrivacyLayer({
    driver: db,
    checkAdvancedPrivacyAccess: (calendarOwnerId: string) =>
      subscriptionManager.checkFeatureAccess(calendarOwnerId, 'advanced_privacy'),
  });

  // ── 10. Create AI scheduling assistant (gated by subscription) ──
  const { createAISchedulingAssistant } = await import('../ai/aiSchedulingAssistant');
  const aiAssistant = createAISchedulingAssistant({
    db,
    subscriptionManager,
    providerAdapters,
  });

  // ── 11. Create onboarding manager ──
  const { createOnboardingManager } = await import('../onboarding/onboardingManager');
  const onboardingManager = createOnboardingManager({
    db,
    onComplete: (_userId) => {
      // When onboarding completes, transition to Unified View
      // The UI layer reads onboarding state from the manager
    },
  });

  // ── 12. Create token health monitor and wire to auth error UX ──
  const { TokenHealthMonitor } = await import('../providers/tokenHealthMonitor');
  const tokenHealthMonitor = new TokenHealthMonitor({
    checkHealth: async (accountId: string) => {
      // Use the appropriate provider adapter to check token health
      const adapter = providerAdapters.get(accountId);
      if (!adapter) return 'unknown';
      try {
        // Lightweight call to verify token validity
        await adapter.listCalendars(accountId);
        return 'valid';
      } catch {
        return 'revoked';
      }
    },
  });

  // Wire: TokenHealthMonitor → auth error UX
  tokenHealthMonitor.onTokenRevoked = (accountId: string) => {
    // Show auth error badge on the affected calendar account
    errorDisplayService.showAuthError({
      category: 'auth',
      accountId,
    });
    // Send push notification for re-authentication
    const accounts = stores.calendarAccountsStore.getState().accounts;
    const account = accounts[accountId];
    const accountName = account?.displayName ?? 'Calendar';
    notificationService.notifyReauthRequired(accountName).catch(() => {
      // Non-fatal: notification delivery failure doesn't block the flow
    });
  };

  // ── 13. Create WebSocket manager and wire to sync engine ──
  const { createWebSocketManager } = await import('../lifecycle/webSocketManager');
  const webSocketManager = createWebSocketManager({
    url: webSocketUrl,
    userId,
    deviceId,
    syncEngine,
    createWebSocket: config.createWebSocket,
  });

  // ── 14. Create app lifecycle manager and wire to WebSocket + sync engine ──
  const { createAppLifecycleManager } = await import('../lifecycle/appLifecycleManager');
  const lifecycleManager = createAppLifecycleManager({
    syncEngine,
    webSocketManager,
    db,
    appStateListener: {
      addEventListener: (_handler) => {
        // In production, this would use AppState from react-native.
        // Returns an unsubscribe function.
        return () => {};
      },
      currentState: () => 'active' as const,
    },
  });

  // ── 15. Start monitoring ──
  // Start token health monitoring for all active accounts
  const activeAccounts = getActiveAccounts(stores);
  if (activeAccounts.length > 0) {
    tokenHealthMonitor.startMonitoring(activeAccounts);
  }

  // Start continuous conflict scanning if user has Pro/Team tier
  if (subscriptionManager.checkFeatureAccess(userId, 'conflict_detection')) {
    const allEvents = getAllEvents(stores);
    conflictDetector.startContinuousScanning(allEvents);
  }

  // Start sync engine
  syncEngine.start();

  // ── Build the application context ──

  function checkFeatureAccess(feature: Feature): boolean {
    return subscriptionManager.checkFeatureAccess(userId, feature);
  }

  async function getFilteredEventsForView(
    events: CalendarEvent[],
    viewerType: 'owner' | 'delegate' | 'shared-view-member' = 'owner',
  ): Promise<CalendarEvent[]> {
    return privacyLayer.filterForAudience(events, {
      type: viewerType,
      userId,
      permissionLevel: 'read-only',
    });
  }

  /**
   * Register a provider adapter for an account.
   * Called by calendarAccountService when a new account is connected.
   */
  function registerAdapter(accountId: string, adapter: CalendarProviderAdapter): void {
    providerAdapters.set(accountId, adapter);
  }

  /**
   * Unregister a provider adapter when an account is removed.
   */
  function unregisterAdapter(accountId: string): void {
    providerAdapters.delete(accountId);
  }

  function teardown(): void {
    syncEngine.stop();
    tokenHealthMonitor.stopMonitoring();
    conflictDetector.stopContinuousScanning();
    notificationService.teardown();
    lifecycleManager.teardown();
    webSocketManager.disconnect();
    queryClient.clear();
    notifiedConflictPairs.clear();
  }

  return {
    stores,
    queryClient,
    syncEngine,
    conflictDetector,
    privacyLayer,
    subscriptionManager,
    aiAssistant,
    onboardingManager,
    tokenHealthMonitor,
    notificationService,
    errorDisplayService,
    lifecycleManager,
    webSocketManager,
    providerAdapters,
    registerAdapter,
    unregisterAdapter,
    teardown,
    checkFeatureAccess,
    getFilteredEventsForView,
  };
}

// ── Helper Functions ───────────────────────────────────────────────────

/**
 * Extracts active calendar accounts from the stores for token monitoring.
 */
function getActiveAccounts(stores: InitializedStores): CalendarAccount[] {
  const accounts = stores.calendarAccountsStore.getState().accounts;
  const result: CalendarAccount[] = [];
  for (const id of Object.keys(accounts)) {
    const account = accounts[id];
    if (account.status === 'active') {
      result.push(account);
    }
  }
  return result;
}

/**
 * Extracts all events from the events store for conflict scanning.
 */
function getAllEvents(stores: InitializedStores): CalendarEvent[] {
  const events = stores.eventsStore.getState().events;
  return Object.values(events);
}

/**
 * Creates a stable key for a conflict pair (order-independent).
 */
function conflictPairKey(idA: string, idB: string): string {
  return idA < idB ? `${idA}:${idB}` : `${idB}:${idA}`;
}

/**
 * Runs conflict detection after a sync operation completes and sends
 * push notifications for newly detected conflicts only.
 *
 * Uses a deduplication set to prevent O(n²) notification spam — each
 * conflict pair is only notified once until the set is cleared on teardown.
 *
 * Wiring: SyncEngine → ConflictDetector → push notifications (Req 7.6)
 */
async function runConflictScanAfterSync(
  conflictDetector: ConflictDetector,
  notificationService: NotificationService,
  stores: InitializedStores,
  notifiedPairs: Set<string>,
): Promise<void> {
  const allEvents = getAllEvents(stores);
  if (allEvents.length === 0) return;

  // Collect unique new conflicts
  const newConflicts: Array<{ titleA: string; titleB: string }> = [];

  for (const event of allEvents) {
    const conflicts = conflictDetector.detectConflicts(event, allEvents);
    for (const conflict of conflicts) {
      const key = conflictPairKey(conflict.eventA.id, conflict.eventB.id);
      if (!notifiedPairs.has(key)) {
        notifiedPairs.add(key);
        newConflicts.push({
          titleA: conflict.eventA.title,
          titleB: conflict.eventB.title,
        });
      }
    }
  }

  // Notify only for new conflicts
  for (const { titleA, titleB } of newConflicts) {
    await notificationService.notifyConflict(titleA, titleB).catch(() => {
      // Non-fatal: notification delivery failure doesn't block sync
    });
  }
}
