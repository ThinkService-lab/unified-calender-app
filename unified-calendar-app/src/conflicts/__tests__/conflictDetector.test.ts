/**
 * Unit tests for ConflictDetector service.
 * Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6
 */

import { createConflictDetector, ConflictDetector } from '../conflictDetector';
import type { CalendarEvent } from '../../types';

function makeEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'event-1',
    providerEventId: 'provider-event-1',
    calendarAccountId: 'cal-1',
    title: 'Meeting',
    description: null,
    location: null,
    startTime: new Date('2025-01-15T10:00:00Z'),
    endTime: new Date('2025-01-15T11:00:00Z'),
    timeZone: 'UTC',
    isAllDay: false,
    recurrenceRule: null,
    recurrenceExceptionDate: null,
    parentRecurringEventId: null,
    organizer: null,
    attendees: [],
    sequence: 0,
    dtstamp: new Date('2025-01-15T09:00:00Z'),
    status: 'confirmed',
    visibility: null,
    opaqueFields: new Map(),
    syncStatus: 'synced',
    localVersion: 1,
    remoteEtag: null,
    modifiedBy: null,
    createdAt: new Date('2025-01-01T00:00:00Z'),
    updatedAt: new Date('2025-01-15T09:00:00Z'),
    ...overrides,
  };
}

describe('ConflictDetector', () => {
  let detector: ConflictDetector;

  beforeEach(() => {
    detector = createConflictDetector();
  });

  afterEach(() => {
    detector.stopContinuousScanning();
  });

  describe('detectConflicts', () => {
    it('detects overlapping events', () => {
      const eventA = makeEvent({
        id: 'a',
        startTime: new Date('2025-01-15T10:00:00Z'),
        endTime: new Date('2025-01-15T11:00:00Z'),
      });
      const eventB = makeEvent({
        id: 'b',
        startTime: new Date('2025-01-15T10:30:00Z'),
        endTime: new Date('2025-01-15T11:30:00Z'),
      });

      const conflicts = detector.detectConflicts(eventA, [eventA, eventB]);
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].eventA.id).toBe('a');
      expect(conflicts[0].eventB.id).toBe('b');
      expect(conflicts[0].overlapMinutes).toBe(30);
      expect(conflicts[0].travelTimeConflict).toBe(false);
    });

    it('returns no conflicts for non-overlapping events', () => {
      const eventA = makeEvent({
        id: 'a',
        startTime: new Date('2025-01-15T10:00:00Z'),
        endTime: new Date('2025-01-15T11:00:00Z'),
      });
      const eventB = makeEvent({
        id: 'b',
        startTime: new Date('2025-01-15T11:00:00Z'),
        endTime: new Date('2025-01-15T12:00:00Z'),
      });

      const conflicts = detector.detectConflicts(eventA, [eventA, eventB]);
      expect(conflicts).toHaveLength(0);
    });

    it('skips self-comparison', () => {
      const event = makeEvent({ id: 'a' });
      const conflicts = detector.detectConflicts(event, [event]);
      expect(conflicts).toHaveLength(0);
    });

    it('detects multiple conflicts', () => {
      const eventA = makeEvent({
        id: 'a',
        startTime: new Date('2025-01-15T10:00:00Z'),
        endTime: new Date('2025-01-15T12:00:00Z'),
      });
      const eventB = makeEvent({
        id: 'b',
        startTime: new Date('2025-01-15T10:30:00Z'),
        endTime: new Date('2025-01-15T11:00:00Z'),
      });
      const eventC = makeEvent({
        id: 'c',
        startTime: new Date('2025-01-15T11:30:00Z'),
        endTime: new Date('2025-01-15T12:30:00Z'),
      });

      const conflicts = detector.detectConflicts(eventA, [eventA, eventB, eventC]);
      expect(conflicts).toHaveLength(2);
    });

    it('handles adjacent events (end equals start) as non-overlapping', () => {
      const eventA = makeEvent({
        id: 'a',
        startTime: new Date('2025-01-15T10:00:00Z'),
        endTime: new Date('2025-01-15T11:00:00Z'),
      });
      const eventB = makeEvent({
        id: 'b',
        startTime: new Date('2025-01-15T11:00:00Z'),
        endTime: new Date('2025-01-15T12:00:00Z'),
      });

      const conflicts = detector.detectConflicts(eventA, [eventB]);
      expect(conflicts).toHaveLength(0);
    });

    it('detects fully contained event as conflict', () => {
      const outer = makeEvent({
        id: 'outer',
        startTime: new Date('2025-01-15T09:00:00Z'),
        endTime: new Date('2025-01-15T13:00:00Z'),
      });
      const inner = makeEvent({
        id: 'inner',
        startTime: new Date('2025-01-15T10:00:00Z'),
        endTime: new Date('2025-01-15T11:00:00Z'),
      });

      const conflicts = detector.detectConflicts(outer, [inner]);
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].overlapMinutes).toBe(60);
    });

    it('completes within 500ms for 1000 events (Req 7.1)', () => {
      const target = makeEvent({
        id: 'target',
        startTime: new Date('2025-06-15T12:00:00Z'),
        endTime: new Date('2025-06-15T13:00:00Z'),
      });

      const events: CalendarEvent[] = [];
      for (let i = 0; i < 1000; i++) {
        const startHour = i % 24;
        const dayOffset = Math.floor(i / 24);
        events.push(makeEvent({
          id: `event-${i}`,
          startTime: new Date(`2025-06-${String(1 + dayOffset).padStart(2, '0')}T${String(startHour).padStart(2, '0')}:00:00Z`),
          endTime: new Date(`2025-06-${String(1 + dayOffset).padStart(2, '0')}T${String(startHour).padStart(2, '0')}:30:00Z`),
        }));
      }

      const start = performance.now();
      detector.detectConflicts(target, events);
      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(500);
    });
  });

  describe('detectConflictsWithTravel', () => {
    it('detects travel-time conflict when gap < travel time', async () => {
      // Event A ends at 10:00, Event B starts at 10:10 — only 10 min gap
      // Different locations → 30 min travel time → conflict
      const eventA = makeEvent({
        id: 'a',
        startTime: new Date('2025-01-15T09:00:00Z'),
        endTime: new Date('2025-01-15T10:00:00Z'),
        location: 'Office A',
      });
      const eventB = makeEvent({
        id: 'b',
        startTime: new Date('2025-01-15T10:10:00Z'),
        endTime: new Date('2025-01-15T11:00:00Z'),
        location: 'Office B',
      });

      const conflicts = await detector.detectConflictsWithTravel(eventA, [eventB]);
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].travelTimeConflict).toBe(true);
      expect(conflicts[0].overlapMinutes).toBe(0);
    });

    it('no travel conflict when gap >= travel time', async () => {
      // Event A ends at 10:00, Event B starts at 10:45 — 45 min gap > 30 min travel
      const eventA = makeEvent({
        id: 'a',
        startTime: new Date('2025-01-15T09:00:00Z'),
        endTime: new Date('2025-01-15T10:00:00Z'),
        location: 'Office A',
      });
      const eventB = makeEvent({
        id: 'b',
        startTime: new Date('2025-01-15T10:45:00Z'),
        endTime: new Date('2025-01-15T11:30:00Z'),
        location: 'Office B',
      });

      const conflicts = await detector.detectConflictsWithTravel(eventA, [eventB]);
      expect(conflicts).toHaveLength(0);
    });

    it('no travel conflict when locations are the same', async () => {
      const eventA = makeEvent({
        id: 'a',
        startTime: new Date('2025-01-15T09:00:00Z'),
        endTime: new Date('2025-01-15T10:00:00Z'),
        location: 'Office A',
      });
      const eventB = makeEvent({
        id: 'b',
        startTime: new Date('2025-01-15T10:05:00Z'),
        endTime: new Date('2025-01-15T11:00:00Z'),
        location: 'Office A',
      });

      const conflicts = await detector.detectConflictsWithTravel(eventA, [eventB]);
      expect(conflicts).toHaveLength(0);
    });

    it('no travel conflict when locations are empty', async () => {
      const eventA = makeEvent({
        id: 'a',
        startTime: new Date('2025-01-15T09:00:00Z'),
        endTime: new Date('2025-01-15T10:00:00Z'),
      });
      const eventB = makeEvent({
        id: 'b',
        startTime: new Date('2025-01-15T10:05:00Z'),
        endTime: new Date('2025-01-15T11:00:00Z'),
      });

      const conflicts = await detector.detectConflictsWithTravel(eventA, [eventB]);
      expect(conflicts).toHaveLength(0);
    });

    it('reports time-overlap conflict (not travel) when events overlap', async () => {
      const eventA = makeEvent({
        id: 'a',
        startTime: new Date('2025-01-15T10:00:00Z'),
        endTime: new Date('2025-01-15T11:00:00Z'),
        location: 'Office A',
      });
      const eventB = makeEvent({
        id: 'b',
        startTime: new Date('2025-01-15T10:30:00Z'),
        endTime: new Date('2025-01-15T11:30:00Z'),
        location: 'Office B',
      });

      const conflicts = await detector.detectConflictsWithTravel(eventA, [eventB]);
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].travelTimeConflict).toBe(false);
      expect(conflicts[0].overlapMinutes).toBe(30);
    });

    it('detects both time-overlap and travel-time conflicts across multiple events', async () => {
      const eventA = makeEvent({
        id: 'a',
        startTime: new Date('2025-01-15T10:00:00Z'),
        endTime: new Date('2025-01-15T11:00:00Z'),
        location: 'Office A',
      });
      // Overlaps with A
      const eventB = makeEvent({
        id: 'b',
        startTime: new Date('2025-01-15T10:30:00Z'),
        endTime: new Date('2025-01-15T11:30:00Z'),
        location: 'Office B',
      });
      // Travel conflict with A (10 min gap, different location)
      const eventC = makeEvent({
        id: 'c',
        startTime: new Date('2025-01-15T11:10:00Z'),
        endTime: new Date('2025-01-15T12:00:00Z'),
        location: 'Office C',
      });

      const conflicts = await detector.detectConflictsWithTravel(eventA, [eventB, eventC]);
      expect(conflicts).toHaveLength(2);

      const timeOverlap = conflicts.find((c) => !c.travelTimeConflict);
      const travelConflict = conflicts.find((c) => c.travelTimeConflict);

      expect(timeOverlap).toBeDefined();
      expect(timeOverlap!.eventB.id).toBe('b');
      expect(travelConflict).toBeDefined();
      expect(travelConflict!.eventB.id).toBe('c');
    });
  });

  describe('suggestAlternatives', () => {
    it('suggests conflict-free slots', () => {
      const event = makeEvent({
        id: 'new',
        startTime: new Date('2025-01-15T10:00:00Z'),
        endTime: new Date('2025-01-15T11:00:00Z'),
      });
      const existing = makeEvent({
        id: 'existing',
        startTime: new Date('2025-01-15T10:00:00Z'),
        endTime: new Date('2025-01-15T11:00:00Z'),
      });

      const alternatives = detector.suggestAlternatives(event, [existing], 3);
      expect(alternatives.length).toBeGreaterThanOrEqual(1);
      expect(alternatives.length).toBeLessThanOrEqual(3);

      for (const slot of alternatives) {
        const overlaps =
          slot.start.getTime() < existing.endTime.getTime() &&
          existing.startTime.getTime() < slot.end.getTime();
        expect(overlaps).toBe(false);
      }
    });

    it('returns requested number of alternatives', () => {
      const event = makeEvent({ id: 'new' });
      const alternatives = detector.suggestAlternatives(event, [], 5);
      expect(alternatives).toHaveLength(5);
    });

    it('preserves event duration in suggestions', () => {
      const event = makeEvent({
        id: 'new',
        startTime: new Date('2025-01-15T10:00:00Z'),
        endTime: new Date('2025-01-15T11:30:00Z'), // 90 minutes
      });

      const alternatives = detector.suggestAlternatives(event, [], 2);
      for (const slot of alternatives) {
        const durationMs = slot.end.getTime() - slot.start.getTime();
        expect(durationMs).toBe(90 * 60 * 1000);
      }
    });

    it('searches both forward and backward', () => {
      const event = makeEvent({
        id: 'new',
        startTime: new Date('2025-01-15T10:00:00Z'),
        endTime: new Date('2025-01-15T11:00:00Z'),
      });

      const alternatives = detector.suggestAlternatives(event, [], 4);
      expect(alternatives).toHaveLength(4);

      const beforeOriginal = alternatives.filter(
        (s) => s.start.getTime() < event.startTime.getTime(),
      );
      const afterOriginal = alternatives.filter(
        (s) => s.start.getTime() > event.startTime.getTime(),
      );

      // Should have suggestions in both directions
      expect(beforeOriginal.length).toBeGreaterThanOrEqual(1);
      expect(afterOriginal.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('estimateTravelTime', () => {
    it('returns 0 for same location', async () => {
      const time = await detector.estimateTravelTime('Office A', 'Office A');
      expect(time).toBe(0);
    });

    it('returns 0 for empty locations', async () => {
      const time = await detector.estimateTravelTime('', '');
      expect(time).toBe(0);
    });

    it('returns positive duration for different locations', async () => {
      const time = await detector.estimateTravelTime('Office A', 'Office B');
      expect(time).toBeGreaterThan(0);
    });

    it('is case-insensitive for location comparison', async () => {
      const time = await detector.estimateTravelTime('office a', 'OFFICE A');
      expect(time).toBe(0);
    });
  });

  describe('continuous scanning', () => {
    it('fires onConflictDetected for overlapping events', (done) => {
      const eventA = makeEvent({
        id: 'a',
        startTime: new Date('2025-01-15T10:00:00Z'),
        endTime: new Date('2025-01-15T11:00:00Z'),
      });
      const eventB = makeEvent({
        id: 'b',
        startTime: new Date('2025-01-15T10:30:00Z'),
        endTime: new Date('2025-01-15T11:30:00Z'),
      });

      detector.onConflictDetected = (conflict) => {
        expect(conflict.overlapMinutes).toBe(30);
        detector.stopContinuousScanning();
        done();
      };

      detector.startContinuousScanning([eventA, eventB]);
    });

    it('does not fire for non-overlapping events', () => {
      const eventA = makeEvent({
        id: 'a',
        startTime: new Date('2025-01-15T10:00:00Z'),
        endTime: new Date('2025-01-15T11:00:00Z'),
      });
      const eventB = makeEvent({
        id: 'b',
        startTime: new Date('2025-01-15T12:00:00Z'),
        endTime: new Date('2025-01-15T13:00:00Z'),
      });

      const detected: any[] = [];
      detector.onConflictDetected = (conflict) => detected.push(conflict);
      detector.startContinuousScanning([eventA, eventB]);
      detector.stopContinuousScanning();

      expect(detected).toHaveLength(0);
    });

    it('stopContinuousScanning stops the scanning', () => {
      jest.useFakeTimers();
      const eventA = makeEvent({ id: 'a' });
      const eventB = makeEvent({
        id: 'b',
        startTime: new Date('2025-01-15T10:30:00Z'),
        endTime: new Date('2025-01-15T11:30:00Z'),
      });

      let callCount = 0;
      detector.onConflictDetected = () => { callCount++; };
      detector.startContinuousScanning([eventA, eventB]);

      const initialCount = callCount;
      detector.stopContinuousScanning();

      jest.advanceTimersByTime(30_000);
      expect(callCount).toBe(initialCount);

      jest.useRealTimers();
    });

    it('deduplicates — does not re-report known conflict pairs', () => {
      jest.useFakeTimers();
      const eventA = makeEvent({
        id: 'a',
        startTime: new Date('2025-01-15T10:00:00Z'),
        endTime: new Date('2025-01-15T11:00:00Z'),
      });
      const eventB = makeEvent({
        id: 'b',
        startTime: new Date('2025-01-15T10:30:00Z'),
        endTime: new Date('2025-01-15T11:30:00Z'),
      });

      const detected: any[] = [];
      detector.onConflictDetected = (conflict) => detected.push(conflict);
      detector.startContinuousScanning([eventA, eventB]);

      // Initial scan fires once
      expect(detected).toHaveLength(1);

      // Advance past several scan intervals
      jest.advanceTimersByTime(30_000);

      // Should still be 1 — same pair not re-reported
      expect(detected).toHaveLength(1);

      detector.stopContinuousScanning();
      jest.useRealTimers();
    });

    it('reports new conflicts when events are added between scans', () => {
      jest.useFakeTimers();
      const eventA = makeEvent({
        id: 'a',
        startTime: new Date('2025-01-15T10:00:00Z'),
        endTime: new Date('2025-01-15T11:00:00Z'),
      });
      const eventB = makeEvent({
        id: 'b',
        startTime: new Date('2025-01-15T12:00:00Z'),
        endTime: new Date('2025-01-15T13:00:00Z'),
      });

      const detected: any[] = [];
      detector.onConflictDetected = (conflict) => detected.push(conflict);

      // Start with non-overlapping events
      detector.startContinuousScanning([eventA, eventB]);
      expect(detected).toHaveLength(0);

      // Stop and restart with a new overlapping event
      detector.stopContinuousScanning();

      const eventC = makeEvent({
        id: 'c',
        startTime: new Date('2025-01-15T10:30:00Z'),
        endTime: new Date('2025-01-15T11:30:00Z'),
      });

      detector.startContinuousScanning([eventA, eventB, eventC]);
      // Should detect A↔C conflict
      expect(detected).toHaveLength(1);
      expect(detected[0].eventA.id).toBe('a');
      expect(detected[0].eventB.id).toBe('c');

      detector.stopContinuousScanning();
      jest.useRealTimers();
    });

    it('each createConflictDetector instance has independent conflict IDs', () => {
      const detector1 = createConflictDetector();
      const detector2 = createConflictDetector();

      const eventA = makeEvent({
        id: 'a',
        startTime: new Date('2025-01-15T10:00:00Z'),
        endTime: new Date('2025-01-15T11:00:00Z'),
      });
      const eventB = makeEvent({
        id: 'b',
        startTime: new Date('2025-01-15T10:30:00Z'),
        endTime: new Date('2025-01-15T11:30:00Z'),
      });

      const conflicts1 = detector1.detectConflicts(eventA, [eventB]);
      const conflicts2 = detector2.detectConflicts(eventA, [eventB]);

      // IDs should be different (not shared counter)
      expect(conflicts1[0].id).not.toBe(conflicts2[0].id);

      detector1.stopContinuousScanning();
      detector2.stopContinuousScanning();
    });
  });
});
