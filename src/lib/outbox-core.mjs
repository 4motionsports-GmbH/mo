// Retry rules of the Shopify outbox (pure).
//
// Every write Mo makes to Shopify customers — consent, customer creation, the
// data-erasure request, the optional write-back — is a row in shopify_outbox
// (0065) carrying its TARGET state, so a retry can never do harm. The worker
// (lib/shopify-outbox.ts) runs a row inline right after it is enqueued and
// again from the 5-minute cron until it is done; these rules decide when.

/** @typedef {"consent_update" | "customer_create" | "data_erasure" | "writeback"} OutboxKind */

export const OUTBOX_KINDS = /** @type {const} */ ([
  "consent_update",
  "customer_create",
  "data_erasure",
  "writeback",
]);

/** After this many failed attempts a row turns `dead` and needs a human. */
export const OUTBOX_MAX_ATTEMPTS = 8;

/** Backoff after the n-th failure (1-based): 1, 5, 15, 30, 60, 120, 240 minutes. */
const BACKOFF_MINUTES = [1, 5, 15, 30, 60, 120, 240];

/**
 * What to do with a row after an attempt.
 *
 * @param {{ attempts: number, ok: boolean, permanent?: boolean, now?: Date }} input
 *   attempts — attempts INCLUDING this one; permanent — the error can never
 *   succeed (e.g. the customer no longer exists in Shopify)
 * @returns {{ status: "done" | "failed" | "dead", nextAttemptAt: string | null }}
 */
export function planOutboxRetry({ attempts, ok, permanent = false, now = new Date() }) {
  if (ok) return { status: "done", nextAttemptAt: null };
  if (permanent || attempts >= OUTBOX_MAX_ATTEMPTS) return { status: "dead", nextAttemptAt: null };
  const minutes = BACKOFF_MINUTES[Math.min(Math.max(attempts, 1), BACKOFF_MINUTES.length) - 1];
  return { status: "failed", nextAttemptAt: new Date(now.getTime() + minutes * 60_000).toISOString() };
}

/**
 * Shopify userErrors that will never succeed on retry (the target is gone or
 * the request is invalid as such).
 *
 * @param {Array<{ message?: string, code?: string, field?: string[] | null }>} userErrors
 */
export function isPermanentUserError(userErrors) {
  return (userErrors ?? []).some((e) => {
    const msg = String(e?.message ?? "").toLowerCase();
    const code = String(e?.code ?? "").toUpperCase();
    return (
      code === "NOT_FOUND" ||
      code === "INVALID" ||
      msg.includes("not found") ||
      msg.includes("does not exist") ||
      msg.includes("has been taken") ||
      msg.includes("already been taken")
    );
  });
}

/** German label for the admin. */
export function outboxKindLabel(kind) {
  switch (kind) {
    case "consent_update":
      return "Einwilligung an Shopify";
    case "customer_create":
      return "Kunde in Shopify anlegen";
    case "data_erasure":
      return "Löschung in Shopify beantragen";
    case "writeback":
      return "Merkmale an Shopify";
    default:
      return String(kind);
  }
}
