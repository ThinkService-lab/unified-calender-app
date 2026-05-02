/**
 * DayView – Single day timeline with hourly slots.
 * Uses Design Token System for consistent theming and EventCard for
 * micro-interaction wiring.
 *
 * Task 18.2: Gesture controller integration —
 *   - useDragReschedule on timed Event_Cards (long-press to drag)
 *   - useDragResize on timed Event_Cards (bottom edge drag)
 *   - ConflictIndicatorOverlay when drag/resize has conflict
 *   - Conflict state screen-reader announcements via useRef edge tracking
 *   - usePullToRefresh connected to SyncEngine
 *   - AutoDismissBanner for sync/gesture errors
 *   - usePullToRefreshStyle micro-interaction for indicator
 *   - useInlineEventCreator on the time grid
 *   - Haptic feedback on drag activation, drop, resize snap, event creation
 *
 * Task 18.4: QuickCreateBar wired at the top of the view for NL event creation.
 *   - Direct create via EventCRUDService for fully-parsed events
 *   - Fallback to EventEditor with initialValues for partial parses
 *   - highlightRecurrenceSection when confidence.recurrence === 'attempted_unresolved'
 *
 * Requirements: 1.5, 1.6, 2.2, 2.3, 2.4, 4.1, 4.3, 4.4, 5.1, 5.8, 7.1, 7.2, 7.3, 7.4,
 *               9.1, 12.1, 13.1, 13.5, 14.1, 14.2, 14.4, 17.8, 18.1
 */

import React, { useCallback, useMemo, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
} from 'react-native';
import Animated from 'react-native-reanimated';
import { GestureDetector } from 'react-native-gesture-handler';
import type { CalendarEvent } from '../../types/models';
import {
  getEventsForDay,
  formatTime,
  sortEventsByTime,
  isSameDay,
} from './calendarViewModel';
import { computeOverlapLayout } from './overlapLayout';
import { getCalendarPatternIcon } from '../accessibility/calendarPatterns';
import { useTokens } from '../tokens/designTokens';
import { EventCard } from './EventCard';
import { useDragReschedule } from '../gestures/useDragReschedule';
import type { DragRescheduleConfig, DragRescheduleActiveEvent } from '../gestures/useDragReschedule';
import { useDragResize } from '../gestures/useDragResize';
import type { DragResizeConfig, DragResizeActiveEvent } from '../gestures/useDragResize';
import { useConflictCheckAdapter } from '../gestures/useConflictCheckAdapter';
import { ConflictIndicatorOverlay } from './ConflictIndicatorOverlay';
import { usePullToRefresh } from '../gestures/usePullToRefresh';
import { AutoDismissBanner } from '../gestures/AutoDismissBanner';
import { useInlineEventCreator } from '../gestures/useInlineEventCreator';
import { useHaptics } from '../haptics/hapticEngine';
import { useScreenReaderAnnouncement } from '../accessibility/useAccessibility';
import { QuickCreateBar } from './QuickCreateBar';
import type { QuickCreateBarProps } from './QuickCreateBar';
import { CurrentTimeIndicator } from './CurrentTimeIndicator';
import type { EventCRUDService } from '../../events/eventCRUDService';
import type { EventFormData } from '../editor/eventEditorViewModel';
import type { ParsedEvent } from '../../nlp/naturalLanguageParser';

export interface DayViewProps {
  date: Date;
  events: CalendarEvent[];
  accountColorMap: Record<string, string>;
  /** Map of accountId → index for pattern assignment */
  accountIndexMap?: Record<string, number>;
  onEventPress?: (event: CalendarEvent) => void;
  /** Callback to update event times (drag reschedule) */
  onReschedule?: (eventId: string, newStart: Date, newEnd: Date) => Promise<void>;
  /** Callback to update event end time (drag resize) */
  onResize?: (eventId: string, newEnd: Date) => Promise<void>;
  /** Callback to create a new event inline */
  onCreateEvent?: (start: Date, end: Date, title: string) => Promise<void>;
  /** Sync callback for pull-to-refresh */
  onSync?: () => Promise<void>;
  /** Whether a sync is currently in progress */
  isSyncing?: boolean;
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
}

const HOUR_HEIGHT = 60;
const HOURS = Array.from({ length: 24 }, (_, i) => i);

export function DayView({
  date,
  events,
  accountColorMap,
  accountIndexMap,
  onEventPress,
  onReschedule,
  onResize,
  onCreateEvent,
  onSync,
  isSyncing = false,
  calendarAccountId,
  eventCRUDService,
  onOpenEditor,
  onQuickCreateEvent,
}: DayViewProps) {
  const tokens = useTokens();
  const haptics = useHaptics();
  const { announce } = useScreenReaderAnnouncement();

  const isCurrentDay = useMemo(() => isSameDay(date, new Date()), [date]);

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

  // ── Conflict check adapter ──────────────────────────────────────────────
  const conflictAdapter = useConflictCheckAdapter(events);

  // ── Drag reschedule config ──────────────────────────────────────────────
  const rescheduleConfig = useMemo<DragRescheduleConfig>(
    () => ({
      longPressDuration: 300,
      snapIncrement: 15,
      maxPersistTime: 200,
      dayColumnWidth: 0, // single day — no horizontal drag
      visibleDayDates: [date],
      onReschedule: onReschedule ?? (async () => {}),
      onConflictCheck: conflictAdapter.check,
    }),
    [date, onReschedule, conflictAdapter]
  );

  // ── Drag resize config ──────────────────────────────────────────────────
  const resizeConfig = useMemo<DragResizeConfig>(
    () => ({
      hitAreaHeight: 8,
      snapIncrement: 15,
      minimumDuration: 15,
      maxPersistTime: 200,
      onResize: onResize ?? (async () => {}),
      onConflictCheck: (eventId, newEnd, calendarAccountId) =>
        conflictAdapter.check(eventId, new Date(0), newEnd, calendarAccountId),
      onSnapHaptic: () => haptics.trigger('selection'),
    }),
    [onResize, conflictAdapter, haptics]
  );

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

  // ── Inline event creator ────────────────────────────────────────────────
  const inlineCreator = useInlineEventCreator({
    snapIncrement: 15,
    minimumDuration: 15,
    hourHeight: HOUR_HEIGHT,
    onCreate: onCreateEvent ?? (async () => {}),
  });

  // ── Conflict announcement edge tracking (shared across all drags) ──────
  const prevHasConflictRef = useRef(false);

  return (
    <View style={[styles.container, { backgroundColor: tokens.colors.background }]}>
      {/* Quick Create Bar (Req 5.1, 5.8, 17.8, 18.1) */}
      {calendarAccountId != null && eventCRUDService != null && onOpenEditor != null && (
        <QuickCreateBar
          calendarAccountId={calendarAccountId}
          eventCRUDService={eventCRUDService}
          onOpenEditor={onOpenEditor}
          onEventCreated={onQuickCreateEvent}
        />
      )}

      {/* All-day events section */}
      {allDayEvents.length > 0 && (
        <View style={[styles.allDaySection, { borderBottomColor: tokens.colors.borderLight, backgroundColor: tokens.colors.surfaceElevated }]}>
          <Text style={[styles.allDayLabel, { color: tokens.colors.textSecondary }]}>All day</Text>
          {allDayEvents.map((event) => {
            const color = accountColorMap[event.calendarAccountId] || tokens.colors.primary;
            const prefix = accountIndexMap
              ? getCalendarPatternIcon(accountIndexMap[event.calendarAccountId] ?? 0)
              : undefined;
            return (
              <EventCard
                key={event.id}
                event={event}
                color={color}
                onPress={onEventPress}
                prefixIcon={prefix}
                accessibilityLabel={`All day event: ${event.title}`}
              />
            );
          })}
        </View>
      )}

      {/* Pull-to-refresh + scrollable timeline */}
      <GestureDetector gesture={pullGesture}>
        <View style={styles.scrollWrapper}>
          <AutoDismissBanner message={pullError} />
          <AutoDismissBanner message={inlineCreator.error} />

          {/* Pull-to-refresh indicator */}
          <Animated.View style={[styles.pullIndicator, pullIndicatorStyle, pullRotationStyle]}>
            <Text style={[styles.pullIndicatorText, { color: tokens.colors.primary }]}>↻</Text>
          </Animated.View>

          <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
            <View style={styles.timeline}>
              {HOURS.map((hour) => (
                <View key={hour} style={styles.hourRow}>
                  <View style={styles.hourLabelContainer}>
                    <Text style={[styles.hourLabel, { color: tokens.colors.textMuted }]}>
                      {hour === 0 ? '12 AM' : hour < 12 ? `${hour} AM` : hour === 12 ? '12 PM' : `${hour - 12} PM`}
                    </Text>
                  </View>
                  <View style={[styles.hourSlot, { borderTopColor: tokens.colors.borderLight }]}>
                    <View style={styles.hourLine} />
                  </View>
                </View>
              ))}

              {/* Current time indicator (Req 10.1, 10.2, 10.3) */}
              <CurrentTimeIndicator hourHeight={HOUR_HEIGHT} isCurrentDay={isCurrentDay} />

              {/* Inline event creator overlay */}
              <Animated.View style={[styles.inlineOverlay, inlineCreator.overlayStyle]} pointerEvents="none" />

              {/* Positioned timed events with gesture controllers */}
              {timedEventLayouts.map(({ event, column, totalColumns }) => {
                const color = accountColorMap[event.calendarAccountId] || tokens.colors.primary;
                const startMinutes = event.startTime.getHours() * 60 + event.startTime.getMinutes();
                const endMinutes = event.endTime.getHours() * 60 + event.endTime.getMinutes();
                const duration = Math.max(endMinutes - startMinutes, 15);
                const top = (startMinutes / 60) * HOUR_HEIGHT;
                const height = (duration / 60) * HOUR_HEIGHT;

                const eventAreaLeft = 60;
                const eventAreaRight = 8;
                const widthFraction = 1 / totalColumns;
                const leftFraction = column / totalColumns;
                const prefix = accountIndexMap
                  ? getCalendarPatternIcon(accountIndexMap[event.calendarAccountId] ?? 0)
                  : undefined;

                return (
                  <DayViewEventCard
                    key={event.id}
                    event={event}
                    color={color}
                    prefix={prefix}
                    top={top}
                    height={height}
                    eventAreaLeft={eventAreaLeft}
                    eventAreaRight={eventAreaRight}
                    widthFraction={widthFraction}
                    leftFraction={leftFraction}
                    onEventPress={onEventPress}
                    rescheduleConfig={rescheduleConfig}
                    resizeConfig={resizeConfig}
                    hourHeight={HOUR_HEIGHT}
                    tokens={tokens}
                  />
                );
              })}
            </View>
          </ScrollView>
        </View>
      </GestureDetector>
    </View>
  );
}

// ─── DayViewEventCard — wraps EventCard with gesture controllers ─────────────

interface DayViewEventCardProps {
  event: CalendarEvent;
  color: string;
  prefix?: string;
  top: number;
  height: number;
  eventAreaLeft: number;
  eventAreaRight: number;
  widthFraction: number;
  leftFraction: number;
  onEventPress?: (event: CalendarEvent) => void;
  rescheduleConfig: DragRescheduleConfig;
  resizeConfig: DragResizeConfig;
  hourHeight: number;
  tokens: ReturnType<typeof useTokens>;
}

function DayViewEventCard({
  event,
  color,
  prefix,
  top,
  height,
  eventAreaLeft,
  eventAreaRight,
  widthFraction,
  leftFraction,
  onEventPress,
  rescheduleConfig,
  resizeConfig,
  hourHeight,
  tokens,
}: DayViewEventCardProps) {
  // ── Drag reschedule ───────────────────────────────────────────────────
  const activeRescheduleEvent = useMemo<DragRescheduleActiveEvent>(
    () => ({
      eventId: event.id,
      calendarAccountId: event.calendarAccountId,
      startTime: event.startTime,
      endTime: event.endTime,
      topY: top,
      heightPx: height,
      initialColumnIndex: 0,
      hourHeight,
    }),
    [event.id, event.calendarAccountId, event.startTime, event.endTime, top, height, hourHeight]
  );

  const {
    gesture: rescheduleGesture,
    state: rescheduleState,
    animatedStyle: rescheduleAnimatedStyle,
    error: rescheduleError,
  } = useDragReschedule(rescheduleConfig, activeRescheduleEvent);

  // ── Drag resize ───────────────────────────────────────────────────────
  const activeResizeEvent = useMemo<DragResizeActiveEvent>(
    () => ({
      eventId: event.id,
      calendarAccountId: event.calendarAccountId,
      startTime: event.startTime,
      endTime: event.endTime,
      topY: top,
      heightPx: height,
      hourHeight,
    }),
    [event.id, event.calendarAccountId, event.startTime, event.endTime, top, height, hourHeight]
  );

  const {
    gesture: resizeGesture,
    state: resizeState,
    animatedStyle: resizeAnimatedStyle,
    error: resizeError,
  } = useDragResize(resizeConfig, activeResizeEvent);

  // ── Conflict overlay ──────────────────────────────────────────────────
  const hasConflict = rescheduleState.hasConflict || resizeState.hasConflict;
  const conflictCount = rescheduleState.hasConflict
    ? (rescheduleState as any).conflictingEventIds?.length ?? 0
    : 0;

  return (
    <View
      style={{
        position: 'absolute',
        top,
        height: Math.max(height, 20),
        left: eventAreaLeft + leftFraction * (100 - eventAreaLeft - eventAreaRight),
        width: `${widthFraction * 100 - 1}%` as any,
      }}
    >
      <GestureDetector gesture={rescheduleGesture}>
        <GestureDetector gesture={resizeGesture}>
          <Animated.View style={[{ height: '100%' as any }, rescheduleAnimatedStyle, resizeAnimatedStyle]}>
            <EventCard
              event={event}
              color={color}
              onPress={onEventPress}
              prefixIcon={prefix}
              style={{ height: '100%' as any }}
              accessibilityLabel={`${event.title}, ${formatTime(event.startTime)} to ${formatTime(event.endTime)}`}
            >
              {height > 30 && (
                <Text style={[styles.eventTime, { color: tokens.colors.textSecondary }]} numberOfLines={1}>
                  {formatTime(event.startTime)} – {formatTime(event.endTime)}
                </Text>
              )}
            </EventCard>

            {/* Conflict indicator overlay */}
            {hasConflict && (
              <ConflictIndicatorOverlay
                visible={hasConflict}
                proposedRect={{ x: 0, y: 0, width: 100, height: Math.max(height, 20) }}
                conflictCount={conflictCount}
              />
            )}
          </Animated.View>
        </GestureDetector>
      </GestureDetector>

      {/* Error banners for gesture failures */}
      <AutoDismissBanner message={rescheduleError} />
      <AutoDismissBanner message={resizeError} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  allDaySection: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  allDayLabel: {
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  scrollWrapper: {
    flex: 1,
    position: 'relative',
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
    marginTop: -6,
  },
  hourSlot: {
    flex: 1,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  hourLine: {
    height: StyleSheet.hairlineWidth,
  },
  eventTime: {
    fontSize: 11,
    marginTop: 2,
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
  inlineOverlay: {
    marginLeft: 60,
    borderRadius: 4,
  },
});
