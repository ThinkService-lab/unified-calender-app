/**
 * @jest-environment jsdom
 */

/**
 * Tests for gestureAvailability — runtime detection of
 * `react-native-gesture-handler` and the `useGestureAvailability()` hook.
 *
 * Uses a minimal react-dom-backed `renderHook` helper (same pattern as
 * `useAutoDismiss.test.ts`) since `@testing-library/react-hooks` is not
 * available in this project.
 *
 * Requirements: 4.1, 13.1, 15.1
 */

import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';

import {
  useGestureAvailability,
  isGestureHandlerAvailable,
  _resetCachedAvailability,
  _overrideCachedAvailability,
} from '../gestureAvailability';
import type { GestureAvailability } from '../gestureAvailability';

// Tell React we are in a test environment so `act()` works without warnings.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// ─── Minimal renderHook helper ───────────────────────────────────────────────

interface HookHandle<T> {
  readonly result: T;
  rerender: () => void;
  unmount: () => void;
}

function renderHook(): HookHandle<GestureAvailability> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);

  let latestResult: GestureAvailability;

  function TestComponent() {
    latestResult = useGestureAvailability();
    return null;
  }

  act(() => {
    root.render(React.createElement(TestComponent));
  });

  return {
    get result() {
      return latestResult!;
    },
    rerender() {
      act(() => {
        root.render(React.createElement(TestComponent));
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

// ─── Setup / teardown ────────────────────────────────────────────────────────

beforeEach(() => {
  _resetCachedAvailability();
});

afterEach(() => {
  _resetCachedAvailability();
});

// ─── isGestureHandlerAvailable (plain function) ─────────────────────────────

describe('isGestureHandlerAvailable', () => {
  it('returns a boolean', () => {
    const result = isGestureHandlerAvailable();
    expect(typeof result).toBe('boolean');
  });

  it('returns a cached value on subsequent calls', () => {
    const first = isGestureHandlerAvailable();
    const second = isGestureHandlerAvailable();
    expect(first).toBe(second);
  });

  it('returns true when overridden to true', () => {
    _overrideCachedAvailability(true);
    expect(isGestureHandlerAvailable()).toBe(true);
  });

  it('returns false when overridden to false', () => {
    _overrideCachedAvailability(false);
    expect(isGestureHandlerAvailable()).toBe(false);
  });
});

// ─── useGestureAvailability (React hook) ─────────────────────────────────────

describe('useGestureAvailability', () => {
  it('returns correct shape when gesture handler is available', () => {
    _overrideCachedAvailability(true);

    const handle = renderHook();
    const availability = handle.result;

    expect(availability.isGestureHandlerAvailable).toBe(true);
    expect(availability.isDragEnabled).toBe(true);
    expect(availability.isSwipeEnabled).toBe(true);

    handle.unmount();
  });

  it('disables drag and swipe when gesture handler is unavailable', () => {
    _overrideCachedAvailability(false);

    const handle = renderHook();
    const availability = handle.result;

    expect(availability.isGestureHandlerAvailable).toBe(false);
    expect(availability.isDragEnabled).toBe(false);
    expect(availability.isSwipeEnabled).toBe(false);

    handle.unmount();
  });

  it('returns a stable reference across re-renders when availability does not change', () => {
    _overrideCachedAvailability(true);

    const handle = renderHook();
    const first = handle.result;
    handle.rerender();
    const second = handle.result;

    // useMemo with a stable dependency should return the same object
    expect(first).toBe(second);

    handle.unmount();
  });

  it('isDragEnabled mirrors isGestureHandlerAvailable', () => {
    _overrideCachedAvailability(true);
    const available = renderHook();
    expect(available.result.isDragEnabled).toBe(
      available.result.isGestureHandlerAvailable,
    );
    available.unmount();

    _resetCachedAvailability();
    _overrideCachedAvailability(false);
    const unavailable = renderHook();
    expect(unavailable.result.isDragEnabled).toBe(
      unavailable.result.isGestureHandlerAvailable,
    );
    unavailable.unmount();
  });

  it('isSwipeEnabled mirrors isGestureHandlerAvailable', () => {
    _overrideCachedAvailability(true);
    const available = renderHook();
    expect(available.result.isSwipeEnabled).toBe(
      available.result.isGestureHandlerAvailable,
    );
    available.unmount();

    _resetCachedAvailability();
    _overrideCachedAvailability(false);
    const unavailable = renderHook();
    expect(unavailable.result.isSwipeEnabled).toBe(
      unavailable.result.isGestureHandlerAvailable,
    );
    unavailable.unmount();
  });
});

// ─── _resetCachedAvailability (test utility) ─────────────────────────────────

describe('_resetCachedAvailability', () => {
  it('clears the cached value so detection re-runs', () => {
    _overrideCachedAvailability(false);
    expect(isGestureHandlerAvailable()).toBe(false);

    _resetCachedAvailability();
    // After reset, the next call re-runs detection
    const result = isGestureHandlerAvailable();
    expect(typeof result).toBe('boolean');
  });
});

// ─── _overrideCachedAvailability (test utility) ──────────────────────────────

describe('_overrideCachedAvailability', () => {
  it('forces the cached value to the provided boolean', () => {
    _overrideCachedAvailability(true);
    expect(isGestureHandlerAvailable()).toBe(true);

    _overrideCachedAvailability(false);
    expect(isGestureHandlerAvailable()).toBe(false);
  });
});
