/**
 * @jest-environment jsdom
 */

/**
 * Unit tests for `useInlineEventCreator` (Task 9.18).
 *
 * The hook's imperative handlers (`onSlotPress`, `onSlotDragStart`,
 * `onSlotDragMove`, `onSlotDragEnd`, `onPopoverSubmit`,
 * `onPopoverDismiss`) are pure JS-thread state-machine transitions
 * driven through React state. These tests exercise the machine via
 * the real React reconciler, covering every path that Task 18.x
 * integration will depend on.
 *
 * Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7
 *
 * ─── Test strategy ───────────────────────────────────────────────────────────
 *
 * 1. Mock `react-native-reanimated` with inert stubs (shared values are
 *    plain objects, style hooks return the worklet's return value) so
 *    the hook runs in jsdom without a Reanimated runtime.
 * 2. Mock `useAnimation` and `useTokens` so the hook has no upstream
 *    dependencies.
 * 3. Use a minimal `renderHook` helper to mount the hook and read
 *    `state` / the handler callbacks across renders.
 * 4. Drive state transitions through the exposed handlers and assert
 *    on `state` / on mock `onCreate` invocations.
 */

import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';

// Tell React we are in a test environment so `act()` works without warnings.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// ─── Mocks ───────────────────────────────────────────────────────────────────

jest.mock('react-native-reanimated', () => ({
  useSharedValue: (initial: number) => ({ value: initial }),
  useAnimatedStyle: (fn: () => Record<string, unknown>) => fn(),
  withTiming: (toValue: number | string) => toValue,
}));

jest.mock('../../animation/animationEngine', () => ({
  useAnimation: () => ({
    shouldAnimate: true,
    springConfig: { damping: 15, stiffness: 150, mass: 1 },
    withMotion: (toValue: number) => toValue,
  }),
}));

jest.mock('../../tokens', () => ({
  useTokens: () => ({
    colors: {
      primary: '#FF6B4A',
    },
  }),
}));

// Import AFTER mocks are set up.
import {
  useInlineEventCreator,
  type InlineEventCreatorConfig,
} from '../useInlineEventCreator';

// ─── Minimal renderHook helper ───────────────────────────────────────────────
//
// Same pattern as `microInteractions.test.ts` and `useAutoDismiss.test.ts` —
// a tiny react-dom-backed harness that mounts a component whose only job
// is to call the hook and expose the return value.

interface HookHandle<T> {
  readonly result: T;
  rerender: () => void;
  unmount: () => void;
}

function renderHook<T>(hookFn: () => T): HookHandle<T> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);

  let latestResult: T;

  function TestComponent() {
    latestResult = hookFn();
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

// ─── Shared fixtures ─────────────────────────────────────────────────────────

/**
 * The timeline uses 60px per hour by convention — matches what the
 * Day_View / Week_View will pass in Task 18 wiring.
 *
 * Key y-value → minute-of-day conversions (via `yToMinutes`, which
 * snaps to 15-minute increments at the 60px/hour rate):
 *   y=0   → 00:00 (0 min)
 *   y=60  → 01:00 (60 min)
 *   y=540 → 09:00 (540 min)
 *   y=555 → 09:15 (555 min)
 *   y=600 → 10:00 (600 min)
 *   y=615 → 10:15 (615 min)
 *   y=660 → 11:00 (660 min)
 */
const HOUR_HEIGHT = 60;

function makeConfig(
  onCreate: InlineEventCreatorConfig['onCreate'] = jest.fn().mockResolvedValue(
    undefined,
  ),
): InlineEventCreatorConfig {
  return {
    snapIncrement: 15,
    minimumDuration: 15,
    hourHeight: HOUR_HEIGHT,
    onCreate,
  };
}

function fixedDate(): Date {
  // Use a fixed local date so tests are deterministic across time zones.
  // 2025-06-15 is a Sunday mid-year — avoids DST boundary surprises.
  return new Date(2025, 5, 15, 0, 0, 0, 0);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('useInlineEventCreator', () => {
  describe('initial state', () => {
    test('idle state: popover hidden, no selection', () => {
      const config = makeConfig();
      const hook = renderHook(() => useInlineEventCreator(config));

      expect(hook.result.state.isSelecting).toBe(false);
      expect(hook.result.state.isPopoverVisible).toBe(false);
      expect(hook.result.state.selectedStart).toBe(null);
      expect(hook.result.state.selectedEnd).toBe(null);
      expect(hook.result.state.submitError).toBe(null);

      hook.unmount();
    });
  });

  describe('onSlotPress (single tap — Req 12.1, 12.7)', () => {
    test('creates a 15-minute selection snapped to the nearest grid line', () => {
      const config = makeConfig();
      const hook = renderHook(() => useInlineEventCreator(config));
      const day = fixedDate();

      act(() => {
        // y=540 → 09:00
        hook.result.onSlotPress(day, 540);
      });

      expect(hook.result.state.isPopoverVisible).toBe(true);
      expect(hook.result.state.isSelecting).toBe(false);
      expect(hook.result.state.selectedStart).toBeInstanceOf(Date);
      expect(hook.result.state.selectedEnd).toBeInstanceOf(Date);

      const start = hook.result.state.selectedStart!;
      const end = hook.result.state.selectedEnd!;
      expect(start.getHours()).toBe(9);
      expect(start.getMinutes()).toBe(0);
      expect(end.getHours()).toBe(9);
      expect(end.getMinutes()).toBe(15); // start + 15min minimum

      hook.unmount();
    });

    test('snaps to the nearest 15-minute grid line', () => {
      const config = makeConfig();
      const hook = renderHook(() => useInlineEventCreator(config));
      const day = fixedDate();

      act(() => {
        // y=547 → 09:07 raw → snaps to 09:00 (closer than 09:15)
        hook.result.onSlotPress(day, 547);
      });

      const start = hook.result.state.selectedStart!;
      expect(start.getHours()).toBe(9);
      expect(start.getMinutes()).toBe(0);

      hook.unmount();
    });
  });

  describe('onSlotDragStart → onSlotDragMove → onSlotDragEnd (Req 12.2, 12.3)', () => {
    test('click-drag downward populates selectedEnd with snapped drag position', () => {
      const config = makeConfig();
      const hook = renderHook(() => useInlineEventCreator(config));
      const day = fixedDate();

      act(() => {
        // Start at 09:00 (y=540)
        hook.result.onSlotDragStart(day, 540);
      });
      expect(hook.result.state.isSelecting).toBe(true);
      expect(hook.result.state.isPopoverVisible).toBe(false);

      act(() => {
        // Move to 10:00 (y=600)
        hook.result.onSlotDragMove(600);
      });
      expect(hook.result.state.isSelecting).toBe(true);
      expect(hook.result.state.selectedEnd!.getHours()).toBe(10);
      expect(hook.result.state.selectedEnd!.getMinutes()).toBe(0);

      act(() => {
        hook.result.onSlotDragEnd();
      });
      expect(hook.result.state.isSelecting).toBe(false);
      expect(hook.result.state.isPopoverVisible).toBe(true);

      const start = hook.result.state.selectedStart!;
      const end = hook.result.state.selectedEnd!;
      expect(start.getHours()).toBe(9);
      expect(start.getMinutes()).toBe(0);
      expect(end.getHours()).toBe(10);
      expect(end.getMinutes()).toBe(0);

      hook.unmount();
    });

    test('click-drag upward (negative direction) swaps start/end on release', () => {
      // Req 12.2 clarification: the final range is [min, max] regardless
      // of drag direction — the user's intent is a positive-duration
      // interval from the smaller y to the larger y.
      const config = makeConfig();
      const hook = renderHook(() => useInlineEventCreator(config));
      const day = fixedDate();

      act(() => {
        // Press at 10:00 (y=600), drag UP to 09:00 (y=540)
        hook.result.onSlotDragStart(day, 600);
      });
      act(() => {
        hook.result.onSlotDragMove(540);
      });
      act(() => {
        hook.result.onSlotDragEnd();
      });

      const start = hook.result.state.selectedStart!;
      const end = hook.result.state.selectedEnd!;
      // Range should be [09:00, 10:00] even though the drag went up.
      expect(start.getHours()).toBe(9);
      expect(end.getHours()).toBe(10);
      expect(end.getTime()).toBeGreaterThan(start.getTime());

      hook.unmount();
    });

    test('release less than 15 minutes from start extends the end to start + 15 (Req 12.7)', () => {
      const config = makeConfig();
      const hook = renderHook(() => useInlineEventCreator(config));
      const day = fixedDate();

      act(() => {
        // Press at 09:00
        hook.result.onSlotDragStart(day, 540);
      });
      act(() => {
        // Release at the same snap boundary (09:00)
        hook.result.onSlotDragMove(540);
      });
      act(() => {
        hook.result.onSlotDragEnd();
      });

      const start = hook.result.state.selectedStart!;
      const end = hook.result.state.selectedEnd!;
      expect(end.getTime() - start.getTime()).toBe(15 * 60 * 1000);

      hook.unmount();
    });

    test('release near end-of-day with short selection pulls the start backward', () => {
      // When `rangeStart + 15min` would exceed 24:00, the hook pulls
      // the start backward instead of extending the end past midnight.
      // Press at 23:50, release at 23:55 → raw range is [23:45, 23:45]
      // after snap → minimum-duration clamp tries `start + 15 ≤ 1440`:
      //   1425 + 15 = 1440 ≤ 1440 → extends end to 1440 (00:00 next day).
      // Our buildDateAtMinutes rolls 24:00 to next-day 00:00 via
      // `Date.setHours(24)` natural overflow.
      const config = makeConfig();
      const hook = renderHook(() => useInlineEventCreator(config));
      const day = fixedDate();

      act(() => {
        // 23:50 → y = (23*60 + 50) = 1430 min * (60/60) = 1430 px
        hook.result.onSlotDragStart(day, 1430);
      });
      act(() => {
        hook.result.onSlotDragMove(1435); // 23:55
      });
      act(() => {
        hook.result.onSlotDragEnd();
      });

      const start = hook.result.state.selectedStart!;
      const end = hook.result.state.selectedEnd!;
      // Raw [23:45, 23:45] → below minimum → extend end to 24:00.
      // end - start must still be >= 15 minutes.
      expect(end.getTime() - start.getTime()).toBeGreaterThanOrEqual(
        15 * 60 * 1000,
      );

      hook.unmount();
    });

    test('onSlotDragEnd without a prior onSlotDragStart resets to idle defensively', () => {
      const config = makeConfig();
      const hook = renderHook(() => useInlineEventCreator(config));

      act(() => {
        hook.result.onSlotDragEnd();
      });

      expect(hook.result.state.isSelecting).toBe(false);
      expect(hook.result.state.isPopoverVisible).toBe(false);
      expect(hook.result.state.selectedStart).toBe(null);
      expect(hook.result.state.selectedEnd).toBe(null);

      hook.unmount();
    });
  });

  describe('Task 9.17: onSlotDragMove/End guards while popover is open', () => {
    test('onSlotDragMove is a no-op when the popover is visible', () => {
      const config = makeConfig();
      const hook = renderHook(() => useInlineEventCreator(config));
      const day = fixedDate();

      // Open the popover via a tap first.
      act(() => {
        hook.result.onSlotPress(day, 540);
      });
      expect(hook.result.state.isPopoverVisible).toBe(true);
      const endBefore = hook.result.state.selectedEnd;

      // A stray drag-move that fires after the popover opens MUST NOT
      // update the selection.
      act(() => {
        hook.result.onSlotDragMove(900);
      });

      expect(hook.result.state.selectedEnd).toBe(endBefore);
      expect(hook.result.state.isPopoverVisible).toBe(true);

      hook.unmount();
    });

    test('onSlotDragEnd is a no-op when the popover is visible', () => {
      const config = makeConfig();
      const hook = renderHook(() => useInlineEventCreator(config));
      const day = fixedDate();

      act(() => {
        hook.result.onSlotPress(day, 540);
      });
      const stateBefore = hook.result.state;

      act(() => {
        hook.result.onSlotDragEnd();
      });

      expect(hook.result.state.isPopoverVisible).toBe(stateBefore.isPopoverVisible);
      expect(hook.result.state.selectedStart).toBe(stateBefore.selectedStart);
      expect(hook.result.state.selectedEnd).toBe(stateBefore.selectedEnd);

      hook.unmount();
    });
  });

  describe('onPopoverSubmit (Req 12.5)', () => {
    test('with a non-empty title calls onCreate with trimmed title and resets to idle', () => {
      const onCreate = jest.fn().mockResolvedValue(undefined);
      const config = makeConfig(onCreate);
      const hook = renderHook(() => useInlineEventCreator(config));
      const day = fixedDate();

      act(() => {
        hook.result.onSlotPress(day, 540);
      });

      const start = hook.result.state.selectedStart!;
      const end = hook.result.state.selectedEnd!;

      act(() => {
        hook.result.onPopoverSubmit('  Team standup  ');
      });

      expect(onCreate).toHaveBeenCalledTimes(1);
      expect(onCreate).toHaveBeenCalledWith(start, end, 'Team standup');

      // State machine returns to idle.
      expect(hook.result.state.isPopoverVisible).toBe(false);
      expect(hook.result.state.selectedStart).toBe(null);
      expect(hook.result.state.selectedEnd).toBe(null);

      hook.unmount();
    });

    test('Task 9.16: rejects empty titles — popover stays open with submitError', () => {
      const onCreate = jest.fn().mockResolvedValue(undefined);
      const config = makeConfig(onCreate);
      const hook = renderHook(() => useInlineEventCreator(config));
      const day = fixedDate();

      act(() => {
        hook.result.onSlotPress(day, 540);
      });
      expect(hook.result.state.isPopoverVisible).toBe(true);

      act(() => {
        hook.result.onPopoverSubmit('');
      });

      expect(onCreate).not.toHaveBeenCalled();
      expect(hook.result.state.isPopoverVisible).toBe(true);
      expect(hook.result.state.submitError).toBe('title_required');

      hook.unmount();
    });

    test('Task 9.16: rejects whitespace-only titles', () => {
      const onCreate = jest.fn().mockResolvedValue(undefined);
      const config = makeConfig(onCreate);
      const hook = renderHook(() => useInlineEventCreator(config));
      const day = fixedDate();

      act(() => {
        hook.result.onSlotPress(day, 540);
      });

      act(() => {
        hook.result.onPopoverSubmit('   \t  \n ');
      });

      expect(onCreate).not.toHaveBeenCalled();
      expect(hook.result.state.isPopoverVisible).toBe(true);
      expect(hook.result.state.submitError).toBe('title_required');

      hook.unmount();
    });

    test('onCreate rejection leaves the state machine in idle (no popover trap)', async () => {
      const onCreate = jest
        .fn<Promise<void>, [Date, Date, string]>()
        .mockRejectedValue(new Error('network down'));
      const config = makeConfig(onCreate);
      const hook = renderHook(() => useInlineEventCreator(config));
      const day = fixedDate();

      act(() => {
        hook.result.onSlotPress(day, 540);
      });
      act(() => {
        hook.result.onPopoverSubmit('Team standup');
      });

      // State machine is already back in idle optimistically — the
      // rejection settles asynchronously but does not re-open the
      // popover.
      expect(hook.result.state.isPopoverVisible).toBe(false);

      // Flush microtasks so the rejection settles and the error is set.
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(hook.result.state.isPopoverVisible).toBe(false);
      expect(onCreate).toHaveBeenCalledTimes(1);

      // Task 10A.4: error message is surfaced for AutoDismissBanner.
      expect(hook.result.error).toBe("Couldn't create event.");

      hook.unmount();
    });

    test('submit with no active selection resets defensively', () => {
      const onCreate = jest.fn().mockResolvedValue(undefined);
      const config = makeConfig(onCreate);
      const hook = renderHook(() => useInlineEventCreator(config));

      act(() => {
        hook.result.onPopoverSubmit('Team standup');
      });

      expect(onCreate).not.toHaveBeenCalled();
      expect(hook.result.state.isPopoverVisible).toBe(false);

      hook.unmount();
    });
  });

  describe('onPopoverDismiss (Req 12.6)', () => {
    test('resets state to idle without calling onCreate', () => {
      const onCreate = jest.fn().mockResolvedValue(undefined);
      const config = makeConfig(onCreate);
      const hook = renderHook(() => useInlineEventCreator(config));
      const day = fixedDate();

      act(() => {
        hook.result.onSlotPress(day, 540);
      });
      expect(hook.result.state.isPopoverVisible).toBe(true);

      act(() => {
        hook.result.onPopoverDismiss();
      });

      expect(onCreate).not.toHaveBeenCalled();
      expect(hook.result.state.isPopoverVisible).toBe(false);
      expect(hook.result.state.selectedStart).toBe(null);
      expect(hook.result.state.selectedEnd).toBe(null);

      hook.unmount();
    });
  });

  describe('Task 10A.4: error handling for inline event creation failures', () => {
    test('error is null initially', () => {
      const config = makeConfig();
      const hook = renderHook(() => useInlineEventCreator(config));

      expect(hook.result.error).toBe(null);

      hook.unmount();
    });

    test('successful onCreate does not set error', async () => {
      const onCreate = jest.fn().mockResolvedValue(undefined);
      const config = makeConfig(onCreate);
      const hook = renderHook(() => useInlineEventCreator(config));
      const day = fixedDate();

      act(() => {
        hook.result.onSlotPress(day, 540);
      });
      act(() => {
        hook.result.onPopoverSubmit('Team standup');
      });

      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(hook.result.error).toBe(null);

      hook.unmount();
    });

    test('clearError resets error to null', async () => {
      const onCreate = jest
        .fn<Promise<void>, [Date, Date, string]>()
        .mockRejectedValue(new Error('network down'));
      const config = makeConfig(onCreate);
      const hook = renderHook(() => useInlineEventCreator(config));
      const day = fixedDate();

      act(() => {
        hook.result.onSlotPress(day, 540);
      });
      act(() => {
        hook.result.onPopoverSubmit('Team standup');
      });

      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(hook.result.error).toBe("Couldn't create event.");

      act(() => {
        hook.result.clearError();
      });

      expect(hook.result.error).toBe(null);

      hook.unmount();
    });

    test('error is cleared when a new slot press starts', async () => {
      const onCreate = jest
        .fn<Promise<void>, [Date, Date, string]>()
        .mockRejectedValueOnce(new Error('network down'))
        .mockResolvedValue(undefined);
      const config = makeConfig(onCreate);
      const hook = renderHook(() => useInlineEventCreator(config));
      const day = fixedDate();

      // First attempt: fails
      act(() => {
        hook.result.onSlotPress(day, 540);
      });
      act(() => {
        hook.result.onPopoverSubmit('Team standup');
      });

      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(hook.result.error).toBe("Couldn't create event.");

      // New slot press clears the error
      act(() => {
        hook.result.onSlotPress(day, 600);
      });

      expect(hook.result.error).toBe(null);

      hook.unmount();
    });

    test('error is cleared when a new drag starts', async () => {
      const onCreate = jest
        .fn<Promise<void>, [Date, Date, string]>()
        .mockRejectedValueOnce(new Error('network down'))
        .mockResolvedValue(undefined);
      const config = makeConfig(onCreate);
      const hook = renderHook(() => useInlineEventCreator(config));
      const day = fixedDate();

      // First attempt: fails
      act(() => {
        hook.result.onSlotPress(day, 540);
      });
      act(() => {
        hook.result.onPopoverSubmit('Team standup');
      });

      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(hook.result.error).toBe("Couldn't create event.");

      // New drag start clears the error
      act(() => {
        hook.result.onSlotDragStart(day, 600);
      });

      expect(hook.result.error).toBe(null);

      hook.unmount();
    });
  });
});
