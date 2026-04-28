/**
 * Subscription-related types for receipt validation and platform integration.
 * Requirements: 10.1, 10.2, 10.3, 10.5, 10.6
 */

import type { SubscriptionTier } from '../types/subscription';

/** Receipt from a platform payment provider */
export interface PlatformReceipt {
  platform: 'app_store' | 'play_store' | 'stripe';
  receiptId: string;
}

/** Result of validating a receipt against the backend subscription service */
export interface SubscriptionValidation {
  tier: SubscriptionTier;
  expiresAt: Date;
  gracePeriodEndsAt: Date | null;
}
