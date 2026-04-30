/**
 * Unit tests for WebhookHandler.
 * Requirements: 10.2, 10.3, 10.5, 10.6
 */

import { createStore } from 'zustand/vanilla';
import { immer } from 'zustand/middleware/immer';
import type { SubscriptionState } from '../../stores/subscriptionStore';
import type { SubscriptionTier, Feature } from '../../types/subscription';
import { TIER_FEATURES } from '../../stores/subscriptionStore';
import { createWebhookHandler, GRACE_PERIOD_MS } from '../webhookHandler';
import type { WebhookEventPayload } from '../webhookHandler';
import type { SubscriptionManager } from '../subscriptionManager';

// ── Helpers ───────────────────────────────────────────────────────────

function createTestStore(overrides: Partial<SubscriptionState> = {}) {
  const initial = {
    tier: 'free' as SubscriptionTier,
    previousTier: null as SubscriptionTier | null,
    expiresAt: null as Date | null,
    gracePeriodEndsAt: null as Date | null,
    autoRenew: false,
    platform: null as 'app_store' | 'play_store' | 'stripe' | null,
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
      checkFeatureAccess: (feature: Feature) => TIER_FEATURES[get().tier].includes(feature),
      isInGracePeriod: () => {
        const { gracePeriodEndsAt } = get();
        return gracePeriodEndsAt != null && new Date() < gracePeriodEndsAt;
      },
      getAvailableFeatures: () => [...TIER_FEATURES[get().tier]],
      reset: () => set({
        tier: 'free', previousTier: null, expiresAt: null,
        gracePeriodEndsAt: null, autoRenew: false, platform: null,
      }),
    })),
  );
}

function createMockSubscriptionManager(): SubscriptionManager {
  return {
    getCurrentTier: jest.fn().mockReturnValue('free'),
    getCurrentTierFromDb: jest.fn().mockResolvedValue('free'),
    validateReceipt: jest.fn().mockResolvedValue({ tier: 'free', expiresAt: new Date(), gracePeriodEndsAt: null }),
    checkFeatureAccess: jest.fn().mockReturnValue(false),
    handleDowngrade: jest.fn().mockResolvedValue(undefined),
    getGracePeriodEnd: jest.fn().mockReturnValue(null),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────

describe('WebhookHandler', () => {
  let store: ReturnType<typeof createTestStore>;
  let handler: ReturnType<typeof createWebhookHandler>;

  beforeEach(() => {
    store = createTestStore();
    handler = createWebhookHandler({
      store,
      subscriptionManager: createMockSubscriptionManager(),
    });
  });

  // ── INITIAL_PURCHASE ──────────────────────────────────────────────

  describe('INITIAL_PURCHASE', () => {
    it('upgrades tier to pro on purchase', async () => {
      const event: WebhookEventPayload = {
        type: 'INITIAL_PURCHASE',
        userId: 'user-1',
        tier: 'pro',
        expiresAt: '2025-12-31T00:00:00Z',
        platform: 'stripe',
      };

      await handler.handleEvent(event);

      const state = store.getState();
      expect(state.tier).toBe('pro');
      expect(state.expiresAt).toEqual(new Date('2025-12-31T00:00:00Z'));
      expect(state.autoRenew).toBe(true);
      expect(state.platform).toBe('stripe');
      expect(state.gracePeriodEndsAt).toBeNull();
    });

    it('upgrades tier to team on purchase', async () => {
      const event: WebhookEventPayload = {
        type: 'INITIAL_PURCHASE',
        userId: 'user-1',
        tier: 'team',
        expiresAt: '2026-01-15T00:00:00Z',
        platform: 'app_store',
      };

      await handler.handleEvent(event);

      expect(store.getState().tier).toBe('team');
      expect(store.getState().platform).toBe('app_store');
    });

    it('clears any existing grace period', async () => {
      store.getState().setGracePeriod(new Date(Date.now() + 86400000));

      await handler.handleEvent({
        type: 'INITIAL_PURCHASE',
        userId: 'user-1',
        tier: 'pro',
        expiresAt: '2025-12-31T00:00:00Z',
        platform: 'play_store',
      });

      expect(store.getState().gracePeriodEndsAt).toBeNull();
    });
  });

  // ── RENEWAL ───────────────────────────────────────────────────────

  describe('RENEWAL', () => {
    it('extends expiry and clears grace period', async () => {
      // Start with pro tier that had a billing issue
      store.getState().setSubscription({
        tier: 'pro',
        expiresAt: new Date('2025-06-30T00:00:00Z'),
        gracePeriodEndsAt: new Date(Date.now() + 86400000),
        autoRenew: false,
        platform: 'stripe',
      });

      await handler.handleEvent({
        type: 'RENEWAL',
        userId: 'user-1',
        tier: 'pro',
        expiresAt: '2025-07-31T00:00:00Z',
        platform: 'stripe',
      });

      const state = store.getState();
      expect(state.tier).toBe('pro');
      expect(state.expiresAt).toEqual(new Date('2025-07-31T00:00:00Z'));
      expect(state.gracePeriodEndsAt).toBeNull();
      expect(state.autoRenew).toBe(true);
    });
  });

  // ── CANCELLATION ──────────────────────────────────────────────────

  describe('CANCELLATION', () => {
    it('schedules downgrade at billing period end', async () => {
      store.getState().setSubscription({
        tier: 'pro',
        expiresAt: new Date('2025-07-31T00:00:00Z'),
        gracePeriodEndsAt: null,
        autoRenew: true,
        platform: 'stripe',
      });

      await handler.handleEvent({
        type: 'CANCELLATION',
        userId: 'user-1',
        tier: 'pro',
        expiresAt: '2025-07-31T00:00:00Z',
        platform: 'stripe',
      });

      const state = store.getState();
      expect(state.tier).toBe('pro');
      expect(state.autoRenew).toBe(false);
      // Grace period set to billing period end so features remain active
      expect(state.gracePeriodEndsAt).toEqual(new Date('2025-07-31T00:00:00Z'));
    });
  });

  // ── BILLING_ISSUE ─────────────────────────────────────────────────

  describe('BILLING_ISSUE', () => {
    it('sets 7-day grace period', async () => {
      store.getState().setSubscription({
        tier: 'pro',
        expiresAt: new Date('2025-07-31T00:00:00Z'),
        gracePeriodEndsAt: null,
        autoRenew: true,
        platform: 'app_store',
      });

      const before = Date.now();

      await handler.handleEvent({
        type: 'BILLING_ISSUE',
        userId: 'user-1',
        tier: 'pro',
        expiresAt: '2025-07-31T00:00:00Z',
        platform: 'app_store',
      });

      const after = Date.now();
      const state = store.getState();

      expect(state.tier).toBe('pro');
      expect(state.autoRenew).toBe(false);
      expect(state.gracePeriodEndsAt).not.toBeNull();

      // Grace period should be ~7 days from now
      const graceMs = state.gracePeriodEndsAt!.getTime();
      expect(graceMs).toBeGreaterThanOrEqual(before + GRACE_PERIOD_MS);
      expect(graceMs).toBeLessThanOrEqual(after + GRACE_PERIOD_MS);
    });

    it('keeps current tier during grace period', async () => {
      store.getState().setSubscription({
        tier: 'team',
        expiresAt: new Date('2025-08-15T00:00:00Z'),
        gracePeriodEndsAt: null,
        autoRenew: true,
        platform: 'play_store',
      });

      await handler.handleEvent({
        type: 'BILLING_ISSUE',
        userId: 'user-1',
        tier: 'team',
        expiresAt: '2025-08-15T00:00:00Z',
        platform: 'play_store',
      });

      // Tier should remain team (not downgraded yet)
      expect(store.getState().tier).toBe('team');
    });
  });

  // ── Grace period constant ─────────────────────────────────────────

  describe('GRACE_PERIOD_MS', () => {
    it('equals 7 days in milliseconds', () => {
      expect(GRACE_PERIOD_MS).toBe(7 * 24 * 60 * 60 * 1000);
    });
  });
});
