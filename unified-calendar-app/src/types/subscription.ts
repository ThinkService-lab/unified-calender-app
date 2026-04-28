/**
 * Subscription and payment type definitions.
 * Requirements: 5.1
 */

/** Subscription tier levels */
export type SubscriptionTier = 'free' | 'pro' | 'team';

/** Features gated by subscription tier */
export type Feature =
  | 'unlimited_accounts'
  | 'ai_assistant'
  | 'conflict_detection'
  | 'advanced_privacy'
  | 'shared_views'
  | 'delegation';

export interface UserSubscription {
  userId: string;
  tier: SubscriptionTier;
  platform: 'app_store' | 'play_store' | 'stripe';
  receiptId: string;
  expiresAt: Date;
  gracePeriodEndsAt: Date | null;
  autoRenew: boolean;
  connectedAccountCount: number;
}
