/**
 * Authentication and user data service type definitions.
 * Requirements: 5.1
 */

/** Token health status for provider connections */
export type TokenHealthStatus = 'valid' | 'expired' | 'revoked' | 'unknown';

export interface AuthEvent {
  id: string;
  userId: string;
  eventType: 'login' | 'logout' | 'token_refresh' | 'token_revoked' | 'password_change';
  platform: 'ios' | 'android' | 'web';
  ipAddress: string;
  userAgent: string;
  timestamp: Date;
}

export interface DeletionReceipt {
  userId: string;
  requestedAt: Date;
  scheduledCompletionAt: Date;
  status: 'pending' | 'in_progress' | 'completed';
}
