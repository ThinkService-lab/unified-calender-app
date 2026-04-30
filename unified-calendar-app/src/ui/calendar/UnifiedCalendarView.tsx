/**
 * UnifiedCalendarView – Main container that switches between display modes.
 * Color-codes events by calendar account, supports visibility toggling
 * with ≤ 200ms response time using optimistic local state.
 * Requirements: 2.1, 2.2, 2.3, 2.4, 2.6
 */

import React, { useState, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import type { CalendarEvent, CalendarAccount } from '../../types/models';
import type { DefaultViewMode } from '../types';
import { useBreakpoint } from '../useBreakpoint';
import { ViewModeSwitcher } from './ViewModeSwitcher';
import { DayView } from './DayView';
import { WeekView } from './WeekView';
import { MonthView } from './MonthView';
import { AgendaView } from './AgendaView';
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
}

export function UnifiedCalendarView({
  events,
  accounts,
  initialViewMode,
  initialDate,
  onEventPress,
  onDayPress: externalDayPress,
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

  // Day press handler – switch to day view
  const handleDayPress = useCallback(
    (date: Date) => {
      setAnchorDate(date);
      if (externalDayPress) {
        externalDayPress(date);
      } else {
        setViewMode('day');
      }
    },
    [externalDayPress]
  );

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

  return (
    <View style={styles.container}>
      {/* Header bar */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <TouchableOpacity
            onPress={navigateBack}
            style={styles.navButton}
            accessibilityRole="button"
            accessibilityLabel="Previous"
          >
            <Text style={styles.navButtonText}>‹</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={goToToday}
            style={styles.todayButton}
            accessibilityRole="button"
            accessibilityLabel="Go to today"
          >
            <Text style={styles.todayButtonText}>Today</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={navigateForward}
            style={styles.navButton}
            accessibilityRole="button"
            accessibilityLabel="Next"
          >
            <Text style={styles.navButtonText}>›</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{headerTitle}</Text>
        </View>
        <ViewModeSwitcher currentMode={viewMode} onModeChange={handleViewModeChange} />
      </View>

      {/* Calendar view */}
      <View style={styles.viewContainer}>
        {viewMode === 'day' && (
          <DayView
            date={anchorDate}
            events={rangeEvents}
            accountColorMap={accountColorMap}
            accountIndexMap={accountIndexMap}
            onEventPress={onEventPress}
          />
        )}
        {viewMode === 'week' && (
          <WeekView
            date={anchorDate}
            events={rangeEvents}
            accountColorMap={accountColorMap}
            accountIndexMap={accountIndexMap}
            onEventPress={onEventPress}
            onDayPress={handleDayPress}
          />
        )}
        {viewMode === 'month' && (
          <MonthView
            date={anchorDate}
            events={rangeEvents}
            accountColorMap={accountColorMap}
            accountIndexMap={accountIndexMap}
            onDayPress={handleDayPress}
            onEventPress={onEventPress}
          />
        )}
        {viewMode === 'agenda' && (
          <AgendaView
            events={rangeEvents}
            accountColorMap={accountColorMap}
            accountIndexMap={accountIndexMap}
            onEventPress={onEventPress}
          />
        )}
      </View>
    </View>
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
    backgroundColor: '#FFFFFF',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E0E0E0',
    backgroundColor: '#FFFFFF',
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
    color: '#5F6368',
    fontWeight: '300',
  },
  todayButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#DADCE0',
    marginHorizontal: 4,
  },
  todayButtonText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#3C4043',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#202124',
    marginLeft: 8,
  },
  viewContainer: {
    flex: 1,
  },
});
