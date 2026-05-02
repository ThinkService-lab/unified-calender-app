/**
 * CalendarSidebar — left panel displayed on tablet/desktop breakpoints.
 *
 * Three sections:
 *   1. Mini_Month_Navigator — compact 7-column month grid with selected date
 *      highlight, forward/backward arrow navigation with crossfade (200ms).
 *   2. Account toggles — checkbox + account name + color dot for each
 *      connected calendar account, colored with the account's own color.
 *   3. Upcoming events list — next 10 events sorted by startTime ascending.
 *
 * Crossfade animation uses `react-native-reanimated` `withTiming` (200ms).
 * This is a duration-gated animation so `withTiming` is used directly rather
 * than the Animation Engine's spring-based `withMotion` (same exception as
 * `visibilityToggle` and `syncAppear` in Task 2.9). The reduced-motion gate
 * is routed through `useAnimation().shouldAnimate` so it flows through the
 * Animation Engine's single source of truth.
 *
 * The mini month syncs its displayed month/year when the `anchorDate` prop
 * changes externally (e.g. from the main view or upcoming events list).
 * Rapid arrow clicks during a crossfade transition are ignored.
 *
 * Fully keyboard-navigable: Tab between sections, Enter/Space to activate.
 *
 * Uses `React.createElement` instead of JSX to match the project's
 * `jsx: "react-native"` tsconfig setting.
 *
 * Requirements: 19.1, 19.2, 19.3, 19.4, 19.5, 19.6, 19.7, 19.8
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet, Platform } from 'react-native';
import type { ViewStyle, TextStyle } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
} from 'react-native-reanimated';

import { useTokens } from '../tokens/designTokens';
import type { DesignTokens } from '../tokens/designTokens';
import { useAnimation, ANIMATION_CONFIG } from '../animation/animationEngine';
import type { CalendarAccount, CalendarEvent } from '../../types/models';

// Re-export pure utility for external consumers
export { getUpcomingEvents } from './calendarSidebarUtils';

// ─── Public types ────────────────────────────────────────────────────────────

export interface CalendarSidebarProps {
  /** Current anchor date for the main calendar view */
  anchorDate: Date;
  /** Callback to update the main view's anchor date */
  onDateSelect: (date: Date) => void;
  /** All connected calendar accounts */
  accounts: CalendarAccount[];
  /** Set of hidden account IDs */
  hiddenAccountIds: ReadonlySet<string>;
  /** Toggle account visibility */
  onToggleAccount: (accountId: string) => void;
  /** Upcoming events (next 10, sorted by start time) */
  upcomingEvents: CalendarEvent[];
  /** Callback when an upcoming event is pressed */
  onEventPress: (event: CalendarEvent) => void;
}

// ─── Date helpers ────────────────────────────────────────────────────────────

const DAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'] as const;

/** Crossfade duration in ms. */
const CROSSFADE_DURATION = ANIMATION_CONFIG.durations.normal; // 200

/**
 * Returns an array of Date objects representing the 6-week (42-cell) grid
 * for the given month. Leading days from the previous month and trailing
 * days from the next month fill the grid.
 */
export function getMonthGrid(year: number, month: number): Date[] {
  const firstDay = new Date(year, month, 1);
  const startOffset = firstDay.getDay(); // 0 = Sunday
  const grid: Date[] = [];

  for (let i = 0; i < 42; i++) {
    const d = new Date(year, month, 1 - startOffset + i);
    grid.push(d);
  }
  return grid;
}

/** Check if two dates are the same calendar day. */
function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Check if a date is today. */
function isToday(d: Date): boolean {
  return isSameDay(d, new Date());
}

/** Format a time for the upcoming events list (e.g. "2:30 PM"). */
function formatTime(date: Date): string {
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const h = hours % 12 || 12;
  const m = minutes.toString().padStart(2, '0');
  return `${h}:${m} ${ampm}`;
}

/** Month names for the header. */
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

// ─── Sub-components ──────────────────────────────────────────────────────────

/**
 * Mini Month Navigator — compact month grid with crossfade navigation.
 */
function MiniMonthNavigator({
  anchorDate,
  onDateSelect,
  tokens,
  shouldAnimate,
}: {
  anchorDate: Date;
  onDateSelect: (date: Date) => void;
  tokens: DesignTokens;
  shouldAnimate: boolean;
}): React.ReactElement {
  const [displayYear, setDisplayYear] = useState(anchorDate.getFullYear());
  const [displayMonth, setDisplayMonth] = useState(anchorDate.getMonth());

  // Crossfade shared value
  const gridOpacity = useSharedValue(1);

  // Guard against rapid arrow clicks during crossfade (Gap 6)
  const isTransitioning = useRef(false);

  // Sync displayMonth/displayYear when anchorDate changes externally (Gap 5)
  useEffect(() => {
    const newYear = anchorDate.getFullYear();
    const newMonth = anchorDate.getMonth();
    if (newYear !== displayYear || newMonth !== displayMonth) {
      setDisplayYear(newYear);
      setDisplayMonth(newMonth);
    }
  }, [anchorDate]); // eslint-disable-line react-hooks/exhaustive-deps

  const grid = useMemo(
    () => getMonthGrid(displayYear, displayMonth),
    [displayYear, displayMonth],
  );

  const navigateMonth = useCallback(
    (delta: number) => {
      // Ignore rapid clicks while a crossfade is in progress (Gap 6)
      if (isTransitioning.current) return;

      if (!shouldAnimate) {
        // Instant change — no animation (reduced motion active)
        const next = new Date(displayYear, displayMonth + delta, 1);
        setDisplayYear(next.getFullYear());
        setDisplayMonth(next.getMonth());
      } else {
        // Fade out → update → fade in
        isTransitioning.current = true;
        gridOpacity.value = withTiming(0, { duration: CROSSFADE_DURATION / 2 });
        setTimeout(() => {
          const next = new Date(displayYear, displayMonth + delta, 1);
          setDisplayYear(next.getFullYear());
          setDisplayMonth(next.getMonth());
          gridOpacity.value = withTiming(1, { duration: CROSSFADE_DURATION / 2 });
          setTimeout(() => {
            isTransitioning.current = false;
          }, CROSSFADE_DURATION / 2);
        }, CROSSFADE_DURATION / 2);
      }
    },
    [displayYear, displayMonth, shouldAnimate, gridOpacity],
  );

  const goBack = useCallback(() => navigateMonth(-1), [navigateMonth]);
  const goForward = useCallback(() => navigateMonth(1), [navigateMonth]);

  const animatedGridStyle = useAnimatedStyle(() => ({
    opacity: gridOpacity.value,
  }));

  const headerTitle = `${MONTH_NAMES[displayMonth]} ${displayYear}`;

  // ── Header row: ← Month Year → ──
  const headerRow = React.createElement(
    View,
    {
      key: 'mini-month-header',
      style: styles.miniMonthHeader,
      accessible: true,
      accessibilityRole: 'header',
      accessibilityLabel: headerTitle,
      ...(Platform.OS === 'web'
        ? { role: 'heading', 'aria-level': 2 } as any
        : {}),
    },
    // Back arrow
    React.createElement(
      Pressable,
      {
        onPress: goBack,
        accessible: true,
        accessibilityRole: 'button',
        accessibilityLabel: 'Previous month',
        style: styles.navArrow,
        testID: 'mini-month-prev',
      },
      React.createElement(Text, {
        style: {
          color: tokens.colors.textPrimary,
          fontSize: tokens.typography.sizes.subheading,
          fontWeight: tokens.typography.weights.bold,
          fontFamily: tokens.typography.fontFamily.primary,
        },
      }, '‹'),
    ),
    // Title
    React.createElement(Text, {
      style: {
        color: tokens.colors.textPrimary,
        fontSize: tokens.typography.sizes.body,
        fontWeight: tokens.typography.weights.semibold,
        fontFamily: tokens.typography.fontFamily.primary,
        textAlign: 'center' as const,
        flex: 1,
      },
      testID: 'mini-month-title',
    }, headerTitle),
    // Forward arrow
    React.createElement(
      Pressable,
      {
        onPress: goForward,
        accessible: true,
        accessibilityRole: 'button',
        accessibilityLabel: 'Next month',
        style: styles.navArrow,
        testID: 'mini-month-next',
      },
      React.createElement(Text, {
        style: {
          color: tokens.colors.textPrimary,
          fontSize: tokens.typography.sizes.subheading,
          fontWeight: tokens.typography.weights.bold,
          fontFamily: tokens.typography.fontFamily.primary,
        },
      }, '›'),
    ),
  );

  // ── Day-of-week labels ──
  const dayLabelsRow = React.createElement(
    View,
    { key: 'day-labels', style: styles.dayLabelsRow },
    ...DAY_LABELS.map((label) =>
      React.createElement(Text, {
        key: label,
        style: {
          ...styles.dayLabelCell,
          color: tokens.colors.textMuted,
          fontSize: tokens.typography.sizes.caption,
          fontWeight: tokens.typography.weights.medium,
          fontFamily: tokens.typography.fontFamily.primary,
        },
        accessible: true,
        accessibilityRole: 'text',
      }, label),
    ),
  );

  // ── Grid rows ──
  const rows: React.ReactElement[] = [];
  for (let week = 0; week < 6; week++) {
    const cells: React.ReactElement[] = [];
    for (let day = 0; day < 7; day++) {
      const idx = week * 7 + day;
      const date = grid[idx];
      const inCurrentMonth = date.getMonth() === displayMonth;
      const selected = isSameDay(date, anchorDate);
      const today = isToday(date);

      const cellBg: ViewStyle = selected
        ? { backgroundColor: tokens.colors.primary, borderRadius: tokens.radii.full }
        : today
          ? { backgroundColor: tokens.colors.primaryLight, borderRadius: tokens.radii.full }
          : {};

      const textColor = selected
        ? tokens.colors.textOnPrimary
        : today
          ? tokens.colors.textOnPrimaryLight
          : inCurrentMonth
            ? tokens.colors.textPrimary
            : tokens.colors.textMuted;

      const dayLabel = `${MONTH_NAMES[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;

      cells.push(
        React.createElement(
          Pressable,
          {
            key: `day-${idx}`,
            onPress: () => onDateSelect(date),
            style: [styles.dayCell, cellBg],
            accessible: true,
            accessibilityRole: 'button',
            accessibilityLabel: dayLabel,
            accessibilityState: { selected },
            testID: `mini-month-day-${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`,
          },
          React.createElement(Text, {
            style: {
              color: textColor,
              fontSize: tokens.typography.sizes.caption,
              fontWeight: selected || today
                ? tokens.typography.weights.bold
                : tokens.typography.weights.regular,
              fontFamily: tokens.typography.fontFamily.primary,
              textAlign: 'center' as const,
            },
          }, String(date.getDate())),
        ),
      );
    }
    rows.push(
      React.createElement(View, { key: `week-${week}`, style: styles.weekRow }, ...cells),
    );
  }

  const gridContent = React.createElement(
    Animated.View,
    { style: [styles.monthGrid, animatedGridStyle], testID: 'mini-month-grid' },
    dayLabelsRow,
    ...rows,
  );

  return React.createElement(
    View,
    {
      style: {
        ...styles.section,
        borderBottomColor: tokens.colors.borderLight,
        borderBottomWidth: 1,
        paddingBottom: tokens.spacing.md,
      },
      accessible: true,
      accessibilityRole: 'none',
      ...(Platform.OS === 'web'
        ? { role: 'navigation', 'aria-label': 'Mini month navigator' } as any
        : {}),
      testID: 'mini-month-navigator',
    },
    headerRow,
    gridContent,
  );
}

/**
 * Account Toggles — checkbox + name + color dot for each account.
 */
function AccountToggles({
  accounts,
  hiddenAccountIds,
  onToggleAccount,
  tokens,
}: {
  accounts: CalendarAccount[];
  hiddenAccountIds: ReadonlySet<string>;
  onToggleAccount: (accountId: string) => void;
  tokens: DesignTokens;
}): React.ReactElement {
  const items = accounts.map((account) => {
    const isHidden = hiddenAccountIds.has(account.id);
    const checkboxSymbol = isHidden ? '☐' : '☑';

    return React.createElement(
      Pressable,
      {
        key: account.id,
        onPress: () => onToggleAccount(account.id),
        style: styles.accountRow,
        accessible: true,
        accessibilityRole: 'checkbox',
        accessibilityLabel: `${account.displayName} calendar`,
        accessibilityState: { checked: !isHidden },
        testID: `account-toggle-${account.id}`,
      },
      // Checkbox — colored with the account's own color (Req 19.4)
      React.createElement(Text, {
        style: {
          fontSize: tokens.typography.sizes.subheading,
          color: isHidden ? tokens.colors.textMuted : account.color,
          marginRight: tokens.spacing.sm,
          fontFamily: tokens.typography.fontFamily.primary,
        },
      }, checkboxSymbol),
      // Account name
      React.createElement(Text, {
        style: {
          flex: 1,
          color: tokens.colors.textPrimary,
          fontSize: tokens.typography.sizes.body,
          fontWeight: tokens.typography.weights.regular,
          fontFamily: tokens.typography.fontFamily.primary,
        },
        numberOfLines: 1,
      }, account.displayName),
      // Color dot
      React.createElement(View, {
        style: {
          width: 10,
          height: 10,
          borderRadius: tokens.radii.full,
          backgroundColor: account.color,
          marginLeft: tokens.spacing.sm,
        },
        accessible: true,
        accessibilityLabel: `${account.displayName} color indicator`,
      }),
    );
  });

  return React.createElement(
    View,
    {
      style: {
        ...styles.section,
        borderBottomColor: tokens.colors.borderLight,
        borderBottomWidth: 1,
        paddingBottom: tokens.spacing.md,
      },
      accessible: true,
      accessibilityRole: 'none',
      ...(Platform.OS === 'web'
        ? { role: 'group', 'aria-label': 'Calendar account toggles' } as any
        : {}),
      testID: 'account-toggles',
    },
    React.createElement(Text, {
      style: {
        color: tokens.colors.textSecondary,
        fontSize: tokens.typography.sizes.caption,
        fontWeight: tokens.typography.weights.semibold,
        fontFamily: tokens.typography.fontFamily.primary,
        textTransform: 'uppercase' as const,
        letterSpacing: 0.5,
        marginBottom: tokens.spacing.sm,
      },
      accessible: true,
      accessibilityRole: 'header',
    }, 'Calendars'),
    ...items,
  );
}

/**
 * Upcoming Events List — next 10 events sorted by startTime.
 */
function UpcomingEventsList({
  upcomingEvents,
  onEventPress,
  accounts,
  tokens,
}: {
  upcomingEvents: CalendarEvent[];
  onEventPress: (event: CalendarEvent) => void;
  accounts: CalendarAccount[];
  tokens: DesignTokens;
}): React.ReactElement {
  // Build a lookup for account colors
  const accountColorMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of accounts) {
      map.set(a.id, a.color);
    }
    return map;
  }, [accounts]);

  const items = upcomingEvents.slice(0, 10).map((event) => {
    const accountColor = accountColorMap.get(event.calendarAccountId) || tokens.colors.primary;
    const timeStr = event.isAllDay ? 'All day' : formatTime(event.startTime);

    return React.createElement(
      Pressable,
      {
        key: event.id,
        onPress: () => onEventPress(event),
        style: styles.eventRow,
        accessible: true,
        accessibilityRole: 'button',
        accessibilityLabel: `${event.title}, ${timeStr}`,
        testID: `upcoming-event-${event.id}`,
      },
      // Color indicator bar
      React.createElement(View, {
        style: {
          width: 3,
          borderRadius: tokens.radii.sm,
          backgroundColor: accountColor,
          marginRight: tokens.spacing.sm,
          alignSelf: 'stretch' as const,
        },
      }),
      // Event info
      React.createElement(
        View,
        { style: { flex: 1 } },
        React.createElement(Text, {
          style: {
            color: tokens.colors.textPrimary,
            fontSize: tokens.typography.sizes.body,
            fontWeight: tokens.typography.weights.medium,
            fontFamily: tokens.typography.fontFamily.primary,
          },
          numberOfLines: 1,
        }, event.title),
        React.createElement(Text, {
          style: {
            color: tokens.colors.textSecondary,
            fontSize: tokens.typography.sizes.caption,
            fontWeight: tokens.typography.weights.regular,
            fontFamily: tokens.typography.fontFamily.primary,
            marginTop: 2,
          },
        }, timeStr),
      ),
    );
  });

  const emptyMessage = upcomingEvents.length === 0
    ? React.createElement(Text, {
        style: {
          color: tokens.colors.textMuted,
          fontSize: tokens.typography.sizes.body,
          fontFamily: tokens.typography.fontFamily.primary,
          fontStyle: 'italic' as const,
          paddingVertical: tokens.spacing.md,
        },
        testID: 'upcoming-events-empty',
      }, 'No upcoming events')
    : null;

  return React.createElement(
    View,
    {
      style: styles.section,
      accessible: true,
      accessibilityRole: 'none',
      ...(Platform.OS === 'web'
        ? { role: 'list', 'aria-label': 'Upcoming events' } as any
        : {}),
      testID: 'upcoming-events-list',
    },
    React.createElement(Text, {
      style: {
        color: tokens.colors.textSecondary,
        fontSize: tokens.typography.sizes.caption,
        fontWeight: tokens.typography.weights.semibold,
        fontFamily: tokens.typography.fontFamily.primary,
        textTransform: 'uppercase' as const,
        letterSpacing: 0.5,
        marginBottom: tokens.spacing.sm,
      },
      accessible: true,
      accessibilityRole: 'header',
    }, 'Upcoming'),
    emptyMessage,
    ...items,
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

export function CalendarSidebar({
  anchorDate,
  onDateSelect,
  accounts,
  hiddenAccountIds,
  onToggleAccount,
  upcomingEvents,
  onEventPress,
}: CalendarSidebarProps): React.ReactElement {
  const tokens = useTokens();
  const { shouldAnimate } = useAnimation();

  return React.createElement(
    ScrollView,
    {
      style: {
        ...styles.container,
        backgroundColor: tokens.colors.surface,
        borderRightColor: tokens.colors.borderLight,
        borderRightWidth: 1,
      },
      contentContainerStyle: styles.contentContainer,
      testID: 'calendar-sidebar',
      accessible: true,
      accessibilityRole: 'none',
      ...(Platform.OS === 'web'
        ? { role: 'complementary', 'aria-label': 'Calendar sidebar' } as any
        : {}),
    },
    React.createElement(MiniMonthNavigator, {
      key: 'mini-month',
      anchorDate,
      onDateSelect,
      tokens,
      shouldAnimate,
    }),
    React.createElement(AccountToggles, {
      key: 'account-toggles',
      accounts,
      hiddenAccountIds,
      onToggleAccount,
      tokens,
    }),
    React.createElement(UpcomingEventsList, {
      key: 'upcoming-events',
      upcomingEvents,
      onEventPress,
      accounts,
      tokens,
    }),
  );
}

// ─── Static styles ───────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    maxWidth: 280,
  },
  contentContainer: {
    paddingVertical: 12,
    paddingHorizontal: 12,
  },
  section: {
    marginBottom: 12,
    paddingTop: 4,
  },
  miniMonthHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  navArrow: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayLabelsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 4,
  },
  dayLabelCell: {
    width: 28,
    textAlign: 'center',
  },
  monthGrid: {
    // Container for the animated grid
  },
  weekRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 2,
  },
  dayCell: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  accountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
  },
  eventRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    minHeight: 40,
  },
});

export default CalendarSidebar;
