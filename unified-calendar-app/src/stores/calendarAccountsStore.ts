/**
 * Calendar accounts Zustand store.
 * Uses persist (SQLite-backed) + immer + devtools middleware.
 * Requirements: 2.1, 6.1
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { devtools } from 'zustand/middleware';
import { useShallow } from 'zustand/react/shallow';
import type { CalendarAccount, ProviderId, VisibilityLevel } from '../types/models';
import type { StateStorage } from 'zustand/middleware';

export interface CalendarAccountsState {
  accounts: Record<string, CalendarAccount>;
  accountIds: string[];

  /**
   * Transient (NOT persisted) set of account IDs that are currently
   * hidden from the calendar UI via the visibility toggle. This is a
   * purely session-scoped UI preference — when the user quits the app
   * and returns, all accounts are visible again.
   *
   * Lives on the calendar accounts store (rather than on
   * `UnifiedCalendarView`'s local state) so micro-interaction hooks
   * like `useAccountVisibilityTransition` can subscribe to it via an
   * atomic Zustand selector and detect flip edges across component
   * boundaries.
   *
   * Requirement: 2.3 (visibility toggle animation)
   */
  hiddenAccountIds: ReadonlySet<string>;

  // Actions
  addAccount: (account: CalendarAccount) => void;
  removeAccount: (id: string) => void;
  updateAccount: (id: string, updates: Partial<CalendarAccount>) => void;
  setAccountStatus: (id: string, status: CalendarAccount['status']) => void;
  setAccountVisibility: (id: string, visibility: VisibilityLevel) => void;
  /**
   * Flip `accountId`'s membership in `hiddenAccountIds`. Instant — no
   * animation; individual EventCards observe the flip via
   * `useAccountVisibilityTransition` and run the fade animation
   * themselves.
   */
  toggleAccountHidden: (accountId: string) => void;
  /**
   * Replace the full `hiddenAccountIds` set. Useful for tests and bulk
   * visibility resets.
   */
  setHiddenAccountIds: (ids: ReadonlySet<string>) => void;
  updateSyncToken: (id: string, syncToken: string | null, lastSyncedAt: Date | null) => void;
  getAccountsByProvider: (providerId: ProviderId) => CalendarAccount[];
  getActiveAccounts: () => CalendarAccount[];
  clear: () => void;
}

const initialState = {
  accounts: {} as Record<string, CalendarAccount>,
  accountIds: [] as string[],
  hiddenAccountIds: new Set<string>() as ReadonlySet<string>,
};

/**
 * Creates the calendar accounts store.
 * Accepts an optional custom storage for persist middleware (defaults to no-op for testing).
 */
export function createCalendarAccountsStore(storage?: StateStorage) {
  return create<CalendarAccountsState>()(
    devtools(
      persist(
        immer((set, get) => ({
          ...initialState,

          addAccount: (account: CalendarAccount) =>
            set((state) => {
              state.accounts[account.id] = account;
              if (!state.accountIds.includes(account.id)) {
                state.accountIds.push(account.id);
              }
            }),

          removeAccount: (id: string) =>
            set((state) => {
              delete state.accounts[id];
              state.accountIds = state.accountIds.filter((aid) => aid !== id);
            }),

          updateAccount: (id: string, updates: Partial<CalendarAccount>) =>
            set((state) => {
              if (state.accounts[id]) {
                Object.assign(state.accounts[id], updates);
              }
            }),

          setAccountStatus: (id: string, status: CalendarAccount['status']) =>
            set((state) => {
              if (state.accounts[id]) {
                state.accounts[id].status = status;
              }
            }),

          setAccountVisibility: (id: string, visibility: VisibilityLevel) =>
            set((state) => {
              if (state.accounts[id]) {
                state.accounts[id].visibility = visibility;
              }
            }),

          toggleAccountHidden: (accountId: string) =>
            set((state) => {
              const next = new Set(state.hiddenAccountIds);
              if (next.has(accountId)) {
                next.delete(accountId);
              } else {
                next.add(accountId);
              }
              state.hiddenAccountIds = next;
            }),

          setHiddenAccountIds: (ids: ReadonlySet<string>) =>
            set((state) => {
              state.hiddenAccountIds = new Set(ids);
            }),

          updateSyncToken: (id: string, syncToken: string | null, lastSyncedAt: Date | null) =>
            set((state) => {
              if (state.accounts[id]) {
                state.accounts[id].syncToken = syncToken;
                state.accounts[id].lastSyncedAt = lastSyncedAt;
              }
            }),

          getAccountsByProvider: (providerId: ProviderId) => {
            const { accounts } = get();
            return Object.values(accounts).filter((a) => a.providerId === providerId);
          },

          getActiveAccounts: () => {
            const { accounts } = get();
            return Object.values(accounts).filter((a) => a.status === 'active');
          },

          clear: () => set(initialState),
        })),
        {
          name: 'calendar-accounts-storage',
          storage: storage ? createJSONStorage(() => storage) : undefined,
          // `hiddenAccountIds` is transient UI state — do NOT persist.
          partialize: (state) => ({
            accounts: state.accounts,
            accountIds: state.accountIds,
          }),
        }
      ),
      { name: 'CalendarAccountsStore', enabled: process.env.NODE_ENV !== 'production' }
    )
  );
}

/** Default store instance (created without persistence for import convenience) */
export const useCalendarAccountsStore = createCalendarAccountsStore();

/** Atomic selector hooks */
export const useAccountIds = () => useCalendarAccountsStore((s) => s.accountIds);
export const useAccount = (id: string) => useCalendarAccountsStore((s) => s.accounts[id]);
export const useAccountCount = () => useCalendarAccountsStore((s) => s.accountIds.length);

/**
 * Returns `true` when the given account is currently hidden. Used by
 * EventCards to drive the fade-in/fade-out animation via
 * `useAccountVisibilityTransition`.
 */
export const useIsAccountHidden = (accountId: string) =>
  useCalendarAccountsStore((s) => s.hiddenAccountIds.has(accountId));

/** Multi-field selector with useShallow */
export const useAccountSummary = (id: string) =>
  useCalendarAccountsStore(
    useShallow((s) => {
      const account = s.accounts[id];
      if (!account) return null;
      return {
        displayName: account.displayName,
        email: account.email,
        color: account.color,
        status: account.status,
      };
    })
  );
