/**
 * Client-side webhook event handler.
 * Processes subscription lifecycle events received via push or polling
 * and updates the Zustand subscription store for immediate UI feedback.
 *
 * Requirements: 10.2, 10.3, 10.5, 10.6
 */

import type { SubscriptionTier } from '../types/subscription';
import type { SubscriptionState } from '../stores/subscriptionStore';
import type { WebhookEventType } from './paymentService';
import type { SubscriptionManager } from './subscriptionManager';
import type { StoreApi } from 'zustand';

/** Grace period duration: 7 days in milliseconds */
const GRACE_PERIOD_MS = 7 * 24 * 60 * 60 * 1000;

/** Payload shape for webhook events arriving at the client */
export interface WebhookEventPayload {
  type: WebhookEventType;
  userId: string;
  tier: SubscriptionTier;
  expiresAt: string | null;
  platform: 'app_store' | 'play_store' | 'stripe';
}

export interface WebhookHandlerDeps {
  store: StoreApi<SubscriptionState>;
  subscriptionManager: SubscriptionManager;
}

export interface WebhookHandler {
  /** Process a single webhook event */
  handleEvent(event: WebhookEventPayload): Promise<void>;
}

/**
 * Creates a WebhookHandler that updates the subscription store
 * based on incoming webhook events.
 */
export function createWebhookHandler(deps: WebhookHandlerDeps): WebhookHandler {
  const { store, subscriptionManager } = deps;

  async function handleEvent(event: WebhookEventPayload): Promise<void> {
    switch (event.type) {
      case 'INITIAL_PURCHASE':
        return handleInitialPurchase(event);
      case 'RENEWAL':
        return handleRenewal(event);
      case 'CANCELLATION':
        return handleCancellation(event);
      case 'BILLING_ISSUE':
        return handleBillingIssue(event);
    }
  }

  function handleInitialPurchase(event: WebhookEventPayload): Promise<void> {
    // Optimistically upgrade tier and unlock features immediately
    store.getState().setSubscription({
      tier: event.tier,
      expiresAt: event.expiresAt ? new Date(event.expiresAt) : null,
      gracePeriodEndsAt: null,
      autoRenew: true,
      platform: event.platform,
    });
    return Promise.resolve();
  }

  function handleRenewal(event: WebhookEventPayload): Promise<void> {
    // Extend expiry, clear any grace period
    store.getState().setSubscription({
      tier: event.tier,
      expiresAt: event.expiresAt ? new Date(event.expiresAt) : null,
      gracePeriodEndsAt: null,
      autoRenew: true,
      platform: event.platform,
    });
    return Promise.resolve();
  }

  async function handleCancellation(event: WebhookEventPayload): Promise<void> {
    // Schedule downgrade at billing period end (not immediate)
    const expiresAt = event.expiresAt ? new Date(event.expiresAt) : null;

    store.getState().setSubscription({
      tier: event.tier,
      expiresAt,
      gracePeriodEndsAt: expiresAt, // Features remain until billing period ends
      autoRenew: false,
      platform: event.platform,
    });
  }

  function handleBillingIssue(event: WebhookEventPayload): Promise<void> {
    // Set 7-day grace period before restricting to free tier
    const gracePeriodEndsAt = new Date(Date.now() + GRACE_PERIOD_MS);
    const currentState = store.getState();

    store.getState().setSubscription({
      tier: currentState.tier, // Keep current tier during grace period
      expiresAt: event.expiresAt ? new Date(event.expiresAt) : currentState.expiresAt,
      gracePeriodEndsAt,
      autoRenew: false,
      platform: event.platform,
    });
    return Promise.resolve();
  }

  return { handleEvent };
}

export { GRACE_PERIOD_MS };
