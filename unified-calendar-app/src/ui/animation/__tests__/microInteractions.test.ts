/**
 * @jest-environment jsdom
 */

/**
 * Unit tests for the Micro-Interaction System hooks.
 *
 * Validates:
 *   - All seven hooks return instant state changes (duration: 0) when
 *     reduced motion is active (Req 2.5, 7.5).
 *   - Spring-based hooks (eventCreated, pressDown, pressRelease,
 *     eventDeleted) delegate to `withSpring` with `SPRING_CONFIG` when
 *     reduced motion is NOT active.
 *   - Timing-based hooks (visibilityToggle, syncAppear, pullToRefresh)
 *     use `withTiming` with the correct duration values (200ms, 300ms,
 *     900ms/150ms respectively).
 *   - Hooks return sensible resting styles when passed `false` or `'idle'`.
 *
 * Requirements: 2.2, 2.3, 7.1, 7.2, 7.3, 7.4, 7.5
 */

import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

// Tell React we are in a test environment so `act()` works without warnings.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// ─── Call logs populated by the reanimated mocks ─────────────────────────────

type SpringCall = { kind: 'spring'; toValue: number; config: Record<string, unknown> };
type TimingCall = { kind: 'timing'; toValue: number | string; config: Record<string, unknown> };
type RepeatCall = { kind: 'repeat'; animation: unknown; numberOfReps: number; reverse: boolean };

const calls: Array<SpringCall | TimingCall | RepeatCall> = [];

// ─── Mocks ───────────────────────────────────────────────────────────────────

/**
 * Mock react-native-reanimated. We capture every call to withSpring,
 * withTiming, and withRepeat so tests can assert which animation path
 * each hook took. Shared values are plain objects with a `.value` field.
 */
jest.mock('react-native-reanimated', () => {
  const withSpring = (toValue: number, config: Record<string, unknown>) => {
    calls.push({ kind: 'spring', toValue, config });
    return toValue;
  };
  const withTiming = (toValue: number | string, config: Record<string, unknown>) => {
    calls.push({ kind: 'timing', toValue, config });
    return toValue;
  };
  const withRepeat = (animation: unknown, numberOfReps: number, reverse: boolean) => {
    calls.push({ kind: 'repeat', animation, numberOfReps, reverse });
    return animation;
  };

  return {
    withSpring,
    withTiming,
    withRepeat,
    useSharedValue: (initial: number | string) => ({ value: initial }),
    useAnimatedStyle: (fn: () => Record<string, unknown>) => fn(),
    useDerivedValue: (fn: () => unknown) => ({ value: fn() }),
    Easing: {
      linear: 'linear',
      out: (e: unknown) => e,
      cubic: 'cubic',
    },
  };
});

/** Mock for `useReducedMotion` — the test controls its return value. */
let mockReducedMotion = false;
jest.mock('../../accessibility/useAccessibility', () => ({
  useReducedMotion: () => mockReducedMotion,
}));

// Import AFTER mocks are set up.
import {
  useEventCreatedStyle,
  useVisibilityToggleStyle,
  usePressDownStyle,
  usePressReleaseStyle,
  useEventDeletedStyle,
  useSyncAppearStyle,
  usePullToRefreshStyle,
} from '../microInteractions';
import { SPRING_CONFIG } from '../animationEngine';

// ─── Minimal renderHook helper ───────────────────────────────────────────────

/**
 * Lightweight renderHook backed by react-dom so that useState, useRef,
 * and useEffect execute through React's actual reconciler.
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

function springCalls(): SpringCall[] {
  return calls.filter((c): c is SpringCall => c.kind === 'spring');
}

function timingCalls(): TimingCall[] {
  return calls.filter((c): c is TimingCall => c.kind === 'timing');
}

function repeatCalls(): RepeatCall[] {
  return calls.filter((c): c is RepeatCall => c.kind === 'repeat');
}

// ─── Tests ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  calls.length = 0;
  mockReducedMotion = false;
});

// ═══════════════════════════════════════════════════════════════════════════════
// 1. Reduced motion tests — ALL seven hooks must resolve with duration: 0
// ═══════════════════════════════════════════════════════════════════════════════

describe('Reduced motion: all hooks resolve instantly (duration: 0)', () => {
  beforeEach(() => {
    mockReducedMotion = true;
  });

  test('useEventCreatedStyle uses withTiming({ duration: 0 }) when reduced motion is active', () => {
    const hook = renderHook(() => useEventCreatedStyle(true));
    const timings = timingCalls();
    const springs = springCalls();

    expect(springs).toHaveLength(0);
    expect(timings.length).toBeGreaterThanOrEqual(2); // scale + opacity
    timings.forEach((c) => {
      expect(c.config).toEqual({ duration: 0 });
    });
    hook.unmount();
  });

  test('useVisibilityToggleStyle uses duration 0 when reduced motion is active', () => {
    const hook = renderHook(() => useVisibilityToggleStyle('fading-in'));
    const timings = timingCalls();
    const springs = springCalls();

    expect(springs).toHaveLength(0);
    // The timing call should have duration: 0 (not 200ms)
    const animationTimings = timings.filter(
      (c) => typeof c.config?.duration === 'number',
    );
    animationTimings.forEach((c) => {
      expect(c.config.duration).toBe(0);
    });
    hook.unmount();
  });

  test('usePressDownStyle uses withTiming({ duration: 0 }) when reduced motion is active', () => {
    const hook = renderHook(() => usePressDownStyle(true));
    const timings = timingCalls();
    const springs = springCalls();

    expect(springs).toHaveLength(0);
    expect(timings.length).toBeGreaterThanOrEqual(1);
    timings.forEach((c) => {
      expect(c.config).toEqual({ duration: 0 });
    });
    hook.unmount();
  });

  test('usePressReleaseStyle uses withTiming({ duration: 0 }) when reduced motion is active', () => {
    const hook = renderHook(() => usePressReleaseStyle(true));
    const timings = timingCalls();
    const springs = springCalls();

    expect(springs).toHaveLength(0);
    expect(timings.length).toBeGreaterThanOrEqual(1);
    timings.forEach((c) => {
      expect(c.config).toEqual({ duration: 0 });
    });
    hook.unmount();
  });

  test('useEventDeletedStyle uses withTiming({ duration: 0 }) when reduced motion is active', () => {
    const hook = renderHook(() => useEventDeletedStyle(true));
    const timings = timingCalls();
    const springs = springCalls();

    expect(springs).toHaveLength(0);
    expect(timings.length).toBeGreaterThanOrEqual(2); // scale + opacity
    timings.forEach((c) => {
      expect(c.config).toEqual({ duration: 0 });
    });
    hook.unmount();
  });

  test('useSyncAppearStyle uses duration 0 when reduced motion is active', () => {
    const hook = renderHook(() => useSyncAppearStyle(true));
    const timings = timingCalls();
    const springs = springCalls();

    expect(springs).toHaveLength(0);
    const animationTimings = timings.filter(
      (c) => typeof c.config?.duration === 'number',
    );
    animationTimings.forEach((c) => {
      expect(c.config.duration).toBe(0);
    });
    hook.unmount();
  });

  test('usePullToRefreshStyle uses duration 0 when reduced motion is active', () => {
    const hook = renderHook(() => usePullToRefreshStyle(true));
    const timings = timingCalls();
    const springs = springCalls();
    const repeats = repeatCalls();

    expect(springs).toHaveLength(0);
    expect(repeats).toHaveLength(0);
    // Should settle instantly with duration: 0
    expect(timings.length).toBeGreaterThanOrEqual(1);
    timings.forEach((c) => {
      expect(c.config.duration).toBe(0);
    });
    hook.unmount();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. Spring-based hooks — use withSpring(SPRING_CONFIG) when motion enabled
// ═══════════════════════════════════════════════════════════════════════════════

describe('Spring-based hooks use withSpring with SPRING_CONFIG when motion is enabled', () => {
  beforeEach(() => {
    mockReducedMotion = false;
  });

  test('useEventCreatedStyle calls withSpring with SPRING_CONFIG when active', () => {
    const hook = renderHook(() => useEventCreatedStyle(true));
    const springs = springCalls();
    const timings = timingCalls();

    expect(timings).toHaveLength(0);
    expect(springs.length).toBeGreaterThanOrEqual(2); // scale + opacity
    springs.forEach((c) => {
      expect(c.config).toEqual(SPRING_CONFIG);
    });
    // Verify target values: scale → 1, opacity → 1
    expect(springs.some((c) => c.toValue === 1)).toBe(true);
    hook.unmount();
  });

  test('usePressDownStyle calls withSpring with SPRING_CONFIG when active', () => {
    const hook = renderHook(() => usePressDownStyle(true));
    const springs = springCalls();
    const timings = timingCalls();

    expect(timings).toHaveLength(0);
    expect(springs.length).toBeGreaterThanOrEqual(1);
    springs.forEach((c) => {
      expect(c.config).toEqual(SPRING_CONFIG);
    });
    // Target scale should be 0.97
    expect(springs[0].toValue).toBe(0.97);
    hook.unmount();
  });

  test('usePressReleaseStyle calls withSpring with SPRING_CONFIG when active', () => {
    const hook = renderHook(() => usePressReleaseStyle(true));
    const springs = springCalls();
    const timings = timingCalls();

    expect(timings).toHaveLength(0);
    expect(springs.length).toBeGreaterThanOrEqual(1);
    springs.forEach((c) => {
      expect(c.config).toEqual(SPRING_CONFIG);
    });
    // Target scale should be 1.0 (spring back)
    expect(springs[0].toValue).toBe(1);
    hook.unmount();
  });

  test('useEventDeletedStyle calls withSpring with SPRING_CONFIG when active', () => {
    const hook = renderHook(() => useEventDeletedStyle(true));
    const springs = springCalls();
    const timings = timingCalls();

    expect(timings).toHaveLength(0);
    expect(springs.length).toBeGreaterThanOrEqual(2); // scale + opacity
    springs.forEach((c) => {
      expect(c.config).toEqual(SPRING_CONFIG);
    });
    // Verify target values: scale → 0.8, opacity → 0
    expect(springs.some((c) => c.toValue === 0.8)).toBe(true);
    expect(springs.some((c) => c.toValue === 0)).toBe(true);
    hook.unmount();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. Timing-based hooks — correct duration values
// ═══════════════════════════════════════════════════════════════════════════════

describe('Timing-based hooks use withTiming with correct durations', () => {
  beforeEach(() => {
    mockReducedMotion = false;
  });

  test('useVisibilityToggleStyle uses 200ms duration for fading-in', () => {
    const hook = renderHook(() => useVisibilityToggleStyle('fading-in'));
    const timings = timingCalls();

    // Should have at least one timing call with duration: 200
    const animationTimings = timings.filter(
      (c) => typeof c.config?.duration === 'number' && c.config.duration > 0,
    );
    expect(animationTimings.length).toBeGreaterThanOrEqual(1);
    animationTimings.forEach((c) => {
      expect(c.config.duration).toBe(200);
    });
    hook.unmount();
  });

  test('useVisibilityToggleStyle uses 200ms duration for fading-out', () => {
    const hook = renderHook(() => useVisibilityToggleStyle('fading-out'));
    const timings = timingCalls();

    const animationTimings = timings.filter(
      (c) => typeof c.config?.duration === 'number' && c.config.duration > 0,
    );
    expect(animationTimings.length).toBeGreaterThanOrEqual(1);
    animationTimings.forEach((c) => {
      expect(c.config.duration).toBe(200);
    });
    hook.unmount();
  });

  test('useSyncAppearStyle uses 300ms duration when active', () => {
    const hook = renderHook(() => useSyncAppearStyle(true));
    const timings = timingCalls();

    // Should have timing calls with duration: 300 (translateX + opacity)
    const animationTimings = timings.filter(
      (c) => typeof c.config?.duration === 'number' && c.config.duration > 0,
    );
    expect(animationTimings.length).toBeGreaterThanOrEqual(2); // translateX + opacity
    animationTimings.forEach((c) => {
      expect(c.config.duration).toBe(300);
    });
    hook.unmount();
  });

  test('usePullToRefreshStyle uses 900ms rotation when spinning', () => {
    const hook = renderHook(() => usePullToRefreshStyle(true));
    const timings = timingCalls();
    const repeats = repeatCalls();

    // Should have a withTiming(360, { duration: 900 }) wrapped in withRepeat
    const rotationTiming = timings.find(
      (c) => c.toValue === 360 && c.config?.duration === 900,
    );
    expect(rotationTiming).toBeDefined();

    // Should have a withRepeat with -1 (infinite) reps
    expect(repeats.length).toBeGreaterThanOrEqual(1);
    expect(repeats[0].numberOfReps).toBe(-1);
    expect(repeats[0].reverse).toBe(false);
    hook.unmount();
  });

  test('usePullToRefreshStyle uses 150ms settle when not spinning', () => {
    const hook = renderHook(() => usePullToRefreshStyle(false));
    const timings = timingCalls();

    // Should settle to 0 with duration: 150
    const settleTiming = timings.find(
      (c) => c.toValue === 0 && c.config?.duration === 150,
    );
    expect(settleTiming).toBeDefined();
    hook.unmount();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. Idle / inactive state — sensible resting styles
// ═══════════════════════════════════════════════════════════════════════════════

describe('Hooks return sensible resting styles when inactive', () => {
  beforeEach(() => {
    mockReducedMotion = false;
  });

  test('useEventCreatedStyle(false) targets scale 0.92 and opacity 0', () => {
    const hook = renderHook(() => useEventCreatedStyle(false));
    const springs = springCalls();

    // When inactive, targets should be the "hidden" state
    expect(springs.some((c) => c.toValue === 0.92)).toBe(true);
    expect(springs.some((c) => c.toValue === 0)).toBe(true);
    hook.unmount();
  });

  test('useVisibilityToggleStyle("idle") sets opacity to 1 without animation', () => {
    const hook = renderHook(() => useVisibilityToggleStyle('idle'));
    // In idle mode, the hook directly sets opacity.value = 1 without
    // calling withTiming or withSpring for the animation path.
    // There should be no timing calls with duration > 0.
    const animationTimings = timingCalls().filter(
      (c) => typeof c.config?.duration === 'number' && c.config.duration > 0,
    );
    expect(animationTimings).toHaveLength(0);
    hook.unmount();
  });

  test('usePressDownStyle(false) targets scale 1.0', () => {
    const hook = renderHook(() => usePressDownStyle(false));
    const springs = springCalls();

    expect(springs.length).toBeGreaterThanOrEqual(1);
    expect(springs[0].toValue).toBe(1);
    hook.unmount();
  });

  test('usePressReleaseStyle(false) targets scale 1.0', () => {
    const hook = renderHook(() => usePressReleaseStyle(false));
    const springs = springCalls();

    // When inactive, should spring to 1.0
    expect(springs.length).toBeGreaterThanOrEqual(1);
    expect(springs[0].toValue).toBe(1);
    hook.unmount();
  });

  test('useEventDeletedStyle(false) targets scale 1.0 and opacity 1.0', () => {
    const hook = renderHook(() => useEventDeletedStyle(false));
    const springs = springCalls();

    // When inactive, targets should be the "visible" resting state
    expect(springs.some((c) => c.toValue === 1)).toBe(true);
    hook.unmount();
  });

  test('useSyncAppearStyle(false) sets translateX 0 and opacity 1 without animation', () => {
    const hook = renderHook(() => useSyncAppearStyle(false));
    // When inactive, the hook directly sets values without calling
    // withTiming or withSpring for the animation path.
    const animationTimings = timingCalls().filter(
      (c) => typeof c.config?.duration === 'number' && c.config.duration > 0,
    );
    expect(animationTimings).toHaveLength(0);
    hook.unmount();
  });

  test('usePullToRefreshStyle(false) settles rotation to 0', () => {
    const hook = renderHook(() => usePullToRefreshStyle(false));
    const timings = timingCalls();

    // Should settle to 0 with duration: 150
    const settleTiming = timings.find((c) => c.toValue === 0);
    expect(settleTiming).toBeDefined();
    hook.unmount();
  });
});
