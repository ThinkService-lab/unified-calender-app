/**
 * Unit tests for SubscriptionManager.
 * Requirements: 10.1, 10.2, 10.3, 10.4, 10.6
 */

import { createStore } from 'zustand/vanilla';
import { immer } from 'zustand/middleware/immer';
import type { SubscriptionState } from '../../stores/subscriptionStore';
import { TIER_FEATURES } from '../../stores/subscriptionStore';
import type { SubscriptionTier, Feature } from '../../types/subscription';
import {
  createSubscriptionManager,
  GRACE_PERIOD_MS,
  FREE_TIER_MAX_ACCOUNTS,
} from '../subscriptionManager';
import type { SubscriptionManager, HttpClient } from '../subscriptionManager';
import type { DatabaseDriver } from '../../db/database';
import type { PlatformReceipt } from '../types';

// ── Test helpers ──────────────────────────────────────────────────────

/** In-memory rows keyed by user_id */
type SubRow = {
  user_id: string;
  tier: string;
  platform: string;
  receipt_id: string | null;
  expires_at: number | null;
  grace_period_ends_at: number | null;
  auto_renew: number;
  connected_account_count: number;
};

function createMockDb(initialRows: SubRow[] = []): DatabaseDriver {
  const rows = new Map<string, SubRow>();
  for (const r of initialRows) rows.set(r.user_id, r);

  return {
    async execute(sql: string, params?: unknown[]): Promise<void> {
      if (sql.trim().startsWith('UPDATE')) {
        // Simple UPDATE parser for our specific query
        const userId = params![2] as string;
        const existing = rows.get(userId);
        if (existing) {
          existing.tier = params![0] as string;
          existing.grace_period_ends_at = params![1] as number | null;
        }
      }
    },
    async query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
      if (sql.includes('user_subscription')) {
        const userId = params?.[0] as string;
        const row = rows.get(userId);
        return (row ? [row] : []) as T[];
      }
      return [] as T[];
    },
    async close() {},
    isOpen() { return true; },
    supportsTransactions: false,
    async transaction<T>(fn: (tx: any) => Promise<T>): Promise<T> {
      return fn({ execute: this.execute.bind(this), query: this.query.bind(this) });
    },
  };
}

function createMockHttp(response?: unknown): HttpClient {
  return {
    async post<T>(_url: string, _body: unknown): Promise<{ data: T }> {
      return { data: response as T };
    },
  };
}

function createTestStore(overrides: Partial<SubscriptionState> = {}) {
  const initial: Omit<SubscriptionState, 'setTier' | 'setSubscription' | 'setGracePeriod' | 'checkFeatureAccess' | 'isInGracePeriod' | 'getAvailableFeatures' | 'reset'> = {
    tier: 'free',
    previousTier: null,
    expiresAt: null,
    gracePeriodEndsAt: null,
    autoRenew: false,
    platform: null,
    ...overrides,
  };

  return createStore<SubscriptionState>()(
    immer((set, get) => ({
      ...initial,
      setTier: (tier: SubscriptionTier) =>
        set((state) => {
          if (state.tier !== 'free' && tier === 'free') {
            state.previousTier = state.tier;
          }
          state.tier = tier;
        }),
      setSubscription: (data) =>
        set((state) => {
          if (state.tier !== 'free' && data.tier === 'free') {
            state.previousTier = state.tier;
          }
          state.tier = data.tier;
          state.expiresAt = data.expiresAt;
          state.gracePeriodEndsAt = data.gracePeriodEndsAt;
          state.autoRenew = data.autoRenew;
          state.platform = data.platform;
        }),
      setGracePeriod: (endsAt: Date | null) =>
        set((state) => { state.gracePeriodEndsAt = endsAt; }),
      checkFeatureAccess: (feature: Feature) => {
        const { tier } = get();
        return TIER_FEATURES[tier].includes(feature);
      },
      isInGracePeriod: () => {
        const { gracePeriodEndsAt } = get();
        if (!gracePeriodEndsAt) return false;
        return new Date() < gracePeriodEndsAt;
      },
      getAvailableFeatures: () => [...TIER_FEATURES[get().tier]],
      reset: () => set({ tier: 'free', previousTier: null, expiresAt: null, gracePeriodEndsAt: null, autoRenew: false, platform: null }),
    })),
  );
}

// ── Tests ─────────────────────────────────────────────────────────────

describe('SubscriptionManager', () => {
  let manager: SubscriptionManager;
  let store: ReturnType<typeof createTestStore>;
  let db: DatabaseDriver;

  beforeEach(() => {
    store = createTestStore();
    db = createMockDb();
    manager = createSubscriptionManager({ db, store, http: createMockHttp() });
  });

  // ── getCurrentTier ────────────────────────────────────────────────

  describe('getCurrentTier', () => {
    it('returns free for a new user', () => {
      expect(manager.getCurrentTier('user-1')).toBe('free');
    });

    it('returns pro when store tier is pro', () => {
      store.getState().setTier('pro');
      expect(manager.getCurrentTier('user-1')).toBe('pro');
    });

    it('returns team when store tier is team', () => {
      store.getState().setTier('team');
      expect(manager.getCurrentTier('user-1')).toBe('team');
    });

    it('returns previous paid tier during grace period', () => {
      const futureDate = new Date(Date.now() + GRACE_PERIOD_MS);
      store.getState().setSubscription({
        tier: 'pro',
        expiresAt: null,
        gracePeriodEndsAt: null,
        autoRenew: true,
        platform: 'stripe',
      });
      // Simulate payment failure: tier drops to free, grace period set
      store.getState().setSubscription({
        tier: 'free',
        expiresAt: null,
        gracePeriodEndsAt: futureDate,
        autoRenew: false,
        platform: 'stripe',
      });

      expect(manager.getCurrentTier('user-1')).toBe('pro');
    });

    it('returns free after grace period expires', () => {
      const pastDate = new Date(Date.now() - 1000);
      store.getState().setSubscription({
        tier: 'pro',
        expiresAt: null,
        gracePeriodEndsAt: null,
        autoRenew: true,
        platform: 'stripe',
      });
      store.getState().setSubscription({
        tier: 'free',
        expiresAt: null,
        gracePeriodEndsAt: pastDate,
        autoRenew: false,
        platform: 'stripe',
      });

      expect(manager.getCurrentTier('user-1')).toBe('free');
    });
  });

  // ── checkFeatureAccess ────────────────────────────────────────────

  describe('checkFeatureAccess', () => {
    it('denies all premium features on free tier', () => {
      const features: Feature[] = [
        'unlimited_accounts', 'ai_assistant', 'conflict_detection',
        'advanced_privacy', 'shared_views', 'delegation',
      ];
      for (const f of features) {
        expect(manager.checkFeatureAccess('user-1', f)).toBe(false);
      }
    });

    it('grants pro features on pro tier', () => {
      store.getState().setTier('pro');
      expect(manager.checkFeatureAccess('user-1', 'unlimited_accounts')).toBe(true);
      expect(manager.checkFeatureAccess('user-1', 'ai_assistant')).toBe(true);
      expect(manager.checkFeatureAccess('user-1', 'conflict_detection')).toBe(true);
      expect(manager.checkFeatureAccess('user-1', 'advanced_privacy')).toBe(true);
    });

    it('denies team-only features on pro tier', () => {
      store.getState().setTier('pro');
      expect(manager.checkFeatureAccess('user-1', 'shared_views')).toBe(false);
      expect(manager.checkFeatureAccess('user-1', 'delegation')).toBe(false);
    });

    it('grants all features on team tier', () => {
      store.getState().setTier('team');
      const features: Feature[] = [
        'unlimited_accounts', 'ai_assistant', 'conflict_detection',
        'advanced_privacy', 'shared_views', 'delegation',
      ];
      for (const f of features) {
        expect(manager.checkFeatureAccess('user-1', f)).toBe(true);
      }
    });

    it('grants previous tier features during grace period', () => {
      const futureDate = new Date(Date.now() + GRACE_PERIOD_MS);
      store.getState().setSubscription({
        tier: 'team',
        expiresAt: null,
        gracePeriodEndsAt: null,
        autoRenew: true,
        platform: 'stripe',
      });
      store.getState().setSubscription({
        tier: 'free',
        expiresAt: null,
        gracePeriodEndsAt: futureDate,
        autoRenew: false,
        platform: 'stripe',
      });

      expect(manager.checkFeatureAccess('user-1', 'shared_views')).toBe(true);
      expect(manager.checkFeatureAccess('user-1', 'delegation')).toBe(true);
    });
  });

  // ── validateReceipt ───────────────────────────────────────────────

  describe('validateReceipt', () => {
    it('calls backend and returns parsed validation', async () => {
      const expiresAt = new Date('2025-12-31T00:00:00Z');
      const mockHttp = createMockHttp({
        tier: 'pro',
        expiresAt: expiresAt.toISOString(),
        gracePeriodEndsAt: null,
      });

      const mgr = createSubscriptionManager({ db, store, http: mockHttp });
      const receipt: PlatformReceipt = { platform: 'stripe', receiptId: 'rcpt_123' };
      const result = await mgr.validateReceipt(receipt);

      expect(result.tier).toBe('pro');
      expect(result.expiresAt).toEqual(expiresAt);
      expect(result.gracePeriodEndsAt).toBeNull();
    });

    it('parses gracePeriodEndsAt when present', async () => {
      const graceEnd = new Date('2025-07-15T00:00:00Z');
      const mockHttp = createMockHttp({
        tier: 'free',
        expiresAt: new Date('2025-07-08T00:00:00Z').toISOString(),
        gracePeriodEndsAt: graceEnd.toISOString(),
      });

      const mgr = createSubscriptionManager({ db, store, http: mockHttp });
      const result = await mgr.validateReceipt({ platform: 'app_store', receiptId: 'rcpt_456' });

      expect(result.gracePeriodEndsAt).toEqual(graceEnd);
    });
  });

  // ── handleDowngrade ───────────────────────────────────────────────

  describe('handleDowngrade', () => {
    it('updates tier in DB and syncs store', async () => {
      const futureExpiry = Date.now() + 30 * 24 * 60 * 60 * 1000; // 30 days
      const row: SubRow = {
        user_id: 'user-1',
        tier: 'pro',
        platform: 'stripe',
        receipt_id: 'rcpt_1',
        expires_at: futureExpiry,
        grace_period_ends_at: null,
        auto_renew: 1,
        connected_account_count: 5,
      };
      db = createMockDb([row]);
      store.getState().setSubscription({
        tier: 'pro',
        expiresAt: new Date(futureExpiry),
        gracePeriodEndsAt: null,
        autoRenew: true,
        platform: 'stripe',
      });

      manager = createSubscriptionManager({ db, store, http: createMockHttp() });
      await manager.handleDowngrade('user-1', 'free');

      // Store should reflect the downgrade with grace period until billing end
      const state = store.getState();
      expect(state.tier).toBe('free');
      expect(state.gracePeriodEndsAt).not.toBeNull();
    });

    it('retains data (does not delete accounts)', async () => {
      const row: SubRow = {
        user_id: 'user-1',
        tier: 'team',
        platform: 'stripe',
        receipt_id: 'rcpt_1',
        expires_at: Date.now() + 86400000,
        grace_period_ends_at: null,
        auto_renew: 1,
        connected_account_count: 10,
      };
      db = createMockDb([row]);
      store.getState().setTier('team');

      manager = createSubscriptionManager({ db, store, http: createMockHttp() });
      await manager.handleDowngrade('user-1', 'free');

      // connected_account_count should remain unchanged (data retained)
      const rows = await db.query<SubRow>('SELECT * FROM user_subscription WHERE user_id = ?', ['user-1']);
      expect(rows[0].connected_account_count).toBe(10);
    });

    it('sets grace period to billing period end when still active', async () => {
      const futureExpiry = Date.now() + 15 * 24 * 60 * 60 * 1000; // 15 days
      const row: SubRow = {
        user_id: 'user-1',
        tier: 'pro',
        platform: 'app_store',
        receipt_id: 'rcpt_1',
        expires_at: futureExpiry,
        grace_period_ends_at: null,
        auto_renew: 1,
        connected_account_count: 2,
      };
      db = createMockDb([row]);
      store.getState().setSubscription({
        tier: 'pro',
        expiresAt: new Date(futureExpiry),
        gracePeriodEndsAt: null,
        autoRenew: true,
        platform: 'app_store',
      });

      manager = createSubscriptionManager({ db, store, http: createMockHttp() });
      await manager.handleDowngrade('user-1', 'free');

      const rows = await db.query<SubRow>('SELECT * FROM user_subscription WHERE user_id = ?', ['user-1']);
      expect(rows[0].grace_period_ends_at).toBe(futureExpiry);
    });
  });

  // ── getGracePeriodEnd ─────────────────────────────────────────────

  describe('getGracePeriodEnd', () => {
    it('returns null when no grace period is set', () => {
      expect(manager.getGracePeriodEnd('user-1')).toBeNull();
    });

    it('returns the date when grace period is active', () => {
      const futureDate = new Date(Date.now() + GRACE_PERIOD_MS);
      store.getState().setGracePeriod(futureDate);

      const result = manager.getGracePeriodEnd('user-1');
      expect(result).toEqual(futureDate);
    });

    it('returns null when grace period has expired', () => {
      const pastDate = new Date(Date.now() - 1000);
      store.getState().setGracePeriod(pastDate);

      expect(manager.getGracePeriodEnd('user-1')).toBeNull();
    });
  });

  // ── Tier feature map correctness ──────────────────────────────────

  describe('tier feature map', () => {
    it('free tier has no premium features', () => {
      expect(TIER_FEATURES.free).toEqual([]);
    });

    it('pro tier has exactly 4 features', () => {
      expect(TIER_FEATURES.pro).toEqual([
        'unlimited_accounts',
        'ai_assistant',
        'conflict_detection',
        'advanced_privacy',
      ]);
    });

    it('team tier includes all pro features plus shared_views and delegation', () => {
      for (const f of TIER_FEATURES.pro) {
        expect(TIER_FEATURES.team).toContain(f);
      }
      expect(TIER_FEATURES.team).toContain('shared_views');
      expect(TIER_FEATURES.team).toContain('delegation');
    });
  });

  // ── Constants ─────────────────────────────────────────────────────

  describe('constants', () => {
    it('grace period is 7 days', () => {
      expect(GRACE_PERIOD_MS).toBe(7 * 24 * 60 * 60 * 1000);
    });

    it('free tier max accounts is 3', () => {
      expect(FREE_TIER_MAX_ACCOUNTS).toBe(3);
    });
  });
});
