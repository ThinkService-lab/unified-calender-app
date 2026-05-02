/**
 * @jest-environment jsdom
 */

/**
 * Unit tests for ViewTransitionAnimator and useZoomTransition.
 *
 * Validates:
 *   - Crossfade + horizontal slide transitions between view modes (Req 3.1)
 *   - Transitions complete within 350ms timing config (Req 3.2)
 *   - Zoom-in transition from tapped day cell to Day_View (Req 3.3)
 *   - Reduced motion skips all animations (Req 3.4)
 *   - Transition lock ignores concurrent view switch requests (Req 3.5)
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5
 */

import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// ─── Call logs populated by the reanimated mocks ─────────────────────────────

type TimingCall = {
  kind: 'timing';
  toValue: number | string;
  config: Record<string, unknown>;
  callback?: (finished?: boolean) => void;
};

const calls: TimingCall[] = [];

// ─── Mocks ───────────────────────────────────────────────────────────────────

let mockReducedMotion = false;

jest.mock('../../accessibility/useAccessibility', () => ({
  useReducedMotion: () => mockReducedMotion,
  useScreenReaderAnnouncement: () => ({ announce: jest.fn() }),
}));

jest.mock('react-native-reanimated', () => {
  const withTiming = (
    toValue: number | string,
    config: Record<string, unknown>,
    callback?: (finished?: boolean) => void,
  ) => {
    calls.push({ kind: 'timing', toValue, config, callback });
    return toValue;
  };

  const withSpring = (toValue: number, _config: Record<string, unknown>) => {
    return toValue;
  };

  return {
    withTiming,
    withSpring,
    useSharedValue: (initial: number) => ({ value: initial }),
    useAnimatedStyle: (updater: () => Record<string, unknown>) => {
      try {
        return updater();
      } catch {
        return {};
      }
    },
    Easing: {
      out: (fn: unknown) => fn,
      in: (fn: unknown) => fn,
      ease: 'ease',
      cubic: 'cubic',
    },
    runOnJS: (fn: (...args: unknown[]) => void) => fn,
  };
});

jest.mock('react-native', () => ({
  StyleSheet: {
    create: (styles: Record<string, unknown>) => styles,
  },
  View: 'View',
  Platform: { OS: 'web', select: (opts: Record<string, unknown>) => opts.default ?? opts.web },
  AccessibilityInfo: {
    isReduceMotionEnabled: () => Promise.resolve(false),
    announceForAccessibility: jest.fn(),
  },
}));

// ─── Imports (after mocks) ───────────────────────────────────────────────────

import {
  ViewTransitionAnimator,
  useZoomTransition,
} from '../ViewTransitionAnimator';
import type { ViewTransitionAnimatorProps } from '../ViewTransitionAnimator';
import type { DefaultViewMode } from '../../types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Create a ViewTransitionAnimator element with the render-prop children in props. */
function createVTA(activeView: DefaultViewMode, childFn: ViewTransitionAnimatorProps['children']) {
  return React.createElement(ViewTransitionAnimator, {
    activeView,
    children: childFn,
  });
}

function renderInContainer(ui: React.ReactElement) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(ui);
  });
  return { container, root };
}

function cleanup(container: HTMLDivElement, root: ReturnType<typeof createRoot>) {
  act(() => {
    root.unmount();
  });
  container.remove();
}

// ─── Tests ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  calls.length = 0;
  mockReducedMotion = false;
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('ViewTransitionAnimator', () => {
  it('renders children with an animated style', () => {
    const childFn = jest.fn((_style: unknown) =>
      React.createElement('div', { 'data-testid': 'child' }),
    );

    const { container, root } = renderInContainer(createVTA('day', childFn));

    expect(childFn).toHaveBeenCalled();
    cleanup(container, root);
  });

  it('triggers crossfade + slide animation on view change (Req 3.1, 3.2)', () => {
    const childFn = jest.fn((_style: unknown) =>
      React.createElement('div', null),
    );

    const { container, root } = renderInContainer(createVTA('day', childFn));

    calls.length = 0;

    // Switch from day → week (rightward slide)
    act(() => {
      root.render(createVTA('week', childFn));
    });

    // Phase 1: fade-out + slide-out should produce withTiming calls
    const phase1Calls = calls.filter((c) => c.kind === 'timing');
    expect(phase1Calls.length).toBeGreaterThanOrEqual(2);

    // Verify 350ms / 2 = 175ms duration for each phase
    const durations = phase1Calls.map((c) => c.config.duration);
    expect(durations).toContain(175);

    cleanup(container, root);
  });

  it('skips animation when reduced motion is active (Req 3.4)', () => {
    mockReducedMotion = true;

    const childFn = jest.fn((_style: unknown) =>
      React.createElement('div', null),
    );

    const { container, root } = renderInContainer(createVTA('day', childFn));

    calls.length = 0;

    act(() => {
      root.render(createVTA('week', childFn));
    });

    // No withTiming calls should be made — values are set directly
    const timingCalls = calls.filter((c) => c.kind === 'timing');
    expect(timingCalls.length).toBe(0);

    cleanup(container, root);
  });

  it('ignores view switch requests while a transition is in progress (Req 3.5)', () => {
    const childFn = jest.fn((_style: unknown) =>
      React.createElement('div', null),
    );

    const { container, root } = renderInContainer(createVTA('day', childFn));

    calls.length = 0;

    // First switch: day → week — should trigger animation
    act(() => {
      root.render(createVTA('week', childFn));
    });

    const callsAfterFirst = calls.length;
    expect(callsAfterFirst).toBeGreaterThan(0);

    // Second switch while first is still in progress: week → month
    // Should be ignored (no new animation calls)
    act(() => {
      root.render(createVTA('month', childFn));
    });

    // The call count should not increase because the transition lock is active
    expect(calls.length).toBe(callsAfterFirst);

    cleanup(container, root);
  });

  it('determines slide direction based on view order', () => {
    const childFn = jest.fn((_style: unknown) =>
      React.createElement('div', null),
    );

    // Start at month, switch to day (leftward — day is before month)
    const { container, root } = renderInContainer(createVTA('month', childFn));

    calls.length = 0;

    act(() => {
      root.render(createVTA('day', childFn));
    });

    // The first translateX call should slide in the opposite direction
    // (direction = -1 since day < month, so outgoing slides to +SLIDE_OFFSET)
    const timingCalls = calls.filter((c) => c.kind === 'timing');
    expect(timingCalls.length).toBeGreaterThanOrEqual(2);

    // The slide value should be positive (outgoing slides right when going backward)
    const slideCall = timingCalls.find(
      (c) => typeof c.toValue === 'number' && c.toValue !== 0,
    );
    expect(slideCall).toBeDefined();
    expect(slideCall!.toValue).toBeGreaterThan(0);

    cleanup(container, root);
  });
});

describe('useZoomTransition', () => {
  function ZoomTestComponent({
    originRect,
    onComplete,
    triggerRef,
  }: {
    originRect: { x: number; y: number; width: number; height: number };
    onComplete: () => void;
    triggerRef: React.MutableRefObject<(() => void) | null>;
  }) {
    const { animatedStyle, startTransition } = useZoomTransition({
      originRect,
      onComplete,
    });
    triggerRef.current = startTransition;
    return React.createElement('div', { style: animatedStyle });
  }

  it('calls onComplete immediately when reduced motion is active (Req 3.4)', () => {
    mockReducedMotion = true;
    const onComplete = jest.fn();
    const triggerRef: React.MutableRefObject<(() => void) | null> = { current: null };

    const { container, root } = renderInContainer(
      React.createElement(ZoomTestComponent, {
        originRect: { x: 100, y: 200, width: 50, height: 50 },
        onComplete,
        triggerRef,
      }),
    );

    act(() => {
      triggerRef.current!();
    });

    expect(onComplete).toHaveBeenCalledTimes(1);
    cleanup(container, root);
  });

  it('triggers zoom animation with 350ms duration (Req 3.2, 3.3)', () => {
    mockReducedMotion = false;
    const onComplete = jest.fn();
    const triggerRef: React.MutableRefObject<(() => void) | null> = { current: null };

    const { container, root } = renderInContainer(
      React.createElement(ZoomTestComponent, {
        originRect: { x: 100, y: 200, width: 50, height: 50 },
        onComplete,
        triggerRef,
      }),
    );

    calls.length = 0;

    act(() => {
      triggerRef.current!();
    });

    // Should produce withTiming calls for scale, opacity, translateX, translateY
    const timingCalls = calls.filter((c) => c.kind === 'timing');
    expect(timingCalls.length).toBeGreaterThanOrEqual(4);

    // At least one call should use the full 350ms duration
    const has350 = timingCalls.some((c) => c.config.duration === 350);
    expect(has350).toBe(true);

    cleanup(container, root);
  });

  it('animates from origin rect coordinates to zero (Req 3.3)', () => {
    mockReducedMotion = false;
    const onComplete = jest.fn();
    const triggerRef: React.MutableRefObject<(() => void) | null> = { current: null };

    const { container, root } = renderInContainer(
      React.createElement(ZoomTestComponent, {
        originRect: { x: 150, y: 300, width: 60, height: 60 },
        onComplete,
        triggerRef,
      }),
    );

    calls.length = 0;

    act(() => {
      triggerRef.current!();
    });

    // The final target for translateX and translateY should be 0
    const zeroTargets = calls.filter(
      (c) => c.kind === 'timing' && c.toValue === 0,
    );
    // translateX → 0, translateY → 0
    expect(zeroTargets.length).toBeGreaterThanOrEqual(2);

    // Scale should animate to 1
    const scaleTarget = calls.find(
      (c) => c.kind === 'timing' && c.toValue === 1 && c.config.duration === 350,
    );
    expect(scaleTarget).toBeDefined();

    cleanup(container, root);
  });
});
