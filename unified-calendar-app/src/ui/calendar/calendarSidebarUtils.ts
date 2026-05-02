/**
 * Pure utility functions for CalendarSidebar.
 *
 * Extracted into a separate module so they can be tested without
 * pulling in react-native-reanimated or other native dependencies.
 *
 * Requirement 19.6
 */

import type { CalendarEvent } from '../../types/models';

/**
 * Returns upcoming events filtered to those with startTime >= now,
 * sorted by startTime ascending, limited to 10.
 *
 * This is the pure logic that callers use to prepare the `upcomingEvents`
 * prop for CalendarSidebar.
 */
export function getUpcomingEvents(events: CalendarEvent[], now: Date): CalendarEvent[] {
  const nowMs = now.getTime();
  return events
    .filter((e) => e.startTime.getTime() >= nowMs)
    .sort((a, b) => a.startTime.getTime() - b.startTime.getTime())
    .slice(0, 10);
}
