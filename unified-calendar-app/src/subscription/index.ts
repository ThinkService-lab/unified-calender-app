/**
 * Subscription module re-exports.
 */

export { createSubscriptionManager, GRACE_PERIOD_MS, FREE_TIER_MAX_ACCOUNTS } from './subscriptionManager';
export type { SubscriptionManager, SubscriptionManagerDeps, HttpClient } from './subscriptionManager';
export type { PlatformReceipt, SubscriptionValidation } from './types';

// Payment service interface and utilities
export type { PaymentService, ProductOffering, PurchaseResult, RestoreResult, WebhookEventType } from './paymentService';
export { ENTITLEMENT_MAP, mapEntitlementToTier } from './paymentService';

// Webhook handler
export { createWebhookHandler, GRACE_PERIOD_MS as WEBHOOK_GRACE_PERIOD_MS } from './webhookHandler';
export type { WebhookHandler, WebhookEventPayload, WebhookHandlerDeps } from './webhookHandler';

// Account limit enforcement
export { createAccountLimitEnforcer } from './accountLimitEnforcer';
export type { AccountLimitEnforcer, AccountLimitEnforcerDeps, AccountLimitResult } from './accountLimitEnforcer';

// Feature unlock poller (ensures 10-second unlock SLA after payment)
export { pollForFeatureUnlock, MAX_POLL_DURATION_MS, POLL_INTERVAL_MS } from './featureUnlockPoller';
export type { FeatureUnlockPollerDeps, FeatureUnlockResult, SubscriptionResponse } from './featureUnlockPoller';
// Subscription HTTP client (production wiring for the bootstrap's
// `subscriptionHttpClient` option; Security Review 2026-05-02 L4 follow-up)
export {
  createSubscriptionHttpClient,
  SUBSCRIPTION_DEFAULT_TIMEOUT_MS,
  SUBSCRIPTION_MIN_TIMEOUT_MS,
  SUBSCRIPTION_MAX_TIMEOUT_MS,
} from './subscriptionHttpClient';
export type {
  SubscriptionHttpClient,
  SubscriptionHttpClientOptions,
  SessionTokenGetter,
} from './subscriptionHttpClient';
