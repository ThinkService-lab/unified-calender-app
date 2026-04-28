/**
 * Sync status store using zustand/vanilla for non-React sync engine context.
 * Supports transient updates via subscribe + useRef for high-frequency sync status.
 * Requirements: 2.1, 6.1
 */

import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import { useRef, useEffect } from 'react';
import type { SyncState } from '../sync/types';

export interface AccountSyncInfo {
  state: SyncState;
  lastSyncedAt: Date | null;
  errorMessage: string | null;
  pendingCount: number;
}

export interface SyncStatusState {
  globalState: SyncState;
  accountSyncStatus: Record<string, AccountSyncInfo>;
  lastGlobalSyncAt: Date | null;

  // Actions
  setGlobalState: (state: SyncState) => void;
  setAccountSyncState: (accountId: string, state: SyncState) => void;
  setAccountError: (accountId: string, errorMessage: string | null) => void;
  setAccountPendingCount: (accountId: string, count: number) => void;
  markAccountSynced: (accountId: string) => void;
  removeAccountStatus: (accountId: string) => void;
  reset: () => void;
}

const defaultAccountInfo: AccountSyncInfo = {
  state: 'Idle',
  lastSyncedAt: null,
  errorMessage: null,
  pendingCount: 0,
};

const initialState = {
  globalState: 'Idle' as SyncState,
  accountSyncStatus: {} as Record<string, AccountSyncInfo>,
  lastGlobalSyncAt: null as Date | null,
};

/**
 * Vanilla store for use in non-React contexts (sync engine, background workers).
 */
export const syncStatusStore = createStore<SyncStatusState>()((set, get) => ({
  ...initialState,

  setGlobalState: (state: SyncState) =>
    set({ globalState: state }),

  setAccountSyncState: (accountId: string, state: SyncState) =>
    set((prev) => ({
      accountSyncStatus: {
        ...prev.accountSyncStatus,
        [accountId]: {
          ...(prev.accountSyncStatus[accountId] ?? defaultAccountInfo),
          state,
        },
      },
    })),

  setAccountError: (accountId: string, errorMessage: string | null) =>
    set((prev) => ({
      accountSyncStatus: {
        ...prev.accountSyncStatus,
        [accountId]: {
          ...(prev.accountSyncStatus[accountId] ?? defaultAccountInfo),
          errorMessage,
        },
      },
    })),

  setAccountPendingCount: (accountId: string, count: number) =>
    set((prev) => ({
      accountSyncStatus: {
        ...prev.accountSyncStatus,
        [accountId]: {
          ...(prev.accountSyncStatus[accountId] ?? defaultAccountInfo),
          pendingCount: count,
        },
      },
    })),

  markAccountSynced: (accountId: string) => {
    const now = new Date();
    set((prev) => ({
      lastGlobalSyncAt: now,
      accountSyncStatus: {
        ...prev.accountSyncStatus,
        [accountId]: {
          ...(prev.accountSyncStatus[accountId] ?? defaultAccountInfo),
          state: 'Idle',
          lastSyncedAt: now,
          errorMessage: null,
        },
      },
    }));
  },

  removeAccountStatus: (accountId: string) =>
    set((prev) => {
      const { [accountId]: _, ...rest } = prev.accountSyncStatus;
      return { accountSyncStatus: rest };
    }),

  reset: () => set(initialState),
}));

/**
 * React hook to use the vanilla sync status store in components.
 */
export function useSyncStatusStore<T>(selector: (state: SyncStatusState) => T): T {
  return useStore(syncStatusStore, selector);
}

/**
 * Transient update hook for high-frequency sync status.
 * Uses subscribe + useRef to avoid re-renders on every status change.
 */
export function useSyncStatusRef() {
  const statusRef = useRef(syncStatusStore.getState().globalState);

  useEffect(() => {
    const unsubscribe = syncStatusStore.subscribe((state) => {
      statusRef.current = state.globalState;
    });
    return unsubscribe;
  }, []);

  return statusRef;
}

/**
 * Transient update hook for a specific account's sync status.
 */
export function useAccountSyncStatusRef(accountId: string) {
  const statusRef = useRef<AccountSyncInfo>(
    syncStatusStore.getState().accountSyncStatus[accountId] ?? defaultAccountInfo
  );

  useEffect(() => {
    const unsubscribe = syncStatusStore.subscribe((state) => {
      statusRef.current = state.accountSyncStatus[accountId] ?? defaultAccountInfo;
    });
    return unsubscribe;
  }, [accountId]);

  return statusRef;
}
