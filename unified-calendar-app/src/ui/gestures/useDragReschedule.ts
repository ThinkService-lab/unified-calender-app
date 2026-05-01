/**
 * useDragReschedule
 *
 * Hook that composes a LongPress (300ms) + Pan gesture from
 * react-native-gesture-handler and exposes the animated styles and
 * reactive state needed to drag an Event_Card to a new time slot
 * (and, in week view, a new day column).
 *
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 14.1, 14.2
 *
 * ─── Design choice: per-drag "active event" argument ─────────────────────────
 *
 * The design doc's `DragRescheduleConfig` intentionally does not carry the
 * dragged event's id / start / end / current pixel position — those fields
 * change with every new drag and don't belong on a static config object.
 * The hook therefore takes a second argument, `activeEvent`, that the caller
 * populates whenever it wants a specific card to become the drag target:
 *
 *     const { gesture, state, animatedStyle, timeIndicatorStyle } =
 *         useDragReschedule(config, {
 *             eventId, startTime, endTime,
 *             topY, heightPx,
 *             initialColumnIndex, hourHeight,
 *         });
 *
 * When `activeEvent === null` the returned gesture is a no-op (it still
 * composes a valid gesture object so consumers can unconditionally pass
 * it to a `GestureDetector`), and all shared values remain at their
 * resting identity values. This matches the "attach per card" pattern
 * called out in Task 9.2 and keeps per-event data off the config object.
 *
 * ─── Composition pattern ─────────────────────────────────────────────────────
 *
 * We compose LongPress + Pan via `Gesture.Simultaneous(...)` but rely on
 * `PanGesture.activateAfterLongPress(300)` to guarantee the pan handler
 * does NOT start translating until the 300ms long-press has activated.
 * Without `activateAfterLongPress`, simultaneous composition would let
 * the pan fire immediately on first touch, defeating Req 4.1.
 *
 * ─── Error handling ──────────────────────────────────────────────────────────
 *
 * This task only covers the happy path. `onReschedule` rejections propagate
 * to the consumer — Task 10A.2 will add try/catch + spring-back + banner.
 * We always clear the gesture context store's `activeGesture` on pan end
 * (success or failure) so the gesture-context invariants in Property 13 hold.
 */

import { useCallback, useMemo } from 'react';
import { Gesture } from 'react-native-gesture-handler';
import type { ComposedGesture } from 'react-native-gesture-handler';
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
import { useHaptics } from '../haptics/hapticEngine';
import { useTokens } from '../tokens';
import { gestureContextStore } from '../../stores/gestureContextStore';
import {
  minutesToY,
  snapToIncrement,
  yToMinutes,
} from '../calendar/timeSlotUtils';
// ─── Public types ─────────────────────────────────────────────────────────────

/** Result returned by `onConflictCheck` (mirrors the design doc). */
export interface ConflictCheckResult {
  hasConflict: boolean;
  conflictingEventIds: string[];
}

export interface DragRescheduleConfig {
  /** Minimum long-press duration to activate drag (ms). Fixed at 300 per Req 4.1. */
  longPressDuration: 300;
  /** Time-slot snap increment (minutes). Fixed at 15 per Req 4.2. */
  snapIncrement: 15;
  /** Maximum time to persist after drop (ms). Fixed at 200 per Req 4.7. */
  maxPersistTime: 200;
  /** Width of a single day column in pixels (week view horizontal drag). */
  dayColumnWidth: number;
  /**
   * Ordered array of dates for each visible day column. Length = 1 in day
   * view, 7 in week view. Index 0 corresponds to the left-most visible day.
   */
  visibleDayDates: Date[];
  /** Callback to update event times — Req 4.3, 4.7. */
  onReschedule: (eventId: string, newStart: Date, newEnd: Date) => Promise<void>;
  /** Callback to check conflicts at proposed time — Req 4.4. */
  onConflictCheck: (
    eventId: string,
    newStart: Date,
    newEnd: Date,
  ) => ConflictCheckResult;
}

/**
 * Per-drag runtime information. Callers pass this in every render so the
 * hook knows which card is currently draggable (or `null` to disable the
 * gesture). See the top-of-file "per-drag active event argument" note.
 */
export interface DragRescheduleActiveEvent {
  /** Unique id of the event being dragged. */
  eventId: string;
  /** Start timestamp of the event prior to the drag. */
  startTime: Date;
  /** End timestamp of the event prior to the drag. */
  endTime: Date;
  /**
   * Pixel offset from the top of the timeline to the event's top edge,
   * at the start of the drag. Used to compute the proposed start minute.
   */
  topY: number;
  /** Height of the event card in pixels (determines duration visually). */
  heightPx: number;
  /**
   * 0-based day column index the event currently occupies. 0 in day view,
   * 0–6 in week view. Used as the baseline for horizontal translation.
   */
  initialColumnIndex: number;
  /** Height in pixels representing one hour on the timeline. */
  hourHeight: number;
}

export interface DragRescheduleState {
  isDragging: boolean;
  draggedEventId: string | null;
  translationY: number;
  translationX: number;
  currentDayColumnIndex: number;
  proposedDate: Date | null;
  proposedStart: Date | null;
  proposedEnd: Date | null;
  hasConflict: boolean;
}

export interface UseDragRescheduleReturn {
  gesture: ComposedGesture;
  state: DragRescheduleState;
  animatedStyle: AnimatedStyle<ViewStyle>;
  /** Animated style for a floating time-indicator that follows the drag vertically. */
  timeIndicatorStyle: AnimatedStyle<ViewStyle>;
}

// ─── Internal constants ───────────────────────────────────────────────────────

const LIFT_SCALE = 1.03;
const LIFT_ELEVATION = 8;
const DROP_SHADOW_OPACITY = 0.25;
const REDUCED_MOTION_BORDER_WIDTH = 2;
const MINUTES_PER_DAY = 1440;

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Compose a LongPress + Pan gesture for drag-to-reschedule and return the
 * gesture plus the animated styles / reactive state a consumer needs to
 * render the dragged Event_Card and its time-indicator overlay.
 */
export function useDragReschedule(
  config: DragRescheduleConfig,
  activeEvent: DragRescheduleActiveEvent | null = null,
): UseDragRescheduleReturn {
  const { shouldAnimate, springConfig } = useAnimation();
  const haptics = useHaptics();
  const tokens = useTokens();

  // ── Shared values (UI-thread state) ───────────────────────────────────────
  //
  // All of these reset to their identity values when the gesture ends or
  // when `activeEvent` is null. They are the only UI-thread state the
  // worklets read/write; JS-thread state (below) is derived from them via
  // `useAnimatedReaction`.
  const translationY = useSharedValue(0);
  const translationX = useSharedValue(0);
  const scale = useSharedValue(1);
  const elevation = useSharedValue(0);
  const shadowOpacity = useSharedValue(0);
  const isDraggingShared = useSharedValue(false);
  /** Current snapped proposed-start in minutes-from-midnight, updated on every pan frame. */
  const proposedStartMinutes = useSharedValue(0);
  /** Current day-column index (0 in day view, 0–6 in week view). */
  const currentColumnIndex = useSharedValue(activeEvent?.initialColumnIndex ?? 0);

  // ── JS-thread reactive state ──────────────────────────────────────────────
  //
  // We keep a ref-like object that mirrors relevant shared values so
  // consumers can observe state without subscribing to worklet updates.
  // To keep the return object stable across renders we use a single memoized
  // object and mutate its fields from the reaction worklet via runOnJS.
  //
  // NOTE: This state object is intentionally NOT a useState — we don't want
  // to re-render the consuming component on every frame. Consumers that
  // need reactive updates should derive animated styles from shared values
  // directly. The `state` is a best-effort snapshot for post-drag reads.
  const stateRef = useMemo<{ current: DragRescheduleState }>(
    () => ({
      current: {
        isDragging: false,
        draggedEventId: null,
        translationY: 0,
        translationX: 0,
        currentDayColumnIndex: activeEvent?.initialColumnIndex ?? 0,
        proposedDate: null,
        proposedStart: null,
        proposedEnd: null,
        hasConflict: false,
      },
    }),
    // Intentionally created once per active-event identity swap.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeEvent?.eventId],
  );

  // ── JS-thread callbacks (workletized via runOnJS) ─────────────────────────

  const triggerMediumHaptic = useCallback(() => {
    haptics.trigger('medium');
  }, [haptics]);

  const triggerLightHaptic = useCallback(() => {
    haptics.trigger('light');
  }, [haptics]);

  const setRescheduleContext = useCallback(() => {
    gestureContextStore.getState().setActiveGesture('reschedule');
  }, []);

  const clearRescheduleContext = useCallback(() => {
    gestureContextStore.getState().clearActiveGesture();
  }, []);

  /**
   * Called from the worklet on every snap-point CHANGE (not every frame).
   * Re-runs the conflict check for the new proposed time and updates the
   * JS-side state snapshot. Capturing `activeEvent`, `config`, and the
   * `stateRef` means this callback must be re-created when any of those
   * change — which is correct: a new active event needs fresh bindings.
   */
  const handleSnapChange = useCallback(
    (
      proposedStartMin: number,
      proposedEndMin: number,
      columnIndex: number,
      translationXJs: number,
      translationYJs: number,
    ) => {
      if (!activeEvent) return;

      const proposedDate = config.visibleDayDates[columnIndex] ?? null;
      if (!proposedDate) return;

      // Compose the proposed start/end Date objects in the same local
      // timezone as the proposed day column. We preserve Y-M-D from the
      // column date and H-M from the snapped minutes — this avoids DST
      // rounding surprises that a naive `setTime()` on the original date
      // would introduce when crossing a DST boundary.
      const proposedStart = new Date(proposedDate);
      proposedStart.setHours(
        Math.floor(proposedStartMin / 60),
        proposedStartMin % 60,
        0,
        0,
      );
      const proposedEnd = new Date(proposedDate);
      proposedEnd.setHours(
        Math.floor(proposedEndMin / 60),
        proposedEndMin % 60,
        0,
        0,
      );
      // If the snapped end wraps past midnight (unusual but possible for
      // long events near the end of the day), roll the end date forward
      // by one day so duration is preserved.
      if (proposedEnd.getTime() <= proposedStart.getTime()) {
        proposedEnd.setDate(proposedEnd.getDate() + 1);
      }

      const conflictResult = config.onConflictCheck(
        activeEvent.eventId,
        proposedStart,
        proposedEnd,
      );

      stateRef.current.isDragging = true;
      stateRef.current.draggedEventId = activeEvent.eventId;
      stateRef.current.translationX = translationXJs;
      stateRef.current.translationY = translationYJs;
      stateRef.current.currentDayColumnIndex = columnIndex;
      stateRef.current.proposedDate = proposedDate;
      stateRef.current.proposedStart = proposedStart;
      stateRef.current.proposedEnd = proposedEnd;
      stateRef.current.hasConflict = conflictResult.hasConflict;
    },
    [activeEvent, config, stateRef],
  );

  /**
   * Called from the worklet on pan end when the drop is inside the valid
   * grid. Invokes `onReschedule` and fires the success haptic.
   *
   * Error handling is deferred to Task 10A.2 — we deliberately do NOT
   * wrap in try/catch here. The promise rejection propagates to any
   * consumer that awaits it, and we still reset the gesture context in
   * the .finally block so the invariant in Property 13 is preserved.
   */
  const handleDrop = useCallback(
    (proposedStartMin: number, proposedEndMin: number, columnIndex: number) => {
      if (!activeEvent) return;

      const proposedDate = config.visibleDayDates[columnIndex] ?? null;
      if (!proposedDate) return;

      const proposedStart = new Date(proposedDate);
      proposedStart.setHours(
        Math.floor(proposedStartMin / 60),
        proposedStartMin % 60,
        0,
        0,
      );
      const proposedEnd = new Date(proposedDate);
      proposedEnd.setHours(
        Math.floor(proposedEndMin / 60),
        proposedEndMin % 60,
        0,
        0,
      );
      if (proposedEnd.getTime() <= proposedStart.getTime()) {
        proposedEnd.setDate(proposedEnd.getDate() + 1);
      }

      // Fire the success haptic before awaiting the persist so the user
      // gets immediate tactile confirmation of the drop (Req 14.2).
      triggerLightHaptic();

      // Kick off the persist. We intentionally do not await — the worklet
      // does not need to block on this, and any caller that needs to know
      // when persistence settles can observe the event via the store.
      void config
        .onReschedule(activeEvent.eventId, proposedStart, proposedEnd)
        .finally(() => {
          stateRef.current.isDragging = false;
          stateRef.current.draggedEventId = null;
        });
    },
    [activeEvent, config, stateRef, triggerLightHaptic],
  );

  // ── Gesture composition ───────────────────────────────────────────────────
  //
  // We build the gesture unconditionally (even when activeEvent is null) so
  // the consumer can always pass a valid gesture to <GestureDetector>. When
  // activeEvent is null the callbacks no-op immediately.
  const gesture = useMemo<ComposedGesture>(() => {
    const longPress = Gesture.LongPress()
      .minDuration(config.longPressDuration)
      .shouldCancelWhenOutside(false)
      .onStart(() => {
        'worklet';
        if (!activeEvent) return;

        // Req 4.1: lift the event — unless reduced motion is active
        // (Req 4.6), in which case we apply only a border highlight and
        // skip scale/elevation entirely.
        if (shouldAnimate) {
          scale.value = withSpring(LIFT_SCALE, springConfig);
          elevation.value = withTiming(LIFT_ELEVATION, { duration: 150 });
          shadowOpacity.value = withTiming(DROP_SHADOW_OPACITY, { duration: 150 });
        }
        isDraggingShared.value = true;

        // Initial proposed start = the event's current start, snapped.
        const initialStartMin =
          (activeEvent.startTime.getHours() * 60) +
          activeEvent.startTime.getMinutes();
        proposedStartMinutes.value = snapToIncrement(
          initialStartMin,
          config.snapIncrement,
        );
        currentColumnIndex.value = activeEvent.initialColumnIndex;

        // Req 14.1: medium haptic on drag activation.
        runOnJS(triggerMediumHaptic)();
        // Req 15.6 / Property 13: mark the gesture context so swipe nav
        // and other competing gestures know to stand down.
        runOnJS(setRescheduleContext)();
      });

    const pan = Gesture.Pan()
      // Pan may NOT begin translating until the long-press activates.
      // Without this, the pan handler would compete with scroll views
      // and start moving the card on first touch — violating Req 4.1.
      .activateAfterLongPress(config.longPressDuration)
      .onUpdate((event) => {
        'worklet';
        if (!activeEvent) return;

        translationX.value = event.translationX;
        translationY.value = event.translationY;

        // Derive the proposed top-Y from the card's original topY plus
        // the current vertical translation, then snap to the nearest
        // 15-minute grid line.
        const proposedTopY = activeEvent.topY + event.translationY;
        const snappedStartMin = yToMinutes(proposedTopY, activeEvent.hourHeight);

        // Duration is invariant across the drag — we only change the
        // start. End-minute derivation preserves the original duration.
        const durationMin = Math.max(
          0,
          Math.round(
            (activeEvent.endTime.getTime() - activeEvent.startTime.getTime()) /
              60000,
          ),
        );
        // Clamp the end into the day range — for events near midnight
        // the end may legitimately exceed 1440, in which case we let the
        // JS-side handler roll to the next day.
        const snappedEndMin = snappedStartMin + durationMin;

        // Detect day column by horizontal translation (week view only).
        // In day view, dayColumnWidth is effectively the view width and
        // the result always rounds back to the initial column.
        const columnDelta =
          config.dayColumnWidth > 0
            ? Math.round(event.translationX / config.dayColumnWidth)
            : 0;
        const nextColumnIndex = clamp(
          activeEvent.initialColumnIndex + columnDelta,
          0,
          Math.max(0, config.visibleDayDates.length - 1),
        );

        // Throttle conflict checks + JS-state updates: only fire when
        // the snap point OR the day column actually changed.
        const changed =
          snappedStartMin !== proposedStartMinutes.value ||
          nextColumnIndex !== currentColumnIndex.value;

        proposedStartMinutes.value = snappedStartMin;
        currentColumnIndex.value = nextColumnIndex;

        if (changed) {
          runOnJS(handleSnapChange)(
            snappedStartMin,
            Math.min(snappedEndMin, MINUTES_PER_DAY),
            nextColumnIndex,
            event.translationX,
            event.translationY,
          );
        }
      })
      .onEnd((event) => {
        'worklet';
        if (!activeEvent) return;

        // Determine whether the drop is inside the valid grid.
        // Valid grid =
        //   - proposed top-Y is within [0, fullDayHeight)
        //   - proposed column index is within visibleDayDates bounds
        const proposedTopY = activeEvent.topY + event.translationY;
        const fullDayHeight = activeEvent.hourHeight * 24;
        const inVerticalBounds =
          proposedTopY >= 0 && proposedTopY < fullDayHeight;

        const columnDelta =
          config.dayColumnWidth > 0
            ? Math.round(event.translationX / config.dayColumnWidth)
            : 0;
        const targetColumn = activeEvent.initialColumnIndex + columnDelta;
        const inHorizontalBounds =
          targetColumn >= 0 && targetColumn < config.visibleDayDates.length;

        const inValidGrid = inVerticalBounds && inHorizontalBounds;

        if (inValidGrid) {
          // Snap final position for a clean settle animation.
          const snappedStartMin = yToMinutes(
            proposedTopY,
            activeEvent.hourHeight,
          );
          const durationMin = Math.max(
            0,
            Math.round(
              (activeEvent.endTime.getTime() -
                activeEvent.startTime.getTime()) /
                60000,
            ),
          );
          const snappedEndMin = Math.min(
            snappedStartMin + durationMin,
            MINUTES_PER_DAY,
          );
          const clampedColumn = clamp(
            targetColumn,
            0,
            Math.max(0, config.visibleDayDates.length - 1),
          );

          // Animate the card to rest at the snapped position.
          if (shouldAnimate) {
            translationY.value = withSpring(
              minutesToY(snappedStartMin, activeEvent.hourHeight) -
                activeEvent.topY,
              springConfig,
            );
            translationX.value = withSpring(
              (clampedColumn - activeEvent.initialColumnIndex) *
                config.dayColumnWidth,
              springConfig,
            );
          } else {
            translationY.value =
              minutesToY(snappedStartMin, activeEvent.hourHeight) -
              activeEvent.topY;
            translationX.value =
              (clampedColumn - activeEvent.initialColumnIndex) *
              config.dayColumnWidth;
          }

          runOnJS(handleDrop)(snappedStartMin, snappedEndMin, clampedColumn);
        } else {
          // Req 4.5: spring back to original position.
          if (shouldAnimate) {
            translationY.value = withSpring(0, springConfig);
            translationX.value = withSpring(0, springConfig);
          } else {
            translationY.value = 0;
            translationX.value = 0;
          }
        }

        // Reset lift state either way — card returns to its resting scale.
        if (shouldAnimate) {
          scale.value = withSpring(1, springConfig);
          elevation.value = withTiming(0, { duration: 150 });
          shadowOpacity.value = withTiming(0, { duration: 150 });
        } else {
          scale.value = 1;
          elevation.value = 0;
          shadowOpacity.value = 0;
        }

        isDraggingShared.value = false;

        // Always clear the gesture context on release — Property 13.
        runOnJS(clearRescheduleContext)();
      })
      .onFinalize(() => {
        'worklet';
        // Safety net: if the gesture is cancelled (pointer up outside the
        // tracked view, external gesture takeover, etc) before onEnd
        // runs, make sure we still spring back, clear lift state, and
        // release the gesture context so the store does not get stuck
        // reporting an active reschedule gesture.
        if (isDraggingShared.value) {
          if (shouldAnimate) {
            translationY.value = withSpring(0, springConfig);
            translationX.value = withSpring(0, springConfig);
            scale.value = withSpring(1, springConfig);
            elevation.value = withTiming(0, { duration: 150 });
            shadowOpacity.value = withTiming(0, { duration: 150 });
          } else {
            translationY.value = 0;
            translationX.value = 0;
            scale.value = 1;
            elevation.value = 0;
            shadowOpacity.value = 0;
          }
          isDraggingShared.value = false;
          runOnJS(clearRescheduleContext)();
        }
      });

    return Gesture.Simultaneous(longPress, pan);
  }, [
    activeEvent,
    config,
    shouldAnimate,
    springConfig,
    triggerMediumHaptic,
    setRescheduleContext,
    clearRescheduleContext,
    handleSnapChange,
    handleDrop,
    // Shared values are stable across renders so they don't need to be in
    // the dep list — but listing them is harmless and explicit.
    translationX,
    translationY,
    scale,
    elevation,
    shadowOpacity,
    isDraggingShared,
    proposedStartMinutes,
    currentColumnIndex,
  ]);

  // ── Animated styles ───────────────────────────────────────────────────────

  /**
   * Card-level animated style. When reduced motion is active, we swap
   * scale/elevation for a border highlight per Req 4.6.
   */
  const animatedStyle = useAnimatedStyle(() => {
    'worklet';
    if (!shouldAnimate) {
      // Reduced motion: border highlight only; no transform beyond raw
      // translation (which is still needed so the card moves with the
      // finger — "skip the lift animation and scale-up" in Req 4.6 does
      // not mean skip translation).
      return {
        transform: [
          { translateX: translationX.value },
          { translateY: translationY.value },
        ],
        borderWidth: isDraggingShared.value ? REDUCED_MOTION_BORDER_WIDTH : 0,
        borderColor: tokens.colors.primary,
      };
    }
    return {
      transform: [
        { translateX: translationX.value },
        { translateY: translationY.value },
        { scale: scale.value },
      ],
      elevation: elevation.value,
      shadowOpacity: shadowOpacity.value,
      shadowOffset: { width: 0, height: 2 },
      shadowRadius: 6,
      shadowColor: '#000',
      // Ensure the dragged card is painted above siblings.
      zIndex: isDraggingShared.value ? 1000 : 0,
    };
  });

  /**
   * Time-indicator style — a label that follows the drag vertically and
   * shows the proposed start time. Positioned absolutely by the consumer;
   * the returned style just supplies the vertical translation (and a
   * visibility toggle via opacity so the label fades in/out with the lift).
   */
  const timeIndicatorStyle = useAnimatedStyle(() => {
    'worklet';
    if (!activeEvent) {
      return { opacity: 0 };
    }
    const proposedTopY = activeEvent.topY + translationY.value;
    return {
      position: 'absolute',
      top: proposedTopY,
      opacity: isDraggingShared.value ? 1 : 0,
      transform: [{ translateX: translationX.value }],
    };
  });

  // ── UI-thread → JS-thread reactions ───────────────────────────────────────
  //
  // Mirror isDragging onto the JS-side state snapshot so consumers reading
  // `state.isDragging` see an accurate value (useful when the drag ends
  // without a drop — onEnd fires but handleDrop does not, so stateRef
  // wouldn't otherwise be updated).
  useAnimatedReaction(
    () => isDraggingShared.value,
    (isDragging) => {
      if (!isDragging) {
        // Clear the JS-side state snapshot when the drag ends.
        runOnJS(markDragEndedJS)(stateRef);
      }
    },
    [stateRef],
  );

  return {
    gesture,
    state: stateRef.current,
    animatedStyle,
    timeIndicatorStyle,
  };
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Clamp `value` into the inclusive range [lo, hi]. Declared as a worklet
 * so it can be called from the pan `onUpdate` and `onEnd` handlers.
 */
function clamp(value: number, lo: number, hi: number): number {
  'worklet';
  if (value < lo) return lo;
  if (value > hi) return hi;
  return value;
}

/** JS-thread helper that resets transient drag fields on the state snapshot. */
function markDragEndedJS(stateRef: { current: DragRescheduleState }): void {
  stateRef.current.isDragging = false;
  stateRef.current.draggedEventId = null;
  stateRef.current.translationX = 0;
  stateRef.current.translationY = 0;
  stateRef.current.proposedDate = null;
  stateRef.current.proposedStart = null;
  stateRef.current.proposedEnd = null;
  stateRef.current.hasConflict = false;
}

/**
 * Pure helper: compute the proposed day-column index from the horizontal
 * translation. Re-exported from `./dragRescheduleMath` so consumers that
 * only need the coordinate math can import it without pulling in the
 * gesture/reanimated runtime.
 */
export { computeProposedColumnIndex } from './dragRescheduleMath';
