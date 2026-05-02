/**
 * DragToRescheduleDemo — looping onboarding animation demonstrating
 * the drag-to-reschedule gesture.
 *
 * Animation sequence (one loop):
 *   1. An event card lifts (scale 1.03)
 *   2. The card translates vertically to a new time slot
 *   3. The card settles into the new position (scale back to 1.0)
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
const staticFallback = require('./staticFallbacks/drag-to-reschedule.png');

/** Duration of one full animation loop in milliseconds. */
export const loopDurationMs = 4000;

/** Phase durations (ms) */
const LIFT_DURATION = 400;
const TRANSLATE_DURATION = 1200;
const SETTLE_DURATION = 400;
const HOLD_DURATION = loopDurationMs - LIFT_DURATION - TRANSLATE_DURATION - SETTLE_DURATION;
const TRANSLATE_Y_DISTANCE = 80; // pixels to move down

interface DragToRescheduleDemoProps {
  isPlaying: boolean;
}

/**
 * Onboarding animation component for drag-to-reschedule.
 * Accepts `{ isPlaying: boolean }` — animation loops only when playing.
 */
export default function DragToRescheduleDemo({ isPlaying }: DragToRescheduleDemoProps) {
  const reducedMotion = useReducedMotion();
  const { shouldAnimate } = useAnimation();
  const tokens = useTokens();

  const scale = useSharedValue(1);
  const translateY = useSharedValue(0);
  const elevation = useSharedValue(0);

  useEffect(() => {
    if (!isPlaying || reducedMotion || !shouldAnimate) {
      scale.value = 1;
      translateY.value = 0;
      elevation.value = 0;
      return;
    }

    // Scale: 1 → 1.03 (lift) → hold during translate → 1.0 (settle) → hold → reset
    scale.value = withRepeat(
      withSequence(
        withTiming(1.03, { duration: LIFT_DURATION, easing: Easing.out(Easing.cubic) }),
        withTiming(1.03, { duration: TRANSLATE_DURATION }),
        withTiming(1.0, { duration: SETTLE_DURATION, easing: Easing.out(Easing.cubic) }),
        withTiming(1.0, { duration: HOLD_DURATION }),
        withTiming(1.0, { duration: 0 }),
      ),
      -1,
      false,
    );

    // TranslateY: 0 → 0 (lift) → TRANSLATE_Y_DISTANCE (translate) → hold → reset
    translateY.value = withRepeat(
      withSequence(
        withTiming(0, { duration: LIFT_DURATION }),
        withTiming(TRANSLATE_Y_DISTANCE, { duration: TRANSLATE_DURATION, easing: Easing.inOut(Easing.cubic) }),
        withTiming(TRANSLATE_Y_DISTANCE, { duration: SETTLE_DURATION + HOLD_DURATION }),
        withTiming(0, { duration: 0 }),
      ),
      -1,
      false,
    );

    // Elevation shadow opacity: 0 → 1 (lift) → hold → 0 (settle) → hold → reset
    elevation.value = withRepeat(
      withSequence(
        withTiming(1, { duration: LIFT_DURATION, easing: Easing.out(Easing.cubic) }),
        withTiming(1, { duration: TRANSLATE_DURATION }),
        withTiming(0, { duration: SETTLE_DURATION, easing: Easing.out(Easing.cubic) }),
        withTiming(0, { duration: HOLD_DURATION }),
        withTiming(0, { duration: 0 }),
      ),
      -1,
      false,
    );
  }, [isPlaying, reducedMotion, shouldAnimate, scale, translateY, elevation]);

  const cardAnimatedStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: scale.value },
      { translateY: translateY.value },
    ],
    shadowOpacity: elevation.value * 0.2,
    shadowRadius: elevation.value * 8,
  }));

  // Reduced motion: render static fallback
  if (reducedMotion || !shouldAnimate) {
    return (
      <View
        style={[styles.container, { padding: tokens.spacing.lg }]}
        accessibilityRole="image"
        accessibilityLabel="Demonstration of dragging an event to a new time slot to reschedule it"
      >
        <Image source={staticFallback} style={styles.fallbackImage} resizeMode="contain" />
      </View>
    );
  }

  const { colors, typography: typo, spacing, radii } = tokens;

  return (
    <View
      style={[styles.container, { padding: spacing.lg }]}
      accessibilityRole="image"
      accessibilityLabel="Demonstration of dragging an event to a new time slot to reschedule it"
    >
      {/* Simulated time grid */}
      <View style={[styles.timeGrid, { top: spacing.xl }]}>
        {['10:00 AM', '11:00 AM', '12:00 PM', '1:00 PM'].map((time) => (
          <View key={time} style={styles.timeSlot}>
            <Text style={{ fontFamily: typo.fontFamily.primary, fontSize: typo.sizes.caption, color: colors.textMuted, width: 64, textAlign: 'right', marginRight: spacing.sm }}>{time}</Text>
            <View style={{ flex: 1, height: 1, backgroundColor: colors.borderLight }} />
          </View>
        ))}
      </View>

      {/* Draggable event card */}
      <Animated.View style={[{
        width: '65%',
        flexDirection: 'row',
        backgroundColor: colors.surface,
        borderRadius: radii.md,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: colors.borderLight,
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0,
        shadowRadius: 0,
        elevation: 0,
      }, cardAnimatedStyle]}>
        <View style={{ width: 4, backgroundColor: colors.secondary }} />
        <View style={{ flex: 1, padding: spacing.md }}>
          <Text style={{ fontFamily: typo.fontFamily.primary, fontSize: typo.sizes.subheading, fontWeight: typo.weights.semibold, color: colors.textPrimary, marginBottom: 2 }}>Team Standup</Text>
          <Text style={{ fontFamily: typo.fontFamily.primary, fontSize: typo.sizes.caption, color: colors.textSecondary }}>30 min</Text>
        </View>
      </Animated.View>
    </View>
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
  timeGrid: {
    width: '90%',
    position: 'absolute',
    left: '5%',
  },
  timeSlot: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 48,
  },
});
