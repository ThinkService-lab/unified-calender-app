/**
 * Stripe-based payment service for web/PWA.
 * Uses Stripe Checkout for initial purchase and Stripe Billing for management.
 * Requirements: 10.2, 10.3, 10.5
 */

import type { SubscriptionTier } from '../types/subscription';
import type {
  PaymentService,
  ProductOffering,
  PurchaseResult,
  RestoreResult,
} from './paymentService';

/**
 * Stripe SDK abstraction so the real Stripe.js dependency can be injected
 * or mocked in tests.
 */
export interface StripeClient {
  redirectToCheckout(options: { sessionId: string }): Promise<{ error?: { message: string } }>;
}

/** HTTP client for backend calls */
export interface StripeHttpClient {
  post<T>(url: string, body: unknown): Promise<{ data: T }>;
  get<T>(url: string): Promise<{ data: T }>;
}

export interface StripePaymentServiceDeps {
  stripe: StripeClient;
  http: StripeHttpClient;
  userId: string;
}

/**
 * Creates a Stripe-backed PaymentService for web.
 */
export function createStripePaymentService(
  deps: StripePaymentServiceDeps,
): PaymentService {
  const { stripe, http, userId } = deps;

  async function getOfferings(): Promise<ProductOffering[]> {
    const { data } = await http.get<ProductOffering[]>('/subscriptions/offerings');
    return data;
  }

  async function purchase(productId: string): Promise<PurchaseResult> {
    try {
      // Create a Stripe Checkout session via backend
      const { data } = await http.post<{ sessionId: string; tier: SubscriptionTier }>(
        '/subscriptions/checkout',
        { productId, userId },
      );

      // Redirect to Stripe Checkout
      const { error } = await stripe.redirectToCheckout({ sessionId: data.sessionId });

      if (error) {
        return {
          success: false,
          tier: 'free',
          receiptId: null,
          expiresAt: null,
          error: error.message,
        };
      }

      // On success, Stripe redirects back; the webhook handles activation.
      // Return optimistic result for immediate UI update.
      return {
        success: true,
        tier: data.tier,
        receiptId: data.sessionId,
        expiresAt: null, // Will be confirmed via webhook
      };
    } catch (err) {
      return {
        success: false,
        tier: 'free',
        receiptId: null,
        expiresAt: null,
        error: err instanceof Error ? err.message : 'Purchase failed',
      };
    }
  }

  async function restorePurchases(): Promise<RestoreResult> {
    // Web subscriptions are managed server-side; query current status
    const { data } = await http.get<{ tier: SubscriptionTier; expiresAt: string | null }>(
      `/subscriptions/${userId}`,
    );
    return {
      tier: data.tier,
      expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
    };
  }

  async function getCurrentEntitlement(): Promise<SubscriptionTier> {
    const { data } = await http.get<{ tier: SubscriptionTier }>(
      `/subscriptions/${userId}`,
    );
    return data.tier;
  }

  return { getOfferings, purchase, restorePurchases, getCurrentEntitlement };
}
