// The Shopify customer-platform switches as one object (Einstellungen,
// Systemstatus). Values only — no secrets.

import { isShopifyConfigured } from "./shopify";
import {
  aiProfileScope,
  isShopifyConsentWritebackEnabled,
  isShopifyCustomerSyncEnabled,
  isShopifyErasureSyncEnabled,
} from "./platform-flags.mjs";

export interface ShopifySyncFlags {
  configured: boolean;
  customerSync: boolean;
  consentWriteback: boolean;
  erasureSync: boolean;
  profileScope: "consented" | "all";
}

export function shopifySyncFlags(): ShopifySyncFlags {
  return {
    configured: isShopifyConfigured(),
    customerSync: isShopifyCustomerSyncEnabled(),
    consentWriteback: isShopifyConsentWritebackEnabled(),
    erasureSync: isShopifyErasureSyncEnabled(),
    profileScope: aiProfileScope() === "all" ? "all" : "consented",
  };
}
