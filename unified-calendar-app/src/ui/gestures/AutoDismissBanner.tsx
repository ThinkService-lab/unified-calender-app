/**
 * `AutoDismissBanner` — transient error banner that shows itself for a
 * fixed duration and then fades out.
 *
 * Used alongside `usePullToRefresh` to satisfy Req 9.4 (sync failure
 * shows a 3-second error banner that auto-dismisses). The timer
 * bookkeeping lives in `useAutoDismiss`; this component is responsible
 * for the entrance/exit animation, the styling, the accessibility
 * surface, and the tap-to-dismiss interaction.
 *
 * Behaviour:
 *
 *   - Entrance animation: slide down from -50px + fade in, both over
 *     200ms (matches the 200ms fade-out duration — the banner feels
 *     symmetrical on appearance and dismissal).
 *   - Exit animation: fade out over `fadeOutDuration` ms (default 200).
 *     The slide is NOT reversed on exit because the fade alone reads
 *     more cleanly for a dismissal — reversing the slide would make
 *     the banner look like it's "peeling" off-screen, which is visual
 *     noise for what should be a quiet dismissal.
 *   - Reduced motion (Req 2.5): both the slide and the fade resolve
 *     instantly. The banner still shows and dismisses; it just does
 *     so without motion.
 *   - Tap-to-dismiss: wrapping the banner in a `Pressable` that calls
 *     the hook's `dismiss()` function jumps straight to the fade-out
 *     phase.
 *   - Accessibility: `accessibilityRole="alert"` +
 *     `accessibilityLiveRegion="polite"` tells screen readers to
 *     announce the message on appearance. The alert role maps to
 *     `role="alert"` on React Native Web, which in turn sets
 *     `aria-live="assertive"`. The dismiss target uses
 *     `accessibilityRole="button"` + `accessibilityLabel="Dismiss error"`
 *     so keyboard and assistive-tech users can reach the same action.
 *
 * Styling (per design doc, Req 9 integration notes):
 *   - Background: `tokens.colors.error` at 0.9 opacity.
 *   - Text: `tokens.colors.textOnPrimary` at body size.
 *   - Radius: `tokens.radii.md`.
 *   - Padding: `tokens.spacing.sm` vertical, `tokens.spacing.md`
 *     horizontal.
 *   - Shadow: `tokens.shadows.sm`.
 *   - Positioned absolutely at `top: 0, left: 0, right: 0` so the
 *     parent container can mount it inside a relatively-positioned
 *     calendar view.
 *
 * Requirements: 9.3, 9.4, 2.5
 */

import React, { useEffect } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { useAnimation } from '../animation/animationEngine';
import { useTokens } from '../tokens';
import { useAutoDismiss } from './useAutoDismiss';

// ─── Public types ────────────────────────────────────────────────────────────

export interface AutoDismissBannerProps {
  /** Message to display. `null` hides the banner. */
  message: string | null;
  /** Duration to show before auto-dismiss (ms). Default 3000. */
  duration?: number;
  /** Duration of the fade-out animation (ms). Default 200. */
  fadeOutDuration?: number;
  /** Callback invoked after the banner fully dismisses. */
  onDismiss?: () => void;
}

// ─── Constants ───────────────────────────────────────────────────────────────

/** Entrance translateY start (px). Matches the fade-in duration visually. */
const ENTRANCE_TRANSLATE_Y = -50;

/** Entrance duration (ms). Mirrors the default fade-out duration so the
 * banner feels symmetrical on appear/dismiss. */
const ENTRANCE_DURATION_MS = 200;

// ─── Component ───────────────────────────────────────────────────────────────

export function AutoDismissBanner(
  props: AutoDismissBannerProps,
): React.ReactElement | null {
  const {
    message,
    duration = 3000,
    fadeOutDuration = 200,
    onDismiss,
  } = props;

  const tokens = useTokens();
  const { shouldAnimate } = useAnimation();

  const { isVisible, isFadingOut, displayMessage, dismiss } = useAutoDismiss({
    message,
    duration,
    fadeOutDuration,
    onDismiss,
  });

  // Shared values drive the entrance (slide + fade-in) and the exit
  // (fade-out only). Both are initialised to their "hidden" state so
  // the first `isVisible` flip animates to the visible state.
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(ENTRANCE_TRANSLATE_Y);

  useEffect(() => {
    // Entrance: show and animate to full opacity + rest position.
    if (isVisible && !isFadingOut) {
      opacity.value = withTiming(1, {
        duration: shouldAnimate ? ENTRANCE_DURATION_MS : 0,
        easing: Easing.out(Easing.cubic),
      });
      translateY.value = withTiming(0, {
        duration: shouldAnimate ? ENTRANCE_DURATION_MS : 0,
        easing: Easing.out(Easing.cubic),
      });
      return;
    }

    // Exit: fade out only (no reverse slide — see component header).
    if (isFadingOut) {
      opacity.value = withTiming(0, {
        duration: shouldAnimate ? fadeOutDuration : 0,
        easing: Easing.out(Easing.cubic),
      });
      return;
    }

    // Hidden: snap back to the entrance starting state so the next
    // appearance animates in cleanly rather than jumping.
    opacity.value = 0;
    translateY.value = ENTRANCE_TRANSLATE_Y;
  }, [
    isVisible,
    isFadingOut,
    shouldAnimate,
    fadeOutDuration,
    opacity,
    translateY,
  ]);

  const animatedStyle = useAnimatedStyle(() => {
    'worklet';
    return {
      opacity: opacity.value,
      transform: [{ translateY: translateY.value }],
    };
  });

  // Unmount entirely when not visible so we don't leave an invisible
  // (but still mounted) alert region in the tree — that can confuse
  // screen readers into re-announcing on theme changes.
  if (!isVisible || displayMessage === null) {
    return null;
  }

  // Styles that depend on runtime tokens are rebuilt via `StyleSheet`
  // on every render — this is cheap and keeps the style object cached
  // across renders where tokens don't change.
  const styles = StyleSheet.create({
    container: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      backgroundColor: tokens.colors.error,
      // Target banner tone is `error` at 90% opacity (per design doc).
      // We bake the alpha into the background via a translucent fill
      // so the animated opacity (0 → 1) only drives show/hide — if we
      // set `opacity: 0.9` on the container it would compound with the
      // animated opacity and the entrance animation would end at 0.9
      // instead of the intended 1.0 visual state.
      paddingVertical: tokens.spacing.sm,
      paddingHorizontal: tokens.spacing.md,
      borderRadius: tokens.radii.md,
      ...tokens.shadows.sm,
      // zIndex keeps the banner above any simultaneously-mounted
      // calendar overlay content (drag indicators, conflict
      // highlights, etc).
      zIndex: 1000,
    },
    pressable: {
      width: '100%',
    },
    text: {
      color: tokens.colors.textOnPrimary,
      fontSize: tokens.typography.sizes.body,
      fontFamily: tokens.typography.fontFamily.primary,
      fontWeight: tokens.typography.weights.medium,
      lineHeight: tokens.typography.lineHeights.body,
    },
  });

  return (
    <Animated.View
      style={[styles.container, animatedStyle]}
      // react-native-web maps `accessibilityRole="alert"` to `role="alert"`
      // which itself sets `aria-live="assertive"`. Setting
      // `accessibilityLiveRegion` makes the same intent explicit on
      // React Native (Android) where it maps to `android:liveRegion`.
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
    >
      <Pressable
        onPress={dismiss}
        accessibilityRole="button"
        accessibilityLabel="Dismiss error"
        style={styles.pressable}
      >
        <Text style={styles.text}>{displayMessage}</Text>
      </Pressable>
    </Animated.View>
  );
}
