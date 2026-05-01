/**
 * useDragResize
 *
 * Hook that creates a `Gesture.Pan()` from `react-native-gesture-handler`
 * gated by a bottom-edge hit area, and exposes the animated styles and
 * reactive state needed to drag the bottom edge of an Event_Card in the
 * Day_View or Week_View to extend or shorten the event's duration.
 *
 * Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7, 14.4
 *
 * ─── Design choice: per-drag "active event" argument ─────────────────────────
 *
 * The design doc's `DragResizeConfig` intentionally carries only the
 * static resize knobs (hit-area height, snap increment, minimum duration,
 * callbacks) — the currently-being-resized event's id, start/end times,
 * and current pixel geometry change on every drag and don't belong on a
 * static config object. The hook therefore takes a second argument,
 * `activeEvent`, that the caller populates whenever it wants a specific
 * card to become the resize target (identical to the pattern used by
 * `useDragReschedule`):
 *
 *     const { gesture, state, animatedStyle, handleStyle } =
 *         useDragResize(config, {
 *             eventId, startTime, endTime,
 *             topY, heightPx, hourHeight,
 *         });
 *
 * When `activeEvent === null` the returned gesture is a no-op (it still
 * resolves to a valid `PanGesture` object so consumers can unconditionally
 * pass it to a `GestureDetector`), and all shared values remain at their
 * resting identity values.
 *
 * ─── Activation: bottom-8px hit area ────────────────────────────────────────
 *
 * Req 13.1 mandates activation only when the user presses the bottom 8px
 * of the card. We use `Gesture.Pan().manualActivation(true)` together
 * with `.onTouchesDown(...)` to inspect the touch's local Y coordinate
 * (relative to the GestureDetector wrapping the card) and either call
 * `manager.activate()` if the touch is in the bottom hit area, or
 * `manager.fail()` if it is not. This keeps the bottom 8px of the card as
 * a dedicated resize hot-zone and leaves the rest of the card free to
 * receive taps / long-press-to-reschedule without interference.
 *
 * ─── Haptics at each snap point (Req 14.4) ──────────────────────────────────
 *
 * The hook tracks `lastSnappedEndMinutes` in a shared value (worklet
 * side). On every pan update, after recomputing the proposed end time
 * and snapping it to the 15-minute grid, we compare the newly-snapped
 * value against the previous one. When they differ, we fire
 * `runOnJS(config.onSnapHaptic?.())` — yielding a haptic "tick" each
 * time the user crosses a 15-minute snap boundary. The first snap
 * computed at gesture activation is seeded into `lastSnappedEndMinutes`
 * so the initial "match the current end time" snap does NOT trigger a
 * spurious haptic; the caller must separately fire any activation-time
 * haptic if desired (the spec doesn't require one for resize).
 *
 * ─── Reduced motion (Req 13.6) ──────────────────────────────────────────────
 *
 * When `useAnimation()` reports `shouldAnimate === false`, we skip the
 * animated 1.2x scale on the resize handle and render a static 2px
 * border highlight on the card instead. The animated height still
 * tracks the drag (reduction of motion does not mean freezing the
 * interactive feedback of the drag itself — see Req 4.6's analogous
 * wording).
 *
 * ─── Error handling ──────────────────────────────────────────────────────────
 *
 * This task only covers the happy path. `onResize` rejections propagate
 * to the consumer. We always clear the gesture context store's
 * `activeGesture` on pan end (success, spring-back, or cancellation)
 * through both `.onEnd()` and `.onFinalize()` so the invariants in
 * Property 13 hold even when the gesture is cancelled mid-drag.
 */

import { useCallback, useMemo } from 'react';
import { Gesture } from 'react-native-gesture-handler';
import type { PanGesture } from 'react-native-gesture-handler';
import {
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import type { AnimatedStyle } from 'react-native-reanimated';
import type { ViewStyle } from 'react-native';

import { useAnimation } from '../animation/animationEngine';
import { useTokens } from '../tokens';
import { gestureContextStore } from '../../stores/gestureContextStore';
import { snapToIncrement } from '../calendar/timeSlotUtils';

// ─── Public types ─────────────────────────────────────────────────────────────

/** Result returned by `onConflictCheck` (mirrors the design doc). */
export interface ConflictCheckResult {
  hasConflict: boolean;
  conflictingEventIds: string[];
}

export interface DragResizeConfig {
  /** Bottom edge hit-area height in pixels. Fixed at 8 per Req 13.1. */
  hitAreaHeight: 8;
  /** Time-slot snap increment (minutes). Fixed at 15 per Req 13.2. */
  snapIncrement: 15;
  /** Minimum event duration (minutes). Fixed at 15 per Req 13.4. */
  minimumDuration: 15;
  /** Maximum time to persist after release (ms). Fixed at 200 per Req 13.7. */
  maxPersistTime: 200;
  /** Callback to update event end time — Req 13.3, 13.7. */
  onResize: (eventId: string, newEnd: Date) => Promise<void>;
  /** Callback to check conflicts at proposed end time — Req 13.5. */
  onConflictCheck: (eventId: string, newEnd: Date) => ConflictCheckResult;
  /**
   * Haptic callback fired at each 15-minute snap-point crossing during the
   * drag — Req 14.4. Typically wired to `haptics.trigger('selection')`.
   * Optional: omit to disable snap-tick haptics (e.g., web).
   */
  onSnapHaptic?: () => void;
}

/**
 * Per-drag runtime information. Callers pass this in every render so the
 * hook knows which card is currently resizable (or `null` to disable the
 * gesture). Same pattern as `useDragReschedule`.
 */
export interface DragResizeActiveEvent {
  /** Unique id of the event being resized. */
  eventId: string;
  /** Start timestamp of the event (fixed during resize — only end moves). */
  startTime: Date;
  /** End timestamp of the event prior to the resize. */
  endTime: Date;
  /**
   * Pixel offset from the top of the timeline to the event's top edge.
   * Unused by the resize math directly, but kept for parity with the
   * reschedule controller's active-event shape and available to any
   * future consumer that needs absolute positioning.
   */
  topY: number;
  /** Height of the event card in pixels prior to the resize. */
  heightPx: number;
  /** Height in pixels representing one hour on the timeline. */
  hourHeight: number;
}

export interface DragResizeState {
  isResizing: boolean;
  resizingEventId: string | null;
  proposedEnd: Date | null;
  hasConflict: boolean;
}

export interface UseDragResizeReturn {
  gesture: PanGesture;
  state: DragResizeState;
  animatedStyle: AnimatedStyle<ViewStyle>;
  /** Animated style for the resize handle visual at the bottom edge. */
  handleStyle: AnimatedStyle<ViewStyle>;
}

// ─── Internal constants ───────────────────────────────────────────────────────

const HANDLE_ACTIVE_SCALE = 1.2;
const REDUCED_MOTION_BORDER_WIDTH = 2;
const MINUTES_PER_DAY = 1440;
const HANDLE_TIMING_MS = 150;

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Build a `PanGesture` that activates only on touches within the bottom
 * `hitAreaHeight` pixels of the Event_Card, drags the event's end time
 * in 15-minute increments, enforces a 15-minute minimum duration, fires
 * a haptic tick on each snap-point crossing, and persists the new end
 * time on release.
 */
export function useDragResize(
  config: DragResizeConfig,
  activeEvent: DragResizeActiveEvent | null = null,
): UseDragResizeReturn {
  const { shouldAnimate, springConfig } = useAnimation();
  const tokens = useTokens();

  // ── Shared values (UI-thread state) ───────────────────────────────────────
  //
  // All reset to their identity values when the gesture ends or when
  // `activeEvent` is null. They are the only UI-thread state the
  // worklets read/write; JS-thread state (below) is derived from them.
  const translationY = useSharedValue(0);
  const heightShared = useSharedValue(activeEvent?.heightPx ?? 0);
  const handleScale = useSharedValue(1);
  const isResizingShared = useSharedValue(false);
  /** Current snapped proposed-end in minutes-from-midnight. */
  const proposedEndMinutes = useSharedValue(0);
  /** Previously-snapped end — compared against the new snap to fire haptics. */
  const lastSnappedEndMinutes = useSharedValue(0);

  // ── JS-thread reactive state snapshot ─────────────────────────────────────
  //
  // Same rationale as `useDragReschedule`: we keep a stable object reference
  // and mutate fields from JS-side callbacks so consumers can read a
  // snapshot without subscribing to worklet updates.
  const stateRef = useMemo<{ current: DragResizeState }>(
    () => ({
      current: {
        isResizing: false,
        resizingEventId: null,
        proposedEnd: null,
        hasConflict: false,
      },
    }),
    // Intentionally recreated per active-event identity swap.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeEvent?.eventId],
  );

  // ── JS-thread callbacks (workletized via runOnJS) ─────────────────────────

  const triggerSnapHaptic = useCallback(() => {
    config.onSnapHaptic?.();
  }, [config]);

  const setResizeContext = useCallback(() => {
    gestureContextStore.getState().setActiveGesture('resize');
  }, []);

  const clearResizeContext = useCallback(() => {
    gestureContextStore.getState().clearActiveGesture();
  }, []);

  /**
   * Called from the worklet on every snap-point CHANGE (not every frame).
   * Re-runs the conflict check for the new proposed end time and updates
   * the JS-side state snapshot.
   */
  const handleSnapChange = useCallback(
    (proposedEndMin: number) => {
      if (!activeEvent) return;

      const proposedEnd = buildProposedEnd(
        activeEvent.startTime,
        proposedEndMin,
      );
      const conflictResult = config.onConflictCheck(
        activeEvent.eventId,
        proposedEnd,
      );

      stateRef.current.isResizing = true;
      stateRef.current.resizingEventId = activeEvent.eventId;
      stateRef.current.proposedEnd = proposedEnd;
      stateRef.current.hasConflict = conflictResult.hasConflict;
    },
    [activeEvent, config, stateRef],
  );

  /**
   * Called from the worklet on pan end when the drop satisfies the
   * 15-minute minimum. Invokes `onResize` — any rejection propagates to
   * the consumer (error handling is deferred to a later task, same as
   * the reschedule controller's convention).
   */
  const handleCommit = useCallback(
    (proposedEndMin: number) => {
      if (!activeEvent) return;

      const proposedEnd = buildProposedEnd(
        activeEvent.startTime,
        proposedEndMin,
      );

      // Fire-and-forget: the worklet does not need to block on persistence.
      void config.onResize(activeEvent.eventId, proposedEnd).finally(() => {
        stateRef.current.isResizing = false;
        stateRef.current.resizingEventId = null;
      });
    },
    [activeEvent, config, stateRef],
  );

  // ── Gesture construction ──────────────────────────────────────────────────
  //
  // We build the pan gesture unconditionally so the consumer can pass it
  // to `<GestureDetector>` even when no event is active. When `activeEvent`
  // is null the touch handler fails immediately and the gesture never
  // activates.
  const gesture = useMemo<PanGesture>(() => {
    // Capture primitive bits of activeEvent in locals so worklets don't
    // dereference the whole object through the closure. Reanimated
    // serialises closure variables for the UI thread, and capturing
    // primitives avoids passing a Date/string-heavy object every frame.
    const eventHeightPx = activeEvent?.heightPx ?? 0;
    const eventHourHeight = activeEvent?.hourHeight ?? 0;
    const initialEndMinutes = activeEvent
      ? dateToMinutesOfDay(activeEvent.endTime)
      : 0;
    const startMinutes = activeEvent
      ? dateToMinutesOfDay(activeEvent.startTime)
      : 0;
    const hitAreaHeight = config.hitAreaHeight;
    const snapIncrement = config.snapIncrement;
    const minimumDuration = config.minimumDuration;

    return Gesture.Pan()
      .manualActivation(true)
      // Req 13.1: activation gated by the bottom `hitAreaHeight` pixels.
      // `manager.activate()` promotes the pan to active; `manager.fail()`
      // rejects the gesture so other gestures (e.g. tap, long-press for
      // reschedule) can still handle the touch on the non-handle region.
      .onTouchesDown((event, manager) => {
        'worklet';
        if (!activeEvent) {
          manager.fail();
          return;
        }
        const touch = event.changedTouches[0];
        if (!touch) {
          manager.fail();
          return;
        }
        if (touch.y >= eventHeightPx - hitAreaHeight) {
          manager.activate();
        } else {
          manager.fail();
        }
      })
      .onStart(() => {
        'worklet';
        if (!activeEvent) return;

        // Seed the shared values for the resize session.
        heightShared.value = eventHeightPx;
        translationY.value = 0;
        isResizingShared.value = true;
        proposedEndMinutes.value = initialEndMinutes;
        lastSnappedEndMinutes.value = initialEndMinutes;

        // Req 13.6: skip the handle scale animation under reduced motion.
        if (shouldAnimate) {
          handleScale.value = withTiming(HANDLE_ACTIVE_SCALE, {
            duration: HANDLE_TIMING_MS,
          });
        }

        // Req 15.6 / Property 13: mark the gesture context so swipe nav
        // stands down while a resize is in progress.
        runOnJS(setResizeContext)();
      })
      .onUpdate((event) => {
        'worklet';
        if (!activeEvent || eventHourHeight <= 0) return;

        // Map the vertical translation into minutes. hourHeight is guaranteed
        // positive by the guard above so the division is safe.
        const deltaMinutes = (event.translationY / eventHourHeight) * 60;
        const rawEndMin = initialEndMinutes + deltaMinutes;

        // Snap to the 15-minute grid, then clamp against the minimum duration
        // and the end-of-day ceiling.
        const snappedRaw = snapToIncrement(rawEndMin, snapIncrement);
        const minEndMin = startMinutes + minimumDuration; // Req 13.4
        const maxEndMin = MINUTES_PER_DAY - 1; // within half-open day range
        const snappedEndMin = clamp(snappedRaw, minEndMin, maxEndMin);

        // Translate the clamped end back into a pixel height so the card
        // visually tracks the drag. `minutesToPixels = minutes * hourHeight/60`
        const clampedDurationMin = snappedEndMin - startMinutes;
        const newHeight = (clampedDurationMin / 60) * eventHourHeight;

        heightShared.value = newHeight;
        translationY.value = event.translationY;
        proposedEndMinutes.value = snappedEndMin;

        // Req 14.4: fire a haptic tick on each snap-point CROSSING.
        // The comparison against `lastSnappedEndMinutes` throttles the
        // callback to the moment a new 15-minute boundary is crossed.
        if (snappedEndMin !== lastSnappedEndMinutes.value) {
          lastSnappedEndMinutes.value = snappedEndMin;
          runOnJS(handleSnapChange)(snappedEndMin);
          runOnJS(triggerSnapHaptic)();
        }
      })
      .onEnd(() => {
        'worklet';
        if (!activeEvent) return;

        const snappedEndMin = proposedEndMinutes.value;
        const minEndMin = startMinutes + minimumDuration;

        if (snappedEndMin >= minEndMin && eventHourHeight > 0) {
          // Valid resize: spring the height to its final resting value
          // (it already tracks the snapped end, but `withSpring` gives
          // the settle animation a subtle visual confirmation) and kick
          // off the persist callback.
          const finalDurationMin = snappedEndMin - startMinutes;
          const finalHeight = (finalDurationMin / 60) * eventHourHeight;

          if (shouldAnimate) {
            heightShared.value = withSpring(finalHeight, springConfig);
          } else {
            heightShared.value = finalHeight;
          }
          runOnJS(handleCommit)(snappedEndMin);
        } else {
          // Below minimum: spring back to original height (Req 13.4).
          if (shouldAnimate) {
            heightShared.value = withSpring(eventHeightPx, springConfig);
          } else {
            heightShared.value = eventHeightPx;
          }
        }

        // Reset handle scale and drag bookkeeping either way.
        if (shouldAnimate) {
          handleScale.value = withTiming(1, { duration: HANDLE_TIMING_MS });
        } else {
          handleScale.value = 1;
        }
        translationY.value = 0;
        isResizingShared.value = false;

        // Always clear the gesture context on release — Property 13.
        runOnJS(clearResizeContext)();
      })
      .onFinalize(() => {
        'worklet';
        // Safety net for cancellation paths that skip `.onEnd()` (external
        // gesture takeover, pointer lost, etc). If the resize flag is still
        // set, spring back to the original height and release the gesture
        // context so the store does not get stuck reporting an active
        // resize.
        if (isResizingShared.value) {
          if (shouldAnimate) {
            heightShared.value = withSpring(eventHeightPx, springConfig);
            handleScale.value = withTiming(1, { duration: HANDLE_TIMING_MS });
          } else {
            heightShared.value = eventHeightPx;
            handleScale.value = 1;
          }
          translationY.value = 0;
          isResizingShared.value = false;
          runOnJS(clearResizeContext)();
        }
      });
  }, [
    activeEvent,
    config.hitAreaHeight,
    config.snapIncrement,
    config.minimumDuration,
    shouldAnimate,
    springConfig,
    setResizeContext,
    clearResizeContext,
    handleSnapChange,
    handleCommit,
    triggerSnapHaptic,
    // Shared values are stable across renders.
    translationY,
    heightShared,
    handleScale,
    isResizingShared,
    proposedEndMinutes,
    lastSnappedEndMinutes,
  ]);

  // ── Animated styles ───────────────────────────────────────────────────────

  /**
   * Card-level animated style. The `height` value tracks the drag in
   * real-time and springs to its final value on release. When reduced
   * motion is active, we add a static border highlight while resizing
   * (Req 13.6).
   */
  const animatedStyle = useAnimatedStyle(() => {
    'worklet';
    if (!shouldAnimate) {
      return {
        height: heightShared.value,
        borderWidth: isResizingShared.value ? REDUCED_MOTION_BORDER_WIDTH : 0,
        borderColor: tokens.colors.primary,
      };
    }
    return {
      height: heightShared.value,
      // Ensure the actively-resized card paints above its siblings.
      zIndex: isResizingShared.value ? 1000 : 0,
    };
  });

  /**
   * Resize handle visual at the bottom edge. During an active resize
   * the handle scales up to 1.2x (smooth motion) or the card picks up
   * a border highlight (reduced motion) to indicate activation.
   */
  const handleStyle = useAnimatedStyle(() => {
    'worklet';
    if (!shouldAnimate) {
      // Reduced motion: static handle. The border highlight on the card
      // itself (via `animatedStyle`) communicates activation — the handle
      // stays at its resting visual weight.
      return {
        transform: [{ scale: 1 }],
        opacity: 1,
      };
    }
    return {
      transform: [{ scale: handleScale.value }],
      opacity: isResizingShared.value ? 1 : 0.6,
    };
  });

  // ── UI-thread → JS-thread reactions ───────────────────────────────────────
  //
  // Mirror isResizing onto the JS-side state snapshot so consumers reading
  // `state.isResizing` see an accurate value even when the gesture ends
  // without committing (e.g., dragged above the 15-minute minimum).
  useAnimatedReaction(
    () => isResizingShared.value,
    (isResizing) => {
      if (!isResizing) {
        runOnJS(markResizeEndedJS)(stateRef);
      }
    },
    [stateRef],
  );

  return {
    gesture,
    state: stateRef.current,
    animatedStyle,
    handleStyle,
  };
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Clamp `value` into the inclusive range [lo, hi]. Declared as a worklet
 * so it can be called from the pan `onUpdate` handler.
 */
function clamp(value: number, lo: number, hi: number): number {
  'worklet';
  if (value < lo) return lo;
  if (value > hi) return hi;
  return value;
}

/**
 * JS-thread helper: convert a `Date` to minutes-from-midnight using the
 * Date's LOCAL time zone (matching the convention used by the reschedule
 * controller and the timeline renderers).
 */
function dateToMinutesOfDay(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

/**
 * JS-thread helper: build a `Date` representing the proposed end time.
 *
 * We preserve the Y-M-D components from the event's start date (resize
 * never changes the day) and apply the proposed end's H-M. If the
 * proposed end minute value would produce a `Date` at or before the
 * start (which can happen if the snap math tripped against a DST
 * boundary), we roll the end forward by a day so the duration is at
 * least one snap increment.
 */
function buildProposedEnd(startTime: Date, proposedEndMin: number): Date {
  const proposedEnd = new Date(startTime);
  proposedEnd.setHours(
    Math.floor(proposedEndMin / 60),
    proposedEndMin % 60,
    0,
    0,
  );
  if (proposedEnd.getTime() <= startTime.getTime()) {
    // Extremely rare — DST rollback could momentarily put the end at or
    // before the start. Roll to the next day to preserve forward motion.
    proposedEnd.setDate(proposedEnd.getDate() + 1);
  }
  return proposedEnd;
}

/** JS-thread helper that resets transient resize fields on the state snapshot. */
function markResizeEndedJS(stateRef: { current: DragResizeState }): void {
  stateRef.current.isResizing = false;
  stateRef.current.resizingEventId = null;
  stateRef.current.proposedEnd = null;
  stateRef.current.hasConflict = false;
}
