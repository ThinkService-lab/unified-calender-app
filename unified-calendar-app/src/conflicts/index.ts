/**
 * Conflict detection module public API.
 * Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6
 */

export {
  createConflictDetector,
  hasTimeOverlap,
  calculateOverlapMinutes,
  checkTravelConflict,
} from './conflictDetector';
export type { ConflictDetector, Duration } from './conflictDetector';
