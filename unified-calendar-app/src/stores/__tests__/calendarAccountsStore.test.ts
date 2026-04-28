/**
 * Tests for calendar accounts store.
 */

import { createCalendarAccountsStore } from '../calendarAccountsStore';
import type { CalendarAccount } from '../../types/models';

function makeAccount(overrides: Partial<CalendarAccount> = {}): CalendarAccount {
  return {
    id: 'acc-1',
    userId: 'user-1',
    providerId: 'google',
    displayName: 'Work',
    email: 'work@example.com',
    color: '#4285F4',
    visibility: 'public',
    syncToken: null,
    lastSyncedAt: null,
    status: 'active',
    createdAt: new Date('2024-01-01'),
    ...overrides,
  };
}

describe('CalendarAccountsStore', () => {
  let store: ReturnType<typeof createCalendarAccountsStore>;

  beforeEach(() => {
    store = createCalendarAccountsStore();
  });

  test('starts with empty state', () => {
    const state = store.getState();
    expect(state.accountIds).toEqual([]);
    expect(state.accounts).toEqual({});
  });

  test('addAccount adds an account', () => {
    const account = makeAccount();
    store.getState().addAccount(account);

    const state = store.getState();
    expect(state.accountIds).toEqual(['acc-1']);
    expect(state.accounts['acc-1']).toEqual(account);
  });

  test('addAccount does not duplicate IDs', () => {
    const account = makeAccount();
    store.getState().addAccount(account);
    store.getState().addAccount(account);

    expect(store.getState().accountIds).toEqual(['acc-1']);
  });

  test('removeAccount removes an account', () => {
    store.getState().addAccount(makeAccount());
    store.getState().removeAccount('acc-1');

    const state = store.getState();
    expect(state.accountIds).toEqual([]);
    expect(state.accounts['acc-1']).toBeUndefined();
  });

  test('updateAccount updates fields', () => {
    store.getState().addAccount(makeAccount());
    store.getState().updateAccount('acc-1', { displayName: 'Personal' });

    expect(store.getState().accounts['acc-1'].displayName).toBe('Personal');
  });

  test('updateAccount is a no-op for missing account', () => {
    store.getState().updateAccount('nonexistent', { displayName: 'X' });
    expect(store.getState().accounts['nonexistent']).toBeUndefined();
  });

  test('setAccountStatus updates status', () => {
    store.getState().addAccount(makeAccount());
    store.getState().setAccountStatus('acc-1', 'revoked');

    expect(store.getState().accounts['acc-1'].status).toBe('revoked');
  });

  test('setAccountVisibility updates visibility', () => {
    store.getState().addAccount(makeAccount());
    store.getState().setAccountVisibility('acc-1', 'private');

    expect(store.getState().accounts['acc-1'].visibility).toBe('private');
  });

  test('updateSyncToken updates sync token and last synced', () => {
    store.getState().addAccount(makeAccount());
    const now = new Date();
    store.getState().updateSyncToken('acc-1', 'token-123', now);

    const account = store.getState().accounts['acc-1'];
    expect(account.syncToken).toBe('token-123');
    expect(account.lastSyncedAt).toEqual(now);
  });

  test('getAccountsByProvider filters by provider', () => {
    store.getState().addAccount(makeAccount({ id: 'g1', providerId: 'google' }));
    store.getState().addAccount(makeAccount({ id: 'o1', providerId: 'outlook' }));
    store.getState().addAccount(makeAccount({ id: 'g2', providerId: 'google' }));

    const googleAccounts = store.getState().getAccountsByProvider('google');
    expect(googleAccounts).toHaveLength(2);
    expect(googleAccounts.map((a) => a.id).sort()).toEqual(['g1', 'g2']);
  });

  test('getActiveAccounts filters by active status', () => {
    store.getState().addAccount(makeAccount({ id: 'a1', status: 'active' }));
    store.getState().addAccount(makeAccount({ id: 'a2', status: 'revoked' }));
    store.getState().addAccount(makeAccount({ id: 'a3', status: 'active' }));

    const active = store.getState().getActiveAccounts();
    expect(active).toHaveLength(2);
  });

  test('clear resets to initial state', () => {
    store.getState().addAccount(makeAccount());
    store.getState().clear();

    const state = store.getState();
    expect(state.accountIds).toEqual([]);
    expect(state.accounts).toEqual({});
  });
});
