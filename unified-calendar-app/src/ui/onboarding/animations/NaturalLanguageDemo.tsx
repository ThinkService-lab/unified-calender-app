/**
 * NaturalLanguageDemo — looping onboarding animation demonstrating the
 * Quick Create Bar's natural language event creation flow.
 *
 * Animation sequence (one loop):
 *   1. Typed text appears character-by-character in a simulated input bar
 *   2. Live Preview Panel resolves parsed fields (title, date, time)
 *   3. An event card pops in below the preview
 *   4. Brief hold, then reset for next loop
 *
 * Uses `react-native-reanimated` worklets exclusively — no Lottie.
 * Respects `useReducedMotion()` by rendering a static fallback image.
 *
 * Requirements: 20.2, 20.3
 */

import React, { useEffect } from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import {
  useSharedValue,
  useAnimatedStyle,
  useDerivedValue,
  withRepeat,
  withSequence,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import Animated from 'react-native-reanimated';

import { useReducedMotion } from '../../accessibility/useAccessibility';
import { useAnimation } from '../../animation/animationEngine';
import { useTokens } from '../../tokens/designTokens';

// Static fallback for reduced motion
const staticFallback = require('./staticFallbacks/natural-language.png');

/** Duration of one full animation loop in milliseconds. */
export const loopDurationMs = 5000;

/** Demo text typed character-by-character. */
const DEMO_TEXT = 'Lunch tomorrow at noon';

/** Phase durations (ms) */
const TYPING_DURATION = 2000;
const PREVIEW_RESOLVE_DURATION = 800;
const CARD_POP_DURATION = 600;
const HOLD_DURATION = loopDurationMs - TYPING_DURATION - PREVIEW_RESOLVE_DURATION - CARD_POP_DURATION;

interface NaturalLanguageDemoProps {
  isPlaying: boolean;
}

/**
 * Onboarding animation component for natural language event creation.
 * Accepts `{ isPlaying: boolean }` — animation loops only when playing.
 */
export default function NaturalLanguageDemo({ isPlaying }: NaturalLanguageDemoProps) {
  const reducedMotion = useReducedMotion();
  const { shouldAnimate } = useAnimation();
  const tokens = useTokens();

  // Shared values driving the three animation phases
  const typingProgress = useSharedValue(0);
  const previewOpacity = useSharedValue(0);
  const cardScale = useSharedValue(0);
  const cardOpacity = useSharedValue(0);

  // Derive the visible character count from typingProgress (0→1 maps to 0→DEMO_TEXT.length)
  const visibleCharCount = useDerivedValue(() => {
    return Math.round(typingProgress.value * DEMO_TEXT.length);
  });

  useEffect(() => {
    if (!isPlaying || reducedMotion || !shouldAnimate) {
      // Reset to resting state
      typingProgress.value = 0;
      previewOpacity.value = 0;
      cardScale.value = 0;
      cardOpacity.value = 0;
      return;
    }

    // Build the looping sequence
    // Phase 1: typing (0 → 1 over TYPING_DURATION)
    // Phase 2: preview resolves (opacity 0 → 1)
    // Phase 3: card pops in (scale 0 → 1, opacity 0 → 1)
    // Phase 4: hold, then reset

    typingProgress.value = withRepeat(
      withSequence(
        withTiming(1, { duration: TYPING_DURATION, easing: Easing.linear }),
        withTiming(1, { duration: PREVIEW_RESOLVE_DURATION + CARD_POP_DURATION + HOLD_DURATION }),
        withTiming(0, { duration: 0 }),
      ),
      -1,
      false,
    );

    previewOpacity.value = withRepeat(
      withSequence(
        withTiming(0, { duration: TYPING_DURATION }),
        withTiming(1, { duration: PREVIEW_RESOLVE_DURATION, easing: Easing.out(Easing.cubic) }),
        withTiming(1, { duration: CARD_POP_DURATION + HOLD_DURATION }),
        withTiming(0, { duration: 0 }),
      ),
      -1,
      false,
    );

    cardScale.value = withRepeat(
      withSequence(
        withTiming(0, { duration: TYPING_DURATION + PREVIEW_RESOLVE_DURATION }),
        withTiming(1, { duration: CARD_POP_DURATION, easing: Easing.out(Easing.back(1.5)) }),
        withTiming(1, { duration: HOLD_DURATION }),
        withTiming(0, { duration: 0 }),
      ),
      -1,
      false,
    );

    cardOpacity.value = withRepeat(
      withSequence(
        withTiming(0, { duration: TYPING_DURATION + PREVIEW_RESOLVE_DURATION }),
        withTiming(1, { duration: CARD_POP_DURATION * 0.5, easing: Easing.out(Easing.cubic) }),
        withTiming(1, { duration: CARD_POP_DURATION * 0.5 + HOLD_DURATION }),
        withTiming(0, { duration: 0 }),
      ),
      -1,
      false,
    );
  }, [isPlaying, reducedMotion, shouldAnimate, typingProgress, previewOpacity, cardScale, cardOpacity]);

  // Animated text component that shows characters one-by-one
  const TypewriterText = React.useCallback(() => {
    const animStyle = useAnimatedStyle(() => ({
      opacity: 1,
    }));
    // We use Animated.Text with a derived value for the substring.
    // Since Reanimated's useAnimatedProps can't drive text content directly
    // on RN, we use a workaround: render the full text but clip via a
    // width-based approach. For simplicity and correctness, we render
    // the visible portion as a regular Text inside an Animated.View.
    return (
      <Animated.View style={animStyle}>
        <AnimatedTypewriterInner charCount={visibleCharCount} tokens={tokens} />
      </Animated.View>
    );
  }, [visibleCharCount, tokens]);

  const previewStyle = useAnimatedStyle(() => ({
    opacity: previewOpacity.value,
  }));

  const cardAnimatedStyle = useAnimatedStyle(() => ({
    opacity: cardOpacity.value,
    transform: [{ scale: cardScale.value }],
  }));

  const { colors, typography: typo, spacing, radii } = tokens;

  // Reduced motion: render static fallback
  if (reducedMotion || !shouldAnimate) {
    return (
      <View
        style={[styles.container, { padding: spacing.lg }]}
        accessibilityRole="image"
        accessibilityLabel="Demonstration of typing 'Lunch tomorrow at noon' in the Quick Create Bar"
      >
        <Image source={staticFallback} style={styles.fallbackImage} resizeMode="contain" />
      </View>
    );
  }

  return (
    <View
      style={[styles.container, { padding: spacing.lg }]}
      accessibilityRole="image"
      accessibilityLabel="Demonstration of typing 'Lunch tomorrow at noon' in the Quick Create Bar"
    >
      {/* Simulated Quick Create Bar */}
      <View style={[styles.inputBar, {
        backgroundColor: colors.surface,
        borderRadius: radii.md,
        borderColor: colors.border,
        paddingHorizontal: spacing.md,
        marginBottom: spacing.md,
      }]}>
        <TypewriterText />
      </View>

      {/* Simulated Live Preview Panel */}
      <Animated.View style={[{
        width: '90%',
        backgroundColor: colors.surfaceElevated,
        borderRadius: radii.md,
        padding: spacing.md,
        marginBottom: spacing.md,
        borderWidth: 1,
        borderColor: colors.borderLight,
      }, previewStyle]}>
        <Text style={{ fontFamily: typo.fontFamily.primary, fontSize: typo.sizes.caption, color: colors.textMuted, marginBottom: 2 }}>Title</Text>
        <Text style={{ fontFamily: typo.fontFamily.primary, fontSize: typo.sizes.body, fontWeight: typo.weights.medium, color: colors.primary, marginBottom: spacing.sm }}>Lunch</Text>
        <Text style={{ fontFamily: typo.fontFamily.primary, fontSize: typo.sizes.caption, color: colors.textMuted, marginBottom: 2 }}>Date</Text>
        <Text style={{ fontFamily: typo.fontFamily.primary, fontSize: typo.sizes.body, fontWeight: typo.weights.medium, color: colors.primary, marginBottom: spacing.sm }}>Tomorrow</Text>
        <Text style={{ fontFamily: typo.fontFamily.primary, fontSize: typo.sizes.caption, color: colors.textMuted, marginBottom: 2 }}>Time</Text>
        <Text style={{ fontFamily: typo.fontFamily.primary, fontSize: typo.sizes.body, fontWeight: typo.weights.medium, color: colors.primary, marginBottom: spacing.sm }}>12:00 PM</Text>
      </Animated.View>

      {/* Simulated Event Card */}
      <Animated.View style={[{
        width: '90%',
        flexDirection: 'row',
        backgroundColor: colors.surface,
        borderRadius: radii.md,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: colors.borderLight,
      }, cardAnimatedStyle]}>
        <View style={{ width: 4, backgroundColor: colors.primary }} />
        <View style={{ flex: 1, padding: spacing.md }}>
          <Text style={{ fontFamily: typo.fontFamily.primary, fontSize: typo.sizes.subheading, fontWeight: typo.weights.semibold, color: colors.textPrimary, marginBottom: 2 }}>Lunch</Text>
          <Text style={{ fontFamily: typo.fontFamily.primary, fontSize: typo.sizes.caption, color: colors.textSecondary }}>Tomorrow · 12:00 PM</Text>
        </View>
      </Animated.View>
    </View>
  );
}

/**
 * Inner component that reads the derived char count on the JS thread
 * via useAnimatedReaction and renders the visible substring.
 */
function AnimatedTypewriterInner({
  charCount,
  tokens,
}: {
  charCount: Animated.SharedValue<number>;
  tokens: ReturnType<typeof useTokens>;
}) {
  const [text, setText] = React.useState('');

  // Bridge the worklet-thread shared value to JS state for text rendering
  React.useEffect(() => {
    // Poll the shared value at ~30fps for smooth character reveal
    const interval = setInterval(() => {
      const count = charCount.value;
      setText(DEMO_TEXT.slice(0, count));
    }, 33);
    return () => clearInterval(interval);
  }, [charCount]);

  return (
    <Text style={{
      fontFamily: tokens.typography.fontFamily.primary,
      fontSize: tokens.typography.sizes.body,
      color: tokens.colors.textPrimary,
    }}>
      {text}
      {text.length < DEMO_TEXT.length && (
        <Text style={{ color: tokens.colors.textMuted }}>|</Text>
      )}
    </Text>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fallbackImage: {
    width: '100%',
    height: '100%',
  },
  inputBar: {
    width: '90%',
    height: 44,
    borderWidth: 1,
    justifyContent: 'center',
  },
});
