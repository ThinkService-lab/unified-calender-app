/**
 * Micro-Interaction System — small, purposeful animations applied to UI
 * actions throughout the calendar.
 *
 * Each animation is exposed as its own top-level hook (`useEventCreatedStyle`,
 * `useVisibilityToggleStyle`, etc.) that owns its shared values and returns
 * an `AnimatedStyle<ViewStyle>` ready to compose with an `<Animated.View>`.
 * Consumers that only need one animation should import the specific flat
 * hook — this is the recommended API.
 *
 * `useMicroInteractions()` is a thin aggregator that exposes the same
 * seven hooks as object fields. It is preserved so Task 18.1 wiring text
 * (`const { eventCreated } = useMicroInteractions(); … eventCreated(active)`)
 * continues to compose. Because each field is a direct reference to its
 * flat hook (not a closure re-calling it), the consumer's invocation
 * (`eventCreated(active)`) is itself the hook call — it runs at the
 * consumer's component body, not inside this file — so the Rules of
 * Hooks are honored as long as the consumer does not call it
 * conditionally. See JSDoc on `MicroInteractions` below for the full
 * contract.
 *
 * Motion curves (Req 2.6, design Key Decision #2):
 *
 *   The shared spring config (`damping: 15, stiffness: 150, mass: 1`)
 *   is the default across the app. Four interactions use `withSpring`
 *   with that config: `eventCreated`, `pressDown`, `pressRelease`,
 *   `eventDeleted` — these feel natural as springs because their "done"
 *   state is a visual rest position, not a deadline.
 *
 *   Three interactions use `withTiming` with a specific duration
 *   because their Acceptance Criteria require a precise completion time:
 *     - `visibilityToggle` (Req 2.3 — 200ms)
 *     - `syncAppear` (Req 7.4 — 300ms)
 *     - `pullToRefresh` (linear rotation by definition)
 *
 *   All animations resolve instantly (`withTiming(…, { duration: 0 })`)
 *   when reduced motion is active (Req 2.5, 7.5).
 *
 * All animations honour the user's `prefers-reduced-motion` setting via
 * the Animation Engine's `shouldAnimate` flag.
 *
 * Requirements: 2.2, 2.3, 2.6, 7.1, 7.2, 7.3, 7.4, 7.5
 */

import {
  Easing,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withSpring,
  withTiming,
  withRepeat,
} from 'react-native-reanimated';
import { useEffect } from 'react';
import type { AnimatedStyle } from 'react-native-reanimated';
import type { ViewStyle } from 'react-native';

import { SPRING_CONFIG, useAnimation } from './animationEngine';

// ─── Public types ────────────────────────────────────────────────────────────

export type AnimatedStyleHook = (
  active: boolean,
) => AnimatedStyle<ViewStyle>;

/** Direction of the visibility transition triggered for an EventCard. */
export type VisibilityTransitionDirection = 'fading-in' | 'fading-out';

/** The style hook used for visibility transitions accepts a direction. */
export type VisibilityToggleStyleHook = (
  direction: VisibilityTransitionDirection | 'idle',
) => AnimatedStyle<ViewStyle>;

/** The style hook used for pull-to-refresh takes a boolean `isSpinning`. */
export type PullToRefreshStyleHook = (
  isSpinning: boolean,
) => AnimatedStyle<ViewStyle>;

/**
 * The set of animated-style hooks returned by `useMicroInteractions()`.
 *
 * IMPORTANT — Rules of Hooks contract:
 *   Each field is itself a hook (it calls `useSharedValue`,
 *   `useEffect`, and `useAnimatedStyle` internally). Consumers must
 *   therefore:
 *
 *     1. Destructure the aggregator at the top of their component body,
 *        NOT inside a conditional or loop.
 *     2. Invoke the field on EVERY render with some argument — never
 *        conditionally skip the call.
 *
 *   If a consumer wants to opt-out of an animation for a specific
 *   render, they should pass a "neutral" argument (e.g. `false` for
 *   `AnimatedStyleHook`, `'idle'` for `VisibilityToggleStyleHook`)
 *   instead of not calling the field at all. The idle-state logic in
 *   each flat hook handles this cleanly — a `false` or `'idle'`
 *   argument resolves to the hook's default resting style.
 *
 *   Consumers that need just one animation should import its flat hook
 *   (e.g. `useEventCreatedStyle`) directly rather than routing through
 *   this aggregator — it's both cheaper and harder to misuse.
 */
export interface MicroInteractions {
  /** Event creation confirmation — scale-up + fade-in (spring). */
  eventCreated: AnimatedStyleHook;
  /** Calendar toggle — fade-out/fade-in (200ms). */
  visibilityToggle: VisibilityToggleStyleHook;
  /** Press down — scale to 0.97 (spring). */
  pressDown: AnimatedStyleHook;
  /** Press release — spring back to 1.0 (spring). */
  pressRelease: AnimatedStyleHook;
  /** Delete — shrink + fade-out (spring). */
  eventDeleted: AnimatedStyleHook;
  /** Sync event — slide-in-from-right + fade-in (300ms). */
  syncAppear: AnimatedStyleHook;
  /** Pull-to-refresh — rotating indicator. */
  pullToRefresh: PullToRefreshStyleHook;
}

// ─── Duration constants (ms) — used by the timing-based interactions ─────────

const DURATION_VISIBILITY_TOGGLE = 200; // Req 2.3
const DURATION_SYNC_APPEAR = 300; // Req 7.4
const DURATION_PULL_TO_REFRESH_ROTATION = 900; // one full rotation

/** Settle duration when pullToRefresh stops spinning. */
const DURATION_PULL_TO_REFRESH_SETTLE = 150;

// ─── Flat hooks — one per micro-interaction ──────────────────────────────────

/**
 * Event creation confirmation: scale from 0.92 → 1.0 with opacity 0 → 1
 * using the shared spring config (Req 2.6). Used for EventCards that
 * just materialized from a user-initiated create action.
 *
 * Requirements: 2.2, 7.* (entry animation)
 */
export function useEventCreatedStyle(
  active: boolean,
): AnimatedStyle<ViewStyle> {
  const { shouldAnimate } = useAnimation();
  const scale = useSharedValue(active ? 1 : 0.92);
  const opacity = useSharedValue(active ? 1 : 0);

  useEffect(() => {
    const targetScale = active ? 1 : 0.92;
    const targetOpacity = active ? 1 : 0;
    if (shouldAnimate) {
      scale.value = withSpring(targetScale, SPRING_CONFIG);
      opacity.value = withSpring(targetOpacity, SPRING_CONFIG);
    } else {
      scale.value = withTiming(targetScale, { duration: 0 });
      opacity.value = withTiming(targetOpacity, { duration: 0 });
    }
  }, [active, scale, opacity, shouldAnimate]);

  return useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));
}

/**
 * Visibility toggle: fade between opacity 0 and 1 over 200ms whenever
 * `direction` is 'fading-in' or 'fading-out'. When `direction` is
 * 'idle' (the default resting state), the style simply resolves to
 * fully-visible so callers can pass `'idle'` to "opt out" without
 * violating the Rules of Hooks.
 *
 * Uses `withTiming` (not spring) because Req 2.3 specifies a 200ms
 * completion ceiling that a spring's settling curve would not
 * reliably hit.
 *
 * Requirement: 2.3
 */
export function useVisibilityToggleStyle(
  direction: VisibilityTransitionDirection | 'idle',
): AnimatedStyle<ViewStyle> {
  const { shouldAnimate } = useAnimation();
  const opacity = useSharedValue(direction === 'fading-out' ? 1 : 0);

  useEffect(() => {
    if (direction === 'idle') {
      // No animation — EventCard stays fully visible.
      opacity.value = 1;
      return;
    }
    const from = direction === 'fading-in' ? 0 : 1;
    const to = direction === 'fading-in' ? 1 : 0;
    opacity.value = from;
    opacity.value = withTiming(to, {
      duration: shouldAnimate ? DURATION_VISIBILITY_TOGGLE : 0,
      easing: Easing.out(Easing.cubic),
    });
  }, [direction, opacity, shouldAnimate]);

  return useAnimatedStyle(() => ({ opacity: opacity.value }));
}

/**
 * Press-down feedback: scale to 0.97 via the shared spring config when
 * `active` is true. Pair with {@link usePressReleaseStyle} via the
 * same `active` flag on an `<Animated.View>` that wraps the EventCard.
 *
 * Requirement: 7.1
 */
export function usePressDownStyle(active: boolean): AnimatedStyle<ViewStyle> {
  const { shouldAnimate } = useAnimation();
  const scale = useSharedValue(active ? 0.97 : 1);

  useEffect(() => {
    const target = active ? 0.97 : 1;
    scale.value = shouldAnimate
      ? withSpring(target, SPRING_CONFIG)
      : withTiming(target, { duration: 0 });
  }, [active, scale, shouldAnimate]);

  return useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));
}

/**
 * Press-release feedback: spring back to scale 1.0 when `active` flips
 * true (caller should set it to true on pointer release). Starts from
 * 0.97 to guarantee a visible spring even if `usePressDownStyle` was
 * not mounted (e.g. in quick-tap interactions).
 *
 * Requirement: 7.2
 */
export function usePressReleaseStyle(active: boolean): AnimatedStyle<ViewStyle> {
  const { shouldAnimate } = useAnimation();
  const scale = useSharedValue(1);

  useEffect(() => {
    if (active) {
      scale.value = 0.97;
    }
    scale.value = shouldAnimate
      ? withSpring(1, SPRING_CONFIG)
      : withTiming(1, { duration: 0 });
  }, [active, scale, shouldAnimate]);

  return useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));
}

/**
 * Delete confirmation: shrink (scale 1 → 0.8) and fade-out (opacity 1
 * → 0) via the shared spring config. When `active` is false, the
 * EventCard rests at scale 1 / opacity 1 — so the animation can be
 * cancelled cleanly by reverting the flag.
 *
 * Requirement: 7.3
 */
export function useEventDeletedStyle(
  active: boolean,
): AnimatedStyle<ViewStyle> {
  const { shouldAnimate } = useAnimation();
  const scale = useSharedValue(1);
  const opacity = useSharedValue(1);

  useEffect(() => {
    const targetScale = active ? 0.8 : 1;
    const targetOpacity = active ? 0 : 1;
    if (shouldAnimate) {
      scale.value = withSpring(targetScale, SPRING_CONFIG);
      opacity.value = withSpring(targetOpacity, SPRING_CONFIG);
    } else {
      scale.value = withTiming(targetScale, { duration: 0 });
      opacity.value = withTiming(targetOpacity, { duration: 0 });
    }
  }, [active, scale, opacity, shouldAnimate]);

  return useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));
}

/**
 * Sync-arrival animation: slide in from +24px right and fade-in over
 * 300ms. Uses `withTiming` (not spring) because Req 7.4 sets a 300ms
 * completion target.
 *
 * Requirement: 7.4
 */
export function useSyncAppearStyle(active: boolean): AnimatedStyle<ViewStyle> {
  const { shouldAnimate } = useAnimation();
  const translateX = useSharedValue(active ? 24 : 0);
  const opacity = useSharedValue(active ? 0 : 1);

  useEffect(() => {
    if (active) {
      // Snap to the off-screen starting state before animating.
      translateX.value = 24;
      opacity.value = 0;
      const duration = shouldAnimate ? DURATION_SYNC_APPEAR : 0;
      translateX.value = withTiming(0, {
        duration,
        easing: Easing.out(Easing.cubic),
      });
      opacity.value = withTiming(1, {
        duration,
        easing: Easing.out(Easing.cubic),
      });
    } else {
      translateX.value = 0;
      opacity.value = 1;
    }
  }, [active, translateX, opacity, shouldAnimate]);

  return useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateX: translateX.value }],
  }));
}

/**
 * Pull-to-refresh rotating indicator. Rotates continuously while
 * `isSpinning` is true; settles to 0deg when it flips false. Rotation
 * is intentionally linear (no spring) because rotation-by-spring is
 * visually jittery for indicators.
 *
 * Requirement: 2.4 (pull-to-refresh)
 */
export function usePullToRefreshStyle(
  isSpinning: boolean,
): AnimatedStyle<ViewStyle> {
  const { shouldAnimate } = useAnimation();
  const rotation = useSharedValue(0);

  useEffect(() => {
    if (isSpinning && shouldAnimate) {
      rotation.value = 0;
      rotation.value = withRepeat(
        withTiming(360, {
          duration: DURATION_PULL_TO_REFRESH_ROTATION,
          easing: Easing.linear,
        }),
        -1,
        false,
      );
    } else {
      rotation.value = withTiming(0, {
        duration: shouldAnimate ? DURATION_PULL_TO_REFRESH_SETTLE : 0,
      });
    }
  }, [isSpinning, rotation, shouldAnimate]);

  // `useDerivedValue` builds the `${deg}deg` string inside a worklet so
  // the animated style does not allocate a new string on every frame.
  const rotateDeg = useDerivedValue(() => `${rotation.value}deg`);

  return useAnimatedStyle(() => ({
    transform: [{ rotate: rotateDeg.value }],
  }));
}

// ─── Aggregator hook ─────────────────────────────────────────────────────────

/**
 * Convenience aggregator exposing all seven micro-interaction flat
 * hooks as object fields. Preserved for Task 18.1 wiring ergonomics:
 *
 *   const { eventCreated, pressDown, pressRelease } = useMicroInteractions();
 *   const createdStyle = eventCreated(isNew);
 *   const pressStyle = pressDown(isPressed);
 *
 * Each field is a DIRECT reference to its flat hook — not a closure
 * that re-calls it — so the consumer's invocation is itself the hook
 * call and the Rules of Hooks are honored as long as the consumer
 * follows the contract documented on {@link MicroInteractions}.
 *
 * Consumers that need exactly one animation should prefer the flat
 * hook (`useEventCreatedStyle`, etc.) since it is cheaper and harder
 * to misuse.
 */
export function useMicroInteractions(): MicroInteractions {
  return {
    eventCreated: useEventCreatedStyle,
    visibilityToggle: useVisibilityToggleStyle,
    pressDown: usePressDownStyle,
    pressRelease: usePressReleaseStyle,
    eventDeleted: useEventDeletedStyle,
    syncAppear: useSyncAppearStyle,
    pullToRefresh: usePullToRefreshStyle,
  };
}
