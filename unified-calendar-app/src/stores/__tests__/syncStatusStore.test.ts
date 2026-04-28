/**
 * Tests for sync status store (vanilla).
 */

import { syncStatusStore } from '../syncStatusStore';

describe('SyncStatusStore', () => {
  beforeEach(() => {
    syncStatusStore.getState().reset();
  });

  test('starts with Idle global state', () => {
    expect(syncStatusStore.getState().globalState).toBe('Idle');
    expect(syncStatusStore.getState().accountSyncStatus).toEqual({});
    expect(syncStatusStore.getState().lastGlobalSyncAt).toBeNull();
  });

  test('setGlobalState updates global state', () => {
    syncStatusStore.getState().setGlobalState('SyncingOutbound');
    expect(syncStatusStore.getState().globalState).toBe('SyncingOutbound');
  });

  test('setAccountSyncState sets account state', () => {
    syncStatusStore.getState().setAccountSyncState('acc-1', 'SyncingInbound');

    const info = syncStatusStore.getState().accountSyncStatus['acc-1'];
    expect(info.state).toBe('SyncingInbound');
    expect(info.errorMessage).toBeNull();
    expect(info.pendingCount).toBe(0);
  });

  test('setAccountError sets error message', () => {
    syncStatusStore.getState().setAccountSyncState('acc-1', 'Idle');
    syncStatusStore.getState().setAccountError('acc-1', 'Token expired');

    expect(syncStatusStore.getState().accountSyncStatus['acc-1'].errorMessage).toBe('Token expired');
  });

  test('setAccountPendingCount updates pending count', () => {
    syncStatusStore.getState().setAccountPendingCount('acc-1', 5);
    expect(syncStatusStore.getState().accountSyncStatus['acc-1'].pendingCount).toBe(5);
  });

  test('markAccountSynced sets Idle state and updates timestamps', () => {
    syncStatusStore.getState().setAccountSyncState('acc-1', 'SyncingOutbound');
    syncStatusStore.getState().setAccountError('acc-1', 'some error');

    syncStatusStore.getState().markAccountSynced('acc-1');

    const info = syncStatusStore.getState().accountSyncStatus['acc-1'];
    expect(info.state).toBe('Idle');
    expect(info.errorMessage).toBeNull();
    expect(info.lastSyncedAt).toBeInstanceOf(Date);
    expect(syncStatusStore.getState().lastGlobalSyncAt).toBeInstanceOf(Date);
  });

  test('removeAccountStatus removes account entry', () => {
    syncStatusStore.getState().setAccountSyncState('acc-1', 'Idle');
    syncStatusStore.getState().setAccountSyncState('acc-2', 'Idle');

    syncStatusStore.getState().removeAccountStatus('acc-1');

    expect(syncStatusStore.getState().accountSyncStatus['acc-1']).toBeUndefined();
    expect(syncStatusStore.getState().accountSyncStatus['acc-2']).toBeDefined();
  });

  test('subscribe notifies on state changes', () => {
    const states: string[] = [];
    const unsubscribe = syncStatusStore.subscribe((state) => {
      states.push(state.globalState);
    });

    syncStatusStore.getState().setGlobalState('FullSync');
    syncStatusStore.getState().setGlobalState('Idle');

    unsubscribe();

    expect(states).toEqual(['FullSync', 'Idle']);
  });

  test('reset clears all state', () => {
    syncStatusStore.getState().setGlobalState('SyncingOutbound');
    syncStatusStore.getState().setAccountSyncState('acc-1', 'SyncingInbound');

    syncStatusStore.getState().reset();

    expect(syncStatusStore.getState().globalState).toBe('Idle');
    expect(syncStatusStore.getState().accountSyncStatus).toEqual({});
  });
});
