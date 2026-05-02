/**
 * UnifiedCalendarView – Main container that switches between display modes.
 * Color-codes events by calendar account, supports visibility toggling
 * with ≤ 200ms response time using optimistic local state.
 *
 * Task 18.2: SwipeNavigationHost wrapping for Day/Week/Month views,
 * pull-to-refresh and gesture prop forwarding.
 *
 * Task 18.3: AnimatedViewModeSwitcher replaces static ViewModeSwitcher,
 * ViewTransitionAnimator wraps view rendering for crossfade/slide
 * transitions, and zoom transition wires Month_View day tap → Day_View.
 *
 * Task 18.6: CalendarSidebar wired into ResponsiveLayout for tablet/desktop
 * breakpoints. Mini month navigator → anchor date, account toggles →
 * hiddenAccountIds, upcoming events → event store.
 *
 * Task 18.7: StableMonthView replaces MonthView for debounced navigation
 * (Req 6.1, 6.4). EmptyStateView renders when Day/Week/Agenda views have
 * zero visible events (Req 16.1) or when no accounts are connected (Req 16.4).
 *
 * Requirements: 1.5, 2.1, 2.2, 2.3, 2.4, 2.6, 3.1, 3.3, 6.1, 6.4, 8.1, 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 15.1, 15.2, 15.4, 16.1, 16.4, 19.1, 19.2, 19.4, 19.5, 19.6
 */

import React, { useState, useMemo, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import Animated from 'react-native-reanimated';
import type { CalendarEvent, CalendarAccount } from '../../types/models';
import type { DefaultViewMode } from '../types';
import { useBreakpoint } from '../useBreakpoint';
import { useTokens } from '../tokens/designTokens';
import { AnimatedViewModeSwitcher } from './AnimatedViewModeSwitcher';
import { ViewTransitionAnimator } from '../animation/ViewTransitionAnimator';
import { useZoomTransition } from '../animation/ViewTransitionAnimator';
import { DayView } from './DayView';
import { WeekView } from './WeekView';
import { StableMonthView } from './StableMonthView';
import { AgendaView } from './AgendaView';
import { EmptyStateView } from './EmptyStateView';
import type { EmptyStateContext } from './EmptyStateView';
import { SwipeNavigationHost } from '../gestures/SwipeNavigationHost';
import {
  filterVisibleEvents,
  filterEventsByTimeRange,
  getDateRangeForViewMode,
  formatMonthYear,
  formatShortDate,
  sortEventsByTime,
} from './calendarViewModel';
import { buildAccountColorMap } from './colorCoding';
import { buildViewChangeAnnouncement } from '../accessibility/accessibilityUtils';
import { useScreenReaderAnnouncement, useKeyboardNavigation, useReducedMotion } from '../accessibility/useAccessibility';
import { useKeyboardShortcuts } from '../keyboard/useKeyboardShortcuts';
import { ShortcutHelpOverlay } from '../keyboard/ShortcutHelpOverlay';
import { ResponsiveLayout } from '../ResponsiveLayout';
import { CalendarSidebar } from './CalendarSidebar';
import { getUpcomingEvents } from './calendarSidebarUtils';
import { useShortcutOverrides } from '../../stores/uiPreferencesStore';
import type { EventCRUDService } from '../../events/eventCRUDService';
import type { EventFormData } from '../editor/eventEditorViewModel';
import type { ParsedEvent } from '../../nlp/naturalLanguageParser';

export interface UnifiedCalendarViewProps {
  /** All events from all connected accounts */
  events: CalendarEvent[];
  /** All connected calendar accounts */
  accounts: CalendarAccount[];
  /** Optional initial view mode (defaults to breakpoint default) */
  initialViewMode?: DefaultViewMode;
  /** Optional initial date (defaults to today) */
  initialDate?: Date;
  /** Callback when an event is pressed */
  onEventPress?: (event: CalendarEvent) => void;
  /** Callback when a day is pressed (e.g., to switch to day view) */
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
  /** Callback to open/focus the Quick Create Bar (for keyboard shortcut 'C') */
  onOpenQuickCreate?: () => void;
  /** Callback when user taps "Connect Account" in the first-launch empty state (Req 16.4) */
  onConnectAccount?: () => void;
}

export function UnifiedCalendarView({
  events,
  accounts,
  initialViewMode,
  initialDate,
  onEventPress,
  onDayPress: externalDayPress,
  onReschedule,
  onResize,
  onCreateEvent,
  onSync,
  isSyncing = false,
  calendarAccountId,
  eventCRUDService,
  onOpenEditor,
  onQuickCreateEvent,
  onOpenQuickCreate,
  onConnectAccount,
}: UnifiedCalendarViewProps) {
  const layout = useBreakpoint();
  const { announce } = useScreenReaderAnnouncement();
  const prefersReducedMotion = useReducedMotion();

  // View mode state – defaults to breakpoint-appropriate mode
  const [viewMode, setViewMode] = useState<DefaultViewMode>(
    initialViewMode ?? layout.defaultViewMode
  );

  // Announce view mode changes to screen readers
  const handleViewModeChange = useCallback((newMode: DefaultViewMode) => {
    setViewMode(newMode);
  }, []);

  // Current anchor date for navigation
  const [anchorDate, setAnchorDate] = useState<Date>(initialDate ?? new Date());

  // Hidden account IDs – optimistic local state for ≤ 200ms toggle
  const [hiddenAccountIds, setHiddenAccountIds] = useState<Set<string>>(new Set());

  // Build account color map (memoized)
  const accountColorMap = useMemo(
    () => buildAccountColorMap(accounts),
    [accounts]
  );

  // Build account index map for pattern assignment (color-blind support)
  const accountIndexMap = useMemo(() => {
    const map: Record<string, number> = {};
    for (let i = 0; i < accounts.length; i++) {
      map[accounts[i].id] = i;
    }
    return map;
  }, [accounts]);

  // Filter visible events (optimistic – no async, ≤ 200ms)
  const visibleEvents = useMemo(
    () => filterVisibleEvents(events, hiddenAccountIds),
    [events, hiddenAccountIds]
  );

  // Filter events for current view's date range
  const dateRange = useMemo(
    () => getDateRangeForViewMode(viewMode, anchorDate),
    [viewMode, anchorDate]
  );

  const rangeEvents = useMemo(
    () => sortEventsByTime(filterEventsByTimeRange(visibleEvents, dateRange.start, dateRange.end)),
    [visibleEvents, dateRange]
  );

  // Upcoming events for the sidebar (next 10 events from now)
  const upcomingEvents = useMemo(
    () => getUpcomingEvents(visibleEvents, new Date()),
    [visibleEvents]
  );

  // ── Empty state detection (Req 16.1, 16.4) ───────────────────────────
  // Determine if we should show an empty state and which context to use.
  const emptyStateContext = useMemo((): EmptyStateContext | null => {
    // First-launch: no calendar accounts connected at all (Req 16.4)
    if (accounts.length === 0) {
      return 'no-accounts';
    }
    // Only show empty states for day, week, and agenda views (not month)
    if (viewMode === 'month') return null;
    // Check if there are zero visible events in the current range
    if (rangeEvents.length === 0) {
      switch (viewMode) {
        case 'day':
          return 'day';
        case 'week':
          return 'week';
        case 'agenda':
          return 'agenda';
        default:
          return null;
      }
    }
    return null;
  }, [accounts.length, viewMode, rangeEvents.length]);

  // Handler for the empty state "Create an event" CTA — opens Quick Create
  const handleEmptyStateCreate = useCallback(() => {
    onOpenQuickCreate?.();
  }, [onOpenQuickCreate]);

  // Toggle calendar visibility (instant – optimistic local state)
  const toggleAccountVisibility = useCallback((accountId: string) => {
    setHiddenAccountIds((prev) => {
      const next = new Set(prev);
      if (next.has(accountId)) {
        next.delete(accountId);
      } else {
        next.add(accountId);
      }
      return next;
    });
  }, []);

  // Sidebar date selection — updates anchor date from mini month navigator (Req 19.2)
  const handleSidebarDateSelect = useCallback((date: Date) => {
    setAnchorDate(date);
  }, []);

  // Sidebar event press — navigate to the event's day and forward to onEventPress (Req 19.6)
  const handleSidebarEventPress = useCallback((event: CalendarEvent) => {
    setAnchorDate(event.startTime);
    onEventPress?.(event);
  }, [onEventPress]);

  // Navigation handlers
  const navigateForward = useCallback(() => {
    setAnchorDate((prev) => {
      const next = new Date(prev);
      switch (viewMode) {
        case 'day':
          next.setDate(next.getDate() + 1);
          break;
        case 'week':
          next.setDate(next.getDate() + 7);
          break;
        case 'month':
          next.setMonth(next.getMonth() + 1);
          break;
        case 'agenda':
          next.setDate(next.getDate() + 7);
          break;
      }
      return next;
    });
  }, [viewMode]);

  const navigateBack = useCallback(() => {
    setAnchorDate((prev) => {
      const next = new Date(prev);
      switch (viewMode) {
        case 'day':
          next.setDate(next.getDate() - 1);
          break;
        case 'week':
          next.setDate(next.getDate() - 7);
          break;
        case 'month':
          next.setMonth(next.getMonth() - 1);
          break;
        case 'agenda':
          next.setDate(next.getDate() - 7);
          break;
      }
      return next;
    });
  }, [viewMode]);

  const goToToday = useCallback(() => {
    setAnchorDate(new Date());
  }, []);

  // ── Shortcut Help Overlay state (Req 11.5, 11.6) ─────────────────────
  const [shortcutHelpVisible, setShortcutHelpVisible] = useState(false);

  const toggleShortcutHelp = useCallback(() => {
    setShortcutHelpVisible((prev) => !prev);
  }, []);

  const dismissShortcutHelp = useCallback(() => {
    setShortcutHelpVisible(false);
  }, []);

  // ── Keyboard Shortcut Manager (Req 11.1–11.6, Task 18.10) ──────────────
  // Wire shortcutOverrides from UIPreferences store for future custom
  // shortcut support (currently unused but reserved).
  const shortcutOverrides = useShortcutOverrides();

  const shortcutManager = useKeyboardShortcuts({
    onOpenQuickCreate: onOpenQuickCreate ?? (() => {}),
    onNavigateToday: goToToday,
    onSwitchView: handleViewModeChange,
    onNavigateBack: navigateBack,
    onNavigateForward: navigateForward,
    onShowHelp: toggleShortcutHelp,
    onDismissHelp: dismissShortcutHelp,
    shortcutOverrides,
  });

  // ── Zoom transition: Month_View day tap → Day_View (Req 3.3) ──────────
  // Tracks the origin rect of the tapped day cell for the zoom animation.
  const zoomOriginRect = useRef({ x: 0, y: 0, width: 0, height: 0 });

  // Pending date to navigate to after zoom completes.
  const pendingZoomDate = useRef<Date | null>(null);

  const { animatedStyle: zoomAnimatedStyle, startTransition: startZoom } =
    useZoomTransition({
      originRect: zoomOriginRect.current,
      onComplete: () => {
        // After zoom animation completes, commit the view mode change.
        if (pendingZoomDate.current) {
          setAnchorDate(pendingZoomDate.current);
          setViewMode('day');
          pendingZoomDate.current = null;
        }
      },
    });

  // Whether a zoom transition is currently active.
  const [isZooming, setIsZooming] = useState(false);

  // Day press handler – switch to day view (with zoom from month view)
  const handleDayPress = useCallback(
    (date: Date) => {
      if (externalDayPress) {
        setAnchorDate(date);
        externalDayPress(date);
        return;
      }

      // When tapping a day in month view, trigger zoom transition (Req 3.3).
      if (viewMode === 'month') {
        pendingZoomDate.current = date;
        setIsZooming(true);
        startZoom();
        // The actual view mode switch happens in onComplete above.
        return;
      }

      setAnchorDate(date);
      setViewMode('day');
    },
    [externalDayPress, viewMode, startZoom]
  );

  // Reset zoom state when view mode changes (zoom completed or cancelled).
  React.useEffect(() => {
    if (viewMode === 'day' && isZooming) {
      setIsZooming(false);
    }
  }, [viewMode, isZooming]);

  // Keyboard navigation for web (arrow keys, page up/down)
  useKeyboardNavigation(
    {
      onPreviousDay: () => {
        setAnchorDate((prev) => {
          const d = new Date(prev);
          d.setDate(d.getDate() - 1);
          return d;
        });
      },
      onNextDay: () => {
        setAnchorDate((prev) => {
          const d = new Date(prev);
          d.setDate(d.getDate() + 1);
          return d;
        });
      },
      onPreviousWeek: () => {
        setAnchorDate((prev) => {
          const d = new Date(prev);
          d.setDate(d.getDate() - 7);
          return d;
        });
      },
      onNextWeek: () => {
        setAnchorDate((prev) => {
          const d = new Date(prev);
          d.setDate(d.getDate() + 7);
          return d;
        });
      },
      onPreviousMonth: navigateBack,
      onNextMonth: navigateForward,
    },
    true
  );

  // Header title
  const headerTitle = useMemo(() => {
    switch (viewMode) {
      case 'day':
        return `${formatShortDate(anchorDate)}, ${formatMonthYear(anchorDate)}`;
      case 'week': {
        const weekEnd = new Date(anchorDate);
        weekEnd.setDate(weekEnd.getDate() + 6);
        return `${formatShortDate(anchorDate)} – ${formatShortDate(weekEnd)}`;
      }
      case 'month':
        return formatMonthYear(anchorDate);
      case 'agenda':
        return 'Upcoming';
    }
  }, [viewMode, anchorDate]);

  // Announce view mode changes to screen readers (skip initial render)
  const isInitialRender = React.useRef(true);
  React.useEffect(() => {
    if (isInitialRender.current) {
      isInitialRender.current = false;
      return;
    }
    announce(buildViewChangeAnnouncement(viewMode, headerTitle), 'polite');
  }, [viewMode, headerTitle, announce]);

  // Design tokens for dynamic styling
  const tokens = useTokens();

  // ── Calendar Sidebar for tablet/desktop (Req 19.1) ────────────────
  const sidebarElement = useMemo(
    () => (
      <CalendarSidebar
        anchorDate={anchorDate}
        onDateSelect={handleSidebarDateSelect}
        accounts={accounts}
        hiddenAccountIds={hiddenAccountIds}
        onToggleAccount={toggleAccountVisibility}
        upcomingEvents={upcomingEvents}
        onEventPress={handleSidebarEventPress}
      />
    ),
    [
      anchorDate,
      handleSidebarDateSelect,
      accounts,
      hiddenAccountIds,
      toggleAccountVisibility,
      upcomingEvents,
      handleSidebarEventPress,
    ]
  );

  return (
    <ResponsiveLayout sidebar={sidebarElement}>
    <View style={[styles.container, { backgroundColor: tokens.colors.background }]}>
      {/* Header bar */}
      <View style={[styles.header, { borderBottomColor: tokens.colors.borderLight, backgroundColor: tokens.colors.surface }]}>
        <View style={styles.headerLeft}>
          <TouchableOpacity
            onPress={navigateBack}
            style={styles.navButton}
            accessibilityRole="button"
            accessibilityLabel="Previous"
          >
            <Text style={[styles.navButtonText, { color: tokens.colors.textSecondary }]}>‹</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={goToToday}
            style={[styles.todayButton, { borderColor: tokens.colors.border }]}
            accessibilityRole="button"
            accessibilityLabel="Go to today"
          >
            <Text style={[styles.todayButtonText, { color: tokens.colors.textPrimary }]}>Today</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={navigateForward}
            style={styles.navButton}
            accessibilityRole="button"
            accessibilityLabel="Next"
          >
            <Text style={[styles.navButtonText, { color: tokens.colors.textSecondary }]}>›</Text>
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: tokens.colors.textPrimary, fontSize: tokens.typography.sizes.heading - 2 }]}>{headerTitle}</Text>
        </View>
        <AnimatedViewModeSwitcher currentMode={viewMode} onModeChange={handleViewModeChange} />
      </View>

      {/* Calendar view — wrapped with ViewTransitionAnimator for crossfade/slide transitions (Req 3.1) */}
      <ViewTransitionAnimator activeView={viewMode}>
        {(transitionStyle) => (
          <Animated.View style={[styles.viewContainer, transitionStyle]}>
            {/* First-launch empty state: no accounts connected (Req 16.4) */}
            {emptyStateContext === 'no-accounts' && (
              <EmptyStateView
                context="no-accounts"
                onCreateEvent={handleEmptyStateCreate}
                onConnectAccount={onConnectAccount}
              />
            )}
            {/* Normal view rendering (only when accounts exist) */}
            {emptyStateContext !== 'no-accounts' && viewMode === 'day' && (
          <SwipeNavigationHost
            anchorDate={anchorDate}
            unit="day"
            onNavigateForward={navigateForward}
            onNavigateBack={navigateBack}
            renderView={(d) => {
              const range = getDateRangeForViewMode('day', d);
              const viewEvents = sortEventsByTime(filterEventsByTimeRange(visibleEvents, range.start, range.end));
              if (viewEvents.length === 0) {
                return (
                  <EmptyStateView
                    context="day"
                    onCreateEvent={handleEmptyStateCreate}
                  />
                );
              }
              return (
                <DayView
                  date={d}
                  events={viewEvents}
                  accountColorMap={accountColorMap}
                  accountIndexMap={accountIndexMap}
                  onEventPress={onEventPress}
                  onReschedule={onReschedule}
                  onResize={onResize}
                  onCreateEvent={onCreateEvent}
                  onSync={onSync}
                  isSyncing={isSyncing}
                  calendarAccountId={calendarAccountId}
                  eventCRUDService={eventCRUDService}
                  onOpenEditor={onOpenEditor}
                  onQuickCreateEvent={onQuickCreateEvent}
                />
              );
            }}
          />
        )}
        {emptyStateContext !== 'no-accounts' && viewMode === 'week' && (
          <SwipeNavigationHost
            anchorDate={anchorDate}
            unit="week"
            onNavigateForward={navigateForward}
            onNavigateBack={navigateBack}
            renderView={(d) => {
              const range = getDateRangeForViewMode('week', d);
              const viewEvents = sortEventsByTime(filterEventsByTimeRange(visibleEvents, range.start, range.end));
              if (viewEvents.length === 0) {
                return (
                  <EmptyStateView
                    context="week"
                    onCreateEvent={handleEmptyStateCreate}
                  />
                );
              }
              return (
                <WeekView
                  date={d}
                  events={viewEvents}
                  accountColorMap={accountColorMap}
                  accountIndexMap={accountIndexMap}
                  onEventPress={onEventPress}
                  onDayPress={handleDayPress}
                  onReschedule={onReschedule}
                  onResize={onResize}
                  onCreateEvent={onCreateEvent}
                  onSync={onSync}
                  isSyncing={isSyncing}
                  calendarAccountId={calendarAccountId}
                  eventCRUDService={eventCRUDService}
                  onOpenEditor={onOpenEditor}
                  onQuickCreateEvent={onQuickCreateEvent}
                />
              );
            }}
          />
        )}
        {emptyStateContext !== 'no-accounts' && viewMode === 'month' && (
          <SwipeNavigationHost
            anchorDate={anchorDate}
            unit="month"
            onNavigateForward={navigateForward}
            onNavigateBack={navigateBack}
            renderView={(d) => {
              const range = getDateRangeForViewMode('month', d);
              const viewEvents = sortEventsByTime(filterEventsByTimeRange(visibleEvents, range.start, range.end));
              return (
                <StableMonthView
                  requestedDate={d}
                  events={viewEvents}
                  accountColorMap={accountColorMap}
                  accountIndexMap={accountIndexMap}
                  onDayPress={handleDayPress}
                  onEventPress={onEventPress}
                  onSync={onSync}
                  isSyncing={isSyncing}
                />
              );
            }}
          />
        )}
            {emptyStateContext !== 'no-accounts' && viewMode === 'agenda' && (
              rangeEvents.length === 0 ? (
                <EmptyStateView
                  context="agenda"
                  onCreateEvent={handleEmptyStateCreate}
                />
              ) : (
              <AgendaView
                events={rangeEvents}
                accountColorMap={accountColorMap}
                accountIndexMap={accountIndexMap}
                onEventPress={onEventPress}
                calendarAccountId={calendarAccountId}
                eventCRUDService={eventCRUDService}
                onOpenEditor={onOpenEditor}
                onQuickCreateEvent={onQuickCreateEvent}
                onSync={onSync}
                isSyncing={isSyncing}
                onCreateEvent={handleEmptyStateCreate}
              />
              )
            )}
          </Animated.View>
        )}
      </ViewTransitionAnimator>

      {/* Zoom transition overlay for Month_View day tap → Day_View (Req 3.3) */}
      {isZooming && (
        <Animated.View
          style={[StyleSheet.absoluteFill, zoomAnimatedStyle, { backgroundColor: tokens.colors.background }]}
          pointerEvents="none"
        />
      )}

      {/* Shortcut Help Overlay (Req 11.5, 11.6) */}
      <ShortcutHelpOverlay
        visible={shortcutHelpVisible}
        shortcuts={shortcutManager.getShortcuts() as Record<'navigation' | 'creation' | 'view-switching', import('../keyboard/useKeyboardShortcuts').ShortcutDefinition[]>}
        onDismiss={dismissShortcutHelp}
      />
    </View>
    </ResponsiveLayout>
  );
}

/* ------------------------------------------------------------------ */
/*  Exports for external use                                           */
/* ------------------------------------------------------------------ */

export { buildAccountColorMap } from './colorCoding';
export { filterVisibleEvents } from './calendarViewModel';

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  navButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navButtonText: {
    fontSize: 22,
    fontWeight: '300',
  },
  todayButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 4,
    borderWidth: 1,
    marginHorizontal: 4,
  },
  todayButtonText: {
    fontSize: 13,
    fontWeight: '500',
  },
  headerTitle: {
    fontWeight: '600',
    marginLeft: 8,
  },
  viewContainer: {
    flex: 1,
  },
});
