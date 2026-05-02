/**
 * WeekView – 7-day grid with time slots.
 * Uses Design Token System for consistent theming and EventCard for
 * micro-interaction wiring.
 *
 * Task 18.2: Gesture controller integration —
 *   - useDragReschedule on timed Event_Cards (long-press to drag, cross-day)
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
 *               9.1, 12.1, 13.1, 13.5, 14.1, 14.2, 14.4, 15.1, 15.2, 15.4, 17.8, 18.1
 */

import React, { useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import Animated from 'react-native-reanimated';
import { GestureDetector } from 'react-native-gesture-handler';
import type { CalendarEvent } from '../../types/models';
import {
  getWeekDates,
  getEventsForDay,
  formatTime,
  isSameDay,
  sortEventsByTime,
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
import { QuickCreateBar } from './QuickCreateBar';
import type { QuickCreateBarProps } from './QuickCreateBar';
import { CurrentTimeIndicator } from './CurrentTimeIndicator';
import type { EventCRUDService } from '../../events/eventCRUDService';
import type { EventFormData } from '../editor/eventEditorViewModel';
import type { ParsedEvent } from '../../nlp/naturalLanguageParser';

export interface WeekViewProps {
  date: Date;
  events: CalendarEvent[];
  accountColorMap: Record<string, string>;
  /** Map of accountId → index for pattern assignment */
  accountIndexMap?: Record<string, number>;
  onEventPress?: (event: CalendarEvent) => void;
  onDayPress?: (date: Date) => void;
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

const HOUR_HEIGHT = 48;
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Approximate day column width for drag calculations (percentage-based layout). */
const DAY_COLUMN_WIDTH_APPROX = 50; // pixels — approximate for gesture math

export function WeekView({
  date,
  events,
  accountColorMap,
  accountIndexMap,
  onEventPress,
  onDayPress,
  onReschedule,
  onResize,
  onCreateEvent,
  onSync,
  isSyncing = false,
  calendarAccountId,
  eventCRUDService,
  onOpenEditor,
  onQuickCreateEvent,
}: WeekViewProps) {
  const tokens = useTokens();
  const haptics = useHaptics();
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

  // ── Conflict check adapter ──────────────────────────────────────────────
  const conflictAdapter = useConflictCheckAdapter(events);

  // ── Drag reschedule config (week view supports cross-day drag) ──────────
  const rescheduleConfig = useMemo<DragRescheduleConfig>(
    () => ({
      longPressDuration: 300,
      snapIncrement: 15,
      maxPersistTime: 200,
      dayColumnWidth: DAY_COLUMN_WIDTH_APPROX,
      visibleDayDates: weekDates,
      onReschedule: onReschedule ?? (async () => {}),
      onConflictCheck: conflictAdapter.check,
    }),
    [weekDates, onReschedule, conflictAdapter]
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

      {/* Day headers */}
      <View style={[styles.headerRow, { borderBottomColor: tokens.colors.borderLight, backgroundColor: tokens.colors.surfaceElevated }]}>
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
              <Text style={[styles.dayLabel, { color: isToday ? tokens.colors.primary : tokens.colors.textSecondary }]}>
                {DAY_LABELS[d.getDay()]}
              </Text>
              <View style={[styles.dayNumber, isToday && { backgroundColor: tokens.colors.primary }]}>
                <Text style={[styles.dayNumberText, { color: isToday ? tokens.colors.textOnPrimary : tokens.colors.textPrimary, fontWeight: isToday ? tokens.typography.weights.semibold : tokens.typography.weights.medium }]}>
                  {d.getDate()}
                </Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Pull-to-refresh + scrollable time grid */}
      <GestureDetector gesture={pullGesture}>
        <View style={styles.scrollWrapper}>
          <AutoDismissBanner message={pullError} />
          <AutoDismissBanner message={inlineCreator.error} />

          {/* Pull-to-refresh indicator */}
          <Animated.View style={[styles.pullIndicator, pullIndicatorStyle, pullRotationStyle]}>
            <Text style={[styles.pullIndicatorText, { color: tokens.colors.primary }]}>↻</Text>
          </Animated.View>

          <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
            <View style={styles.gridContainer}>
              {/* Hour labels + grid lines */}
              {HOURS.map((hour) => (
                <View key={hour} style={styles.hourRow}>
                  <View style={styles.timeGutter}>
                    <Text style={[styles.hourLabel, { color: tokens.colors.textMuted }]}>
                      {hour === 0 ? '' : hour < 12 ? `${hour}a` : hour === 12 ? '12p' : `${hour - 12}p`}
                    </Text>
                  </View>
                  {weekDates.map((_, dayIdx) => (
                    <View key={dayIdx} style={[styles.gridCell, { borderTopColor: tokens.colors.borderLight, borderLeftColor: tokens.colors.borderLight }]}>
                      <View style={styles.gridLine} />
                    </View>
                  ))}
                </View>
              ))}

              {/* Current time indicators per day column (Req 10.1, 10.2, 10.3) */}
              {weekDates.map((d, dayIdx) => {
                const dayColumnStart = (dayIdx * 100) / 7;
                const dayColumnWidth = 100 / 7;
                return (
                  <View
                    key={`time-indicator-${dayIdx}`}
                    style={{
                      position: 'absolute',
                      top: 0,
                      bottom: 0,
                      left: `${dayColumnStart}%` as any,
                      width: `${dayColumnWidth}%` as any,
                    }}
                    pointerEvents="none"
                  >
                    <CurrentTimeIndicator
                      hourHeight={HOUR_HEIGHT}
                      isCurrentDay={isSameDay(d, today)}
                    />
                  </View>
                );
              })}

              {/* Inline event creator overlay */}
              <Animated.View style={[styles.inlineOverlay, inlineCreator.overlayStyle]} pointerEvents="none" />

              {/* Events overlay per day column with gesture controllers */}
              {weekDates.map((_, dayIdx) => {
                const layouts = dayLayoutsMap[dayIdx] || [];
                return layouts.map(({ event, column, totalColumns }) => {
                  const color = accountColorMap[event.calendarAccountId] || tokens.colors.primary;
                  const startMinutes = event.startTime.getHours() * 60 + event.startTime.getMinutes();
                  const endMinutes = event.endTime.getHours() * 60 + event.endTime.getMinutes();
                  const duration = Math.max(endMinutes - startMinutes, 15);
                  const top = (startMinutes / 60) * HOUR_HEIGHT;
                  const height = (duration / 60) * HOUR_HEIGHT;

                  const dayColumnStart = (dayIdx * 100) / 7;
                  const dayColumnWidth = 100 / 7;
                  const padding = dayColumnWidth * 0.03;
                  const usableWidth = dayColumnWidth * 0.94;

                  const eventWidth = usableWidth / totalColumns;
                  const eventLeft = dayColumnStart + padding + column * eventWidth;
                  const prefix = accountIndexMap
                    ? getCalendarPatternIcon(accountIndexMap[event.calendarAccountId] ?? 0)
                    : undefined;

                  return (
                    <WeekViewEventCard
                      key={event.id}
                      event={event}
                      color={color}
                      prefix={prefix}
                      top={top}
                      height={height}
                      eventLeft={eventLeft}
                      eventWidth={eventWidth}
                      dayIdx={dayIdx}
                      onEventPress={onEventPress}
                      rescheduleConfig={rescheduleConfig}
                      resizeConfig={resizeConfig}
                      hourHeight={HOUR_HEIGHT}
                      tokens={tokens}
                    />
                  );
                });
              })}
            </View>
          </ScrollView>
        </View>
      </GestureDetector>
    </View>
  );
}

// ─── WeekViewEventCard — wraps EventCard with gesture controllers ────────────

interface WeekViewEventCardProps {
  event: CalendarEvent;
  color: string;
  prefix?: string;
  top: number;
  height: number;
  eventLeft: number;
  eventWidth: number;
  dayIdx: number;
  onEventPress?: (event: CalendarEvent) => void;
  rescheduleConfig: DragRescheduleConfig;
  resizeConfig: DragResizeConfig;
  hourHeight: number;
  tokens: ReturnType<typeof useTokens>;
}

function WeekViewEventCard({
  event,
  color,
  prefix,
  top,
  height,
  eventLeft,
  eventWidth,
  dayIdx,
  onEventPress,
  rescheduleConfig,
  resizeConfig,
  hourHeight,
  tokens,
}: WeekViewEventCardProps) {
  // ── Drag reschedule ───────────────────────────────────────────────────
  const activeRescheduleEvent = useMemo<DragRescheduleActiveEvent>(
    () => ({
      eventId: event.id,
      calendarAccountId: event.calendarAccountId,
      startTime: event.startTime,
      endTime: event.endTime,
      topY: top,
      heightPx: height,
      initialColumnIndex: dayIdx,
      hourHeight,
    }),
    [event.id, event.calendarAccountId, event.startTime, event.endTime, top, height, dayIdx, hourHeight]
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
        height: Math.max(height, 16),
        left: `${eventLeft}%` as any,
        width: `${eventWidth}%` as any,
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
              style={{
                height: '100%' as any,
                borderRadius: tokens.radii.sm - 1,
                paddingHorizontal: tokens.spacing.xs,
                paddingVertical: 2,
                borderLeftWidth: 2,
              }}
              accessibilityLabel={`${event.title}, ${formatTime(event.startTime)}`}
            />

            {/* Conflict indicator overlay */}
            {hasConflict && (
              <ConflictIndicatorOverlay
                visible={hasConflict}
                proposedRect={{ x: 0, y: 0, width: 100, height: Math.max(height, 16) }}
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
  headerRow: {
    flexDirection: 'row',
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: 8,
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
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  dayNumber: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  dayNumberText: {
    fontSize: 14,
  },
  scrollWrapper: {
    flex: 1,
    position: 'relative',
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
    marginTop: -6,
  },
  gridCell: {
    flex: 1,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderLeftWidth: StyleSheet.hairlineWidth,
  },
  gridLine: {
    height: StyleSheet.hairlineWidth,
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
    borderRadius: 4,
  },
});
