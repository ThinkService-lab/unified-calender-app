/**
 * Unit tests for CalendarSidebar wiring into ResponsiveLayout.
 * Task 18.6: Verifies the integration contracts between CalendarSidebar,
 * ResponsiveLayout, and UnifiedCalendarView state.
 *
 * Tests the data flow:
 *   - Mini month navigator → anchor date (Req 19.2)
 *   - Account toggles → hiddenAccountIds visibility filter (Req 19.5)
 *   - Upcoming events list → event store via getUpcomingEvents (Req 19.6)
 *   - Sidebar visibility → breakpoint-driven layout (Req 19.1)
 *
 * Requirements: 19.1, 19.2, 19.4, 19.5, 19.6
 */

import type { CalendarEvent, CalendarAccount } from '../../../types/models';
import { getUpcomingEvents } from '../calendarSidebarUtils';
import { filterVisibleEvents } from '../calendarViewModel';
import { getLayoutConfig } from '../../breakpoints';

/* ------------------------------------------------------------------ */
/*  Test helpers                                                       */
/* ------------------------------------------------------------------ */

function makeAccount(overrides: Partial<CalendarAccount> & { id: string }): CalendarAccount {
  return {
    userId: 'user-1',
    providerId: 'google',
    displayName: 'Test Account',
    email: 'test@example.com',
    color: '#1A73E8',
    visibility: 'public',
    syncToken: null,
    lastSyncedAt: null,
    status: 'active',
    createdAt: new Date(),
    ...overrides,
  };
}

function makeEvent(overrides: Partial<CalendarEvent> & { id: string }): CalendarEvent {
  return {
    providerEventId: overrides.id,
    calendarAccountId: 'account-1',
    title: 'Test Event',
    description: null,
    location: null,
    startTime: new Date('2025-06-15T10:00:00Z'),
    endTime: new Date('2025-06-15T11:00:00Z'),
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

/* ------------------------------------------------------------------ */
/*  Sidebar visibility per breakpoint (Req 19.1)                       */
/* ------------------------------------------------------------------ */

describe('Sidebar visibility per breakpoint (Req 19.1)', () => {
  test('sidebar is hidden on phone breakpoint', () => {
    const config = getLayoutConfig(375);
    expect(config.showSidebar).toBe(false);
  });

  test('sidebar is visible on tablet breakpoint', () => {
    const config = getLayoutConfig(800);
    expect(config.showSidebar).toBe(true);
  });

  test('sidebar is visible on desktop breakpoint', () => {
    const config = getLayoutConfig(1280);
    expect(config.showSidebar).toBe(true);
  });

  test('sidebar is visible on wide breakpoint', () => {
    const config = getLayoutConfig(1920);
    expect(config.showSidebar).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/*  Upcoming events pipeline: visibility filter → getUpcomingEvents    */
/*  (Req 19.5, 19.6)                                                   */
/* ------------------------------------------------------------------ */

describe('Sidebar upcoming events pipeline', () => {
  const now = new Date('2025-06-15T12:00:00Z');

  const events = [
    makeEvent({ id: 'past', calendarAccountId: 'acc-1', startTime: new Date('2025-06-15T08:00:00Z'), endTime: new Date('2025-06-15T09:00:00Z') }),
    makeEvent({ id: 'future-1', calendarAccountId: 'acc-1', startTime: new Date('2025-06-15T14:00:00Z'), endTime: new Date('2025-06-15T15:00:00Z'), title: 'Meeting' }),
    makeEvent({ id: 'future-2', calendarAccountId: 'acc-2', startTime: new Date('2025-06-15T16:00:00Z'), endTime: new Date('2025-06-15T17:00:00Z'), title: 'Lunch' }),
    makeEvent({ id: 'future-3', calendarAccountId: 'acc-1', startTime: new Date('2025-06-16T10:00:00Z'), endTime: new Date('2025-06-16T11:00:00Z'), title: 'Standup' }),
  ];

  test('upcoming events excludes past events', () => {
    const upcoming = getUpcomingEvents(events, now);
    expect(upcoming.every((e) => e.startTime.getTime() >= now.getTime())).toBe(true);
    expect(upcoming.find((e) => e.id === 'past')).toBeUndefined();
  });

  test('upcoming events are sorted by start time ascending', () => {
    const upcoming = getUpcomingEvents(events, now);
    for (let i = 1; i < upcoming.length; i++) {
      expect(upcoming[i].startTime.getTime()).toBeGreaterThanOrEqual(
        upcoming[i - 1].startTime.getTime()
      );
    }
  });

  test('visibility filter + upcoming events pipeline hides toggled-off accounts', () => {
    const hidden = new Set(['acc-2']);
    const visible = filterVisibleEvents(events, hidden);
    const upcoming = getUpcomingEvents(visible, now);

    // acc-2 events should be excluded
    expect(upcoming.find((e) => e.calendarAccountId === 'acc-2')).toBeUndefined();
    expect(upcoming).toHaveLength(2); // future-1 and future-3 from acc-1
  });

  test('toggling account back on restores events in upcoming list', () => {
    // First hide acc-1
    const hidden1 = new Set(['acc-1']);
    const visible1 = filterVisibleEvents(events, hidden1);
    const upcoming1 = getUpcomingEvents(visible1, now);
    expect(upcoming1).toHaveLength(1); // only future-2 from acc-2

    // Then show all
    const hidden2 = new Set<string>();
    const visible2 = filterVisibleEvents(events, hidden2);
    const upcoming2 = getUpcomingEvents(visible2, now);
    expect(upcoming2).toHaveLength(3); // future-1, future-2, future-3
  });

  test('upcoming events limited to 10', () => {
    const manyEvents = Array.from({ length: 20 }, (_, i) =>
      makeEvent({
        id: `evt-${i}`,
        startTime: new Date(now.getTime() + (i + 1) * 3600000),
        endTime: new Date(now.getTime() + (i + 2) * 3600000),
      })
    );
    const upcoming = getUpcomingEvents(manyEvents, now);
    expect(upcoming).toHaveLength(10);
  });
});

/* ------------------------------------------------------------------ */
/*  Account toggle data flow (Req 19.4, 19.5)                          */
/* ------------------------------------------------------------------ */

describe('Account toggle data flow', () => {
  test('hiddenAccountIds set correctly filters events', () => {
    const events = [
      makeEvent({ id: 'e1', calendarAccountId: 'work' }),
      makeEvent({ id: 'e2', calendarAccountId: 'personal' }),
      makeEvent({ id: 'e3', calendarAccountId: 'family' }),
    ];

    // Simulate toggling 'personal' off
    const hidden = new Set(['personal']);
    const visible = filterVisibleEvents(events, hidden);
    expect(visible).toHaveLength(2);
    expect(visible.map((e) => e.calendarAccountId)).toEqual(['work', 'family']);
  });

  test('toggling multiple accounts off filters all their events', () => {
    const events = [
      makeEvent({ id: 'e1', calendarAccountId: 'work' }),
      makeEvent({ id: 'e2', calendarAccountId: 'personal' }),
      makeEvent({ id: 'e3', calendarAccountId: 'family' }),
    ];

    const hidden = new Set(['personal', 'family']);
    const visible = filterVisibleEvents(events, hidden);
    expect(visible).toHaveLength(1);
    expect(visible[0].calendarAccountId).toBe('work');
  });
});
