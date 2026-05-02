/**
 * SwipeNavigationHost — double-buffer wrapper that renders the current,
 * previous, and next views so the slide animation from
 * `useSwipeNavigation` is visible during horizontal swipe navigation.
 *
 * Renders three absolutely-positioned layers:
 *   - Previous view at -100% offset
 *   - Current view at 0
 *   - Next view at +100% offset
 *
 * During a swipe, `animatedStyle` from `useSwipeNavigation` is applied to
 * the current layer and `incomingStyle` to whichever neighbor matches the
 * swipe direction. The non-matching neighbor stays hidden (opacity 0).
 *
 * On swipe commit the appropriate navigation callback fires, animated
 * values reset, and the newly-committed view becomes the current layer.
 * The outgoing view is unmounted once the slide completes so screen
 * readers see only the final view in the accessibility tree.
 *
 * Reduced motion: skips the slide animation entirely — the navigation
 * callback fires synchronously on swipe detection and the host re-renders
 * with the new `anchorDate`.
 *
 * Reads `isDragActive` from `useGestureContext()` and passes it as
 * `suppressSwipe` to `useSwipeNavigation` so swipe navigation is
 * suppressed during drag-to-reschedule or drag-to-resize gestures.
 *
 * Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6
 */

import React, { useCallback, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { ViewStyle } from 'react-native';
import Animated from 'react-native-reanimated';
import { GestureDetector } from 'react-native-gesture-handler';

import { useSwipeNavigation } from './useSwipeNavigation';
import { useGestureContext } from '../../stores/gestureContextStore';

// ─── Date arithmetic helpers ─────────────────────────────────────────────────

/**
 * Compute the previous anchor date by subtracting one unit.
 * Pure function — no external date library dependency.
 */
function getPreviousDate(date: Date, unit: 'day' | 'week' | 'month'): Date {
  const d = new Date(date);
  switch (unit) {
    case 'day':
      d.setDate(d.getDate() - 1);
      break;
    case 'week':
      d.setDate(d.getDate() - 7);
      break;
    case 'month':
      d.setMonth(d.getMonth() - 1);
      break;
  }
  return d;
}

/**
 * Compute the next anchor date by adding one unit.
 */
function getNextDate(date: Date, unit: 'day' | 'week' | 'month'): Date {
  const d = new Date(date);
  switch (unit) {
    case 'day':
      d.setDate(d.getDate() + 1);
      break;
    case 'week':
      d.setDate(d.getDate() + 7);
      break;
    case 'month':
      d.setMonth(d.getMonth() + 1);
      break;
  }
  return d;
}

// ─── Props ───────────────────────────────────────────────────────────────────

export interface SwipeNavigationHostProps {
  /**
   * The current view's anchor date. When this changes (e.g., after a
   * swipe commits), the host snaps the incoming view into the current
   * slot and resets the animated styles.
   */
  anchorDate: Date;

  /**
   * Render function for a calendar view at a specific anchor date.
   * Called for the previous, current, and next views.
   */
  renderView: (anchorDate: Date) => React.ReactNode;

  /** Callback invoked when a forward swipe commits. */
  onNavigateForward: () => void;

  /** Callback invoked when a backward swipe commits. */
  onNavigateBack: () => void;

  /** Unit of navigation (used to compute prev/next anchor dates). */
  unit: 'day' | 'week' | 'month';
}

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * Double-buffer wrapper that renders three view layers and wires them to
 * the `useSwipeNavigation` hook's animated styles.
 */
export function SwipeNavigationHost({
  anchorDate,
  renderView,
  onNavigateForward,
  onNavigateBack,
  unit,
}: SwipeNavigationHostProps): React.ReactElement {
  // Req 15.6: suppress swipe when a drag gesture is active.
  const { isDragActive } = useGestureContext();

  // Track whether a transition is in progress so we can unmount the
  // outgoing view after the slide completes (accessibility).
  const [isTransitioning, setIsTransitioning] = useState(false);

  // Ref to track the last committed direction for unmounting logic
  // and for determining which neighbor receives the incomingStyle.
  // -1 = backward (prev layer is incoming), 1 = forward (next layer is incoming), 0 = idle.
  const committedDirectionRef = useRef<number>(0);

  // Navigation callbacks that also track transition state.
  const handleForward = useCallback(() => {
    committedDirectionRef.current = 1;
    setIsTransitioning(true);
    onNavigateForward();
    // After the anchorDate prop updates and React re-renders, the
    // transition is complete. We use a microtask to let the render
    // cycle finish before clearing the transitioning flag.
    requestAnimationFrame(() => {
      setIsTransitioning(false);
      committedDirectionRef.current = 0;
    });
  }, [onNavigateForward]);

  const handleBack = useCallback(() => {
    committedDirectionRef.current = -1;
    setIsTransitioning(true);
    onNavigateBack();
    requestAnimationFrame(() => {
      setIsTransitioning(false);
      committedDirectionRef.current = 0;
    });
  }, [onNavigateBack]);

  // Wire up the swipe navigation hook.
  const { gesture, animatedStyle, incomingStyle } = useSwipeNavigation({
    minDistance: 50,
    transitionDuration: 300,
    onNavigateForward: handleForward,
    onNavigateBack: handleBack,
    suppressSwipe: isDragActive,
  });

  // Compute previous and next anchor dates.
  const prevDate = useMemo(() => getPreviousDate(anchorDate, unit), [anchorDate, unit]);
  const nextDate = useMemo(() => getNextDate(anchorDate, unit), [anchorDate, unit]);

  // Determine whether to show/hide neighbors based on transition state.
  // During a transition, we keep both neighbors mounted but only the
  // relevant one is visible (the hook's incomingStyle handles positioning).
  // After the transition, we unmount the outgoing view for accessibility.
  const showPrev = !isTransitioning || committedDirectionRef.current !== 1;
  const showNext = !isTransitioning || committedDirectionRef.current !== -1;

  // Only the neighbor matching the swipe direction receives the animated
  // incomingStyle. The other neighbor stays at its default off-screen
  // position to avoid unnecessary animated work.
  const swipeDirection = committedDirectionRef.current;

  // Build the previous layer (off-screen left, hidden from screen readers).
  const prevLayer = showPrev
    ? React.createElement(
        Animated.View,
        {
          style: [
            styles.layer,
            styles.prevLayer,
            // Apply incomingStyle only when swiping backward (prev is incoming)
            swipeDirection === -1 ? incomingStyle : undefined,
          ],
          accessibilityElementsHidden: true,
          importantForAccessibility: 'no-hide-descendants' as const,
        },
        renderView(prevDate),
      )
    : null;

  // Build the current layer (primary visible view).
  const currentLayer = React.createElement(
    Animated.View,
    {
      style: [styles.layer, styles.currentLayer, animatedStyle],
      accessibilityElementsHidden: false,
      importantForAccessibility: 'yes' as const,
    },
    renderView(anchorDate),
  );

  // Build the next layer (off-screen right, hidden from screen readers).
  const nextLayer = showNext
    ? React.createElement(
        Animated.View,
        {
          style: [
            styles.layer,
            styles.nextLayer,
            // Apply incomingStyle only when swiping forward (next is incoming)
            swipeDirection === 1 ? incomingStyle : undefined,
          ],
          accessibilityElementsHidden: true,
          importantForAccessibility: 'no-hide-descendants' as const,
        },
        renderView(nextDate),
      )
    : null;

  return React.createElement(
    GestureDetector,
    { gesture },
    React.createElement(
      View,
      { style: styles.container },
      prevLayer,
      currentLayer,
      nextLayer,
    ),
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    overflow: 'hidden' as ViewStyle['overflow'],
  },
  layer: {
    ...StyleSheet.absoluteFillObject,
  },
  prevLayer: {
    // Default position: off-screen to the left.
    // The incomingStyle from useSwipeNavigation overrides translateX
    // during an active swipe.
    transform: [{ translateX: -9999 }],
  },
  currentLayer: {
    // Current view starts at origin. animatedStyle drives translateX
    // during swipe.
  },
  nextLayer: {
    // Default position: off-screen to the right.
    // The incomingStyle from useSwipeNavigation overrides translateX
    // during an active swipe.
    transform: [{ translateX: 9999 }],
  },
});
