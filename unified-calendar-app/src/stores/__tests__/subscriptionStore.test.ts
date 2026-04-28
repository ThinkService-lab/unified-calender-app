/**
 * Tests for subscription store.
 */

import { useSubscriptionStore, TIER_FEATURES } from '../subscriptionStore';

describe('SubscriptionStore', () => {
  beforeEach(() => {
    useSubscriptionStore.getState().reset();
  });

  test('starts with free tier', () => {
    const state = useSubscriptionStore.getState();
    expect(state.tier).toBe('free');
    expect(state.expiresAt).toBeNull();
    expect(state.gracePeriodEndsAt).toBeNull();
    expect(state.autoRenew).toBe(false);
    expect(state.platform).toBeNull();
  });

  test('setTier updates the tier', () => {
    useSubscriptionStore.getState().setTier('pro');
    expect(useSubscriptionStore.getState().tier).toBe('pro');
  });

  test('setSubscription updates all subscription fields', () => {
    const expiresAt = new Date('2025-01-01');
    useSubscriptionStore.getState().setSubscription({
      tier: 'team',
      expiresAt,
      gracePeriodEndsAt: null,
      autoRenew: true,
      platform: 'stripe',
    });

    const state = useSubscriptionStore.getState();
    expect(state.tier).toBe('team');
    expect(state.expiresAt).toEqual(expiresAt);
    expect(state.autoRenew).toBe(true);
    expect(state.platform).toBe('stripe');
  });

  test('setGracePeriod updates grace period', () => {
    const endsAt = new Date('2025-01-08');
    useSubscriptionStore.getState().setGracePeriod(endsAt);
    expect(useSubscriptionStore.getState().gracePeriodEndsAt).toEqual(endsAt);
  });

  test('checkFeatureAccess returns false for free tier features', () => {
    expect(useSubscriptionStore.getState().checkFeatureAccess('unlimited_accounts')).toBe(false);
    expect(useSubscriptionStore.getState().checkFeatureAccess('ai_assistant')).toBe(false);
    expect(useSubscriptionStore.getState().checkFeatureAccess('shared_views')).toBe(false);
  });

  test('checkFeatureAccess returns true for pro tier features', () => {
    useSubscriptionStore.getState().setTier('pro');

    expect(useSubscriptionStore.getState().checkFeatureAccess('unlimited_accounts')).toBe(true);
    expect(useSubscriptionStore.getState().checkFeatureAccess('ai_assistant')).toBe(true);
    expect(useSubscriptionStore.getState().checkFeatureAccess('conflict_detection')).toBe(true);
    expect(useSubscriptionStore.getState().checkFeatureAccess('advanced_privacy')).toBe(true);
  });

  test('checkFeatureAccess returns false for team-only features on pro', () => {
    useSubscriptionStore.getState().setTier('pro');

    expect(useSubscriptionStore.getState().checkFeatureAccess('shared_views')).toBe(false);
    expect(useSubscriptionStore.getState().checkFeatureAccess('delegation')).toBe(false);
  });

  test('checkFeatureAccess returns true for all features on team tier', () => {
    useSubscriptionStore.getState().setTier('team');

    expect(useSubscriptionStore.getState().checkFeatureAccess('unlimited_accounts')).toBe(true);
    expect(useSubscriptionStore.getState().checkFeatureAccess('ai_assistant')).toBe(true);
    expect(useSubscriptionStore.getState().checkFeatureAccess('shared_views')).toBe(true);
    expect(useSubscriptionStore.getState().checkFeatureAccess('delegation')).toBe(true);
  });

  test('isInGracePeriod returns false when no grace period', () => {
    expect(useSubscriptionStore.getState().isInGracePeriod()).toBe(false);
  });

  test('isInGracePeriod returns true during grace period', () => {
    const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    useSubscriptionStore.getState().setGracePeriod(futureDate);
    expect(useSubscriptionStore.getState().isInGracePeriod()).toBe(true);
  });

  test('isInGracePeriod returns false after grace period expires', () => {
    const pastDate = new Date(Date.now() - 1000);
    useSubscriptionStore.getState().setGracePeriod(pastDate);
    expect(useSubscriptionStore.getState().isInGracePeriod()).toBe(false);
  });

  test('getAvailableFeatures returns empty for free tier', () => {
    expect(useSubscriptionStore.getState().getAvailableFeatures()).toEqual([]);
  });

  test('getAvailableFeatures returns pro features for pro tier', () => {
    useSubscriptionStore.getState().setTier('pro');
    const features = useSubscriptionStore.getState().getAvailableFeatures();
    expect(features).toEqual(TIER_FEATURES.pro);
  });

  test('getAvailableFeatures returns all features for team tier', () => {
    useSubscriptionStore.getState().setTier('team');
    const features = useSubscriptionStore.getState().getAvailableFeatures();
    expect(features).toEqual(TIER_FEATURES.team);
  });

  test('TIER_FEATURES team is a superset of pro', () => {
    for (const feature of TIER_FEATURES.pro) {
      expect(TIER_FEATURES.team).toContain(feature);
    }
  });

  test('reset clears to initial state', () => {
    useSubscriptionStore.getState().setSubscription({
      tier: 'pro',
      expiresAt: new Date(),
      gracePeriodEndsAt: new Date(),
      autoRenew: true,
      platform: 'app_store',
    });

    useSubscriptionStore.getState().reset();

    const state = useSubscriptionStore.getState();
    expect(state.tier).toBe('free');
    expect(state.expiresAt).toBeNull();
    expect(state.platform).toBeNull();
  });
});
