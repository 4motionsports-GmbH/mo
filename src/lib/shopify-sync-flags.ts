// The Shopify customer-platform switches as one object (Einstellungen,
// Systemstatus). Values only — no secrets.

import { isShopifyConfigured } from "./shopify";
import {
  aiProfileScope,
  isShopifyConsentWritebackEnabled,
  isShopifyCustomerSyncEnabled,
  isShopifyErasureSyncEnabled,
  isShopifyInsightsWritebackEnabled,
} from "./platform-flags.mjs";

export interface ShopifySyncFlags {
  configured: boolean;
  customerSync: boolean;
  consentWriteback: boolean;
  erasureSync: boolean;
  insightsWriteback: boolean;
  profileScope: "consented" | "all";
}

export function shopifySyncFlags(): ShopifySyncFlags {
  return {
    configured: isShopifyConfigured(),
    customerSync: isShopifyCustomerSyncEnabled(),
    consentWriteback: isShopifyConsentWritebackEnabled(),
    erasureSync: isShopifyErasureSyncEnabled(),
    insightsWriteback: isShopifyInsightsWritebackEnabled(),
    profileScope: aiProfileScope() === "all" ? "all" : "consented",
  };
}
