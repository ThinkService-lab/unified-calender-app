/**
 * Calendar view model – pure logic for filtering, grouping, and
 * preparing events for display in the unified calendar view.
 * Requirements: 2.1, 2.2, 2.4, 2.6
 */

import type { CalendarEvent, CalendarAccount } from '../../types/models';
import type { DefaultViewMode } from '../types';

/* ------------------------------------------------------------------ */
/*  Date helpers                                                       */
/* ------------------------------------------------------------------ */

/** Start of day (00:00:00.000) in local time */
export function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** End of day (23:59:59.999) in local time */
export function endOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

/** Start of the week (Sunday) for a given date */
export function startOfWeek(date: Date): Date {
  const d = new Date(date);
  d.setDate(d.getDate() - d.getDay());
  d.setHours(0, 0, 0, 0);
  return d;
}

/** End of the week (Saturday 23:59:59.999) */
export function endOfWeek(date: Date): Date {
  const d = startOfWeek(date);
  d.setDate(d.getDate() + 6);
  d.setHours(23, 59, 59, 999);
  return d;
}

/** Start of month */
export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0);
}

/** End of month */
export function endOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
}

/** Get all dates in a month grid (includes padding from prev/next months) */
export function getMonthGridDates(date: Date): Date[] {
  const first = startOfMonth(date);
  const last = endOfMonth(date);
  const gridStart = startOfWeek(first);
  const dates: Date[] = [];

  const current = new Date(gridStart);
  // Always produce 6 weeks (42 days) for consistent grid height
  for (let i = 0; i < 42; i++) {
    dates.push(new Date(current));
    current.setDate(current.getDate() + 1);
  }
  return dates;
}

/** Get the 7 dates of the week containing the given date */
export function getWeekDates(date: Date): Date[] {
  const weekStart = startOfWeek(date);
  const dates: Date[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    dates.push(d);
  }
  return dates;
}

/** Check if two dates are the same calendar day */
export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Format time as HH:MM (24h) */
export function formatTime(date: Date): string {
  const h = date.getHours().toString().padStart(2, '0');
  const m = date.getMinutes().toString().padStart(2, '0');
  return `${h}:${m}`;
}

/** Format date as short string e.g. "Mon 15" */
export function formatShortDate(date: Date): string {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return `${days[date.getDay()]} ${date.getDate()}`;
}

/** Format date as "January 2025" */
export function formatMonthYear(date: Date): string {
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  return `${months[date.getMonth()]} ${date.getFullYear()}`;
}

/* ------------------------------------------------------------------ */
/*  Visibility filtering                                               */
/* ------------------------------------------------------------------ */

/**
 * Filters events to only include those from visible calendar accounts.
 * This is the core of the ≤ 200ms visibility toggle – we simply filter
 * against a Set of hidden account IDs.
 */
export function filterVisibleEvents(
  events: CalendarEvent[],
  hiddenAccountIds: ReadonlySet<string>
): CalendarEvent[] {
  if (hiddenAccountIds.size === 0) return events;
  return events.filter((e) => !hiddenAccountIds.has(e.calendarAccountId));
}

/* ------------------------------------------------------------------ */
/*  Time-range filtering                                               */
/* ------------------------------------------------------------------ */

/** Filter events that overlap with a given time range */
export function filterEventsByTimeRange(
  events: CalendarEvent[],
  rangeStart: Date,
  rangeEnd: Date
): CalendarEvent[] {
  const startMs = rangeStart.getTime();
  const endMs = rangeEnd.getTime();
  return events.filter(
    (e) => e.startTime.getTime() < endMs && e.endTime.getTime() > startMs
  );
}

/** Get events for a specific day */
export function getEventsForDay(
  events: CalendarEvent[],
  day: Date
): CalendarEvent[] {
  return filterEventsByTimeRange(events, startOfDay(day), endOfDay(day));
}

/* ------------------------------------------------------------------ */
/*  View-mode date range                                               */
/* ------------------------------------------------------------------ */

export interface DateRange {
  start: Date;
  end: Date;
}

/** Compute the date range for a given view mode and anchor date */
export function getDateRangeForViewMode(
  mode: DefaultViewMode,
  anchorDate: Date
): DateRange {
  switch (mode) {
    case 'day':
      return { start: startOfDay(anchorDate), end: endOfDay(anchorDate) };
    case 'week':
      return { start: startOfWeek(anchorDate), end: endOfWeek(anchorDate) };
    case 'month':
      return { start: startOfMonth(anchorDate), end: endOfMonth(anchorDate) };
    case 'agenda':
      // Agenda shows 30 days from anchor
      const agendaEnd = new Date(anchorDate);
      agendaEnd.setDate(agendaEnd.getDate() + 30);
      return { start: startOfDay(anchorDate), end: endOfDay(agendaEnd) };
  }
}

/* ------------------------------------------------------------------ */
/*  Agenda grouping                                                    */
/* ------------------------------------------------------------------ */

export interface AgendaGroup {
  date: Date;
  dateKey: string; // "YYYY-MM-DD"
  events: CalendarEvent[];
}

/** Group events by day for the agenda view */
export function groupEventsByDay(events: CalendarEvent[]): AgendaGroup[] {
  const map = new Map<string, { date: Date; events: CalendarEvent[] }>();

  for (const event of events) {
    const d = event.startTime;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (!map.has(key)) {
      map.set(key, { date: startOfDay(d), events: [] });
    }
    map.get(key)!.events.push(event);
  }

  // Sort groups by date, events within each group by start time
  const groups = Array.from(map.values()).map((g) => ({
    date: g.date,
    dateKey: `${g.date.getFullYear()}-${String(g.date.getMonth() + 1).padStart(2, '0')}-${String(g.date.getDate()).padStart(2, '0')}`,
    events: g.events.sort((a, b) => a.startTime.getTime() - b.startTime.getTime()),
  }));

  groups.sort((a, b) => a.date.getTime() - b.date.getTime());
  return groups;
}

/* ------------------------------------------------------------------ */
/*  Month view event counts                                            */
/* ------------------------------------------------------------------ */

export interface MonthDayInfo {
  date: Date;
  isCurrentMonth: boolean;
  isToday: boolean;
  events: CalendarEvent[];
}

/** Build month grid data with event counts per day */
export function buildMonthGridData(
  anchorDate: Date,
  events: CalendarEvent[]
): MonthDayInfo[] {
  const gridDates = getMonthGridDates(anchorDate);
  const today = new Date();
  const currentMonth = anchorDate.getMonth();

  return gridDates.map((date) => ({
    date,
    isCurrentMonth: date.getMonth() === currentMonth,
    isToday: isSameDay(date, today),
    events: getEventsForDay(events, date),
  }));
}

/* ------------------------------------------------------------------ */
/*  Sorting                                                            */
/* ------------------------------------------------------------------ */

/** Sort events by start time ascending */
export function sortEventsByTime(events: CalendarEvent[]): CalendarEvent[] {
  return [...events].sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
}
