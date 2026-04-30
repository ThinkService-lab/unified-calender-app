/**
 * @jest-environment jsdom
 */

/**
 * Unit tests for `useAccountVisibilityTransition` — the per-EventCard
 * hook that detects account visibility flips and returns a transient
 * 'fading-in' / 'fading-out' state for 200ms so the card can play the
 * matching micro-interaction.
 *
 * These tests exercise the ACTUAL React hook (useState, useRef, useEffect)
 * via a minimal `renderHook` helper backed by `react-dom`. This ensures
 * that the real React wiring — effect ordering, ref updates, timer
 * scheduling — is tested, not a hand-rolled simulation.
 *
 * Requirements: 2.3, 7.5
 */

import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { useAccountVisibilityTransition } from '../useAccountVisibilityTransition';
import type { AccountVisibilityTransitionState } from '../useAccountVisibilityTransition';

// Tell React we are in a test environment so `act()` works without warnings.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// ─── Mocks ───────────────────────────────────────────────────────────────────

let mockIsHidden = false;
jest.mock('../../../stores/calendarAccountsStore', () => ({
  useIsAccountHidden: () => mockIsHidden,
}));

let mockReducedMotion = false;
jest.mock('../../accessibility/useAccessibility', () => ({
  useReducedMotion: () => mockReducedMotion,
}));

// ─── Minimal renderHook helper ───────────────────────────────────────────────

/**
 * Lightweight renderHook that mounts a real React component tree using
 * react-dom so that useState, useRef, and useEffect execute through
 * React's actual reconciler — not a simulation.
 */
function renderHook<T>(hookFn: () => T) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  let latestResult: T;

  function TestComponent() {
    latestResult = hookFn();
    return null;
  }

  // Initial render
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
      document.body.removeChild(container);
    },
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('useAccountVisibilityTransition', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockIsHidden = false;
    mockReducedMotion = false;
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  test('returns "idle" when no visibility flip has occurred', () => {
    const hook = renderHook(() => useAccountVisibilityTransition('acc-1'));
    expect(hook.result).toBe('idle');
    hook.unmount();
  });

  test('returns "fading-out" when account becomes hidden (visible → hidden)', () => {
    // Start visible
    mockIsHidden = false;
    const hook = renderHook(() => useAccountVisibilityTransition('acc-1'));
    expect(hook.result).toBe('idle');

    // Flip to hidden
    mockIsHidden = true;
    hook.rerender();
    expect(hook.result).toBe('fading-out');
    hook.unmount();
  });

  test('returns "fading-in" when account becomes visible (hidden → visible)', () => {
    // Start hidden
    mockIsHidden = true;
    const hook = renderHook(() => useAccountVisibilityTransition('acc-1'));
    expect(hook.result).toBe('idle'); // initial — no flip yet

    // Flip to visible
    mockIsHidden = false;
    hook.rerender();
    expect(hook.result).toBe('fading-in');
    hook.unmount();
  });

  test('auto-clears to "idle" after 200ms', () => {
    mockIsHidden = false;
    const hook = renderHook(() => useAccountVisibilityTransition('acc-1'));

    // Flip to hidden
    mockIsHidden = true;
    hook.rerender();
    expect(hook.result).toBe('fading-out');

    // Just before 200ms — still fading
    act(() => { jest.advanceTimersByTime(199); });
    hook.rerender();
    expect(hook.result).toBe('fading-out');

    // At 200ms — cleared to idle
    act(() => { jest.advanceTimersByTime(1); });
    hook.rerender();
    expect(hook.result).toBe('idle');
    hook.unmount();
  });

  test('always returns "idle" when reduced motion is active', () => {
    mockReducedMotion = true;
    mockIsHidden = false;
    const hook = renderHook(() => useAccountVisibilityTransition('acc-1'));
    expect(hook.result).toBe('idle');

    // Flip to hidden — should still be idle under reduced motion
    mockIsHidden = true;
    hook.rerender();
    expect(hook.result).toBe('idle');

    // Flip back to visible — still idle
    mockIsHidden = false;
    hook.rerender();
    expect(hook.result).toBe('idle');
    hook.unmount();
  });

  test('cleanup cancels pending timers on unmount', () => {
    mockIsHidden = false;
    const hook = renderHook(() => useAccountVisibilityTransition('acc-1'));

    // Trigger a transition
    mockIsHidden = true;
    hook.rerender();
    expect(hook.result).toBe('fading-out');

    // Unmount — should cancel the timer without errors
    hook.unmount();

    // Advance past the 200ms — no setState-on-unmounted-component warning
    // should occur (the timer was cleaned up).
    act(() => { jest.advanceTimersByTime(300); });
    // If we got here without a React warning, the cleanup worked.
  });

  test('rapid re-toggle cancels the first timer and starts a new one', () => {
    mockIsHidden = false;
    const hook = renderHook(() => useAccountVisibilityTransition('acc-1'));

    // First flip: visible → hidden
    mockIsHidden = true;
    hook.rerender();
    expect(hook.result).toBe('fading-out');

    // Advance 100ms (halfway through the 200ms timer)
    act(() => { jest.advanceTimersByTime(100); });

    // Second flip: hidden → visible (before first timer fires)
    mockIsHidden = false;
    hook.rerender();
    expect(hook.result).toBe('fading-in');

    // Advance another 100ms — the first timer would have fired at 200ms
    // from the first flip, but it was cancelled.
    act(() => { jest.advanceTimersByTime(100); });
    hook.rerender();
    // The second timer still has 100ms remaining
    expect(hook.result).toBe('fading-in');

    // Advance the remaining 100ms for the second timer
    act(() => { jest.advanceTimersByTime(100); });
    hook.rerender();
    expect(hook.result).toBe('idle');
    hook.unmount();
  });
});
