/**
 * Zustand store for error display state.
 * Tracks active errors (banners/badges) and the error log (last 50 entries).
 * Requirements: 19.1, 19.2, 19.3, 19.4, 19.5, 19.6
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { devtools } from 'zustand/middleware';
import { useShallow } from 'zustand/react/shallow';
import type {
  ErrorDisplayEntry,
  ErrorLogEntry,
  ErrorCategory,
  ErrorResolutionStatus,
} from './types';
import { MAX_ERROR_LOG_ENTRIES } from './types';

export interface ErrorState {
  /** Currently active error displays (banners, badges, indicators) */
  activeErrors: ErrorDisplayEntry[];
  /** Whether the device is currently offline */
  isOffline: boolean;
  /** Error log accessible from Settings (last 50 entries) */
  errorLog: ErrorLogEntry[];

  // Actions
  addError: (entry: ErrorDisplayEntry) => void;
  dismissError: (errorId: string) => void;
  dismissErrorsByCategory: (category: ErrorCategory) => void;
  dismissErrorsByAccount: (accountId: string) => void;
  setOffline: (offline: boolean) => void;
  resolveError: (errorId: string) => void;
  getActiveErrorsByCategory: (category: ErrorCategory) => ErrorDisplayEntry[];
  getActiveErrorForAccount: (accountId: string) => ErrorDisplayEntry | undefined;
  getErrorLog: () => ErrorLogEntry[];
  clearErrorLog: () => void;
  reset: () => void;
}

const initialState = {
  activeErrors: [] as ErrorDisplayEntry[],
  isOffline: false,
  errorLog: [] as ErrorLogEntry[],
};

/**
 * Creates the error store.
 * Follows the same pattern as other stores in the project (immer + devtools).
 */
export function createErrorStore() {
  return create<ErrorState>()(
    devtools(
      immer((set, get) => ({
        ...initialState,

        addError: (entry: ErrorDisplayEntry) =>
          set((state) => {
            // Replace existing error for the same account+category to avoid duplicates
            const existingIndex = state.activeErrors.findIndex(
              (e) =>
                e.category === entry.category &&
                e.accountId === entry.accountId
            );
            if (existingIndex >= 0) {
              state.activeErrors[existingIndex] = entry;
            } else {
              state.activeErrors.push(entry);
            }

            // Add to error log, enforcing the 50-entry cap
            const logEntry: ErrorLogEntry = {
              id: entry.id,
              category: entry.category,
              userMessage: entry.userMessage,
              detailMessage: entry.detailMessage,
              timestamp: entry.createdAt,
              resolutionStatus: 'unresolved',
              resolvedAt: null,
            };
            state.errorLog.push(logEntry);
            // Trim to MAX_ERROR_LOG_ENTRIES, keeping the most recent
            if (state.errorLog.length > MAX_ERROR_LOG_ENTRIES) {
              state.errorLog = state.errorLog.slice(
                state.errorLog.length - MAX_ERROR_LOG_ENTRIES
              );
            }
          }),

        dismissError: (errorId: string) =>
          set((state) => {
            state.activeErrors = state.activeErrors.filter(
              (e) => e.id !== errorId
            );
            // Mark as dismissed in the log
            const logEntry = state.errorLog.find((e) => e.id === errorId);
            if (logEntry) {
              logEntry.resolutionStatus = 'dismissed';
              logEntry.resolvedAt = new Date();
            }
          }),

        dismissErrorsByCategory: (category: ErrorCategory) =>
          set((state) => {
            const dismissedIds = state.activeErrors
              .filter((e) => e.category === category)
              .map((e) => e.id);
            state.activeErrors = state.activeErrors.filter(
              (e) => e.category !== category
            );
            // Mark dismissed in log
            for (const logEntry of state.errorLog) {
              if (dismissedIds.includes(logEntry.id) && logEntry.resolutionStatus === 'unresolved') {
                logEntry.resolutionStatus = 'dismissed';
                logEntry.resolvedAt = new Date();
              }
            }
          }),

        dismissErrorsByAccount: (accountId: string) =>
          set((state) => {
            const dismissedIds = state.activeErrors
              .filter((e) => e.accountId === accountId)
              .map((e) => e.id);
            state.activeErrors = state.activeErrors.filter(
              (e) => e.accountId !== accountId
            );
            for (const logEntry of state.errorLog) {
              if (dismissedIds.includes(logEntry.id) && logEntry.resolutionStatus === 'unresolved') {
                logEntry.resolutionStatus = 'dismissed';
                logEntry.resolvedAt = new Date();
              }
            }
          }),

        setOffline: (offline: boolean) =>
          set((state) => {
            state.isOffline = offline;
          }),

        resolveError: (errorId: string) =>
          set((state) => {
            state.activeErrors = state.activeErrors.filter(
              (e) => e.id !== errorId
            );
            const logEntry = state.errorLog.find((e) => e.id === errorId);
            if (logEntry) {
              logEntry.resolutionStatus = 'resolved';
              logEntry.resolvedAt = new Date();
            }
          }),

        getActiveErrorsByCategory: (category: ErrorCategory) => {
          return get().activeErrors.filter((e) => e.category === category);
        },

        getActiveErrorForAccount: (accountId: string) => {
          return get().activeErrors.find((e) => e.accountId === accountId);
        },

        getErrorLog: () => {
          return [...get().errorLog];
        },

        clearErrorLog: () =>
          set((state) => {
            state.errorLog = [];
          }),

        reset: () => set(initialState),
      })),
      { name: 'ErrorStore', enabled: process.env.NODE_ENV !== 'production' }
    )
  );
}

/** Default store instance */
export const useErrorStore = createErrorStore();

/** Atomic selector hooks */
export const useActiveErrors = () =>
  useErrorStore((s) => s.activeErrors);

export const useIsOffline = () =>
  useErrorStore((s) => s.isOffline);

export const useErrorLog = () =>
  useErrorStore((s) => s.errorLog);

/** Multi-field selector with useShallow */
export const useErrorSummary = () =>
  useErrorStore(
    useShallow((s) => ({
      activeErrorCount: s.activeErrors.length,
      isOffline: s.isOffline,
      hasPaymentError: s.activeErrors.some((e) => e.category === 'payment'),
      hasAuthError: s.activeErrors.some((e) => e.category === 'auth'),
    }))
  );
