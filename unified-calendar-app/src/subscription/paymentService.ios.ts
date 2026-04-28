/**
 * RevenueCat-based payment service for iOS (Apple StoreKit).
 * Requirements: 10.2, 10.3, 10.5
 */

import type { SubscriptionTier } from '../types/subscription';
import type {
  PaymentService,
  ProductOffering,
  PurchaseResult,
  RestoreResult,
} from './paymentService';
import { mapEntitlementToTier } from './paymentService';

/**
 * RevenueCat SDK abstraction for dependency injection / testing.
 */
export interface RevenueCatClient {
  getOfferings(): Promise<{
    current: {
      availablePackages: Array<{
        identifier: string;
        product: { identifier: string; priceString: string; currencyCode: string };
      }>;
    } | null;
  }>;
  purchasePackage(packageId: string): Promise<{
    customerInfo: RevenueCatCustomerInfo;
  }>;
  restorePurchases(): Promise<RevenueCatCustomerInfo>;
  getCustomerInfo(): Promise<RevenueCatCustomerInfo>;
}

export interface RevenueCatCustomerInfo {
  entitlements: {
    active: Record<string, { isActive: boolean; expirationDate: string | null }>;
  };
  originalAppUserId: string;
}

/** Maps RevenueCat package identifiers to subscription tiers */
const PACKAGE_TIER_MAP: Record<string, SubscriptionTier> = {
  '$rc_monthly_pro': 'pro',
  '$rc_annual_pro': 'pro',
  '$rc_monthly_team': 'team',
  '$rc_annual_team': 'team',
  pro_monthly: 'pro',
  pro_annual: 'pro',
  team_monthly: 'team',
  team_annual: 'team',
};

export interface RevenueCatPaymentServiceDeps {
  revenueCat: RevenueCatClient;
}

/**
 * Creates a RevenueCat-backed PaymentService for iOS.
 */
export function createRevenueCatPaymentService(
  deps: RevenueCatPaymentServiceDeps,
): PaymentService {
  const { revenueCat } = deps;

  function resolveEntitlementTier(info: RevenueCatCustomerInfo): SubscriptionTier {
    const active = info.entitlements.active;
    if (active['team']?.isActive) return 'team';
    if (active['pro']?.isActive) return 'pro';
    return 'free';
  }

  function resolveExpiry(info: RevenueCatCustomerInfo): Date | null {
    const active = info.entitlements.active;
    const entitlement = active['team'] ?? active['pro'];
    if (entitlement?.expirationDate) {
      return new Date(entitlement.expirationDate);
    }
    return null;
  }

  async function getOfferings(): Promise<ProductOffering[]> {
    const offerings = await revenueCat.getOfferings();
    if (!offerings.current) return [];

    return offerings.current.availablePackages.map((pkg) => ({
      id: pkg.identifier,
      tier: PACKAGE_TIER_MAP[pkg.identifier] ?? 'pro',
      price: pkg.product.priceString,
      currency: pkg.product.currencyCode,
      period: pkg.identifier.includes('annual') ? 'yearly' as const : 'monthly' as const,
    }));
  }

  async function purchase(productId: string): Promise<PurchaseResult> {
    try {
      const { customerInfo } = await revenueCat.purchasePackage(productId);
      const tier = resolveEntitlementTier(customerInfo);
      const expiresAt = resolveExpiry(customerInfo);

      return {
        success: tier !== 'free',
        tier,
        receiptId: customerInfo.originalAppUserId,
        expiresAt,
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
    const info = await revenueCat.restorePurchases();
    return {
      tier: resolveEntitlementTier(info),
      expiresAt: resolveExpiry(info),
    };
  }

  async function getCurrentEntitlement(): Promise<SubscriptionTier> {
    const info = await revenueCat.getCustomerInfo();
    return resolveEntitlementTier(info);
  }

  return { getOfferings, purchase, restorePurchases, getCurrentEntitlement };
}
