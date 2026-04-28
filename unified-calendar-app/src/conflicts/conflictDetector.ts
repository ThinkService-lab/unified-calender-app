/**
 * ConflictDetector service implementation.
 * Detects scheduling conflicts across calendars and suggests alternatives.
 * Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6
 */

import type { CalendarEvent, Conflict, TimeSlot } from '../types';

/** Duration in milliseconds */
export type Duration = number;

export interface ConflictDetector {
  detectConflicts(event: CalendarEvent, allEvents: CalendarEvent[]): Conflict[];
  detectConflictsWithTravel(event: CalendarEvent, allEvents: CalendarEvent[]): Promise<Conflict[]>;
  suggestAlternatives(event: CalendarEvent, allEvents: CalendarEvent[], count: number): TimeSlot[];
  estimateTravelTime(from: string, to: string): Promise<Duration>;
  startContinuousScanning(allEvents: CalendarEvent[]): void;
  stopContinuousScanning(): void;
  onConflictDetected: ((conflict: Conflict) => void) | null;
}

/**
 * Check if two time ranges overlap: startA < endB AND startB < endA
 */
function hasTimeOverlap(startA: Date, endA: Date, startB: Date, endB: Date): boolean {
  return startA.getTime() < endB.getTime() && startB.getTime() < endA.getTime();
}

/**
 * Calculate overlap in minutes between two time ranges.
 */
function calculateOverlapMinutes(startA: Date, endA: Date, startB: Date, endB: Date): number {
  const overlapStart = Math.max(startA.getTime(), startB.getTime());
  const overlapEnd = Math.min(endA.getTime(), endB.getTime());
  const overlapMs = Math.max(0, overlapEnd - overlapStart);
  return Math.round(overlapMs / 60000);
}

/**
 * Simple travel time estimation based on location strings.
 * Uses a heuristic: if locations differ, estimate 30 minutes.
 * If either location is null/empty, no travel time needed.
 */
async function defaultEstimateTravelTime(from: string, to: string): Promise<Duration> {
  if (!from || !to) return 0;
  if (from.toLowerCase().trim() === to.toLowerCase().trim()) return 0;
  // Default heuristic: 30 minutes for different locations
  return 30 * 60 * 1000;
}

/**
 * Check if two events have a travel-time conflict.
 * Events are ordered by start time. A travel conflict exists when
 * the gap between the end of the earlier event and the start of the
 * later event is less than the estimated travel time between their locations.
 */
async function checkTravelConflict(
  eventA: CalendarEvent,
  eventB: CalendarEvent,
  estimateFn: (from: string, to: string) => Promise<Duration>,
): Promise<{ isTravelConflict: boolean; gapMs: number; travelTimeMs: number }> {
  const locA = eventA.location || '';
  const locB = eventB.location || '';

  if (!locA || !locB) {
    return { isTravelConflict: false, gapMs: 0, travelTimeMs: 0 };
  }

  const travelTimeMs = await estimateFn(locA, locB);
  if (travelTimeMs === 0) {
    return { isTravelConflict: false, gapMs: 0, travelTimeMs: 0 };
  }

  // Order events chronologically
  const [earlier, later] = eventA.endTime.getTime() <= eventB.startTime.getTime()
    ? [eventA, eventB]
    : [eventB, eventA];

  const gapMs = later.startTime.getTime() - earlier.endTime.getTime();

  // Only check travel conflict for non-overlapping or adjacent events
  // (overlapping events already have a time-overlap conflict)
  if (gapMs < 0) {
    return { isTravelConflict: false, gapMs, travelTimeMs };
  }

  return {
    isTravelConflict: gapMs < travelTimeMs,
    gapMs,
    travelTimeMs,
  };
}

/**
 * Creates a ConflictDetector service.
 */
export function createConflictDetector(): ConflictDetector {
  let scanningInterval: ReturnType<typeof setInterval> | null = null;
  let scanningEvents: CalendarEvent[] = [];
  /** Track known conflict pairs to avoid re-reporting in continuous scanning */
  let knownConflictPairs: Set<string> = new Set();
  let conflictIdCounter = 0;
  /** Instance-unique seed to avoid ID collisions across detector instances */
  const instanceSeed = Math.random().toString(36).slice(2, 8);

  function generateConflictId(): string {
    return `conflict-${instanceSeed}-${Date.now()}-${++conflictIdCounter}`;
  }

  /** Create a stable key for a pair of event IDs (order-independent) */
  function conflictPairKey(idA: string, idB: string): string {
    return idA < idB ? `${idA}::${idB}` : `${idB}::${idA}`;
  }

  const detector: ConflictDetector = {
    /**
     * Detect time overlap conflicts between an event and all other events.
     * Overlap condition: startA < endB AND startB < endA
     * Requirement 7.1: completes within 500ms
     */
    detectConflicts(event: CalendarEvent, allEvents: CalendarEvent[]): Conflict[] {
      const conflicts: Conflict[] = [];

      for (const other of allEvents) {
        if (other.id === event.id) continue;

        if (hasTimeOverlap(event.startTime, event.endTime, other.startTime, other.endTime)) {
          const overlapMinutes = calculateOverlapMinutes(
            event.startTime, event.endTime,
            other.startTime, other.endTime,
          );

          conflicts.push({
            id: generateConflictId(),
            eventA: event,
            eventB: other,
            overlapMinutes,
            travelTimeConflict: false,
          });
        }
      }

      return conflicts;
    },

    /**
     * Detect both time-overlap AND travel-time conflicts (Req 7.4).
     * For non-overlapping consecutive events with different locations,
     * flags a travel-time conflict when gap < estimated travel time.
     */
    async detectConflictsWithTravel(event: CalendarEvent, allEvents: CalendarEvent[]): Promise<Conflict[]> {
      const conflicts: Conflict[] = [];

      for (const other of allEvents) {
        if (other.id === event.id) continue;

        const isTimeOverlap = hasTimeOverlap(
          event.startTime, event.endTime,
          other.startTime, other.endTime,
        );

        if (isTimeOverlap) {
          const overlapMinutes = calculateOverlapMinutes(
            event.startTime, event.endTime,
            other.startTime, other.endTime,
          );
          conflicts.push({
            id: generateConflictId(),
            eventA: event,
            eventB: other,
            overlapMinutes,
            travelTimeConflict: false,
          });
        } else {
          // Check travel-time conflict for non-overlapping events
          const travel = await checkTravelConflict(event, other, defaultEstimateTravelTime);
          if (travel.isTravelConflict) {
            conflicts.push({
              id: generateConflictId(),
              eventA: event,
              eventB: other,
              overlapMinutes: 0,
              travelTimeConflict: true,
            });
          }
        }
      }

      return conflicts;
    },

    /**
     * Suggest alternative time slots that don't conflict with any existing events.
     * Requirement 7.3: suggest at least one conflict-free slot.
     * Searches both forward and backward from the event's start time.
     */
    suggestAlternatives(event: CalendarEvent, allEvents: CalendarEvent[], count: number): TimeSlot[] {
      const durationMs = event.endTime.getTime() - event.startTime.getTime();
      const suggestions: TimeSlot[] = [];

      const otherEvents = allEvents.filter((e) => e.id !== event.id);

      const searchStartMs = event.startTime.getTime();
      const maxForwardMs = searchStartMs + 7 * 24 * 60 * 60 * 1000; // 7 days ahead
      const maxBackwardMs = searchStartMs - 7 * 24 * 60 * 60 * 1000; // 7 days behind
      const stepMs = 30 * 60 * 1000; // 30-minute steps

      // Interleave forward and backward search for better suggestions
      let forwardMs = searchStartMs + stepMs;
      let backwardMs = searchStartMs - stepMs;

      while (suggestions.length < count && (forwardMs < maxForwardMs || backwardMs > maxBackwardMs)) {
        // Try forward
        if (forwardMs < maxForwardMs) {
          const candidateStart = new Date(forwardMs);
          const candidateEnd = new Date(forwardMs + durationMs);
          const hasConflict = otherEvents.some((other) =>
            hasTimeOverlap(candidateStart, candidateEnd, other.startTime, other.endTime),
          );
          if (!hasConflict) {
            suggestions.push({ start: candidateStart, end: candidateEnd });
          }
          forwardMs += stepMs;
        }

        if (suggestions.length >= count) break;

        // Try backward
        if (backwardMs > maxBackwardMs) {
          const candidateStart = new Date(backwardMs);
          const candidateEnd = new Date(backwardMs + durationMs);
          const hasConflict = otherEvents.some((other) =>
            hasTimeOverlap(candidateStart, candidateEnd, other.startTime, other.endTime),
          );
          if (!hasConflict) {
            suggestions.push({ start: candidateStart, end: candidateEnd });
          }
          backwardMs -= stepMs;
        }
      }

      return suggestions;
    },

    /**
     * Estimate travel time between two locations.
     * Requirement 7.4: account for travel time between events with different locations.
     */
    async estimateTravelTime(from: string, to: string): Promise<Duration> {
      return defaultEstimateTravelTime(from, to);
    },

    /**
     * Start continuous background scanning for conflicts.
     * Requirement 7.5, 7.6: continuous scanning, notify within 60 seconds.
     * Scans every 10 seconds. Only fires onConflictDetected for NEW conflicts
     * (deduplicates by event pair to avoid re-reporting known conflicts).
     */
    startContinuousScanning(allEvents: CalendarEvent[]): void {
      detector.stopContinuousScanning();
      scanningEvents = [...allEvents];
      knownConflictPairs = new Set();

      const scan = () => {
        for (let i = 0; i < scanningEvents.length; i++) {
          for (let j = i + 1; j < scanningEvents.length; j++) {
            const eventA = scanningEvents[i];
            const eventB = scanningEvents[j];

            if (hasTimeOverlap(eventA.startTime, eventA.endTime, eventB.startTime, eventB.endTime)) {
              const pairKey = conflictPairKey(eventA.id, eventB.id);

              // Only fire for new conflicts
              if (!knownConflictPairs.has(pairKey)) {
                knownConflictPairs.add(pairKey);

                const overlapMinutes = calculateOverlapMinutes(
                  eventA.startTime, eventA.endTime,
                  eventB.startTime, eventB.endTime,
                );

                const conflict: Conflict = {
                  id: generateConflictId(),
                  eventA,
                  eventB,
                  overlapMinutes,
                  travelTimeConflict: false,
                };

                if (detector.onConflictDetected) {
                  detector.onConflictDetected(conflict);
                }
              }
            }
          }
        }
      };

      // Run initial scan immediately
      scan();

      // Then scan every 10 seconds (well within the 60-second requirement)
      scanningInterval = setInterval(scan, 10_000);
    },

    /**
     * Stop continuous background scanning.
     */
    stopContinuousScanning(): void {
      if (scanningInterval !== null) {
        clearInterval(scanningInterval);
        scanningInterval = null;
      }
      scanningEvents = [];
      knownConflictPairs = new Set();
    },

    onConflictDetected: null,
  };

  return detector;
}

// Export helpers for testing
export { hasTimeOverlap, calculateOverlapMinutes, defaultEstimateTravelTime, checkTravelConflict };
