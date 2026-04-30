/**
 * AgendaView – Scrollable list of upcoming events using FlatList with getItemLayout.
 * Requirements: 2.2, 2.3, 2.6
 */

import React, { useMemo, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import type { CalendarEvent } from '../../types/models';
import {
  groupEventsByDay,
  formatTime,
  sortEventsByTime,
  type AgendaGroup,
} from './calendarViewModel';
import { getEventBackgroundColor, getEventBorderColor } from './colorCoding';
import { getCalendarPatternIcon } from '../accessibility/calendarPatterns';

export interface AgendaViewProps {
  events: CalendarEvent[];
  accountColorMap: Record<string, string>;
  /** Map of accountId → index for pattern assignment */
  accountIndexMap?: Record<string, number>;
  onEventPress?: (event: CalendarEvent) => void;
}

/**
 * Fixed item heights for getItemLayout optimization.
 * Each agenda item is a day header + event cards.
 * We use a flat list of individual items (headers + events).
 */
const DAY_HEADER_HEIGHT = 44;
const EVENT_ITEM_HEIGHT = 72;
const SEPARATOR_HEIGHT = 1;

interface AgendaItem {
  type: 'header' | 'event';
  key: string;
  date?: Date;
  dateLabel?: string;
  event?: CalendarEvent;
}

function flattenAgendaGroups(groups: AgendaGroup[]): AgendaItem[] {
  const items: AgendaItem[] = [];
  for (const group of groups) {
    items.push({
      type: 'header',
      key: `header-${group.dateKey}`,
      date: group.date,
      dateLabel: formatAgendaDate(group.date),
    });
    for (const event of group.events) {
      items.push({
        type: 'event',
        key: `event-${event.id}`,
        event,
      });
    }
  }
  return items;
}

function formatAgendaDate(date: Date): string {
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  if (isSameDaySimple(date, today)) return 'Today';
  if (isSameDaySimple(date, tomorrow)) return 'Tomorrow';

  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${days[date.getDay()]}, ${months[date.getMonth()]} ${date.getDate()}`;
}

function isSameDaySimple(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function AgendaView({ events, accountColorMap, accountIndexMap, onEventPress }: AgendaViewProps) {
  const sortedEvents = useMemo(() => sortEventsByTime(events), [events]);
  const groups = useMemo(() => groupEventsByDay(sortedEvents), [sortedEvents]);
  const flatItems = useMemo(() => flattenAgendaGroups(groups), [groups]);

  const getItemLayout = useCallback(
    (_data: any, index: number) => {
      // Calculate offset by summing heights of all preceding items
      let offset = 0;
      for (let i = 0; i < index; i++) {
        offset += flatItems[i]?.type === 'header' ? DAY_HEADER_HEIGHT : EVENT_ITEM_HEIGHT;
        offset += SEPARATOR_HEIGHT;
      }
      const item = flatItems[index];
      const length = item?.type === 'header' ? DAY_HEADER_HEIGHT : EVENT_ITEM_HEIGHT;
      return { length, offset, index };
    },
    [flatItems]
  );

  const renderItem = useCallback(
    ({ item }: { item: AgendaItem }) => {
      if (item.type === 'header') {
        return (
          <View style={styles.dayHeader} accessibilityRole="header">
            <Text style={styles.dayHeaderText}>{item.dateLabel}</Text>
          </View>
        );
      }

      const event = item.event!;
      const color = accountColorMap[event.calendarAccountId] || '#1A73E8';

      return (
        <TouchableOpacity
          style={[
            styles.eventCard,
            {
              backgroundColor: getEventBackgroundColor(color),
              borderLeftColor: color,
            },
          ]}
          onPress={() => onEventPress?.(event)}
          accessibilityRole="button"
          accessibilityLabel={`${event.title}, ${formatTime(event.startTime)} to ${formatTime(event.endTime)}`}
          activeOpacity={0.7}
        >
          <View style={styles.eventTimeColumn}>
            <Text style={[styles.eventTimeText, { color }]}>
              {event.isAllDay ? 'All day' : formatTime(event.startTime)}
            </Text>
            {!event.isAllDay && (
              <Text style={styles.eventEndTime}>
                {formatTime(event.endTime)}
              </Text>
            )}
          </View>
          <View style={styles.eventDetails}>
            <Text style={styles.eventTitle} numberOfLines={1}>
              {accountIndexMap ? `${getCalendarPatternIcon(accountIndexMap[event.calendarAccountId] ?? 0)} ` : ''}{event.title}
            </Text>
            {event.location && (
              <Text style={styles.eventLocation} numberOfLines={1}>
                📍 {event.location}
              </Text>
            )}
          </View>
        </TouchableOpacity>
      );
    },
    [accountColorMap, onEventPress]
  );

  const keyExtractor = useCallback((item: AgendaItem) => item.key, []);

  if (flatItems.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>No upcoming events</Text>
        <Text style={styles.emptySubtext}>Your schedule is clear</Text>
      </View>
    );
  }

  return (
    <FlatList
      data={flatItems}
      renderItem={renderItem}
      keyExtractor={keyExtractor}
      getItemLayout={getItemLayout}
      style={styles.list}
      contentContainerStyle={styles.listContent}
      showsVerticalScrollIndicator={false}
      ItemSeparatorComponent={Separator}
      initialNumToRender={20}
      maxToRenderPerBatch={15}
      windowSize={11}
    />
  );
}

function Separator() {
  return <View style={styles.separator} />;
}

const styles = StyleSheet.create({
  list: {
    flex: 1,
    backgroundColor: '#FAFAFA',
  },
  listContent: {
    paddingBottom: 20,
  },
  dayHeader: {
    height: DAY_HEADER_HEIGHT,
    justifyContent: 'center',
    paddingHorizontal: 16,
    backgroundColor: '#FAFAFA',
  },
  dayHeaderText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#3C4043',
    letterSpacing: 0.2,
  },
  eventCard: {
    height: EVENT_ITEM_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 12,
    borderRadius: 8,
    borderLeftWidth: 4,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#FFFFFF',
  },
  eventTimeColumn: {
    width: 56,
    marginRight: 12,
  },
  eventTimeText: {
    fontSize: 13,
    fontWeight: '600',
  },
  eventEndTime: {
    fontSize: 11,
    color: '#80868B',
    marginTop: 2,
  },
  eventDetails: {
    flex: 1,
  },
  eventTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#202124',
  },
  eventLocation: {
    fontSize: 12,
    color: '#5F6368',
    marginTop: 4,
  },
  separator: {
    height: SEPARATOR_HEIGHT,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#3C4043',
  },
  emptySubtext: {
    fontSize: 14,
    color: '#80868B',
    marginTop: 8,
  },
});
