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
