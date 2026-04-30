/**
 * Unit tests for ErrorDisplayService.
 * Requirements: 19.1, 19.2, 19.3, 19.4, 19.5, 19.6
 */

import {
  createErrorDisplayService,
  computeGracePeriodDays,
  resetErrorIdCounter,
} from '../errorDisplayService';
import type { ErrorDisplayServiceDeps } from '../errorDisplayService';
import type { ErrorDisplayEntry, ErrorCategory } from '../types';

function createMockDeps(): ErrorDisplayServiceDeps & {
  addedErrors: ErrorDisplayEntry[];
  dismissedIds: string[];
  dismissedCategories: ErrorCategory[];
  dismissedAccountIds: string[];
  resolvedIds: string[];
  offlineState: boolean | null;
} {
  const mock = {
    addedErrors: [] as ErrorDisplayEntry[],
    dismissedIds: [] as string[],
    dismissedCategories: [] as ErrorCategory[],
    dismissedAccountIds: [] as string[],
    resolvedIds: [] as string[],
    offlineState: null as boolean | null,
    addError: (entry: ErrorDisplayEntry) => {
      mock.addedErrors.push(entry);
    },
    dismissError: (id: string) => {
      mock.dismissedIds.push(id);
    },
    dismissErrorsByCategory: (cat: ErrorCategory) => {
      mock.dismissedCategories.push(cat);
    },
    dismissErrorsByAccount: (accountId: string) => {
      mock.dismissedAccountIds.push(accountId);
    },
    setOffline: (offline: boolean) => {
      mock.offlineState = offline;
    },
    resolveError: (id: string) => {
      mock.resolvedIds.push(id);
    },
  };
  return mock;
}

beforeEach(() => {
  resetErrorIdCounter();
});

describe('ErrorDisplayService', () => {
  describe('showSyncError (Req 19.1)', () => {
    it('creates a non-intrusive banner with "Details" action', () => {
      const deps = createMockDeps();
      const service = createErrorDisplayService(deps);

      const id = service.showSyncError({
        category: 'sync',
        providerName: 'Google Calendar',
        accountId: 'acc-1',
      });

      expect(id).toBeTruthy();
      expect(deps.addedErrors).toHaveLength(1);

      const entry = deps.addedErrors[0];
      expect(entry.category).toBe('sync');
      expect(entry.actionLabel).toBe('Details');
      expect(entry.actionType).toBe('show_details');
      expect(entry.persistent).toBe(false);
      expect(entry.accountId).toBe('acc-1');
      expect(entry.userMessage).toContain('Google Calendar');
    });

    it('uses account name when provider name is not given', () => {
      const deps = createMockDeps();
      const service = createErrorDisplayService(deps);

      service.showSyncError({
        category: 'sync',
        accountName: 'Work Calendar',
      });

      expect(deps.addedErrors[0].userMessage).toContain('Work Calendar');
    });

    it('uses fallback text when no name is provided', () => {
      const deps = createMockDeps();
      const service = createErrorDisplayService(deps);

      service.showSyncError({ category: 'sync' });

      expect(deps.addedErrors[0].userMessage).toContain('your calendar');
    });
  });

  describe('showAuthError (Req 19.2)', () => {
    it('creates a badge with "Reconnect" action on the affected account', () => {
      const deps = createMockDeps();
      const service = createErrorDisplayService(deps);

      const id = service.showAuthError({
        category: 'auth',
        accountId: 'acc-2',
        providerName: 'Microsoft Outlook',
      });

      expect(id).toBeTruthy();
      expect(deps.addedErrors).toHaveLength(1);

      const entry = deps.addedErrors[0];
      expect(entry.category).toBe('auth');
      expect(entry.actionLabel).toBe('Reconnect');
      expect(entry.actionType).toBe('reconnect_account');
      expect(entry.persistent).toBe(true);
      expect(entry.accountId).toBe('acc-2');
      expect(entry.userMessage).toContain('Microsoft Outlook');
    });
  });

  describe('showPaymentError (Req 19.3)', () => {
    it('creates a persistent banner with grace period countdown and "Update Payment" action', () => {
      const deps = createMockDeps();
      const service = createErrorDisplayService(deps);

      const gracePeriodEnd = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000); // 5 days
      const id = service.showPaymentError({
        category: 'payment',
        gracePeriodEndsAt: gracePeriodEnd,
      });

      expect(id).toBeTruthy();
      expect(deps.addedErrors).toHaveLength(1);

      const entry = deps.addedErrors[0];
      expect(entry.category).toBe('payment');
      expect(entry.actionLabel).toBe('Update Payment');
      expect(entry.actionType).toBe('update_payment');
      expect(entry.persistent).toBe(true);
      expect(entry.gracePeriodEndsAt).toEqual(gracePeriodEnd);
      expect(entry.userMessage).toContain('5 days');
    });

    it('shows singular "day" when 1 day remains', () => {
      const deps = createMockDeps();
      const service = createErrorDisplayService(deps);

      const gracePeriodEnd = new Date(Date.now() + 1 * 24 * 60 * 60 * 1000);
      service.showPaymentError({
        category: 'payment',
        gracePeriodEndsAt: gracePeriodEnd,
      });

      expect(deps.addedErrors[0].userMessage).toContain('1 day remaining');
    });

    it('shows 0 days when grace period has expired', () => {
      const deps = createMockDeps();
      const service = createErrorDisplayService(deps);

      const gracePeriodEnd = new Date(Date.now() - 1000);
      service.showPaymentError({
        category: 'payment',
        gracePeriodEndsAt: gracePeriodEnd,
      });

      expect(deps.addedErrors[0].userMessage).toContain('0 days');
    });
  });

  describe('setOfflineStatus (Req 19.4)', () => {
    it('shows offline indicator when going offline', () => {
      const deps = createMockDeps();
      const service = createErrorDisplayService(deps);

      const id = service.setOfflineStatus(true);

      expect(id).toBeTruthy();
      expect(deps.offlineState).toBe(true);
      expect(deps.addedErrors).toHaveLength(1);

      const entry = deps.addedErrors[0];
      expect(entry.category).toBe('offline');
      expect(entry.persistent).toBe(true);
      expect(entry.userMessage).toContain('offline');
      expect(entry.detailMessage).toContain('sync');
    });

    it('dismisses offline errors when going online', () => {
      const deps = createMockDeps();
      const service = createErrorDisplayService(deps);

      const id = service.setOfflineStatus(false);

      expect(id).toBeNull();
      expect(deps.offlineState).toBe(false);
      expect(deps.dismissedCategories).toContain('offline');
    });
  });

  describe('showError (generic routing)', () => {
    it('routes sync category to showSyncError', () => {
      const deps = createMockDeps();
      const service = createErrorDisplayService(deps);

      service.showError({ category: 'sync', providerName: 'iCloud' });

      expect(deps.addedErrors[0].category).toBe('sync');
      expect(deps.addedErrors[0].actionLabel).toBe('Details');
    });

    it('routes auth category to showAuthError', () => {
      const deps = createMockDeps();
      const service = createErrorDisplayService(deps);

      service.showError({ category: 'auth', accountId: 'acc-3' });

      expect(deps.addedErrors[0].category).toBe('auth');
      expect(deps.addedErrors[0].actionLabel).toBe('Reconnect');
    });

    it('routes payment category to showPaymentError', () => {
      const deps = createMockDeps();
      const service = createErrorDisplayService(deps);

      service.showError({ category: 'payment' });

      expect(deps.addedErrors[0].category).toBe('payment');
      expect(deps.addedErrors[0].actionLabel).toBe('Update Payment');
    });

    it('handles provider errors with generic message', () => {
      const deps = createMockDeps();
      const service = createErrorDisplayService(deps);

      service.showError({ category: 'provider' });

      const entry = deps.addedErrors[0];
      expect(entry.category).toBe('provider');
      expect(entry.actionLabel).toBe('Details');
      expect(entry.persistent).toBe(false);
    });

    it('handles storage errors', () => {
      const deps = createMockDeps();
      const service = createErrorDisplayService(deps);

      service.showError({ category: 'storage' });

      expect(deps.addedErrors[0].userMessage).toContain('save');
    });

    it('handles parse errors', () => {
      const deps = createMockDeps();
      const service = createErrorDisplayService(deps);

      service.showError({ category: 'parse' });

      expect(deps.addedErrors[0].userMessage).toContain('read');
    });

    it('handles conflict errors', () => {
      const deps = createMockDeps();
      const service = createErrorDisplayService(deps);

      service.showError({ category: 'conflict' });

      expect(deps.addedErrors[0].userMessage).toContain('conflict');
    });
  });

  describe('Req 19.6 — no raw error codes or technical jargon', () => {
    it('does not include the original error in any user-facing field', () => {
      const deps = createMockDeps();
      const service = createErrorDisplayService(deps);

      service.showSyncError({
        category: 'sync',
        originalError: new Error('ECONNREFUSED 127.0.0.1:443'),
        providerName: 'Google Calendar',
      });

      const entry = deps.addedErrors[0];
      expect(entry.userMessage).not.toContain('ECONNREFUSED');
      expect(entry.userMessage).not.toContain('127.0.0.1');
      expect(entry.detailMessage).not.toContain('ECONNREFUSED');
      expect(entry.detailMessage).not.toContain('127.0.0.1');
    });

    it('does not include stack traces in user messages', () => {
      const deps = createMockDeps();
      const service = createErrorDisplayService(deps);

      const error = new Error('Something broke');
      error.stack = 'Error: Something broke\n    at Object.<anonymous> (/app/src/sync.ts:42:5)';

      service.showError({
        category: 'provider',
        originalError: error,
      });

      const entry = deps.addedErrors[0];
      expect(entry.userMessage).not.toContain('at Object');
      expect(entry.userMessage).not.toContain('.ts:');
      expect(entry.detailMessage).not.toContain('at Object');
      expect(entry.detailMessage).not.toContain('.ts:');
    });
  });

  describe('dismiss and resolve', () => {
    it('dismiss delegates to deps.dismissError', () => {
      const deps = createMockDeps();
      const service = createErrorDisplayService(deps);

      service.dismiss('err-123');
      expect(deps.dismissedIds).toContain('err-123');
    });

    it('resolve delegates to deps.resolveError', () => {
      const deps = createMockDeps();
      const service = createErrorDisplayService(deps);

      service.resolve('err-456');
      expect(deps.resolvedIds).toContain('err-456');
    });

    it('clearAccountErrors delegates to deps.dismissErrorsByAccount', () => {
      const deps = createMockDeps();
      const service = createErrorDisplayService(deps);

      service.clearAccountErrors('acc-5');
      expect(deps.dismissedAccountIds).toContain('acc-5');
    });
  });
});

describe('computeGracePeriodDays', () => {
  it('returns null when no date is provided', () => {
    expect(computeGracePeriodDays(null)).toBeNull();
    expect(computeGracePeriodDays(undefined)).toBeNull();
  });

  it('returns 0 when grace period has expired', () => {
    const past = new Date(Date.now() - 1000);
    expect(computeGracePeriodDays(past)).toBe(0);
  });

  it('returns correct number of days remaining', () => {
    const threeDays = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    const result = computeGracePeriodDays(threeDays);
    expect(result).toBe(3);
  });

  it('rounds up partial days', () => {
    // 1.5 days from now should round up to 2
    const oneAndHalfDays = new Date(Date.now() + 1.5 * 24 * 60 * 60 * 1000);
    const result = computeGracePeriodDays(oneAndHalfDays);
    expect(result).toBe(2);
  });
});
