/**
 * Unit tests for the sync-arrival and animated-delete transient
 * fields on the events store.
 *
 * Covers:
 *   - `markArrivedFromSync(ids)` adds ids and auto-clears after
 *     {@link RECENTLY_ARRIVED_TTL_MS} (1000ms).
 *   - `markPendingAnimatedDelete` / `clearPendingAnimatedDelete`
 *     mutate the `pendingAnimatedDelete` set as expected.
 *   - Transient fields survive `clear()` in the initial shape (empty
 *     sets) so the store is re-usable across tests.
 *
 * Requirements: 2.3, 7.3, 7.4
 */

import { enableMapSet } from 'immer';
import {
  useEventsStore,
  RECENTLY_ARRIVED_TTL_MS,
} from '../eventsStore';

// Immer requires the MapSet plugin to be enabled when using Set/Map
// inside immer-managed state (the events store uses ReadonlySet for
// recentlyArrivedFromSync and pendingAnimatedDelete).
enableMapSet();

describe('eventsStore — markArrivedFromSync TTL', () => {
  beforeEach(() => {
    useEventsStore.getState().clear();
    jest.useFakeTimers();
  });

  afterEach(() => {
    // Flush any remaining timers to prevent leaked timer warnings
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  it('adds ids to recentlyArrivedFromSync synchronously', () => {
    useEventsStore.getState().markArrivedFromSync(['e1', 'e2']);

    const after = useEventsStore.getState().recentlyArrivedFromSync;
    expect(after.has('e1')).toBe(true);
    expect(after.has('e2')).toBe(true);
  });

  it('clears ids after RECENTLY_ARRIVED_TTL_MS (1000ms)', () => {
    useEventsStore.getState().markArrivedFromSync(['e1']);

    // Just before the TTL — still present.
    jest.advanceTimersByTime(RECENTLY_ARRIVED_TTL_MS - 1);
    expect(useEventsStore.getState().recentlyArrivedFromSync.has('e1')).toBe(
      true,
    );

    // After the TTL — cleared.
    jest.advanceTimersByTime(1);
    expect(useEventsStore.getState().recentlyArrivedFromSync.has('e1')).toBe(
      false,
    );
  });

  it('multiple batches each get their own independent timer', () => {
    useEventsStore.getState().markArrivedFromSync(['a']);
    jest.advanceTimersByTime(500); // mid-TTL for `a`
    useEventsStore.getState().markArrivedFromSync(['b']);

    // Advance another 500ms — `a` should expire, `b` should still be present.
    jest.advanceTimersByTime(500);
    const state = useEventsStore.getState();
    expect(state.recentlyArrivedFromSync.has('a')).toBe(false);
    expect(state.recentlyArrivedFromSync.has('b')).toBe(true);

    // Advance the remaining 500ms for `b`.
    jest.advanceTimersByTime(500);
    expect(useEventsStore.getState().recentlyArrivedFromSync.has('b')).toBe(
      false,
    );
  });

  it('duplicate calls with the same id schedule independent timers', () => {
    useEventsStore.getState().markArrivedFromSync(['dup']);
    jest.advanceTimersByTime(500);
    useEventsStore.getState().markArrivedFromSync(['dup']);

    // At this point two timers are scheduled:
    //   Timer 1: fires at absolute 1000ms (removes 'dup')
    //   Timer 2: fires at absolute 1500ms (removes 'dup')
    // The second markArrivedFromSync re-added 'dup' at 500ms, but
    // Timer 1 will remove it at 1000ms regardless.

    // Just before Timer 1 fires — 'dup' is still present.
    jest.advanceTimersByTime(499); // total 999ms from first call
    expect(useEventsStore.getState().recentlyArrivedFromSync.has('dup')).toBe(
      true,
    );

    // Timer 1 fires at 1000ms — removes 'dup'.
    jest.advanceTimersByTime(2); // total 1001ms
    expect(useEventsStore.getState().recentlyArrivedFromSync.has('dup')).toBe(
      false,
    );

    // Timer 2 fires at 1500ms — also tries to remove 'dup' (no-op since
    // it's already gone). Advance past it to avoid leaked timers.
    jest.advanceTimersByTime(500);
    expect(useEventsStore.getState().recentlyArrivedFromSync.has('dup')).toBe(
      false,
    );
  });
});

describe('eventsStore — pendingAnimatedDelete', () => {
  beforeEach(() => {
    useEventsStore.getState().clear();
  });

  it('markPendingAnimatedDelete adds an id to the set', () => {
    useEventsStore.getState().markPendingAnimatedDelete('e1');
    expect(useEventsStore.getState().pendingAnimatedDelete.has('e1')).toBe(
      true,
    );
  });

  it('clearPendingAnimatedDelete removes an id from the set', () => {
    const store = useEventsStore.getState();
    store.markPendingAnimatedDelete('e1');
    store.clearPendingAnimatedDelete('e1');
    expect(useEventsStore.getState().pendingAnimatedDelete.has('e1')).toBe(
      false,
    );
  });

  it('clearPendingAnimatedDelete on a non-existent id is a no-op', () => {
    expect(() => {
      useEventsStore.getState().clearPendingAnimatedDelete('never-marked');
    }).not.toThrow();
    expect(
      useEventsStore.getState().pendingAnimatedDelete.has('never-marked'),
    ).toBe(false);
  });

  it('multiple marked ids coexist and can be cleared independently', () => {
    const store = useEventsStore.getState();
    store.markPendingAnimatedDelete('a');
    store.markPendingAnimatedDelete('b');
    store.markPendingAnimatedDelete('c');

    store.clearPendingAnimatedDelete('b');

    const after = useEventsStore.getState().pendingAnimatedDelete;
    expect(after.has('a')).toBe(true);
    expect(after.has('b')).toBe(false);
    expect(after.has('c')).toBe(true);
  });
});

describe('eventsStore — clear() resets transient fields', () => {
  it('resets recentlyArrivedFromSync and pendingAnimatedDelete to empty sets', () => {
    const store = useEventsStore.getState();
    store.markArrivedFromSync(['e1']);
    store.markPendingAnimatedDelete('e2');

    store.clear();

    const after = useEventsStore.getState();
    expect(after.recentlyArrivedFromSync.size).toBe(0);
    expect(after.pendingAnimatedDelete.size).toBe(0);
  });
});
