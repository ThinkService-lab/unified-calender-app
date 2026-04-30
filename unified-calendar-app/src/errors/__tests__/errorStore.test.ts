/**
 * Unit tests for the error store.
 * Requirements: 19.1, 19.2, 19.3, 19.4, 19.5, 19.6
 */

import { createErrorStore } from '../errorStore';
import type { ErrorDisplayEntry } from '../types';
import { MAX_ERROR_LOG_ENTRIES } from '../types';

function makeEntry(overrides: Partial<ErrorDisplayEntry> = {}): ErrorDisplayEntry {
  return {
    id: overrides.id ?? `err-${Date.now()}-${Math.random()}`,
    category: overrides.category ?? 'sync',
    userMessage: overrides.userMessage ?? 'Something went wrong',
    detailMessage: overrides.detailMessage ?? null,
    actionLabel: overrides.actionLabel ?? 'Details',
    actionType: overrides.actionType ?? 'show_details',
    persistent: overrides.persistent ?? false,
    accountId: overrides.accountId ?? null,
    gracePeriodEndsAt: overrides.gracePeriodEndsAt ?? null,
    createdAt: overrides.createdAt ?? new Date(),
  };
}

describe('ErrorStore', () => {
  describe('addError', () => {
    it('adds an error to activeErrors', () => {
      const store = createErrorStore();
      const entry = makeEntry({ id: 'err-1' });

      store.getState().addError(entry);

      expect(store.getState().activeErrors).toHaveLength(1);
      expect(store.getState().activeErrors[0].id).toBe('err-1');
    });

    it('adds an entry to the error log', () => {
      const store = createErrorStore();
      const entry = makeEntry({ id: 'err-2', userMessage: 'Sync failed' });

      store.getState().addError(entry);

      const log = store.getState().errorLog;
      expect(log).toHaveLength(1);
      expect(log[0].id).toBe('err-2');
      expect(log[0].userMessage).toBe('Sync failed');
      expect(log[0].resolutionStatus).toBe('unresolved');
      expect(log[0].resolvedAt).toBeNull();
    });

    it('replaces existing error for same account+category', () => {
      const store = createErrorStore();
      const entry1 = makeEntry({
        id: 'err-a',
        category: 'auth',
        accountId: 'acc-1',
        userMessage: 'First',
      });
      const entry2 = makeEntry({
        id: 'err-b',
        category: 'auth',
        accountId: 'acc-1',
        userMessage: 'Second',
      });

      store.getState().addError(entry1);
      store.getState().addError(entry2);

      // Only one active error for this account+category
      expect(store.getState().activeErrors).toHaveLength(1);
      expect(store.getState().activeErrors[0].id).toBe('err-b');
      expect(store.getState().activeErrors[0].userMessage).toBe('Second');

      // Both are in the log
      expect(store.getState().errorLog).toHaveLength(2);
    });

    it('allows different categories for the same account', () => {
      const store = createErrorStore();
      const syncErr = makeEntry({
        id: 'err-sync',
        category: 'sync',
        accountId: 'acc-1',
      });
      const authErr = makeEntry({
        id: 'err-auth',
        category: 'auth',
        accountId: 'acc-1',
      });

      store.getState().addError(syncErr);
      store.getState().addError(authErr);

      expect(store.getState().activeErrors).toHaveLength(2);
    });

    it('enforces MAX_ERROR_LOG_ENTRIES cap (Req 19.5)', () => {
      const store = createErrorStore();

      // Add more than MAX entries
      for (let i = 0; i < MAX_ERROR_LOG_ENTRIES + 10; i++) {
        store.getState().addError(
          makeEntry({
            id: `err-${i}`,
            // Use different accountIds so they don't replace each other
            accountId: `acc-${i}`,
            userMessage: `Error ${i}`,
          })
        );
      }

      expect(store.getState().errorLog).toHaveLength(MAX_ERROR_LOG_ENTRIES);
      // The most recent entries should be kept
      const lastEntry = store.getState().errorLog[MAX_ERROR_LOG_ENTRIES - 1];
      expect(lastEntry.userMessage).toBe(`Error ${MAX_ERROR_LOG_ENTRIES + 9}`);
    });
  });

  describe('dismissError', () => {
    it('removes the error from activeErrors', () => {
      const store = createErrorStore();
      store.getState().addError(makeEntry({ id: 'err-1' }));
      store.getState().addError(makeEntry({ id: 'err-2', accountId: 'acc-2' }));

      store.getState().dismissError('err-1');

      expect(store.getState().activeErrors).toHaveLength(1);
      expect(store.getState().activeErrors[0].id).toBe('err-2');
    });

    it('marks the error as dismissed in the log', () => {
      const store = createErrorStore();
      store.getState().addError(makeEntry({ id: 'err-1' }));

      store.getState().dismissError('err-1');

      const logEntry = store.getState().errorLog.find((e) => e.id === 'err-1');
      expect(logEntry?.resolutionStatus).toBe('dismissed');
      expect(logEntry?.resolvedAt).toBeInstanceOf(Date);
    });
  });

  describe('dismissErrorsByCategory', () => {
    it('removes all errors of a given category', () => {
      const store = createErrorStore();
      store.getState().addError(makeEntry({ id: 'err-sync-1', category: 'sync', accountId: 'a1' }));
      store.getState().addError(makeEntry({ id: 'err-sync-2', category: 'sync', accountId: 'a2' }));
      store.getState().addError(makeEntry({ id: 'err-auth-1', category: 'auth', accountId: 'a3' }));

      store.getState().dismissErrorsByCategory('sync');

      expect(store.getState().activeErrors).toHaveLength(1);
      expect(store.getState().activeErrors[0].id).toBe('err-auth-1');
    });
  });

  describe('dismissErrorsByAccount', () => {
    it('removes all errors for a given account', () => {
      const store = createErrorStore();
      store.getState().addError(makeEntry({ id: 'err-1', category: 'sync', accountId: 'acc-1' }));
      store.getState().addError(makeEntry({ id: 'err-2', category: 'auth', accountId: 'acc-1' }));
      store.getState().addError(makeEntry({ id: 'err-3', category: 'sync', accountId: 'acc-2' }));

      store.getState().dismissErrorsByAccount('acc-1');

      expect(store.getState().activeErrors).toHaveLength(1);
      expect(store.getState().activeErrors[0].id).toBe('err-3');
    });
  });

  describe('setOffline', () => {
    it('sets the offline state', () => {
      const store = createErrorStore();

      store.getState().setOffline(true);
      expect(store.getState().isOffline).toBe(true);

      store.getState().setOffline(false);
      expect(store.getState().isOffline).toBe(false);
    });
  });

  describe('resolveError', () => {
    it('removes from activeErrors and marks as resolved in log', () => {
      const store = createErrorStore();
      store.getState().addError(makeEntry({ id: 'err-1' }));

      store.getState().resolveError('err-1');

      expect(store.getState().activeErrors).toHaveLength(0);
      const logEntry = store.getState().errorLog.find((e) => e.id === 'err-1');
      expect(logEntry?.resolutionStatus).toBe('resolved');
      expect(logEntry?.resolvedAt).toBeInstanceOf(Date);
    });
  });

  describe('getActiveErrorsByCategory', () => {
    it('returns only errors of the specified category', () => {
      const store = createErrorStore();
      store.getState().addError(makeEntry({ id: 'err-1', category: 'sync' }));
      store.getState().addError(makeEntry({ id: 'err-2', category: 'auth', accountId: 'a1' }));
      store.getState().addError(makeEntry({ id: 'err-3', category: 'sync', accountId: 'a2' }));

      const syncErrors = store.getState().getActiveErrorsByCategory('sync');
      expect(syncErrors).toHaveLength(2);
      expect(syncErrors.every((e) => e.category === 'sync')).toBe(true);
    });
  });

  describe('getActiveErrorForAccount', () => {
    it('returns the error for a specific account', () => {
      const store = createErrorStore();
      store.getState().addError(makeEntry({ id: 'err-1', accountId: 'acc-1' }));
      store.getState().addError(makeEntry({ id: 'err-2', accountId: 'acc-2' }));

      const error = store.getState().getActiveErrorForAccount('acc-1');
      expect(error?.id).toBe('err-1');
    });

    it('returns undefined when no error exists for the account', () => {
      const store = createErrorStore();
      const error = store.getState().getActiveErrorForAccount('nonexistent');
      expect(error).toBeUndefined();
    });
  });

  describe('getErrorLog', () => {
    it('returns a copy of the error log', () => {
      const store = createErrorStore();
      store.getState().addError(makeEntry({ id: 'err-1' }));

      const log = store.getState().getErrorLog();
      expect(log).toHaveLength(1);
      // Verify it's a copy
      log.push({
        id: 'fake',
        category: 'sync',
        userMessage: 'fake',
        detailMessage: null,
        timestamp: new Date(),
        resolutionStatus: 'unresolved',
        resolvedAt: null,
      });
      expect(store.getState().errorLog).toHaveLength(1);
    });
  });

  describe('clearErrorLog', () => {
    it('clears all error log entries', () => {
      const store = createErrorStore();
      store.getState().addError(makeEntry({ id: 'err-1' }));
      store.getState().addError(makeEntry({ id: 'err-2', accountId: 'a2' }));

      store.getState().clearErrorLog();

      expect(store.getState().errorLog).toHaveLength(0);
    });
  });

  describe('reset', () => {
    it('resets all state to initial values', () => {
      const store = createErrorStore();
      store.getState().addError(makeEntry({ id: 'err-1' }));
      store.getState().setOffline(true);

      store.getState().reset();

      expect(store.getState().activeErrors).toHaveLength(0);
      expect(store.getState().isOffline).toBe(false);
      expect(store.getState().errorLog).toHaveLength(0);
    });
  });
});
