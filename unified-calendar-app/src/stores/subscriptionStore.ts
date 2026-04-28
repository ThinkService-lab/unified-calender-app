/**
 * Subscription store tracking current tier, grace period, and feature access.
 * Uses immer + devtools middleware.
 * Requirements: 2.1, 6.1
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { devtools } from 'zustand/middleware';
import { useShallow } from 'zustand/react/shallow';
import type { SubscriptionTier, Feature } from '../types/subscription';
import type { StateStorage } from 'zustand/middleware';

/** Feature access map per tier */
const TIER_FEATURES: Record<SubscriptionTier, Feature[]> = {
  free: [],
  pro: [
    'unlimited_accounts',
    'ai_assistant',
    'conflict_detection',
    'advanced_privacy',
  ],
  team: [
    'unlimited_accounts',
    'ai_assistant',
    'conflict_detection',
    'advanced_privacy',
    'shared_views',
    'delegation',
  ],
};

export interface SubscriptionState {
  tier: SubscriptionTier;
  previousTier: SubscriptionTier | null;
  expiresAt: Date | null;
  gracePeriodEndsAt: Date | null;
  autoRenew: boolean;
  platform: 'app_store' | 'play_store' | 'stripe' | null;

  // Actions
  setTier: (tier: SubscriptionTier) => void;
  setSubscription: (data: {
    tier: SubscriptionTier;
    expiresAt: Date | null;
    gracePeriodEndsAt: Date | null;
    autoRenew: boolean;
    platform: 'app_store' | 'play_store' | 'stripe' | null;
  }) => void;
  setGracePeriod: (endsAt: Date | null) => void;
  checkFeatureAccess: (feature: Feature) => boolean;
  isInGracePeriod: () => boolean;
  getAvailableFeatures: () => Feature[];
  reset: () => void;
}

const initialState = {
  tier: 'free' as SubscriptionTier,
  previousTier: null as SubscriptionTier | null,
  expiresAt: null as Date | null,
  gracePeriodEndsAt: null as Date | null,
  autoRenew: false,
  platform: null as 'app_store' | 'play_store' | 'stripe' | null,
};

/**
 * Creates the subscription store.
 * Accepts an optional custom storage for persist middleware (defaults to no-op for testing).
 */
export function createSubscriptionStore(storage?: StateStorage) {
  return create<SubscriptionState>()(
    devtools(
      persist(
        immer((set, get) => ({
          ...initialState,

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
        set((state) => {
          state.gracePeriodEndsAt = endsAt;
        }),

      checkFeatureAccess: (feature: Feature) => {
        const { tier, gracePeriodEndsAt, previousTier } = get();
        const effectiveTier = getEffectiveTier(tier, gracePeriodEndsAt, previousTier);
        return TIER_FEATURES[effectiveTier].includes(feature);
      },

      isInGracePeriod: () => {
        const { gracePeriodEndsAt } = get();
        if (!gracePeriodEndsAt) return false;
        return new Date() < gracePeriodEndsAt;
      },

      getAvailableFeatures: () => {
        const { tier, gracePeriodEndsAt, previousTier } = get();
        const effectiveTier = getEffectiveTier(tier, gracePeriodEndsAt, previousTier);
        return [...TIER_FEATURES[effectiveTier]];
      },

      reset: () => set(initialState),
        })),
        {
          name: 'subscription-storage',
          storage: storage ? createJSONStorage(() => storage) : undefined,
        }
      ),
      { name: 'SubscriptionStore', enabled: process.env.NODE_ENV !== 'production' }
    )
  );
}

/** Default store instance (created without persistence for import convenience) */
export const useSubscriptionStore = createSubscriptionStore();

/**
 * Determines the effective tier considering grace period.
 * During grace period, the paid tier features remain accessible.
 * After grace period expires, falls back to free.
 *
 * The store tracks `previousTier` so that when a payment fails and `tier`
 * is set to 'free', features from the previous paid tier remain accessible
 * until the grace period expires (Req 10.6).
 */
function getEffectiveTier(
  tier: SubscriptionTier,
  gracePeriodEndsAt: Date | null,
  previousTier?: SubscriptionTier | null,
): SubscriptionTier {
  if (tier !== 'free') return tier;

  // If tier is free but grace period is still active, honour the previous paid tier
  if (gracePeriodEndsAt && previousTier && previousTier !== 'free' && new Date() < gracePeriodEndsAt) {
    return previousTier;
  }

  return 'free';
}

/** Atomic selector hooks */
export const useTier = () => useSubscriptionStore((s) => s.tier);
export const useIsProOrAbove = () =>
  useSubscriptionStore((s) => s.tier === 'pro' || s.tier === 'team');

/** Multi-field selector with useShallow */
export const useSubscriptionSummary = () =>
  useSubscriptionStore(
    useShallow((s) => ({
      tier: s.tier,
      expiresAt: s.expiresAt,
      gracePeriodEndsAt: s.gracePeriodEndsAt,
      autoRenew: s.autoRenew,
    }))
  );

export { TIER_FEATURES };
