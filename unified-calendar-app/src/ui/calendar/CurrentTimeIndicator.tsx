/**
 * CurrentTimeIndicator — horizontal "now" line displayed on Day and Week
 * views at the vertical position corresponding to the current time.
 *
 * Styled with the Design_Token_System primary accent color
 * (`tokens.colors.primary`) and a small circular dot at the left edge.
 *
 * Position updates every 60 seconds via `setInterval`. On native,
 * `setNativeProps` mutates the view's `top` directly without a React
 * re-render. On web, `setNativeProps` is not available, so we fall back
 * to direct DOM manipulation via the underlying HTMLElement ref — this
 * still avoids a full React re-render of the parent view (Req 10.2).
 *
 * Only visible when `isCurrentDay` is `true` — in Week_View the parent
 * passes `false` for non-current-day columns so the line appears only
 * in the correct column (Req 10.3).
 *
 * Uses `React.createElement` instead of JSX to match the project's
 * `jsx: "react-native"` tsconfig setting.
 *
 * Requirements: 10.1, 10.2, 10.3
 */

import React, { useCallback, useEffect, useRef } from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import type { ViewStyle } from 'react-native';

import { useTokens } from '../tokens/designTokens';

// ─── Public types ────────────────────────────────────────────────────────────

export interface CurrentTimeIndicatorProps {
  /** Height of one hour in pixels — used to compute vertical position. */
  hourHeight: number;
  /**
   * Whether this indicator is in the column for the current day.
   * When `false` the component renders nothing (Req 10.3).
   */
  isCurrentDay: boolean;
}

// ─── Constants ───────────────────────────────────────────────────────────────

/** Interval between position updates in milliseconds (60 seconds). */
const UPDATE_INTERVAL_MS = 60_000;

/** Diameter of the circular dot at the left edge of the line. */
const DOT_SIZE = 10;

/** Thickness of the horizontal line. */
const LINE_HEIGHT = 2;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Compute the vertical offset (in pixels) for the current time.
 *
 *   position = (hours + minutes / 60) × hourHeight
 *
 * The returned value represents the distance from the top of the
 * 24-hour grid (00:00) to the current time.
 */
export function computeCurrentTimePosition(hourHeight: number): number {
  const now = new Date();
  const hours = now.getHours();
  const minutes = now.getMinutes();
  return (hours + minutes / 60) * hourHeight;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function CurrentTimeIndicator({
  hourHeight,
  isCurrentDay,
}: CurrentTimeIndicatorProps): React.ReactElement | null {
  const tokens = useTokens();

  // Ref to the outer container View — used to update `top` directly
  // without triggering a React re-render (Req 10.2).
  const containerRef = useRef<View>(null);

  // Stable callback that reads the current time and updates the native
  // view's `top` style property without triggering a React re-render.
  // On native: uses `setNativeProps`. On web: uses direct DOM style mutation.
  const updatePosition = useCallback(() => {
    const top = computeCurrentTimePosition(hourHeight);
    if (!containerRef.current) return;

    const ref = containerRef.current as any;

    // Native path: setNativeProps is the standard RN way to bypass re-renders.
    if (typeof ref.setNativeProps === 'function') {
      ref.setNativeProps({ style: { top } });
      return;
    }

    // Web path: react-native-web renders View as a <div>. Access the
    // underlying DOM element and set style.top directly.
    if (Platform.OS === 'web') {
      // react-native-web exposes the DOM node directly on the ref,
      // or via a nested _nativeRef / _node property depending on version.
      const domNode: HTMLElement | null =
        ref instanceof HTMLElement
          ? ref
          : ref._nativeRef ?? ref._node ?? null;
      if (domNode && domNode.style) {
        domNode.style.top = `${top}px`;
      }
    }
  }, [hourHeight]);

  // Set initial position and start the 60-second interval.
  useEffect(() => {
    if (!isCurrentDay) return;

    // Set position immediately on mount / when hourHeight changes.
    updatePosition();

    const id = setInterval(updatePosition, UPDATE_INTERVAL_MS);
    return () => clearInterval(id);
  }, [isCurrentDay, updatePosition]);

  // ── Early return when not the current day (Req 10.3) ────────────────────
  if (!isCurrentDay) {
    return null;
  }

  // ── Compute initial top for the first render ────────────────────────────
  const initialTop = computeCurrentTimePosition(hourHeight);

  const lineColor = tokens.colors.primary;

  // ── Styles ──────────────────────────────────────────────────────────────

  const containerStyle: ViewStyle = {
    ...styles.container,
    top: initialTop,
  };

  const dotStyle: ViewStyle = {
    ...styles.dot,
    backgroundColor: lineColor,
  };

  const lineStyle: ViewStyle = {
    ...styles.line,
    backgroundColor: lineColor,
  };

  // ── Render ──────────────────────────────────────────────────────────────

  return React.createElement(
    View,
    {
      ref: containerRef,
      style: containerStyle,
      pointerEvents: 'none',
      testID: 'current-time-indicator',
      accessible: true,
      accessibilityRole: 'none',
      accessibilityLabel: 'Current time indicator',
    },
    // Circular dot at the left edge (Req 10.1)
    React.createElement(View, {
      style: dotStyle,
      testID: 'current-time-dot',
    }),
    // Horizontal line spanning the full width (Req 10.1)
    React.createElement(View, {
      style: lineStyle,
      testID: 'current-time-line',
    }),
  );
}

// ─── Static styles ───────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    zIndex: 10,
  },
  dot: {
    width: DOT_SIZE,
    height: DOT_SIZE,
    borderRadius: DOT_SIZE / 2,
    marginLeft: -DOT_SIZE / 2,
  },
  line: {
    flex: 1,
    height: LINE_HEIGHT,
  },
});

export default CurrentTimeIndicator;
