/**
 * EmptyStateView — contextual empty state displayed when a calendar view
 * has zero visible events, or when no calendar accounts are connected.
 *
 * Displays a decorative illustration (SVG placeholder), a context-appropriate
 * primary message, and a call-to-action button. For the 'no-accounts' context,
 * a "Connect Account" button replaces the standard "Create an event" CTA.
 *
 * Entrance animation: fade-in + slide-up (400ms) via react-native-reanimated.
 * When reduced motion is active, the component renders statically (no animation).
 *
 * Accessibility:
 *   - Illustration is decorative (empty alt text / accessibilityLabel)
 *   - Primary message is readable by screen readers
 *   - CTA buttons are properly labeled with accessibilityRole="button"
 *
 * Uses `React.createElement` instead of JSX to match the project's
 * `jsx: "react-native"` tsconfig setting.
 *
 * Requirements: 16.1, 16.2, 16.3, 16.4, 16.5, 16.6, 16.7
 */

import React, { useEffect } from 'react';
import { View, Text, Pressable, StyleSheet, Platform } from 'react-native';
import type { ViewStyle, TextStyle } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
} from 'react-native-reanimated';

import { useTokens } from '../tokens/designTokens';
import { useReducedMotion } from '../accessibility/useAccessibility';
import { ANIMATION_CONFIG } from '../animation/animationEngine';

// ─── Public types ────────────────────────────────────────────────────────────

/** Context that determines which message and CTA the empty state displays. */
export type EmptyStateContext = 'day' | 'week' | 'agenda' | 'no-accounts';

export interface EmptyStateViewProps {
  /** Which calendar view (or first-launch state) triggered the empty state. */
  context: EmptyStateContext;
  /** Called when the user taps "Create an event". */
  onCreateEvent: () => void;
  /** Called when the user taps "Connect Account" (no-accounts context only). */
  onConnectAccount?: () => void;
}

// ─── Message mapping ─────────────────────────────────────────────────────────

/** Maps each context to its primary message string. Exported for testability. */
export function getEmptyStateMessage(context: EmptyStateContext): string {
  switch (context) {
    case 'day':
      return 'No events today \u2014 enjoy your free time!';
    case 'week':
      return 'Your week is wide open';
    case 'agenda':
      return 'Nothing coming up';
    case 'no-accounts':
      return 'Welcome! Connect a calendar account to get started.';
  }
}

// ─── Constants ───────────────────────────────────────────────────────────────

/** Entrance animation duration (ms). Matches Req 16.6 (400ms). */
const ENTRANCE_DURATION_MS = ANIMATION_CONFIG.durations.entrance; // 400

/** Vertical offset for the slide-up entrance (px). */
const SLIDE_UP_OFFSET = 24;

// ─── Illustration placeholder ────────────────────────────────────────────────

/**
 * Returns a simple decorative illustration placeholder for the given context.
 * In a production app this would be an SVG or Lottie asset; here we use a
 * Unicode symbol inside a circular container as a lightweight stand-in.
 */
function getIllustrationEmoji(context: EmptyStateContext): string {
  switch (context) {
    case 'day':
      return '☀️';
    case 'week':
      return '📅';
    case 'agenda':
      return '✨';
    case 'no-accounts':
      return '👋';
  }
}

// ─── Component ───────────────────────────────────────────────────────────────

export function EmptyStateView({
  context,
  onCreateEvent,
  onConnectAccount,
}: EmptyStateViewProps): React.ReactElement {
  const tokens = useTokens();
  const reducedMotion = useReducedMotion();

  // ── Animation shared values ─────────────────────────────────────────────
  const opacity = useSharedValue(reducedMotion ? 1 : 0);
  const translateY = useSharedValue(reducedMotion ? 0 : SLIDE_UP_OFFSET);

  // ── Entrance animation on mount ─────────────────────────────────────────
  useEffect(() => {
    if (!reducedMotion) {
      opacity.value = withTiming(1, { duration: ENTRANCE_DURATION_MS });
      translateY.value = withTiming(0, { duration: ENTRANCE_DURATION_MS });
    }
  }, [opacity, translateY, reducedMotion]);

  // ── Animated style ──────────────────────────────────────────────────────
  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  // ── Derived values ──────────────────────────────────────────────────────
  const message = getEmptyStateMessage(context);
  const illustrationEmoji = getIllustrationEmoji(context);
  const isNoAccounts = context === 'no-accounts';

  // ── Token-driven styles ─────────────────────────────────────────────────
  const containerStyle: ViewStyle = {
    ...styles.container,
    backgroundColor: tokens.colors.background,
  };

  const illustrationContainerStyle: ViewStyle = {
    ...styles.illustrationContainer,
    backgroundColor: tokens.colors.surfaceElevated,
    borderRadius: tokens.radii.full,
  };

  const illustrationTextStyle: TextStyle = {
    fontSize: tokens.typography.sizes.display,
    lineHeight: tokens.typography.lineHeights.display,
    textAlign: 'center',
  };

  const messageStyle: TextStyle = {
    ...styles.message,
    color: tokens.colors.textPrimary,
    fontSize: tokens.typography.sizes.heading,
    lineHeight: tokens.typography.lineHeights.heading,
    fontWeight: tokens.typography.weights.semibold,
    fontFamily: tokens.typography.fontFamily.primary,
  };

  const ctaButtonStyle: ViewStyle = {
    ...styles.ctaButton,
    backgroundColor: tokens.colors.primary,
    borderRadius: tokens.radii.md,
    paddingHorizontal: tokens.spacing.xl,
    paddingVertical: tokens.spacing.md,
  };

  const ctaTextStyle: TextStyle = {
    ...styles.ctaText,
    color: tokens.colors.textOnPrimary,
    fontSize: tokens.typography.sizes.body,
    lineHeight: tokens.typography.lineHeights.body,
    fontWeight: tokens.typography.weights.semibold,
    fontFamily: tokens.typography.fontFamily.primary,
  };

  // ── Build children array ────────────────────────────────────────────────
  const children: React.ReactElement[] = [];

  // Illustration (decorative — empty alt text for accessibility)
  children.push(
    React.createElement(
      View,
      {
        key: 'illustration',
        style: illustrationContainerStyle,
        accessible: true,
        accessibilityLabel: '',
        accessibilityRole: 'image',
        importantForAccessibility: 'no',
        ...(Platform.OS === 'web'
          ? { 'aria-hidden': true, role: 'img', 'aria-label': '' } as any
          : {}),
        testID: 'empty-state-illustration',
      },
      React.createElement(Text, {
        style: illustrationTextStyle,
        accessible: false,
      }, illustrationEmoji),
    ),
  );

  // Primary message
  children.push(
    React.createElement(Text, {
      key: 'message',
      style: messageStyle,
      accessible: true,
      accessibilityRole: 'text',
      accessibilityLabel: message,
      testID: 'empty-state-message',
    }, message),
  );

  // CTA: "Create an event" button (shown for all contexts)
  if (!isNoAccounts) {
    children.push(
      React.createElement(
        Pressable,
        {
          key: 'cta-create',
          onPress: onCreateEvent,
          style: ctaButtonStyle,
          accessible: true,
          accessibilityRole: 'button',
          accessibilityLabel: 'Create an event',
          testID: 'empty-state-create-button',
        },
        React.createElement(Text, {
          style: ctaTextStyle,
        }, 'Create an event'),
      ),
    );
  }

  // No-accounts context: "Connect Account" button (Req 16.4)
  if (isNoAccounts) {
    children.push(
      React.createElement(
        Pressable,
        {
          key: 'cta-connect',
          onPress: onConnectAccount,
          style: ctaButtonStyle,
          accessible: true,
          accessibilityRole: 'button',
          accessibilityLabel: 'Connect Account',
          testID: 'empty-state-connect-button',
        },
        React.createElement(Text, {
          style: ctaTextStyle,
        }, 'Connect Account'),
      ),
    );
  }

  // ── Render ──────────────────────────────────────────────────────────────
  return React.createElement(
    Animated.View,
    {
      style: [containerStyle, animatedStyle],
      testID: 'empty-state-view',
      accessible: true,
      accessibilityRole: 'none',
      ...(Platform.OS === 'web'
        ? { role: 'region', 'aria-label': 'Empty calendar state' } as any
        : {}),
    },
    ...children,
  );
}

// ─── Static styles ───────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 48,
  },
  illustrationContainer: {
    width: 80,
    height: 80,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  message: {
    textAlign: 'center',
    marginBottom: 24,
  },
  ctaButton: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  ctaText: {
    textAlign: 'center',
  },
});

export default EmptyStateView;
