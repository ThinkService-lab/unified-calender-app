/**
 * Animation system — barrel export.
 *
 * Requirements: 2.1, 2.2, 2.3, 2.5, 2.6, 7.1, 7.2, 7.3, 7.4, 7.5
 */

// Animation Engine
export {
  SPRING_CONFIG,
  ANIMATION_CONFIG,
  useAnimation,
} from './animationEngine';
export type {
  AnimationConfig,
  SpringConfig,
  UseAnimationReturn,
} from './animationEngine';

// Micro-Interaction System — flat hooks (primary API)
export {
  useEventCreatedStyle,
  useVisibilityToggleStyle,
  usePressDownStyle,
  usePressReleaseStyle,
  useEventDeletedStyle,
  useSyncAppearStyle,
  usePullToRefreshStyle,
} from './microInteractions';

// Micro-Interaction System — convenience aggregator
export { useMicroInteractions } from './microInteractions';
export type {
  MicroInteractions,
  AnimatedStyleHook,
  VisibilityTransitionDirection,
  VisibilityToggleStyleHook,
  PullToRefreshStyleHook,
} from './microInteractions';

// Account visibility transition trigger
export { useAccountVisibilityTransition } from './useAccountVisibilityTransition';
export type { AccountVisibilityTransitionState } from './useAccountVisibilityTransition';

// Animated event delete trigger
export { useAnimatedEventDelete } from './useAnimatedEventDelete';
export type { UseAnimatedEventDeleteReturn } from './useAnimatedEventDelete';

// Animation Error Boundary
export {
  AnimationErrorBoundary,
  AnimationFallbackContext,
  useAnimationFallback,
} from './AnimationErrorBoundary';
export type { AnimationErrorBoundaryProps } from './AnimationErrorBoundary';

// View Transition Animator
export { ViewTransitionAnimator, useZoomTransition } from './ViewTransitionAnimator';
export type {
  ViewTransitionAnimatorProps,
  ZoomTransitionConfig,
  ZoomTransitionReturn,
  AnimatedStyleProp,
} from './ViewTransitionAnimator';
