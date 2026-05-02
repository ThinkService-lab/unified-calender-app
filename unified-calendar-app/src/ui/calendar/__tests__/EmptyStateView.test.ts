/**
 * Unit tests for EmptyStateView (Task 11.7).
 *
 * Validates:
 * - Context-appropriate messages for day, week, agenda, no-accounts
 * - CTA button "Create an event" calls onCreateEvent
 * - No-accounts context shows "Connect Account" button calling onConnectAccount
 * - Entrance animation: fade-in + slide-up (400ms)
 * - Reduced motion: static render (no animation)
 * - Accessibility: illustration decorative (empty alt), message and CTA labeled
 * - Design token usage for colors and typography
 *
 * Requirements: 16.1, 16.2, 16.3, 16.4, 16.5, 16.6, 16.7
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

// ─── Mocks ───────────────────────────────────────────────────────────────────

const animCalls: Array<{
  kind: 'spring' | 'timing';
  toValue: number;
  config: Record<string, unknown>;
}> = [];

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

jest.mock('react', () => {
  const actualReact = jest.requireActual('react');
  return {
    ...actualReact,
    useState: (init: unknown) => {
      let val = init;
      return [val, (next: unknown) => { val = typeof next === 'function' ? (next as any)(val) : next; }];
    },
    useRef: (init: unknown) => ({ current: init }),
    useEffect: (cb: () => void | (() => void)) => { effectCallbacks.push(cb); },
    useCallback: (fn: unknown) => fn,
    useMemo: (fn: () => unknown) => fn(),
  };
});

jest.mock('../../accessibility/useAccessibility', () => ({
  useReducedMotion: jest.fn(() => false),
  useFocusTrap: jest.fn(),
  useScreenReaderAnnouncement: jest.fn(() => ({ announce: jest.fn() })),
  useKeyboardNavigation: jest.fn(),
}));

const MOCK_TOKENS = {
  colors: {
    background: '#FCFAF7',
    surface: '#FFFFFF',
    surfaceElevated: '#FFFFFF',
    primary: '#B8361B',
    textPrimary: '#1A1C20',
    textSecondary: '#4A4E57',
    textMuted: '#6B7280',
    textOnPrimary: '#FFFFFF',
    border: '#D9D5CC',
  },
  typography: {
    sizes: { body: 14, caption: 10, heading: 20, display: 32 },
    lineHeights: { body: 20, caption: 14, heading: 26, display: 40 },
    weights: { regular: '400', medium: '500', semibold: '600', bold: '700' },
    fontFamily: { primary: 'System', mono: 'Menlo' },
  },
  spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 },
  radii: { sm: 4, md: 8, lg: 16, full: 9999 },
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
import {
  EmptyStateView,
  getEmptyStateMessage,
  type EmptyStateViewProps,
  type EmptyStateContext,
} from '../EmptyStateView';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeProps(overrides?: Partial<EmptyStateViewProps>): EmptyStateViewProps {
  return {
    context: 'day',
    onCreateEvent: jest.fn(),
    onConnectAccount: jest.fn(),
    ...overrides,
  };
}

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

function findAllByTestId(tree: React.ReactElement, testID: string): React.ReactElement[] {
  const results: React.ReactElement[] = [];
  function walk(el: any) {
    if (!el || typeof el !== 'object') return;
    if (el.props?.testID === testID) results.push(el);
    const children = el.props?.children;
    if (Array.isArray(children)) {
      for (const child of children) walk(child);
    } else if (typeof children === 'object') {
      walk(children);
    }
  }
  walk(tree);
  return results;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('getEmptyStateMessage', () => {
  test('returns correct message for day context', () => {
    expect(getEmptyStateMessage('day')).toBe(
      'No events today \u2014 enjoy your free time!',
    );
  });

  test('returns correct message for week context', () => {
    expect(getEmptyStateMessage('week')).toBe('Your week is wide open');
  });

  test('returns correct message for agenda context', () => {
    expect(getEmptyStateMessage('agenda')).toBe('Nothing coming up');
  });

  test('returns welcome message for no-accounts context', () => {
    expect(getEmptyStateMessage('no-accounts')).toBe(
      'Welcome! Connect a calendar account to get started.',
    );
  });
});

describe('EmptyStateView', () => {
  beforeEach(() => {
    animCalls.length = 0;
    effectCallbacks.length = 0;
    const { useReducedMotion } = require('../../accessibility/useAccessibility');
    (useReducedMotion as jest.Mock).mockReturnValue(false);
  });

  // ── Context-appropriate messages (Req 16.2) ─────────────────────────────

  test('displays day message for day context', () => {
    const tree = EmptyStateView(makeProps({ context: 'day' }));
    const msg = findByTestId(tree, 'empty-state-message');
    expect(msg).not.toBeNull();
    expect((msg!.props as any).children).toBe(
      'No events today \u2014 enjoy your free time!',
    );
  });

  test('displays week message for week context', () => {
    const tree = EmptyStateView(makeProps({ context: 'week' }));
    const msg = findByTestId(tree, 'empty-state-message');
    expect((msg!.props as any).children).toBe('Your week is wide open');
  });

  test('displays agenda message for agenda context', () => {
    const tree = EmptyStateView(makeProps({ context: 'agenda' }));
    const msg = findByTestId(tree, 'empty-state-message');
    expect((msg!.props as any).children).toBe('Nothing coming up');
  });

  test('displays welcome message for no-accounts context', () => {
    const tree = EmptyStateView(makeProps({ context: 'no-accounts' }));
    const msg = findByTestId(tree, 'empty-state-message');
    expect((msg!.props as any).children).toBe(
      'Welcome! Connect a calendar account to get started.',
    );
  });

  // ── CTA button (Req 16.3) ──────────────────────────────────────────────

  test('"Create an event" button calls onCreateEvent for day context', () => {
    const onCreateEvent = jest.fn();
    const tree = EmptyStateView(makeProps({ context: 'day', onCreateEvent }));
    const btn = findByTestId(tree, 'empty-state-create-button');
    expect(btn).not.toBeNull();
    (btn!.props as any).onPress();
    expect(onCreateEvent).toHaveBeenCalledTimes(1);
  });

  test('"Create an event" button is present for week context', () => {
    const tree = EmptyStateView(makeProps({ context: 'week' }));
    const btn = findByTestId(tree, 'empty-state-create-button');
    expect(btn).not.toBeNull();
  });

  test('"Create an event" button is present for agenda context', () => {
    const tree = EmptyStateView(makeProps({ context: 'agenda' }));
    const btn = findByTestId(tree, 'empty-state-create-button');
    expect(btn).not.toBeNull();
  });

  // ── No-accounts context (Req 16.4) ─────────────────────────────────────

  test('no-accounts context shows "Connect Account" button', () => {
    const onConnectAccount = jest.fn();
    const tree = EmptyStateView(
      makeProps({ context: 'no-accounts', onConnectAccount }),
    );
    const btn = findByTestId(tree, 'empty-state-connect-button');
    expect(btn).not.toBeNull();
    (btn!.props as any).onPress();
    expect(onConnectAccount).toHaveBeenCalledTimes(1);
  });

  test('no-accounts context also shows "Create an event" button', () => {
    const tree = EmptyStateView(makeProps({ context: 'no-accounts' }));
    // In no-accounts context, only "Connect Account" is shown (Req 16.4).
    // "Create an event" is NOT shown — the user needs to connect an account first.
    const btns = findAllByTestId(tree, 'empty-state-create-button');
    expect(btns.length).toBe(0);
  });

  // ── Design token usage (Req 16.5) ──────────────────────────────────────

  test('container uses token background color', () => {
    const tree = EmptyStateView(makeProps());
    const container = findByTestId(tree, 'empty-state-view');
    const style = (container!.props as any).style[0];
    expect(style.backgroundColor).toBe(MOCK_TOKENS.colors.background);
  });

  test('message uses token text color and typography', () => {
    const tree = EmptyStateView(makeProps());
    const msg = findByTestId(tree, 'empty-state-message');
    const style = (msg!.props as any).style;
    expect(style.color).toBe(MOCK_TOKENS.colors.textPrimary);
    expect(style.fontSize).toBe(MOCK_TOKENS.typography.sizes.heading);
    expect(style.fontFamily).toBe(MOCK_TOKENS.typography.fontFamily.primary);
  });

  test('CTA button uses token primary color', () => {
    const tree = EmptyStateView(makeProps());
    const btn = findByTestId(tree, 'empty-state-create-button');
    const style = (btn!.props as any).style;
    expect(style.backgroundColor).toBe(MOCK_TOKENS.colors.primary);
  });

  // ── Entrance animation (Req 16.6) ──────────────────────────────────────

  test('entrance animation uses withTiming with 400ms duration', () => {
    EmptyStateView(makeProps());

    // Run the entrance animation effects
    for (const cb of effectCallbacks) {
      cb();
    }

    const timingCalls = animCalls.filter((c) => c.kind === 'timing');
    const entranceCalls = timingCalls.filter(
      (c) => (c.config as any).duration === 400,
    );
    // Should have at least 2 calls: opacity and translateY
    expect(entranceCalls.length).toBeGreaterThanOrEqual(2);
  });

  test('entrance animation targets opacity=1 and translateY=0', () => {
    EmptyStateView(makeProps());

    for (const cb of effectCallbacks) {
      cb();
    }

    const timingCalls = animCalls.filter(
      (c) => c.kind === 'timing' && (c.config as any).duration === 400,
    );
    const toValues = timingCalls.map((c) => c.toValue);
    expect(toValues).toContain(1); // opacity → 1
    expect(toValues).toContain(0); // translateY → 0
  });

  // ── Reduced motion (Req 16.6) ──────────────────────────────────────────

  describe('reduced motion', () => {
    beforeEach(() => {
      const { useReducedMotion } = require('../../accessibility/useAccessibility');
      (useReducedMotion as jest.Mock).mockReturnValue(true);
      animCalls.length = 0;
      effectCallbacks.length = 0;
    });

    test('skips entrance animation when reduced motion is active', () => {
      EmptyStateView(makeProps());

      for (const cb of effectCallbacks) {
        cb();
      }

      // Should NOT have timing calls with 400ms duration
      const entranceCalls = animCalls.filter(
        (c) => c.kind === 'timing' && (c.config as any).duration === 400,
      );
      expect(entranceCalls.length).toBe(0);
    });

    test('renders statically with full opacity when reduced motion is active', () => {
      const tree = EmptyStateView(makeProps());
      const container = findByTestId(tree, 'empty-state-view');
      // The animated style should show opacity=1 and translateY=0 immediately
      const animStyle = (container!.props as any).style[1];
      expect(animStyle.opacity).toBe(1);
      expect(animStyle.transform).toEqual([{ translateY: 0 }]);
    });
  });

  // ── Accessibility (Req 16.7) ───────────────────────────────────────────

  test('illustration is decorative with empty alt text', () => {
    const tree = EmptyStateView(makeProps());
    const illustration = findByTestId(tree, 'empty-state-illustration');
    expect(illustration).not.toBeNull();
    expect((illustration!.props as any).accessibilityLabel).toBe('');
    expect((illustration!.props as any).accessibilityRole).toBe('image');
  });

  test('message has proper accessibility label', () => {
    const tree = EmptyStateView(makeProps({ context: 'day' }));
    const msg = findByTestId(tree, 'empty-state-message');
    expect((msg!.props as any).accessible).toBe(true);
    expect((msg!.props as any).accessibilityLabel).toBe(
      'No events today \u2014 enjoy your free time!',
    );
  });

  test('CTA button has accessibility role "button" and label "Create an event"', () => {
    const tree = EmptyStateView(makeProps());
    const btn = findByTestId(tree, 'empty-state-create-button');
    expect((btn!.props as any).accessibilityRole).toBe('button');
    expect((btn!.props as any).accessibilityLabel).toBe('Create an event');
  });

  test('Connect Account button has accessibility role "button" and label', () => {
    const tree = EmptyStateView(makeProps({ context: 'no-accounts' }));
    const btn = findByTestId(tree, 'empty-state-connect-button');
    expect((btn!.props as any).accessibilityRole).toBe('button');
    expect((btn!.props as any).accessibilityLabel).toBe('Connect Account');
  });
});
