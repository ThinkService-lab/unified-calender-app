/**
 * RevenueCat-based payment service for Android (Google Play Billing).
 * Shares the same RevenueCat abstraction as iOS with platform-specific config.
 * Requirements: 10.2, 10.3, 10.5
 */

import type { PaymentService } from './paymentService';
import type { RevenueCatPaymentServiceDeps } from './paymentService.ios';
import { createRevenueCatPaymentService } from './paymentService.ios';

export type { RevenueCatPaymentServiceDeps };

/**
 * Creates a RevenueCat-backed PaymentService for Android.
 * The RevenueCat SDK handles Google Play Billing differences internally,
 * so the implementation is identical to iOS.
 */
export function createAndroidPaymentService(
  deps: RevenueCatPaymentServiceDeps,
): PaymentService {
  return createRevenueCatPaymentService(deps);
}
