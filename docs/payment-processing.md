# Payment Processing - Stripe + Mobile IAP

Sources:
- https://docs.stripe.com/payments/accept-a-payment
- https://docs.stripe.com/billing/subscriptions/overview
- https://www.revenuecat.com/docs/getting-started
- https://docs.expo.dev/versions/latest/sdk/in-app-purchases

## Architecture Overview
- **Mobile (iOS/Android)**: RevenueCat SDK wrapping Apple StoreKit + Google Play Billing
- **Web (PWA)**: Stripe Checkout + Stripe Billing for subscriptions
- **Backend**: Receipt validation via RevenueCat webhooks + Stripe webhooks

## Stripe (Web/PWA Subscriptions)

### Subscription Lifecycle
1. Create subscription → triggers `customer.subscription.created` event
2. Invoice generated with status `open` → customer has ~23 hours to pay
3. Payment succeeds → subscription `active`, invoice `paid`
4. Payment fails → subscription `incomplete` or `past_due`

### Subscription Statuses
| Status | Description |
|--------|-------------|
| `trialing` | In trial period, provision product |
| `active` | In good standing, payment succeeded |
| `incomplete` | First payment pending (23-hour window) |
| `incomplete_expired` | First payment failed after 23 hours |
| `past_due` | Latest invoice payment failed, retrying |
| `canceled` | Terminal state, no more billing |
| `unpaid` | Invoices still generated but not charged |
| `paused` | Trial ended without payment method |

### Key Webhook Events
- `invoice.paid` → Activate/maintain subscription features
- `invoice.payment_failed` → Start grace period, notify user
- `invoice.payment_action_required` → 3DS authentication needed
- `customer.subscription.updated` → Handle upgrades/downgrades
- `customer.subscription.deleted` → Revoke access

### Best Practices
- Use `payment_behavior: 'default_incomplete'` for handling failed payments
- Listen for webhook events rather than relying on redirect success URLs
- Use Stripe Checkout for hosted payment page (minimal frontend code)
- Support Apple Pay and Google Pay via Stripe (enabled in Dashboard)

## RevenueCat (Mobile IAP)

### Why RevenueCat
- Wraps Apple StoreKit and Google Play Billing APIs
- Server-side receipt validation
- Cross-platform subscription status
- Analytics and revenue tracking
- Handles sandbox vs production automatically

### Integration (React Native)
```typescript
import Purchases from 'react-native-purchases';

// Initialize on app launch
Purchases.configure({ apiKey: '<revenuecat_public_api_key>' });

// Check subscription status
const customerInfo = await Purchases.getCustomerInfo();
if (customerInfo.entitlements.active['pro']?.isActive) {
  // User has Pro tier
}

// Make a purchase
const { customerInfo } = await Purchases.purchasePackage(package);

// Restore purchases
const customerInfo = await Purchases.restorePurchases();
```

### Entitlements Mapping
| App Tier | RevenueCat Entitlement | Features |
|----------|----------------------|----------|
| Free | (none) | 3 accounts, basic view |
| Pro | `pro` | Unlimited accounts, AI, conflict detection, advanced privacy |
| Team | `team` | All Pro + shared views, delegation |

### Key Concepts
- **Products**: Configured in App Store Connect / Google Play Console
- **Entitlements**: Feature access levels (map to our subscription tiers)
- **Offerings**: Groups of products presented to users (current offering = active paywall)
- **CustomerInfo**: Contains all subscription/entitlement data, cached by SDK

### Webhook Events (RevenueCat → Backend)
- `INITIAL_PURCHASE` → Activate tier
- `RENEWAL` → Extend subscription
- `CANCELLATION` → Schedule downgrade at period end
- `BILLING_ISSUE` → Start 7-day grace period
- `SUBSCRIBER_ALIAS` → Handle cross-platform identity

## Unified Subscription Validation Flow
1. Mobile purchase → RevenueCat validates receipt → webhook to backend → update `user_subscription` table
2. Web purchase → Stripe Checkout → Stripe webhook to backend → update `user_subscription` table
3. App checks tier → `SubscriptionManager.getCurrentTier()` reads local cache → falls back to backend API
4. Grace period: 7 days after `BILLING_ISSUE` / `invoice.payment_failed` before downgrade to Free
