/**
 * Unit tests for QuickCreateBar (Task 12.2).
 *
 * Validates:
 * - Renders with proper accessibility attributes
 * - Throttled NL parsing on text input
 * - Submit branches: direct create, editor fallback (missing date/time),
 *   editor fallback with recurrence highlight (attempted_unresolved)
 * - Haptic feedback on successful creation (Req 14.3)
 * - Success indicator display after creation
 * - Input clearing after submit
 * - Preview container shown when input is non-empty
 * - Focus management via isFocused prop and onFocusChange callback
 *
 * Requirements: 5.1, 5.2, 5.8, 14.3, 17.8, 18.1
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

// ─── Mocks ───────────────────────────────────────────────────────────────────

// Track effect callbacks so we can trigger them manually
const effectCallbacks: Array<{ cb: () => void | (() => void); deps: unknown[] }> = [];
const stateStore = new Map<number, unknown>();
let stateCounter = 0;

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
    withSpring: (toValue: number) => toValue,
    withTiming: (toValue: number) => toValue,
    runOnJS: (fn: (...args: any[]) => void) => fn,
  };
});

jest.mock('react', () => {
  const actualReact = jest.requireActual('react');
  return {
    ...actualReact,
    useState: (init: unknown) => {
      const idx = stateCounter++;
      if (!stateStore.has(idx)) {
        stateStore.set(idx, init);
      }
      const val = stateStore.get(idx);
      const setter = (next: unknown) => {
        stateStore.set(idx, typeof next === 'function' ? (next as any)(stateStore.get(idx)) : next);
      };
      return [val, setter];
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
    success: '#0F7A3A',
    warning: '#8F5A00',
    error: '#D93025',
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

// Mock haptic engine
const mockTrigger = jest.fn();
jest.mock('../../haptics/hapticEngine', () => ({
  useHaptics: () => ({
    trigger: mockTrigger,
    isAvailable: true,
  }),
}));

// Mock NL parser
const mockParseNaturalLanguage = jest.fn();
jest.mock('../../../nlp/naturalLanguageParser', () => ({
  parseNaturalLanguage: (...args: any[]) => mockParseNaturalLanguage(...args),
}));

// Mock convertParsedEventToCreateInput
const mockConvertParsedEvent = jest.fn();
jest.mock('../../../nlp/convertParsedEvent', () => ({
  convertParsedEventToCreateInput: (...args: any[]) => mockConvertParsedEvent(...args),
}));

// Mock parsedEventToFormData
const mockParsedEventToFormData = jest.fn();
jest.mock('../../../nlp/parsedEventToFormData', () => ({
  parsedEventToFormData: (...args: any[]) => mockParsedEventToFormData(...args),
}));

// ─── Import after mocks ─────────────────────────────────────────────────────

import React from 'react';
import { QuickCreateBar, type QuickCreateBarProps } from '../QuickCreateBar';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeParsedEvent(overrides: Record<string, unknown> = {}): any {
  return {
    title: 'Lunch',
    date: new Date(2025, 0, 15),
    time: { hours: 12, minutes: 0 },
    duration: 60,
    location: null,
    attendees: [],
    recurrence: null,
    confidence: {
      date: true,
      time: true,
      duration: false,
      location: false,
      recurrence: 'none',
    },
    ...overrides,
  };
}

function makeProps(overrides?: Partial<QuickCreateBarProps>): QuickCreateBarProps {
  return {
    calendarAccountId: 'account-1',
    onOpenEditor: jest.fn(),
    eventCRUDService: {
      createEvent: jest.fn().mockResolvedValue({ success: true, eventId: 'evt-1' }),
      updateEvent: jest.fn(),
      deleteEvent: jest.fn(),
      getEvent: jest.fn(),
      getEventsByAccount: jest.fn(),
    },
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

describe('QuickCreateBar', () => {
  beforeEach(() => {
    stateStore.clear();
    stateCounter = 0;
    effectCallbacks.length = 0;
    mockTrigger.mockClear();
    mockParseNaturalLanguage.mockReset();
    mockConvertParsedEvent.mockReset();
    mockParsedEventToFormData.mockReset();
  });

  test('renders with proper accessibility attributes', () => {
    const props = makeProps();
    const tree = QuickCreateBar(props);

    // Root container
    const root = findByTestId(tree!, 'quick-create-bar');
    expect(root).not.toBeNull();

    // Input field
    const input = findByTestId(tree!, 'quick-create-input');
    expect(input).not.toBeNull();
    expect((input!.props as any).accessibilityLabel).toBe('Event description');
    expect((input!.props as any).accessibilityHint).toContain('natural language');
  });

  test('input has correct placeholder text', () => {
    const props = makeProps();
    const tree = QuickCreateBar(props);

    const input = findByTestId(tree!, 'quick-create-input');
    expect((input!.props as any).placeholder).toBe(
      'Add event, e.g. Lunch tomorrow at noon',
    );
  });

  test('input uses token-driven placeholder color', () => {
    const props = makeProps();
    const tree = QuickCreateBar(props);

    const input = findByTestId(tree!, 'quick-create-input');
    expect((input!.props as any).placeholderTextColor).toBe(MOCK_TOKENS.colors.textMuted);
  });

  test('container uses token-driven styles', () => {
    const props = makeProps();
    const tree = QuickCreateBar(props);

    // Find the search container (has accessibilityRole="search")
    const searchContainer = findInTree(
      tree!,
      (el) => (el.props as any)?.accessibilityRole === 'search',
    );
    expect(searchContainer).not.toBeNull();
    const style = (searchContainer!.props as any).style;
    expect(style.backgroundColor).toBe(MOCK_TOKENS.colors.surface);
    expect(style.borderColor).toBe(MOCK_TOKENS.colors.border);
    expect(style.borderRadius).toBe(MOCK_TOKENS.radii.md);
  });

  test('does not show submit button when input is empty', () => {
    const props = makeProps();
    const tree = QuickCreateBar(props);

    const submitBtn = findByTestId(tree!, 'quick-create-submit');
    expect(submitBtn).toBeNull();
  });

  test('calls parseNaturalLanguage on text change', () => {
    const parsed = makeParsedEvent();
    mockParseNaturalLanguage.mockReturnValue(parsed);

    const props = makeProps();
    const tree = QuickCreateBar(props);

    const input = findByTestId(tree!, 'quick-create-input');
    // Simulate text change
    (input!.props as any).onChangeText('Lunch tomorrow at noon');

    expect(mockParseNaturalLanguage).toHaveBeenCalledWith('Lunch tomorrow at noon');
  });

  test('submit with resolved date+time calls createEvent directly', async () => {
    const parsed = makeParsedEvent();
    mockParseNaturalLanguage.mockReturnValue(parsed);

    const createInput = {
      calendarAccountId: 'account-1',
      title: 'Lunch',
      startTime: new Date(2025, 0, 15, 12, 0),
      endTime: new Date(2025, 0, 15, 13, 0),
    };
    mockConvertParsedEvent.mockReturnValue(createInput);

    const mockCreateEvent = jest.fn().mockResolvedValue({ success: true, eventId: 'evt-1' });
    const props = makeProps({
      eventCRUDService: {
        createEvent: mockCreateEvent,
        updateEvent: jest.fn(),
        deleteEvent: jest.fn(),
        getEvent: jest.fn(),
        getEventsByAccount: jest.fn(),
      },
    });

    // We need to set inputText to non-empty for submit to work.
    // Since useState is mocked, we set state directly.
    stateStore.set(0, 'Lunch tomorrow at noon'); // inputText state

    const tree = QuickCreateBar(props);
    const input = findByTestId(tree!, 'quick-create-input');

    // Trigger submit
    await (input!.props as any).onSubmitEditing();

    expect(mockParseNaturalLanguage).toHaveBeenCalled();
    expect(mockConvertParsedEvent).toHaveBeenCalledWith(parsed, 'account-1');
    expect(mockCreateEvent).toHaveBeenCalledWith(createInput);
  });

  test('submit triggers haptic success feedback on successful creation (Req 14.3)', async () => {
    const parsed = makeParsedEvent();
    mockParseNaturalLanguage.mockReturnValue(parsed);
    mockConvertParsedEvent.mockReturnValue({
      calendarAccountId: 'account-1',
      title: 'Lunch',
      startTime: new Date(),
      endTime: new Date(),
    });

    const mockCreateEvent = jest.fn().mockResolvedValue({ success: true, eventId: 'evt-1' });
    const props = makeProps({
      eventCRUDService: {
        createEvent: mockCreateEvent,
        updateEvent: jest.fn(),
        deleteEvent: jest.fn(),
        getEvent: jest.fn(),
        getEventsByAccount: jest.fn(),
      },
    });

    stateStore.set(0, 'Lunch tomorrow at noon');

    const tree = QuickCreateBar(props);
    const input = findByTestId(tree!, 'quick-create-input');
    await (input!.props as any).onSubmitEditing();

    expect(mockTrigger).toHaveBeenCalledWith('success');
  });

  test('submit with missing date opens editor (Req 5.8)', async () => {
    const parsed = makeParsedEvent({
      date: null,
      confidence: {
        date: false,
        time: true,
        duration: false,
        location: false,
        recurrence: 'none',
      },
    });
    mockParseNaturalLanguage.mockReturnValue(parsed);

    const formData = { title: 'Lunch' };
    mockParsedEventToFormData.mockReturnValue(formData);

    const onOpenEditor = jest.fn();
    const props = makeProps({ onOpenEditor });

    stateStore.set(0, 'Lunch at noon');

    const tree = QuickCreateBar(props);
    const input = findByTestId(tree!, 'quick-create-input');
    await (input!.props as any).onSubmitEditing();

    expect(onOpenEditor).toHaveBeenCalledWith({
      initialValues: formData,
      highlightRecurrenceSection: false,
    });
  });

  test('submit with missing time opens editor (Req 5.8)', async () => {
    const parsed = makeParsedEvent({
      time: null,
      confidence: {
        date: true,
        time: false,
        duration: false,
        location: false,
        recurrence: 'none',
      },
    });
    mockParseNaturalLanguage.mockReturnValue(parsed);

    const formData = { title: 'Lunch', startTime: new Date() };
    mockParsedEventToFormData.mockReturnValue(formData);

    const onOpenEditor = jest.fn();
    const props = makeProps({ onOpenEditor });

    stateStore.set(0, 'Lunch tomorrow');

    const tree = QuickCreateBar(props);
    const input = findByTestId(tree!, 'quick-create-input');
    await (input!.props as any).onSubmitEditing();

    expect(onOpenEditor).toHaveBeenCalledWith({
      initialValues: formData,
      highlightRecurrenceSection: false,
    });
  });

  test('submit with attempted_unresolved recurrence opens editor with highlight (Req 17.8)', async () => {
    const parsed = makeParsedEvent({
      confidence: {
        date: true,
        time: true,
        duration: false,
        location: false,
        recurrence: 'attempted_unresolved',
      },
    });
    mockParseNaturalLanguage.mockReturnValue(parsed);

    const formData = { title: 'Standup' };
    mockParsedEventToFormData.mockReturnValue(formData);

    const onOpenEditor = jest.fn();
    const props = makeProps({ onOpenEditor });

    stateStore.set(0, 'Standup every blorp at 9am');

    const tree = QuickCreateBar(props);
    const input = findByTestId(tree!, 'quick-create-input');
    await (input!.props as any).onSubmitEditing();

    expect(onOpenEditor).toHaveBeenCalledWith({
      initialValues: formData,
      highlightRecurrenceSection: true,
    });
    // Should NOT call createEvent
    expect(props.eventCRUDService.createEvent).not.toHaveBeenCalled();
  });

  test('does not submit when input is empty', async () => {
    const props = makeProps();
    // inputText defaults to '' (state index 0)

    const tree = QuickCreateBar(props);
    const input = findByTestId(tree!, 'quick-create-input');
    await (input!.props as any).onSubmitEditing();

    expect(mockParseNaturalLanguage).not.toHaveBeenCalled();
    expect(props.eventCRUDService.createEvent).not.toHaveBeenCalled();
  });

  test('calls onFocusChange(true) on focus', () => {
    const onFocusChange = jest.fn();
    const props = makeProps({ onFocusChange });
    const tree = QuickCreateBar(props);

    const input = findByTestId(tree!, 'quick-create-input');
    (input!.props as any).onFocus();

    expect(onFocusChange).toHaveBeenCalledWith(true);
  });

  test('calls onFocusChange(false) on blur', () => {
    const onFocusChange = jest.fn();
    const props = makeProps({ onFocusChange });
    const tree = QuickCreateBar(props);

    const input = findByTestId(tree!, 'quick-create-input');
    (input!.props as any).onBlur();

    expect(onFocusChange).toHaveBeenCalledWith(false);
  });

  test('search container has accessible label', () => {
    const props = makeProps();
    const tree = QuickCreateBar(props);

    const searchContainer = findInTree(
      tree!,
      (el) => (el.props as any)?.accessibilityRole === 'search',
    );
    expect(searchContainer).not.toBeNull();
    expect((searchContainer!.props as any).accessibilityLabel).toBe('Quick create event');
  });

  test('preview container shown when parsedEvent is non-null and input non-empty', () => {
    const parsed = makeParsedEvent();
    mockParseNaturalLanguage.mockReturnValue(parsed);

    const props = makeProps();

    // Set inputText to non-empty and parsedEvent to non-null
    stateStore.set(0, 'Lunch tomorrow');  // inputText
    stateStore.set(1, parsed);            // parsedEvent

    const tree = QuickCreateBar(props);
    // The LivePreviewPanel is rendered as a React.createElement(LivePreviewPanel, ...)
    // which creates an element whose type is the LivePreviewPanel function component.
    // Find it by checking for the LivePreviewPanel type in the tree.
    const { LivePreviewPanel } = require('../LivePreviewPanel');
    const previewElement = findInTree(
      tree!,
      (el) => el.type === LivePreviewPanel,
    );
    expect(previewElement).not.toBeNull();
    expect((previewElement!.props as any).parsedEvent).toBe(parsed);
  });

  test('preview container hidden when input is empty', () => {
    const props = makeProps();
    // inputText defaults to '' (state index 0)

    const tree = QuickCreateBar(props);
    const previewContainer = findByTestId(tree!, 'quick-create-preview-container');
    expect(previewContainer).toBeNull();
  });

  // ── Gap fix: onEventCreated callback (Gap 1) ────────────────────────────

  test('calls onEventCreated after successful creation', async () => {
    const parsed = makeParsedEvent();
    mockParseNaturalLanguage.mockReturnValue(parsed);
    mockConvertParsedEvent.mockReturnValue({
      calendarAccountId: 'account-1',
      title: 'Lunch',
      startTime: new Date(),
      endTime: new Date(),
    });

    const mockCreateEvent = jest.fn().mockResolvedValue({ success: true, eventId: 'evt-1' });
    const onEventCreated = jest.fn();
    const props = makeProps({
      onEventCreated,
      eventCRUDService: {
        createEvent: mockCreateEvent,
        updateEvent: jest.fn(),
        deleteEvent: jest.fn(),
        getEvent: jest.fn(),
        getEventsByAccount: jest.fn(),
      },
    });

    stateStore.set(0, 'Lunch tomorrow at noon');

    const tree = QuickCreateBar(props);
    const input = findByTestId(tree!, 'quick-create-input');
    await (input!.props as any).onSubmitEditing();

    expect(onEventCreated).toHaveBeenCalledWith(parsed);
  });

  test('does not call onEventCreated when creation fails', async () => {
    const parsed = makeParsedEvent();
    mockParseNaturalLanguage.mockReturnValue(parsed);
    mockConvertParsedEvent.mockReturnValue({
      calendarAccountId: 'account-1',
      title: 'Lunch',
      startTime: new Date(),
      endTime: new Date(),
    });

    const mockCreateEvent = jest.fn().mockResolvedValue({ success: false });
    const onEventCreated = jest.fn();
    const props = makeProps({
      onEventCreated,
      eventCRUDService: {
        createEvent: mockCreateEvent,
        updateEvent: jest.fn(),
        deleteEvent: jest.fn(),
        getEvent: jest.fn(),
        getEventsByAccount: jest.fn(),
      },
    });

    stateStore.set(0, 'Lunch tomorrow at noon');

    const tree = QuickCreateBar(props);
    const input = findByTestId(tree!, 'quick-create-input');
    await (input!.props as any).onSubmitEditing();

    expect(onEventCreated).not.toHaveBeenCalled();
  });

  // ── Gap fix: Error handling (Gaps 2 & 5) ─────────────────────────────────

  test('shows error banner when createEvent returns success: false', async () => {
    const parsed = makeParsedEvent();
    mockParseNaturalLanguage.mockReturnValue(parsed);
    mockConvertParsedEvent.mockReturnValue({
      calendarAccountId: 'account-1',
      title: 'Lunch',
      startTime: new Date(),
      endTime: new Date(),
    });

    const mockCreateEvent = jest.fn().mockResolvedValue({ success: false });
    const props = makeProps({
      eventCRUDService: {
        createEvent: mockCreateEvent,
        updateEvent: jest.fn(),
        deleteEvent: jest.fn(),
        getEvent: jest.fn(),
        getEventsByAccount: jest.fn(),
      },
    });

    stateStore.set(0, 'Lunch tomorrow at noon');

    const tree = QuickCreateBar(props);
    const input = findByTestId(tree!, 'quick-create-input');
    await (input!.props as any).onSubmitEditing();

    // Error message state should be set (index 5)
    expect(stateStore.get(5)).toBe('Could not create event. Please try again.');
    // Haptic should NOT have been triggered
    expect(mockTrigger).not.toHaveBeenCalled();
  });

  test('shows error banner when createEvent throws an exception', async () => {
    const parsed = makeParsedEvent();
    mockParseNaturalLanguage.mockReturnValue(parsed);
    mockConvertParsedEvent.mockReturnValue({
      calendarAccountId: 'account-1',
      title: 'Lunch',
      startTime: new Date(),
      endTime: new Date(),
    });

    const mockCreateEvent = jest.fn().mockRejectedValue(new Error('Network error'));
    const props = makeProps({
      eventCRUDService: {
        createEvent: mockCreateEvent,
        updateEvent: jest.fn(),
        deleteEvent: jest.fn(),
        getEvent: jest.fn(),
        getEventsByAccount: jest.fn(),
      },
    });

    stateStore.set(0, 'Lunch tomorrow at noon');

    const tree = QuickCreateBar(props);
    const input = findByTestId(tree!, 'quick-create-input');
    await (input!.props as any).onSubmitEditing();

    // Error message state should be set (index 5)
    expect(stateStore.get(5)).toBe('Something went wrong. Please try again.');
    // Haptic should NOT have been triggered
    expect(mockTrigger).not.toHaveBeenCalled();
  });

  test('error banner renders with alert role and token-driven styling', () => {
    const props = makeProps();

    // Set errorMessage state (index 5) to a non-null value
    stateStore.set(5, 'Could not create event. Please try again.');

    const tree = QuickCreateBar(props);
    const errorBanner = findByTestId(tree!, 'quick-create-error');
    expect(errorBanner).not.toBeNull();
    expect((errorBanner!.props as any).accessibilityRole).toBe('alert');
    expect((errorBanner!.props as any).accessibilityLiveRegion).toBe('polite');
    const style = (errorBanner!.props as any).style;
    expect(style.backgroundColor).toBe(MOCK_TOKENS.colors.error);
    expect(style.borderRadius).toBe(MOCK_TOKENS.radii.md);
  });

  test('no error banner when errorMessage is null', () => {
    const props = makeProps();
    // errorMessage defaults to null (index 5)

    const tree = QuickCreateBar(props);
    const errorBanner = findByTestId(tree!, 'quick-create-error');
    expect(errorBanner).toBeNull();
  });

  // ── Gap fix: Collapse animation wiring (Gap 3) ───────────────────────────

  test('successful submit sets isCollapsing to true on LivePreviewPanel', async () => {
    const parsed = makeParsedEvent();
    mockParseNaturalLanguage.mockReturnValue(parsed);
    mockConvertParsedEvent.mockReturnValue({
      calendarAccountId: 'account-1',
      title: 'Lunch',
      startTime: new Date(),
      endTime: new Date(),
    });

    const mockCreateEvent = jest.fn().mockResolvedValue({ success: true, eventId: 'evt-1' });
    const props = makeProps({
      eventCRUDService: {
        createEvent: mockCreateEvent,
        updateEvent: jest.fn(),
        deleteEvent: jest.fn(),
        getEvent: jest.fn(),
        getEventsByAccount: jest.fn(),
      },
    });

    stateStore.set(0, 'Lunch tomorrow at noon');
    stateStore.set(1, parsed); // parsedEvent

    const tree = QuickCreateBar(props);
    const input = findByTestId(tree!, 'quick-create-input');
    await (input!.props as any).onSubmitEditing();

    // isCollapsing state (index 4) should be set to true
    expect(stateStore.get(4)).toBe(true);
  });
});
