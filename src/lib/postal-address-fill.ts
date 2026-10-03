// Postal addresses for letters, from the order ledger (0074, docs/CAMPAIGNS.md
// §8): the shipping address of each customer's LATEST COMPLETED order — the
// only lawful source for an advertising letter (dossier § 6.4). The ledger
// knows which order that is but stores no addresses (minimisation); only that
// one order's shippingAddress is read live from Shopify, in chunks, and only
// for the people who are about to get a letter (campaign letter recipients,
// Kunden → Brief). Never collects while the letter channel is off.

import { getSql, type Sql } from "./db";
import { reportError } from "./observability";
import { adminGraphql, isShopifyConfigured } from "./shopify";
import { isPhysicalMailSendsApproved } from "./pingen-flag.mjs";
import { decideAddressRefresh, normalizeShopifyAddress } from "./postal-address.mjs";
import { markPostalAddressChecked, savePurchaseAddress } from "./customer-store";

/** Order gids per Admin API call (nodes(ids:) takes at most 250). */
const CHUNK = 50;

const ORDER_ADDRESSES = /* GraphQL */ `
  query MoLetterAddresses($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Order {
        id
        displayFinancialStatus
        cancelledAt
        shippingAddress {
          name
          firstName
          lastName
          company
          address1
          address2
          zip
          city
          countryCodeV2
        }
      }
    }
  }
`;

const COMPLETED = new Set(["PAID", "PARTIALLY_REFUNDED"]);

export interface AddressFillResult {
  ok: boolean;
  /** Why nothing was done (flag off, Shopify not configured). */
  reason?: "flag_off" | "shopify_not_configured";
  checked: number;
  filled: number;
  unchanged: number;
  /** No completed order in the ledger — no lawful address exists. */
  noOrder: number;
  /** The order's shipping address is missing or incomplete (pickup, digital). */
  noAddress: number;
  failed: number;
}

/**
 * Fill or refresh the purchase address of these customers. Never throws.
 */
export async function fillPostalAddressesFromOrders(
  customerIds: number[],
  sql: Sql | null = getSql()
): Promise<AddressFillResult> {
  const result: AddressFillResult = { ok: true, checked: 0, filled: 0, unchanged: 0, noOrder: 0, noAddress: 0, failed: 0 };
  const ids = [...new Set(customerIds.filter((n) => Number.isInteger(n) && n > 0))];
  if (ids.length === 0) return result;
  if (!isPhysicalMailSendsApproved()) return { ...result, ok: false, reason: "flag_off" };
  if (!isShopifyConfigured()) return { ...result, ok: false, reason: "shopify_not_configured" };
  if (!sql) return { ...result, ok: false };
  try {
    // The latest completed (paid, not cancelled) order per customer, with what
    // is stored now.
    const rows = (await sql`
      SELECT c.id AS customer_id,
             c.postal_address IS NOT NULL AS has_address,
             c.postal_address_source,
             c.postal_address_order_id,
             lo.shopify_order_id AS latest_order_id
        FROM customers c
        LEFT JOIN LATERAL (
          SELECT o.shopify_order_id
            FROM customer_orders o
           WHERE o.customer_id = c.id
             AND o.cancelled_at IS NULL
             AND upper(COALESCE(o.financial_status, '')) IN ('PAID', 'PARTIALLY_REFUNDED')
           ORDER BY o.processed_at DESC, o.id DESC
           LIMIT 1
        ) lo ON true
       WHERE c.id = ANY(${ids}::bigint[])
    `) as Array<Record<string, unknown>>;

    const toFetch: Array<{ customerId: number; orderId: string }> = [];
    const noOrder: number[] = [];
    for (const r of rows) {
      result.checked++;
      const decision = decideAddressRefresh({
        latestOrderId: (r.latest_order_id as string | null) ?? null,
        storedOrderId: (r.postal_address_order_id as string | null) ?? null,
        storedSource: (r.postal_address_source as string | null) ?? null,
        hasAddress: Boolean(r.has_address),
      });
      if (decision === "no_order") {
        result.noOrder++;
        noOrder.push(Number(r.customer_id));
      }
      else if (decision === "skip") result.unchanged++;
      else toFetch.push({ customerId: Number(r.customer_id), orderId: String(r.latest_order_id) });
    }

    // Checked: no lawful address now — asked again at the earliest tomorrow.
    for (const id of noOrder) await markPostalAddressChecked(id, sql);

    for (let i = 0; i < toFetch.length; i += CHUNK) {
      const chunk = toFetch.slice(i, i + CHUNK);
      let nodes: Array<Record<string, unknown> | null> = [];
      try {
        const data = await adminGraphql<{ nodes: Array<Record<string, unknown> | null> }>(ORDER_ADDRESSES, {
          ids: chunk.map((c) => `gid://shopify/Order/${c.orderId}`),
        });
        nodes = Array.isArray(data?.nodes) ? data.nodes : [];
      } catch (err) {
        reportError(err, { route: "lib/postal-address-fill", phase: "fetch" });
        result.failed += chunk.length;
        continue;
      }
      const byId = new Map<string, Record<string, unknown>>();
      for (const n of nodes) {
        const id = /(\d+)$/.exec(String(n?.id ?? ""))?.[1];
        if (n && id) byId.set(id, n);
      }
      for (const c of chunk) {
        const node = byId.get(c.orderId);
        const status = String(node?.displayFinancialStatus ?? "").toUpperCase();
        const address =
          node && !node.cancelledAt && COMPLETED.has(status)
            ? normalizeShopifyAddress(node.shippingAddress as Record<string, unknown> | null)
            : null;
        if (!address) {
          result.noAddress++;
          await markPostalAddressChecked(c.customerId, sql);
          continue;
        }
        if (await savePurchaseAddress(c.customerId, address, c.orderId, sql)) result.filled++;
        else result.failed++;
      }
    }
    return result;
  } catch (err) {
    reportError(err, { route: "lib/postal-address-fill", phase: "fill" });
    return { ...result, ok: false };
  }
}
