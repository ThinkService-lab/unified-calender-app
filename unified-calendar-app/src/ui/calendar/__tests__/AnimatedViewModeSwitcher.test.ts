/**
 * Unit tests for AnimatedViewModeSwitcher.
 *
 * Strategy:
 *   Mock `react-native-reanimated` with inert stubs. Mock all React hooks
 *   (useMemo, useCallback, useEffect) so the component function can be
 *   called directly without a React rendering context. Mock `useTokens`
 *   and `useAnimation` to control design tokens and reduced-motion state.
 *
 * Requirements: 8.1, 8.2, 8.3, 8.4
 */

// ─── Mocks ───────────────────────────────────────────────────────────────────

/**
 * Capture calls to withSpring / withTiming so we can assert which
 * animation path the component took.
 */
const animCalls: Array<{
  kind: 'spring' | 'timing';
  toValue: number;
  config: Record<string, unknown>;
}> = [];

/** Captured useEffect callbacks so we can invoke them manually. */
const effectCallbacks: Array<() => void> = [];

jest.mock('react-native-reanimated', () => {
  const React = require('react');
  return {
    __esModule: true,
    default: {
      View: React.forwardRef((props: any, ref: any) =>
        React.createElement('div', { ...props, ref }),
      ),
    },
    useSharedValue: (initial: unknown) => ({ value: initial }),
    useAnimatedStyle: (fn: () => Record<string, unknown>) => fn(),
    withSpring: (toValue: number, config: Record<string, unknown> = {}) => {
      animCalls.push({ kind: 'spring', toValue, config });
      return toValue;
    },
    withTiming: (toValue: number, config: Record<string, unknown> = {}) => {
      animCalls.push({ kind: 'timing', toValue, config });
      return toValue;
    },
  };
});

// Mock React hooks so the component can run outside a rendering context.
jest.mock('react', () => {
  const actualReact = jest.requireActual('react');
  return {
    ...actualReact,
    useMemo: (fn: () => unknown) => fn(),
    useCallback: (fn: unknown) => fn,
    useEffect: (cb: () => void) => { effectCallbacks.push(cb); },
  };
});

/** Controllable mock for `useAnimation`. */
let mockShouldAnimate = true;
jest.mock('../../animation/animationEngine', () => ({
  useAnimation: () => ({
    shouldAnimate: mockShouldAnimate,
    springConfig: mockShouldAnimate
      ? { damping: 15, stiffness: 150, mass: 1 }
      : { duration: 0 },
    withMotion: (toValue: number) => toValue,
  }),
}));

/** Mock tokens. */
const MOCK_TOKENS = {
  colors: {
    primary: '#B8361B',
    primaryLight: '#E5684C',
    textPrimary: '#1A1C20',
    textSecondary: '#4A4E57',
    surface: '#FFFFFF',
    borderLight: '#EDEAE2',
  },
  typography: {
    weights: {
      regular: '400',
      medium: '500',
      semibold: '600',
      bold: '700',
    },
  },
  radii: { md: 8 },
  shadows: {
    sm: {
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.08,
      shadowRadius: 2,
      elevation: 1,
    },
  },
};

jest.mock('../../tokens/designTokens', () => ({
  useTokens: () => MOCK_TOKENS,
}));

// Import AFTER mocks are set up.
// eslint-disable-next-line import/first
import { AnimatedViewModeSwitcher } from '../AnimatedViewModeSwitcher';

/**
 * Call the component function directly. With all hooks mocked, this
 * returns the React element tree without needing a rendering context.
 */
function renderTree(props: {
  currentMode: 'day' | 'week' | 'month' | 'agenda';
  onModeChange: (mode: string) => void;
}): any {
  return (AnimatedViewModeSwitcher as any)(props);
}

/** Flatten children into an array. */
function flatChildren(element: any): any[] {
  const c = element.props.children;
  if (c == null) return [];
  if (Array.isArray(c)) return c.flat(Infinity);
  return [c];
}

/** Get the tab elements (all children after the first indicator). */
function getTabs(element: any): any[] {
  return flatChildren(element).slice(1);
}

/** Get the indicator element (first child). */
function getIndicator(element: any): any {
  return flatChildren(element)[0];
}

// ─── Tests ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  animCalls.length = 0;
  effectCallbacks.length = 0;
  mockShouldAnimate = true;
});

describe('AnimatedViewModeSwitcher', () => {
  it('renders four tab buttons for day, week, month, agenda', () => {
    const element = renderTree({
      currentMode: 'day',
      onModeChange: jest.fn(),
    });

    const tabs = getTabs(element);
    expect(tabs).toHaveLength(4);

    const labels = tabs.map((t: any) => {
      const textChild = t.props.children;
      return textChild.props.children;
    });
    expect(labels).toEqual(['Day', 'Week', 'Month', 'Agenda']);
  });

  it('sets accessibilityRole="tablist" on the container', () => {
    const element = renderTree({
      currentMode: 'week',
      onModeChange: jest.fn(),
    });
    expect(element.props.accessibilityRole).toBe('tablist');
  });

  it('marks the active tab with accessibilityState.selected = true', () => {
    const element = renderTree({
      currentMode: 'month',
      onModeChange: jest.fn(),
    });

    const tabs = getTabs(element);
    const monthTab = tabs[2]; // index 2 = month
    expect(monthTab.props.accessibilityState).toEqual({ selected: true });

    const dayTab = tabs[0];
    expect(dayTab.props.accessibilityState).toEqual({ selected: false });
  });

  it('calls onModeChange when a tab is pressed', () => {
    const onModeChange = jest.fn();
    const element = renderTree({
      currentMode: 'day',
      onModeChange,
    });

    const tabs = getTabs(element);
    tabs[1].props.onPress();
    expect(onModeChange).toHaveBeenCalledWith('week');
  });

  it('uses Design_Token_System primary color for active tab text (Req 8.3)', () => {
    const element = renderTree({
      currentMode: 'day',
      onModeChange: jest.fn(),
    });

    const tabs = getTabs(element);
    const activeTabText = tabs[0].props.children;
    const textStyle = activeTabText.props.style;
    const dynamicStyle = textStyle[1];
    expect(dynamicStyle.color).toBe(MOCK_TOKENS.colors.primary);
    expect(dynamicStyle.fontWeight).toBe(MOCK_TOKENS.typography.weights.semibold);
  });

  it('uses Design_Token_System textSecondary color for inactive tab text (Req 8.3)', () => {
    const element = renderTree({
      currentMode: 'day',
      onModeChange: jest.fn(),
    });

    const tabs = getTabs(element);
    const inactiveTabText = tabs[1].props.children;
    const dynamicStyle = inactiveTabText.props.style[1];
    expect(dynamicStyle.color).toBe(MOCK_TOKENS.colors.textSecondary);
    expect(dynamicStyle.fontWeight).toBe(MOCK_TOKENS.typography.weights.medium);
  });

  it('renders a sliding indicator element with testID (Req 8.1)', () => {
    const element = renderTree({
      currentMode: 'day',
      onModeChange: jest.fn(),
    });

    const indicator = getIndicator(element);
    expect(indicator.props.testID).toBe('view-mode-indicator');
    expect(indicator.props.pointerEvents).toBe('none');
  });

  it('uses withSpring for indicator animation when shouldAnimate is true (Req 8.1, 8.2)', () => {
    mockShouldAnimate = true;
    animCalls.length = 0;

    renderTree({ currentMode: 'week', onModeChange: jest.fn() });

    // Trigger the captured useEffect callbacks to simulate mount.
    for (const cb of effectCallbacks) {
      cb();
    }

    const springCalls = animCalls.filter((c) => c.kind === 'spring');
    expect(springCalls.length).toBeGreaterThanOrEqual(1);

    // Verify the spring config uses the indicator-specific tuning.
    for (const call of springCalls) {
      expect(call.config).toMatchObject({
        damping: 20,
        stiffness: 200,
        mass: 1,
      });
    }
  });

  it('uses withTiming(duration:0) when reduced motion is active (Req 8.4)', () => {
    mockShouldAnimate = false;
    animCalls.length = 0;

    renderTree({ currentMode: 'month', onModeChange: jest.fn() });

    // Trigger the captured useEffect callbacks to simulate mount.
    for (const cb of effectCallbacks) {
      cb();
    }

    const timingCalls = animCalls.filter((c) => c.kind === 'timing');
    expect(timingCalls.length).toBeGreaterThanOrEqual(1);

    for (const call of timingCalls) {
      expect(call.config).toEqual({ duration: 0 });
    }

    // No spring calls should have been made.
    const springCalls = animCalls.filter((c) => c.kind === 'spring');
    expect(springCalls).toHaveLength(0);
  });

  it('uses Design_Token_System surface color for indicator background (Req 8.3)', () => {
    const element = renderTree({
      currentMode: 'day',
      onModeChange: jest.fn(),
    });

    const indicator = getIndicator(element);
    const bgStyle = indicator.props.style[1];
    expect(bgStyle.backgroundColor).toBe(MOCK_TOKENS.colors.surface);
  });

  it('uses Design_Token_System borderLight color for container background (Req 8.3)', () => {
    const element = renderTree({
      currentMode: 'day',
      onModeChange: jest.fn(),
    });

    expect(element.props.style.backgroundColor).toBe(MOCK_TOKENS.colors.borderLight);
  });
});
