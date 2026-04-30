/**
 * EventEditorViewModel — Pure logic layer for the event editor.
 * Handles form validation, event building, recurrence rule construction,
 * and conflict detection. Fully testable without React dependencies.
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 7.2, 7.3
 */

import type {
  CalendarEvent,
  CalendarAccount,
  RecurrenceRule,
  Attendee,
  Conflict,
  TimeSlot,
} from '../../types';

/** Form data representing the event editor state */
export interface EventFormData {
  title: string;
  description: string;
  location: string;
  startTime: Date;
  endTime: Date;
  isAllDay: boolean;
  calendarAccountId: string;
  recurrenceFrequency: 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';
  recurrenceInterval: number;
  recurrenceEndCondition: 'never' | 'count' | 'until';
  recurrenceCount: number | null;
  recurrenceUntil: Date | null;
  recurrenceByDay: string[] | null;
  recurrenceByMonthDay: number[] | null;
  attendees: Attendee[];
}

/** Validation errors keyed by field name */
export interface ValidationErrors {
  title?: string;
  startTime?: string;
  endTime?: string;
  calendarAccountId?: string;
  recurrenceCount?: string;
  recurrenceUntil?: string;
}

/** Result of form validation */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationErrors;
}

/** Conflict detection result for the form */
export interface FormConflictResult {
  conflicts: Conflict[];
  alternatives: TimeSlot[];
}

/**
 * Creates a default empty form for new event creation.
 */
export function createDefaultForm(defaultAccountId?: string): EventFormData {
  const now = new Date();
  const startTime = new Date(now);
  startTime.setMinutes(Math.ceil(startTime.getMinutes() / 30) * 30, 0, 0);
  const endTime = new Date(startTime);
  endTime.setHours(endTime.getHours() + 1);

  return {
    title: '',
    description: '',
    location: '',
    startTime,
    endTime,
    isAllDay: false,
    calendarAccountId: defaultAccountId ?? '',
    recurrenceFrequency: 'none',
    recurrenceInterval: 1,
    recurrenceEndCondition: 'never',
    recurrenceCount: null,
    recurrenceUntil: null,
    recurrenceByDay: null,
    recurrenceByMonthDay: null,
    attendees: [],
  };
}

/**
 * Creates a form pre-populated from an existing CalendarEvent for editing.
 */
export function createFormFromEvent(event: CalendarEvent): EventFormData {
  const rule = event.recurrenceRule;
  return {
    title: event.title,
    description: event.description ?? '',
    location: event.location ?? '',
    startTime: new Date(event.startTime),
    endTime: new Date(event.endTime),
    isAllDay: event.isAllDay,
    calendarAccountId: event.calendarAccountId,
    recurrenceFrequency: rule?.frequency ?? 'none',
    recurrenceInterval: rule?.interval ?? 1,
    recurrenceEndCondition: rule
      ? rule.count != null
        ? 'count'
        : rule.until != null
          ? 'until'
          : 'never'
      : 'never',
    recurrenceCount: rule?.count ?? null,
    recurrenceUntil: rule?.until ? new Date(rule.until) : null,
    recurrenceByDay: rule?.byDay ?? null,
    recurrenceByMonthDay: rule?.byMonthDay ?? null,
    attendees: event.attendees ? [...event.attendees] : [],
  };
}

/**
 * Validates the event form data.
 * Returns a ValidationResult with field-level errors.
 */
export function validateEventForm(form: EventFormData): ValidationResult {
  const errors: ValidationErrors = {};

  // Title is required
  if (!form.title.trim()) {
    errors.title = 'Title is required';
  }

  // Calendar account is required
  if (!form.calendarAccountId) {
    errors.calendarAccountId = 'Please select a calendar';
  }

  // End time must be after start time (unless all-day)
  if (!form.isAllDay && form.endTime.getTime() <= form.startTime.getTime()) {
    errors.endTime = 'End time must be after start time';
  }

  // Validate recurrence count if applicable
  if (
    form.recurrenceFrequency !== 'none' &&
    form.recurrenceEndCondition === 'count'
  ) {
    if (form.recurrenceCount == null || form.recurrenceCount < 1) {
      errors.recurrenceCount = 'Occurrence count must be at least 1';
    }
  }

  // Validate recurrence until date if applicable
  if (
    form.recurrenceFrequency !== 'none' &&
    form.recurrenceEndCondition === 'until'
  ) {
    if (!form.recurrenceUntil) {
      errors.recurrenceUntil = 'End date is required';
    } else if (form.recurrenceUntil.getTime() <= form.startTime.getTime()) {
      errors.recurrenceUntil = 'End date must be after start time';
    }
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
  };
}

/**
 * Builds a CalendarEvent object from form data.
 * Used for both creating new events and updating existing ones.
 */
export function buildEventFromForm(
  form: EventFormData,
  existingEvent?: CalendarEvent,
): Partial<CalendarEvent> {
  const recurrenceRule = buildRecurrenceRule(form);

  const event: Partial<CalendarEvent> = {
    title: form.title.trim(),
    description: form.description.trim() || null,
    location: form.location.trim() || null,
    startTime: form.startTime,
    endTime: form.endTime,
    isAllDay: form.isAllDay,
    calendarAccountId: form.calendarAccountId,
    recurrenceRule: recurrenceRule,
    attendees: form.attendees,
    timeZone: existingEvent?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
  };

  if (existingEvent) {
    event.id = existingEvent.id;
    event.providerEventId = existingEvent.providerEventId;
    event.sequence = (existingEvent.sequence ?? 0) + 1;
  }

  return event;
}

/**
 * Builds a RecurrenceRule from the form's recurrence configuration.
 * Returns null if frequency is 'none'.
 */
export function buildRecurrenceRule(form: EventFormData): RecurrenceRule | null {
  if (form.recurrenceFrequency === 'none') return null;

  return {
    frequency: form.recurrenceFrequency,
    interval: Math.max(1, form.recurrenceInterval),
    count:
      form.recurrenceEndCondition === 'count'
        ? (form.recurrenceCount ?? 1)
        : null,
    until:
      form.recurrenceEndCondition === 'until'
        ? form.recurrenceUntil
        : null,
    bySecond: null,
    byMinute: null,
    byHour: null,
    byDay: form.recurrenceByDay ?? null,
    byMonthDay: form.recurrenceByMonthDay ?? null,
    byYearDay: null,
    byWeekNo: null,
    byMonth: null,
    bySetPos: null,
    wkst: 'MO',
    exceptions: [],
  };
}

/**
 * Builds event data for a single-instance exception of a recurring event.
 * Creates a new event with parentRecurringEventId and recurrenceExceptionDate set.
 * Requirement 3.5: edit single instance without modifying other occurrences.
 */
export function buildExceptionEvent(
  form: EventFormData,
  parentEvent: CalendarEvent,
  exceptionDate: Date,
): Partial<CalendarEvent> {
  const base = buildEventFromForm(form);
  return {
    ...base,
    id: undefined, // new event ID will be generated
    parentRecurringEventId: parentEvent.id,
    recurrenceExceptionDate: exceptionDate,
    recurrenceRule: null, // exceptions don't recur
  };
}

/**
 * Detects conflicts between the form's time range and existing events.
 * Uses the same overlap logic as the ConflictDetector: startA < endB AND startB < endA.
 * Also generates alternative time suggestions.
 *
 * Requirements: 7.2, 7.3
 */
export function detectFormConflicts(
  form: EventFormData,
  existingEvents: CalendarEvent[],
  editingEventId?: string,
): FormConflictResult {
  const formStart = form.startTime;
  const formEnd = form.endTime;
  const durationMs = formEnd.getTime() - formStart.getTime();

  // Filter out the event being edited and events from hidden calendars
  const candidates = existingEvents.filter(
    (e) => e.id !== editingEventId,
  );

  // Detect overlaps: startA < endB AND startB < endA
  const conflicts: Conflict[] = [];
  let conflictIdCounter = 0;

  const formAsEvent: CalendarEvent = {
    id: editingEventId ?? 'form-event',
    providerEventId: '',
    calendarAccountId: form.calendarAccountId,
    title: form.title || 'New Event',
    description: null,
    location: form.location || null,
    startTime: formStart,
    endTime: formEnd,
    timeZone: 'UTC',
    isAllDay: form.isAllDay,
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
  };

  for (const other of candidates) {
    if (
      formStart.getTime() < other.endTime.getTime() &&
      other.startTime.getTime() < formEnd.getTime()
    ) {
      const overlapStart = Math.max(formStart.getTime(), other.startTime.getTime());
      const overlapEnd = Math.min(formEnd.getTime(), other.endTime.getTime());
      const overlapMinutes = Math.round((overlapEnd - overlapStart) / 60000);

      conflicts.push({
        id: `form-conflict-${++conflictIdCounter}`,
        eventA: formAsEvent,
        eventB: other,
        overlapMinutes,
        travelTimeConflict: false,
      });
    }
  }

  // Generate alternative suggestions if conflicts exist
  const alternatives: TimeSlot[] = [];
  if (conflicts.length > 0) {
    const stepMs = 30 * 60 * 1000; // 30-minute steps
    const maxSearchMs = 7 * 24 * 60 * 60 * 1000; // 7 days
    let forwardMs = formStart.getTime() + stepMs;
    const maxForwardMs = formStart.getTime() + maxSearchMs;

    while (alternatives.length < 3 && forwardMs < maxForwardMs) {
      const candidateStart = new Date(forwardMs);
      const candidateEnd = new Date(forwardMs + durationMs);
      const hasConflict = candidates.some(
        (other) =>
          candidateStart.getTime() < other.endTime.getTime() &&
          other.startTime.getTime() < candidateEnd.getTime(),
      );
      if (!hasConflict) {
        alternatives.push({ start: candidateStart, end: candidateEnd });
      }
      forwardMs += stepMs;
    }
  }

  return { conflicts, alternatives };
}

/**
 * Checks whether an event is a recurring event (has a recurrence rule
 * or is a child of a recurring event).
 */
export function isRecurringEvent(event: CalendarEvent): boolean {
  return event.recurrenceRule != null || event.parentRecurringEventId != null;
}

/**
 * Gets the list of available calendar accounts for the account selector.
 * Filters to only active accounts.
 */
export function getActiveAccounts(accounts: CalendarAccount[]): CalendarAccount[] {
  return accounts.filter((a) => a.status === 'active');
}
