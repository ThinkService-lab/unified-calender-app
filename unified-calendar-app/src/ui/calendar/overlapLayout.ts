/**
 * Overlap layout algorithm for positioning time-overlapping events side by side.
 * Requirements: 2.5
 *
 * Algorithm:
 * 1. Sort events by start time, then by duration (longer first).
 * 2. Group events into "overlap clusters" — sets of events that transitively overlap.
 * 3. Within each cluster, assign column positions using a greedy approach.
 * 4. Return layout info with column index and total columns for width calculation.
 *
 * DTEND is non-inclusive per RFC 5545: an event ending at 10:00 does NOT overlap
 * with an event starting at 10:00.
 */

import type { CalendarEvent } from '../../types/models';

export interface EventLayoutInfo {
  event: CalendarEvent;
  /** 0-based column position within the overlap group */
  column: number;
  /** Total number of columns in this overlap group */
  totalColumns: number;
}

/**
 * Returns true if two events overlap in time.
 * Uses strict less-than because DTEND is non-inclusive (RFC 5545).
 */
function eventsOverlap(a: CalendarEvent, b: CalendarEvent): boolean {
  return a.startTime.getTime() < b.endTime.getTime()
    && b.startTime.getTime() < a.endTime.getTime();
}

/**
 * Groups events into overlap clusters. Two events are in the same cluster
 * if they transitively overlap (A overlaps B, B overlaps C → A, B, C in one cluster).
 */
function buildOverlapClusters(sortedEvents: CalendarEvent[]): CalendarEvent[][] {
  if (sortedEvents.length === 0) return [];

  const clusters: CalendarEvent[][] = [];
  let currentCluster: CalendarEvent[] = [sortedEvents[0]];
  // Track the latest end time in the current cluster
  let clusterEnd = sortedEvents[0].endTime.getTime();

  for (let i = 1; i < sortedEvents.length; i++) {
    const event = sortedEvents[i];
    // If this event starts before the cluster's latest end, it belongs to the cluster
    if (event.startTime.getTime() < clusterEnd) {
      currentCluster.push(event);
      clusterEnd = Math.max(clusterEnd, event.endTime.getTime());
    } else {
      // Start a new cluster
      clusters.push(currentCluster);
      currentCluster = [event];
      clusterEnd = event.endTime.getTime();
    }
  }
  clusters.push(currentCluster);

  return clusters;
}

/**
 * Assigns column positions within a cluster using a greedy algorithm.
 * For each event (in sorted order), find the lowest column where it doesn't
 * overlap with any already-placed event in that column.
 */
function assignColumns(cluster: CalendarEvent[]): Map<string, number> {
  // columns[col] = list of events placed in that column
  const columns: CalendarEvent[][] = [];
  const assignment = new Map<string, number>();

  for (const event of cluster) {
    let placed = false;
    for (let col = 0; col < columns.length; col++) {
      // Check if event overlaps with any event already in this column
      const hasConflict = columns[col].some((placed) => eventsOverlap(event, placed));
      if (!hasConflict) {
        columns[col].push(event);
        assignment.set(event.id, col);
        placed = true;
        break;
      }
    }
    if (!placed) {
      // Need a new column
      columns.push([event]);
      assignment.set(event.id, columns.length - 1);
    }
  }

  return assignment;
}

/**
 * Computes the overlap layout for a list of calendar events.
 *
 * @param events - The events to lay out (typically for a single day)
 * @returns An array of EventLayoutInfo with column positions and total columns
 */
export function computeOverlapLayout(events: CalendarEvent[]): EventLayoutInfo[] {
  if (events.length === 0) return [];

  // Sort by start time ascending, then by duration descending (longer events first)
  const sorted = [...events].sort((a, b) => {
    const startDiff = a.startTime.getTime() - b.startTime.getTime();
    if (startDiff !== 0) return startDiff;
    // Longer duration first
    const durationA = a.endTime.getTime() - a.startTime.getTime();
    const durationB = b.endTime.getTime() - b.startTime.getTime();
    return durationB - durationA;
  });

  const clusters = buildOverlapClusters(sorted);
  const result: EventLayoutInfo[] = [];

  for (const cluster of clusters) {
    const columnAssignment = assignColumns(cluster);
    const totalColumns = Math.max(...Array.from(columnAssignment.values())) + 1;

    for (const event of cluster) {
      result.push({
        event,
        column: columnAssignment.get(event.id)!,
        totalColumns,
      });
    }
  }

  return result;
}
