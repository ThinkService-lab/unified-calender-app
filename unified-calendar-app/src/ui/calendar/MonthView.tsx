/**
 * MonthView – Monthly grid with event dots/previews.
 * Optimized to render a full month of events within 1 second.
 * Uses Design Token System for consistent theming.
 *
 * Task 18.2: Pull-to-refresh + AutoDismissBanner integration.
 *
 * Requirements: 1.5, 1.6, 2.2, 2.3, 2.6, 9.1, 9.4
 */

import React, { useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import Animated from 'react-native-reanimated';
import { GestureDetector } from 'react-native-gesture-handler';
import type { CalendarEvent } from '../../types/models';
import {
  buildMonthGridData,
  type MonthDayInfo,
} from './calendarViewModel';
import { getCalendarPatternIcon } from '../accessibility/calendarPatterns';
import { useTokens, type DesignTokens } from '../tokens/designTokens';
import { usePullToRefresh } from '../gestures/usePullToRefresh';
import { AutoDismissBanner } from '../gestures/AutoDismissBanner';

export interface MonthViewProps {
  date: Date;
  events: CalendarEvent[];
  accountColorMap: Record<string, string>;
  /** Map of accountId → index for pattern assignment */
  accountIndexMap?: Record<string, number>;
  onDayPress?: (date: Date) => void;
  onEventPress?: (event: CalendarEvent) => void;
  /** Sync callback for pull-to-refresh */
  onSync?: () => Promise<void>;
  /** Whether a sync is currently in progress */
  isSyncing?: boolean;
}

const DAY_HEADERS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MAX_VISIBLE_EVENTS = 3;

export function MonthView({ date, events, accountColorMap, accountIndexMap, onDayPress, onEventPress, onSync, isSyncing = false }: MonthViewProps) {
  const tokens = useTokens();

  const gridData = useMemo(
    () => buildMonthGridData(date, events),
    [date, events]
  );

  // Split into weeks (rows of 7)
  const weeks = useMemo(() => {
    const result: MonthDayInfo[][] = [];
    for (let i = 0; i < gridData.length; i += 7) {
      result.push(gridData.slice(i, i + 7));
    }
    return result;
  }, [gridData]);

  // ── Pull-to-refresh ─────────────────────────────────────────────────────
  const {
    gesture: pullGesture,
    indicatorStyle: pullIndicatorStyle,
    rotationStyle: pullRotationStyle,
    error: pullError,
  } = usePullToRefresh({
    triggerDistance: 80,
    onSync: onSync ?? (async () => {}),
    isSyncing,
  });

  return (
    <GestureDetector gesture={pullGesture}>
      <View style={[styles.container, { backgroundColor: tokens.colors.background }]}>
        <AutoDismissBanner message={pullError} />

        {/* Pull-to-refresh indicator */}
        <Animated.View style={[styles.pullIndicator, pullIndicatorStyle, pullRotationStyle]}>
          <Text style={[styles.pullIndicatorText, { color: tokens.colors.primary }]}>↻</Text>
        </Animated.View>

        {/* Day-of-week headers */}
        <View style={[styles.headerRow, { borderBottomColor: tokens.colors.borderLight, backgroundColor: tokens.colors.surfaceElevated }]}>
          {DAY_HEADERS.map((label) => (
            <View key={label} style={styles.headerCell}>
              <Text style={[styles.headerText, { color: tokens.colors.textSecondary }]}>{label}</Text>
            </View>
          ))}
        </View>

        {/* Grid rows */}
        {weeks.map((week, weekIdx) => (
          <View key={weekIdx} style={[styles.weekRow, { borderBottomColor: tokens.colors.borderLight }]}>
            {week.map((dayInfo) => (
              <MonthDayCell
                key={dayInfo.date.toISOString()}
                dayInfo={dayInfo}
                accountColorMap={accountColorMap}
                accountIndexMap={accountIndexMap}
                tokens={tokens}
                onDayPress={onDayPress}
                onEventPress={onEventPress}
              />
            ))}
          </View>
        ))}
      </View>
    </GestureDetector>
  );
}

/* ------------------------------------------------------------------ */
/*  MonthDayCell – memoized for performance                            */
/* ------------------------------------------------------------------ */

interface MonthDayCellProps {
  dayInfo: MonthDayInfo;
  accountColorMap: Record<string, string>;
  accountIndexMap?: Record<string, number>;
  tokens: DesignTokens;
  onDayPress?: (date: Date) => void;
  onEventPress?: (event: CalendarEvent) => void;
}

const MonthDayCell = React.memo(function MonthDayCell({
  dayInfo,
  accountColorMap,
  accountIndexMap,
  tokens,
  onDayPress,
  onEventPress,
}: MonthDayCellProps) {
  const { date, isCurrentMonth, isToday, events } = dayInfo;
  const visibleEvents = events.slice(0, MAX_VISIBLE_EVENTS);
  const moreCount = events.length - MAX_VISIBLE_EVENTS;

  return (
    <TouchableOpacity
      style={[styles.dayCell, { borderRightColor: tokens.colors.borderLight }]}
      onPress={() => onDayPress?.(date)}
      accessibilityRole="button"
      accessibilityLabel={`${date.toLocaleDateString()}, ${events.length} events`}
      activeOpacity={0.7}
    >
      <View style={[styles.dayNumberContainer, isToday && { backgroundColor: tokens.colors.primary }]}>
        <Text
          style={[
            styles.dayNumber,
            { color: tokens.colors.textPrimary },
            !isCurrentMonth && { color: tokens.colors.textMuted },
            isToday && { color: tokens.colors.textOnPrimary, fontWeight: tokens.typography.weights.semibold },
          ]}
        >
          {date.getDate()}
        </Text>
      </View>

      {/* Event dots / previews */}
      <View style={styles.eventList}>
        {visibleEvents.map((event) => {
          const color = accountColorMap[event.calendarAccountId] || tokens.colors.primary;
          return (
            <TouchableOpacity
              key={event.id}
              style={[styles.eventDot, { backgroundColor: color, borderRadius: tokens.radii.sm - 2 }]}
              onPress={() => onEventPress?.(event)}
              accessibilityRole="button"
              accessibilityLabel={event.title}
            >
              <Text style={[styles.eventDotText, { color: tokens.colors.textOnPrimary }]} numberOfLines={1}>
                {accountIndexMap ? `${getCalendarPatternIcon(accountIndexMap[event.calendarAccountId] ?? 0)} ` : ''}{event.title}
              </Text>
            </TouchableOpacity>
          );
        })}
        {moreCount > 0 && (
          <Text style={[styles.moreText, { color: tokens.colors.textSecondary }]}>+{moreCount} more</Text>
        )}
      </View>
    </TouchableOpacity>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    position: 'relative',
  },
  pullIndicator: {
    position: 'absolute',
    top: -40,
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
    height: 40,
    zIndex: 10,
  },
  pullIndicatorText: {
    fontSize: 24,
  },
  headerRow: {
    flexDirection: 'row',
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: 8,
  },
  headerCell: {
    flex: 1,
    alignItems: 'center',
  },
  headerText: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  weekRow: {
    flexDirection: 'row',
    flex: 1,
    minHeight: 80,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  dayCell: {
    flex: 1,
    borderRightWidth: StyleSheet.hairlineWidth,
    paddingVertical: 4,
    paddingHorizontal: 2,
  },
  dayNumberContainer: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: 2,
  },
  dayNumber: {
    fontSize: 12,
    fontWeight: '500',
  },
  eventList: {
    gap: 1,
  },
  eventDot: {
    paddingHorizontal: 4,
    paddingVertical: 1,
    marginBottom: 1,
  },
  eventDotText: {
    fontSize: 10,
    fontWeight: '500',
  },
  moreText: {
    fontSize: 10,
    paddingHorizontal: 4,
    fontWeight: '500',
  },
});
