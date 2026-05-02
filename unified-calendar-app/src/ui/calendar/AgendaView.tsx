/**
 * AgendaView – Scrollable list of upcoming events using FlatList with getItemLayout.
 * Uses Design Token System for consistent theming and EventCard for
 * micro-interaction wiring.
 *
 * Task 18.4: QuickCreateBar wired at the top of the view for NL event creation.
 *   - Direct create via EventCRUDService for fully-parsed events
 *   - Fallback to EventEditor with initialValues for partial parses
 *   - highlightRecurrenceSection when confidence.recurrence === 'attempted_unresolved'
 *
 * Task 18.11: Pull-to-refresh integration (Req 9.1, 9.2, 9.3, 9.4, 9.5).
 *   - usePullToRefresh connected to SyncEngine via onSync callback
 *   - Rotating sync indicator via usePullToRefreshStyle micro-interaction
 *   - AutoDismissBanner for sync failure display
 *
 * Task 18.12: EmptyStateView replaces inline empty state (Req 16.1–16.7).
 *
 * Requirements: 1.5, 1.6, 2.2, 2.3, 2.6, 5.1, 5.8, 7.1, 7.2, 7.3, 7.4,
 *               9.1, 9.2, 9.3, 9.4, 9.5, 16.1, 16.2, 16.3, 16.6, 16.7, 17.8, 18.1
 */

import React, { useMemo, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
} from 'react-native';
import Animated from 'react-native-reanimated';
import { GestureDetector } from 'react-native-gesture-handler';
import type { CalendarEvent } from '../../types/models';
import {
  groupEventsByDay,
  formatTime,
  sortEventsByTime,
  type AgendaGroup,
} from './calendarViewModel';
import { getCalendarPatternIcon } from '../accessibility/calendarPatterns';
import { useTokens, type DesignTokens } from '../tokens/designTokens';
import { EventCard } from './EventCard';
import { EmptyStateView } from './EmptyStateView';
import { QuickCreateBar } from './QuickCreateBar';
import type { QuickCreateBarProps } from './QuickCreateBar';
import { usePullToRefresh } from '../gestures/usePullToRefresh';
import { AutoDismissBanner } from '../gestures/AutoDismissBanner';
import type { EventCRUDService } from '../../events/eventCRUDService';
import type { EventFormData } from '../editor/eventEditorViewModel';
import type { ParsedEvent } from '../../nlp/naturalLanguageParser';

export interface AgendaViewProps {
  events: CalendarEvent[];
  accountColorMap: Record<string, string>;
  /** Map of accountId → index for pattern assignment */
  accountIndexMap?: Record<string, number>;
  onEventPress?: (event: CalendarEvent) => void;
  /** Calendar account ID for Quick Create Bar event creation */
  calendarAccountId?: string;
  /** EventCRUDService instance for Quick Create Bar */
  eventCRUDService?: EventCRUDService;
  /** Called when Quick Create Bar falls back to the EventEditor */
  onOpenEditor?: (options: {
    initialValues: Partial<EventFormData>;
    highlightRecurrenceSection: boolean;
  }) => void;
  /** Called after Quick Create Bar successfully creates an event */
  onQuickCreateEvent?: (parsedEvent: ParsedEvent) => void;
  /** Sync callback for pull-to-refresh (Req 9.1) */
  onSync?: () => Promise<void>;
  /** Whether a sync is currently in progress */
  isSyncing?: boolean;
  /** Called when the empty state "Create an event" CTA is tapped (Req 16.3) */
  onCreateEvent?: () => void;
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

export function AgendaView({
  events,
  accountColorMap,
  accountIndexMap,
  onEventPress,
  calendarAccountId,
  eventCRUDService,
  onOpenEditor,
  onQuickCreateEvent,
  onSync,
  isSyncing = false,
  onCreateEvent,
}: AgendaViewProps) {
  const tokens = useTokens();
  const sortedEvents = useMemo(() => sortEventsByTime(events), [events]);
  const groups = useMemo(() => groupEventsByDay(sortedEvents), [sortedEvents]);
  const flatItems = useMemo(() => flattenAgendaGroups(groups), [groups]);

  // ── Pull-to-refresh (Req 9.1, 9.2, 9.3, 9.4, 9.5) ─────────────────────
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

  // ── Empty state CTA handler ──────────────────────────────────────────────
  const handleEmptyStateCreate = useCallback(() => {
    onCreateEvent?.();
  }, [onCreateEvent]);

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
          <View style={[styles.dayHeader, { backgroundColor: tokens.colors.surfaceElevated }]} accessibilityRole="header">
            <Text style={[styles.dayHeaderText, { color: tokens.colors.textPrimary }]}>{item.dateLabel}</Text>
          </View>
        );
      }

      const event = item.event!;
      const color = accountColorMap[event.calendarAccountId] || tokens.colors.primary;
      const prefix = accountIndexMap
        ? getCalendarPatternIcon(accountIndexMap[event.calendarAccountId] ?? 0)
        : undefined;

      return (
        <View style={styles.eventCardWrapper}>
          <EventCard
            event={event}
            color={color}
            onPress={onEventPress}
            prefixIcon={prefix}
            style={{
              height: EVENT_ITEM_HEIGHT,
              flexDirection: 'row',
              alignItems: 'center',
              marginHorizontal: tokens.spacing.md,
              borderRadius: tokens.radii.md,
              borderLeftWidth: 4,
              paddingHorizontal: tokens.spacing.md,
              paddingVertical: tokens.spacing.sm + 2,
            }}
            accessibilityLabel={`${event.title}, ${formatTime(event.startTime)} to ${formatTime(event.endTime)}`}
          >
            <View style={styles.eventContent}>
              <View style={styles.eventTimeColumn}>
                <Text style={[styles.eventTimeText, { color }]}>
                  {event.isAllDay ? 'All day' : formatTime(event.startTime)}
                </Text>
                {!event.isAllDay && (
                  <Text style={[styles.eventEndTime, { color: tokens.colors.textMuted }]}>
                    {formatTime(event.endTime)}
                  </Text>
                )}
              </View>
              <View style={styles.eventDetails}>
                {event.location && (
                  <Text style={[styles.eventLocation, { color: tokens.colors.textSecondary }]} numberOfLines={1}>
                    📍 {event.location}
                  </Text>
                )}
              </View>
            </View>
          </EventCard>
        </View>
      );
    },
    [accountColorMap, accountIndexMap, onEventPress, tokens]
  );

  const keyExtractor = useCallback((item: AgendaItem) => item.key, []);

  // ── Empty state: use EmptyStateView component (Req 16.1, 16.2, 16.3) ────
  if (flatItems.length === 0) {
    return (
      <View style={[styles.emptyWrapper, { backgroundColor: tokens.colors.background }]}>
        {/* Quick Create Bar (Req 5.1, 5.8, 17.8, 18.1) */}
        {calendarAccountId != null && eventCRUDService != null && onOpenEditor != null && (
          <QuickCreateBar
            calendarAccountId={calendarAccountId}
            eventCRUDService={eventCRUDService}
            onOpenEditor={onOpenEditor}
            onEventCreated={onQuickCreateEvent}
          />
        )}
        <EmptyStateView
          context="agenda"
          onCreateEvent={handleEmptyStateCreate}
        />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: tokens.colors.surfaceElevated }}>
      {/* Quick Create Bar (Req 5.1, 5.8, 17.8, 18.1) */}
      {calendarAccountId != null && eventCRUDService != null && onOpenEditor != null && (
        <QuickCreateBar
          calendarAccountId={calendarAccountId}
          eventCRUDService={eventCRUDService}
          onOpenEditor={onOpenEditor}
          onEventCreated={onQuickCreateEvent}
        />
      )}

      {/* Pull-to-refresh gesture wrapper (Req 9.1) */}
      <GestureDetector gesture={pullGesture}>
        <View style={styles.scrollWrapper}>
          {/* Sync error banner (Req 9.4) */}
          <AutoDismissBanner message={pullError} />

          {/* Pull-to-refresh indicator (Req 9.2, 9.3) */}
          <Animated.View style={[styles.pullIndicator, pullIndicatorStyle, pullRotationStyle]}>
            <Text style={[styles.pullIndicatorText, { color: tokens.colors.primary }]}>↻</Text>
          </Animated.View>

          <FlatList
            data={flatItems}
            renderItem={renderItem}
            keyExtractor={keyExtractor}
            getItemLayout={getItemLayout}
            style={[styles.list, { backgroundColor: tokens.colors.surfaceElevated }]}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            ItemSeparatorComponent={Separator}
            initialNumToRender={20}
            maxToRenderPerBatch={15}
            windowSize={11}
          />
        </View>
      </GestureDetector>
    </View>
  );
}

function Separator() {
  return <View style={styles.separator} />;
}

const styles = StyleSheet.create({
  list: {
    flex: 1,
  },
  listContent: {
    paddingBottom: 20,
  },
  dayHeader: {
    height: DAY_HEADER_HEIGHT,
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  dayHeaderText: {
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  eventCardWrapper: {
    // Wrapper to let EventCard handle its own layout
  },
  eventContent: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
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
    marginTop: 2,
  },
  eventDetails: {
    flex: 1,
  },
  eventLocation: {
    fontSize: 12,
    marginTop: 4,
  },
  separator: {
    height: SEPARATOR_HEIGHT,
  },
  emptyWrapper: {
    flex: 1,
  },
  scrollWrapper: {
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
});
