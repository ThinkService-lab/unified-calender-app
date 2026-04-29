/**
 * User data module — auth event logging, session activity, and account deletion.
 * Requirements: 13.4, 13.5, 13.6
 */

export {
  createUserDataService,
  MAX_DELETION_DAYS,
  RATE_LIMIT_WINDOW_MS,
  MAX_AUTH_ATTEMPTS_PER_WINDOW,
  MAX_AUTH_ATTEMPTS_PER_IP,
  type UserDataService,
  type UserDataServiceConfig,
  type DeletionStatus,
  type RateLimitResult,
} from './userDataService';
