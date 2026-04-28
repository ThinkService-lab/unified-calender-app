/**
 * Account limit enforcement service.
 *
 * Enforces per-tier account limits:
 *   - Free: 3 accounts
 *   - Pro / Team: unlimited
 *
 * On downgrade the oldest N accounts (up to the tier limit) remain fully
 * active; any excess accounts are treated as read-only. Read-only state is
 * computed at query time based on creation order — the CalendarAccount
 * status field is NOT mutated so we avoid conflating auth-revocation with
 * tier-based restrictions.
 *
 * Requirements: 1.3, 10.1, 10.4
 */

import type { CalendarAccount } from '../types/models';
import type { SubscriptionTier } from '../types/subscription';
import { FREE_TIER_MAX_ACCOUNTS } from './subscriptionManager';

// ── Types ──────────────────────────────────────────────────────────────

export interface AccountLimitResult {
  allowed: boolean;
  reason?: string;
  maxAccounts: number;
  currentCount: number;
  upgradeRequired?: boolean;
}

export interface AccountLimitEnforcerDeps {
  /** Returns the effective subscription tier for the user. */
  getCurrentTier: (userId: string) => SubscriptionTier;
  /** Returns all accounts for the user, regardless of status. */
  getAccounts: (userId: string) => CalendarAccount[];
}

export interface AccountLimitEnforcer {
  /** Check whether the user is allowed to connect one more account. */
  canConnectAccount(userId: string): AccountLimitResult;

  /**
   * After a downgrade, returns the set of accounts that should be treated
   * as read-only. Accounts are sorted by `createdAt` ascending — the
   * oldest accounts (up to the tier limit) stay fully active, the rest
   * become read-only.
   */
  getReadOnlyAccounts(userId: string): CalendarAccount[];

  /** Returns the maximum number of accounts allowed for the given tier. */
  getAccountLimit(tier: SubscriptionTier): number;

  /** Returns accounts that exceed the tier limit (same as read-only set). */
  getExcessAccounts(userId: string): CalendarAccount[];

  /** Returns true when the given account is read-only due to tier limits. */
  isAccountReadOnly(userId: string, accountId: string): boolean;
}

// ── Helpers ────────────────────────────────────────────────────────────

/** Account limit per tier. */
function accountLimitForTier(tier: SubscriptionTier): number {
  switch (tier) {
    case 'free':
      return FREE_TIER_MAX_ACCOUNTS; // 3
    case 'pro':
    case 'team':
      return Infinity;
  }
}

/**
 * Sort accounts by creation date ascending (oldest first).
 * Ties are broken by id for deterministic ordering.
 */
function sortByCreatedAt(accounts: CalendarAccount[]): CalendarAccount[] {
  return [...accounts].sort((a, b) => {
    const diff = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    if (diff !== 0) return diff;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

// ── Factory ────────────────────────────────────────────────────────────

export function createAccountLimitEnforcer(
  deps: AccountLimitEnforcerDeps,
): AccountLimitEnforcer {
  const { getCurrentTier, getAccounts } = deps;

  function getAccountLimit(tier: SubscriptionTier): number {
    return accountLimitForTier(tier);
  }

  function canConnectAccount(userId: string): AccountLimitResult {
    const tier = getCurrentTier(userId);
    const accounts = getAccounts(userId);
    const limit = accountLimitForTier(tier);
    const activeCount = accounts.filter((a) => a.status === 'active').length;

    if (limit === Infinity || activeCount < limit) {
      return {
        allowed: true,
        maxAccounts: limit,
        currentCount: activeCount,
      };
    }

    return {
      allowed: false,
      reason: `Free tier allows a maximum of ${limit} connected accounts. Please upgrade to Pro or Team for unlimited accounts.`,
      maxAccounts: limit,
      currentCount: activeCount,
      upgradeRequired: true,
    };
  }

  function getExcessAccounts(userId: string): CalendarAccount[] {
    const tier = getCurrentTier(userId);
    const limit = accountLimitForTier(tier);

    if (limit === Infinity) return [];

    const accounts = getAccounts(userId).filter((a) => a.status === 'active');
    if (accounts.length <= limit) return [];

    const sorted = sortByCreatedAt(accounts);
    return sorted.slice(limit);
  }

  function getReadOnlyAccounts(userId: string): CalendarAccount[] {
    return getExcessAccounts(userId);
  }

  function isAccountReadOnly(userId: string, accountId: string): boolean {
    const readOnly = getReadOnlyAccounts(userId);
    return readOnly.some((a) => a.id === accountId);
  }

  return {
    canConnectAccount,
    getReadOnlyAccounts,
    getAccountLimit,
    getExcessAccounts,
    isAccountReadOnly,
  };
}
