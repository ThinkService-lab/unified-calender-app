/**
 * Unit tests for PaymentService interface, entitlement mapping,
 * and platform-specific implementations.
 * Requirements: 10.2, 10.3, 10.5
 */

import { mapEntitlementToTier, ENTITLEMENT_MAP } from '../paymentService';
import type { PurchaseResult } from '../paymentService';
import { createStripePaymentService } from '../paymentService.web';
import type { StripeClient, StripeHttpClient } from '../paymentService.web';
import { createRevenueCatPaymentService } from '../paymentService.ios';
import type { RevenueCatClient, RevenueCatCustomerInfo } from '../paymentService.ios';

// ── Helpers ───────────────────────────────────────────────────────────

function createMockStripe(overrides?: Partial<StripeClient>): StripeClient {
  return {
    redirectToCheckout: jest.fn().mockResolvedValue({}),
    ...overrides,
  };
}

function createMockStripeHttp(overrides?: Partial<StripeHttpClient>): StripeHttpClient {
  return {
    post: jest.fn().mockResolvedValue({ data: {} }),
    get: jest.fn().mockResolvedValue({ data: {} }),
    ...overrides,
  };
}

function makeCustomerInfo(
  activeEntitlements: Record<string, { isActive: boolean; expirationDate: string | null }> = {},
): RevenueCatCustomerInfo {
  return {
    entitlements: { active: activeEntitlements },
    originalAppUserId: 'rc_user_123',
  };
}

function createMockRevenueCat(overrides?: Partial<RevenueCatClient>): RevenueCatClient {
  return {
    getOfferings: jest.fn().mockResolvedValue({ current: null }),
    purchasePackage: jest.fn().mockResolvedValue({ customerInfo: makeCustomerInfo() }),
    restorePurchases: jest.fn().mockResolvedValue(makeCustomerInfo()),
    getCustomerInfo: jest.fn().mockResolvedValue(makeCustomerInfo()),
    ...overrides,
  };
}

// ── Entitlement mapping ───────────────────────────────────────────────

describe('mapEntitlementToTier', () => {
  it('maps "pro" entitlement to pro tier', () => {
    expect(mapEntitlementToTier('pro')).toBe('pro');
  });

  it('maps "team" entitlement to team tier', () => {
    expect(mapEntitlementToTier('team')).toBe('team');
  });

  it('returns free for null entitlement', () => {
    expect(mapEntitlementToTier(null)).toBe('free');
  });

  it('returns free for unknown entitlement', () => {
    expect(mapEntitlementToTier('enterprise')).toBe('free');
  });
});

describe('ENTITLEMENT_MAP', () => {
  it('contains pro and team entries', () => {
    expect(ENTITLEMENT_MAP).toEqual({ pro: 'pro', team: 'team' });
  });
});

// ── Stripe web payment service ────────────────────────────────────────

describe('StripePaymentService (web)', () => {
  describe('getOfferings', () => {
    it('fetches offerings from backend', async () => {
      const offerings = [
        { id: 'price_pro_monthly', tier: 'pro', price: '$9.99', currency: 'USD', period: 'monthly' },
      ];
      const http = createMockStripeHttp({
        get: jest.fn().mockResolvedValue({ data: offerings }),
      });
      const service = createStripePaymentService({
        stripe: createMockStripe(),
        http,
        userId: 'user-1',
      });

      const result = await service.getOfferings();
      expect(result).toEqual(offerings);
      expect(http.get).toHaveBeenCalledWith('/subscriptions/offerings');
    });
  });

  describe('purchase', () => {
    it('creates checkout session and redirects', async () => {
      const stripe = createMockStripe({
        redirectToCheckout: jest.fn().mockResolvedValue({}),
      });
      const http = createMockStripeHttp({
        post: jest.fn().mockResolvedValue({
          data: { sessionId: 'cs_123', tier: 'pro' },
        }),
      });
      const service = createStripePaymentService({ stripe, http, userId: 'user-1' });

      const result = await service.purchase('price_pro_monthly');

      expect(http.post).toHaveBeenCalledWith('/subscriptions/checkout', {
        productId: 'price_pro_monthly',
        userId: 'user-1',
      });
      expect(stripe.redirectToCheckout).toHaveBeenCalledWith({ sessionId: 'cs_123' });
      expect(result.success).toBe(true);
      expect(result.tier).toBe('pro');
    });

    it('returns error when Stripe redirect fails', async () => {
      const stripe = createMockStripe({
        redirectToCheckout: jest.fn().mockResolvedValue({
          error: { message: 'Card declined' },
        }),
      });
      const http = createMockStripeHttp({
        post: jest.fn().mockResolvedValue({
          data: { sessionId: 'cs_123', tier: 'pro' },
        }),
      });
      const service = createStripePaymentService({ stripe, http, userId: 'user-1' });

      const result = await service.purchase('price_pro_monthly');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Card declined');
    });

    it('handles network errors gracefully', async () => {
      const http = createMockStripeHttp({
        post: jest.fn().mockRejectedValue(new Error('Network error')),
      });
      const service = createStripePaymentService({
        stripe: createMockStripe(),
        http,
        userId: 'user-1',
      });

      const result = await service.purchase('price_pro_monthly');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Network error');
    });
  });

  describe('restorePurchases', () => {
    it('queries backend for current subscription', async () => {
      const http = createMockStripeHttp({
        get: jest.fn().mockResolvedValue({
          data: { tier: 'pro', expiresAt: '2025-12-31T00:00:00Z' },
        }),
      });
      const service = createStripePaymentService({
        stripe: createMockStripe(),
        http,
        userId: 'user-1',
      });

      const result = await service.restorePurchases();

      expect(result.tier).toBe('pro');
      expect(result.expiresAt).toEqual(new Date('2025-12-31T00:00:00Z'));
    });
  });

  describe('getCurrentEntitlement', () => {
    it('returns tier from backend', async () => {
      const http = createMockStripeHttp({
        get: jest.fn().mockResolvedValue({ data: { tier: 'team' } }),
      });
      const service = createStripePaymentService({
        stripe: createMockStripe(),
        http,
        userId: 'user-1',
      });

      expect(await service.getCurrentEntitlement()).toBe('team');
    });
  });
});

// ── RevenueCat iOS payment service ────────────────────────────────────

describe('RevenueCatPaymentService (iOS)', () => {
  describe('getOfferings', () => {
    it('returns empty array when no current offering', async () => {
      const rc = createMockRevenueCat();
      const service = createRevenueCatPaymentService({ revenueCat: rc });

      expect(await service.getOfferings()).toEqual([]);
    });

    it('maps RevenueCat packages to ProductOfferings', async () => {
      const rc = createMockRevenueCat({
        getOfferings: jest.fn().mockResolvedValue({
          current: {
            availablePackages: [
              {
                identifier: 'pro_monthly',
                product: { identifier: 'com.app.pro.monthly', priceString: '$9.99', currencyCode: 'USD' },
              },
              {
                identifier: 'team_annual',
                product: { identifier: 'com.app.team.annual', priceString: '$149.99', currencyCode: 'USD' },
              },
            ],
          },
        }),
      });
      const service = createRevenueCatPaymentService({ revenueCat: rc });

      const offerings = await service.getOfferings();

      expect(offerings).toHaveLength(2);
      expect(offerings[0]).toEqual({
        id: 'pro_monthly',
        tier: 'pro',
        price: '$9.99',
        currency: 'USD',
        period: 'monthly',
      });
      expect(offerings[1]).toEqual({
        id: 'team_annual',
        tier: 'team',
        price: '$149.99',
        currency: 'USD',
        period: 'yearly',
      });
    });
  });

  describe('purchase', () => {
    it('returns success with pro tier on successful purchase', async () => {
      const info = makeCustomerInfo({
        pro: { isActive: true, expirationDate: '2025-12-31T00:00:00Z' },
      });
      const rc = createMockRevenueCat({
        purchasePackage: jest.fn().mockResolvedValue({ customerInfo: info }),
      });
      const service = createRevenueCatPaymentService({ revenueCat: rc });

      const result = await service.purchase('pro_monthly');

      expect(result.success).toBe(true);
      expect(result.tier).toBe('pro');
      expect(result.expiresAt).toEqual(new Date('2025-12-31T00:00:00Z'));
    });

    it('returns team tier when team entitlement is active', async () => {
      const info = makeCustomerInfo({
        team: { isActive: true, expirationDate: '2026-01-15T00:00:00Z' },
      });
      const rc = createMockRevenueCat({
        purchasePackage: jest.fn().mockResolvedValue({ customerInfo: info }),
      });
      const service = createRevenueCatPaymentService({ revenueCat: rc });

      const result = await service.purchase('team_monthly');

      expect(result.success).toBe(true);
      expect(result.tier).toBe('team');
    });

    it('handles purchase failure', async () => {
      const rc = createMockRevenueCat({
        purchasePackage: jest.fn().mockRejectedValue(new Error('User cancelled')),
      });
      const service = createRevenueCatPaymentService({ revenueCat: rc });

      const result = await service.purchase('pro_monthly');

      expect(result.success).toBe(false);
      expect(result.tier).toBe('free');
      expect(result.error).toBe('User cancelled');
    });
  });

  describe('restorePurchases', () => {
    it('returns restored tier', async () => {
      const info = makeCustomerInfo({
        pro: { isActive: true, expirationDate: '2025-12-31T00:00:00Z' },
      });
      const rc = createMockRevenueCat({
        restorePurchases: jest.fn().mockResolvedValue(info),
      });
      const service = createRevenueCatPaymentService({ revenueCat: rc });

      const result = await service.restorePurchases();

      expect(result.tier).toBe('pro');
      expect(result.expiresAt).toEqual(new Date('2025-12-31T00:00:00Z'));
    });

    it('returns free when no active entitlements', async () => {
      const rc = createMockRevenueCat({
        restorePurchases: jest.fn().mockResolvedValue(makeCustomerInfo()),
      });
      const service = createRevenueCatPaymentService({ revenueCat: rc });

      const result = await service.restorePurchases();

      expect(result.tier).toBe('free');
      expect(result.expiresAt).toBeNull();
    });
  });

  describe('getCurrentEntitlement', () => {
    it('returns team when team entitlement is active', async () => {
      const info = makeCustomerInfo({
        team: { isActive: true, expirationDate: null },
        pro: { isActive: true, expirationDate: null },
      });
      const rc = createMockRevenueCat({
        getCustomerInfo: jest.fn().mockResolvedValue(info),
      });
      const service = createRevenueCatPaymentService({ revenueCat: rc });

      // Team takes precedence over pro
      expect(await service.getCurrentEntitlement()).toBe('team');
    });

    it('returns free when no entitlements', async () => {
      const rc = createMockRevenueCat();
      const service = createRevenueCatPaymentService({ revenueCat: rc });

      expect(await service.getCurrentEntitlement()).toBe('free');
    });
  });
});
