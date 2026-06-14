// Pure decision logic for the email↔Shopify identity merge that runs on every
// sign-in. Kept in plain .mjs (no I/O) so the branching — which is the part with
// real GDPR consequences — is unit-tested in isolation; the DB lookups and
// writes live in lib/customer-store.ts (bindShopifyIdentity).
//
// The EMAIL is the merge key between tier 2 (email-identified) and tier 3
// (signed-in). Shopify's verified email is authoritative for IDENTITY, but we
// NEVER silently fuse two customers' consent records — a collision or mismatch
// is recorded for admin review so consent provenance stays auditable.
// See docs/CUSTOMER_ACCOUNT.md (merge rule) and docs/CONSENT_FLOW.md.

/** @typedef {{ id: number, email: string|null }} MergeRow */

/**
 * Decide what to do given the two rows looked up on sign-in.
 *
 * @param {object} input
 * @param {MergeRow|null} input.rowByShopifyId - customers row already linked to
 *   this shopify_customer_id, or null.
 * @param {MergeRow|null} input.rowByEmail - customers row matching Shopify's
 *   verified (normalised) email, or null.
 * @param {string} input.shopifyEmail - Shopify's verified email, normalised.
 * @returns {{
 *   action: "use" | "stamp" | "create",
 *   customerId: number | null,   // target row for use/stamp; null for create
 *   conflict: null | {
 *     kind: "row_collision" | "email_mismatch",
 *     emailRowCustomerId: number | null,
 *     emailRowEmail: string | null,
 *     shopifyRowCustomerId: number | null,
 *   }
 * }}
 */
export function decideMerge({ rowByShopifyId, rowByEmail, shopifyEmail }) {
  const email = (shopifyEmail || "").trim().toLowerCase();

  // (a) Already linked to this Shopify customer.
  if (rowByShopifyId) {
    // Row collision: a DIFFERENT row also matches Shopify's verified email.
    // Prefer the established Shopify-linked identity; flag for admin, never fuse.
    if (rowByEmail && rowByEmail.id !== rowByShopifyId.id) {
      return {
        action: "use",
        customerId: rowByShopifyId.id,
        conflict: {
          kind: "row_collision",
          emailRowCustomerId: rowByEmail.id,
          emailRowEmail: rowByEmail.email ?? null,
          shopifyRowCustomerId: rowByShopifyId.id,
        },
      };
    }
    // Email mismatch: the linked row's email differs from Shopify's current
    // verified email (e.g. the customer changed their email in Shopify). Keep
    // the linked identity; record for admin rather than rewriting the
    // consent-anchored email.
    const linkedEmail = (rowByShopifyId.email ?? "").trim().toLowerCase();
    if (email && linkedEmail && linkedEmail !== email) {
      return {
        action: "use",
        customerId: rowByShopifyId.id,
        conflict: {
          kind: "email_mismatch",
          emailRowCustomerId: null,
          emailRowEmail: rowByShopifyId.email ?? null,
          shopifyRowCustomerId: rowByShopifyId.id,
        },
      };
    }
    return { action: "use", customerId: rowByShopifyId.id, conflict: null };
  }

  // (b) Not yet linked, but an existing tier-2 row matches the verified email →
  // STAMP it with the Shopify identity (carries the existing consent / profile /
  // history forward). By construction rowByEmail.email === shopifyEmail, so this
  // is the clean merge — no conflict.
  if (rowByEmail) {
    return { action: "stamp", customerId: rowByEmail.id, conflict: null };
  }

  // (c) No existing row → create a fresh tier-3 customer.
  return { action: "create", customerId: null, conflict: null };
}

/**
 * Extract the numeric id from a Shopify customer GID
 * (gid://shopify/Customer/1234567890 → "1234567890"). Returns null when the
 * input isn't a recognisable GID.
 * @param {unknown} gid
 * @returns {string | null}
 */
export function numericFromCustomerGid(gid) {
  if (typeof gid !== "string") return null;
  const m = gid.match(/gid:\/\/shopify\/Customer\/(\d+)/);
  return m ? m[1] : null;
}
