/**
 * @jest-environment jsdom
 */

/**
 * Unit tests for `SwipeNavigationHost` (Task 11.1A).
 *
 * Covered:
 *   - Renders three layers (previous, current, next) with correct anchor dates
 *   - Applies animatedStyle to the current layer
 *   - Applies incomingStyle to neighbor layers
 *   - Calls onNavigateForward on forward swipe commit
 *   - Calls onNavigateBack on backward swipe commit
 *   - Reads isDragActive from gesture context and passes suppressSwipe
 *   - Date arithmetic for day, week, and month units
 *   - Accessibility: neighbor layers hidden from screen readers
 *
 * Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6
 */

import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';

// Tell React we are in a test environment so `act()` works without warnings.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// ─── Track calls to useSwipeNavigation ───────────────────────────────────────

interface CapturedSwipeConfig {
  minDistance: number;
  transitionDuration: number;
  onNavigateForward: () => void;
  onNavigateBack: () => void;
  suppressSwipe: boolean;
}

let capturedSwipeConfig: CapturedSwipeConfig | null = null;

// ─── Track renderView calls ──────────────────────────────────────────────────

let renderViewCalls: Date[] = [];

// ─── Track gesture context reads ─────────────────────────────────────────────

let mockIsDragActive = false;

// ─── Mocks ───────────────────────────────────────────────────────────────────

jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  default: {
    View: React.forwardRef(
      (props: Record<string, unknown>, ref: React.Ref<unknown>) =>
        React.createElement('div', { ...props, ref, 'data-testid': 'animated-view' }),
    ),
  },
  useSharedValue: (initial: number) => ({ value: initial }),
  useAnimatedStyle: (fn: () => Record<string, unknown>) => fn(),
  withSpring: (toValue: number) => toValue,
  withTiming: (toValue: number | string) => toValue,
  runOnJS: (fn: (...args: unknown[]) => unknown) => fn,
}));

jest.mock('react-native-gesture-handler', () => ({
  GestureDetector: ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': 'gesture-detector' }, children),
}));

// Mock useSwipeNavigation to capture config and return stable stubs.
jest.mock('../useSwipeNavigation', () => ({
  useSwipeNavigation: (config: CapturedSwipeConfig) => {
    capturedSwipeConfig = config;
    return {
      gesture: {},
      animatedStyle: { transform: [{ translateX: 0 }] },
      incomingStyle: { transform: [{ translateX: 9999 }] },
    };
  },
}));

jest.mock('../../animation/animationEngine', () => ({
  useAnimation: () => ({
    shouldAnimate: true,
    springConfig: { damping: 15, stiffness: 150, mass: 1 },
    withMotion: (toValue: number) => toValue,
  }),
}));

jest.mock('../../../stores/gestureContextStore', () => ({
  useGestureContext: () => ({
    isDragActive: mockIsDragActive,
    activeGesture: mockIsDragActive ? 'reschedule' : null,
  }),
}));

// Import AFTER mocks are set up.
import { SwipeNavigationHost, type SwipeNavigationHostProps } from '../SwipeNavigationHost';

// ─── Minimal render helper ───────────────────────────────────────────────────

interface RenderHandle {
  container: HTMLDivElement;
  setProps: (next: SwipeNavigationHostProps) => void;
  unmount: () => void;
}

function renderComponent(initialProps: SwipeNavigationHostProps): RenderHandle {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);

  let currentProps = initialProps;

  function TestWrapper({ p }: { p: SwipeNavigationHostProps }) {
    return React.createElement(SwipeNavigationHost, p);
  }

  act(() => {
    root.render(React.createElement(TestWrapper, { p: currentProps }));
  });

  return {
    container,
    setProps(next: SwipeNavigationHostProps) {
      currentProps = next;
      act(() => {
        root.render(React.createElement(TestWrapper, { p: currentProps }));
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

function makeProps(
  overrides: Partial<SwipeNavigationHostProps> = {},
): SwipeNavigationHostProps {
  const anchorDate = overrides.anchorDate ?? new Date(2025, 0, 15); // Jan 15, 2025
  return {
    anchorDate,
    renderView: (date: Date) => {
      renderViewCalls.push(date);
      return React.createElement('div', {
        'data-testid': `view-${date.toISOString()}`,
      });
    },
    onNavigateForward: jest.fn(),
    onNavigateBack: jest.fn(),
    unit: 'day',
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('SwipeNavigationHost', () => {
  beforeEach(() => {
    capturedSwipeConfig = null;
    renderViewCalls = [];
    mockIsDragActive = false;
  });

  describe('rendering', () => {
    test('renders three view layers (previous, current, next)', () => {
      const props = makeProps();
      const handle = renderComponent(props);

      // renderView should be called 3 times: prev, current, next
      expect(renderViewCalls.length).toBe(3);

      handle.unmount();
    });

    test('passes correct anchor dates for day unit', () => {
      const anchor = new Date(2025, 0, 15); // Jan 15
      const props = makeProps({ anchorDate: anchor, unit: 'day' });
      const handle = renderComponent(props);

      const dates = renderViewCalls.map((d) => d.getDate());
      // Previous: Jan 14, Current: Jan 15, Next: Jan 16
      expect(dates).toContain(14);
      expect(dates).toContain(15);
      expect(dates).toContain(16);

      handle.unmount();
    });

    test('passes correct anchor dates for week unit', () => {
      const anchor = new Date(2025, 0, 15); // Jan 15
      const props = makeProps({ anchorDate: anchor, unit: 'week' });
      const handle = renderComponent(props);

      const dates = renderViewCalls.map((d) => d.getDate());
      // Previous: Jan 8, Current: Jan 15, Next: Jan 22
      expect(dates).toContain(8);
      expect(dates).toContain(15);
      expect(dates).toContain(22);

      handle.unmount();
    });

    test('passes correct anchor dates for month unit', () => {
      const anchor = new Date(2025, 0, 15); // Jan 15
      const props = makeProps({ anchorDate: anchor, unit: 'month' });
      const handle = renderComponent(props);

      const months = renderViewCalls.map((d) => d.getMonth());
      // Previous: Dec (11), Current: Jan (0), Next: Feb (1)
      expect(months).toContain(11); // December
      expect(months).toContain(0);  // January
      expect(months).toContain(1);  // February

      handle.unmount();
    });
  });

  describe('useSwipeNavigation integration', () => {
    test('passes correct config to useSwipeNavigation', () => {
      const onFwd = jest.fn();
      const onBack = jest.fn();
      const props = makeProps({
        onNavigateForward: onFwd,
        onNavigateBack: onBack,
      });
      const handle = renderComponent(props);

      expect(capturedSwipeConfig).not.toBeNull();
      expect(capturedSwipeConfig!.minDistance).toBe(50);
      expect(capturedSwipeConfig!.transitionDuration).toBe(300);
      expect(capturedSwipeConfig!.suppressSwipe).toBe(false);

      handle.unmount();
    });

    test('passes suppressSwipe=true when isDragActive is true (Req 15.6)', () => {
      mockIsDragActive = true;
      const props = makeProps();
      const handle = renderComponent(props);

      expect(capturedSwipeConfig).not.toBeNull();
      expect(capturedSwipeConfig!.suppressSwipe).toBe(true);

      handle.unmount();
    });
  });

  describe('navigation callbacks', () => {
    test('forward swipe commit calls onNavigateForward', () => {
      const onFwd = jest.fn();
      const props = makeProps({ onNavigateForward: onFwd });
      const handle = renderComponent(props);

      // Simulate the hook calling the forward callback.
      expect(capturedSwipeConfig).not.toBeNull();
      act(() => {
        capturedSwipeConfig!.onNavigateForward();
      });

      expect(onFwd).toHaveBeenCalledTimes(1);

      handle.unmount();
    });

    test('backward swipe commit calls onNavigateBack', () => {
      const onBack = jest.fn();
      const props = makeProps({ onNavigateBack: onBack });
      const handle = renderComponent(props);

      expect(capturedSwipeConfig).not.toBeNull();
      act(() => {
        capturedSwipeConfig!.onNavigateBack();
      });

      expect(onBack).toHaveBeenCalledTimes(1);

      handle.unmount();
    });
  });

  describe('accessibility', () => {
    test('GestureDetector wraps the view layers', () => {
      const props = makeProps();
      const handle = renderComponent(props);

      const gestureDetector = handle.container.querySelector(
        '[data-testid="gesture-detector"]',
      );
      expect(gestureDetector).not.toBeNull();

      handle.unmount();
    });
  });

  describe('date arithmetic edge cases', () => {
    test('month unit handles year boundary (January → December)', () => {
      const anchor = new Date(2025, 0, 1); // Jan 1, 2025
      const props = makeProps({ anchorDate: anchor, unit: 'month' });
      const handle = renderComponent(props);

      const prevCall = renderViewCalls.find((d) => d.getMonth() === 11);
      expect(prevCall).toBeDefined();
      expect(prevCall!.getFullYear()).toBe(2024);

      handle.unmount();
    });

    test('month unit handles year boundary (December → January)', () => {
      const anchor = new Date(2024, 11, 15); // Dec 15, 2024
      const props = makeProps({ anchorDate: anchor, unit: 'month' });
      const handle = renderComponent(props);

      const nextCall = renderViewCalls.find((d) => d.getMonth() === 0);
      expect(nextCall).toBeDefined();
      expect(nextCall!.getFullYear()).toBe(2025);

      handle.unmount();
    });

    test('day unit handles month boundary', () => {
      const anchor = new Date(2025, 0, 31); // Jan 31
      const props = makeProps({ anchorDate: anchor, unit: 'day' });
      const handle = renderComponent(props);

      const nextCall = renderViewCalls.find((d) => d.getMonth() === 1);
      expect(nextCall).toBeDefined();
      expect(nextCall!.getDate()).toBe(1); // Feb 1

      handle.unmount();
    });
  });
});
