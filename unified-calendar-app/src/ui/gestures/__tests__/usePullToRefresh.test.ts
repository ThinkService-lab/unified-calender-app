/**
 * @jest-environment jsdom
 */

/**
 * Unit tests for `usePullToRefresh` JS-side state machine (Task 9.18).
 *
 * Covered:
 *   - First sync sets `isRefreshing: true`, calls `onSync`, resolves →
 *     flips back to false, clears `error`.
 *   - `onSync` rejection sets `error` to the rejection message for each
 *     of the three path types (Error instance, plain string, unknown).
 *   - Successful sync after a failed sync clears `error` back to null.
 *   - Calling the trigger while `isRefreshing: true` is a no-op
 *     (JS-side sync lock — defensive double-check in `startSync`).
 *   - Calling the trigger while `config.isSyncing: true` is a no-op
 *     (caller-owned sync lock).
 *
 * Strategy: we mock `react-native-gesture-handler` with a chainable
 * recorder that captures the `.onEnd` handler passed to the pan
 * builder. The test then invokes that captured handler with a
 * synthetic event whose `translationY >= 80` — which is the exact
 * codepath used at runtime to trigger `startSync`. Our reanimated mock
 * makes `runOnJS` a pass-through so the JS-thread callback runs
 * synchronously from the test's perspective.
 *
 * Requirements: 9.1, 9.3, 9.4, 9.5
 */

import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';

// Tell React we are in a test environment so `act()` works without warnings.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// ─── Capture handlers assigned to the gesture ────────────────────────────────

interface CapturedPanHandlers {
  onEnd?: (event: { translationY: number }) => void;
  onUpdate?: (event: { translationY: number }) => void;
  onFinalize?: () => void;
}
let capturedHandlers: CapturedPanHandlers = {};

// ─── Mocks ───────────────────────────────────────────────────────────────────

jest.mock('react-native-reanimated', () => ({
  useSharedValue: (initial: number) => ({ value: initial }),
  useAnimatedStyle: (fn: () => Record<string, unknown>) => fn(),
  useDerivedValue: (fn: () => unknown) => ({ value: fn() }),
  withSpring: (toValue: number) => toValue,
  withTiming: (toValue: number | string) => toValue,
  withRepeat: (animation: unknown) => animation,
  // `runOnJS` is a pass-through so test handlers fire synchronously.
  runOnJS: (fn: (...args: unknown[]) => unknown) => fn,
  Easing: {
    linear: 'linear',
    out: (e: unknown) => e,
    cubic: 'cubic',
  },
}));

jest.mock('react-native-gesture-handler', () => {
  const makePan = () => {
    const chain: Record<string, unknown> = {
      onUpdate: (handler: (event: { translationY: number }) => void) => {
        capturedHandlers.onUpdate = handler;
        return chain;
      },
      onEnd: (handler: (event: { translationY: number }) => void) => {
        capturedHandlers.onEnd = handler;
        return chain;
      },
      onFinalize: (handler: () => void) => {
        capturedHandlers.onFinalize = handler;
        return chain;
      },
    };
    return chain;
  };
  return {
    Gesture: {
      Pan: makePan,
    },
  };
});

jest.mock('../../animation/animationEngine', () => ({
  useAnimation: () => ({
    shouldAnimate: true,
    springConfig: { damping: 15, stiffness: 150, mass: 1 },
    withMotion: (toValue: number) => toValue,
  }),
}));

// `usePullToRefreshStyle` is imported by `usePullToRefresh` — mock to
// a stub returning a harmless transform so the hook can compose it.
jest.mock('../../animation/microInteractions', () => ({
  usePullToRefreshStyle: () => ({
    transform: [{ rotate: '0deg' }],
  }),
}));

// Import AFTER mocks are set up.
import {
  usePullToRefresh,
  type PullToRefreshConfig,
} from '../usePullToRefresh';

// ─── Minimal renderHook helper ───────────────────────────────────────────────

interface HookHandle<T> {
  readonly result: T;
  setProps: (next: PullToRefreshConfig) => void;
  unmount: () => void;
}

function renderHook(
  initialProps: PullToRefreshConfig,
): HookHandle<ReturnType<typeof usePullToRefresh>> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);

  let latestResult: ReturnType<typeof usePullToRefresh>;
  let currentProps = initialProps;

  function TestComponent({ p }: { p: PullToRefreshConfig }) {
    latestResult = usePullToRefresh(p);
    return null;
  }

  act(() => {
    root.render(React.createElement(TestComponent, { p: currentProps }));
  });

  return {
    get result() {
      return latestResult!;
    },
    setProps(next: PullToRefreshConfig) {
      currentProps = next;
      act(() => {
        root.render(React.createElement(TestComponent, { p: currentProps }));
      });
    },
    unmount() {
      act(() => {
        root.unmount();
      });
      if (container.parentNode) {
        container.parentNode.removeChild(container);
      }
    },
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Flush microtasks so the promise resolution inside `startSync.then`
 * / `.catch` / `.finally` settles before assertions run.
 */
async function flushMicrotasks(): Promise<void> {
  await act(async () => {
    // Two ticks: one for then/catch, one for finally.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

/**
 * Build a fresh PullToRefreshConfig with a controllable onSync promise.
 */
function makeConfig(
  opts: {
    isSyncing?: boolean;
    onSyncImpl?: () => Promise<void>;
  } = {},
): {
  config: PullToRefreshConfig;
  onSync: jest.Mock<Promise<void>, []>;
} {
  const impl =
    opts.onSyncImpl ?? (() => Promise.resolve());
  const onSync = jest.fn<Promise<void>, []>(impl);
  return {
    config: {
      triggerDistance: 80,
      onSync,
      isSyncing: opts.isSyncing ?? false,
    },
    onSync,
  };
}

/**
 * Simulate the user completing a pull release with the given
 * translationY. Triggers the captured `.onEnd` handler which is the
 * runtime entry point to `startSync` when the translation meets the
 * 80px threshold.
 */
function simulateRelease(translationY: number): void {
  if (!capturedHandlers.onEnd) {
    throw new Error(
      '.onEnd handler was not captured — gesture-handler mock is broken',
    );
  }
  act(() => {
    capturedHandlers.onEnd!({ translationY });
  });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('usePullToRefresh', () => {
  beforeEach(() => {
    capturedHandlers = {};
  });

  describe('initial state', () => {
    test('isRefreshing is false and error is null when mounted idle', () => {
      const { config } = makeConfig();
      const hook = renderHook(config);

      expect(hook.result.isRefreshing).toBe(false);
      expect(hook.result.error).toBe(null);
      expect(hook.result.gesture).toBeDefined();
      expect(hook.result.indicatorStyle).toBeDefined();
      expect(hook.result.rotationStyle).toBeDefined();

      hook.unmount();
    });
  });

  describe('Task 9.13: indicatorStyle and rotationStyle split', () => {
    test('indicatorStyle does NOT carry a rotate transform', () => {
      // Rotation is owned by `usePullToRefreshStyle` from the Micro-
      // Interaction System; `indicatorStyle` carries only pull
      // translation + opacity.
      const { config } = makeConfig();
      const hook = renderHook(config);

      const iStyle = hook.result.indicatorStyle as {
        transform?: Array<Record<string, unknown>>;
      };
      if (iStyle.transform) {
        for (const t of iStyle.transform) {
          expect(Object.keys(t)).not.toContain('rotate');
        }
      }

      hook.unmount();
    });

    test('rotationStyle is a separate field on the hook return', () => {
      const { config } = makeConfig();
      const hook = renderHook(config);

      expect(hook.result.rotationStyle).toBeDefined();
      // Mock stub returns `{ transform: [{ rotate: '0deg' }] }`.
      expect(
        (hook.result.rotationStyle as {
          transform?: Array<Record<string, unknown>>;
        }).transform,
      ).toBeDefined();

      hook.unmount();
    });
  });

  describe('successful sync (Req 9.3)', () => {
    test('release past threshold sets isRefreshing true, calls onSync, resolves to isRefreshing false', async () => {
      let resolveSync!: () => void;
      const onSyncImpl = (): Promise<void> =>
        new Promise((resolve) => {
          resolveSync = resolve;
        });
      const { config, onSync } = makeConfig({ onSyncImpl });
      const hook = renderHook(config);

      simulateRelease(100); // past the 80px threshold

      // onSync called; isRefreshing flipped to true.
      expect(onSync).toHaveBeenCalledTimes(1);
      expect(hook.result.isRefreshing).toBe(true);

      // Resolve the promise and let the .finally branch run.
      await act(async () => {
        resolveSync();
        await flushMicrotasks();
      });

      expect(hook.result.isRefreshing).toBe(false);
      expect(hook.result.error).toBe(null);

      hook.unmount();
    });

    test('release BELOW threshold does NOT call onSync (Req 9.1)', () => {
      const { config, onSync } = makeConfig();
      const hook = renderHook(config);

      simulateRelease(50); // below the 80px threshold

      expect(onSync).not.toHaveBeenCalled();
      expect(hook.result.isRefreshing).toBe(false);

      hook.unmount();
    });
  });

  describe('sync failure → error surfacing (Req 9.4)', () => {
    test('Error instance rejection captures `err.message`', async () => {
      const { config, onSync } = makeConfig({
        onSyncImpl: () => Promise.reject(new Error('network down')),
      });
      const hook = renderHook(config);

      simulateRelease(100);
      await flushMicrotasks();

      expect(onSync).toHaveBeenCalledTimes(1);
      expect(hook.result.isRefreshing).toBe(false);
      expect(hook.result.error).toBe('network down');

      hook.unmount();
    });

    test('plain string rejection is used verbatim as the error', async () => {
      const { config } = makeConfig({
        onSyncImpl: () => Promise.reject('timeout'),
      });
      const hook = renderHook(config);

      simulateRelease(100);
      await flushMicrotasks();

      expect(hook.result.error).toBe('timeout');

      hook.unmount();
    });

    test('unknown rejection type falls back to "Sync failed"', async () => {
      const { config } = makeConfig({
        onSyncImpl: () => Promise.reject({ code: 500 }),
      });
      const hook = renderHook(config);

      simulateRelease(100);
      await flushMicrotasks();

      expect(hook.result.error).toBe('Sync failed');

      hook.unmount();
    });

    test('successful sync AFTER a failed sync clears the error back to null', async () => {
      let callNumber = 0;
      const onSyncImpl = (): Promise<void> => {
        callNumber += 1;
        if (callNumber === 1) {
          return Promise.reject(new Error('first failed'));
        }
        return Promise.resolve();
      };
      const { config } = makeConfig({ onSyncImpl });
      const hook = renderHook(config);

      // First release — failure.
      simulateRelease(100);
      await flushMicrotasks();
      expect(hook.result.error).toBe('first failed');

      // Second release — success. Error should clear.
      simulateRelease(100);
      await flushMicrotasks();

      expect(hook.result.error).toBe(null);
      expect(callNumber).toBe(2);

      hook.unmount();
    });
  });

  describe('sync lock (Req 9.5)', () => {
    test('release during isRefreshing is a no-op (JS-side lock)', async () => {
      let resolveSync!: () => void;
      const onSyncImpl = (): Promise<void> =>
        new Promise((resolve) => {
          resolveSync = resolve;
        });
      const { config, onSync } = makeConfig({ onSyncImpl });
      const hook = renderHook(config);

      // First release starts the sync; don't resolve yet.
      simulateRelease(100);
      expect(hook.result.isRefreshing).toBe(true);
      expect(onSync).toHaveBeenCalledTimes(1);

      // Second release arrives while the first sync is still pending.
      simulateRelease(100);

      // onSync must NOT be called a second time — the JS-side lock
      // suppresses additional triggers while isRefreshing is true.
      expect(onSync).toHaveBeenCalledTimes(1);

      // Settle the first sync so the hook is unmounted cleanly.
      await act(async () => {
        resolveSync();
        await flushMicrotasks();
      });

      hook.unmount();
    });

    test('release while config.isSyncing is true is a no-op (caller-owned lock)', () => {
      const { config, onSync } = makeConfig({ isSyncing: true });
      const hook = renderHook(config);

      simulateRelease(100);

      // External isSyncing flag blocks the trigger.
      expect(onSync).not.toHaveBeenCalled();
      expect(hook.result.isRefreshing).toBe(false);

      hook.unmount();
    });
  });
});
