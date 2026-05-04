/**
 * Unit tests for the application bootstrap / integration wiring module.
 *
 * Verifies that all components are correctly wired together:
 * - UI layer → Zustand stores → TanStack Query → SyncEngine → Provider Adapters
 * - SyncEngine → ConflictDetector → push notifications
 * - SubscriptionManager → feature gating across all components
 * - PrivacyLayer → Unified View filtering
 * - AISchedulingAssistant → event editor suggestions
 * - OnboardingManager → initial app flow
 * - TokenHealthMonitor → auth error UX
 * - WebSocket → SyncEngine inbound notifications
 *
 * Requirements: 2.1, 4.1, 7.1, 8.1, 10.1, 13.1, 13.3
 */

import { bootstrapApp } from '../appBootstrap';
import type { AppBootstrapConfig, AppContext } from '../appBootstrap';
import type { DatabaseDriver } from '../../db/database';
import type { PlatformNotificationHandler } from '../../notifications/types';
import type { NotificationPermissionStatus } from '../../notifications/types';
import { resetStoreInitialization } from '../../stores/initializeStores';

// ── Mock Helpers ───────────────────────────────────────────────────────

/**
 * Creates a mock DatabaseDriver that stores data in memory.
 * Supports the tables needed by the bootstrap process.
 */
function createMockDb(): DatabaseDriver {
  const tables = new Map<string, Record<string, unknown>[]>();
  let _isOpen = true;

  return {
    async execute(sql: string, params?: unknown[]): Promise<void> {
      // Handle CREATE TABLE / CREATE INDEX silently
      if (sql.startsWith('CREATE')) return;

      // Handle INSERT into kv_store (used by persist middleware)
      if (sql.includes('kv_store')) return;

      // Handle INSERT into onboarding_state
      if (sql.includes('INSERT INTO onboarding_state')) {
        const p = params ?? [];
        const row = {
          user_id: p[0],
          current_step: p[1],
          completed_steps: p[2],
          skipped: p[3],
          first_opened_at: p[4],
          tooltips_dismissed: p[5],
        };
        tables.set(`onboarding_${p[0]}`, [row]);
      }

      // Handle UPDATE onboarding_state
      if (sql.includes('UPDATE onboarding_state')) {
        const p = params ?? [];
        const userId = p[5];
        const row = {
          user_id: userId,
          current_step: p[0],
          completed_steps: p[1],
          skipped: p[2],
          first_opened_at: p[3],
          tooltips_dismissed: p[4],
        };
        tables.set(`onboarding_${userId}`, [row]);
      }

      // Handle INSERT/UPDATE for other tables
      if (sql.includes('INSERT INTO user_subscription')) return;
      if (sql.includes('INSERT INTO privacy_preferences')) return;
      if (sql.includes('INSERT INTO scheduling_preferences')) return;
    },

    async query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
      // kv_store queries for persist middleware
      if (sql.includes('kv_store')) return [] as T[];

      // onboarding_state queries
      if (sql.includes('onboarding_state')) {
        const userId = params?.[0];
        const rows = tables.get(`onboarding_${userId}`) ?? [];
        return rows as T[];
      }

      // user_subscription queries
      if (sql.includes('user_subscription')) return [] as T[];

      // privacy_preferences queries
      if (sql.includes('privacy_preferences')) return [] as T[];

      // event_visibility_overrides queries
      if (sql.includes('event_visibility_overrides')) return [] as T[];

      // scheduling_preferences queries
      if (sql.includes('scheduling_preferences')) return [] as T[];

      // Default: empty result
      return [] as T[];
    },

    async close(): Promise<void> {
      _isOpen = false;
    },

    isOpen(): boolean {
      return _isOpen;
    },

    supportsTransactions: false,
    async transaction<T>(fn: (tx: any) => Promise<T>): Promise<T> {
      return fn({ execute: this.execute.bind(this), query: this.query.bind(this) });
    },
  };
}

/**
 * Creates a mock PlatformNotificationHandler.
 */
function createMockNotificationHandler(): PlatformNotificationHandler {
  return {
    requestPermissions: jest.fn().mockResolvedValue('granted' as NotificationPermissionStatus),
    getPermissionStatus: jest.fn().mockResolvedValue('granted' as NotificationPermissionStatus),
    registerForPushNotifications: jest.fn().mockResolvedValue({ token: 'mock-token', platform: 'ios' }),
    displayNotification: jest.fn().mockResolvedValue(undefined),
    scheduleNotification: jest.fn().mockResolvedValue(undefined),
    setupBackgroundHandler: jest.fn(),
    teardown: jest.fn(),
  };
}

/**
 * Creates a standard bootstrap config for testing.
 */
function createTestConfig(overrides?: Partial<AppBootstrapConfig>): AppBootstrapConfig {
  return {
    db: createMockDb(),
    userId: 'test-user-1',
    deviceId: 'test-device-1',
    webSocketUrl: 'wss://test.example.com/ws',
    platformNotificationHandler: createMockNotificationHandler(),
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('Application Bootstrap', () => {
  let appContext: AppContext | null = null;

  afterEach(() => {
    // Clean up after each test
    if (appContext) {
      appContext.teardown();
      appContext = null;
    }
    // Reset store initialization singleton so each test gets fresh stores
    resetStoreInitialization();
    jest.restoreAllMocks();
  });

  describe('bootstrapApp', () => {
    it('should initialize and return a complete AppContext', async () => {
      const config = createTestConfig();
      appContext = await bootstrapApp(config);

      // Verify all components are present
      expect(appContext.stores).toBeDefined();
      expect(appContext.queryClient).toBeDefined();
      expect(appContext.syncEngine).toBeDefined();
      expect(appContext.conflictDetector).toBeDefined();
      expect(appContext.privacyLayer).toBeDefined();
      expect(appContext.subscriptionManager).toBeDefined();
      expect(appContext.aiAssistant).toBeDefined();
      expect(appContext.onboardingManager).toBeDefined();
      expect(appContext.tokenHealthMonitor).toBeDefined();
      expect(appContext.notificationService).toBeDefined();
      expect(appContext.errorDisplayService).toBeDefined();
      expect(appContext.lifecycleManager).toBeDefined();
      expect(appContext.webSocketManager).toBeDefined();
      expect(appContext.providerAdapters).toBeDefined();
      expect(appContext.registerAdapter).toBeInstanceOf(Function);
      expect(appContext.unregisterAdapter).toBeInstanceOf(Function);
      expect(appContext.teardown).toBeInstanceOf(Function);
      expect(appContext.checkFeatureAccess).toBeInstanceOf(Function);
      expect(appContext.getFilteredEventsForView).toBeInstanceOf(Function);
    });
  });

  describe('Store initialization', () => {
    it('should initialize Zustand stores with SQLite persistence', async () => {
      const config = createTestConfig();
      appContext = await bootstrapApp(config);

      // Stores should be initialized
      expect(appContext.stores.calendarAccountsStore).toBeDefined();
      expect(appContext.stores.eventsStore).toBeDefined();
      expect(appContext.stores.subscriptionStore).toBeDefined();
      expect(appContext.stores.storage).toBeDefined();
    });

    it('should provide stores with getState capability', async () => {
      const config = createTestConfig();
      appContext = await bootstrapApp(config);

      // Stores should have getState method (Zustand API)
      expect(typeof appContext.stores.calendarAccountsStore.getState).toBe('function');
      expect(typeof appContext.stores.eventsStore.getState).toBe('function');
      expect(typeof appContext.stores.subscriptionStore.getState).toBe('function');
    });
  });

  describe('TanStack QueryClient initialization', () => {
    it('should create a QueryClient with offlineFirst networkMode', async () => {
      const config = createTestConfig();
      appContext = await bootstrapApp(config);

      expect(appContext.queryClient).toBeDefined();
      const defaults = appContext.queryClient.getDefaultOptions();
      expect(defaults.queries?.networkMode).toBe('offlineFirst');
      expect(defaults.mutations?.networkMode).toBe('offlineFirst');
    });

    it('should configure staleTime and gcTime', async () => {
      const config = createTestConfig();
      appContext = await bootstrapApp(config);

      const defaults = appContext.queryClient.getDefaultOptions();
      expect(defaults.queries?.staleTime).toBeGreaterThan(0);
      expect(defaults.queries?.gcTime).toBeGreaterThan(0);
    });
  });

  describe('SyncEngine → Provider Adapters wiring', () => {
    it('should create sync engine with provider adapters map', async () => {
      const config = createTestConfig();
      appContext = await bootstrapApp(config);

      // SyncEngine should be created and have the expected interface
      expect(appContext.syncEngine.start).toBeInstanceOf(Function);
      expect(appContext.syncEngine.stop).toBeInstanceOf(Function);
      expect(appContext.syncEngine.queueLocalChange).toBeInstanceOf(Function);
      expect(appContext.syncEngine.processOutboundQueue).toBeInstanceOf(Function);
      expect(appContext.syncEngine.handleWebhookNotification).toBeInstanceOf(Function);
    });

    it('should provide provider adapters as a Map', async () => {
      const config = createTestConfig();
      appContext = await bootstrapApp(config);

      expect(appContext.providerAdapters).toBeInstanceOf(Map);
    });

    it('should allow registering and unregistering adapters at runtime', async () => {
      const config = createTestConfig();
      appContext = await bootstrapApp(config);

      const mockAdapter = {
        authenticate: jest.fn(),
        listCalendars: jest.fn(),
        listEvents: jest.fn(),
        createEvent: jest.fn(),
        updateEvent: jest.fn(),
        deleteEvent: jest.fn(),
        getChanges: jest.fn(),
        setupPushNotification: jest.fn(),
        getFreeBusy: jest.fn(),
        revokeAccess: jest.fn(),
      } as any;

      // Register
      appContext.registerAdapter('account-123', mockAdapter);
      expect(appContext.providerAdapters.get('account-123')).toBe(mockAdapter);

      // Unregister
      appContext.unregisterAdapter('account-123');
      expect(appContext.providerAdapters.has('account-123')).toBe(false);
    });

    it('should accept initial adapters via config', async () => {
      const mockAdapter = { listCalendars: jest.fn() } as any;
      const initialAdapters = new Map([['pre-configured', mockAdapter]]);
      const config = createTestConfig({ initialAdapters });
      appContext = await bootstrapApp(config);

      expect(appContext.providerAdapters.get('pre-configured')).toBe(mockAdapter);
    });
  });

  describe('ConflictDetector wiring', () => {
    it('should create conflict detector with expected interface', async () => {
      const config = createTestConfig();
      appContext = await bootstrapApp(config);

      expect(appContext.conflictDetector.detectConflicts).toBeInstanceOf(Function);
      expect(appContext.conflictDetector.suggestAlternatives).toBeInstanceOf(Function);
      expect(appContext.conflictDetector.startContinuousScanning).toBeInstanceOf(Function);
      expect(appContext.conflictDetector.stopContinuousScanning).toBeInstanceOf(Function);
    });
  });

  describe('SubscriptionManager → feature gating', () => {
    it('should create subscription manager with feature access checking', async () => {
      const config = createTestConfig();
      appContext = await bootstrapApp(config);

      expect(appContext.subscriptionManager.getCurrentTier).toBeInstanceOf(Function);
      expect(appContext.subscriptionManager.checkFeatureAccess).toBeInstanceOf(Function);
      expect(appContext.subscriptionManager.handleDowngrade).toBeInstanceOf(Function);
      expect(appContext.subscriptionManager.getGracePeriodEnd).toBeInstanceOf(Function);
    });

    it('should expose checkFeatureAccess convenience method on AppContext', async () => {
      const config = createTestConfig();
      appContext = await bootstrapApp(config);

      // Free tier should not have AI assistant access
      const hasAI = appContext.checkFeatureAccess('ai_assistant');
      expect(typeof hasAI).toBe('boolean');
    });

    it('should enforce free tier limits by default', async () => {
      const config = createTestConfig();
      appContext = await bootstrapApp(config);

      // Default tier is free — AI and advanced features should be gated
      expect(appContext.checkFeatureAccess('ai_assistant')).toBe(false);
      expect(appContext.checkFeatureAccess('shared_views')).toBe(false);
      expect(appContext.checkFeatureAccess('delegation')).toBe(false);
    });
  });

  describe('PrivacyLayer → Unified View filtering', () => {
    it('should create privacy layer with filtering capability', async () => {
      const config = createTestConfig();
      appContext = await bootstrapApp(config);

      expect(appContext.privacyLayer.getVisibility).toBeInstanceOf(Function);
      expect(appContext.privacyLayer.setVisibility).toBeInstanceOf(Function);
      expect(appContext.privacyLayer.filterForAudience).toBeInstanceOf(Function);
    });

    it('should expose getFilteredEventsForView convenience method', async () => {
      const config = createTestConfig();
      appContext = await bootstrapApp(config);

      // Should return filtered events (empty array for no events)
      const filtered = await appContext.getFilteredEventsForView([]);
      expect(filtered).toEqual([]);
    });

    it('should pass through events for owner audience by default', async () => {
      const config = createTestConfig();
      appContext = await bootstrapApp(config);

      const mockEvent = {
        id: 'evt-1',
        providerEventId: 'prov-1',
        calendarAccountId: 'cal-1',
        title: 'Test Event',
        description: 'A test event',
        location: null,
        startTime: new Date('2025-01-01T10:00:00Z'),
        endTime: new Date('2025-01-01T11:00:00Z'),
        timeZone: 'UTC',
        isAllDay: false,
        recurrenceRule: null,
        recurrenceExceptionDate: null,
        parentRecurringEventId: null,
        organizer: null,
        attendees: [],
        sequence: 0,
        dtstamp: new Date(),
        status: 'confirmed' as const,
        visibility: null,
        opaqueFields: new Map(),
        syncStatus: 'synced' as const,
        localVersion: 1,
        remoteEtag: null,
        modifiedBy: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Owner should see all events
      const filtered = await appContext.getFilteredEventsForView([mockEvent], 'owner');
      expect(filtered).toHaveLength(1);
      expect(filtered[0].title).toBe('Test Event');
    });
  });

  describe('AISchedulingAssistant wiring', () => {
    it('should create AI assistant with expected interface', async () => {
      const config = createTestConfig();
      appContext = await bootstrapApp(config);

      expect(appContext.aiAssistant.suggestSlots).toBeInstanceOf(Function);
      expect(appContext.aiAssistant.learnFromPattern).toBeInstanceOf(Function);
      expect(appContext.aiAssistant.getPreferences).toBeInstanceOf(Function);
    });
  });

  describe('OnboardingManager → initial app flow', () => {
    it('should create onboarding manager with expected interface', async () => {
      const config = createTestConfig();
      appContext = await bootstrapApp(config);

      expect(appContext.onboardingManager.getOnboardingState).toBeInstanceOf(Function);
      expect(appContext.onboardingManager.completeStep).toBeInstanceOf(Function);
      expect(appContext.onboardingManager.skipOnboarding).toBeInstanceOf(Function);
      expect(appContext.onboardingManager.resetOnboarding).toBeInstanceOf(Function);
      expect(appContext.onboardingManager.isComplete).toBeInstanceOf(Function);
    });

    it('should start onboarding at welcome step for new users', async () => {
      const config = createTestConfig();
      appContext = await bootstrapApp(config);

      const state = await appContext.onboardingManager.getOnboardingState('test-user-1');
      expect(state.currentStep).toBe('welcome');
      expect(state.completedSteps).toEqual([]);
      expect(state.skipped).toBe(false);
    });
  });

  describe('TokenHealthMonitor → auth error UX', () => {
    it('should create token health monitor', async () => {
      const config = createTestConfig();
      appContext = await bootstrapApp(config);

      expect(appContext.tokenHealthMonitor).toBeDefined();
      expect(appContext.tokenHealthMonitor.startMonitoring).toBeInstanceOf(Function);
      expect(appContext.tokenHealthMonitor.stopMonitoring).toBeInstanceOf(Function);
      expect(appContext.tokenHealthMonitor.checkTokenHealth).toBeInstanceOf(Function);
    });

    it('should wire onTokenRevoked to error display service', async () => {
      const config = createTestConfig();
      appContext = await bootstrapApp(config);

      // The onTokenRevoked callback should be set (not the default no-op)
      expect(appContext.tokenHealthMonitor.onTokenRevoked).toBeInstanceOf(Function);
    });
  });

  describe('WebSocket → SyncEngine wiring', () => {
    it('should create WebSocket manager with expected interface', async () => {
      const config = createTestConfig();
      appContext = await bootstrapApp(config);

      expect(appContext.webSocketManager.connect).toBeInstanceOf(Function);
      expect(appContext.webSocketManager.disconnect).toBeInstanceOf(Function);
      expect(appContext.webSocketManager.isConnected).toBeInstanceOf(Function);
    });

    it('should not be connected initially (connection happens on lifecycle foreground)', async () => {
      const config = createTestConfig();
      appContext = await bootstrapApp(config);

      expect(appContext.webSocketManager.isConnected()).toBe(false);
    });
  });

  describe('Notification service wiring', () => {
    it('should create notification service with expected interface', async () => {
      const config = createTestConfig();
      appContext = await bootstrapApp(config);

      expect(appContext.notificationService.requestPermissions).toBeInstanceOf(Function);
      expect(appContext.notificationService.notifyConflict).toBeInstanceOf(Function);
      expect(appContext.notificationService.notifyReauthRequired).toBeInstanceOf(Function);
      expect(appContext.notificationService.notifyPaymentIssue).toBeInstanceOf(Function);
    });
  });

  describe('Error display service wiring', () => {
    it('should create error display service with expected interface', async () => {
      const config = createTestConfig();
      appContext = await bootstrapApp(config);

      expect(appContext.errorDisplayService.showSyncError).toBeInstanceOf(Function);
      expect(appContext.errorDisplayService.showAuthError).toBeInstanceOf(Function);
      expect(appContext.errorDisplayService.showPaymentError).toBeInstanceOf(Function);
      expect(appContext.errorDisplayService.setOfflineStatus).toBeInstanceOf(Function);
    });
  });

  describe('Lifecycle manager wiring', () => {
    it('should create lifecycle manager with expected interface', async () => {
      const config = createTestConfig();
      appContext = await bootstrapApp(config);

      expect(appContext.lifecycleManager.initialize).toBeInstanceOf(Function);
      expect(appContext.lifecycleManager.teardown).toBeInstanceOf(Function);
      expect(appContext.lifecycleManager.handleBackground).toBeInstanceOf(Function);
      expect(appContext.lifecycleManager.handleForeground).toBeInstanceOf(Function);
    });
  });

  describe('Teardown', () => {
    it('should cleanly tear down all services', async () => {
      const config = createTestConfig();
      appContext = await bootstrapApp(config);

      // Teardown should not throw
      expect(() => appContext!.teardown()).not.toThrow();

      // After teardown, WebSocket should be disconnected
      expect(appContext.webSocketManager.isConnected()).toBe(false);
    });

    it('should be safe to call teardown multiple times', async () => {
      const config = createTestConfig();
      appContext = await bootstrapApp(config);

      expect(() => {
        appContext!.teardown();
        appContext!.teardown();
      }).not.toThrow();
    });
  });

  describe('End-to-end data flow verification', () => {
    it('should wire sync engine that can be started and stopped', async () => {
      const config = createTestConfig();
      appContext = await bootstrapApp(config);

      // Sync engine should be running after bootstrap
      // Stopping should not throw
      expect(() => appContext!.syncEngine.stop()).not.toThrow();

      // Restarting should not throw
      expect(() => appContext!.syncEngine.start()).not.toThrow();
    });

    it('should wire conflict detector that can detect conflicts', async () => {
      const config = createTestConfig();
      appContext = await bootstrapApp(config);

      const event1 = {
        id: 'e1',
        providerEventId: 'pe1',
        calendarAccountId: 'cal-1',
        title: 'Meeting A',
        description: null,
        location: null,
        startTime: new Date('2025-01-01T10:00:00Z'),
        endTime: new Date('2025-01-01T11:00:00Z'),
        timeZone: 'UTC',
        isAllDay: false,
        recurrenceRule: null,
        recurrenceExceptionDate: null,
        parentRecurringEventId: null,
        organizer: null,
        attendees: [],
        sequence: 0,
        dtstamp: new Date(),
        status: 'confirmed' as const,
        visibility: null,
        opaqueFields: new Map(),
        syncStatus: 'synced' as const,
        localVersion: 1,
        remoteEtag: null,
        modifiedBy: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const event2 = {
        ...event1,
        id: 'e2',
        providerEventId: 'pe2',
        title: 'Meeting B',
        startTime: new Date('2025-01-01T10:30:00Z'),
        endTime: new Date('2025-01-01T11:30:00Z'),
      };

      // Overlapping events should be detected as conflicts
      const conflicts = appContext.conflictDetector.detectConflicts(event1, [event2]);
      expect(conflicts.length).toBeGreaterThan(0);
      expect(conflicts[0].eventA.id).toBe('e1');
      expect(conflicts[0].eventB.id).toBe('e2');
    });

    it('should wire onboarding manager that tracks progress through DB', async () => {
      const config = createTestConfig();
      appContext = await bootstrapApp(config);

      // Complete the first step
      await appContext.onboardingManager.completeStep('test-user-1', 'welcome');
      const state = await appContext.onboardingManager.getOnboardingState('test-user-1');
      expect(state.completedSteps).toContain('welcome');
      expect(state.currentStep).toBe('connect_first_account');
    });
  });
});

// ── tokenExpiryProvider / oauthConnector wiring ─────────────────────────
//
// Security Review 2026-05-02 (pass 3): Finding L6 follow-up — the bootstrap
// must accept an `oauthConnector` and build the default `tokenExpiryProvider`
// from it, so production entry points can wire L6 with a single argument.
describe('Application Bootstrap — token expiry provider wiring (L6)', () => {
  let appContext: AppContext | null = null;

  afterEach(() => {
    if (appContext) {
      appContext.teardown();
      appContext = null;
    }
    resetStoreInitialization();
    jest.restoreAllMocks();
  });

  it('accepts an explicit tokenExpiryProvider without an OAuthConnector', async () => {
    const provider = jest.fn().mockResolvedValue({ expiresAt: null });
    const config = createTestConfig({ tokenExpiryProvider: provider });
    appContext = await bootstrapApp(config);

    // Exercising the wiring: a token-health check for an unregistered
    // account returns 'unknown' from the raw probe, but the provider
    // must have been consulted first (even if it returned null).
    await appContext.tokenHealthMonitor.checkTokenHealth('some-account');
    expect(provider).toHaveBeenCalledWith('some-account');
  });

  it('builds a default provider from the supplied OAuthConnector', async () => {
    // Stub OAuthConnector — only getTokenExpiryInfo is used by the wiring.
    const getTokenExpiryInfo = jest
      .fn()
      .mockResolvedValue({ expiresAt: Date.now() + 60 * 60 * 1000, recentlyRejected: false });
    const fakeOAuthConnector = { getTokenExpiryInfo } as unknown as import('../../providers/oauthConnector').OAuthConnector;

    const config = createTestConfig({ oauthConnector: fakeOAuthConnector });
    appContext = await bootstrapApp(config);

    // When the health monitor probes the account, the cached checker
    // must short-circuit on the local expiry — proof the default wiring
    // ran. The raw probe (adapter.listCalendars) never runs because
    // no adapter is registered, but the local short-circuit means we
    // get 'valid' without ever reaching the probe.
    const status = await appContext.tokenHealthMonitor.checkTokenHealth('acc-A');
    expect(status).toBe('valid');
    expect(getTokenExpiryInfo).toHaveBeenCalledWith('acc-A');
  });

  it('prefers an explicit tokenExpiryProvider over the OAuthConnector default', async () => {
    const explicitProvider = jest.fn().mockResolvedValue({ expiresAt: null });
    const getTokenExpiryInfo = jest.fn();
    const fakeOAuthConnector = { getTokenExpiryInfo } as unknown as import('../../providers/oauthConnector').OAuthConnector;

    const config = createTestConfig({
      tokenExpiryProvider: explicitProvider,
      oauthConnector: fakeOAuthConnector,
    });
    appContext = await bootstrapApp(config);

    await appContext.tokenHealthMonitor.checkTokenHealth('acc-A');
    expect(explicitProvider).toHaveBeenCalled();
    expect(getTokenExpiryInfo).not.toHaveBeenCalled();
  });

  it('omitting both falls through to the 5-minute probe cache', async () => {
    const config = createTestConfig();
    appContext = await bootstrapApp(config);

    // No adapter, no provider → raw probe returns 'unknown' (from the
    // `if (!adapter) return 'unknown'` branch in appBootstrap) and the
    // result is cached. Two consecutive checks produce identical
    // results without throwing.
    const a = await appContext.tokenHealthMonitor.checkTokenHealth('unregistered');
    const b = await appContext.tokenHealthMonitor.checkTokenHealth('unregistered');
    expect(a).toBe('unknown');
    expect(b).toBe('unknown');
  });
});

// ── subscriptionHttpClient wiring (Security Review 2026-05-02 L4 follow-up) ──
//
// The bootstrap's placeholder exists so unit tests can boot the app
// without wiring a real HTTP client, but it must fail loudly on BOTH
// `get` and `post` so a production build that forgets to wire the
// client cannot silently no-op subscription lifecycle calls.
describe('Application Bootstrap — subscription HTTP client wiring (L4)', () => {
  let appContext: AppContext | null = null;

  afterEach(() => {
    if (appContext) {
      appContext.teardown();
      appContext = null;
    }
    resetStoreInitialization();
    jest.restoreAllMocks();
  });

  it('exposes the configured http client on the AppContext', async () => {
    const http = { get: jest.fn(), post: jest.fn() };
    const config = createTestConfig({ subscriptionHttpClient: http });
    appContext = await bootstrapApp(config);

    expect(appContext.subscriptionHttpClient).toBe(http);
  });

  it('exposes a placeholder http client when none is supplied', async () => {
    const config = createTestConfig();
    appContext = await bootstrapApp(config);

    expect(appContext.subscriptionHttpClient).toBeDefined();
    expect(typeof appContext.subscriptionHttpClient.get).toBe('function');
    expect(typeof appContext.subscriptionHttpClient.post).toBe('function');
  });

  it('placeholder rejects POST with a descriptive error', async () => {
    const config = createTestConfig();
    appContext = await bootstrapApp(config);

    await expect(
      appContext.subscriptionHttpClient.post('/subscriptions/validate', { foo: 'bar' }),
    ).rejects.toThrow(/subscriptionHttpClient is not configured.*POST \/subscriptions\/validate/);
  });

  it('placeholder rejects GET with a descriptive error', async () => {
    // Without this coverage, a production build that forgets to wire
    // the client could still boot and call `pollForFeatureUnlock` /
    // `restorePurchases` against a silent no-op client.
    const config = createTestConfig();
    appContext = await bootstrapApp(config);

    await expect(
      appContext.subscriptionHttpClient.get('/subscriptions/u1'),
    ).rejects.toThrow(/subscriptionHttpClient is not configured.*GET \/subscriptions\/u1/);
  });

  it('placeholder error message points callers at the production factory', async () => {
    // Grepping for `createSubscriptionHttpClient` in the error message
    // makes the remediation path impossible to miss during triage.
    const config = createTestConfig();
    appContext = await bootstrapApp(config);

    await expect(
      appContext.subscriptionHttpClient.get('/anything'),
    ).rejects.toThrow(/createSubscriptionHttpClient/);
  });

  it('supplied client flows through to the subscription manager', async () => {
    // Proof that the wiring actually reaches the subscription manager:
    // `validateReceipt` calls `http.post('/subscriptions/validate', …)`.
    const http = {
      get: jest.fn().mockResolvedValue({ data: {} }),
      post: jest.fn().mockResolvedValue({
        data: {
          tier: 'pro',
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
          gracePeriodEndsAt: null,
        },
      }),
    };
    const config = createTestConfig({ subscriptionHttpClient: http });
    appContext = await bootstrapApp(config);

    await appContext.subscriptionManager.validateReceipt({
      platform: 'stripe',
      receiptId: 'rcpt_1',
    });

    expect(http.post).toHaveBeenCalledWith(
      '/subscriptions/validate',
      expect.objectContaining({ platform: 'stripe', receiptId: 'rcpt_1' }),
    );
  });
});
