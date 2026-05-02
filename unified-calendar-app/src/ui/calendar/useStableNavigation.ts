/**
 * useStableNavigation – Debounce-based navigation stabilizer for Month View.
 *
 * Prevents crashes and stale renders during rapid month navigation by
 * debouncing state updates and cancelling stale renders via a generation
 * counter.
 *
 * Requirements: 6.4
 */

import { useState, useRef, useEffect } from 'react';

const DEFAULT_DEBOUNCE_MS = 80;

export interface UseStableNavigationConfig {
  /** The raw requested date from navigation props */
  requestedDate: Date;
  /** Debounce window in milliseconds (default: 80) */
  debounceMs?: number;
}

export interface UseStableNavigationReturn {
  /** The stabilized date to use for rendering (only updates after debounce) */
  stableDate: Date;
  /** Whether a navigation is currently pending (for showing a loading indicator) */
  isPending: boolean;
}

/**
 * Hook that prevents crashes and stale renders during rapid month navigation.
 *
 * Mechanism:
 * 1. Tracks the latest requested month via a useRef (latestRequestRef).
 * 2. On each navigation request, updates the ref immediately and schedules
 *    a state update via a debounce window (default 80ms).
 * 3. If a new navigation request arrives within the debounce window, the
 *    previous scheduled update is cancelled (clearTimeout on the pending
 *    timer ref), and only the latest request proceeds.
 * 4. The rendered month is derived from the debounced state, not the raw
 *    navigation prop, ensuring React only commits the final month.
 * 5. A renderGeneration counter (useRef<number>) is incremented on each
 *    request. The debounced callback checks if its generation matches the
 *    current counter before applying the state update — stale callbacks
 *    are no-ops.
 */
export function useStableNavigation(
  config: UseStableNavigationConfig,
): UseStableNavigationReturn {
  const { requestedDate, debounceMs = DEFAULT_DEBOUNCE_MS } = config;

  const [stableDate, setStableDate] = useState<Date>(requestedDate);
  const [isPending, setIsPending] = useState(false);

  // Track the latest requested date
  const latestRequestRef = useRef<Date>(requestedDate);

  // Generation counter to cancel stale renders
  const renderGenerationRef = useRef<number>(0);

  // Timer ref for debounce
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Update the latest request ref immediately
    latestRequestRef.current = requestedDate;

    // Increment generation counter
    renderGenerationRef.current += 1;
    const currentGeneration = renderGenerationRef.current;

    // If the requested date matches the stable date, no debounce needed
    if (
      requestedDate.getFullYear() === stableDate.getFullYear() &&
      requestedDate.getMonth() === stableDate.getMonth() &&
      requestedDate.getDate() === stableDate.getDate()
    ) {
      // Clear any pending timer since we're already at the right date
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      setIsPending(false);
      return;
    }

    // Mark as pending
    setIsPending(true);

    // Cancel any previously scheduled update
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
    }

    // Schedule the debounced state update
    timerRef.current = setTimeout(() => {
      // Only apply if this generation is still the latest
      if (currentGeneration === renderGenerationRef.current) {
        setStableDate(latestRequestRef.current);
        setIsPending(false);
      }
      timerRef.current = null;
    }, debounceMs);

    // Cleanup on unmount or before next effect run
    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [requestedDate, debounceMs]); // eslint-disable-line react-hooks/exhaustive-deps

  return { stableDate, isPending };
}
