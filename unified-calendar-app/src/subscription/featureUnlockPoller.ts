/**
 * Feature unlock poller — ensures features are unlocked within 10 seconds
 * of payment confirmation.
 *
 * After a purchase completes (especially on web/Stripe where webhook delivery
 * is asynchronous), this poller checks the subscription endpoint at short
 * intervals until the tier is confirmed upgraded, or the 10-second deadline
 * is reached.
 *
 * Requirements: 10.2, 10.3 (unlock within 10 seconds of payment confirmation)
 */

import type { SubscriptionTier } from '../types/subscription';
import type { SubscriptionState } from '../stores/subscriptionStore';
import type { StoreApi } from 'zustand';

/** Maximum time to poll before giving up (10 seconds). */
const MAX_POLL_DURATION_MS = 10_000;

/** Interval between poll attempts (1 second). */
const POLL_INTERVAL_MS = 1_000;

export interface FeatureUnlockPollerDeps {
  /** HTTP client to query the subscription endpoint */
  http: {
    get<T>(url: string): Promise<{ data: T }>;
  };
  /** Zustand subscription store to update on confirmation */
  store: StoreApi<SubscriptionState>;
  /** User ID for the subscription query */
  userId: string;
}

export interface SubscriptionResponse {
  tier: SubscriptionTier;
  expiresAt: string | null;
  gracePeriodEndsAt: string | null;
  autoRenew: boolean;
}

export interface FeatureUnlockResult {
  /** Whether the tier was confirmed within the deadline */
  confirmed: boolean;
  /** The confirmed tier (or current tier if deadline exceeded) */
  tier: SubscriptionTier;
  /** Time elapsed in milliseconds */
  elapsedMs: number;
}

/**
 * Polls the subscription endpoint until the user's tier matches or exceeds
 * the expected tier, or the 10-second deadline is reached.
 *
 * On confirmation, updates the Zustand subscription store immediately.
 */
export async function pollForFeatureUnlock(
  deps: FeatureUnlockPollerDeps,
  expectedTier: SubscriptionTier,
): Promise<FeatureUnlockResult> {
  const { http, store, userId } = deps;
  const startTime = Date.now();

  const tierRank: Record<SubscriptionTier, number> = {
    free: 0,
    pro: 1,
    team: 2,
  };

  while (Date.now() - startTime < MAX_POLL_DURATION_MS) {
    try {
      const { data } = await http.get<SubscriptionResponse>(
        `/subscriptions/${userId}`,
      );

      if (tierRank[data.tier] >= tierRank[expectedTier]) {
        // Tier confirmed — update store immediately
        store.getState().setSubscription({
          tier: data.tier,
          expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
          gracePeriodEndsAt: data.gracePeriodEndsAt ? new Date(data.gracePeriodEndsAt) : null,
          autoRenew: data.autoRenew,
          platform: 'stripe',
        });

        return {
          confirmed: true,
          tier: data.tier,
          elapsedMs: Date.now() - startTime,
        };
      }
    } catch {
      // Network error during poll — continue trying until deadline
    }

    // Wait before next poll
    await sleep(POLL_INTERVAL_MS);
  }

  // Deadline exceeded — return current state
  const currentTier = store.getState().tier;
  return {
    confirmed: false,
    tier: currentTier,
    elapsedMs: Date.now() - startTime,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export { MAX_POLL_DURATION_MS, POLL_INTERVAL_MS };
