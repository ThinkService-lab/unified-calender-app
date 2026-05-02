/**
 * QuickCreateBar — Persistent natural language input bar for rapid event creation.
 *
 * Displayed at the top of Day_View, Week_View, and Agenda_View.
 * Parses input via NL_Parser on each keystroke (throttled at 100ms intervals).
 * Shows Live_Preview_Panel below when input is non-empty (preview component
 * created separately in task 12.3).
 *
 * On submit, branches based on parse confidence:
 * - date+time resolved & recurrence not unresolved → direct create via EventCRUDService
 * - date or time missing (Req 5.8) → open EventEditor with parsed fields
 * - recurrence attempted but unresolved (Req 17.8) → open EventEditor with
 *   recurrence section highlighted
 *
 * Uses `React.createElement` instead of JSX to match the project's
 * tsconfig setting.
 *
 * Requirements: 5.1, 5.2, 5.8, 14.3, 17.8, 18.1
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  TextInput,
  TouchableOpacity,
  Text,
  Platform,
} from 'react-native';
import type { ViewStyle, TextStyle } from 'react-native';
import { useTokens } from '../tokens/designTokens';
import { useAnimation } from '../animation/animationEngine';
import { useHaptics } from '../haptics/hapticEngine';
import { parseNaturalLanguage } from '../../nlp/naturalLanguageParser';
import type { ParsedEvent } from '../../nlp/naturalLanguageParser';
import { convertParsedEventToCreateInput } from '../../nlp/convertParsedEvent';
import { parsedEventToFormData } from '../../nlp/parsedEventToFormData';
import type { EventFormData } from '../editor/eventEditorViewModel';
import type { EventCRUDService } from '../../events/eventCRUDService';
import { LivePreviewPanel } from './LivePreviewPanel';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface QuickCreateBarProps {
  /** The calendar account ID to create events for */
  calendarAccountId: string;
  /** Called when the editor should be opened with pre-populated fields */
  onOpenEditor: (options: {
    initialValues: Partial<EventFormData>;
    highlightRecurrenceSection: boolean;
  }) => void;
  /** Called after an event is successfully created via direct NL parse */
  onEventCreated?: (parsedEvent: ParsedEvent) => void;
  /** Whether the bar is focused (for keyboard shortcut integration) */
  isFocused?: boolean;
  /** Called when focus state changes (for keyboard shortcut suppression) */
  onFocusChange?: (focused: boolean) => void;
  /** EventCRUDService instance for direct event creation */
  eventCRUDService: EventCRUDService;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Throttle interval for NL parsing (ms) — Req 18.1 */
const PARSE_THROTTLE_MS = 100;

/** Duration to show the success indicator (ms) */
const SUCCESS_INDICATOR_MS = 1500;

/** Duration to show the error banner (ms) */
const ERROR_BANNER_MS = 3000;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function QuickCreateBar({
  calendarAccountId,
  onOpenEditor,
  onEventCreated,
  isFocused,
  onFocusChange,
  eventCRUDService,
}: QuickCreateBarProps): React.ReactElement {
  const tokens = useTokens();
  const { shouldAnimate } = useAnimation();
  const haptics = useHaptics();

  // ── State ────────────────────────────────────────────────────────────────
  const [inputText, setInputText] = useState('');
  const [parsedEvent, setParsedEvent] = useState<ParsedEvent | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [isCollapsing, setIsCollapsing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // ── Refs ─────────────────────────────────────────────────────────────────
  const inputRef = useRef<TextInput>(null);
  const lastParseTimeRef = useRef<number>(0);
  const throttleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Holds the last successfully parsed event during collapse animation */
  const collapsingParsedEventRef = useRef<ParsedEvent | null>(null);

  // ── Cleanup timers on unmount ────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (throttleTimerRef.current) clearTimeout(throttleTimerRef.current);
      if (successTimerRef.current) clearTimeout(successTimerRef.current);
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    };
  }, []);

  // ── Focus management via isFocused prop ──────────────────────────────────
  useEffect(() => {
    if (isFocused && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isFocused]);

  // ── Throttled NL parsing ─────────────────────────────────────────────────
  const parseInput = useCallback((text: string) => {
    if (text.trim().length === 0) {
      setParsedEvent(null);
      return;
    }

    const now = Date.now();
    const elapsed = now - lastParseTimeRef.current;

    if (elapsed >= PARSE_THROTTLE_MS) {
      lastParseTimeRef.current = now;
      const result = parseNaturalLanguage(text);
      setParsedEvent(result);
    } else {
      if (throttleTimerRef.current) clearTimeout(throttleTimerRef.current);
      throttleTimerRef.current = setTimeout(() => {
        lastParseTimeRef.current = Date.now();
        const result = parseNaturalLanguage(text);
        setParsedEvent(result);
      }, PARSE_THROTTLE_MS - elapsed);
    }
  }, []);

  // ── Text change handler ──────────────────────────────────────────────────
  const handleChangeText = useCallback(
    (text: string) => {
      setInputText(text);
      setShowSuccess(false);
      parseInput(text);
    },
    [parseInput],
  );

  // ── Show brief success indicator ─────────────────────────────────────────
  const showSuccessIndicator = useCallback(() => {
    setShowSuccess(true);
    if (successTimerRef.current) clearTimeout(successTimerRef.current);
    successTimerRef.current = setTimeout(() => {
      setShowSuccess(false);
    }, SUCCESS_INDICATOR_MS);
  }, []);

  // ── Collapse complete handler (Req 18.6) ─────────────────────────────────
  const handleCollapseComplete = useCallback(() => {
    setIsCollapsing(false);
    collapsingParsedEventRef.current = null;
    setParsedEvent(null);
  }, []);

  // ── Show transient error banner ──────────────────────────────────────────
  const showError = useCallback((msg: string) => {
    setErrorMessage(msg);
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    errorTimerRef.current = setTimeout(() => {
      setErrorMessage(null);
    }, ERROR_BANNER_MS);
  }, []);

  // ── Submit handler ───────────────────────────────────────────────────────
  const handleSubmit = useCallback(async () => {
    const trimmed = inputText.trim();
    if (trimmed.length === 0 || isSubmitting) return;

    // Parse one final time to ensure we have the latest result
    const finalParsed = parseNaturalLanguage(trimmed);

    // Branch based on confidence (Req 5.8, 17.8):
    //
    // 1. Recurrence attempted but unresolved → editor with recurrence highlighted
    if (finalParsed.confidence.recurrence === 'attempted_unresolved') {
      const formData = parsedEventToFormData(finalParsed);
      onOpenEditor({
        initialValues: formData,
        highlightRecurrenceSection: true,
      });
      setInputText('');
      setParsedEvent(null);
      return;
    }

    // 2. Date or time missing → editor with parsed fields
    if (!finalParsed.confidence.date || !finalParsed.confidence.time) {
      const formData = parsedEventToFormData(finalParsed);
      onOpenEditor({
        initialValues: formData,
        highlightRecurrenceSection: false,
      });
      setInputText('');
      setParsedEvent(null);
      return;
    }

    // 3. All required fields resolved → direct create
    const createInput = convertParsedEventToCreateInput(
      finalParsed,
      calendarAccountId,
    );

    if (!createInput) {
      // Fallback: shouldn't happen given confidence checks, but be safe
      const formData = parsedEventToFormData(finalParsed);
      onOpenEditor({
        initialValues: formData,
        highlightRecurrenceSection: false,
      });
      setInputText('');
      setParsedEvent(null);
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await eventCRUDService.createEvent(createInput);
      if (result.success) {
        // Haptic feedback on successful creation (Req 14.3)
        haptics.trigger('success');

        // Notify parent so it can react (e.g., scroll to new event)
        onEventCreated?.(finalParsed);

        // Clear input
        setInputText('');

        // Trigger collapse animation on the LivePreviewPanel (Req 18.6)
        // Keep parsedEvent alive during collapse so the panel can animate
        collapsingParsedEventRef.current = parsedEvent;
        setIsCollapsing(true);

        // Show brief success indicator
        showSuccessIndicator();
      } else {
        // Creation returned failure — show error feedback
        showError('Could not create event. Please try again.');
      }
    } catch (_err) {
      // Network error, SQLite error, etc. — show error feedback
      showError('Something went wrong. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }, [
    inputText,
    isSubmitting,
    calendarAccountId,
    eventCRUDService,
    haptics,
    onOpenEditor,
    onEventCreated,
    parsedEvent,
    showSuccessIndicator,
    showError,
  ]);

  // ── Focus callbacks ──────────────────────────────────────────────────────
  const handleFocus = useCallback(() => {
    onFocusChange?.(true);
  }, [onFocusChange]);

  const handleBlur = useCallback(() => {
    onFocusChange?.(false);
  }, [onFocusChange]);

  // ── Styles (token-driven) ────────────────────────────────────────────────
  const containerStyle: ViewStyle = {
    backgroundColor: tokens.colors.surface,
    borderWidth: 1,
    borderColor: tokens.colors.border,
    borderRadius: tokens.radii.md,
    paddingHorizontal: tokens.spacing.md,
    paddingVertical: tokens.spacing.sm,
    marginHorizontal: tokens.spacing.lg,
    marginTop: tokens.spacing.sm,
    marginBottom: tokens.spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    ...tokens.shadows.sm,
  };

  const inputStyle: TextStyle = {
    flex: 1,
    fontSize: tokens.typography.sizes.body,
    lineHeight: tokens.typography.lineHeights.body,
    fontFamily: tokens.typography.fontFamily.primary,
    fontWeight: tokens.typography.weights.regular,
    color: tokens.colors.textPrimary,
    paddingVertical: Platform.OS === 'web' ? tokens.spacing.xs : 0,
  };

  const submitButtonStyle: ViewStyle = {
    backgroundColor: tokens.colors.primary,
    borderRadius: tokens.radii.sm,
    paddingHorizontal: tokens.spacing.md,
    paddingVertical: tokens.spacing.xs,
    marginLeft: tokens.spacing.sm,
    opacity: inputText.trim().length === 0 || isSubmitting ? 0.5 : 1,
  };

  const submitTextStyle: TextStyle = {
    color: tokens.colors.textOnPrimary,
    fontSize: tokens.typography.sizes.body,
    fontWeight: tokens.typography.weights.semibold,
    fontFamily: tokens.typography.fontFamily.primary,
  };

  const successIndicatorStyle: TextStyle = {
    marginLeft: tokens.spacing.sm,
    color: tokens.colors.success,
    fontSize: tokens.typography.sizes.subheading,
    fontWeight: tokens.typography.weights.bold,
  };

  const hasInput = inputText.trim().length > 0;

  // ── Build children for the input row ─────────────────────────────────────
  const inputRowChildren: React.ReactElement[] = [
    // Text input
    React.createElement(TextInput, {
      key: 'input',
      ref: inputRef,
      style: inputStyle,
      value: inputText,
      onChangeText: handleChangeText,
      onSubmitEditing: handleSubmit,
      onFocus: handleFocus,
      onBlur: handleBlur,
      placeholder: 'Add event, e.g. Lunch tomorrow at noon',
      placeholderTextColor: tokens.colors.textMuted,
      returnKeyType: 'done',
      editable: !isSubmitting,
      accessibilityLabel: 'Event description',
      accessibilityHint:
        'Type a natural language event description and press enter to create',
      testID: 'quick-create-input',
    }),
  ];

  // Success indicator
  if (showSuccess) {
    inputRowChildren.push(
      React.createElement(
        Text,
        {
          key: 'success',
          style: successIndicatorStyle,
          accessibilityLabel: 'Event created successfully',
          testID: 'quick-create-success',
        },
        '✓',
      ),
    );
  }

  // Submit button (shown when input is non-empty and not showing success)
  if (hasInput && !showSuccess) {
    inputRowChildren.push(
      React.createElement(
        TouchableOpacity,
        {
          key: 'submit',
          style: submitButtonStyle,
          onPress: handleSubmit,
          disabled: isSubmitting || !hasInput,
          accessibilityRole: 'button',
          accessibilityLabel: 'Create event',
          accessibilityState: { disabled: isSubmitting || !hasInput },
          testID: 'quick-create-submit',
        },
        React.createElement(
          Text,
          { style: submitTextStyle },
          isSubmitting ? '…' : 'Create',
        ),
      ),
    );
  }

  // ── Build top-level children ─────────────────────────────────────────────
  const rootChildren: React.ReactElement[] = [
    // Input row container
    React.createElement(
      View,
      {
        key: 'input-row',
        style: containerStyle,
        accessibilityRole: 'search',
        accessibilityLabel: 'Quick create event',
      },
      ...inputRowChildren,
    ),
  ];

  // Live Preview Panel — rendered when input is non-empty OR collapsing.
  // During collapse, we use the ref'd parsedEvent so the panel can animate
  // out before being unmounted (Req 18.6).
  const previewEvent = isCollapsing
    ? collapsingParsedEventRef.current
    : parsedEvent;

  if ((hasInput || isCollapsing) && previewEvent != null) {
    rootChildren.push(
      React.createElement(LivePreviewPanel, {
        key: 'preview',
        parsedEvent: previewEvent,
        isCollapsing,
        onCollapseComplete: handleCollapseComplete,
      }),
    );
  }

  // Error banner — shown transiently on creation failure
  if (errorMessage != null) {
    rootChildren.push(
      React.createElement(
        View,
        {
          key: 'error',
          style: {
            backgroundColor: tokens.colors.error,
            borderRadius: tokens.radii.md,
            paddingVertical: tokens.spacing.sm,
            paddingHorizontal: tokens.spacing.md,
            marginHorizontal: tokens.spacing.lg,
            marginBottom: tokens.spacing.sm,
          } as ViewStyle,
          accessibilityRole: 'alert',
          accessibilityLiveRegion: 'polite',
          testID: 'quick-create-error',
        },
        React.createElement(
          Text,
          {
            style: {
              color: tokens.colors.textOnPrimary,
              fontSize: tokens.typography.sizes.body,
              fontFamily: tokens.typography.fontFamily.primary,
              fontWeight: tokens.typography.weights.medium,
            } as TextStyle,
          },
          errorMessage,
        ),
      ),
    );
  }

  return React.createElement(
    View,
    { testID: 'quick-create-bar' },
    ...rootChildren,
  );
}
