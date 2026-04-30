/**
 * Calendar UI module public API.
 * Requirements: 2.1, 2.2, 2.3, 2.4, 2.6
 */

// Main container
export { UnifiedCalendarView } from './UnifiedCalendarView';
export type { UnifiedCalendarViewProps } from './UnifiedCalendarView';

// Individual views
export { DayView } from './DayView';
export type { DayViewProps } from './DayView';

export { WeekView } from './WeekView';
export type { WeekViewProps } from './WeekView';

export { MonthView } from './MonthView';
export type { MonthViewProps } from './MonthView';

export { AgendaView } from './AgendaView';
export type { AgendaViewProps } from './AgendaView';

// View mode switcher
export { ViewModeSwitcher } from './ViewModeSwitcher';
export type { ViewModeSwitcherProps } from './ViewModeSwitcher';

// Color coding utilities
export {
  CALENDAR_COLOR_PALETTE,
  getAccountColor,
  buildAccountColorMap,
  getEventBackgroundColor,
  getEventBorderColor,
} from './colorCoding';

// View model logic
export {
  startOfDay,
  endOfDay,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  getMonthGridDates,
  getWeekDates,
  isSameDay,
  formatTime,
  formatShortDate,
  formatMonthYear,
  filterVisibleEvents,
  filterEventsByTimeRange,
  getEventsForDay,
  getDateRangeForViewMode,
  groupEventsByDay,
  buildMonthGridData,
  sortEventsByTime,
} from './calendarViewModel';
export type { DateRange, AgendaGroup, MonthDayInfo } from './calendarViewModel';

// Overlap layout algorithm
export { computeOverlapLayout } from './overlapLayout';
export type { EventLayoutInfo } from './overlapLayout';
