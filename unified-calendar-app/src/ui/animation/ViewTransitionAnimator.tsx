/**
 * View Transition Animator — crossfade + horizontal slide transitions
 * between calendar view modes, plus a zoom-in transition for
 * Month_View day tap → Day_View navigation.
 *
 * All animations run on the native UI thread via `react-native-reanimated`
 * worklets. When `prefers-reduced-motion` is active, every transition
 * resolves instantly (Req 3.4). Additional view switch requests that
 * arrive while a transition is in progress are queued — the last
 * requested view replays automatically when the current transition
 * completes (Req 3.5). This prevents the user from needing to click
 * a second time if they switch views during an animation.
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5
 */

import React, { useCallback, useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
  runOnJS,
} from 'react-native-reanimated';
import type { ViewStyle } from 'react-native';

import { useAnimation, ANIMATION_CONFIG } from './animationEngine';
import type { DefaultViewMode } from '../types';

// ─── View ordering for slide direction ───────────────────────────────────────

/**
 * Ordered list of view modes used to determine horizontal slide direction.
 * Views to the right in this list slide in from the right; views to the
 * left slide in from the left.
 */
const VIEW_ORDER: readonly DefaultViewMode[] = ['day', 'week', 'month', 'agenda'];

function viewIndex(mode: DefaultViewMode): number {
  return VIEW_ORDER.indexOf(mode);
}

// ─── Transition duration ─────────────────────────────────────────────────────

/** Each view transition completes within 350ms (Req 3.2). */
const TRANSITION_DURATION = ANIMATION_CONFIG.durations.viewTransition; // 350

/**
 * Horizontal slide distance in pixels. Kept small so the motion is
 * "subtle" per Req 3.1 — the crossfade carries most of the visual weight.
 */
const SLIDE_OFFSET = 60;

// ─── AnimatedStyleProp type ──────────────────────────────────────────────────

/** Animated style type returned to children render function. */
export type AnimatedStyleProp = ReturnType<typeof useAnimatedStyle>;

// ─── ViewTransitionAnimator ──────────────────────────────────────────────────

export interface ViewTransitionAnimatorProps {
  /** Current active view mode. */
  activeView: DefaultViewMode;
  /** Children render function receiving the animated style for the active view. */
  children: (animatedStyle: AnimatedStyleProp) => React.ReactNode;
}

/**
 * Wraps calendar views and orchestrates crossfade + horizontal slide
 * transitions when `activeView` changes.
 *
 * - Completes within 350ms (Req 3.2).
 * - Ignores additional view switch requests while a transition is in
 *   progress (Req 3.5).
 * - Skips all animations when Reduced_Motion_Mode is active (Req 3.4).
 */
export function ViewTransitionAnimator({
  activeView,
  children,
}: ViewTransitionAnimatorProps): React.ReactElement {
  const { shouldAnimate } = useAnimation();

  // Shared values driving the crossfade + slide.
  const opacity = useSharedValue(1);
  const translateX = useSharedValue(0);

  // Track whether a transition is currently running (Req 3.5).
  const isTransitioning = useRef(false);

  // Track the last committed view so we can detect direction.
  const committedView = useRef<DefaultViewMode>(activeView);

  // Queue the most recent view request that arrived during a transition.
  // When the current transition completes, if pendingView differs from
  // committedView, a new transition kicks off automatically.
  const pendingView = useRef<DefaultViewMode | null>(null);

  // Ref holding the phase-two timeout so the effect cleanup can cancel it.
  const activeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Use a ref for the transition runner so onTransitionEnd can call it
  // without a circular useCallback dependency.
  const runTransitionRef = useRef<(targetView: DefaultViewMode) => void>(() => {});

  // Callback invoked on the JS thread when the transition completes.
  // If a view was queued during the transition, replay it now.
  const onTransitionEnd = useCallback(() => {
    isTransitioning.current = false;
    activeTimeoutRef.current = null;

    const queued = pendingView.current;
    if (queued !== null && queued !== committedView.current) {
      pendingView.current = null;
      runTransitionRef.current(queued);
    } else {
      pendingView.current = null;
    }
  }, []);

  // ── Transition runner ───────────────────────────────────────────────────
  const runTransition = useCallback(
    (targetView: DefaultViewMode) => {
      const fromIndex = viewIndex(committedView.current);
      const toIndex = viewIndex(targetView);
      const direction = toIndex > fromIndex ? 1 : -1;

      // Commit the new view immediately so subsequent renders see it.
      committedView.current = targetView;

      // Req 3.4 — reduced motion: instant switch, no animation.
      if (!shouldAnimate) {
        opacity.value = 1;
        translateX.value = 0;
        return;
      }

      // Mark transition as in-progress.
      isTransitioning.current = true;

      // Phase 1: fade-out + slide the outgoing view away.
      opacity.value = withTiming(0, {
        duration: TRANSITION_DURATION / 2,
        easing: Easing.out(Easing.ease),
      });
      translateX.value = withTiming(-direction * SLIDE_OFFSET, {
        duration: TRANSITION_DURATION / 2,
        easing: Easing.out(Easing.ease),
      });

      // Phase 2: after half the duration, snap to the incoming side and
      // fade-in + slide to centre.
      const halfDuration = TRANSITION_DURATION / 2;
      const phaseTwo = setTimeout(() => {
        // Jump to the opposite side (no animation).
        translateX.value = direction * SLIDE_OFFSET;
        opacity.value = 0;

        // Animate in.
        opacity.value = withTiming(1, {
          duration: halfDuration,
          easing: Easing.in(Easing.ease),
        });
        translateX.value = withTiming(
          0,
          {
            duration: halfDuration,
            easing: Easing.in(Easing.ease),
          },
          (finished) => {
            'worklet';
            if (finished) {
              runOnJS(onTransitionEnd)();
            }
          },
        );
      }, halfDuration);

      // Store the timeout id so the cleanup can cancel it.
      activeTimeoutRef.current = phaseTwo;
    },
    [shouldAnimate, opacity, translateX, onTransitionEnd],
  );

  // Keep the ref in sync so onTransitionEnd can call the latest version.
  runTransitionRef.current = runTransition;

  useEffect(() => {
    // Nothing to do if the view hasn't actually changed.
    if (activeView === committedView.current) return;

    // Req 3.5 — queue the request if a transition is in progress.
    // The last queued view wins (intermediate requests are dropped).
    if (isTransitioning.current) {
      pendingView.current = activeView;
      return;
    }

    runTransition(activeView);

    return () => {
      if (activeTimeoutRef.current !== null) {
        clearTimeout(activeTimeoutRef.current);
        activeTimeoutRef.current = null;
      }
    };
  }, [activeView, runTransition]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateX: translateX.value }],
  }));

  return React.createElement(View, { style: styles.container }, children(animatedStyle));
}

// ─── useZoomTransition ───────────────────────────────────────────────────────

export interface ZoomTransitionConfig {
  /** Bounding rect of the tapped day cell in the parent coordinate space. */
  originRect: { x: number; y: number; width: number; height: number };
  /** Called when the zoom-in transition completes. */
  onComplete: () => void;
}

export interface ZoomTransitionReturn {
  /** Animated style to apply to the incoming Day_View container. */
  animatedStyle: AnimatedStyleProp;
  /** Trigger the zoom-in transition. */
  startTransition: () => void;
}

/**
 * Zoom-in transition for Month_View day tap → Day_View navigation (Req 3.3).
 *
 * Animates from the tapped cell's position/size to full-screen Day_View.
 * Completes within 350ms. Skips animation when reduced motion is active.
 */
export function useZoomTransition(
  config: ZoomTransitionConfig,
): ZoomTransitionReturn {
  const { shouldAnimate } = useAnimation();

  // Scale starts small (cell-sized) and grows to 1 (full screen).
  const scale = useSharedValue(0);
  // Opacity fades in during the zoom.
  const zoomOpacity = useSharedValue(0);
  // Translate from the cell origin to centre.
  const originX = useSharedValue(config.originRect.x);
  const originY = useSharedValue(config.originRect.y);

  const onCompleteRef = useRef(config.onComplete);
  onCompleteRef.current = config.onComplete;

  const handleComplete = useCallback(() => {
    onCompleteRef.current();
  }, []);

  const startTransition = useCallback(() => {
    if (!shouldAnimate) {
      // Req 3.4 — instant switch.
      scale.value = 1;
      zoomOpacity.value = 1;
      originX.value = 0;
      originY.value = 0;
      handleComplete();
      return;
    }

    // Reset to origin.
    scale.value = 0.15;
    zoomOpacity.value = 0;
    originX.value = config.originRect.x;
    originY.value = config.originRect.y;

    // Animate to full screen.
    scale.value = withTiming(1, {
      duration: TRANSITION_DURATION,
      easing: Easing.out(Easing.cubic),
    });
    zoomOpacity.value = withTiming(1, {
      duration: TRANSITION_DURATION * 0.6,
      easing: Easing.out(Easing.ease),
    });
    originX.value = withTiming(0, {
      duration: TRANSITION_DURATION,
      easing: Easing.out(Easing.cubic),
    });
    originY.value = withTiming(
      0,
      {
        duration: TRANSITION_DURATION,
        easing: Easing.out(Easing.cubic),
      },
      (finished) => {
        'worklet';
        if (finished) {
          runOnJS(handleComplete)();
        }
      },
    );
  }, [
    shouldAnimate,
    scale,
    zoomOpacity,
    originX,
    originY,
    config.originRect,
    handleComplete,
  ]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: zoomOpacity.value,
    transform: [
      { translateX: originX.value },
      { translateY: originY.value },
      { scale: scale.value },
    ],
  }));

  return { animatedStyle, startTransition };
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    overflow: 'hidden' as ViewStyle['overflow'],
  },
});
