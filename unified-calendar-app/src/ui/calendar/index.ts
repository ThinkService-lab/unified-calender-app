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

// Event Card (shared event rendering with micro-interactions)
export { EventCard } from './EventCard';
export type { EventCardProps } from './EventCard';

// Animated view mode switcher (sliding indicator)
export { AnimatedViewModeSwitcher } from './AnimatedViewModeSwitcher';
export type { AnimatedViewModeSwitcherProps } from './AnimatedViewModeSwitcher';

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

// Current time indicator
export { CurrentTimeIndicator, computeCurrentTimePosition } from './CurrentTimeIndicator';
export type { CurrentTimeIndicatorProps } from './CurrentTimeIndicator';

// Inline event popover (click-to-create)
export { InlineEventPopover } from './InlineEventPopover';
export type { InlineEventPopoverProps } from './InlineEventPopover';

// Time slot utilities (snapping + coordinate conversion)
export {
  snapToIncrement,
  yToMinutes,
  minutesToY,
  DEFAULT_SNAP_INCREMENT_MINUTES,
} from './timeSlotUtils';
export type { TimeSlotPosition } from './timeSlotUtils';

// Empty state view
export { EmptyStateView, getEmptyStateMessage } from './EmptyStateView';
export type { EmptyStateViewProps, EmptyStateContext } from './EmptyStateView';

// Quick Create Bar (NL event creation)
export { QuickCreateBar } from './QuickCreateBar';
export type { QuickCreateBarProps } from './QuickCreateBar';

// Live Preview Panel (real-time parsed field preview)
export { LivePreviewPanel } from './LivePreviewPanel';
export type { LivePreviewPanelProps } from './LivePreviewPanel';

// Stable Month View (debounced navigation wrapper)
export { StableMonthView } from './StableMonthView';
export type { StableMonthViewProps } from './StableMonthView';

// Stable navigation hook
export { useStableNavigation } from './useStableNavigation';
export type {
  UseStableNavigationConfig,
  UseStableNavigationReturn,
} from './useStableNavigation';

// Calendar Sidebar (tablet/desktop left panel)
export { CalendarSidebar, getMonthGrid, getUpcomingEvents } from './CalendarSidebar';
export type { CalendarSidebarProps } from './CalendarSidebar';
