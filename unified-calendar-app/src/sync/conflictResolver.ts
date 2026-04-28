/**
 * SyncConflictResolver — dedicated conflict resolution service for sync conflicts.
 * Manages conflicts where the same event was modified locally and remotely.
 * Never auto-resolves; always requires explicit user input.
 *
 * Requirements: 4.5, 6.5
 */

import type { DatabaseDriver } from '../db/database';
import type { SyncConflict, ConflictResolution } from './types';

/** State of a tracked conflict */
export type ConflictState = 'pending' | 'resolved';

/** A conflict with full event data and tracking state */
export interface TrackedConflict {
  conflict: SyncConflict;
  state: ConflictState;
  resolvedAt: Date | null;
  resolution: ConflictResolution | null;
}

/** Parsed event data from a conflict version for UI presentation */
export interface ConflictEventVersion {
  title?: string;
  description?: string | null;
  location?: string | null;
  startTime?: string;
  endTime?: string;
  [key: string]: unknown;
}

/** Detailed conflict info for user presentation */
export interface ConflictDetails {
  id: string;
  eventId: string;
  calendarAccountId: string;
  localVersion: ConflictEventVersion;
  remoteVersion: ConflictEventVersion;
  detectedAt: Date;
  state: ConflictState;
}

export interface SyncConflictResolver {
  /** Add a detected conflict for tracking. */
  addConflict(conflict: SyncConflict): void;

  /** Get all pending (unresolved) conflicts. */
  getPendingConflicts(): TrackedConflict[];

  /** Get all tracked conflicts regardless of state. */
  getAllConflicts(): TrackedConflict[];

  /** Get detailed conflict info with parsed versions for UI presentation. */
  getConflictDetails(conflictId: string): ConflictDetails | null;

  /**
   * Resolve a conflict. Never auto-resolves — caller must provide explicit resolution.
   * - 'keep_local': re-queues the local version for outbound push
   * - 'keep_remote': applies the remote version to local DB
   */
  resolveConflict(conflictId: string, resolution: ConflictResolution): Promise<void>;

  /** Check if there are any pending conflicts. */
  hasPendingConflicts(): boolean;

  /** Get count of pending conflicts. */
  pendingCount(): number;
}

/**
 * Parse a JSON-serialized version string into a ConflictEventVersion.
 * Returns an empty object if parsing fails.
 */
function parseVersion(versionJson: string): ConflictEventVersion {
  try {
    const parsed = JSON.parse(versionJson);
    if (typeof parsed === 'object' && parsed !== null) {
      return parsed as ConflictEventVersion;
    }
    return {};
  } catch {
    return {};
  }
}

export interface ConflictResolverConfig {
  db: DatabaseDriver;
  /** Callback to re-queue a local change for outbound sync */
  onRequeueLocal: (conflict: SyncConflict) => Promise<void>;
}

/**
 * Creates a SyncConflictResolver instance.
 */
export function createConflictResolver(config: ConflictResolverConfig): SyncConflictResolver {
  const { db, onRequeueLocal } = config;
  const tracked = new Map<string, TrackedConflict>();

  const resolver: SyncConflictResolver = {
    addConflict(conflict: SyncConflict): void {
      if (tracked.has(conflict.id)) return;
      tracked.set(conflict.id, {
        conflict,
        state: 'pending',
        resolvedAt: null,
        resolution: null,
      });
    },

    getPendingConflicts(): TrackedConflict[] {
      return Array.from(tracked.values()).filter((t) => t.state === 'pending');
    },

    getAllConflicts(): TrackedConflict[] {
      return Array.from(tracked.values());
    },

    getConflictDetails(conflictId: string): ConflictDetails | null {
      const entry = tracked.get(conflictId);
      if (!entry) return null;

      return {
        id: entry.conflict.id,
        eventId: entry.conflict.eventId,
        calendarAccountId: entry.conflict.calendarAccountId,
        localVersion: parseVersion(entry.conflict.localVersion),
        remoteVersion: parseVersion(entry.conflict.remoteVersion),
        detectedAt: entry.conflict.detectedAt,
        state: entry.state,
      };
    },

    async resolveConflict(conflictId: string, resolution: ConflictResolution): Promise<void> {
      const entry = tracked.get(conflictId);
      if (!entry || entry.state === 'resolved') return;

      const { conflict } = entry;

      if (resolution === 'keep_local') {
        // Re-queue the local version for outbound push
        await db.execute(
          `UPDATE events SET sync_status = 'pending_update' WHERE id = ?`,
          [conflict.eventId],
        );
        await onRequeueLocal(conflict);
      } else {
        // keep_remote — accept the remote version, mark event as synced
        await db.execute(
          `UPDATE events SET sync_status = 'synced', updated_at = ? WHERE id = ?`,
          [Date.now(), conflict.eventId],
        );
      }

      // Mark conflict as resolved
      entry.state = 'resolved';
      entry.resolvedAt = new Date();
      entry.resolution = resolution;
    },

    hasPendingConflicts(): boolean {
      for (const entry of tracked.values()) {
        if (entry.state === 'pending') return true;
      }
      return false;
    },

    pendingCount(): number {
      let count = 0;
      for (const entry of tracked.values()) {
        if (entry.state === 'pending') count++;
      }
      return count;
    },
  };

  return resolver;
}
