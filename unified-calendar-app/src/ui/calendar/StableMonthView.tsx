/**
 * StableMonthView – Stabilized MonthView wrapper that integrates
 * useStableNavigation to prevent crashes during rapid navigation (Req 6.4)
 * and ensures correct rendering for empty events, cross-boundary events,
 * and all valid months (Jan 1970 – Dec 2099).
 *
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.5
 */

import React, { useMemo } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import type { CalendarEvent } from '../../types/models';
import { MonthView } from './MonthView';
import { useStableNavigation } from './useStableNavigation';
import { useTokens } from '../tokens';

export interface StableMonthViewProps {
  /** The raw requested date from navigation (may change rapidly) */
  requestedDate: Date;
  /** Calendar events to display in the month grid */
  events: CalendarEvent[];
  /** Map of accountId → color for event indicators */
  accountColorMap: Record<string, string>;
  /** Map of accountId → index for pattern assignment */
  accountIndexMap?: Record<string, number>;
  /** Callback when a day cell is tapped (e.g., zoom to Day_View) */
  onDayPress?: (date: Date) => void;
  /** Callback when an event indicator is tapped */
  onEventPress?: (event: CalendarEvent) => void;
  /** Debounce window for stable navigation (default: 80ms) */
  navigationDebounceMs?: number;
}

/**
 * Clamp a date to the valid range: January 1970 – December 2099.
 * If the date is outside this range, it is clamped to the nearest boundary.
 */
function clampToValidRange(date: Date): Date {
  const MIN_YEAR = 1970;
  const MAX_YEAR = 2099;

  const year = date.getFullYear();

  if (year < MIN_YEAR) {
    console.warn(
      `StableMonthView: requested date ${date.toISOString()} is before Jan 1970, clamping to valid range.`,
    );
    return new Date(MIN_YEAR, 0, 1);
  }
  if (year > MAX_YEAR) {
    console.warn(
      `StableMonthView: requested date ${date.toISOString()} is after Dec 2099, clamping to valid range.`,
    );
    return new Date(MAX_YEAR, 11, 1);
  }
  return date;
}

export function StableMonthView({
  requestedDate,
  events,
  accountColorMap,
  accountIndexMap,
  onDayPress,
  onEventPress,
  navigationDebounceMs,
}: StableMonthViewProps) {
  const tokens = useTokens();

  // Clamp the requested date to valid range
  const clampedDate = useMemo(
    () => clampToValidRange(requestedDate),
    [requestedDate],
  );

  // Stabilize navigation to prevent crashes during rapid month changes
  const { stableDate, isPending } = useStableNavigation({
    requestedDate: clampedDate,
    debounceMs: navigationDebounceMs,
  });

  // Ensure events is always a valid array (Req 6.1: empty events array)
  const safeEvents = useMemo(
    () => (Array.isArray(events) ? events : []),
    [events],
  );

  return (
    <View style={styles.container}>
      {/* Subtle loading indicator when navigation is pending (Req 6.4) */}
      {isPending && (
        <View style={styles.pendingIndicator}>
          <ActivityIndicator size="small" color={tokens.colors.primary} />
        </View>
      )}

      {/* Render the existing MonthView with the stabilized date */}
      <MonthView
        date={stableDate}
        events={safeEvents}
        accountColorMap={accountColorMap}
        accountIndexMap={accountIndexMap}
        onDayPress={onDayPress}
        onEventPress={onEventPress}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    position: 'relative',
  },
  pendingIndicator: {
    position: 'absolute',
    top: 4,
    right: 4,
    zIndex: 10,
    opacity: 0.6,
  },
});
