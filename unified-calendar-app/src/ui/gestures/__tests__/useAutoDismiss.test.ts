/**
 * @jest-environment jsdom
 */

/**
 * Unit tests for `useAutoDismiss`.
 *
 * Exercises the real React hook (useState / useEffect / useRef) via a
 * minimal `renderHook` helper backed by `react-dom`. The tests verify
 * the full show → display → fade-out → dismiss timer state machine so
 * that the `<AutoDismissBanner />` behaviour that depends on these
 * transitions is anchored in one place.
 *
 * Requirements: 9.4
 */

import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';

import { useAutoDismiss, type UseAutoDismissConfig } from '../useAutoDismiss';

// Tell React we are in a test environment so `act()` works without warnings.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// ─── Minimal renderHook helper ───────────────────────────────────────────────
//
// Matches the pattern used by `microInteractions.test.ts` and
// `useAccountVisibilityTransition.test.ts` — a tiny react-dom-backed
// harness that mounts a component whose only job is to call the hook
// and expose the return value on each render.

interface HookHandle<T> {
  readonly result: T;
  setProps: (next: UseAutoDismissConfig) => void;
  unmount: () => void;
}

function renderHook(
  initialProps: UseAutoDismissConfig,
): HookHandle<ReturnType<typeof useAutoDismiss>> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);

  let latestResult: ReturnType<typeof useAutoDismiss>;
  let currentProps = initialProps;

  function TestComponent({ p }: { p: UseAutoDismissConfig }) {
    latestResult = useAutoDismiss(p);
    return null;
  }

  act(() => {
    root.render(React.createElement(TestComponent, { p: currentProps }));
  });

  return {
    get result() {
      return latestResult!;
    },
    setProps(next: UseAutoDismissConfig) {
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

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('useAutoDismiss', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  test('initial state is hidden when message is null', () => {
    const hook = renderHook({ message: null });
    expect(hook.result.isVisible).toBe(false);
    expect(hook.result.isFadingOut).toBe(false);
    expect(hook.result.displayMessage).toBe(null);
    hook.unmount();
  });

  test('shows message and enters display phase when message is set', () => {
    const hook = renderHook({ message: 'Sync failed' });
    expect(hook.result.isVisible).toBe(true);
    expect(hook.result.isFadingOut).toBe(false);
    expect(hook.result.displayMessage).toBe('Sync failed');
    hook.unmount();
  });

  test('transitions to fade-out after `duration` ms', () => {
    const hook = renderHook({
      message: 'Sync failed',
      duration: 3000,
      fadeOutDuration: 200,
    });

    // Just before 3000ms — still in display phase.
    act(() => {
      jest.advanceTimersByTime(2999);
    });
    expect(hook.result.isVisible).toBe(true);
    expect(hook.result.isFadingOut).toBe(false);

    // At 3000ms — transitions into fade-out phase.
    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(hook.result.isVisible).toBe(true);
    expect(hook.result.isFadingOut).toBe(true);
    // Display message is still present during fade-out so the exit
    // animation shows the outgoing text.
    expect(hook.result.displayMessage).toBe('Sync failed');

    hook.unmount();
  });

  test('fully dismisses after display + fadeOut durations', () => {
    const onDismiss = jest.fn();
    const hook = renderHook({
      message: 'Sync failed',
      duration: 3000,
      fadeOutDuration: 200,
      onDismiss,
    });

    // Complete the display phase.
    act(() => {
      jest.advanceTimersByTime(3000);
    });
    expect(hook.result.isFadingOut).toBe(true);

    // Just before fade-out finishes — still visible.
    act(() => {
      jest.advanceTimersByTime(199);
    });
    expect(hook.result.isVisible).toBe(true);
    expect(onDismiss).not.toHaveBeenCalled();

    // At full fade-out — fully dismissed.
    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(hook.result.isVisible).toBe(false);
    expect(hook.result.isFadingOut).toBe(false);
    expect(hook.result.displayMessage).toBe(null);
    expect(onDismiss).toHaveBeenCalledTimes(1);

    hook.unmount();
  });

  test('dismiss() jumps straight to fade-out phase', () => {
    const onDismiss = jest.fn();
    const hook = renderHook({
      message: 'Sync failed',
      duration: 3000,
      fadeOutDuration: 200,
      onDismiss,
    });

    // In display phase.
    expect(hook.result.isVisible).toBe(true);
    expect(hook.result.isFadingOut).toBe(false);

    // User taps the banner after 500ms.
    act(() => {
      jest.advanceTimersByTime(500);
      hook.result.dismiss();
    });
    expect(hook.result.isFadingOut).toBe(true);
    expect(hook.result.isVisible).toBe(true);

    // Fade-out completes.
    act(() => {
      jest.advanceTimersByTime(200);
    });
    expect(hook.result.isVisible).toBe(false);
    expect(onDismiss).toHaveBeenCalledTimes(1);

    hook.unmount();
  });

  test('re-shows and restarts the display timer when message changes', () => {
    const hook = renderHook({
      message: 'First error',
      duration: 3000,
      fadeOutDuration: 200,
    });
    expect(hook.result.displayMessage).toBe('First error');

    // Advance halfway through the first display timer.
    act(() => {
      jest.advanceTimersByTime(1500);
    });
    expect(hook.result.isVisible).toBe(true);
    expect(hook.result.isFadingOut).toBe(false);

    // New message arrives — display timer should restart with the new
    // message for the full `duration`.
    hook.setProps({
      message: 'Second error',
      duration: 3000,
      fadeOutDuration: 200,
    });
    expect(hook.result.displayMessage).toBe('Second error');
    expect(hook.result.isFadingOut).toBe(false);

    // 1500ms after the second message — original first-message timer
    // would have fired at t=3000 (already past), but the second
    // message's 3000ms timer is still pending.
    act(() => {
      jest.advanceTimersByTime(1500);
    });
    expect(hook.result.isFadingOut).toBe(false);

    // 3000ms after the second message — now it transitions to fade-out.
    act(() => {
      jest.advanceTimersByTime(1500);
    });
    expect(hook.result.isFadingOut).toBe(true);

    hook.unmount();
  });

  test('external message=null triggers immediate fade-out while visible', () => {
    const hook = renderHook({
      message: 'Sync failed',
      duration: 3000,
      fadeOutDuration: 200,
    });
    expect(hook.result.isVisible).toBe(true);

    // Parent clears the error before the display timer fires.
    hook.setProps({
      message: null,
      duration: 3000,
      fadeOutDuration: 200,
    });
    expect(hook.result.isFadingOut).toBe(true);
    expect(hook.result.isVisible).toBe(true);

    // Fade-out completes.
    act(() => {
      jest.advanceTimersByTime(200);
    });
    expect(hook.result.isVisible).toBe(false);

    hook.unmount();
  });

  test('cleans up timers on unmount without firing onDismiss', () => {
    const onDismiss = jest.fn();
    const hook = renderHook({
      message: 'Sync failed',
      duration: 3000,
      fadeOutDuration: 200,
      onDismiss,
    });

    // Unmount while in display phase — no timers should fire afterwards.
    hook.unmount();

    act(() => {
      jest.advanceTimersByTime(10_000);
    });

    expect(onDismiss).not.toHaveBeenCalled();
  });
});
