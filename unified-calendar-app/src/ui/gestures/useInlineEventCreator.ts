/**
 * useInlineEventCreator
 *
 * Hook that drives the click-to-create and click-drag-to-select flow on
 * the Day_View and Week_View timelines (Req 12.1–12.7).
 *
 * Unlike `useDragReschedule` / `useDragResize` / `useSwipeNavigation`
 * (which construct `Gesture.*` objects from `react-native-gesture-handler`
 * internally), this hook intentionally exposes IMPERATIVE handlers
 * (`onSlotPress`, `onSlotDragStart`, `onSlotDragMove`, `onSlotDragEnd`)
 * that the consuming View wires up from its own tap/pan gestures. The
 * consumer (Task 18.x) owns the GestureDetector tree and decides how to
 * bind these to UI events — this split keeps the hook testable without
 * any React Native or gesture-handler runtime, and lets the caller decide
 * how tap vs drag are distinguished (e.g. via a `Gesture.Tap()` composed
 * with `Gesture.Pan()` using `Exclusive` or `Race`).
 *
 * ─── Design-doc signature deviation ──────────────────────────────────────────
 *
 * The design doc specifies handler signatures in terms of pixel y values:
 *
 *     onSlotPress: (date: Date, y: number) => void
 *     onSlotDragStart: (date: Date, y: number) => void
 *     onSlotDragMove: (y: number) => void
 *
 * To convert `y` to minutes-from-midnight the hook needs to know the
 * pixel height representing one hour on the timeline. We therefore add
 * a single required field, `hourHeight: number`, to the
 * `InlineEventCreatorConfig` interface — everything else in the config
 * object matches the design doc exactly. This is the minimal addition
 * required to make the (date, y) handler signatures work and mirrors
 * the way `DragRescheduleActiveEvent` carries `hourHeight` in the
 * reschedule controller.
 *
 * ─── State machine ────────────────────────────────────────────────────────────
 *
 *   Idle
 *     │  isSelecting=false, isPopoverVisible=false,
 *     │  selectedStart=null, selectedEnd=null
 *     │
 *     │  onSlotPress(date, y)  ─── single tap ────────────────────────────────┐
 *     ▼                                                                       │
 *   Popover (tap)                                                             │
 *     │  isSelecting=false, isPopoverVisible=true,                            │
 *     │  selectedStart = (date, snapToIncrement(yToMinutes(y), 15)),          │
 *     │  selectedEnd = selectedStart + 15min (Req 12.1, 12.7)                 │
 *     │                                                                       │
 *     │  onPopoverSubmit(title) ─┐  onPopoverDismiss()  ──┐                   │
 *     └─────────────────────────►│                       │                   │
 *                                 ▼                       ▼                   │
 *   onCreate(start, end, title)   Idle                                        │
 *   then → Idle                   (Req 12.6)                                  │
 *                                                                             │
 *     Idle                                                                    │
 *     │  onSlotDragStart(date, y)  ─── click + drag ──────────────────────────┘
 *     ▼
 *   Selecting
 *     │  isSelecting=true, isPopoverVisible=false
 *     │  selectedStart = (date, snapToIncrement(yToMinutes(y), 15))
 *     │  selectedEnd = selectedStart + 15min  (seed so overlay is visible)
 *     │
 *     │  onSlotDragMove(y)  (called repeatedly)
 *     │    selectedEnd = (date, snapToIncrement(yToMinutes(y), 15))
 *     │
 *     │  onSlotDragEnd()
 *     ▼
 *   Popover (drag)
 *     │  isSelecting=false, isPopoverVisible=true
 *     │  final selectedEnd clamped so (end - start) >= 15min (Req 12.7)
 *     │  final selectedEnd snapped to 15min grid (Req 12.2)
 *     │  swap start/end if the user dragged upward (negative direction)
 *     │
 *     │  onPopoverSubmit(title) / onPopoverDismiss() → Idle
 *     ▼
 *
 * ─── Overlay animation (Req 12.3) ────────────────────────────────────────────
 *
 * The hook returns an `overlayStyle` animated style that the caller
 * applies to a positioned `<Animated.View>` rendered over the time
 * grid. While `isSelecting` or `isPopoverVisible` is true the overlay
 * paints a translucent highlight at the snapped `selectedStart` →
 * `selectedEnd` range. When neither flag is set the overlay's opacity
 * is 0 (effectively invisible but still mounted so reanimated doesn't
 * have to tear the style down).
 *
 * The overlay's opacity transitions use `withTiming(target,
 * { duration: shouldAnimate ? 100 : 0 })`, so reduced-motion users see
 * the overlay appear/disappear instantly (Req 2.5, 7.5).
 *
 * ─── Error handling ──────────────────────────────────────────────────────────
 *
 * `config.onCreate` returns a `Promise<void>`. On either fulfilment or
 * rejection the hook resets back to idle (`isPopoverVisible=false`,
 * selected range cleared). This guarantees the popover always closes
 * after submission so a failed create doesn't leave the user stuck in a
 * modal state. Task 10A.4 will layer on a banner / retry affordance for
 * the rejection case — consumers may also attach their own `.catch` on
 * the `onCreate` side if they need mid-flight UX.
 *
 * Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import type { AnimatedStyle } from 'react-native-reanimated';
import type { ViewStyle } from 'react-native';

import { useAnimation } from '../animation/animationEngine';
import { useTokens } from '../tokens';
import {
  minutesToY,
  snapToIncrement,
  yToMinutes,
} from '../calendar/timeSlotUtils';

// ─── Public types ─────────────────────────────────────────────────────────────

export interface InlineEventCreatorConfig {
  /** Snap increment for time selection (minutes). Fixed at 15 per Req 12.1, 12.2. */
  snapIncrement: 15;
  /**
   * Minimum event duration for single-click creates and also the floor
   * enforced on click-drag selections (minutes). Fixed at 15 per Req 12.7.
   */
  minimumDuration: 15;
  /**
   * Pixel height of one hour on the timeline. Required so the hook can
   * convert the `y` values passed to `onSlotPress` / `onSlotDragStart` /
   * `onSlotDragMove` into minutes-from-midnight. See the top-of-file
   * deviation note for why this is on the config (rather than a sibling
   * argument).
   */
  hourHeight: number;
  /**
   * Callback invoked when the user submits the inline popover. Returns a
   * promise so callers can run async persistence; the hook resets to
   * idle on either fulfilment or rejection.
   */
  onCreate: (start: Date, end: Date, title: string) => Promise<void>;
}

export interface InlineCreatorState {
  /** True during an active click-drag selection (between drag start and drag end). */
  isSelecting: boolean;
  /** True when the inline title-input popover is visible. */
  isPopoverVisible: boolean;
  /** Selected range start, or `null` when idle. */
  selectedStart: Date | null;
  /** Selected range end, or `null` when idle. */
  selectedEnd: Date | null;
}

export interface UseInlineEventCreatorReturn {
  state: InlineCreatorState;
  /** Single-click: create a 15-min event at the clicked slot (Req 12.1, 12.7). */
  onSlotPress: (date: Date, y: number) => void;
  /** Click-drag start: begin tracking a selection (Req 12.2, 12.3). */
  onSlotDragStart: (date: Date, y: number) => void;
  /** Click-drag move: update the selection's end (Req 12.2, 12.3). */
  onSlotDragMove: (y: number) => void;
  /** Click-drag end: finalise the selection and open the popover (Req 12.4). */
  onSlotDragEnd: () => void;
  /** Submit the popover and call `onCreate` (Req 12.5). */
  onPopoverSubmit: (title: string) => void;
  /** Dismiss the popover without creating (Escape / click-outside — Req 12.6). */
  onPopoverDismiss: () => void;
  /**
   * Animated style for the highlighted overlay rendered over the time
   * grid (Req 12.3). Consumers apply this to a positioned
   * `<Animated.View>` with `position: 'absolute'`.
   */
  overlayStyle: AnimatedStyle<ViewStyle>;
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** Default title used when the user submits the popover with an empty title. */
const DEFAULT_EVENT_TITLE = 'New Event';
/** Opacity of the selection highlight overlay when visible. */
const OVERLAY_ACTIVE_OPACITY = 0.25;
/** Duration of the overlay fade-in/out in motion-enabled mode (ms). */
const OVERLAY_TIMING_MS = 100;
/** Minutes per day — ceiling on the selection range. */
const MINUTES_PER_DAY = 1440;

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useInlineEventCreator(
  config: InlineEventCreatorConfig,
): UseInlineEventCreatorReturn {
  const { shouldAnimate } = useAnimation();
  const tokens = useTokens();

  // ── JS-thread reactive state ──────────────────────────────────────────────
  //
  // The popover / selection UI is rendered by React — we need real React
  // state so the consumer can conditionally mount an `<InlineEventPopover />`
  // based on `state.isPopoverVisible`. A shared value wouldn't gate a
  // React render directly. The UI-thread overlay animation (below) uses
  // separate shared values that we drive from the same handlers.
  const [state, setState] = useState<InlineCreatorState>({
    isSelecting: false,
    isPopoverVisible: false,
    selectedStart: null,
    selectedEnd: null,
  });

  // ── UI-thread shared values for the overlay ───────────────────────────────
  //
  // Kept as minutes-from-midnight rather than pixel y so the overlay's
  // animated style can derive both `top` and `height` from the same
  // source. Converting inside `useAnimatedStyle` keeps the math in one
  // place and lets the style react to `hourHeight` changes across
  // renders without extra plumbing.
  const overlayStartMinutes = useSharedValue(0);
  const overlayEndMinutes = useSharedValue(0);
  const overlayOpacity = useSharedValue(0);

  // ── Refs to avoid stale closures in handler callbacks ─────────────────────
  //
  // The handlers close over these so we always see the latest config /
  // shouldAnimate values without regenerating handler identities on every
  // render (which would cause unnecessary re-bindings in the consumer's
  // GestureDetector tree). Keeping callbacks stable also means the
  // consumer can pass them directly to a `Gesture.*` object without
  // wrapping.
  const configRef = useRef(config);
  configRef.current = config;
  const shouldAnimateRef = useRef(shouldAnimate);
  shouldAnimateRef.current = shouldAnimate;

  /**
   * The date of the day column the active drag started on. Captured at
   * `onSlotDragStart` so subsequent `onSlotDragMove` calls (which don't
   * receive a `date`) build their end-time on the correct calendar day.
   */
  const activeDragDateRef = useRef<Date | null>(null);
  /**
   * Starting minutes-from-midnight of the active drag selection. Captured
   * at `onSlotDragStart` so `onSlotDragEnd` can enforce the 15-minute
   * minimum duration and handle upward drags (negative direction) by
   * swapping start/end.
   */
  const activeDragStartMinutesRef = useRef<number | null>(null);
  /**
   * Latest snapped end minutes during the active drag. Read at
   * `onSlotDragEnd` so the finalised selection matches the last
   * `onSlotDragMove` value without needing an extra "final y".
   */
  const activeDragEndMinutesRef = useRef<number | null>(null);

  // ── Overlay animation helpers ─────────────────────────────────────────────

  const showOverlay = useCallback(
    (startMin: number, endMin: number) => {
      overlayStartMinutes.value = startMin;
      overlayEndMinutes.value = endMin;
      const duration = shouldAnimateRef.current ? OVERLAY_TIMING_MS : 0;
      overlayOpacity.value = withTiming(OVERLAY_ACTIVE_OPACITY, { duration });
    },
    [overlayStartMinutes, overlayEndMinutes, overlayOpacity],
  );

  const updateOverlayEnd = useCallback(
    (endMin: number) => {
      overlayEndMinutes.value = endMin;
    },
    [overlayEndMinutes],
  );

  const hideOverlay = useCallback(() => {
    const duration = shouldAnimateRef.current ? OVERLAY_TIMING_MS : 0;
    overlayOpacity.value = withTiming(0, { duration });
  }, [overlayOpacity]);

  // ── Imperative handlers ───────────────────────────────────────────────────

  /**
   * Single tap on an empty slot: open the popover pre-populated with a
   * 15-minute selection snapped to the nearest 15-minute boundary
   * (Req 12.1, 12.7).
   */
  const onSlotPress = useCallback(
    (date: Date, y: number) => {
      const { snapIncrement, minimumDuration, hourHeight } = configRef.current;
      const rawMinutes = yToMinutes(y, hourHeight);
      // `yToMinutes` already snaps to 15-minute boundaries, but go through
      // `snapToIncrement` once more so any future change to the default
      // snap resolution doesn't silently break this hook.
      const startMin = snapToIncrement(rawMinutes, snapIncrement);
      // Clamp the end to the day's last minute so a tap at 23:55 doesn't
      // produce an end beyond midnight — `snapToIncrement` takes care of
      // the ceiling for us but we still cap the value explicitly so the
      // math below is obviously correct.
      const endMin = Math.min(startMin + minimumDuration, MINUTES_PER_DAY);

      const selectedStart = buildDateAtMinutes(date, startMin);
      const selectedEnd = buildDateAtMinutes(date, endMin);

      setState({
        isSelecting: false,
        isPopoverVisible: true,
        selectedStart,
        selectedEnd,
      });
      showOverlay(startMin, endMin);
    },
    [showOverlay],
  );

  /**
   * Click-drag start: seed the selection with a zero-length range at
   * the snapped start minute and enter the `isSelecting` phase (Req 12.2).
   */
  const onSlotDragStart = useCallback(
    (date: Date, y: number) => {
      const { snapIncrement, minimumDuration, hourHeight } = configRef.current;
      const rawMinutes = yToMinutes(y, hourHeight);
      const startMin = snapToIncrement(rawMinutes, snapIncrement);
      // Seed the end at start + minimumDuration so the overlay is immediately
      // visible (otherwise a zero-height overlay would confuse the user
      // until the first `onSlotDragMove` fires).
      const endMin = Math.min(startMin + minimumDuration, MINUTES_PER_DAY);

      activeDragDateRef.current = date;
      activeDragStartMinutesRef.current = startMin;
      activeDragEndMinutesRef.current = endMin;

      const selectedStart = buildDateAtMinutes(date, startMin);
      const selectedEnd = buildDateAtMinutes(date, endMin);

      setState({
        isSelecting: true,
        isPopoverVisible: false,
        selectedStart,
        selectedEnd,
      });
      showOverlay(startMin, endMin);
    },
    [showOverlay],
  );

  /**
   * Click-drag move: update the selection's end minute as the user drags
   * vertically. We keep the overlay's visual end in sync by updating the
   * shared value directly (no re-render) and only push the snapped end
   * into React state when the user crosses a 15-minute boundary so the
   * `state.selectedEnd` consumers see matches what the overlay draws.
   */
  const onSlotDragMove = useCallback(
    (y: number) => {
      const startMin = activeDragStartMinutesRef.current;
      const dragDate = activeDragDateRef.current;
      if (startMin === null || dragDate === null) return;

      const { snapIncrement, hourHeight } = configRef.current;
      const rawMinutes = yToMinutes(y, hourHeight);
      const snappedEndMin = snapToIncrement(rawMinutes, snapIncrement);

      // Only update React state when the snapped minute value actually
      // changes — `yToMinutes` is already snap-quantised so this check
      // is mostly a no-op, but it makes the intent explicit.
      if (snappedEndMin === activeDragEndMinutesRef.current) return;
      activeDragEndMinutesRef.current = snappedEndMin;

      updateOverlayEnd(snappedEndMin);

      // Keep the selectedEnd in React state accurate (consumers may show
      // a live time label while dragging — e.g. an inline timestamp next
      // to the overlay).
      const selectedEnd = buildDateAtMinutes(dragDate, snappedEndMin);
      setState((prev) => {
        if (!prev.isSelecting) return prev;
        return { ...prev, selectedEnd };
      });
    },
    [updateOverlayEnd],
  );

  /**
   * Click-drag end: finalise the selection (normalise direction, enforce
   * 15-minute minimum) and open the popover (Req 12.2, 12.4, 12.7).
   */
  const onSlotDragEnd = useCallback(() => {
    const dragDate = activeDragDateRef.current;
    const startMinAtPress = activeDragStartMinutesRef.current;
    const endMinAtRelease = activeDragEndMinutesRef.current;
    activeDragDateRef.current = null;
    activeDragStartMinutesRef.current = null;
    activeDragEndMinutesRef.current = null;

    if (
      dragDate === null ||
      startMinAtPress === null ||
      endMinAtRelease === null
    ) {
      // Drag was never started (onSlotDragStart wasn't called) — nothing
      // to finalise. Return to idle defensively.
      setState({
        isSelecting: false,
        isPopoverVisible: false,
        selectedStart: null,
        selectedEnd: null,
      });
      hideOverlay();
      return;
    }

    const { minimumDuration } = configRef.current;

    // Handle upward drag by swapping start/end — the user's intent is a
    // range from the smaller to the larger minute value regardless of
    // direction.
    let rangeStartMin = Math.min(startMinAtPress, endMinAtRelease);
    let rangeEndMin = Math.max(startMinAtPress, endMinAtRelease);

    // Enforce 15-minute minimum duration (Req 12.7). If the user released
    // less than a snap boundary away from where they pressed, extend the
    // end forward by `minimumDuration`. If that would push us past end of
    // day, pull the start backward instead.
    if (rangeEndMin - rangeStartMin < minimumDuration) {
      if (rangeStartMin + minimumDuration <= MINUTES_PER_DAY) {
        rangeEndMin = rangeStartMin + minimumDuration;
      } else {
        rangeEndMin = MINUTES_PER_DAY;
        rangeStartMin = Math.max(0, MINUTES_PER_DAY - minimumDuration);
      }
    }

    const selectedStart = buildDateAtMinutes(dragDate, rangeStartMin);
    const selectedEnd = buildDateAtMinutes(dragDate, rangeEndMin);

    setState({
      isSelecting: false,
      isPopoverVisible: true,
      selectedStart,
      selectedEnd,
    });
    // Keep the overlay visible at its final range — it stays painted
    // while the popover is open so the user can see the slot they're
    // naming.
    overlayStartMinutes.value = rangeStartMin;
    overlayEndMinutes.value = rangeEndMin;
  }, [hideOverlay, overlayStartMinutes, overlayEndMinutes]);

  /**
   * Submit the popover: invoke `onCreate` and reset to idle regardless
   * of whether the promise fulfils or rejects (Req 12.5).
   */
  const onPopoverSubmit = useCallback(
    (title: string) => {
      const startDate = state.selectedStart;
      const endDate = state.selectedEnd;
      if (!startDate || !endDate) {
        // Defensive — submit shouldn't fire without a selection but if
        // it does, just reset.
        resetToIdle(setState, hideOverlay);
        return;
      }

      const trimmedTitle = title.trim();
      const finalTitle = trimmedTitle.length > 0 ? trimmedTitle : DEFAULT_EVENT_TITLE;

      // Reset to idle optimistically — the popover should close immediately
      // on submit (per Req 12.5's creation flow). Errors surface via the
      // consumer's own handling (eventual Task 10A.4 banner).
      resetToIdle(setState, hideOverlay);

      // Fire-and-forget. We swallow rejections here so a rejected promise
      // doesn't bubble up as an "unhandled promise rejection" in the
      // default case; consumers that care about errors should attach
      // their own `.catch` on the `onCreate` they pass in, OR rely on
      // Task 10A.4's banner infrastructure once it lands.
      void configRef.current
        .onCreate(startDate, endDate, finalTitle)
        .catch(() => {
          // Swallowed — see comment above. The state machine is already
          // back in the idle state so a failure doesn't trap the user.
        });
    },
    [state.selectedStart, state.selectedEnd, hideOverlay],
  );

  /** Dismiss the popover without creating (Escape / click-outside — Req 12.6). */
  const onPopoverDismiss = useCallback(() => {
    resetToIdle(setState, hideOverlay);
  }, [hideOverlay]);

  // ── Overlay animated style ────────────────────────────────────────────────

  /**
   * Positioned overlay style consumed by a `<Animated.View>` rendered
   * over the time grid. `top` / `height` come from the shared-value
   * selection range (converted to pixels via `minutesToY` using the
   * current `hourHeight`). `opacity` is driven by `overlayOpacity`, which
   * transitions via `withTiming` (honouring reduced motion in its
   * duration).
   */
  const { hourHeight } = config;
  const overlayBackground = tokens.colors.primary;
  const overlayBorderColor = tokens.colors.primary;
  const overlayStyle = useAnimatedStyle(() => {
    'worklet';
    const startMin = overlayStartMinutes.value;
    const endMin = overlayEndMinutes.value;
    const top = minutesToY(startMin, hourHeight);
    const rawHeight = minutesToY(endMin, hourHeight) - top;
    const height = rawHeight > 0 ? rawHeight : 0;

    return {
      position: 'absolute' as const,
      left: 0,
      right: 0,
      top,
      height,
      opacity: overlayOpacity.value,
      backgroundColor: overlayBackground,
      borderLeftWidth: 2,
      borderLeftColor: overlayBorderColor,
    };
  });

  return useMemo(
    () => ({
      state,
      onSlotPress,
      onSlotDragStart,
      onSlotDragMove,
      onSlotDragEnd,
      onPopoverSubmit,
      onPopoverDismiss,
      overlayStyle,
    }),
    [
      state,
      onSlotPress,
      onSlotDragStart,
      onSlotDragMove,
      onSlotDragEnd,
      onPopoverSubmit,
      onPopoverDismiss,
      overlayStyle,
    ],
  );
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Build a `Date` at the given minutes-from-midnight on the same calendar
 * day as `dayDate`. The returned `Date` preserves the local-time Y-M-D
 * of `dayDate` and sets hour/minute/second/ms to the snapped time — this
 * matches the convention used by the timeline renderers and the
 * `buildProposedEnd` helper in `useDragResize`.
 *
 * `minutesFromMidnight` is expected to be in [0, 1440]; values of 1440
 * (end-of-day) roll forward into the next day via `Date.setHours`'s
 * natural overflow, which is the right behaviour for a selection that
 * spans right up to midnight.
 */
function buildDateAtMinutes(dayDate: Date, minutesFromMidnight: number): Date {
  const result = new Date(dayDate);
  const hours = Math.floor(minutesFromMidnight / 60);
  const minutes = minutesFromMidnight % 60;
  result.setHours(hours, minutes, 0, 0);
  return result;
}

/**
 * Transition the React state back to idle and fade out the overlay.
 * Shared between `onPopoverSubmit` and `onPopoverDismiss` so the reset
 * behaviour is identical on both paths.
 */
function resetToIdle(
  setState: React.Dispatch<React.SetStateAction<InlineCreatorState>>,
  hideOverlay: () => void,
): void {
  setState({
    isSelecting: false,
    isPopoverVisible: false,
    selectedStart: null,
    selectedEnd: null,
  });
  hideOverlay();
}
