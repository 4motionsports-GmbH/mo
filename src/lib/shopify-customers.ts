// Marketing-subscriber audience read via the Shopify Admin GraphQL API — backs
// the campaign sync (docs/CAMPAIGNS.md).
//
// ⚠️ Shopify's APIs changed recently — this was written against CURRENT docs,
// not memory:
//   Query:   customers(first, after, query)
//   Docs:    https://shopify.dev/docs/api/admin-graphql/2026-04/queries/customers
//            https://shopify.dev/docs/api/admin-graphql/2026-04/objects/Customer
//            https://shopify.dev/docs/api/usage/search-syntax
//   Filter:  `email_marketing_state:SUBSCRIBED` — the customers-query search
//            filter over the customer's email marketing state
//            (CustomerEmailMarketingState enum: SUBSCRIBED | UNSUBSCRIBED |
//            PENDING | NOT_SUBSCRIBED | REDACTED | INVALID).
//   Verified: 2026-07-20 against API version SHOPIFY_API_VERSION (we always
//            target the configured version, not "latest"). shopify.dev blocks
//            automated fetches (HTTP 403), so the shape was re-confirmed via
//            the public docs index: the query filter is `email_marketing_state`
//            with SUBSCRIBED as a value; Customer exposes locale (String),
//            numberOfOrders (UnsignedInt64 — serialised as a string),
//            amountSpent (MoneyV2), defaultAddress.countryCodeV2 (CountryCode)
//            and emailMarketingConsent { marketingState, marketingOptInLevel,
//            consentUpdatedAt }. DEFENSE IN DEPTH: the filter is treated as an
//            optimization only — mapCustomerToContact (campaign-sync-core.mjs)
//            re-checks marketingState === SUBSCRIBED per node, so a filter
//            drift can widen the fetch but never the stored audience.
//   Scope:   read_customers. ⚠️ Customer email/name is PROTECTED CUSTOMER DATA
//            — the app may also need Protected Customer Data access approved in
//            the Shopify Partner dashboard (same caveat as the read_orders
//            usage in shopify-orders.ts).

import { adminGraphql, isShopifyConfigured } from "./shopify";

// Modest page size (cheap flat nodes — no connections multiplying the cost) and
// polite pacing between pages, mirroring fetchAllProducts.
const CUSTOMERS_PAGE_SIZE = 100;
const INTER_PAGE_DELAY_MS = 300;
const MAX_PAGES = 500;

const SUBSCRIBED_CUSTOMERS_QUERY = /* GraphQL */ `
  query CampaignSubscribedCustomers($cursor: String) {
    customers(
      first: ${CUSTOMERS_PAGE_SIZE}
      after: $cursor
      query: "email_marketing_state:SUBSCRIBED"
    ) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        email
        firstName
        lastName
        locale
        numberOfOrders
        amountSpent {
          amount
          currencyCode
        }
        lastOrder {
          createdAt
        }
        defaultAddress {
          countryCodeV2
        }
        emailMarketingConsent {
          marketingState
          marketingOptInLevel
          consentUpdatedAt
        }
      }
    }
  }
`;

/** Raw customer node as the sync mapper (campaign-sync-core.mjs) consumes it. */
export interface ShopifySubscribedCustomer {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  locale: string | null;
  /** UnsignedInt64 — serialised by Shopify as a string. */
  numberOfOrders: string | null;
  amountSpent: { amount: string; currencyCode: string } | null;
  /** Date of the customer's most recent order — drives the lifecycle segment
   * filter/ordering of the review queue (migration 0052). */
  lastOrder: { createdAt: string | null } | null;
  defaultAddress: { countryCodeV2: string | null } | null;
  emailMarketingConsent: {
    marketingState: string | null;
    marketingOptInLevel: string | null;
    consentUpdatedAt: string | null;
  } | null;
}

interface CustomersPage {
  customers: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: ShopifySubscribedCustomer[];
  };
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Page through every SUBSCRIBED customer (per the query filter; the caller's
 * mapper re-checks the consent state per node). Returns null when Shopify is
 * not configured — the sync then reports "not configured" instead of running on
 * nothing. Throws on a hard transport failure (the sync route surfaces it).
 */
export async function fetchSubscribedCustomers(): Promise<ShopifySubscribedCustomer[] | null> {
  if (!isShopifyConfigured()) return null;
  const out: ShopifySubscribedCustomer[] = [];
  let cursor: string | null = null;
  let page = 0;
  while (true) {
    page++;
    const data: CustomersPage = await adminGraphql<CustomersPage>(SUBSCRIBED_CUSTOMERS_QUERY, {
      cursor,
    });
    out.push(...(data.customers?.nodes ?? []));
    if (!data.customers?.pageInfo?.hasNextPage) break;
    cursor = data.customers.pageInfo.endCursor;
    if (!cursor) break;
    if (page > MAX_PAGES) {
      throw new Error("fetchSubscribedCustomers: exceeded 500 pages — bailing out");
    }
    await sleep(INTER_PAGE_DELAY_MS);
  }
  return out;
}
