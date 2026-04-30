/**
 * Tests for accessibility utility functions.
 * Requirements: 9.6
 */

import {
  buildEventAccessibilityLabel,
  buildDayCellAccessibilityLabel,
  buildViewChangeAnnouncement,
  buildSyncStatusAnnouncement,
  buildConflictAlertAnnouncement,
  formatTimeForAccessibility,
} from '../accessibilityUtils';
import type { CalendarEvent } from '../../../types/models';

function makeEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'evt-1',
    providerEventId: 'prov-1',
    calendarAccountId: 'acc-1',
    title: 'Team Meeting',
    description: null,
    location: null,
    startTime: new Date(2025, 0, 15, 10, 0),
    endTime: new Date(2025, 0, 15, 11, 0),
    timeZone: 'UTC',
    isAllDay: false,
    recurrenceRule: null,
    recurrenceExceptionDate: null,
    parentRecurringEventId: null,
    organizer: null,
    attendees: [],
    sequence: 0,
    dtstamp: new Date(),
    status: 'confirmed',
    visibility: null,
    opaqueFields: new Map(),
    syncStatus: 'synced',
    localVersion: 1,
    remoteEtag: null,
    modifiedBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('formatTimeForAccessibility', () => {
  it('formats morning time correctly', () => {
    expect(formatTimeForAccessibility(new Date(2025, 0, 1, 10, 0))).toBe('10 AM');
  });

  it('formats afternoon time correctly', () => {
    expect(formatTimeForAccessibility(new Date(2025, 0, 1, 14, 30))).toBe('2:30 PM');
  });

  it('formats midnight as 12 AM', () => {
    expect(formatTimeForAccessibility(new Date(2025, 0, 1, 0, 0))).toBe('12 AM');
  });

  it('formats noon as 12 PM', () => {
    expect(formatTimeForAccessibility(new Date(2025, 0, 1, 12, 0))).toBe('12 PM');
  });

  it('includes minutes when non-zero', () => {
    expect(formatTimeForAccessibility(new Date(2025, 0, 1, 9, 15))).toBe('9:15 AM');
  });

  it('pads single-digit minutes', () => {
    expect(formatTimeForAccessibility(new Date(2025, 0, 1, 3, 5))).toBe('3:05 AM');
  });
});

describe('buildEventAccessibilityLabel', () => {
  it('includes title, time range, calendar name', () => {
    const event = makeEvent();
    const label = buildEventAccessibilityLabel(event, 'Work Calendar', false);
    expect(label).toBe('Team Meeting, 10 AM to 11 AM, Work Calendar');
  });

  it('includes conflict status when present', () => {
    const event = makeEvent();
    const label = buildEventAccessibilityLabel(event, 'Work Calendar', true);
    expect(label).toBe('Team Meeting, 10 AM to 11 AM, Work Calendar, has conflict');
  });

  it('handles all-day events', () => {
    const event = makeEvent({ isAllDay: true });
    const label = buildEventAccessibilityLabel(event, 'Personal', false);
    expect(label).toBe('Team Meeting, all day, Personal');
  });

  it('handles events with no title', () => {
    const event = makeEvent({ title: '' });
    const label = buildEventAccessibilityLabel(event, 'Work', false);
    expect(label).toContain('Untitled event');
  });

  it('handles events with minutes in time', () => {
    const event = makeEvent({
      startTime: new Date(2025, 0, 15, 10, 30),
      endTime: new Date(2025, 0, 15, 11, 45),
    });
    const label = buildEventAccessibilityLabel(event, 'Work', false);
    expect(label).toBe('Team Meeting, 10:30 AM to 11:45 AM, Work');
  });
});

describe('buildDayCellAccessibilityLabel', () => {
  it('includes date and event count', () => {
    const date = new Date(2025, 0, 15);
    const label = buildDayCellAccessibilityLabel(date, 3, false);
    expect(label).toContain('3 events');
    expect(label).toContain('January');
    expect(label).toContain('15');
  });

  it('indicates today', () => {
    const today = new Date();
    const label = buildDayCellAccessibilityLabel(today, 1, true);
    expect(label).toContain('today');
    expect(label).toContain('1 event');
  });

  it('handles zero events', () => {
    const date = new Date(2025, 5, 1);
    const label = buildDayCellAccessibilityLabel(date, 0, false);
    expect(label).toContain('no events');
  });
});

describe('buildViewChangeAnnouncement', () => {
  it('announces view mode and date context', () => {
    const announcement = buildViewChangeAnnouncement('Week', 'January 13 – January 19');
    expect(announcement).toBe('Week view, January 13 – January 19');
  });
});

describe('buildSyncStatusAnnouncement', () => {
  it('announces syncing', () => {
    expect(buildSyncStatusAnnouncement('syncing')).toBe('Calendar syncing');
  });

  it('announces synced', () => {
    expect(buildSyncStatusAnnouncement('synced')).toBe('Calendar synced');
  });

  it('announces error', () => {
    expect(buildSyncStatusAnnouncement('error')).toBe('Sync error occurred');
  });

  it('announces offline', () => {
    expect(buildSyncStatusAnnouncement('offline')).toContain('Offline');
  });
});

describe('buildConflictAlertAnnouncement', () => {
  it('announces both event titles', () => {
    const announcement = buildConflictAlertAnnouncement('Team Meeting', 'Lunch');
    expect(announcement).toBe('Scheduling conflict: Team Meeting overlaps with Lunch');
  });
});
