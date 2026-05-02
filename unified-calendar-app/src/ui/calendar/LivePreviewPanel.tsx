/**
 * LivePreviewPanel — Real-time preview of parsed fields below the Quick Create Bar.
 *
 * Displays confirmed fields (solid text, primary color) and unresolved fields
 * (placeholder text, muted color) as the user types. Collapses with a
 * fade-out + height-shrink animation on submit.
 *
 * Uses `React.createElement` instead of JSX to match the project's
 * tsconfig setting.
 *
 * Requirements: 18.1, 18.2, 18.3, 18.4, 18.5, 18.6, 18.7
 */

import React, { useEffect, useRef, useCallback } from 'react';
import { View, Text } from 'react-native';
import type { ViewStyle, TextStyle } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  runOnJS,
} from 'react-native-reanimated';
import { useTokens } from '../tokens/designTokens';
import { useAnimation, ANIMATION_CONFIG } from '../animation/animationEngine';
import { useScreenReaderAnnouncement } from '../accessibility/useAccessibility';
import type { ParsedEvent } from '../../nlp/naturalLanguageParser';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LivePreviewPanelProps {
  /** The parsed event from the NL parser (null when input is empty) */
  parsedEvent: ParsedEvent | null;
  /** Whether the panel is collapsing (after submit) */
  isCollapsing?: boolean;
  /** Called when collapse animation completes */
  onCollapseComplete?: () => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Collapse animation duration (ms) — Req 18.6 */
const COLLAPSE_DURATION_MS = ANIMATION_CONFIG.durations.normal; // 200ms

/** Screen reader announcement debounce (ms) — Req 18.7 */
const SR_DEBOUNCE_MS = 500;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Format a Date for display. Returns a human-readable string like
 * "Tomorrow", "Today", or "Jan 15".
 */
function formatDateDisplay(date: Date): string {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round(
    (target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
  );

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Tomorrow';

  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  return `${months[date.getMonth()]} ${date.getDate()}`;
}

/**
 * Format a time object for display. Returns e.g. "12:00 PM", "9:30 AM".
 */
function formatTimeDisplay(time: { hours: number; minutes: number }): string {
  const h = time.hours;
  const m = time.minutes;
  const period = h >= 12 ? 'PM' : 'AM';
  const displayHour = h === 0 ? 12 : h > 12 ? h - 12 : h;
  const displayMin = m.toString().padStart(2, '0');
  return `${displayHour}:${displayMin} ${period}`;
}

/**
 * Format duration in minutes for display. Returns e.g. "1 hour", "30 minutes".
 */
function formatDurationDisplay(minutes: number): string {
  if (minutes >= 60 && minutes % 60 === 0) {
    const hours = minutes / 60;
    return hours === 1 ? '1 hour' : `${hours} hours`;
  }
  if (minutes > 60) {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}h ${mins}m`;
  }
  return `${minutes} minutes`;
}

/**
 * Build a summary string for screen reader announcement.
 */
function buildAnnouncementText(event: ParsedEvent): string {
  const parts: string[] = [];
  if (event.title) parts.push(event.title);
  if (event.confidence.date && event.date) {
    parts.push(formatDateDisplay(event.date));
  }
  if (event.confidence.time && event.time) {
    parts.push(formatTimeDisplay(event.time));
  }
  if (event.confidence.duration) {
    parts.push(formatDurationDisplay(event.duration));
  }
  if (event.confidence.location && event.location) {
    parts.push(`at ${event.location}`);
  }
  return parts.length > 0 ? `Event preview: ${parts.join(', ')}` : '';
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function LivePreviewPanel({
  parsedEvent,
  isCollapsing = false,
  onCollapseComplete,
}: LivePreviewPanelProps): React.ReactElement | null {
  const tokens = useTokens();
  const { shouldAnimate } = useAnimation();
  const { announce } = useScreenReaderAnnouncement();

  // ── Collapse animation shared values ─────────────────────────────────────
  const opacity = useSharedValue(1);
  const scaleY = useSharedValue(1);

  // ── Screen reader debounce ───────────────────────────────────────────────
  const srTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastAnnouncementRef = useRef<string>('');

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (srTimerRef.current) clearTimeout(srTimerRef.current);
    };
  }, []);

  // ── Debounced screen reader announcement (Req 18.7) ──────────────────────
  const announceChanges = useCallback(
    (event: ParsedEvent) => {
      const text = buildAnnouncementText(event);
      if (text === lastAnnouncementRef.current) return;

      if (srTimerRef.current) clearTimeout(srTimerRef.current);
      srTimerRef.current = setTimeout(() => {
        lastAnnouncementRef.current = text;
        announce(text, 'polite');
      }, SR_DEBOUNCE_MS);
    },
    [announce],
  );

  // ── Announce field changes when parsedEvent updates ──────────────────────
  useEffect(() => {
    if (parsedEvent) {
      announceChanges(parsedEvent);
    }
  }, [parsedEvent, announceChanges]);

  // ── Collapse animation (Req 18.6) ────────────────────────────────────────
  const handleCollapseFinished = useCallback(
    (finished?: boolean) => {
      'worklet';
      if (finished && onCollapseComplete) {
        runOnJS(onCollapseComplete)();
      }
    },
    [onCollapseComplete],
  );

  useEffect(() => {
    if (isCollapsing) {
      if (shouldAnimate) {
        opacity.value = withTiming(0, { duration: COLLAPSE_DURATION_MS });
        scaleY.value = withTiming(
          0,
          { duration: COLLAPSE_DURATION_MS },
          handleCollapseFinished,
        );
      } else {
        // Instant collapse when reduced motion is active
        opacity.value = 0;
        scaleY.value = 0;
        onCollapseComplete?.();
      }
    } else {
      opacity.value = 1;
      scaleY.value = 1;
    }
  }, [isCollapsing, shouldAnimate, opacity, scaleY, onCollapseComplete, handleCollapseFinished]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scaleY: scaleY.value }],
  }));

  // ── Return null when no parsed event ─────────────────────────────────────
  if (!parsedEvent) return null;

  // ── Styles (token-driven) ────────────────────────────────────────────────
  const containerStyle: ViewStyle = {
    backgroundColor: tokens.colors.surface,
    borderRadius: tokens.radii.md,
    padding: tokens.spacing.md,
    marginHorizontal: tokens.spacing.lg,
    marginBottom: tokens.spacing.sm,
  };

  const fieldRowStyle: ViewStyle = {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginBottom: tokens.spacing.xs,
  };

  const labelStyle: TextStyle = {
    color: tokens.colors.textSecondary,
    fontSize: tokens.typography.sizes.caption,
    lineHeight: tokens.typography.lineHeights.caption,
    fontFamily: tokens.typography.fontFamily.primary,
    fontWeight: tokens.typography.weights.regular,
    width: 70,
  };

  const confirmedValueStyle: TextStyle = {
    color: tokens.colors.textPrimary,
    fontSize: tokens.typography.sizes.body,
    lineHeight: tokens.typography.lineHeights.body,
    fontFamily: tokens.typography.fontFamily.primary,
    fontWeight: tokens.typography.weights.medium,
    flex: 1,
  };

  const placeholderValueStyle: TextStyle = {
    color: tokens.colors.textMuted,
    fontSize: tokens.typography.sizes.body,
    lineHeight: tokens.typography.lineHeights.body,
    fontFamily: tokens.typography.fontFamily.primary,
    fontWeight: tokens.typography.weights.regular,
    fontStyle: 'italic',
    flex: 1,
  };

  // ── Build field rows ─────────────────────────────────────────────────────
  const fields: React.ReactElement[] = [];

  // Title — always shown
  const hasTitle = parsedEvent.title.length > 0;
  fields.push(
    React.createElement(
      View,
      { key: 'title', style: fieldRowStyle, testID: 'preview-field-title' },
      React.createElement(
        Text,
        {
          style: labelStyle,
          accessibilityLabel: 'Title label',
        },
        'Title',
      ),
      React.createElement(
        Text,
        {
          style: hasTitle ? confirmedValueStyle : placeholderValueStyle,
          accessibilityLabel: hasTitle
            ? `Title: ${parsedEvent.title}`
            : 'Title: Untitled event',
          testID: 'preview-value-title',
        },
        hasTitle ? parsedEvent.title : 'Untitled event',
      ),
    ),
  );

  // Date — always shown
  const hasDate = parsedEvent.confidence.date && parsedEvent.date !== null;
  fields.push(
    React.createElement(
      View,
      { key: 'date', style: fieldRowStyle, testID: 'preview-field-date' },
      React.createElement(
        Text,
        {
          style: labelStyle,
          accessibilityLabel: 'Date label',
        },
        'Date',
      ),
      React.createElement(
        Text,
        {
          style: hasDate ? confirmedValueStyle : placeholderValueStyle,
          accessibilityLabel: hasDate
            ? `Date: ${formatDateDisplay(parsedEvent.date!)}`
            : 'Date not set',
          testID: 'preview-value-date',
        },
        hasDate ? formatDateDisplay(parsedEvent.date!) : 'Date not set',
      ),
    ),
  );

  // Time — always shown
  const hasTime = parsedEvent.confidence.time && parsedEvent.time !== null;
  fields.push(
    React.createElement(
      View,
      { key: 'time', style: fieldRowStyle, testID: 'preview-field-time' },
      React.createElement(
        Text,
        {
          style: labelStyle,
          accessibilityLabel: 'Time label',
        },
        'Time',
      ),
      React.createElement(
        Text,
        {
          style: hasTime ? confirmedValueStyle : placeholderValueStyle,
          accessibilityLabel: hasTime
            ? `Time: ${formatTimeDisplay(parsedEvent.time!)}`
            : 'Time not set',
          testID: 'preview-value-time',
        },
        hasTime ? formatTimeDisplay(parsedEvent.time!) : 'Time not set',
      ),
    ),
  );

  // Duration — always shown
  const hasDuration = parsedEvent.confidence.duration;
  fields.push(
    React.createElement(
      View,
      { key: 'duration', style: fieldRowStyle, testID: 'preview-field-duration' },
      React.createElement(
        Text,
        {
          style: labelStyle,
          accessibilityLabel: 'Duration label',
        },
        'Duration',
      ),
      React.createElement(
        Text,
        {
          style: hasDuration ? confirmedValueStyle : placeholderValueStyle,
          accessibilityLabel: `Duration: ${formatDurationDisplay(parsedEvent.duration)}`,
          testID: 'preview-value-duration',
        },
        formatDurationDisplay(parsedEvent.duration),
      ),
    ),
  );

  // Location — only shown when present
  if (parsedEvent.location) {
    fields.push(
      React.createElement(
        View,
        { key: 'location', style: fieldRowStyle, testID: 'preview-field-location' },
        React.createElement(
          Text,
          {
            style: labelStyle,
            accessibilityLabel: 'Location label',
          },
          'Location',
        ),
        React.createElement(
          Text,
          {
            style: confirmedValueStyle,
            accessibilityLabel: `Location: ${parsedEvent.location}`,
            testID: 'preview-value-location',
          },
          parsedEvent.location,
        ),
      ),
    );
  }

  // Attendees — only shown when present
  if (parsedEvent.attendees.length > 0) {
    const attendeeText = parsedEvent.attendees.join(', ');
    fields.push(
      React.createElement(
        View,
        { key: 'attendees', style: fieldRowStyle, testID: 'preview-field-attendees' },
        React.createElement(
          Text,
          {
            style: labelStyle,
            accessibilityLabel: 'Attendees label',
          },
          'Attendees',
        ),
        React.createElement(
          Text,
          {
            style: confirmedValueStyle,
            accessibilityLabel: `Attendees: ${attendeeText}`,
            testID: 'preview-value-attendees',
          },
          attendeeText,
        ),
      ),
    );
  }

  // Recurrence — only shown when parsed
  if (
    parsedEvent.confidence.recurrence === 'parsed' &&
    parsedEvent.recurrence
  ) {
    // Build a simple human-readable description from the recurrence rule
    const recurrenceText = describeRecurrence(parsedEvent.recurrence);
    fields.push(
      React.createElement(
        View,
        { key: 'recurrence', style: fieldRowStyle, testID: 'preview-field-recurrence' },
        React.createElement(
          Text,
          {
            style: labelStyle,
            accessibilityLabel: 'Recurrence label',
          },
          'Recurrence',
        ),
        React.createElement(
          Text,
          {
            style: confirmedValueStyle,
            accessibilityLabel: `Recurrence: ${recurrenceText}`,
            testID: 'preview-value-recurrence',
          },
          recurrenceText,
        ),
      ),
    );
  }

  // ── Render ───────────────────────────────────────────────────────────────
  return React.createElement(
    Animated.View,
    {
      style: [containerStyle, animatedStyle],
      accessibilityLiveRegion: 'polite' as const,
      accessibilityLabel: 'Event preview',
      testID: 'live-preview-panel',
    },
    ...fields,
  );
}

// ---------------------------------------------------------------------------
// Recurrence description helper
// ---------------------------------------------------------------------------

/**
 * Build a simple human-readable description from a RecurrenceRule.
 * This is a lightweight version — the full printer is in recurrencePrinter.ts.
 */
function describeRecurrence(rule: {
  frequency: string;
  interval?: number;
  byDay?: string[] | null;
}): string {
  const freq = rule.frequency?.toUpperCase() ?? '';
  const interval = rule.interval ?? 1;

  if (freq === 'DAILY') {
    return interval === 1 ? 'Every day' : `Every ${interval} days`;
  }
  if (freq === 'WEEKLY') {
    if (rule.byDay && rule.byDay.length > 0) {
      const dayNames: Record<string, string> = {
        MO: 'Mon', TU: 'Tue', WE: 'Wed', TH: 'Thu',
        FR: 'Fri', SA: 'Sat', SU: 'Sun',
      };
      const days = rule.byDay.map((d) => dayNames[d] ?? d).join(', ');
      return interval === 1
        ? `Weekly on ${days}`
        : `Every ${interval} weeks on ${days}`;
    }
    return interval === 1 ? 'Every week' : `Every ${interval} weeks`;
  }
  if (freq === 'MONTHLY') {
    return interval === 1 ? 'Every month' : `Every ${interval} months`;
  }
  if (freq === 'YEARLY') {
    return interval === 1 ? 'Every year' : `Every ${interval} years`;
  }
  return 'Repeating';
}
