// Switches of the customer platform (pure, tested). Every switch that writes
// to Shopify or widens what Mo does with personal data defaults to the
// conservative value for an absent, empty or unrecognised setting — the
// deployment turns it on deliberately (documented in .env.example).
// docs/CUSTOMER_PLATFORM_PLAN.md §4, §15.

const TRUTHY = new Set(["1", "true", "yes", "on"]);

/** @param {string | undefined} raw */
function parseFlag(raw) {
  if (typeof raw !== "string") return false;
  return TRUTHY.has(raw.trim().toLowerCase());
}

/** @param {string | undefined} raw @param {number} fallback @param {number} [max] */
function parseNonNegativeInt(raw, fallback, max = Number.MAX_SAFE_INTEGER) {
  if (typeof raw !== "string" || raw.trim() === "") return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.min(n, max);
}

/**
 * Bulk import, nightly reconciliation and the customer / consent / order-ledger
 * webhooks of the Shopify customer base (SHOPIFY_CUSTOMER_SYNC_ENABLED). While
 * off, those webhooks are acknowledged without writing (the order attribution
 * keeps working); deletions and the compliance topics are always handled.
 */
export function isShopifyCustomerSyncEnabled(env = process.env) {
  return parseFlag(env.SHOPIFY_CUSTOMER_SYNC_ENABLED);
}

/**
 * Write Mo-side consent changes to Shopify and create Shopify customers for
 * Mo-only subscribers (SHOPIFY_CONSENT_WRITEBACK). While off, the outbox rows
 * wait; turning it on flushes them.
 */
export function isShopifyConsentWritebackEnabled(env = process.env) {
  return parseFlag(env.SHOPIFY_CONSENT_WRITEBACK);
}

/** Request Shopify's data erasure when a person is erased in Mo (SHOPIFY_ERASURE_SYNC). */
export function isShopifyErasureSyncEnabled(env = process.env) {
  return parseFlag(env.SHOPIFY_ERASURE_SYNC);
}

/**
 * Write Mo's insights back to Shopify as `mo-…` customer tags (lifecycle,
 * value tier, Mo contact, churn risk) for Shopify segments, Flow and Email
 * (SHOPIFY_WRITEBACK_ENABLED, plan D-11). Default off.
 */
export function isShopifyInsightsWritebackEnabled(env = process.env) {
  return parseFlag(env.SHOPIFY_WRITEBACK_ENABLED);
}

/**
 * Order status in the chat (CHAT_ORDER_STATUS_ENABLED): a customer signed in
 * with the Customer Account IN THE SAME chat session can ask Mo about their
 * own orders (get_order_status). Default off — while off the tool is withheld
 * from the model and the prompt is byte-identical to before the feature.
 * docs/ANWALTSDOSSIER.md §16 (F-32).
 */
export function isChatOrderStatusEnabled(env = process.env) {
  return parseFlag(env.CHAT_ORDER_STATUS_ENABLED);
}

/**
 * Whom the AI profile may be built for (CUSTOMER_AI_PROFILE_SCOPE):
 *   "consented" — only customers with an e-mail-marketing consent (default)
 *   "all"       — every customer; non-consented ones are flagged in the admin
 *                 and every marketing action on them stays blocked.
 * @returns {"consented" | "all"}
 */
export function aiProfileScope(env = process.env) {
  const raw = typeof env.CUSTOMER_AI_PROFILE_SCOPE === "string" ? env.CUSTOMER_AI_PROFILE_SCOPE.trim().toLowerCase() : "";
  return raw === "all" ? "all" : "consented";
}

/** The consent-text version live on the shop's own surfaces (stamped on Shopify-side consent events). */
export function shopifyConsentTextVersion(env = process.env) {
  const raw = typeof env.SHOPIFY_CONSENT_TEXT_VERSION === "string" ? env.SHOPIFY_CONSENT_TEXT_VERSION.trim() : "";
  return raw ? raw.slice(0, 40) : null;
}

/** Erasures from Shopify webhooks per hour above which an alert is raised (default 20). */
export function erasureAlertPerHour(env = process.env) {
  return parseNonNegativeInt(env.SHOPIFY_ERASURE_ALERT_PER_HOUR, 20);
}

/** Purchase-based AI profiles generated per night (CUSTOMER_PROFILE_LIGHT_BATCH, 0 = off). */
export function customerProfileLightBatch(env = process.env) {
  return parseNonNegativeInt(env.CUSTOMER_PROFILE_LIGHT_BATCH, 0, 2000);
}

/** New Eingang items that get an AI suggestion per day (INBOX_AI_DAILY_LIMIT, 0 = off). */
export function inboxAiDailyLimit(env = process.env) {
  return parseNonNegativeInt(env.INBOX_AI_DAILY_LIMIT, 0, 500);
}

/** Whether a person's consent allows building an AI profile under the configured scope. */
export function mayBuildAiProfile({ consentState, profileObjectionAt, scope }) {
  if (profileObjectionAt) return false;
  if (scope === "all") return true;
  return consentState === "subscribed";
}
