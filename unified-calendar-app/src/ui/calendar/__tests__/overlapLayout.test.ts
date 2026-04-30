/**
 * Unit tests for the overlapping event layout algorithm.
 * Requirements: 2.5
 */

import { computeOverlapLayout, EventLayoutInfo } from '../overlapLayout';
import type { CalendarEvent } from '../../../types/models';

/** Helper to create a minimal CalendarEvent for testing. */
function makeEvent(
  id: string,
  startHour: number,
  startMin: number,
  endHour: number,
  endMin: number
): CalendarEvent {
  const base = new Date(2025, 0, 15); // Jan 15, 2025
  const startTime = new Date(base);
  startTime.setHours(startHour, startMin, 0, 0);
  const endTime = new Date(base);
  endTime.setHours(endHour, endMin, 0, 0);

  return {
    id,
    providerEventId: id,
    calendarAccountId: 'acc-1',
    title: `Event ${id}`,
    description: null,
    location: null,
    startTime,
    endTime,
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
  };
}

/** Helper to find layout info for a specific event by id. */
function findLayout(layouts: EventLayoutInfo[], id: string): EventLayoutInfo {
  const found = layouts.find((l) => l.event.id === id);
  if (!found) throw new Error(`Layout not found for event ${id}`);
  return found;
}

describe('computeOverlapLayout', () => {
  it('returns empty array for empty input', () => {
    expect(computeOverlapLayout([])).toEqual([]);
  });

  it('assigns column 0 and totalColumns 1 for a single event', () => {
    const events = [makeEvent('A', 9, 0, 10, 0)];
    const layouts = computeOverlapLayout(events);

    expect(layouts).toHaveLength(1);
    expect(layouts[0].column).toBe(0);
    expect(layouts[0].totalColumns).toBe(1);
  });

  it('assigns column 0 and totalColumns 1 for non-overlapping events', () => {
    const events = [
      makeEvent('A', 9, 0, 10, 0),
      makeEvent('B', 11, 0, 12, 0),
      makeEvent('C', 14, 0, 15, 0),
    ];
    const layouts = computeOverlapLayout(events);

    expect(layouts).toHaveLength(3);
    for (const layout of layouts) {
      expect(layout.column).toBe(0);
      expect(layout.totalColumns).toBe(1);
    }
  });

  it('assigns two columns for two overlapping events', () => {
    // A: 9:00-10:30, B: 10:00-11:00 → overlap
    const events = [
      makeEvent('A', 9, 0, 10, 30),
      makeEvent('B', 10, 0, 11, 0),
    ];
    const layouts = computeOverlapLayout(events);

    expect(layouts).toHaveLength(2);
    const layoutA = findLayout(layouts, 'A');
    const layoutB = findLayout(layouts, 'B');

    expect(layoutA.totalColumns).toBe(2);
    expect(layoutB.totalColumns).toBe(2);
    // They should be in different columns
    expect(layoutA.column).not.toBe(layoutB.column);
  });

  it('assigns three columns for three mutually overlapping events', () => {
    // All overlap: 9:00-11:00, 9:30-10:30, 10:00-11:30
    const events = [
      makeEvent('A', 9, 0, 11, 0),
      makeEvent('B', 9, 30, 10, 30),
      makeEvent('C', 10, 0, 11, 30),
    ];
    const layouts = computeOverlapLayout(events);

    expect(layouts).toHaveLength(3);
    const layoutA = findLayout(layouts, 'A');
    const layoutB = findLayout(layouts, 'B');
    const layoutC = findLayout(layouts, 'C');

    expect(layoutA.totalColumns).toBe(3);
    expect(layoutB.totalColumns).toBe(3);
    expect(layoutC.totalColumns).toBe(3);

    // All in distinct columns
    const columns = new Set([layoutA.column, layoutB.column, layoutC.column]);
    expect(columns.size).toBe(3);
  });

  it('groups chain-overlapping events into one cluster (A↔B, B↔C, not A↔C)', () => {
    // A: 9:00-10:00, B: 9:30-10:30, C: 10:15-11:00
    // A overlaps B, B overlaps C, but A does NOT overlap C
    const events = [
      makeEvent('A', 9, 0, 10, 0),
      makeEvent('B', 9, 30, 10, 30),
      makeEvent('C', 10, 15, 11, 0),
    ];
    const layouts = computeOverlapLayout(events);

    expect(layouts).toHaveLength(3);
    const layoutA = findLayout(layouts, 'A');
    const layoutB = findLayout(layouts, 'B');
    const layoutC = findLayout(layouts, 'C');

    // All should be in the same cluster (same totalColumns)
    expect(layoutA.totalColumns).toBe(layoutB.totalColumns);
    expect(layoutB.totalColumns).toBe(layoutC.totalColumns);

    // A and B must be in different columns (they overlap)
    expect(layoutA.column).not.toBe(layoutB.column);
    // B and C must be in different columns (they overlap)
    expect(layoutB.column).not.toBe(layoutC.column);
    // A and C can share a column since they don't overlap
  });

  it('treats event ending exactly when another starts as NOT overlapping (DTEND non-inclusive)', () => {
    // A: 9:00-10:00, B: 10:00-11:00 → NOT overlapping per RFC 5545
    const events = [
      makeEvent('A', 9, 0, 10, 0),
      makeEvent('B', 10, 0, 11, 0),
    ];
    const layouts = computeOverlapLayout(events);

    expect(layouts).toHaveLength(2);
    const layoutA = findLayout(layouts, 'A');
    const layoutB = findLayout(layouts, 'B');

    // Each should be in its own cluster with totalColumns 1
    expect(layoutA.totalColumns).toBe(1);
    expect(layoutB.totalColumns).toBe(1);
    expect(layoutA.column).toBe(0);
    expect(layoutB.column).toBe(0);
  });

  it('handles mixed overlapping and non-overlapping events', () => {
    // Cluster 1: A(9-10:30) overlaps B(10-11)
    // Cluster 2: C(13-14) alone
    const events = [
      makeEvent('A', 9, 0, 10, 30),
      makeEvent('B', 10, 0, 11, 0),
      makeEvent('C', 13, 0, 14, 0),
    ];
    const layouts = computeOverlapLayout(events);

    expect(layouts).toHaveLength(3);
    const layoutA = findLayout(layouts, 'A');
    const layoutB = findLayout(layouts, 'B');
    const layoutC = findLayout(layouts, 'C');

    expect(layoutA.totalColumns).toBe(2);
    expect(layoutB.totalColumns).toBe(2);
    expect(layoutC.totalColumns).toBe(1);
    expect(layoutC.column).toBe(0);
  });

  it('handles events passed in unsorted order', () => {
    // Pass events in reverse order — algorithm should sort internally
    const events = [
      makeEvent('C', 14, 0, 15, 0),
      makeEvent('A', 9, 0, 10, 30),
      makeEvent('B', 10, 0, 11, 0),
    ];
    const layouts = computeOverlapLayout(events);

    expect(layouts).toHaveLength(3);
    const layoutA = findLayout(layouts, 'A');
    const layoutB = findLayout(layouts, 'B');
    const layoutC = findLayout(layouts, 'C');

    expect(layoutA.totalColumns).toBe(2);
    expect(layoutB.totalColumns).toBe(2);
    expect(layoutC.totalColumns).toBe(1);
  });

  it('reuses columns when possible in chain overlaps', () => {
    // A: 9:00-10:00, B: 9:30-10:30, C: 10:15-11:00
    // A and C don't overlap, so C can reuse A's column
    const events = [
      makeEvent('A', 9, 0, 10, 0),
      makeEvent('B', 9, 30, 10, 30),
      makeEvent('C', 10, 15, 11, 0),
    ];
    const layouts = computeOverlapLayout(events);

    const layoutA = findLayout(layouts, 'A');
    const layoutC = findLayout(layouts, 'C');

    // A and C should share the same column (greedy reuse)
    expect(layoutA.column).toBe(layoutC.column);
  });

  it('sorts longer events first when start times are equal', () => {
    // Both start at 9:00, but A is longer (9-11) vs B (9-10)
    // A should get column 0 (placed first due to longer duration)
    const events = [
      makeEvent('B', 9, 0, 10, 0),
      makeEvent('A', 9, 0, 11, 0),
    ];
    const layouts = computeOverlapLayout(events);

    const layoutA = findLayout(layouts, 'A');
    const layoutB = findLayout(layouts, 'B');

    expect(layoutA.column).toBe(0);
    expect(layoutB.column).toBe(1);
    expect(layoutA.totalColumns).toBe(2);
    expect(layoutB.totalColumns).toBe(2);
  });

  it('returns all events in the output', () => {
    const events = [
      makeEvent('A', 8, 0, 9, 0),
      makeEvent('B', 9, 0, 10, 0),
      makeEvent('C', 9, 30, 10, 30),
      makeEvent('D', 12, 0, 13, 0),
      makeEvent('E', 12, 30, 13, 30),
    ];
    const layouts = computeOverlapLayout(events);

    expect(layouts).toHaveLength(5);
    const ids = layouts.map((l) => l.event.id).sort();
    expect(ids).toEqual(['A', 'B', 'C', 'D', 'E']);
  });

  it('assigns valid column values (0 <= column < totalColumns)', () => {
    const events = [
      makeEvent('A', 9, 0, 11, 0),
      makeEvent('B', 9, 30, 10, 30),
      makeEvent('C', 10, 0, 11, 30),
      makeEvent('D', 10, 15, 11, 0),
    ];
    const layouts = computeOverlapLayout(events);

    for (const layout of layouts) {
      expect(layout.column).toBeGreaterThanOrEqual(0);
      expect(layout.column).toBeLessThan(layout.totalColumns);
      expect(layout.totalColumns).toBeGreaterThanOrEqual(1);
    }
  });
});
