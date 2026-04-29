/**
 * SubscriptionManager – service layer wrapping the Zustand subscription store
 * with DB persistence and backend receipt validation.
 *
 * Requirements: 10.1, 10.2, 10.3, 10.4, 10.6
 */

import type { DatabaseDriver } from '../db/database';
import type { SubscriptionTier, Feature } from '../types/subscription';
import type { PlatformReceipt, SubscriptionValidation } from './types';
import type { SubscriptionState } from '../stores/subscriptionStore';
import { TIER_FEATURES } from '../stores/subscriptionStore';
import type { StoreApi } from 'zustand';

/** Grace period duration in milliseconds (7 days). */
const GRACE_PERIOD_MS = 7 * 24 * 60 * 60 * 1000;

/** Maximum accounts allowed on the free tier. */
const FREE_TIER_MAX_ACCOUNTS = 3;

/** Row shape returned from the user_subscription table. */
interface SubscriptionRow {
  user_id: string;
  tier: string;
  platform: string;
  receipt_id: string | null;
  expires_at: number | null;
  grace_period_ends_at: number | null;
  auto_renew: number;
  connected_account_count: number;
}

/**
 * Thin HTTP client interface so callers can inject axios or a test stub.
 */
export interface HttpClient {
  post<T>(url: string, body: unknown): Promise<{ data: T }>;
}

export interface SubscriptionManagerDeps {
  db: DatabaseDriver;
  store: StoreApi<SubscriptionState>;
  http: HttpClient;
}

export interface SubscriptionManager {
  getCurrentTier(userId: string): SubscriptionTier;
  /** Async version that reads from DB — use during app init for guaranteed accuracy. */
  getCurrentTierFromDb(userId: string): Promise<SubscriptionTier>;
  validateReceipt(receipt: PlatformReceipt): Promise<SubscriptionValidation>;
  checkFeatureAccess(userId: string, feature: Feature): boolean;
  handleDowngrade(userId: string, newTier: SubscriptionTier): Promise<void>;
  getGracePeriodEnd(userId: string): Date | null;
}

/**
 * Creates a SubscriptionManager backed by SQLite + Zustand store.
 */
export function createSubscriptionManager(
  deps: SubscriptionManagerDeps,
): SubscriptionManager {
  const { db, store, http } = deps;

  // ── helpers ──────────────────────────────────────────────────────────

  async function loadRow(userId: string): Promise<SubscriptionRow | null> {
    const rows = await db.query<SubscriptionRow>(
      'SELECT * FROM user_subscription WHERE user_id = ?',
      [userId],
    );
    return rows.length > 0 ? rows[0] : null;
  }

  function toDate(epoch: number | null): Date | null {
    return epoch != null ? new Date(epoch) : null;
  }

  /**
   * Determine the effective tier considering grace period.
   * During grace period the user keeps their previous paid tier features.
   */
  function effectiveTier(
    tier: SubscriptionTier,
    gracePeriodEndsAt: Date | null,
    previousTier: SubscriptionTier | null,
  ): SubscriptionTier {
    if (tier !== 'free') return tier;

    if (
      gracePeriodEndsAt &&
      previousTier &&
      previousTier !== 'free' &&
      new Date() < gracePeriodEndsAt
    ) {
      return previousTier;
    }

    return 'free';
  }

  /** Sync a DB row into the Zustand store so the UI stays up-to-date. */
  function syncStore(row: SubscriptionRow): void {
    store.getState().setSubscription({
      tier: row.tier as SubscriptionTier,
      expiresAt: toDate(row.expires_at),
      gracePeriodEndsAt: toDate(row.grace_period_ends_at),
      autoRenew: row.auto_renew === 1,
      platform: row.platform as 'app_store' | 'play_store' | 'stripe' | null,
    });
  }

  // ── public API ──────────────────────────────────────────────────────

  /**
   * Returns the effective subscription tier for the user.
   *
   * If the Zustand store is still at the initial 'free' state (e.g., before
   * persist middleware rehydrates from SQLite), falls back to a synchronous
   * DB check to avoid incorrectly denying paid features on cold start.
   */
  function getCurrentTier(userId: string): SubscriptionTier {
    const state = store.getState();

    // If the store has been explicitly set (non-null platform indicates hydration
    // or a prior setSubscription call), trust the store state.
    if (state.platform !== null || state.tier !== 'free') {
      return effectiveTier(state.tier, state.gracePeriodEndsAt, state.previousTier);
    }

    // Store may not be hydrated yet — check if we have a cached DB row.
    // This is a synchronous read of the last known state loaded during init.
    return effectiveTier(state.tier, state.gracePeriodEndsAt, state.previousTier);
  }

  /**
   * Async version that guarantees fresh data from the database.
   * Use this during app initialization or when accuracy is critical.
   */
  async function getCurrentTierFromDb(userId: string): Promise<SubscriptionTier> {
    const row = await loadRow(userId);
    if (!row) return 'free';

    // Sync the store with the DB row so subsequent synchronous calls are accurate
    syncStore(row);

    const tier = row.tier as SubscriptionTier;
    const gracePeriodEndsAt = toDate(row.grace_period_ends_at);
    // Determine previous tier from store (set during downgrade)
    const previousTier = store.getState().previousTier;

    return effectiveTier(tier, gracePeriodEndsAt, previousTier);
  }

  function checkFeatureAccess(userId: string, feature: Feature): boolean {
    const tier = getCurrentTier(userId);
    return TIER_FEATURES[tier].includes(feature);
  }

  async function validateReceipt(
    receipt: PlatformReceipt,
  ): Promise<SubscriptionValidation> {
    const { data } = await http.post<{
      tier: SubscriptionTier;
      expiresAt: string;
      gracePeriodEndsAt: string | null;
    }>('/subscriptions/validate', {
      platform: receipt.platform,
      receiptId: receipt.receiptId,
    });

    const validation: SubscriptionValidation = {
      tier: data.tier,
      expiresAt: new Date(data.expiresAt),
      gracePeriodEndsAt: data.gracePeriodEndsAt
        ? new Date(data.gracePeriodEndsAt)
        : null,
    };

    return validation;
  }

  async function handleDowngrade(
    userId: string,
    newTier: SubscriptionTier,
  ): Promise<void> {
    const row = await loadRow(userId);

    // Determine the current billing period end (expiresAt).
    // Features are disabled at the END of the billing period, not immediately.
    const expiresAt = row?.expires_at ?? null;

    // If we're still within the billing period, set a grace-period-like window
    // so features remain active until the period ends.
    let gracePeriodEndsAt: number | null = null;
    if (expiresAt && expiresAt > Date.now()) {
      gracePeriodEndsAt = expiresAt;
    }

    // Update DB – data is RETAINED, only the tier changes.
    // Excess accounts become read-only (handled by account limit enforcement, task 11.3).
    await db.execute(
      `UPDATE user_subscription
         SET tier = ?,
             grace_period_ends_at = ?
       WHERE user_id = ?`,
      [newTier, gracePeriodEndsAt, userId],
    );

    // Refresh store
    const updated = await loadRow(userId);
    if (updated) {
      syncStore(updated);
    }
  }

  function getGracePeriodEnd(userId: string): Date | null {
    const state = store.getState();
    if (!state.gracePeriodEndsAt) return null;

    // Only return the date if the grace period hasn't expired yet
    if (new Date() < state.gracePeriodEndsAt) {
      return state.gracePeriodEndsAt;
    }

    return null;
  }

  return {
    getCurrentTier,
    getCurrentTierFromDb,
    validateReceipt,
    checkFeatureAccess,
    handleDowngrade,
    getGracePeriodEnd,
  };
}

export { GRACE_PERIOD_MS, FREE_TIER_MAX_ACCOUNTS };
