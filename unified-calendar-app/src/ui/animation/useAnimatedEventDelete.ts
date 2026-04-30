/**
 * `useAnimatedEventDelete` — gates actual event deletion behind the
 * `eventDeleted` shrink+fade animation so the EventCard disappears with
 * visual flair instead of popping out of the tree instantly.
 *
 * The existing `EventCRUDService.deleteEvent` removes the event from the
 * Zustand store IMMEDIATELY (see `src/events/eventCRUDService.ts` —
 * `eventsStore.removeEvent(eventId)` is called inline). That means we
 * cannot rely on `syncStatus: 'pending_delete'` for the animation
 * trigger; instead, we use a transient tracking set on the events store
 * (`pendingAnimatedDelete`) mirroring the `recentlyArrivedFromSync`
 * pattern from Task 2.5.
 *
 * Flow:
 *   1. `markPendingAnimatedDelete(eventId)` — EventCards observing this
 *      field play the `eventDeleted` animation.
 *   2. Wait 250ms (or 0ms when reduced motion is active — Req 7.5).
 *   3. `EventCRUDService.deleteEvent(eventId)` — removes the event from
 *      the store, unmounting the EventCard after the animation has
 *      completed.
 *   4. On error: `clearPendingAnimatedDelete(eventId)` reverts the card
 *      to its normal state and the failure is surfaced via the error
 *      store (Task 9.8 introduces an AutoDismissBanner; until that
 *      lands we rely on the existing `errorDisplayService` / notify
 *      fallback).
 *
 * Requirement: 7.3
 */

import { useCallback } from 'react';
import { useEventsStore } from '../../stores/eventsStore';
import { useReducedMotion } from '../accessibility/useAccessibility';
import type { EventCRUDService } from '../../events/eventCRUDService';

/** Duration of the `eventDeleted` animation — matches Req 7.3. */
const DELETE_ANIMATION_MS = 250;

export interface UseAnimatedEventDeleteConfig {
  /**
   * The `EventCRUDService` whose `deleteEvent` method performs the real
   * SQLite + sync-queue write. Passed in by the caller (typically
   * through a React context or a service locator) so the hook stays
   * decoupled from app-level service wiring.
   */
  crudService: Pick<EventCRUDService, 'deleteEvent'>;
  /**
   * Optional error callback. Called when `crudService.deleteEvent`
   * rejects or returns `{ success: false }`. Callers should surface the
   * message via an AutoDismissBanner (Task 9.8) when available.
   */
  onDeleteError?: (eventId: string, message: string) => void;
}

export interface UseAnimatedEventDeleteReturn {
  /** Start the animated-delete flow for the given event id. */
  deleteWithAnimation: (eventId: string) => Promise<void>;
}

/**
 * Hook that returns a `deleteWithAnimation` function gating deletion
 * behind the `eventDeleted` micro-animation.
 *
 * Callers (the delete button in the EventCard context menu,
 * swipe-to-delete in the agenda view) should invoke this function
 * instead of calling `EventCRUDService.deleteEvent` directly.
 */
export function useAnimatedEventDelete(
  config: UseAnimatedEventDeleteConfig,
): UseAnimatedEventDeleteReturn {
  const { crudService, onDeleteError } = config;
  const reducedMotion = useReducedMotion();
  // Get the underlying store actions imperatively so the hook does not
  // force its caller component to subscribe to every store change.
  const markPending = useEventsStore((s) => s.markPendingAnimatedDelete);
  const clearPending = useEventsStore((s) => s.clearPendingAnimatedDelete);

  const deleteWithAnimation = useCallback(
    async (eventId: string): Promise<void> => {
      // Step 1: flag the event as animating so EventCards shrink+fade.
      markPending(eventId);

      // Step 2: wait for the animation — or no delay under reduced motion.
      const waitMs = reducedMotion ? 0 : DELETE_ANIMATION_MS;
      await new Promise<void>((resolve) => {
        setTimeout(resolve, waitMs);
      });

      // Step 3: commit the deletion. Note that `deleteEvent` will remove
      // the event from the store, so the EventCard unmounts — at which
      // point the transient `pendingAnimatedDelete` entry becomes a
      // harmless no-op (no component is subscribed to it any longer).
      try {
        const result = await crudService.deleteEvent(eventId);
        if (result.success) {
          // Step 4: clean up the transient set so it does not grow
          // unbounded across long-running sessions with many deletes.
          // The EventCard is already unmounted by this point (deleteEvent
          // removed the event from the store), so no re-render is
          // triggered — but leaving entries in the set is a slow memory
          // leak (Task 2.7 step 4).
          clearPending(eventId);
        } else {
          // Step 4a: revert the visual state on failure.
          clearPending(eventId);
          const message =
            result.error ?? 'Failed to delete event. Please try again.';
          if (onDeleteError) {
            onDeleteError(eventId, message);
          } else {
            // TODO(Task 9.8): replace with AutoDismissBanner once the
            // error banner component lands. The `errors/errorStore`
            // module already exists; callers that need a richer UX can
            // pass their own `onDeleteError` callback.
            // eslint-disable-next-line no-console
            console.error(`[useAnimatedEventDelete] ${message}`);
          }
        }
      } catch (err) {
        // Step 4b: same revert path for thrown errors.
        clearPending(eventId);
        const message = err instanceof Error ? err.message : 'Unknown error';
        if (onDeleteError) {
          onDeleteError(eventId, message);
        } else {
          // TODO(Task 9.8): replace with AutoDismissBanner.
          // eslint-disable-next-line no-console
          console.error(`[useAnimatedEventDelete] ${message}`);
        }
      }
    },
    [crudService, markPending, clearPending, reducedMotion, onDeleteError],
  );

  return { deleteWithAnimation };
}
