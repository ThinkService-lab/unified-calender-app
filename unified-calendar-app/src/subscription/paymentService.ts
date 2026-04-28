/**
 * Platform-agnostic payment service interface.
 * Platform-specific implementations use .web.ts, .ios.ts, .android.ts extensions.
 * Requirements: 10.2, 10.3, 10.5
 */

import type { SubscriptionTier } from '../types/subscription';

/** Webhook event types from RevenueCat / Stripe */
export type WebhookEventType =
  | 'INITIAL_PURCHASE'
  | 'RENEWAL'
  | 'CANCELLATION'
  | 'BILLING_ISSUE';

/** Product offering presented to the user */
export interface ProductOffering {
  id: string;
  tier: SubscriptionTier;
  price: string;
  currency: string;
  period: 'monthly' | 'yearly';
}

/** Result of a purchase operation */
export interface PurchaseResult {
  success: boolean;
  tier: SubscriptionTier;
  receiptId: string | null;
  expiresAt: Date | null;
  error?: string;
}

/** Result of restoring previous purchases */
export interface RestoreResult {
  tier: SubscriptionTier;
  expiresAt: Date | null;
}

/** RevenueCat entitlement identifiers mapped to tiers */
export const ENTITLEMENT_MAP: Record<string, SubscriptionTier> = {
  pro: 'pro',
  team: 'team',
};

/**
 * Maps a RevenueCat entitlement ID to a SubscriptionTier.
 * Returns 'free' if no matching entitlement is found.
 */
export function mapEntitlementToTier(entitlementId: string | null): SubscriptionTier {
  if (!entitlementId) return 'free';
  return ENTITLEMENT_MAP[entitlementId] ?? 'free';
}

/**
 * Platform-agnostic payment service interface.
 * Each platform provides its own implementation.
 */
export interface PaymentService {
  /** Fetch available product offerings for the current platform */
  getOfferings(): Promise<ProductOffering[]>;

  /** Initiate a purchase for the given product */
  purchase(productId: string): Promise<PurchaseResult>;

  /** Restore previous purchases (mobile only, no-op on web) */
  restorePurchases(): Promise<RestoreResult>;

  /** Get the current subscription tier from the payment provider */
  getCurrentEntitlement(): Promise<SubscriptionTier>;
}
