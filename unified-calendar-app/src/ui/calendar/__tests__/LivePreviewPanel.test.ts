/**
 * Unit tests for LivePreviewPanel (Task 12.3).
 *
 * Validates:
 * - Renders confirmed fields with primary color and medium weight
 * - Renders unresolved fields with muted color, regular weight, italic
 * - Hides optional fields (location, attendees, recurrence) when not present
 * - Shows optional fields when present
 * - Collapse animation triggers when isCollapsing is true
 * - Accessibility: live region and proper labels
 *
 * Requirements: 18.1, 18.2, 18.3, 18.4, 18.5, 18.6, 18.7
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

// ─── Mocks ───────────────────────────────────────────────────────────────────

const animCalls: Array<{
  kind: 'spring' | 'timing';
  toValue: number;
  config: Record<string, unknown>;
}> = [];

const effectCallbacks: Array<{
  cb: () => void | (() => void);
  deps: unknown[];
}> = [];

const sharedValues: Array<{ value: unknown }> = [];

jest.mock('react-native-reanimated', () => {
  const React = require('react');
  return {
    __esModule: true,
    default: {
      View: React.forwardRef((props: any, ref: any) =>
        React.createElement('div', { ...props, ref }),
      ),
    },
    useSharedValue: (initial: unknown) => {
      const sv = { value: initial };
      sharedValues.push(sv);
      return sv;
    },
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
      return [
        val,
        (next: unknown) => {
          val = typeof next === 'function' ? (next as any)(val) : next;
        },
      ];
    },
    useRef: (init: unknown) => ({ current: init }),
    useEffect: (cb: () => void | (() => void), deps: unknown[] = []) => {
      effectCallbacks.push({ cb, deps });
    },
    useCallback: (fn: unknown) => fn,
    useMemo: (fn: () => unknown) => fn(),
  };
});

// Mock accessibility hooks
const mockAnnounce = jest.fn();
jest.mock('../../accessibility/useAccessibility', () => ({
  useReducedMotion: jest.fn(() => false),
  useFocusTrap: jest.fn(),
  useScreenReaderAnnouncement: jest.fn(() => ({ announce: mockAnnounce })),
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
    success: '#0F7A3A',
    warning: '#8F5A00',
  },
  typography: {
    sizes: { body: 14, subheading: 16, caption: 10 },
    lineHeights: { body: 20, subheading: 22, caption: 14 },
    weights: { regular: '400', medium: '500', semibold: '600', bold: '700' },
    fontFamily: { primary: 'System', mono: 'Menlo' },
  },
  spacing: { xs: 4, sm: 8, md: 12, lg: 16 },
  radii: { sm: 4, md: 8 },
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

// Mock animation engine
jest.mock('../../animation/animationEngine', () => ({
  useAnimation: () => ({
    shouldAnimate: true,
    springConfig: { damping: 15, stiffness: 150, mass: 1 },
    withMotion: (toValue: number) => toValue,
  }),
  ANIMATION_CONFIG: {
    defaultSpring: { damping: 15, stiffness: 150, mass: 1 },
    durations: {
      instant: 0,
      fast: 100,
      normal: 200,
      slow: 300,
      viewTransition: 350,
      entrance: 400,
    },
  },
}));

// ─── Import after mocks ─────────────────────────────────────────────────────

import React from 'react';
import {
  LivePreviewPanel,
  type LivePreviewPanelProps,
} from '../LivePreviewPanel';
import type { ParsedEvent } from '../../../nlp/naturalLanguageParser';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeParsedEvent(overrides: Partial<ParsedEvent> = {}): ParsedEvent {
  return {
    title: 'Lunch with Sarah',
    date: new Date(2025, 0, 15),
    time: { hours: 12, minutes: 0 },
    duration: 60,
    location: null,
    attendees: [],
    recurrence: null,
    confidence: {
      date: true,
      time: true,
      duration: true,
      location: false,
      recurrence: 'none',
    },
    ...overrides,
  };
}

function makeProps(
  overrides?: Partial<LivePreviewPanelProps>,
): LivePreviewPanelProps {
  return {
    parsedEvent: makeParsedEvent(),
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

function findByTestId(
  tree: React.ReactElement,
  testID: string,
): React.ReactElement | null {
  return findInTree(tree, (el) => (el.props as any)?.testID === testID);
}

function findAllByTestId(
  tree: React.ReactElement,
  testID: string,
): React.ReactElement[] {
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

describe('LivePreviewPanel', () => {
  beforeEach(() => {
    animCalls.length = 0;
    effectCallbacks.length = 0;
    sharedValues.length = 0;
    mockAnnounce.mockClear();
    const { useReducedMotion } = require('../../accessibility/useAccessibility');
    (useReducedMotion as jest.Mock).mockReturnValue(false);
  });

  // ── Null rendering (Req 18.5) ──────────────────────────────────────────

  test('returns null when parsedEvent is null', () => {
    const result = LivePreviewPanel({ parsedEvent: null });
    expect(result).toBeNull();
  });

  // ── Confirmed fields (Req 18.3) ────────────────────────────────────────

  test('renders confirmed title with primary text color and medium weight', () => {
    const tree = LivePreviewPanel(makeProps())!;
    const titleValue = findByTestId(tree, 'preview-value-title');
    expect(titleValue).not.toBeNull();
    const style = (titleValue!.props as any).style;
    expect(style.color).toBe(MOCK_TOKENS.colors.textPrimary);
    expect(style.fontWeight).toBe(MOCK_TOKENS.typography.weights.medium);
    expect((titleValue!.props as any).children).toBe('Lunch with Sarah');
  });

  test('renders confirmed date with primary text color', () => {
    const tree = LivePreviewPanel(makeProps())!;
    const dateValue = findByTestId(tree, 'preview-value-date');
    expect(dateValue).not.toBeNull();
    const style = (dateValue!.props as any).style;
    expect(style.color).toBe(MOCK_TOKENS.colors.textPrimary);
    expect(style.fontWeight).toBe(MOCK_TOKENS.typography.weights.medium);
  });

  test('renders confirmed time with primary text color', () => {
    const tree = LivePreviewPanel(makeProps())!;
    const timeValue = findByTestId(tree, 'preview-value-time');
    expect(timeValue).not.toBeNull();
    const style = (timeValue!.props as any).style;
    expect(style.color).toBe(MOCK_TOKENS.colors.textPrimary);
    expect(style.fontWeight).toBe(MOCK_TOKENS.typography.weights.medium);
    expect((timeValue!.props as any).children).toBe('12:00 PM');
  });

  test('renders confirmed duration with primary text color', () => {
    const tree = LivePreviewPanel(makeProps())!;
    const durationValue = findByTestId(tree, 'preview-value-duration');
    expect(durationValue).not.toBeNull();
    const style = (durationValue!.props as any).style;
    expect(style.color).toBe(MOCK_TOKENS.colors.textPrimary);
    expect(style.fontWeight).toBe(MOCK_TOKENS.typography.weights.medium);
    expect((durationValue!.props as any).children).toBe('1 hour');
  });

  // ── Unresolved/placeholder fields (Req 18.4) ──────────────────────────

  test('renders unresolved date with muted color, regular weight, italic', () => {
    const event = makeParsedEvent({
      date: null,
      confidence: {
        date: false,
        time: true,
        duration: true,
        location: false,
        recurrence: 'none',
      },
    });
    const tree = LivePreviewPanel({ parsedEvent: event })!;
    const dateValue = findByTestId(tree, 'preview-value-date');
    expect(dateValue).not.toBeNull();
    const style = (dateValue!.props as any).style;
    expect(style.color).toBe(MOCK_TOKENS.colors.textMuted);
    expect(style.fontWeight).toBe(MOCK_TOKENS.typography.weights.regular);
    expect(style.fontStyle).toBe('italic');
    expect((dateValue!.props as any).children).toBe('Date not set');
  });

  test('renders unresolved time with muted color and placeholder text', () => {
    const event = makeParsedEvent({
      time: null,
      confidence: {
        date: true,
        time: false,
        duration: true,
        location: false,
        recurrence: 'none',
      },
    });
    const tree = LivePreviewPanel({ parsedEvent: event })!;
    const timeValue = findByTestId(tree, 'preview-value-time');
    expect(timeValue).not.toBeNull();
    const style = (timeValue!.props as any).style;
    expect(style.color).toBe(MOCK_TOKENS.colors.textMuted);
    expect(style.fontStyle).toBe('italic');
    expect((timeValue!.props as any).children).toBe('Time not set');
  });

  test('renders unresolved title with muted color and placeholder text', () => {
    const event = makeParsedEvent({ title: '' });
    const tree = LivePreviewPanel({ parsedEvent: event })!;
    const titleValue = findByTestId(tree, 'preview-value-title');
    expect(titleValue).not.toBeNull();
    const style = (titleValue!.props as any).style;
    expect(style.color).toBe(MOCK_TOKENS.colors.textMuted);
    expect(style.fontStyle).toBe('italic');
    expect((titleValue!.props as any).children).toBe('Untitled event');
  });

  test('renders unresolved duration with muted color (default 1 hour)', () => {
    const event = makeParsedEvent({
      duration: 60,
      confidence: {
        date: true,
        time: true,
        duration: false,
        location: false,
        recurrence: 'none',
      },
    });
    const tree = LivePreviewPanel({ parsedEvent: event })!;
    const durationValue = findByTestId(tree, 'preview-value-duration');
    expect(durationValue).not.toBeNull();
    const style = (durationValue!.props as any).style;
    expect(style.color).toBe(MOCK_TOKENS.colors.textMuted);
    expect(style.fontStyle).toBe('italic');
    // Still shows "1 hour" as the default
    expect((durationValue!.props as any).children).toBe('1 hour');
  });

  // ── Optional fields hidden when not present ────────────────────────────

  test('hides location field when location is null', () => {
    const event = makeParsedEvent({ location: null });
    const tree = LivePreviewPanel({ parsedEvent: event })!;
    const locationField = findByTestId(tree, 'preview-field-location');
    expect(locationField).toBeNull();
  });

  test('hides attendees field when attendees is empty', () => {
    const event = makeParsedEvent({ attendees: [] });
    const tree = LivePreviewPanel({ parsedEvent: event })!;
    const attendeesField = findByTestId(tree, 'preview-field-attendees');
    expect(attendeesField).toBeNull();
  });

  test('hides recurrence field when recurrence is none', () => {
    const event = makeParsedEvent({
      recurrence: null,
      confidence: {
        date: true,
        time: true,
        duration: true,
        location: false,
        recurrence: 'none',
      },
    });
    const tree = LivePreviewPanel({ parsedEvent: event })!;
    const recurrenceField = findByTestId(tree, 'preview-field-recurrence');
    expect(recurrenceField).toBeNull();
  });

  // ── Optional fields shown when present ─────────────────────────────────

  test('shows location field when location is present', () => {
    const event = makeParsedEvent({
      location: 'Cafe Roma',
      confidence: {
        date: true,
        time: true,
        duration: true,
        location: true,
        recurrence: 'none',
      },
    });
    const tree = LivePreviewPanel({ parsedEvent: event })!;
    const locationField = findByTestId(tree, 'preview-field-location');
    expect(locationField).not.toBeNull();
    const locationValue = findByTestId(tree, 'preview-value-location');
    expect((locationValue!.props as any).children).toBe('Cafe Roma');
  });

  test('shows attendees field when attendees are present', () => {
    const event = makeParsedEvent({ attendees: ['Sarah', 'Tom'] });
    const tree = LivePreviewPanel({ parsedEvent: event })!;
    const attendeesField = findByTestId(tree, 'preview-field-attendees');
    expect(attendeesField).not.toBeNull();
    const attendeesValue = findByTestId(tree, 'preview-value-attendees');
    expect((attendeesValue!.props as any).children).toBe('Sarah, Tom');
  });

  test('shows recurrence field when recurrence is parsed', () => {
    const event = makeParsedEvent({
      recurrence: { frequency: 'WEEKLY', interval: 1, byDay: ['MO', 'WE', 'FR'] } as any,
      confidence: {
        date: true,
        time: true,
        duration: true,
        location: false,
        recurrence: 'parsed',
      },
    });
    const tree = LivePreviewPanel({ parsedEvent: event })!;
    const recurrenceField = findByTestId(tree, 'preview-field-recurrence');
    expect(recurrenceField).not.toBeNull();
    const recurrenceValue = findByTestId(tree, 'preview-value-recurrence');
    expect((recurrenceValue!.props as any).children).toBe('Weekly on Mon, Wed, Fri');
  });

  // ── Collapse animation (Req 18.6) ─────────────────────────────────────

  test('collapse animation triggers withTiming when isCollapsing is true', () => {
    LivePreviewPanel(makeProps({ isCollapsing: true }));

    // Run effects
    for (const { cb } of effectCallbacks) {
      cb();
    }

    // Should have timing calls for opacity and scaleY going to 0
    const timingCalls = animCalls.filter((c) => c.kind === 'timing');
    const collapseOpacity = timingCalls.find(
      (c) => c.toValue === 0 && (c.config as any).duration === 200,
    );
    const collapseScale = timingCalls.find(
      (c) => c.toValue === 0 && (c.config as any).duration === 200,
    );
    expect(collapseOpacity).toBeDefined();
    expect(collapseScale).toBeDefined();
  });

  test('collapse animation calls onCollapseComplete when finished', () => {
    const onCollapseComplete = jest.fn();
    LivePreviewPanel(
      makeProps({ isCollapsing: true, onCollapseComplete }),
    );

    // Run effects
    for (const { cb } of effectCallbacks) {
      cb();
    }

    // The withTiming mock calls the callback immediately with finished=true
    expect(onCollapseComplete).toHaveBeenCalled();
  });

  test('collapse is instant when reduced motion is active', () => {
    const { useReducedMotion } = require('../../accessibility/useAccessibility');
    (useReducedMotion as jest.Mock).mockReturnValue(true);

    // Override animation mock for this test
    jest.spyOn(
      require('../../animation/animationEngine'),
      'useAnimation',
    ).mockReturnValue({
      shouldAnimate: false,
      springConfig: { duration: 0 },
      withMotion: (toValue: number) => toValue,
    });

    const onCollapseComplete = jest.fn();
    LivePreviewPanel(
      makeProps({ isCollapsing: true, onCollapseComplete }),
    );

    // Run effects
    for (const { cb } of effectCallbacks) {
      cb();
    }

    // Should call onCollapseComplete immediately (no animation)
    expect(onCollapseComplete).toHaveBeenCalled();

    // Should NOT have any timing calls with 200ms duration
    const timingCalls200 = animCalls.filter(
      (c) => c.kind === 'timing' && (c.config as any).duration === 200,
    );
    expect(timingCalls200.length).toBe(0);
  });

  // ── Container styling (token-driven) ───────────────────────────────────

  test('container uses token surface background and md border radius', () => {
    const tree = LivePreviewPanel(makeProps())!;
    const panel = findByTestId(tree, 'live-preview-panel');
    expect(panel).not.toBeNull();
    const style = (panel!.props as any).style[0];
    expect(style.backgroundColor).toBe(MOCK_TOKENS.colors.surface);
    expect(style.borderRadius).toBe(MOCK_TOKENS.radii.md);
    expect(style.padding).toBe(MOCK_TOKENS.spacing.md);
  });

  test('field labels use textSecondary color and caption size', () => {
    const tree = LivePreviewPanel(makeProps())!;
    // Find the first label (Title label)
    const titleField = findByTestId(tree, 'preview-field-title');
    expect(titleField).not.toBeNull();
    // The first child of the field row is the label
    const children = (titleField!.props as any).children;
    const label = Array.isArray(children) ? children[0] : children;
    const labelStyle = label.props.style;
    expect(labelStyle.color).toBe(MOCK_TOKENS.colors.textSecondary);
    expect(labelStyle.fontSize).toBe(MOCK_TOKENS.typography.sizes.caption);
  });

  test('field values use body font size', () => {
    const tree = LivePreviewPanel(makeProps())!;
    const titleValue = findByTestId(tree, 'preview-value-title');
    const style = (titleValue!.props as any).style;
    expect(style.fontSize).toBe(MOCK_TOKENS.typography.sizes.body);
  });

  // ── Accessibility (Req 18.7) ───────────────────────────────────────────

  test('container has accessibilityLiveRegion="polite"', () => {
    const tree = LivePreviewPanel(makeProps())!;
    const panel = findByTestId(tree, 'live-preview-panel');
    expect((panel!.props as any).accessibilityLiveRegion).toBe('polite');
  });

  test('container has accessibilityLabel "Event preview"', () => {
    const tree = LivePreviewPanel(makeProps())!;
    const panel = findByTestId(tree, 'live-preview-panel');
    expect((panel!.props as any).accessibilityLabel).toBe('Event preview');
  });

  test('confirmed title field has proper accessibility label', () => {
    const tree = LivePreviewPanel(makeProps())!;
    const titleValue = findByTestId(tree, 'preview-value-title');
    expect((titleValue!.props as any).accessibilityLabel).toBe(
      'Title: Lunch with Sarah',
    );
  });

  test('unresolved date field has proper accessibility label', () => {
    const event = makeParsedEvent({
      date: null,
      confidence: {
        date: false,
        time: true,
        duration: true,
        location: false,
        recurrence: 'none',
      },
    });
    const tree = LivePreviewPanel({ parsedEvent: event })!;
    const dateValue = findByTestId(tree, 'preview-value-date');
    expect((dateValue!.props as any).accessibilityLabel).toBe('Date not set');
  });

  test('confirmed time field has proper accessibility label', () => {
    const tree = LivePreviewPanel(makeProps())!;
    const timeValue = findByTestId(tree, 'preview-value-time');
    expect((timeValue!.props as any).accessibilityLabel).toBe('Time: 12:00 PM');
  });

  test('location field has proper accessibility label when present', () => {
    const event = makeParsedEvent({
      location: 'Cafe Roma',
      confidence: {
        date: true,
        time: true,
        duration: true,
        location: true,
        recurrence: 'none',
      },
    });
    const tree = LivePreviewPanel({ parsedEvent: event })!;
    const locationValue = findByTestId(tree, 'preview-value-location');
    expect((locationValue!.props as any).accessibilityLabel).toBe(
      'Location: Cafe Roma',
    );
  });

  test('attendees field has proper accessibility label when present', () => {
    const event = makeParsedEvent({ attendees: ['Sarah', 'Tom'] });
    const tree = LivePreviewPanel({ parsedEvent: event })!;
    const attendeesValue = findByTestId(tree, 'preview-value-attendees');
    expect((attendeesValue!.props as any).accessibilityLabel).toBe(
      'Attendees: Sarah, Tom',
    );
  });

  // ── Screen reader debounced announcement (Req 18.7) ────────────────────

  test('schedules screen reader announcement via debounced timer', () => {
    jest.useFakeTimers();

    LivePreviewPanel(makeProps());

    // Run effects that trigger announceChanges
    for (const { cb } of effectCallbacks) {
      cb();
    }

    // Before debounce expires, announce should not have been called
    expect(mockAnnounce).not.toHaveBeenCalled();

    // Advance past the 500ms debounce
    jest.advanceTimersByTime(500);

    expect(mockAnnounce).toHaveBeenCalledWith(
      expect.stringContaining('Event preview:'),
      'polite',
    );

    jest.useRealTimers();
  });

  // ── Duration formatting ────────────────────────────────────────────────

  test('formats duration in minutes correctly', () => {
    const event = makeParsedEvent({
      duration: 30,
      confidence: {
        date: true,
        time: true,
        duration: true,
        location: false,
        recurrence: 'none',
      },
    });
    const tree = LivePreviewPanel({ parsedEvent: event })!;
    const durationValue = findByTestId(tree, 'preview-value-duration');
    expect((durationValue!.props as any).children).toBe('30 minutes');
  });

  test('formats multi-hour duration correctly', () => {
    const event = makeParsedEvent({
      duration: 120,
      confidence: {
        date: true,
        time: true,
        duration: true,
        location: false,
        recurrence: 'none',
      },
    });
    const tree = LivePreviewPanel({ parsedEvent: event })!;
    const durationValue = findByTestId(tree, 'preview-value-duration');
    expect((durationValue!.props as any).children).toBe('2 hours');
  });

  test('formats mixed hour+minute duration correctly', () => {
    const event = makeParsedEvent({
      duration: 90,
      confidence: {
        date: true,
        time: true,
        duration: true,
        location: false,
        recurrence: 'none',
      },
    });
    const tree = LivePreviewPanel({ parsedEvent: event })!;
    const durationValue = findByTestId(tree, 'preview-value-duration');
    expect((durationValue!.props as any).children).toBe('1h 30m');
  });

  // ── Always-shown fields are present ────────────────────────────────────

  test('always renders title, date, time, and duration fields', () => {
    const tree = LivePreviewPanel(makeProps())!;
    expect(findByTestId(tree, 'preview-field-title')).not.toBeNull();
    expect(findByTestId(tree, 'preview-field-date')).not.toBeNull();
    expect(findByTestId(tree, 'preview-field-time')).not.toBeNull();
    expect(findByTestId(tree, 'preview-field-duration')).not.toBeNull();
  });
});
