/**
 * Tests for account limit enforcement.
 * Requirements: 1.3, 10.1, 10.4
 */

import { createAccountLimitEnforcer } from '../accountLimitEnforcer';
import type { AccountLimitEnforcerDeps } from '../accountLimitEnforcer';
import type { CalendarAccount } from '../../types/models';
import type { SubscriptionTier } from '../../types/subscription';
import { FREE_TIER_MAX_ACCOUNTS } from '../subscriptionManager';

// ── Helpers ────────────────────────────────────────────────────────────

function makeAccount(
  overrides: Partial<CalendarAccount> & { id: string; createdAt: Date },
): CalendarAccount {
  return {
    userId: 'user-1',
    providerId: 'google',
    displayName: `Account ${overrides.id}`,
    email: `${overrides.id}@example.com`,
    color: '#000000',
    visibility: 'public',
    syncToken: null,
    lastSyncedAt: null,
    status: 'active',
    ...overrides,
  };
}

function buildDeps(
  tier: SubscriptionTier,
  accounts: CalendarAccount[],
): AccountLimitEnforcerDeps {
  return {
    getCurrentTier: () => tier,
    getAccounts: () => accounts,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('AccountLimitEnforcer', () => {
  // ── getAccountLimit ────────────────────────────────────────────────

  describe('getAccountLimit', () => {
    it('returns 3 for free tier', () => {
      const enforcer = createAccountLimitEnforcer(buildDeps('free', []));
      expect(enforcer.getAccountLimit('free')).toBe(FREE_TIER_MAX_ACCOUNTS);
    });

    it('returns Infinity for pro tier', () => {
      const enforcer = createAccountLimitEnforcer(buildDeps('pro', []));
      expect(enforcer.getAccountLimit('pro')).toBe(Infinity);
    });

    it('returns Infinity for team tier', () => {
      const enforcer = createAccountLimitEnforcer(buildDeps('team', []));
      expect(enforcer.getAccountLimit('team')).toBe(Infinity);
    });
  });

  // ── canConnectAccount ──────────────────────────────────────────────

  describe('canConnectAccount', () => {
    it('allows connecting when free tier has fewer than 3 accounts', () => {
      const accounts = [
        makeAccount({ id: 'a1', createdAt: new Date('2024-01-01') }),
        makeAccount({ id: 'a2', createdAt: new Date('2024-01-02') }),
      ];
      const enforcer = createAccountLimitEnforcer(buildDeps('free', accounts));
      const result = enforcer.canConnectAccount('user-1');

      expect(result.allowed).toBe(true);
      expect(result.currentCount).toBe(2);
      expect(result.maxAccounts).toBe(3);
    });

    it('blocks connecting a 4th account on free tier with upgrade prompt', () => {
      const accounts = [
        makeAccount({ id: 'a1', createdAt: new Date('2024-01-01') }),
        makeAccount({ id: 'a2', createdAt: new Date('2024-01-02') }),
        makeAccount({ id: 'a3', createdAt: new Date('2024-01-03') }),
      ];
      const enforcer = createAccountLimitEnforcer(buildDeps('free', accounts));
      const result = enforcer.canConnectAccount('user-1');

      expect(result.allowed).toBe(false);
      expect(result.upgradeRequired).toBe(true);
      expect(result.reason).toContain('upgrade');
      expect(result.maxAccounts).toBe(3);
      expect(result.currentCount).toBe(3);
    });

    it('allows unlimited accounts on pro tier', () => {
      const accounts = Array.from({ length: 10 }, (_, i) =>
        makeAccount({ id: `a${i}`, createdAt: new Date(2024, 0, i + 1) }),
      );
      const enforcer = createAccountLimitEnforcer(buildDeps('pro', accounts));
      const result = enforcer.canConnectAccount('user-1');

      expect(result.allowed).toBe(true);
      expect(result.maxAccounts).toBe(Infinity);
    });

    it('allows unlimited accounts on team tier', () => {
      const accounts = Array.from({ length: 10 }, (_, i) =>
        makeAccount({ id: `a${i}`, createdAt: new Date(2024, 0, i + 1) }),
      );
      const enforcer = createAccountLimitEnforcer(buildDeps('team', accounts));
      const result = enforcer.canConnectAccount('user-1');

      expect(result.allowed).toBe(true);
    });

    it('does not count revoked accounts toward the limit', () => {
      const accounts = [
        makeAccount({ id: 'a1', createdAt: new Date('2024-01-01') }),
        makeAccount({ id: 'a2', createdAt: new Date('2024-01-02') }),
        makeAccount({ id: 'a3', createdAt: new Date('2024-01-03'), status: 'revoked' }),
      ];
      const enforcer = createAccountLimitEnforcer(buildDeps('free', accounts));
      const result = enforcer.canConnectAccount('user-1');

      expect(result.allowed).toBe(true);
      expect(result.currentCount).toBe(2);
    });

    it('allows connecting when free tier has zero accounts', () => {
      const enforcer = createAccountLimitEnforcer(buildDeps('free', []));
      const result = enforcer.canConnectAccount('user-1');

      expect(result.allowed).toBe(true);
      expect(result.currentCount).toBe(0);
    });
  });

  // ── getExcessAccounts / getReadOnlyAccounts ────────────────────────

  describe('getExcessAccounts / getReadOnlyAccounts', () => {
    it('returns empty when account count is within limit', () => {
      const accounts = [
        makeAccount({ id: 'a1', createdAt: new Date('2024-01-01') }),
        makeAccount({ id: 'a2', createdAt: new Date('2024-01-02') }),
      ];
      const enforcer = createAccountLimitEnforcer(buildDeps('free', accounts));

      expect(enforcer.getExcessAccounts('user-1')).toEqual([]);
      expect(enforcer.getReadOnlyAccounts('user-1')).toEqual([]);
    });

    it('returns empty for pro tier regardless of count', () => {
      const accounts = Array.from({ length: 10 }, (_, i) =>
        makeAccount({ id: `a${i}`, createdAt: new Date(2024, 0, i + 1) }),
      );
      const enforcer = createAccountLimitEnforcer(buildDeps('pro', accounts));

      expect(enforcer.getExcessAccounts('user-1')).toEqual([]);
    });

    it('returns newest accounts as excess on downgrade to free', () => {
      const accounts = [
        makeAccount({ id: 'a1', createdAt: new Date('2024-01-01') }),
        makeAccount({ id: 'a2', createdAt: new Date('2024-01-02') }),
        makeAccount({ id: 'a3', createdAt: new Date('2024-01-03') }),
        makeAccount({ id: 'a4', createdAt: new Date('2024-01-04') }),
        makeAccount({ id: 'a5', createdAt: new Date('2024-01-05') }),
      ];
      const enforcer = createAccountLimitEnforcer(buildDeps('free', accounts));
      const excess = enforcer.getExcessAccounts('user-1');

      expect(excess).toHaveLength(2);
      expect(excess.map((a) => a.id)).toEqual(['a4', 'a5']);
    });

    it('does not include revoked/error accounts in excess calculation', () => {
      const accounts = [
        makeAccount({ id: 'a1', createdAt: new Date('2024-01-01') }),
        makeAccount({ id: 'a2', createdAt: new Date('2024-01-02') }),
        makeAccount({ id: 'a3', createdAt: new Date('2024-01-03') }),
        makeAccount({ id: 'a4', createdAt: new Date('2024-01-04'), status: 'revoked' }),
        makeAccount({ id: 'a5', createdAt: new Date('2024-01-05') }),
      ];
      const enforcer = createAccountLimitEnforcer(buildDeps('free', accounts));
      const excess = enforcer.getExcessAccounts('user-1');

      // Only 4 active accounts, so 1 excess (a5 is the newest active)
      expect(excess).toHaveLength(1);
      expect(excess[0].id).toBe('a5');
    });

    it('preserves deterministic order when createdAt is identical', () => {
      const sameDate = new Date('2024-06-01');
      const accounts = [
        makeAccount({ id: 'c', createdAt: sameDate }),
        makeAccount({ id: 'a', createdAt: sameDate }),
        makeAccount({ id: 'b', createdAt: sameDate }),
        makeAccount({ id: 'd', createdAt: sameDate }),
      ];
      const enforcer = createAccountLimitEnforcer(buildDeps('free', accounts));
      const excess = enforcer.getExcessAccounts('user-1');

      // Sorted by id: a, b, c, d → oldest 3 = a, b, c → excess = d
      expect(excess).toHaveLength(1);
      expect(excess[0].id).toBe('d');
    });
  });

  // ── isAccountReadOnly ──────────────────────────────────────────────

  describe('isAccountReadOnly', () => {
    const accounts = [
      makeAccount({ id: 'a1', createdAt: new Date('2024-01-01') }),
      makeAccount({ id: 'a2', createdAt: new Date('2024-01-02') }),
      makeAccount({ id: 'a3', createdAt: new Date('2024-01-03') }),
      makeAccount({ id: 'a4', createdAt: new Date('2024-01-04') }),
    ];

    it('returns false for accounts within the limit', () => {
      const enforcer = createAccountLimitEnforcer(buildDeps('free', accounts));

      expect(enforcer.isAccountReadOnly('user-1', 'a1')).toBe(false);
      expect(enforcer.isAccountReadOnly('user-1', 'a2')).toBe(false);
      expect(enforcer.isAccountReadOnly('user-1', 'a3')).toBe(false);
    });

    it('returns true for accounts exceeding the limit', () => {
      const enforcer = createAccountLimitEnforcer(buildDeps('free', accounts));

      expect(enforcer.isAccountReadOnly('user-1', 'a4')).toBe(true);
    });

    it('returns false for all accounts on pro tier', () => {
      const enforcer = createAccountLimitEnforcer(buildDeps('pro', accounts));

      expect(enforcer.isAccountReadOnly('user-1', 'a4')).toBe(false);
    });

    it('returns false for unknown account id', () => {
      const enforcer = createAccountLimitEnforcer(buildDeps('free', accounts));

      expect(enforcer.isAccountReadOnly('user-1', 'nonexistent')).toBe(false);
    });
  });
});
