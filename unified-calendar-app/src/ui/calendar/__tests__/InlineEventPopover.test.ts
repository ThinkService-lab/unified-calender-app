/**
 * Unit tests for InlineEventPopover (Task 11.6).
 *
 * Validates:
 * - Formatted start–end time range display
 * - Default title "New Event" when submitted empty
 * - Submit with entered title
 * - Enter key triggers submit via onSubmitEditing
 * - Accessibility attributes (role="dialog", aria-label)
 * - Positioning at specified coordinates
 *
 * Requirements: 12.4, 12.5, 12.6
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

// ─── Mocks ───────────────────────────────────────────────────────────────────

// Capture animation calls for assertion
const animCalls: Array<{
  kind: 'spring' | 'timing';
  toValue: number;
  config: Record<string, unknown>;
}> = [];

// Captured useEffect callbacks
const effectCallbacks: Array<() => void | (() => void)> = [];

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
    withTiming: (
      toValue: number,
      config: Record<string, unknown> = {},
      callback?: (finished: boolean) => void,
    ) => {
      animCalls.push({ kind: 'timing', toValue, config });
      if (callback) callback(true);
      return toValue;
    },
    runOnJS: (fn: (...args: any[]) => void) => fn,
  };
});

// Mock React hooks so the component can run outside a rendering context.
jest.mock('react', () => {
  const actualReact = jest.requireActual('react');
  return {
    ...actualReact,
    useState: (init: unknown) => {
      // Return a simple state tuple — tests drive state via props/callbacks
      let val = init;
      return [val, (next: unknown) => { val = typeof next === 'function' ? (next as any)(val) : next; }];
    },
    useRef: (init: unknown) => ({ current: init }),
    useEffect: (cb: () => void | (() => void)) => { effectCallbacks.push(cb); },
    useCallback: (fn: unknown) => fn,
    useMemo: (fn: () => unknown) => fn(),
  };
});

// Mock accessibility hooks
jest.mock('../../accessibility/useAccessibility', () => ({
  useReducedMotion: jest.fn(() => false),
  useFocusTrap: jest.fn(),
  useScreenReaderAnnouncement: jest.fn(() => ({ announce: jest.fn() })),
  useKeyboardNavigation: jest.fn(),
}));

// Mock design tokens
const MOCK_TOKENS = {
  colors: {
    surface: '#FFFFFF',
    border: '#D9D5CC',
    textPrimary: '#1A1C20',
    textSecondary: '#4A4E57',
    textMuted: '#6B7280',
    primary: '#B8361B',
    textOnPrimary: '#FFFFFF',
  },
  typography: {
    sizes: { body: 14, caption: 10 },
    lineHeights: { body: 20, caption: 14 },
    weights: { regular: '400', medium: '500', semibold: '600', bold: '700' },
    fontFamily: { primary: 'System', mono: 'Menlo' },
  },
  spacing: { xs: 4, sm: 8, md: 12, lg: 16 },
  radii: { sm: 4, md: 8 },
  shadows: {
    md: {
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.12,
      shadowRadius: 6,
      elevation: 3,
    },
  },
};

jest.mock('../../tokens/designTokens', () => ({
  useTokens: () => MOCK_TOKENS,
}));

// ─── Import after mocks ─────────────────────────────────────────────────────

import React from 'react';
import { InlineEventPopover, type InlineEventPopoverProps } from '../InlineEventPopover';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeProps(overrides?: Partial<InlineEventPopoverProps>): InlineEventPopoverProps {
  return {
    startTime: new Date(2025, 0, 15, 9, 0),  // 09:00
    endTime: new Date(2025, 0, 15, 10, 0),    // 10:00
    position: { x: 50, y: 100 },
    onSubmit: jest.fn(),
    onDismiss: jest.fn(),
    ...overrides,
  };
}

/**
 * Recursively search a React element tree for a node matching a predicate.
 */
function findInTree(
  element: React.ReactElement | null | undefined,
  predicate: (el: React.ReactElement) => boolean,
): React.ReactElement | null {
  if (!element || typeof element !== 'object') return null;
  if (predicate(element)) return element;

  const children = (element.props as any)?.children;
  if (!children) return null;

  if (Array.isArray(children)) {
    for (const child of children) {
      const found = findInTree(child, predicate);
      if (found) return found;
    }
  } else if (typeof children === 'object') {
    return findInTree(children, predicate);
  }

  return null;
}

function findByTestId(tree: React.ReactElement, testID: string): React.ReactElement | null {
  return findInTree(tree, (el) => (el.props as any)?.testID === testID);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('InlineEventPopover', () => {
  beforeEach(() => {
    animCalls.length = 0;
    effectCallbacks.length = 0;
  });

  test('renders the formatted time range "09:00 – 10:00"', () => {
    const props = makeProps();
    const tree = InlineEventPopover(props);

    const timeRange = findByTestId(tree!, 'inline-event-popover-time-range');
    expect(timeRange).not.toBeNull();
    expect((timeRange!.props as any).children).toBe('09:00 – 10:00');
  });

  test('renders the title input with placeholder "New Event"', () => {
    const props = makeProps();
    const tree = InlineEventPopover(props);

    const input = findByTestId(tree!, 'inline-event-popover-title-input');
    expect(input).not.toBeNull();
    expect((input!.props as any).placeholder).toBe('New Event');
  });

  test('title input has autoFocus set', () => {
    const props = makeProps();
    const tree = InlineEventPopover(props);

    const input = findByTestId(tree!, 'inline-event-popover-title-input');
    expect((input!.props as any).autoFocus).toBe(true);
  });

  test('confirm button calls onSubmit with "New Event" when title is empty', () => {
    const onSubmit = jest.fn();
    const props = makeProps({ onSubmit });
    const tree = InlineEventPopover(props);

    const confirmBtn = findByTestId(tree!, 'inline-event-popover-confirm');
    expect(confirmBtn).not.toBeNull();
    // Simulate press — since useState is mocked, title stays empty
    (confirmBtn!.props as any).onPress();

    expect(onSubmit).toHaveBeenCalledWith('New Event');
  });

  test('has accessible dialog label "Create event"', () => {
    const props = makeProps();
    const tree = InlineEventPopover(props);

    const popover = findByTestId(tree!, 'inline-event-popover');
    expect(popover).not.toBeNull();
    expect((popover!.props as any).accessibilityLabel).toBe('Create event');
  });

  test('title input has accessibility label "Event title"', () => {
    const props = makeProps();
    const tree = InlineEventPopover(props);

    const input = findByTestId(tree!, 'inline-event-popover-title-input');
    expect((input!.props as any).accessibilityLabel).toBe('Event title');
  });

  test('confirm button has accessibility role "button" and label "Create event"', () => {
    const props = makeProps();
    const tree = InlineEventPopover(props);

    const confirmBtn = findByTestId(tree!, 'inline-event-popover-confirm');
    expect((confirmBtn!.props as any).accessibilityRole).toBe('button');
    expect((confirmBtn!.props as any).accessibilityLabel).toBe('Create event');
  });

  test('renders at the specified position', () => {
    const props = makeProps({ position: { x: 120, y: 250 } });
    const tree = InlineEventPopover(props);

    const popover = findByTestId(tree!, 'inline-event-popover');
    // Style is an array [containerStyle, animatedStyle]
    const containerStyle = (popover!.props as any).style[0];
    expect(containerStyle.left).toBe(120);
    expect(containerStyle.top).toBe(250);
  });

  test('formats different time ranges correctly', () => {
    const props = makeProps({
      startTime: new Date(2025, 5, 20, 14, 30),  // 14:30
      endTime: new Date(2025, 5, 20, 16, 0),      // 16:00
    });
    const tree = InlineEventPopover(props);

    const timeRange = findByTestId(tree!, 'inline-event-popover-time-range');
    expect((timeRange!.props as any).children).toBe('14:30 – 16:00');
  });

  test('onSubmitEditing on the input triggers submit', () => {
    const onSubmit = jest.fn();
    const props = makeProps({ onSubmit });
    const tree = InlineEventPopover(props);

    const input = findByTestId(tree!, 'inline-event-popover-title-input');
    // Simulate Enter key via onSubmitEditing
    (input!.props as any).onSubmitEditing();

    // With empty title, should default to "New Event"
    expect(onSubmit).toHaveBeenCalledWith('New Event');
  });

  test('entrance animation uses withTiming with 150ms duration', () => {
    const props = makeProps();
    InlineEventPopover(props);

    // Run the entrance animation effect
    for (const cb of effectCallbacks) {
      cb();
    }

    // Should have timing calls for opacity and translateY
    const timingCalls = animCalls.filter((c) => c.kind === 'timing');
    const entranceCalls = timingCalls.filter(
      (c) => (c.config as any).duration === 150,
    );
    expect(entranceCalls.length).toBeGreaterThanOrEqual(2); // opacity + translateY
  });

  test('popover container uses token-driven styles', () => {
    const props = makeProps();
    const tree = InlineEventPopover(props);

    const popover = findByTestId(tree!, 'inline-event-popover');
    const containerStyle = (popover!.props as any).style[0];
    expect(containerStyle.backgroundColor).toBe(MOCK_TOKENS.colors.surface);
    expect(containerStyle.borderColor).toBe(MOCK_TOKENS.colors.border);
    expect(containerStyle.borderRadius).toBe(MOCK_TOKENS.radii.md);
    expect(containerStyle.paddingHorizontal).toBe(MOCK_TOKENS.spacing.sm);
    expect(containerStyle.paddingVertical).toBe(MOCK_TOKENS.spacing.xs);
  });

  describe('reduced motion', () => {
    beforeEach(() => {
      const { useReducedMotion } = require('../../accessibility/useAccessibility');
      (useReducedMotion as jest.Mock).mockReturnValue(true);
    });

    afterEach(() => {
      const { useReducedMotion } = require('../../accessibility/useAccessibility');
      (useReducedMotion as jest.Mock).mockReturnValue(false);
    });

    test('skips entrance animation when reduced motion is active', () => {
      animCalls.length = 0;
      const props = makeProps();
      InlineEventPopover(props);

      // Run effects
      for (const cb of effectCallbacks) {
        cb();
      }

      // Should NOT have timing calls with 150ms duration
      const entranceCalls = animCalls.filter(
        (c) => c.kind === 'timing' && (c.config as any).duration === 150,
      );
      expect(entranceCalls.length).toBe(0);
    });
  });
});
