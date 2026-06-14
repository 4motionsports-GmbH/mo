// Shopify address → our lawful postal-address store (migration 0022).
//
// Maps a Shopify address node (Customer Account API CustomerAddress, or Admin API
// MailingAddress — they share field names) to the SNAKE_CASE jsonb shape that
// customers.postal_address holds and that physical-address.validateFullAddress
// reads: { name, company?, address_line_1, address_line_2?, postal_code, city,
// country }. Country is normalised to an ISO-3166 alpha-2 code.
//
// NEVER part-fills: an address missing any required field (or whose country is
// not a 2-letter code) normalises to null — it is not stored, so eligibility
// stays disabled rather than risking a misaddressed letter. Pure + unit-tested.

import { validateFullAddress } from "./physical-address.mjs";

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Normalise one Shopify address node to the stored jsonb shape, or null when it
 * is incomplete. Accepts both API dialects:
 *   - country: `territoryCode` (Customer Account API) | `countryCodeV2` (Admin
 *     API) | `countryCode`.
 *   - recipient name: `name`, else `firstName` + `lastName`.
 *
 * @param {Record<string, unknown> | null | undefined} node
 * @returns {{ name: string, company: string|null, address_line_1: string,
 *             address_line_2: string|null, postal_code: string, city: string,
 *             country: string } | null}
 */
export function normalizeShopifyAddress(node) {
  if (!node || typeof node !== "object") return null;
  const a = /** @type {Record<string, unknown>} */ (node);

  const name = clean(a.name) || [clean(a.firstName), clean(a.lastName)].filter(Boolean).join(" ");
  const country = clean(a.territoryCode) || clean(a.countryCodeV2) || clean(a.countryCode);

  const obj = {
    name,
    company: clean(a.company) || null,
    address_line_1: clean(a.address1),
    address_line_2: clean(a.address2) || null,
    postal_code: clean(a.zip),
    city: clean(a.city),
    country: country ? country.toUpperCase() : "",
  };

  // Reuse the SAME completeness rule the eligibility check uses — what we store
  // is exactly what will later be validated for sending.
  return validateFullAddress(obj).ok ? obj : null;
}

/**
 * Pick the lawful address + its basis from what Shopify gave us, preferring a
 * PURCHASE-derived address (a shipping address from a completed order — obtained
 * in connection with a sale) over the saved profile address.
 *
 * @param {{ orderShippingAddresses?: Array<Record<string, unknown>|null>,
 *           defaultAddress?: Record<string, unknown>|null }} input
 * @returns {{ address: Record<string, unknown>, source: 'purchase'|'consented_capture' } | null}
 */
export function chooseLawfulAddress(input) {
  const orderAddresses = Array.isArray(input?.orderShippingAddresses)
    ? input.orderShippingAddresses
    : [];
  // Newest completed order first (the caller passes them in that order).
  for (const node of orderAddresses) {
    const address = normalizeShopifyAddress(node);
    if (address) return { address, source: "purchase" };
  }
  const fromProfile = normalizeShopifyAddress(input?.defaultAddress ?? null);
  if (fromProfile) return { address: fromProfile, source: "consented_capture" };
  return null;
}
