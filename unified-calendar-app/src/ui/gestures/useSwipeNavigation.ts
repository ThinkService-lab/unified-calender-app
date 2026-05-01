/**
 * useSwipeNavigation
 *
 * Hook that creates a horizontal `Gesture.Pan()` from
 * `react-native-gesture-handler` for swipe-to-navigate time navigation in
 * the Day_View, Week_View, and Month_View on mobile. Exposes the animated
 * styles needed by the `SwipeNavigationHost` double-buffer wrapper (Task
 * 11.1A) so the outgoing and incoming views can slide in unison during
 * the drag and settle after commit.
 *
 * Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6
 *
 * ─── Gesture shape ───────────────────────────────────────────────────────────
 *
 * A single `Gesture.Pan()` — no long-press, no composition, no hit-area
 * gate. The gesture spans the whole view because swipe navigation is a
 * top-level navigation affordance and shouldn't require users to hit a
 * specific edge strip. Vertical scrolling coexistence is handled by the
 * velocity-discrimination check at release time rather than by limiting
 * where the gesture can start.
 *
 * ─── Horizontal / vertical discrimination (Req 15.3) ─────────────────────────
 *
 * On `.onEnd`, we compare |velocityX| against |velocityY|. If the
 * vertical component is equal or greater, the user was scrolling rather
 * than swiping — we fail the commit and spring back. Additionally, the
 * commit requires |translationX| ≥ `minDistance` (50 px). Either check
 * failing → spring back to center, don't fire a navigation callback.
 *
 * During `.onUpdate` we also honour the horizontal-dominance check so the
 * outgoing/incoming views do not wander sideways while the user is
 * scrolling vertically. This keeps the mid-drag visual stable and
 * prevents a jarring snap-back if the gesture started as a vertical
 * scroll and never dipped into horizontal motion.
 *
 * ─── Suppression during drag (Req 15.6 / Property 13) ────────────────────────
 *
 * `config.suppressSwipe` is a boolean that the caller wires from
 * `useGestureContext((s) => s.isDragActive)`. When it is `true` at any
 * point during the gesture, the hook short-circuits — no translation, no
 * commit. The caller is responsible for re-rendering the hook when the
 * drag state toggles, which Zustand does automatically via `useStore`.
 * Inside worklets we read the captured primitive `suppressSwipe` directly
 * (captured in the `useMemo` closure below) so the UI thread never
 * touches the store.
 *
 * ─── Animation (Req 15.4, 15.5) ──────────────────────────────────────────────
 *
 *   animatedStyle — current / outgoing view transform:
 *     translateX tracks the raw pan translation during drag.
 *     On commit, animates to `±screenWidth` over 300ms then resets.
 *     On cancel, springs back to 0.
 *
 *   incomingStyle — incoming view transform:
 *     translateX follows `translationX + direction * screenWidth` so the
 *     incoming view rides alongside the outgoing one from the opposite
 *     edge. Starts off-screen at `±screenWidth` when the gesture is
 *     idle. On commit, animates to 0 (fully on-screen) over 300ms.
 *
 *   direction = -Math.sign(translationX)
 *     Dragging LEFT (negative X) → navigating FORWARD, incoming comes
 *     from the right. Dragging RIGHT (positive X) → navigating BACK,
 *     incoming comes from the left.
 *
 * Under reduced motion (Req 15.5), we skip all animation: no translation
 * during drag, no slide on commit. The navigation callback fires
 * synchronously on commit and shared values reset instantly. This
 * matches the "skip the slide animation entirely" clause of Req 15.5.
 *
 * ─── Safety / reset ──────────────────────────────────────────────────────────
 *
 * `.onFinalize()` resets shared values if the gesture is cancelled
 * mid-drag (pointer lost, external takeover). Mirrors the pattern used by
 * `useDragReschedule` and `useDragResize`.
 */

import { useCallback, useMemo } from 'react';
import { useWindowDimensions } from 'react-native';
import { Gesture } from 'react-native-gesture-handler';
import type { PanGesture } from 'react-native-gesture-handler';
import {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import type { AnimatedStyle } from 'react-native-reanimated';
import type { ViewStyle } from 'react-native';

import { useAnimation } from '../animation/animationEngine';

// ─── Public types ─────────────────────────────────────────────────────────────

export interface SwipeNavigationConfig {
  /** Minimum horizontal swipe distance (pixels). Fixed at 50 per Req 15.3. */
  minDistance: 50;
  /** Transition duration (ms). Fixed at 300 per Req 15.4. */
  transitionDuration: 300;
  /** Callback for forward navigation (swipe LEFT → next day/week/month). */
  onNavigateForward: () => void;
  /** Callback for backward navigation (swipe RIGHT → prev day/week/month). */
  onNavigateBack: () => void;
  /**
   * Whether to suppress swipe (e.g., during drag-to-reschedule or
   * drag-to-resize). Callers should wire this from
   * `useGestureContext((s) => s.isDragActive)` so the hook re-renders
   * whenever a drag activates or clears.
   */
  suppressSwipe: boolean;
}

export interface UseSwipeNavigationReturn {
  gesture: PanGesture;
  /** Animated style applied to the current / outgoing view. */
  animatedStyle: AnimatedStyle<ViewStyle>;
  /**
   * Animated style applied to the incoming view. The incoming view's
   * position depends on swipe direction (right-edge for forward swipes,
   * left-edge for backward swipes); both neighbours should mount this
   * style and the host can fade the unused side via opacity.
   */
  incomingStyle: AnimatedStyle<ViewStyle>;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Build a horizontal swipe navigation gesture and return the animated
 * styles the host component should apply to the current and incoming
 * view layers.
 */
export function useSwipeNavigation(
  config: SwipeNavigationConfig,
): UseSwipeNavigationReturn {
  const { shouldAnimate } = useAnimation();
  const { width: screenWidth } = useWindowDimensions();

  // ── Shared values (UI-thread state) ───────────────────────────────────────
  //
  // `translationX` tracks the live pan translation during the drag and
  // doubles as the outgoing view's `translateX`.
  //
  // `incomingOffset` is the incoming view's `translateX` directly — at
  // rest it sits at `±screenWidth` (off-screen), during the drag it
  // follows `translationX + direction * screenWidth`, and on commit it
  // animates to 0 (fully visible in the current slot).
  //
  // Keeping `incomingOffset` as a separate shared value (rather than
  // deriving it inside `useAnimatedStyle`) lets us drive it with its own
  // `withTiming` / `withSpring` animator on release so the outgoing and
  // incoming views stay in sync during the 300ms commit transition.
  const translationX = useSharedValue(0);
  const incomingOffset = useSharedValue(0);
  /**
   * Direction of the incoming view relative to the current view:
   *   +1 → incoming view is to the right (forward swipe: user drags left)
   *   -1 → incoming view is to the left (backward swipe: user drags right)
   *    0 → idle (no gesture in progress)
   *
   * When idle we keep the incoming view off-screen by setting
   * `incomingOffset` to 0 and letting the animated style push it to
   * `±screenWidth` based on direction. Since both neighbours mount the
   * same `incomingStyle`, the host is expected to fade the non-matching
   * neighbour via opacity (see docblock on `incomingStyle` below).
   */
  const direction = useSharedValue(0);
  /** Whether a gesture is currently in progress (used by `.onFinalize` safety net). */
  const isSwipingShared = useSharedValue(false);

  // ── JS-thread callbacks (workletized via runOnJS) ─────────────────────────

  const handleForwardCommit = useCallback(() => {
    config.onNavigateForward();
  }, [config]);

  const handleBackwardCommit = useCallback(() => {
    config.onNavigateBack();
  }, [config]);

  // ── Gesture construction ──────────────────────────────────────────────────
  //
  // We build the gesture with the primitive bits of `config` captured into
  // locals so the worklets do not dereference the whole config object on
  // every frame. `suppressSwipe` is captured by value at the time the
  // gesture is (re)built — whenever the caller's `isDragActive` flips,
  // React re-renders, `useMemo` re-runs, and the worklets get a fresh
  // copy of the boolean.
  const gesture = useMemo<PanGesture>(() => {
    const minDistance = config.minDistance;
    const transitionDuration = config.transitionDuration;
    const suppressSwipe = config.suppressSwipe;
    // Captured primitive so the worklet doesn't read from a closure object
    // it can't sensibly serialise; screenWidth is a plain number.
    const width = screenWidth;
    const animate = shouldAnimate;

    return Gesture.Pan()
      .onBegin(() => {
        'worklet';
        if (suppressSwipe) return;
        isSwipingShared.value = true;
      })
      .onUpdate((event) => {
        'worklet';
        // Req 15.6 / Property 13: short-circuit while a drag gesture is
        // active in the gesture context store.
        if (suppressSwipe) {
          translationX.value = 0;
          incomingOffset.value = 0;
          direction.value = 0;
          return;
        }

        // Req 15.3: while the gesture is vertically dominant, keep the
        // view steady so we don't fight the native vertical scroll view.
        // Once the horizontal component overtakes vertical motion, the
        // translation follows the finger. We still don't commit here —
        // `.onEnd` re-evaluates the dominant axis for the commit check.
        if (Math.abs(event.translationX) <= Math.abs(event.translationY)) {
          translationX.value = 0;
          incomingOffset.value = 0;
          direction.value = 0;
          return;
        }

        // Req 15.5: under reduced motion we skip the slide animation
        // entirely — the translation stays at 0 so the current view
        // doesn't visibly move. The navigation callback on commit fires
        // synchronously and the host re-renders with the new anchorDate.
        if (!animate) {
          translationX.value = 0;
          incomingOffset.value = 0;
          // Still track direction so `.onEnd` can route to the correct
          // callback even though no visible motion occurred.
          direction.value = -Math.sign(event.translationX);
          return;
        }

        // Horizontal-dominant, not suppressed, motion allowed: the
        // outgoing view follows the finger and the incoming view rides
        // alongside from the opposite edge.
        const dir = -Math.sign(event.translationX);
        translationX.value = event.translationX;
        incomingOffset.value = event.translationX + dir * width;
        direction.value = dir;
      })
      .onEnd((event) => {
        'worklet';
        // Req 15.6: if a drag activated mid-swipe, drop the gesture
        // silently. Reset all shared values so the views rest in their
        // idle positions.
        if (suppressSwipe) {
          translationX.value = 0;
          incomingOffset.value = 0;
          direction.value = 0;
          isSwipingShared.value = false;
          return;
        }

        // Req 15.3: commit requires (a) the horizontal translation
        // threshold AND (b) horizontal velocity strictly greater than
        // vertical velocity. Failing either → spring back.
        const distanceMet = Math.abs(event.translationX) >= minDistance;
        const horizontallyDominant =
          Math.abs(event.velocityX) > Math.abs(event.velocityY);

        if (!distanceMet || !horizontallyDominant) {
          // Cancel: spring the outgoing view back to center and the
          // incoming view back to its off-screen resting position. We
          // spring `incomingOffset` to `dir * screenWidth` (the
          // off-screen edge) rather than 0 so the incoming view
          // visually retreats off-screen in concert with the outgoing
          // view returning to center. Once the spring completes, we
          // reset `direction` to 0 via a completion callback so the
          // idle branch of `incomingStyle` takes over.
          const committedDir = direction.value;
          if (animate) {
            translationX.value = withSpring(0, { damping: 20, stiffness: 180 });
            incomingOffset.value = withSpring(
              committedDir * width,
              { damping: 20, stiffness: 180 },
              (finished) => {
                'worklet';
                if (finished) {
                  direction.value = 0;
                  isSwipingShared.value = false;
                }
              },
            );
          } else {
            translationX.value = 0;
            incomingOffset.value = committedDir * width;
            direction.value = 0;
            isSwipingShared.value = false;
          }
          return;
        }

        // Commit path. translationX < 0 → forward (user dragged left);
        // translationX > 0 → backward (user dragged right).
        const navigatingForward = event.translationX < 0;
        const committedDirection = navigatingForward ? 1 : -1;

        if (!animate) {
          // Reduced motion: instant view switch. Reset shared values and
          // fire the navigation callback synchronously — the host will
          // re-render with the new anchorDate on the next React cycle.
          translationX.value = 0;
          incomingOffset.value = 0;
          direction.value = 0;
          isSwipingShared.value = false;
          if (navigatingForward) {
            runOnJS(handleForwardCommit)();
          } else {
            runOnJS(handleBackwardCommit)();
          }
          return;
        }

        // Animate the current view off to `-committedDirection * width`
        // (opposite the incoming view) and the incoming view to 0 over
        // the 300ms transition duration. After the outgoing animation
        // completes, fire the navigation callback on the JS thread; the
        // host is expected to re-render with the new anchorDate, at
        // which point the shared values reset and we snap back to idle.
        const outgoingTarget = -committedDirection * width;

        translationX.value = withTiming(
          outgoingTarget,
          { duration: transitionDuration },
          (finished) => {
            'worklet';
            if (finished) {
              if (navigatingForward) {
                runOnJS(handleForwardCommit)();
              } else {
                runOnJS(handleBackwardCommit)();
              }
              // Reset ready for the next swipe. The host re-renders
              // with the new anchorDate; the outgoing view is unmounted
              // and the incoming view becomes the new current view at
              // its idle (0) offset.
              translationX.value = 0;
              incomingOffset.value = 0;
              direction.value = 0;
              isSwipingShared.value = false;
            }
          },
        );
        incomingOffset.value = withTiming(0, { duration: transitionDuration });
      })
      .onFinalize(() => {
        'worklet';
        // Safety net for cancellation paths that skip `.onEnd()` (pointer
        // lost, external gesture takeover). If the swipe flag is still
        // set, reset all shared values so the views rest in their idle
        // positions. Mirrors the pattern used by `useDragReschedule` and
        // `useDragResize`.
        if (isSwipingShared.value) {
          const committedDir = direction.value;
          if (animate) {
            translationX.value = withSpring(0, { damping: 20, stiffness: 180 });
            incomingOffset.value = withSpring(
              committedDir * width,
              { damping: 20, stiffness: 180 },
              (finished) => {
                'worklet';
                if (finished) {
                  direction.value = 0;
                  isSwipingShared.value = false;
                }
              },
            );
          } else {
            translationX.value = 0;
            incomingOffset.value = committedDir * width;
            direction.value = 0;
            isSwipingShared.value = false;
          }
        }
      });
  }, [
    config.minDistance,
    config.transitionDuration,
    config.suppressSwipe,
    screenWidth,
    shouldAnimate,
    handleForwardCommit,
    handleBackwardCommit,
    // Shared values are stable across renders.
    translationX,
    incomingOffset,
    direction,
    isSwipingShared,
  ]);

  // ── Animated styles ───────────────────────────────────────────────────────

  /**
   * Current / outgoing view style. Tracks `translationX` during drag and
   * rides the commit / cancel animations on release.
   */
  const animatedStyle = useAnimatedStyle(() => {
    'worklet';
    return {
      transform: [{ translateX: translationX.value }],
    };
  });

  /**
   * Incoming view style. `translateX` directly positions the incoming
   * view on screen:
   *
   *   Idle (direction 0)         → off-screen at `+screenWidth` by
   *                                default, so the incoming layer is
   *                                invisible when no swipe is in
   *                                progress. The host mounts this style
   *                                on both neighbour layers and toggles
   *                                opacity based on which direction
   *                                matches the swipe — see docblock on
   *                                `SwipeNavigationHost`.
   *
   *   Drag (direction ±1)        → `translationX + direction*screenWidth`
   *                                so when `translationX = -width` the
   *                                incoming view sits at `0` (fully
   *                                on-screen) for a forward swipe, and
   *                                when `translationX = +width` the
   *                                incoming view sits at `0` for a
   *                                backward swipe.
   *
   *   Commit (`incomingOffset` → 0 via withTiming)
   *                              → slides the incoming view to the
   *                                current slot over 300ms. The commit
   *                                callback resets direction to 0 after
   *                                the animation finishes, at which
   *                                point the idle branch below takes
   *                                over and the view parks off-screen
   *                                ready for the next swipe.
   *
   *   Cancel (`incomingOffset` → `direction*screenWidth` via withSpring)
   *                              → springs the incoming view back to
   *                                its off-screen resting position in
   *                                concert with the outgoing view
   *                                returning to center. The spring's
   *                                completion callback resets direction
   *                                to 0 so the idle branch takes over.
   */
  const incomingStyle = useAnimatedStyle(() => {
    'worklet';
    const dir = direction.value;
    if (dir === 0) {
      // Idle: park the incoming view off-screen. We use +screenWidth as
      // an arbitrary "far" position; the host hides the incoming layer
      // via opacity when direction is 0 so the actual value here is
      // visually irrelevant.
      return {
        transform: [{ translateX: screenWidth }],
      };
    }
    return {
      transform: [{ translateX: incomingOffset.value }],
    };
  });

  return {
    gesture,
    animatedStyle,
    incomingStyle,
  };
}
