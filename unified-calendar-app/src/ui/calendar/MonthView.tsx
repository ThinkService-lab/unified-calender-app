/**
 * MonthView – Monthly grid with event dots/previews.
 * Optimized to render a full month of events within 1 second.
 * Requirements: 2.2, 2.3, 2.6
 */

import React, { useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import type { CalendarEvent } from '../../types/models';
import {
  buildMonthGridData,
  formatMonthYear,
  type MonthDayInfo,
} from './calendarViewModel';
import { getCalendarPatternIcon } from '../accessibility/calendarPatterns';

export interface MonthViewProps {
  date: Date;
  events: CalendarEvent[];
  accountColorMap: Record<string, string>;
  /** Map of accountId → index for pattern assignment */
  accountIndexMap?: Record<string, number>;
  onDayPress?: (date: Date) => void;
  onEventPress?: (event: CalendarEvent) => void;
}

const DAY_HEADERS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MAX_VISIBLE_EVENTS = 3;

export function MonthView({ date, events, accountColorMap, accountIndexMap, onDayPress, onEventPress }: MonthViewProps) {
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

  return (
    <View style={styles.container}>
      {/* Day-of-week headers */}
      <View style={styles.headerRow}>
        {DAY_HEADERS.map((label) => (
          <View key={label} style={styles.headerCell}>
            <Text style={styles.headerText}>{label}</Text>
          </View>
        ))}
      </View>

      {/* Grid rows */}
      {weeks.map((week, weekIdx) => (
        <View key={weekIdx} style={styles.weekRow}>
          {week.map((dayInfo) => (
            <MonthDayCell
              key={dayInfo.date.toISOString()}
              dayInfo={dayInfo}
              accountColorMap={accountColorMap}
              onDayPress={onDayPress}
              onEventPress={onEventPress}
            />
          ))}
        </View>
      ))}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  MonthDayCell – memoized for performance                            */
/* ------------------------------------------------------------------ */

interface MonthDayCellProps {
  dayInfo: MonthDayInfo;
  accountColorMap: Record<string, string>;
  onDayPress?: (date: Date) => void;
  onEventPress?: (event: CalendarEvent) => void;
}

const MonthDayCell = React.memo(function MonthDayCell({
  dayInfo,
  accountColorMap,
  onDayPress,
  onEventPress,
}: MonthDayCellProps) {
  const { date, isCurrentMonth, isToday, events } = dayInfo;
  const visibleEvents = events.slice(0, MAX_VISIBLE_EVENTS);
  const moreCount = events.length - MAX_VISIBLE_EVENTS;

  return (
    <TouchableOpacity
      style={styles.dayCell}
      onPress={() => onDayPress?.(date)}
      accessibilityRole="button"
      accessibilityLabel={`${date.toLocaleDateString()}, ${events.length} events`}
      activeOpacity={0.7}
    >
      <View style={[styles.dayNumberContainer, isToday && styles.dayNumberToday]}>
        <Text
          style={[
            styles.dayNumber,
            !isCurrentMonth && styles.dayNumberMuted,
            isToday && styles.dayNumberTodayText,
          ]}
        >
          {date.getDate()}
        </Text>
      </View>

      {/* Event dots / previews */}
      <View style={styles.eventList}>
        {visibleEvents.map((event) => {
          const color = accountColorMap[event.calendarAccountId] || '#1A73E8';
          return (
            <TouchableOpacity
              key={event.id}
              style={[styles.eventDot, { backgroundColor: color }]}
              onPress={() => onEventPress?.(event)}
              accessibilityRole="button"
              accessibilityLabel={event.title}
            >
              <Text style={styles.eventDotText} numberOfLines={1}>
                {accountIndexMap ? `${getCalendarPatternIcon(accountIndexMap[event.calendarAccountId] ?? 0)} ` : ''}{event.title}
              </Text>
            </TouchableOpacity>
          );
        })}
        {moreCount > 0 && (
          <Text style={styles.moreText}>+{moreCount} more</Text>
        )}
      </View>
    </TouchableOpacity>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  headerRow: {
    flexDirection: 'row',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E0E0E0',
    backgroundColor: '#FAFAFA',
    paddingVertical: 8,
  },
  headerCell: {
    flex: 1,
    alignItems: 'center',
  },
  headerText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#5F6368',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  weekRow: {
    flexDirection: 'row',
    flex: 1,
    minHeight: 80,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E8EAED',
  },
  dayCell: {
    flex: 1,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: '#E8EAED',
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
  dayNumberToday: {
    backgroundColor: '#1A73E8',
  },
  dayNumber: {
    fontSize: 12,
    fontWeight: '500',
    color: '#3C4043',
  },
  dayNumberMuted: {
    color: '#BDC1C6',
  },
  dayNumberTodayText: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  eventList: {
    gap: 1,
  },
  eventDot: {
    borderRadius: 2,
    paddingHorizontal: 4,
    paddingVertical: 1,
    marginBottom: 1,
  },
  eventDotText: {
    fontSize: 10,
    color: '#FFFFFF',
    fontWeight: '500',
  },
  moreText: {
    fontSize: 10,
    color: '#5F6368',
    paddingHorizontal: 4,
    fontWeight: '500',
  },
});
