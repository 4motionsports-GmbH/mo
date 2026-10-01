import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isShopifyCustomerSyncEnabled,
  isShopifyConsentWritebackEnabled,
  isShopifyErasureSyncEnabled,
  aiProfileScope,
  shopifyConsentTextVersion,
  erasureAlertPerHour,
  customerProfileLightBatch,
  inboxAiDailyLimit,
  mayBuildAiProfile,
} from "./platform-flags.mjs";

test("Shopify write switches are off unless explicitly enabled", () => {
  for (const fn of [isShopifyCustomerSyncEnabled, isShopifyConsentWritebackEnabled, isShopifyErasureSyncEnabled]) {
    assert.equal(fn({}), false);
    assert.equal(fn({ SHOPIFY_CUSTOMER_SYNC_ENABLED: "maybe", SHOPIFY_CONSENT_WRITEBACK: "", SHOPIFY_ERASURE_SYNC: "0" }), false);
  }
  assert.equal(isShopifyCustomerSyncEnabled({ SHOPIFY_CUSTOMER_SYNC_ENABLED: "true" }), true);
  assert.equal(isShopifyConsentWritebackEnabled({ SHOPIFY_CONSENT_WRITEBACK: " YES " }), true);
  assert.equal(isShopifyErasureSyncEnabled({ SHOPIFY_ERASURE_SYNC: "1" }), true);
});

test("the AI profile scope is 'consented' unless set to 'all'", () => {
  assert.equal(aiProfileScope({}), "consented");
  assert.equal(aiProfileScope({ CUSTOMER_AI_PROFILE_SCOPE: "ALL" }), "all");
  assert.equal(aiProfileScope({ CUSTOMER_AI_PROFILE_SCOPE: "everyone" }), "consented");
});

test("numeric switches parse with defaults and caps", () => {
  assert.equal(erasureAlertPerHour({}), 20);
  assert.equal(erasureAlertPerHour({ SHOPIFY_ERASURE_ALERT_PER_HOUR: "5" }), 5);
  assert.equal(customerProfileLightBatch({}), 0);
  assert.equal(customerProfileLightBatch({ CUSTOMER_PROFILE_LIGHT_BATCH: "99999" }), 2000);
  assert.equal(inboxAiDailyLimit({ INBOX_AI_DAILY_LIMIT: "-3" }), 0);
  assert.equal(inboxAiDailyLimit({ INBOX_AI_DAILY_LIMIT: "25" }), 25);
});

test("consent text version is trimmed or null", () => {
  assert.equal(shopifyConsentTextVersion({}), null);
  assert.equal(shopifyConsentTextVersion({ SHOPIFY_CONSENT_TEXT_VERSION: " shop-2026-10 " }), "shop-2026-10");
});

test("profiling respects the objection and the scope", () => {
  assert.equal(mayBuildAiProfile({ consentState: "not_subscribed", profileObjectionAt: null, scope: "consented" }), false);
  assert.equal(mayBuildAiProfile({ consentState: "subscribed", profileObjectionAt: null, scope: "consented" }), true);
  assert.equal(mayBuildAiProfile({ consentState: "not_subscribed", profileObjectionAt: null, scope: "all" }), true);
  assert.equal(mayBuildAiProfile({ consentState: "subscribed", profileObjectionAt: "2026-01-01", scope: "all" }), false);
});
