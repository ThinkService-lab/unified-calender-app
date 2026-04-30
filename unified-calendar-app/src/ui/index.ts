/**
 * UI module public API – responsive layout system + calendar views.
 * Requirements: 2.1, 2.2, 2.3, 2.4, 2.6, 9.5
 */

export { BREAKPOINTS, resolveBreakpoint, getLayoutConfig } from './breakpoints';
export { useBreakpoint, useBreakpointName } from './useBreakpoint';
export { ResponsiveLayout } from './ResponsiveLayout';
export type { ResponsiveLayoutProps } from './ResponsiveLayout';
export type {
  BreakpointName,
  Breakpoints,
  LayoutConfig,
  NavigationType,
  DefaultViewMode,
} from './types';

// Calendar views (Task 17.2)
export {
  UnifiedCalendarView,
  DayView,
  WeekView,
  MonthView,
  AgendaView,
  ViewModeSwitcher,
  CALENDAR_COLOR_PALETTE,
  getAccountColor,
  buildAccountColorMap,
  getEventBackgroundColor,
  getEventBorderColor,
  filterVisibleEvents,
  filterEventsByTimeRange,
  getEventsForDay,
  getDateRangeForViewMode,
  groupEventsByDay,
  buildMonthGridData,
  sortEventsByTime,
} from './calendar';
