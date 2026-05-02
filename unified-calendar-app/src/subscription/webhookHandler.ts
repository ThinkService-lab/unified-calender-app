/**
 * Client-side webhook event handler.
 * Processes subscription lifecycle events received via push or polling
 * and updates the Zustand subscription store for immediate UI feedback.
 *
 * Security Review 2026-05-01: Finding H3 — Added HMAC-SHA256 signature
 * verification and timestamp-based replay protection.
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

/** Default timestamp tolerance: 5 minutes in milliseconds */
const DEFAULT_TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000;

/** Payload shape for webhook events arriving at the client */
export interface WebhookEventPayload {
  type: WebhookEventType;
  userId: string;
  tier: SubscriptionTier;
  expiresAt: string | null;
  platform: 'app_store' | 'play_store' | 'stripe';
}

/**
 * Security configuration for webhook signature verification.
 * Security Review 2026-05-01: Finding H3
 */
export interface WebhookSecurityConfig {
  /** HMAC-SHA256 signing secret shared with the webhook sender */
  signingSecret: string;
  /** Maximum age of a webhook event before it is rejected (replay protection). Default: 5 minutes */
  timestampToleranceMs?: number;
}

export interface WebhookHandlerDeps {
  store: StoreApi<SubscriptionState>;
  subscriptionManager: SubscriptionManager;
  /** Security config for signature verification. When omitted, verification is skipped (testing only). */
  security?: WebhookSecurityConfig;
}

export interface WebhookHandler {
  /** Process a single webhook event with signature verification */
  handleEvent(
    event: WebhookEventPayload,
    signature?: string,
    timestamp?: number,
  ): Promise<void>;
}

/**
 * Verify HMAC-SHA256 signature over `timestamp.payload`.
 * Returns true if the signature is valid.
 *
 * Security Review 2026-05-01: Finding H3
 */
export async function verifyWebhookSignature(
  payload: string,
  timestamp: number,
  signature: string,
  secret: string,
): Promise<boolean> {
  const encoder = new TextEncoder();
  const message = `${timestamp}.${payload}`;

  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const signatureBytes = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(message),
  );

  const expectedSignature = Array.from(new Uint8Array(signatureBytes))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  // Constant-time comparison to prevent timing attacks
  if (expectedSignature.length !== signature.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expectedSignature.length; i++) {
    mismatch |= expectedSignature.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return mismatch === 0;
}

/**
 * Verify that a timestamp is within the tolerance window.
 * Rejects events that are too old (replay protection).
 *
 * Security Review 2026-05-01: Finding H3
 */
export function verifyTimestamp(
  timestamp: number,
  toleranceMs: number = DEFAULT_TIMESTAMP_TOLERANCE_MS,
): boolean {
  const age = Math.abs(Date.now() - timestamp);
  return age <= toleranceMs;
}

/**
 * Creates a WebhookHandler that updates the subscription store
 * based on incoming webhook events.
 */
export function createWebhookHandler(deps: WebhookHandlerDeps): WebhookHandler {
  const { store, subscriptionManager, security } = deps;

  async function handleEvent(
    event: WebhookEventPayload,
    signature?: string,
    timestamp?: number,
  ): Promise<void> {
    // Security Review 2026-05-01: Finding H3 — verify signature and timestamp
    if (security) {
      if (!signature || timestamp === undefined) {
        throw new Error('Webhook signature and timestamp are required');
      }

      // Replay protection: reject stale events
      const toleranceMs = security.timestampToleranceMs ?? DEFAULT_TIMESTAMP_TOLERANCE_MS;
      if (!verifyTimestamp(timestamp, toleranceMs)) {
        throw new Error('Webhook event rejected: timestamp outside tolerance window');
      }

      // Signature verification
      const payload = JSON.stringify(event);
      const isValid = await verifyWebhookSignature(
        payload,
        timestamp,
        signature,
        security.signingSecret,
      );
      if (!isValid) {
        throw new Error('Webhook event rejected: invalid signature');
      }
    }

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
