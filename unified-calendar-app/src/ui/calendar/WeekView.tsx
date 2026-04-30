/**
 * WeekView – 7-day grid with time slots.
 * Requirements: 2.2, 2.3
 */

import React, { useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import type { CalendarEvent } from '../../types/models';
import {
  getWeekDates,
  getEventsForDay,
  formatTime,
  isSameDay,
  sortEventsByTime,
} from './calendarViewModel';
import { getEventBackgroundColor } from './colorCoding';
import { computeOverlapLayout } from './overlapLayout';
import { getCalendarPatternIcon } from '../accessibility/calendarPatterns';

export interface WeekViewProps {
  date: Date;
  events: CalendarEvent[];
  accountColorMap: Record<string, string>;
  /** Map of accountId → index for pattern assignment */
  accountIndexMap?: Record<string, number>;
  onEventPress?: (event: CalendarEvent) => void;
  onDayPress?: (date: Date) => void;
}

const HOUR_HEIGHT = 48;
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function WeekView({ date, events, accountColorMap, accountIndexMap, onEventPress, onDayPress }: WeekViewProps) {
  const weekDates = useMemo(() => getWeekDates(date), [date]);
  const today = useMemo(() => new Date(), []);

  const dayEventsMap = useMemo(() => {
    const map: Record<number, CalendarEvent[]> = {};
    for (let i = 0; i < 7; i++) {
      map[i] = sortEventsByTime(getEventsForDay(events, weekDates[i]));
    }
    return map;
  }, [events, weekDates]);

  /** Pre-compute overlap layouts per day column */
  const dayLayoutsMap = useMemo(() => {
    const map: Record<number, ReturnType<typeof computeOverlapLayout>> = {};
    for (let i = 0; i < 7; i++) {
      const timedEvents = (dayEventsMap[i] || []).filter((e) => !e.isAllDay);
      map[i] = computeOverlapLayout(timedEvents);
    }
    return map;
  }, [dayEventsMap]);

  return (
    <View style={styles.container}>
      {/* Day headers */}
      <View style={styles.headerRow}>
        <View style={styles.timeGutter} />
        {weekDates.map((d, i) => {
          const isToday = isSameDay(d, today);
          return (
            <TouchableOpacity
              key={i}
              style={styles.dayHeader}
              onPress={() => onDayPress?.(d)}
              accessibilityRole="button"
              accessibilityLabel={`${DAY_LABELS[d.getDay()]} ${d.getDate()}`}
            >
              <Text style={[styles.dayLabel, isToday && styles.dayLabelToday]}>
                {DAY_LABELS[d.getDay()]}
              </Text>
              <View style={[styles.dayNumber, isToday && styles.dayNumberToday]}>
                <Text style={[styles.dayNumberText, isToday && styles.dayNumberTextToday]}>
                  {d.getDate()}
                </Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Scrollable time grid */}
      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        <View style={styles.gridContainer}>
          {/* Hour labels + grid lines */}
          {HOURS.map((hour) => (
            <View key={hour} style={styles.hourRow}>
              <View style={styles.timeGutter}>
                <Text style={styles.hourLabel}>
                  {hour === 0 ? '' : hour < 12 ? `${hour}a` : hour === 12 ? '12p' : `${hour - 12}p`}
                </Text>
              </View>
              {weekDates.map((_, dayIdx) => (
                <View key={dayIdx} style={styles.gridCell}>
                  <View style={styles.gridLine} />
                </View>
              ))}
            </View>
          ))}

          {/* Events overlay per day column with overlap layout */}
          {weekDates.map((_, dayIdx) => {
            const layouts = dayLayoutsMap[dayIdx] || [];
            return layouts.map(({ event, column, totalColumns }) => {
              const color = accountColorMap[event.calendarAccountId] || '#1A73E8';
              const startMinutes = event.startTime.getHours() * 60 + event.startTime.getMinutes();
              const endMinutes = event.endTime.getHours() * 60 + event.endTime.getMinutes();
              const duration = Math.max(endMinutes - startMinutes, 15);
              const top = (startMinutes / 60) * HOUR_HEIGHT;
              const height = (duration / 60) * HOUR_HEIGHT;

              // Day column boundaries (percentage-based)
              const dayColumnStart = (dayIdx * 100) / 7;
              const dayColumnWidth = 100 / 7;
              const padding = dayColumnWidth * 0.03;
              const usableWidth = dayColumnWidth * 0.94;

              // Position within the day column based on overlap layout
              const eventWidth = usableWidth / totalColumns;
              const eventLeft = dayColumnStart + padding + column * eventWidth;

              return (
                <TouchableOpacity
                  key={event.id}
                  style={[
                    styles.weekEvent,
                    {
                      top,
                      height: Math.max(height, 16),
                      left: `${eventLeft}%` as any,
                      width: `${eventWidth}%` as any,
                      backgroundColor: getEventBackgroundColor(color),
                      borderLeftColor: color,
                      borderLeftWidth: 2,
                    },
                  ]}
                  onPress={() => onEventPress?.(event)}
                  accessibilityRole="button"
                  accessibilityLabel={`${event.title}, ${formatTime(event.startTime)}`}
                >
                  <Text style={[styles.weekEventTitle, { color }]} numberOfLines={1}>
                    {accountIndexMap ? `${getCalendarPatternIcon(accountIndexMap[event.calendarAccountId] ?? 0)} ` : ''}{event.title}
                  </Text>
                </TouchableOpacity>
              );
            });
          })}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  headerRow: {
    flexDirection: 'row',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E0E0E0',
    paddingVertical: 8,
    backgroundColor: '#FAFAFA',
  },
  timeGutter: {
    width: 44,
    alignItems: 'flex-end',
    paddingRight: 6,
  },
  dayHeader: {
    flex: 1,
    alignItems: 'center',
  },
  dayLabel: {
    fontSize: 11,
    fontWeight: '500',
    color: '#5F6368',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  dayLabelToday: {
    color: '#1A73E8',
  },
  dayNumber: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  dayNumberToday: {
    backgroundColor: '#1A73E8',
  },
  dayNumberText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#3C4043',
  },
  dayNumberTextToday: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  scrollView: {
    flex: 1,
  },
  gridContainer: {
    position: 'relative',
    marginLeft: 44,
  },
  hourRow: {
    flexDirection: 'row',
    height: HOUR_HEIGHT,
  },
  hourLabel: {
    fontSize: 10,
    color: '#80868B',
    marginTop: -6,
  },
  gridCell: {
    flex: 1,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E8EAED',
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: '#E8EAED',
  },
  gridLine: {
    height: StyleSheet.hairlineWidth,
  },
  weekEvent: {
    position: 'absolute',
    borderRadius: 3,
    paddingHorizontal: 4,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  weekEventTitle: {
    fontSize: 11,
    fontWeight: '600',
  },
});
