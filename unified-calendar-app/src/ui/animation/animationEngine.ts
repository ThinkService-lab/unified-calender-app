/**
 * Animation Engine — shared spring configuration and motion utilities.
 *
 * Provides a single, consistent motion curve used by all animated
 * components in the app (`damping: 15, stiffness: 150, mass: 1`) and gates
 * every animation behind the user's `prefers-reduced-motion` setting so
 * accessibility requirements are satisfied by default.
 *
 * All animations run on the native UI thread via `react-native-reanimated`
 * worklets (Req 2.1). When reduced motion is active, `withMotion` resolves
 * values instantly via `withTiming(… , { duration: 0 })` instead of a
 * spring (Req 2.5).
 *
 * Requirements: 2.1, 2.5, 2.6
 */

import { withSpring, withTiming } from 'react-native-reanimated';
import type { AnimatableValue } from 'react-native-reanimated';
import { useReducedMotion } from '../accessibility/useAccessibility';

// ─── Configuration ───────────────────────────────────────────────────────────

/**
 * Default spring configuration for all app animations. Centralising these
 * values here keeps motion curves consistent across EventCards, view mode
 * switchers, micro-interactions, and gesture controllers.
 */
export const SPRING_CONFIG = {
  damping: 15,
  stiffness: 150,
  mass: 1,
} as const;

/**
 * Structural shape of a spring configuration. Widened from
 * `typeof SPRING_CONFIG` (which uses literal `15 | 150 | 1` types due to
 * the `as const` assertion) so callers can pass arbitrary numeric
 * overrides without fighting TypeScript's literal narrowing.
 */
export interface SpringConfig {
  damping: number;
  stiffness: number;
  mass: number;
}

/** Instant timing config — resolves the value with no animation at all. */
const INSTANT_TIMING = { duration: 0 } as const;

/**
 * Shape of the animation configuration object. Exported so other modules
 * (view transitions, onboarding) can reference the canonical duration set
 * without redefining values.
 */
export interface AnimationConfig {
  /** Default spring config for all animations. */
  defaultSpring: typeof SPRING_CONFIG;
  /** Timing durations, in milliseconds. */
  durations: {
    instant: 0;
    fast: 100;
    normal: 200;
    slow: 300;
    viewTransition: 350;
    entrance: 400;
  };
}

/** Canonical set of timing durations used across the app. */
export const ANIMATION_CONFIG: AnimationConfig = {
  defaultSpring: SPRING_CONFIG,
  durations: {
    instant: 0,
    fast: 100,
    normal: 200,
    slow: 300,
    viewTransition: 350,
    entrance: 400,
  },
};

// ─── useAnimation hook ───────────────────────────────────────────────────────

/** Return type of the `useAnimation` hook. */
export interface UseAnimationReturn {
  /**
   * `false` when the user has `prefers-reduced-motion` enabled — callers
   * should skip any non-essential decorative motion in that case.
   */
  shouldAnimate: boolean;
  /**
   * Spring configuration suitable for passing to `withSpring`. When reduced
   * motion is active, this object is an instant-timing config so callers
   * that pass it verbatim to an animated style still get instant updates.
   */
  springConfig: typeof SPRING_CONFIG | typeof INSTANT_TIMING;
  /**
   * Drive a shared value to `toValue` using the shared spring config, or
   * instantly when reduced motion is active. Caller may override specific
   * spring parameters (damping, stiffness, mass) via the optional config.
   *
   * The return is a Reanimated animation descriptor (`AnimatableValue`),
   * NOT a plain `number` — it MUST be assigned to a `SharedValue.value`
   * (typically inside `useAnimatedStyle` or as the RHS of a shared value
   * assignment). Trying to use it as a number in any other context will
   * not produce a usable result.
   *
   * Must be called from inside a worklet context (e.g., inside
   * `useAnimatedStyle` or as the RHS of a `sharedValue.value = …`) —
   * `withSpring` and `withTiming` are themselves worklets so the returned
   * value can be assigned directly to a `sharedValue`.
   */
  withMotion: (
    toValue: number,
    config?: Partial<SpringConfig>,
  ) => AnimatableValue;
}

/**
 * Hook that returns animation utilities that automatically respect the
 * user's `prefers-reduced-motion` setting.
 *
 * Usage:
 *   const { shouldAnimate, withMotion } = useAnimation();
 *   const animatedStyle = useAnimatedStyle(() => ({
 *     transform: [{ scale: withMotion(isPressed.value ? 0.97 : 1) }],
 *   }));
 *
 * When `shouldAnimate` is `false`, `withMotion` resolves every target
 * value instantly via a zero-duration timing animation, satisfying the
 * "instant state changes" clause of Req 2.5. The boolean flag is also
 * exposed so callers that render conditional animated UI (e.g., a border
 * highlight instead of a lift animation) can branch on it directly.
 */
export function useAnimation(): UseAnimationReturn {
  const reducedMotion = useReducedMotion();
  const shouldAnimate = !reducedMotion;

  const springConfig = shouldAnimate ? SPRING_CONFIG : INSTANT_TIMING;

  function withMotion(
    toValue: number,
    config?: Partial<SpringConfig>,
  ): AnimatableValue {
    'worklet';
    if (!shouldAnimate) {
      // Resolve the target value with no animation — equivalent to a
      // direct assignment but preserves the worklet call-shape expected
      // by `useAnimatedStyle` consumers.
      return withTiming(toValue, INSTANT_TIMING);
    }
    return withSpring(toValue, { ...SPRING_CONFIG, ...(config ?? {}) });
  }

  return { shouldAnimate, springConfig, withMotion };
}
