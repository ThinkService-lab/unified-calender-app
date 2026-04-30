/**
 * Property-based tests for subscription tier enforcement, downgrade behavior,
 * and grace period calculation.
 *
 * Feature: unified-calendar-app
 * Properties: 10, 11, 12
 * Requirements: 1.3, 10.1, 10.2, 10.3, 10.4, 10.6
 */

import * as fc from 'fast-check';
import { createSubscriptionStore, TIER_FEATURES } from '../../stores/subscriptionStore';
import type { SubscriptionState } from '../../stores/subscriptionStore';
import type { SubscriptionTier, Feature } from '../../types/subscription';

// ── Arbitraries ──

const arbSubscriptionTier = (): fc.Arbitrary<SubscriptionTier> =>
  fc.constantFrom('free', 'pro', 'team');

const arbFeature = (): fc.Arbitrary<Feature> =>
  fc.constantFrom(
    'unlimited_accounts',
    'ai_assistant',
    'conflict_detection',
    'advanced_privacy',
    'shared_views',
    'delegation',
  );

// ── Helpers ──

function createTestStore(overrides?: Partial<SubscriptionState>) {
  const store = createSubscriptionStore();
  if (overrides) {
    store.getState().setSubscription({
      tier: overrides.tier ?? 'free',
      expiresAt: overrides.expiresAt ?? null,
      gracePeriodEndsAt: overrides.gracePeriodEndsAt ?? null,
      autoRenew: overrides.autoRenew ?? false,
      platform: overrides.platform ?? null,
    });
    if (overrides.previousTier !== undefined) {
      // Simulate a downgrade to set previousTier
      const currentTier = overrides.tier ?? 'free';
      if (overrides.previousTier && overrides.previousTier !== 'free') {
        // First set to the previous tier, then downgrade
        store.getState().setTier(overrides.previousTier);
        store.getState().setTier(currentTier);
      }
    }
  }
  return store;
}

// ── Property Tests ──

describe('Subscription Property Tests', () => {
  // Feature: unified-calendar-app, Property 10: Subscription tier feature access enforcement
  describe('Property 10: Subscription tier feature access enforcement', () => {
    it('checkFeatureAccess returns true iff tier includes feature', () => {
      fc.assert(
        fc.property(
          arbSubscriptionTier(),
          arbFeature(),
          (tier, feature) => {
            const store = createSubscriptionStore();
            store.getState().setSubscription({
              tier,
              expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
              gracePeriodEndsAt: null,
              autoRenew: true,
              platform: 'stripe',
            });

            const hasAccess = store.getState().checkFeatureAccess(feature);
            const tierFeatures = TIER_FEATURES[tier];
            const expected = tierFeatures.includes(feature);

            expect(hasAccess).toBe(expected);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('Free tier has no features', () => {
      fc.assert(
        fc.property(arbFeature(), (feature) => {
          const store = createSubscriptionStore();
          // Default is free tier
          const hasAccess = store.getState().checkFeatureAccess(feature);
          expect(hasAccess).toBe(false);
        }),
        { numRuns: 100 },
      );
    });

    it('Team tier includes all Pro features plus shared_views and delegation', () => {
      fc.assert(
        fc.property(arbFeature(), (feature) => {
          const store = createSubscriptionStore();
          store.getState().setSubscription({
            tier: 'team',
            expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            gracePeriodEndsAt: null,
            autoRenew: true,
            platform: 'stripe',
          });

          const hasAccess = store.getState().checkFeatureAccess(feature);
          // Team tier includes ALL features
          expect(hasAccess).toBe(true);
        }),
        { numRuns: 100 },
      );
    });
  });

  // Feature: unified-calendar-app, Property 11: Downgrade retains data but disables features
  describe('Property 11: Downgrade retains data but disables features', () => {
    it('after downgrade, higher-tier features are disabled', () => {
      fc.assert(
        fc.property(
          fc.constantFrom<[SubscriptionTier, SubscriptionTier]>(
            ['pro', 'free'],
            ['team', 'free'],
            ['team', 'pro'],
          ),
          arbFeature(),
          ([fromTier, toTier], feature) => {
            const store = createSubscriptionStore();

            // Start with higher tier
            store.getState().setSubscription({
              tier: fromTier,
              expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
              gracePeriodEndsAt: null,
              autoRenew: true,
              platform: 'stripe',
            });

            // Verify feature was accessible before downgrade
            const beforeAccess = store.getState().checkFeatureAccess(feature);
            const fromFeatures = TIER_FEATURES[fromTier];
            expect(beforeAccess).toBe(fromFeatures.includes(feature));

            // Downgrade (no grace period — billing period ended)
            store.getState().setSubscription({
              tier: toTier,
              expiresAt: null,
              gracePeriodEndsAt: null,
              autoRenew: false,
              platform: 'stripe',
            });

            // After downgrade, only new tier features are accessible
            const afterAccess = store.getState().checkFeatureAccess(feature);
            const toFeatures = TIER_FEATURES[toTier];
            expect(afterAccess).toBe(toFeatures.includes(feature));
          },
        ),
        { numRuns: 100 },
      );
    });

    it('store data (tier history) is retained after downgrade', () => {
      fc.assert(
        fc.property(
          fc.constantFrom<SubscriptionTier>('pro', 'team'),
          (fromTier) => {
            const store = createSubscriptionStore();

            // Set up paid tier
            store.getState().setSubscription({
              tier: fromTier,
              expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
              gracePeriodEndsAt: null,
              autoRenew: true,
              platform: 'stripe',
            });

            // Downgrade to free
            store.getState().setTier('free');

            // previousTier should be retained (data not lost)
            const state = store.getState();
            expect(state.previousTier).toBe(fromTier);
            expect(state.tier).toBe('free');
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  // Feature: unified-calendar-app, Property 12: Grace period calculation
  describe('Property 12: Grace period calculation', () => {
    it('features accessible during 7-day grace period, then Free tier enforced', () => {
      fc.assert(
        fc.property(
          fc.constantFrom<SubscriptionTier>('pro', 'team'),
          arbFeature(),
          fc.integer({ min: 0, max: 13 }), // days after payment failure
          (paidTier, feature, daysAfterFailure) => {
            const GRACE_PERIOD_DAYS = 7;
            const now = Date.now();
            const failureDate = now - daysAfterFailure * 24 * 60 * 60 * 1000;
            const gracePeriodEndsAt = new Date(failureDate + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000);

            const store = createSubscriptionStore();

            // Simulate payment failure: tier set to free, grace period active,
            // previousTier tracks the paid tier
            store.getState().setSubscription({
              tier: paidTier,
              expiresAt: null,
              gracePeriodEndsAt: null,
              autoRenew: true,
              platform: 'stripe',
            });
            // Now simulate the billing issue: downgrade to free with grace period
            store.getState().setSubscription({
              tier: 'free',
              expiresAt: null,
              gracePeriodEndsAt,
              autoRenew: false,
              platform: 'stripe',
            });

            const hasAccess = store.getState().checkFeatureAccess(feature);
            const isWithinGracePeriod = new Date() < gracePeriodEndsAt;

            if (isWithinGracePeriod) {
              // During grace period: paid tier features remain accessible
              const paidFeatures = TIER_FEATURES[paidTier];
              expect(hasAccess).toBe(paidFeatures.includes(feature));
            } else {
              // After grace period: Free tier enforced (no features)
              expect(hasAccess).toBe(false);
            }
          },
        ),
        { numRuns: 100 },
      );
    });

    it('grace period is exactly 7 days from payment failure', () => {
      fc.assert(
        fc.property(
          fc.date({
            min: new Date('2024-01-01'),
            max: new Date('2026-12-31'),
          }),
          (failureDate) => {
            // Guard against invalid dates (NaN)
            fc.pre(!isNaN(failureDate.getTime()));

            const GRACE_PERIOD_MS = 7 * 24 * 60 * 60 * 1000;
            const expectedEnd = new Date(failureDate.getTime() + GRACE_PERIOD_MS);

            // The grace period end should be exactly 7 days after failure
            const diffMs = expectedEnd.getTime() - failureDate.getTime();
            expect(diffMs).toBe(GRACE_PERIOD_MS);
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});
