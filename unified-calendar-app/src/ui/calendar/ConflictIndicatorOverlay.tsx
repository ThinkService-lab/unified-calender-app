/**
 * ConflictIndicatorOverlay — visual overlay rendered on top of the
 * dragged Event_Card during drag-to-reschedule and drag-to-resize when
 * the proposed time range conflicts with one or more existing events.
 *
 * Data source: the `hasConflict`, `conflictingEventIds`, and proposed
 * position on the gesture controller state (DragRescheduleState,
 * DragResizeState — Tasks 9.2 and 9.4) drive `visible`, `conflictCount`,
 * and `proposedRect`. `overlapSlice` is optional — when provided, a
 * more-opaque segment is drawn within the proposed rect to indicate the
 * exact overlap region.
 *
 * Behavior:
 *  - Absolutely-positioned overlay rendered at `proposedRect` coordinates.
 *  - `pointerEvents="none"` on the root so drag gestures pass straight
 *    through to the underlying Event_Card.
 *  - Entrance/exit animation: fade over 100ms using
 *    `react-native-reanimated`'s `withTiming`, gated on the Animation
 *    Engine's `shouldAnimate` flag. When reduced motion is active the
 *    fade resolves instantly (Req 2.5).
 *  - Accessibility: `accessibilityRole="image"` with a human-readable
 *    label announcing the conflict count. Screen-reader *announcements*
 *    on conflict state transitions are the responsibility of the parent
 *    gesture controllers (Tasks 9.2, 9.4); this component only carries
 *    the accessibilityLabel so assistive technology can read it if the
 *    user focuses the overlay.
 *
 * Styling:
 *  - Background: `tokens.colors.warning` at 0.25 opacity.
 *  - Border: 2px solid `tokens.colors.warning`.
 *  - Border radius: `tokens.radii.md` (matches EventCard).
 *  - On web: diagonal hatch pattern via CSS `repeating-linear-gradient`
 *    to make the conflict visually distinct from a normal selection
 *    highlight. React Native Web accepts the CSS-style `backgroundImage`
 *    property on `View` styles.
 *  - On native: solid warning colour at 0.25 opacity (no hatch — RN
 *    lacks native CSS gradients without an additional library).
 *
 * Requirements: 4.4, 13.5
 */

import React, { useEffect } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import type { ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { useTokens } from '../tokens';
import { useAnimation } from '../animation/animationEngine';

// `withMotion` from the Animation Engine resolves a spring-driven target
// value that respects `prefers-reduced-motion`. For this overlay we need
// a fixed-duration (100ms) fade rather than a spring, so we drive the
// shared value with `withTiming` directly and gate on the engine's
// `shouldAnimate` flag (which also comes from `useAnimation`) — that way
// the overlay still honours the user's reduced-motion preference without
// misusing `withMotion` (which is shaped for spring targets, not timing
// wrappers).

// ─── Public types ────────────────────────────────────────────────────────────

export interface ConflictIndicatorOverlayProps {
  /** Whether to render the indicator (driven by gesture-state `hasConflict`). */
  visible: boolean;
  /**
   * Bounding box of the proposed event position in the view's coordinate
   * space. Same coordinate system as the gesture controller's animated
   * values.
   */
  proposedRect: { x: number; y: number; width: number; height: number };
  /**
   * Overlapping region with the conflicting event(s), expressed as a
   * vertical slice of the proposed rect (startY / endY are relative to
   * `proposedRect.y`). If omitted, the overlay covers the full rect.
   */
  overlapSlice?: { startY: number; endY: number };
  /** Number of conflicting events (for accessibility label). */
  conflictCount: number;
}

// ─── Constants ───────────────────────────────────────────────────────────────

/** Fade in/out duration for the overlay entrance/exit (Req 4.4). */
const FADE_DURATION_MS = 100;

/** Background opacity for the primary overlay region. */
const OVERLAY_BG_OPACITY = 0.25;

/**
 * Extra opacity added to the overlap-slice region on top of
 * `OVERLAY_BG_OPACITY`, so the slice is visually more opaque than the
 * surrounding proposed rect (clamped to ≤ 1.0 when combined).
 */
const OVERLAP_SLICE_BG_OPACITY = 0.4;

/**
 * Convert a hex colour (`#RRGGBB`) + alpha (`0..1`) to an `rgba(...)`
 * string. Kept local to this component — design-token colours are
 * authored as hex and this overlay is the only consumer that needs a
 * configurable alpha. Accepts 3- or 6-digit hex; returns the original
 * string unchanged if it's neither (so themes that ship non-hex colour
 * values continue to render, just without the alpha channel).
 */
function hexWithAlpha(hex: string, alpha: number): string {
  const normalized = hex.trim();
  let r: number;
  let g: number;
  let b: number;
  if (/^#[0-9a-fA-F]{6}$/.test(normalized)) {
    r = parseInt(normalized.slice(1, 3), 16);
    g = parseInt(normalized.slice(3, 5), 16);
    b = parseInt(normalized.slice(5, 7), 16);
  } else if (/^#[0-9a-fA-F]{3}$/.test(normalized)) {
    r = parseInt(normalized.charAt(1) + normalized.charAt(1), 16);
    g = parseInt(normalized.charAt(2) + normalized.charAt(2), 16);
    b = parseInt(normalized.charAt(3) + normalized.charAt(3), 16);
  } else {
    return normalized;
  }
  const clampedAlpha = Math.max(0, Math.min(1, alpha));
  return `rgba(${r}, ${g}, ${b}, ${clampedAlpha})`;
}

/**
 * Build the accessibility label with correct singular/plural grammar.
 * Exported for testing and for parent announcers (Tasks 9.2, 9.4) that
 * want to use the same phrasing for their live-region announcements.
 */
export function buildConflictAccessibilityLabel(conflictCount: number): string {
  const safeCount = Math.max(0, Math.floor(conflictCount));
  const noun = safeCount === 1 ? 'existing event' : 'existing events';
  return `Conflict with ${safeCount} ${noun}`;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function ConflictIndicatorOverlay(
  props: ConflictIndicatorOverlayProps,
): React.ReactElement | null {
  const { visible, proposedRect, overlapSlice, conflictCount } = props;
  const tokens = useTokens();
  const { shouldAnimate } = useAnimation();

  // Drive the fade through a shared value. The engine's `shouldAnimate`
  // flag honours `prefers-reduced-motion`: when `false`, the shared
  // value is updated instantly; when `true`, a 100ms timing animation
  // runs (Req 4.4).
  const opacity = useSharedValue(visible ? 1 : 0);

  useEffect(() => {
    const target = visible ? 1 : 0;
    if (shouldAnimate) {
      opacity.value = withTiming(target, { duration: FADE_DURATION_MS });
    } else {
      // Instant show/hide for users with reduced motion enabled.
      opacity.value = target;
    }
  }, [visible, shouldAnimate, opacity]);

  const animatedRootStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  // When fully hidden (visible === false *and* the fade has settled),
  // continue rendering an invisible node — Reanimated needs the node
  // mounted to drive the shared value. Returning `null` would abort the
  // exit animation. The `pointerEvents="none"` prop ensures the node
  // never intercepts touches even while fading out.
  const warningHex = tokens.colors.warning;
  const borderRadius = tokens.radii.md;

  // Platform-specific background style: web gets a diagonal hatch via
  // CSS `repeating-linear-gradient` (React Native Web passes through
  // `backgroundImage` on View styles); native gets a plain translucent
  // warning fill.
  const backgroundStyle: ViewStyle = buildOverlayBackgroundStyle(warningHex);

  const rootStyle = [
    styles.root,
    {
      left: proposedRect.x,
      top: proposedRect.y,
      width: proposedRect.width,
      height: proposedRect.height,
      borderRadius,
      borderColor: warningHex,
    },
  ];

  const primaryFillStyle: ViewStyle = {
    ...StyleSheet.absoluteFillObject,
    borderRadius,
    backgroundColor: hexWithAlpha(warningHex, OVERLAY_BG_OPACITY),
  };

  // If an overlap slice is specified, render a secondary more-opaque
  // region *on top of* the primary fill to highlight the exact overlap.
  let overlapSliceNode: React.ReactElement | null = null;
  if (overlapSlice) {
    const sliceTop = Math.max(0, overlapSlice.startY);
    const sliceHeight = Math.max(0, overlapSlice.endY - overlapSlice.startY);
    if (sliceHeight > 0) {
      const sliceStyle: ViewStyle = {
        position: 'absolute',
        left: 0,
        right: 0,
        top: sliceTop,
        height: sliceHeight,
        // Combine primary + slice alphas (clamped to ≤ 1 inside helper).
        backgroundColor: hexWithAlpha(
          warningHex,
          OVERLAY_BG_OPACITY + OVERLAP_SLICE_BG_OPACITY,
        ),
      };
      overlapSliceNode = <View style={sliceStyle} pointerEvents="none" />;
    }
  }

  return (
    <Animated.View
      style={[rootStyle, animatedRootStyle]}
      pointerEvents="none"
      accessible={visible}
      accessibilityRole="image"
      accessibilityLabel={buildConflictAccessibilityLabel(conflictCount)}
      testID="conflict-indicator-overlay"
    >
      {/* Primary translucent fill — always present under any overlap slice. */}
      <View style={primaryFillStyle} pointerEvents="none" />
      {/* Optional more-opaque slice highlighting the exact overlap region. */}
      {overlapSliceNode}
      {/* Web-only diagonal hatch layered above the fill. On native this
          View renders nothing (no backgroundImage). */}
      <View
        style={[StyleSheet.absoluteFillObject, { borderRadius }, backgroundStyle]}
        pointerEvents="none"
      />
    </Animated.View>
  );
}

// ─── Internal helpers ────────────────────────────────────────────────────────

/**
 * Build the diagonal-hatch background style applied on web. On native
 * platforms returns an empty style object so the only fill is the
 * translucent base drawn by the primary-fill `View`.
 *
 * React Native Web accepts CSS-style `backgroundImage` on `View` styles;
 * the `as ViewStyle` cast is required because `ViewStyle` doesn't list
 * the web-only `backgroundImage` property. This is safe: on native the
 * field is simply ignored, and on web it renders as expected.
 */
function buildOverlayBackgroundStyle(warningHex: string): ViewStyle {
  if (Platform.OS !== 'web') {
    return {};
  }
  // Alternate translucent bands of the warning colour at 0 and ~0.35
  // alpha so the hatch reads as a lighter-over-darker stripe pattern.
  const stripeA = hexWithAlpha(warningHex, 0);
  const stripeB = hexWithAlpha(warningHex, 0.35);
  const gradient =
    `repeating-linear-gradient(45deg, ` +
    `${stripeA} 0px, ${stripeA} 6px, ` +
    `${stripeB} 6px, ${stripeB} 12px)`;
  // The `backgroundImage` property is the web-only escape hatch used
  // throughout React Native Web for CSS gradients.
  return { backgroundImage: gradient } as unknown as ViewStyle;
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    borderWidth: 2,
    // `overflow: 'hidden'` keeps the hatch + slice clipped to the rounded
    // corners so the conflict region reads as a single unit.
    overflow: 'hidden',
  },
});

export default ConflictIndicatorOverlay;
