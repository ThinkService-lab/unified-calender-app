/**
 * Animation Error Boundary — catches Reanimated worklet crashes and
 * falls back to non-animated rendering.
 *
 * React error boundaries must be class components. When a Reanimated
 * worklet throws (e.g., a shared value access on an unmounted component,
 * a worklet runtime crash), the error bubbles up as a regular JS error
 * that React's error boundary mechanism can catch.
 *
 * On error the boundary:
 *   1. Logs the error via `console.error`.
 *   2. Calls the optional `onError` callback for external reporting.
 *   3. Re-renders children wrapped in `AnimationFallbackContext.Provider`
 *      with `shouldAnimate: false` — downstream consumers that read
 *      this context (via `useAnimationFallback`) will skip animations.
 *
 * The boundary does NOT unmount children. It re-renders them with
 * animations disabled so the user still sees their calendar content.
 *
 * Requirements: 2.1, 2.5
 */

import React, { createContext, useContext } from 'react';

// ─── Context ─────────────────────────────────────────────────────────────────

/**
 * Context that signals whether animations should be skipped due to an
 * upstream error boundary catching a Reanimated crash. Default is `true`
 * (animations enabled) — only flipped to `false` inside the error
 * boundary's fallback render path.
 */
export const AnimationFallbackContext = createContext<boolean>(true);

/**
 * Hook that reads the animation fallback context. Returns `true` when
 * animations are safe to run, `false` when an upstream error boundary
 * has caught a worklet crash and animations should be skipped.
 *
 * Consumers can combine this with `useAnimation().shouldAnimate` to
 * determine the final animation decision:
 *
 *   const { shouldAnimate: motionOk } = useAnimation();
 *   const fallbackOk = useAnimationFallback();
 *   const animate = motionOk && fallbackOk;
 */
export function useAnimationFallback(): boolean {
  return useContext(AnimationFallbackContext);
}

// ─── Props ───────────────────────────────────────────────────────────────────

export interface AnimationErrorBoundaryProps {
  children?: React.ReactNode;
  /**
   * Optional custom fallback UI rendered instead of children when an
   * error is caught. When omitted the boundary re-renders children
   * with animations disabled (the default and recommended behaviour).
   */
  fallback?: React.ReactNode;
  /**
   * Optional callback invoked when an error is caught. Useful for
   * external error reporting (e.g., Sentry, CloudWatch).
   */
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
}

interface AnimationErrorBoundaryState {
  hasError: boolean;
}

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * React error boundary that catches Reanimated worklet crashes and
 * degrades gracefully to non-animated rendering.
 *
 * Usage:
 *   <AnimationErrorBoundary onError={reportToSentry}>
 *     <DayView ... />
 *   </AnimationErrorBoundary>
 */
export class AnimationErrorBoundary extends React.Component<
  AnimationErrorBoundaryProps,
  AnimationErrorBoundaryState
> {
  constructor(props: AnimationErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(_error: Error): AnimationErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    // Log the error so it appears in dev tools / production logs.
    console.error(
      '[AnimationErrorBoundary] Caught animation error:',
      error,
      errorInfo,
    );

    // Notify external error reporting if configured.
    this.props.onError?.(error, errorInfo);
  }

  render(): React.ReactNode {
    const { hasError } = this.state;
    const { children, fallback } = this.props;

    if (hasError) {
      // If a custom fallback is provided, render it instead of children.
      // Otherwise re-render children with animations disabled via context.
      const content = fallback !== undefined ? fallback : children;

      return React.createElement(
        AnimationFallbackContext.Provider,
        { value: false },
        content,
      );
    }

    // No error — render children normally. The context default is `true`
    // so no extra provider is needed.
    return children;
  }
}
