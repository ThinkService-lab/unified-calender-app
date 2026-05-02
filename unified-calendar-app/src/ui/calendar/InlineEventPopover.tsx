/**
 * InlineEventPopover — compact popover displayed at the selected time range
 * after a click-to-create or click-drag-to-select gesture in Day_View or
 * Week_View.
 *
 * Contains a single text input for the event title (auto-focused on mount),
 * a formatted start–end time range subtitle, and a confirm button.
 *
 * Keyboard: Enter → submit, Escape → dismiss.
 * Click outside → dismiss.
 * Default title "New Event" if empty on submit.
 *
 * Entrance animation: fade-in + slide-down from 4px above (150ms).
 * Exit animation: fade-out (100ms).
 * Reduced motion: instant show/hide.
 *
 * Accessibility: role="dialog", aria-label="Create event", focus trap.
 *
 * Uses `React.createElement` instead of JSX to match the project's
 * `jsx: "react-native"` tsconfig setting.
 *
 * Requirements: 12.4, 12.5, 12.6
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  TextInput,
  Text,
  Pressable,
  StyleSheet,
  Platform,
} from 'react-native';
import type { ViewStyle, TextStyle } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  runOnJS,
} from 'react-native-reanimated';

import { useTokens } from '../tokens/designTokens';
import { useReducedMotion, useFocusTrap } from '../accessibility/useAccessibility';
import { formatTime } from './calendarViewModel';

// Import the English locale directly for compile-time string resolution.
// When a global i18n context is wired (Task 18), this can be replaced
// with a runtime `i18nService.t('event.create')` call.
import en from '../../i18n/locales/en';

// ─── Public types ────────────────────────────────────────────────────────────

export interface InlineEventPopoverProps {
  /** Start time of the selected range. */
  startTime: Date;
  /** End time of the selected range. */
  endTime: Date;
  /** Pixel position for popover placement (relative to the time grid container). */
  position: { x: number; y: number };
  /** Callback when the user submits the title (Enter key or confirm button). */
  onSubmit: (title: string) => void;
  /** Callback when the user dismisses the popover (Escape key or click outside). */
  onDismiss: () => void;
}

// ─── Constants ───────────────────────────────────────────────────────────────

/** Entrance animation duration (ms). */
const ENTRANCE_DURATION_MS = 150;
/** Exit animation duration (ms). */
const EXIT_DURATION_MS = 100;
/** Vertical offset for the slide-down entrance (px). */
const SLIDE_OFFSET = 4;
/**
 * Default title used when the user submits with an empty input.
 * Sourced from the English locale's 'event.create' key so the string
 * has a single source of truth. When a global i18n context is wired
 * (Task 18), replace this with a runtime `i18nService.t('event.create')` call.
 */
const DEFAULT_TITLE = en['event.create']; // "New Event"
/** Popover width (px). */
const POPOVER_WIDTH = 220;

// ─── Component ───────────────────────────────────────────────────────────────

export function InlineEventPopover({
  startTime,
  endTime,
  position,
  onSubmit,
  onDismiss,
}: InlineEventPopoverProps): React.ReactElement | null {
  const tokens = useTokens();
  const reducedMotion = useReducedMotion();

  // ── Local state ─────────────────────────────────────────────────────────
  const [title, setTitle] = useState('');

  // ── Refs ────────────────────────────────────────────────────────────────
  const inputRef = useRef<TextInput>(null);
  const containerRef = useRef<View>(null);

  // ── Animation shared values ─────────────────────────────────────────────
  const opacity = useSharedValue(reducedMotion ? 1 : 0);
  const translateY = useSharedValue(reducedMotion ? 0 : -SLIDE_OFFSET);

  // ── Focus trap (web) ────────────────────────────────────────────────────
  useFocusTrap(containerRef as React.RefObject<HTMLElement | null>, true);

  // ── Entrance animation on mount ─────────────────────────────────────────
  useEffect(() => {
    if (reducedMotion) {
      opacity.value = 1;
      translateY.value = 0;
    } else {
      opacity.value = withTiming(1, { duration: ENTRANCE_DURATION_MS });
      translateY.value = withTiming(0, { duration: ENTRANCE_DURATION_MS });
    }
  }, [opacity, translateY, reducedMotion]);

  // ── Auto-focus title input on mount ─────────────────────────────────────
  useEffect(() => {
    // Small delay to ensure the input is mounted before focusing.
    const timer = setTimeout(() => {
      inputRef.current?.focus();
    }, 50);
    return () => clearTimeout(timer);
  }, []);

  // ── Animated style ──────────────────────────────────────────────────────
  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  // ── Exit animation helper ───────────────────────────────────────────────
  const runExit = useCallback(
    (callback: () => void) => {
      if (reducedMotion) {
        callback();
        return;
      }
      opacity.value = withTiming(0, { duration: EXIT_DURATION_MS }, () => {
        runOnJS(callback)();
      });
    },
    [opacity, reducedMotion],
  );

  // ── Handlers ────────────────────────────────────────────────────────────
  const handleSubmit = useCallback(() => {
    const trimmed = title.trim();
    // Default title "New Event" if empty on submit (Req 12.5, design doc).
    const finalTitle = trimmed.length > 0 ? trimmed : DEFAULT_TITLE;
    runExit(() => onSubmit(finalTitle));
  }, [title, onSubmit, runExit]);

  const handleDismiss = useCallback(() => {
    runExit(() => onDismiss());
  }, [onDismiss, runExit]);

  // ── Keyboard handler (web) ──────────────────────────────────────────────
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        handleDismiss();
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [handleDismiss]);

  // ── Click-outside handler (web) ─────────────────────────────────────────
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;

    const handleClickOutside = (e: MouseEvent) => {
      const container = containerRef.current as unknown as HTMLElement | null;
      if (container && !container.contains(e.target as Node)) {
        handleDismiss();
      }
    };

    // Use a small delay so the mount click doesn't immediately dismiss.
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 0);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [handleDismiss]);

  // ── Formatted time range ────────────────────────────────────────────────
  const timeRangeText = `${formatTime(startTime)} – ${formatTime(endTime)}`;

  // ── Styles (token-driven) ───────────────────────────────────────────────
  const containerStyle: ViewStyle = {
    ...styles.container,
    left: position.x,
    top: position.y,
    width: POPOVER_WIDTH,
    backgroundColor: tokens.colors.surface,
    borderColor: tokens.colors.border,
    borderRadius: tokens.radii.md,
    ...tokens.shadows.md,
    paddingHorizontal: tokens.spacing.sm,
    paddingVertical: tokens.spacing.xs,
  };

  const inputStyle: TextStyle = {
    ...styles.input,
    fontSize: tokens.typography.sizes.body,
    lineHeight: tokens.typography.lineHeights.body,
    color: tokens.colors.textPrimary,
    fontFamily: tokens.typography.fontFamily.primary,
  };

  const timeRangeStyle: TextStyle = {
    ...styles.timeRange,
    fontSize: tokens.typography.sizes.caption,
    lineHeight: tokens.typography.lineHeights.caption,
    color: tokens.colors.textSecondary,
    fontFamily: tokens.typography.fontFamily.primary,
  };

  const confirmButtonStyle: ViewStyle = {
    ...styles.confirmButton,
    backgroundColor: tokens.colors.primary,
    borderRadius: tokens.radii.sm,
  };

  const confirmTextStyle: TextStyle = {
    ...styles.confirmText,
    color: tokens.colors.textOnPrimary,
    fontSize: tokens.typography.sizes.body,
    fontWeight: tokens.typography.weights.semibold,
    fontFamily: tokens.typography.fontFamily.primary,
  };

  // ── Render ──────────────────────────────────────────────────────────────

  return React.createElement(
    Animated.View,
    {
      ref: containerRef,
      style: [containerStyle, animatedStyle],
      testID: 'inline-event-popover',
      // Accessibility: dialog role with label
      accessible: true,
      accessibilityRole: 'none',
      accessibilityLabel: 'Create event',
      // Web ARIA attributes
      ...(Platform.OS === 'web'
        ? {
            role: 'dialog' as any,
            'aria-label': 'Create event',
            'aria-modal': true,
          }
        : {}),
    },
    // Time range subtitle
    React.createElement(Text, {
      style: timeRangeStyle,
      testID: 'inline-event-popover-time-range',
      accessible: true,
      accessibilityLabel: `Time: ${timeRangeText}`,
    }, timeRangeText),

    // Row: title input + confirm button
    React.createElement(
      View,
      { style: styles.inputRow },
      // Title input
      React.createElement(TextInput, {
        ref: inputRef,
        style: inputStyle,
        value: title,
        onChangeText: setTitle,
        placeholder: DEFAULT_TITLE,
        placeholderTextColor: tokens.colors.textMuted,
        onSubmitEditing: handleSubmit,
        returnKeyType: 'done',
        autoFocus: true,
        testID: 'inline-event-popover-title-input',
        accessible: true,
        accessibilityLabel: 'Event title',
        ...(Platform.OS === 'web'
          ? { 'aria-label': 'Event title' as any }
          : {}),
      }),
      // Confirm button (checkmark)
      React.createElement(
        Pressable,
        {
          onPress: handleSubmit,
          style: confirmButtonStyle,
          testID: 'inline-event-popover-confirm',
          accessible: true,
          accessibilityRole: 'button',
          accessibilityLabel: 'Create event',
        },
        React.createElement(Text, {
          style: confirmTextStyle,
        }, '✓'),
      ),
    ),
  );
}

// ─── Static styles ───────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    zIndex: 100,
    borderWidth: 1,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  input: {
    flex: 1,
    borderWidth: 0,
    padding: 0,
    margin: 0,
    // Borderless input style per design doc
    backgroundColor: 'transparent',
  },
  timeRange: {
    marginBottom: 2,
  },
  confirmButton: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 4,
  },
  confirmText: {
    textAlign: 'center',
  },
});

export default InlineEventPopover;
