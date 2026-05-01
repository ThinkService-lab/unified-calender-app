/**
 * Gesture context store using zustand/vanilla.
 *
 * Shared gesture coordination state used by drag/resize/swipe gesture
 * controllers. A vanilla store is used (mirroring `syncStatusStore`) so that
 * non-React code paths (e.g., Reanimated worklets via `runOnJS`, imperative
 * gesture controllers) can read and write the active gesture without needing
 * a React render context.
 *
 * See design.md §"Gesture Context Store" and Property 13 for the contract.
 *
 * Requirements: 15.6
 */

import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { createStore } from 'zustand/vanilla';

/**
 * Active gesture type. `null` means no gesture is currently being performed.
 *
 * - `'reschedule'`: drag-to-reschedule in progress (suppresses swipe nav)
 * - `'resize'`:     drag-to-resize in progress (suppresses swipe nav)
 * - `'swipe'`:      horizontal swipe navigation in progress
 * - `'pull-to-refresh'`: pull-to-refresh gesture in progress
 */
export type ActiveGesture =
  | 'reschedule'
  | 'resize'
  | 'swipe'
  | 'pull-to-refresh'
  | null;

/** Read-only gesture context snapshot exposed to consumers. */
export interface GestureContext {
  /** Whether any drag gesture (reschedule or resize) is currently active. */
  isDragActive: boolean;
  /** The active gesture type, or `null` when no gesture is in progress. */
  activeGesture: ActiveGesture;
}

/** Full store shape including mutating actions. */
export interface GestureContextState extends GestureContext {
  /**
   * Set the active gesture. Passing `null` is equivalent to calling
   * {@link GestureContextState.clearActiveGesture}.
   */
  setActiveGesture: (gesture: ActiveGesture) => void;
  /** Clear the active gesture (sets `activeGesture = null`, `isDragActive = false`). */
  clearActiveGesture: () => void;
}

/**
 * Derive `isDragActive` from the active gesture. Only drag-style gestures
 * (reschedule, resize) suppress swipe navigation (Property 13 / Req 15.6).
 */
function computeIsDragActive(gesture: ActiveGesture): boolean {
  return gesture === 'reschedule' || gesture === 'resize';
}

const initialState: GestureContext = {
  isDragActive: false,
  activeGesture: null,
};

/**
 * Vanilla store for use in both React and non-React contexts (gesture
 * worklets, imperative controllers).
 */
export const gestureContextStore = createStore<GestureContextState>()((set) => ({
  ...initialState,

  setActiveGesture: (gesture: ActiveGesture) =>
    set({
      activeGesture: gesture,
      isDragActive: computeIsDragActive(gesture),
    }),

  clearActiveGesture: () =>
    set({
      activeGesture: null,
      isDragActive: false,
    }),
}));

/**
 * React hook to read gesture context state.
 *
 * Overload 1: no-arg — returns the read-only {@link GestureContext} snapshot
 * using `useShallow` so components only re-render when either field changes.
 * Overload 2: with selector — returns the selected slice. Prefer atomic
 * selectors (e.g., `useGestureContext((s) => s.isDragActive)`) for minimal
 * re-renders.
 */
export function useGestureContext(): GestureContext;
export function useGestureContext<T>(selector: (state: GestureContextState) => T): T;
export function useGestureContext<T>(
  selector?: (state: GestureContextState) => T,
): T | GestureContext {
  if (selector) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return useStore(gestureContextStore, selector);
  }
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return useStore(
    gestureContextStore,
    useShallow((s) => ({
      isDragActive: s.isDragActive,
      activeGesture: s.activeGesture,
    })),
  );
}
