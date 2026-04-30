/**
 * DayView – Single day timeline with hourly slots.
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
  getEventsForDay,
  formatTime,
  formatShortDate,
  sortEventsByTime,
} from './calendarViewModel';
import { getEventBackgroundColor, getEventBorderColor } from './colorCoding';
import { computeOverlapLayout } from './overlapLayout';
import { getCalendarPatternIcon } from '../accessibility/calendarPatterns';

export interface DayViewProps {
  date: Date;
  events: CalendarEvent[];
  accountColorMap: Record<string, string>;
  /** Map of accountId → index for pattern assignment */
  accountIndexMap?: Record<string, number>;
  onEventPress?: (event: CalendarEvent) => void;
}

const HOUR_HEIGHT = 60;
const HOURS = Array.from({ length: 24 }, (_, i) => i);

export function DayView({ date, events, accountColorMap, accountIndexMap, onEventPress }: DayViewProps) {
  const dayEvents = useMemo(
    () => sortEventsByTime(getEventsForDay(events, date)),
    [events, date]
  );

  const allDayEvents = useMemo(
    () => dayEvents.filter((e) => e.isAllDay),
    [dayEvents]
  );

  const timedEvents = useMemo(
    () => dayEvents.filter((e) => !e.isAllDay),
    [dayEvents]
  );

  const timedEventLayouts = useMemo(
    () => computeOverlapLayout(timedEvents),
    [timedEvents]
  );

  return (
    <View style={styles.container}>
      {/* All-day events section */}
      {allDayEvents.length > 0 && (
        <View style={styles.allDaySection}>
          <Text style={styles.allDayLabel}>All day</Text>
          {allDayEvents.map((event) => {
            const color = accountColorMap[event.calendarAccountId] || '#1A73E8';
            return (
              <TouchableOpacity
                key={event.id}
                style={[
                  styles.allDayEvent,
                  {
                    backgroundColor: getEventBackgroundColor(color),
                    borderLeftColor: color,
                  },
                ]}
                onPress={() => onEventPress?.(event)}
                accessibilityRole="button"
                accessibilityLabel={`All day event: ${event.title}`}
              >
                <Text style={[styles.allDayEventText, { color }]} numberOfLines={1}>
                  {accountIndexMap ? `${getCalendarPatternIcon(accountIndexMap[event.calendarAccountId] ?? 0)} ` : ''}{event.title}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {/* Hourly timeline */}
      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        <View style={styles.timeline}>
          {HOURS.map((hour) => (
            <View key={hour} style={styles.hourRow}>
              <View style={styles.hourLabelContainer}>
                <Text style={styles.hourLabel}>
                  {hour === 0 ? '12 AM' : hour < 12 ? `${hour} AM` : hour === 12 ? '12 PM' : `${hour - 12} PM`}
                </Text>
              </View>
              <View style={styles.hourSlot}>
                <View style={styles.hourLine} />
              </View>
            </View>
          ))}

          {/* Positioned timed events with overlap layout */}
          {timedEventLayouts.map(({ event, column, totalColumns }) => {
            const color = accountColorMap[event.calendarAccountId] || '#1A73E8';
            const startMinutes = event.startTime.getHours() * 60 + event.startTime.getMinutes();
            const endMinutes = event.endTime.getHours() * 60 + event.endTime.getMinutes();
            const duration = Math.max(endMinutes - startMinutes, 15);
            const top = (startMinutes / 60) * HOUR_HEIGHT;
            const height = (duration / 60) * HOUR_HEIGHT;

            // Calculate width and left offset based on column position
            const eventAreaLeft = 60; // matches styles.timedEvent left
            const eventAreaRight = 8;
            const widthFraction = 1 / totalColumns;
            const leftFraction = column / totalColumns;

            return (
              <TouchableOpacity
                key={event.id}
                style={[
                  styles.timedEvent,
                  {
                    top,
                    height: Math.max(height, 20),
                    left: eventAreaLeft + leftFraction * (100 - eventAreaLeft - eventAreaRight),
                    right: undefined,
                    width: `${widthFraction * 100 - 1}%` as any,
                    backgroundColor: getEventBackgroundColor(color),
                    borderLeftColor: color,
                    borderLeftWidth: 3,
                  },
                ]}
                onPress={() => onEventPress?.(event)}
                accessibilityRole="button"
                accessibilityLabel={`${event.title}, ${formatTime(event.startTime)} to ${formatTime(event.endTime)}`}
              >
                <Text style={[styles.eventTitle, { color }]} numberOfLines={1}>
                  {accountIndexMap ? `${getCalendarPatternIcon(accountIndexMap[event.calendarAccountId] ?? 0)} ` : ''}{event.title}
                </Text>
                {height > 30 && (
                  <Text style={styles.eventTime} numberOfLines={1}>
                    {formatTime(event.startTime)} – {formatTime(event.endTime)}
                  </Text>
                )}
              </TouchableOpacity>
            );
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
  allDaySection: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E0E0E0',
    backgroundColor: '#FAFAFA',
  },
  allDayLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#5F6368',
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  allDayEvent: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 4,
    borderLeftWidth: 3,
    marginBottom: 4,
  },
  allDayEventText: {
    fontSize: 13,
    fontWeight: '500',
  },
  scrollView: {
    flex: 1,
  },
  timeline: {
    position: 'relative',
    paddingBottom: 20,
  },
  hourRow: {
    flexDirection: 'row',
    height: HOUR_HEIGHT,
  },
  hourLabelContainer: {
    width: 56,
    alignItems: 'flex-end',
    paddingRight: 8,
    paddingTop: 0,
  },
  hourLabel: {
    fontSize: 11,
    color: '#80868B',
    marginTop: -6,
  },
  hourSlot: {
    flex: 1,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E8EAED',
  },
  hourLine: {
    height: StyleSheet.hairlineWidth,
  },
  timedEvent: {
    position: 'absolute',
    left: 60,
    right: 8,
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    overflow: 'hidden',
  },
  eventTitle: {
    fontSize: 13,
    fontWeight: '600',
  },
  eventTime: {
    fontSize: 11,
    color: '#5F6368',
    marginTop: 2,
  },
});
