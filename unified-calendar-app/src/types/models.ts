/**
 * Core data model type definitions for the Unified Calendar App.
 * Requirements: 2.1, 3.1, 12.1, 12.2
 */

/** Provider identifier for calendar services */
export type ProviderId = 'google' | 'outlook' | 'icloud' | 'exchange' | 'caldav';

/** Visibility level for calendars and events */
export type VisibilityLevel = 'public' | 'busy-only' | 'private';

export interface CalendarAccount {
  id: string;
  userId: string;
  providerId: ProviderId;
  displayName: string;
  email: string;
  color: string;
  visibility: VisibilityLevel;
  syncToken: string | null;
  lastSyncedAt: Date | null;
  status: 'active' | 'revoked' | 'error';
  createdAt: Date;
}

export interface CalendarEvent {
  id: string;
  providerEventId: string;
  calendarAccountId: string;
  title: string;
  description: string | null;
  location: string | null;
  startTime: Date;
  endTime: Date;
  timeZone: string;
  isAllDay: boolean;
  recurrenceRule: RecurrenceRule | null;
  recurrenceExceptionDate: Date | null;
  parentRecurringEventId: string | null;
  organizer: Organizer | null;
  attendees: Attendee[];
  sequence: number;
  dtstamp: Date;
  status: 'confirmed' | 'tentative' | 'cancelled';
  visibility: VisibilityLevel | null;
  opaqueFields: Map<string, string>;
  syncStatus: 'synced' | 'pending_create' | 'pending_update' | 'pending_delete' | 'conflict';
  localVersion: number;
  remoteEtag: string | null;
  modifiedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Organizer {
  email: string;
  displayName: string | null;
  sentBy: string | null;
}

export interface RecurrenceRule {
  frequency: 'daily' | 'weekly' | 'monthly' | 'yearly';
  interval: number;
  count: number | null;
  until: Date | null;
  bySecond: number[] | null;
  byMinute: number[] | null;
  byHour: number[] | null;
  byDay: string[] | null;
  byMonthDay: number[] | null;
  byYearDay: number[] | null;
  byWeekNo: number[] | null;
  byMonth: number[] | null;
  bySetPos: number[] | null;
  wkst: string;
  exceptions: Date[];
}

export interface Attendee {
  email: string;
  displayName: string | null;
  status: 'accepted' | 'declined' | 'tentative' | 'needs-action';
  role: 'required' | 'optional' | 'chair';
}
