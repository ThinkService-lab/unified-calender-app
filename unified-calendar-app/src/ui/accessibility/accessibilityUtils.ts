/**
 * Accessibility utility functions for building accessible labels
 * and descriptions for calendar UI elements.
 * Requirements: 9.6
 */

import type { CalendarEvent } from '../../types/models';

/**
 * Formats a time for screen reader announcement.
 * Uses 12-hour format with AM/PM for clarity.
 */
export function formatTimeForAccessibility(date: Date): string {
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const period = hours >= 12 ? 'PM' : 'AM';
  const displayHour = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
  const displayMinutes = minutes === 0 ? '' : `:${minutes.toString().padStart(2, '0')}`;
  return `${displayHour}${displayMinutes} ${period}`;
}

/**
 * Builds a comprehensive accessibility label for a calendar event.
 * Announces: title, time range, calendar name, and conflict status.
 *
 * Example: "Team Meeting, 10:00 AM to 11:00 AM, Work Calendar, has conflict"
 */
export function buildEventAccessibilityLabel(
  event: CalendarEvent,
  calendarName: string,
  hasConflict: boolean
): string {
  const parts: string[] = [];

  // Title
  parts.push(event.title || 'Untitled event');

  // Time
  if (event.isAllDay) {
    parts.push('all day');
  } else {
    const startStr = formatTimeForAccessibility(event.startTime);
    const endStr = formatTimeForAccessibility(event.endTime);
    parts.push(`${startStr} to ${endStr}`);
  }

  // Calendar name
  if (calendarName) {
    parts.push(calendarName);
  }

  // Conflict status
  if (hasConflict) {
    parts.push('has conflict');
  }

  return parts.join(', ');
}

/**
 * Builds an accessibility label for a day cell in month/week views.
 */
export function buildDayCellAccessibilityLabel(
  date: Date,
  eventCount: number,
  isToday: boolean
): string {
  const dateStr = date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  const parts: string[] = [dateStr];

  if (isToday) {
    parts.push('today');
  }

  if (eventCount === 0) {
    parts.push('no events');
  } else if (eventCount === 1) {
    parts.push('1 event');
  } else {
    parts.push(`${eventCount} events`);
  }

  return parts.join(', ');
}

/**
 * Builds an accessibility label for a view mode change announcement.
 */
export function buildViewChangeAnnouncement(
  viewMode: string,
  dateContext: string
): string {
  return `${viewMode} view, ${dateContext}`;
}

/**
 * Builds an accessibility label for sync status.
 */
export function buildSyncStatusAnnouncement(
  status: 'syncing' | 'synced' | 'error' | 'offline'
): string {
  switch (status) {
    case 'syncing':
      return 'Calendar syncing';
    case 'synced':
      return 'Calendar synced';
    case 'error':
      return 'Sync error occurred';
    case 'offline':
      return 'Offline mode, changes will sync when connected';
  }
}

/**
 * Builds an accessibility label for a conflict alert.
 */
export function buildConflictAlertAnnouncement(
  eventTitle: string,
  conflictingEventTitle: string
): string {
  return `Scheduling conflict: ${eventTitle} overlaps with ${conflictingEventTitle}`;
}
