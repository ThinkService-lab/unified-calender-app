/**
 * ViewSwitchingDemo — looping onboarding animation demonstrating
 * view transitions between day and week views.
 *
 * Animation sequence (one loop):
 *   1. A day-view grid is visible
 *   2. Crossfade + slide to a week-view grid
 *   3. Hold on week view
 *   4. Crossfade + slide back to day view
 *   5. Brief hold, then reset for next loop
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
const staticFallback = require('./staticFallbacks/view-switching.png');

/** Duration of one full animation loop in milliseconds. */
export const loopDurationMs = 5000;

/** Phase durations (ms) */
const HOLD_DAY_DURATION = 1000;
const TRANSITION_TO_WEEK_DURATION = 600;
const HOLD_WEEK_DURATION = 1400;
const TRANSITION_TO_DAY_DURATION = 600;
const RESET_HOLD_DURATION =
  loopDurationMs - HOLD_DAY_DURATION - TRANSITION_TO_WEEK_DURATION - HOLD_WEEK_DURATION - TRANSITION_TO_DAY_DURATION;

const SLIDE_OFFSET = 30; // pixels for horizontal slide

interface ViewSwitchingDemoProps {
  isPlaying: boolean;
}

/**
 * Onboarding animation component for view switching transitions.
 * Accepts `{ isPlaying: boolean }` — animation loops only when playing.
 */
export default function ViewSwitchingDemo({ isPlaying }: ViewSwitchingDemoProps) {
  const reducedMotion = useReducedMotion();
  const { shouldAnimate } = useAnimation();
  const tokens = useTokens();
  // dayOpacity: 1 = day view visible, 0 = week view visible
  const dayOpacity = useSharedValue(1);
  const dayTranslateX = useSharedValue(0);
  const weekOpacity = useSharedValue(0);
  const weekTranslateX = useSharedValue(SLIDE_OFFSET);

  useEffect(() => {
    if (!isPlaying || reducedMotion || !shouldAnimate) {
      dayOpacity.value = 1;
      dayTranslateX.value = 0;
      weekOpacity.value = 0;
      weekTranslateX.value = SLIDE_OFFSET;
      return;
    }

    const easeOut = Easing.out(Easing.cubic);

    // Day view opacity: 1 (hold) → 0 (transition) → 0 (hold week) → 1 (transition back) → 1 (hold) → reset
    dayOpacity.value = withRepeat(
      withSequence(
        withTiming(1, { duration: HOLD_DAY_DURATION }),
        withTiming(0, { duration: TRANSITION_TO_WEEK_DURATION, easing: easeOut }),
        withTiming(0, { duration: HOLD_WEEK_DURATION }),
        withTiming(1, { duration: TRANSITION_TO_DAY_DURATION, easing: easeOut }),
        withTiming(1, { duration: RESET_HOLD_DURATION }),
      ),
      -1,
      false,
    );

    // Day view slide: 0 → -SLIDE_OFFSET → hold → 0 → hold → reset
    dayTranslateX.value = withRepeat(
      withSequence(
        withTiming(0, { duration: HOLD_DAY_DURATION }),
        withTiming(-SLIDE_OFFSET, { duration: TRANSITION_TO_WEEK_DURATION, easing: easeOut }),
        withTiming(-SLIDE_OFFSET, { duration: HOLD_WEEK_DURATION }),
        withTiming(0, { duration: TRANSITION_TO_DAY_DURATION, easing: easeOut }),
        withTiming(0, { duration: RESET_HOLD_DURATION }),
      ),
      -1,
      false,
    );

    // Week view opacity: 0 (hold) → 1 (transition) → 1 (hold) → 0 (transition back) → 0 (hold) → reset
    weekOpacity.value = withRepeat(
      withSequence(
        withTiming(0, { duration: HOLD_DAY_DURATION }),
        withTiming(1, { duration: TRANSITION_TO_WEEK_DURATION, easing: easeOut }),
        withTiming(1, { duration: HOLD_WEEK_DURATION }),
        withTiming(0, { duration: TRANSITION_TO_DAY_DURATION, easing: easeOut }),
        withTiming(0, { duration: RESET_HOLD_DURATION }),
      ),
      -1,
      false,
    );

    // Week view slide: SLIDE_OFFSET → 0 → hold → SLIDE_OFFSET → hold → reset
    weekTranslateX.value = withRepeat(
      withSequence(
        withTiming(SLIDE_OFFSET, { duration: HOLD_DAY_DURATION }),
        withTiming(0, { duration: TRANSITION_TO_WEEK_DURATION, easing: easeOut }),
        withTiming(0, { duration: HOLD_WEEK_DURATION }),
        withTiming(SLIDE_OFFSET, { duration: TRANSITION_TO_DAY_DURATION, easing: easeOut }),
        withTiming(SLIDE_OFFSET, { duration: RESET_HOLD_DURATION }),
      ),
      -1,
      false,
    );
  }, [isPlaying, reducedMotion, shouldAnimate, dayOpacity, dayTranslateX, weekOpacity, weekTranslateX]);

  const dayViewStyle = useAnimatedStyle(() => ({
    opacity: dayOpacity.value,
    transform: [{ translateX: dayTranslateX.value }],
  }));

  const weekViewStyle = useAnimatedStyle(() => ({
    opacity: weekOpacity.value,
    transform: [{ translateX: weekTranslateX.value }],
  }));

  // Reduced motion: render static fallback
  if (reducedMotion || !shouldAnimate) {
    return (
      <View
        style={[styles.container, { padding: tokens.spacing.lg }]}
        accessibilityRole="image"
        accessibilityLabel="Demonstration of switching between day view and week view with animated transitions"
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
      accessibilityLabel="Demonstration of switching between day view and week view with animated transitions"
    >
      {/* View mode tabs */}
      <View style={[styles.tabBar, { backgroundColor: colors.surfaceElevated, borderRadius: radii.md, marginBottom: spacing.md }]}>
        <View style={[styles.tab, { borderRadius: radii.sm, backgroundColor: colors.primary }]}>
          <Text style={{ fontFamily: typo.fontFamily.primary, fontSize: typo.sizes.caption, fontWeight: typo.weights.semibold, color: colors.textOnPrimary }}>Day</Text>
        </View>
        <View style={[styles.tab, { borderRadius: radii.sm }]}>
          <Text style={{ fontFamily: typo.fontFamily.primary, fontSize: typo.sizes.caption, color: colors.textSecondary }}>Week</Text>
        </View>
        <View style={[styles.tab, { borderRadius: radii.sm }]}>
          <Text style={{ fontFamily: typo.fontFamily.primary, fontSize: typo.sizes.caption, color: colors.textSecondary }}>Month</Text>
        </View>
      </View>

      {/* Animated view container */}
      <View style={[styles.viewContainer, { borderRadius: radii.md, borderColor: colors.borderLight, backgroundColor: colors.surface }]}>
        {/* Day view grid */}
        <Animated.View style={[styles.gridOverlay, { padding: spacing.md }, dayViewStyle]}>
          <Text style={{ fontFamily: typo.fontFamily.primary, fontSize: typo.sizes.caption, fontWeight: typo.weights.semibold, color: colors.textMuted, marginBottom: spacing.sm }}>Day View</Text>
          {['9 AM', '10 AM', '11 AM', '12 PM'].map((time) => (
            <View key={`day-${time}`} style={styles.gridRow}>
              <Text style={{ fontFamily: typo.fontFamily.primary, fontSize: 9, color: colors.textMuted, width: 36, textAlign: 'right', marginRight: spacing.xs }}>{time}</Text>
              <View style={{ flex: 1, height: 1, backgroundColor: colors.borderLight }} />
            </View>
          ))}
          {/* Sample event in day view */}
          <View style={{ position: 'absolute', left: 48, right: spacing.md, top: 68, height: 48, backgroundColor: colors.primary, borderRadius: radii.sm, paddingHorizontal: spacing.xs, justifyContent: 'center' }}>
            <Text style={{ fontFamily: typo.fontFamily.primary, fontSize: 9, fontWeight: typo.weights.medium, color: colors.textOnPrimary }}>Meeting</Text>
          </View>
        </Animated.View>

        {/* Week view grid */}
        <Animated.View style={[styles.gridOverlay, { padding: spacing.md }, weekViewStyle]}>
          <Text style={{ fontFamily: typo.fontFamily.primary, fontSize: typo.sizes.caption, fontWeight: typo.weights.semibold, color: colors.textMuted, marginBottom: spacing.sm }}>Week View</Text>
          <View style={{ flexDirection: 'row', marginBottom: spacing.xs, paddingLeft: 40 }}>
            {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((day, i) => (
              <Text key={`wh-${i}`} style={{ flex: 1, fontFamily: typo.fontFamily.primary, fontSize: 9, fontWeight: typo.weights.medium, color: colors.textSecondary, textAlign: 'center' }}>{day}</Text>
            ))}
          </View>
          {['9 AM', '10 AM', '11 AM'].map((time) => (
            <View key={`week-${time}`} style={styles.gridRow}>
              <Text style={{ fontFamily: typo.fontFamily.primary, fontSize: 9, color: colors.textMuted, width: 36, textAlign: 'right', marginRight: spacing.xs }}>{time}</Text>
              <View style={{ flex: 1, height: 1, backgroundColor: colors.borderLight }} />
            </View>
          ))}
        </Animated.View>
      </View>
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
  tabBar: {
    flexDirection: 'row',
    width: '90%',
    padding: 2,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
  },
  viewContainer: {
    width: '90%',
    height: 180,
    position: 'relative',
    overflow: 'hidden',
    borderWidth: 1,
  },
  gridOverlay: {
    ...StyleSheet.absoluteFillObject,
  },
  gridRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 32,
  },
});
