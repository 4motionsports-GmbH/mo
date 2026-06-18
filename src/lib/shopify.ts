// Shopify Admin API client.
//
// Auth: OAuth client-credentials grant. Built against
// https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/client-credentials-grant
// (verified working 2026-05-28; see scripts/verify-shopify-auth.mjs).
// Tokens TTL ≈ 24h — cached in memory and refreshed when within
// REFRESH_BUFFER_MS of expiry.

interface CachedToken {
  accessToken: string;
  expiresAt: number; // epoch ms
  scope: string;
}

let cached: CachedToken | null = null;
let inFlight: Promise<CachedToken> | null = null;

const REFRESH_BUFFER_MS = 5 * 60 * 1000; // refresh 5 min before expiry
const DEFAULT_TTL_MS = 23 * 60 * 60 * 1000; // 23h if Shopify doesn't return expires_in

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name}`);
  return v.trim();
}

function storeDomain(): string {
  return env("SHOPIFY_STORE_DOMAIN")
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");
}

function apiVersion(): string {
  return env("SHOPIFY_API_VERSION");
}

/** The configured Admin API version (e.g. "2026-04"), for logging/citation. */
export function shopifyApiVersion(): string {
  return apiVersion();
}

/**
 * True when the Shopify Admin API credentials are present. Callers that touch
 * Shopify at request time (discount creation, orders lookup) use this to degrade
 * gracefully instead of throwing when the store isn't configured (e.g. local dev).
 */
export function isShopifyConfigured(): boolean {
  return Boolean(
    process.env.SHOPIFY_STORE_DOMAIN &&
      process.env.SHOPIFY_CLIENT_ID &&
      process.env.SHOPIFY_CLIENT_SECRET &&
      process.env.SHOPIFY_API_VERSION
  );
}

async function exchangeToken(): Promise<CachedToken> {
  const url = `https://${storeDomain()}/admin/oauth/access_token`;
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: env("SHOPIFY_CLIENT_ID"),
    client_secret: env("SHOPIFY_CLIENT_SECRET"),
  });
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Shopify token exchange failed: HTTP ${res.status} ${res.statusText} — ${text}`);
  }
  let parsed: { access_token?: string; expires_in?: number; scope?: string };
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`Shopify token endpoint returned non-JSON: ${text.slice(0, 200)}`);
  }
  if (!parsed.access_token) {
    throw new Error(`Shopify token response missing access_token: ${text.slice(0, 200)}`);
  }
  const ttlMs = parsed.expires_in ? parsed.expires_in * 1000 : DEFAULT_TTL_MS;
  return {
    accessToken: parsed.access_token,
    expiresAt: Date.now() + ttlMs,
    scope: parsed.scope ?? "",
  };
}

export async function getAdminToken(): Promise<string> {
  if (cached && cached.expiresAt - REFRESH_BUFFER_MS > Date.now()) {
    return cached.accessToken;
  }
  if (inFlight) return (await inFlight).accessToken;
  inFlight = exchangeToken()
    .then((tok) => {
      cached = tok;
      return tok;
    })
    .finally(() => {
      inFlight = null;
    });
  return (await inFlight).accessToken;
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string; extensions?: Record<string, unknown> }>;
}

/**
 * Run an authenticated Admin GraphQL query/mutation and return `data`. Throws on
 * HTTP errors, GraphQL `errors`, or a missing `data`. Exported so the discount
 * and orders modules share one auth + transport path (token cache, error
 * handling) rather than re-implementing it.
 */
export async function adminGraphql<T>(
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  return graphql<T>(query, variables);
}

async function graphql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const token = await getAdminToken();
  const url = `https://${storeDomain()}/admin/api/${apiVersion()}/graphql.json`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token,
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Shopify GraphQL ${res.status} ${res.statusText}: ${body.slice(0, 500)}`);
  }
  const json = (await res.json()) as GraphQLResponse<T>;
  if (json.errors?.length) {
    throw new Error(`Shopify GraphQL errors: ${JSON.stringify(json.errors)}`);
  }
  if (!json.data) {
    throw new Error("Shopify GraphQL returned no data");
  }
  return json.data;
}

// ---------------- Product fetching ----------------

// Raw shape returned by our products query. Kept close to the GraphQL types so
// the mapping layer in the cron route stays simple and explicit.
export interface ShopifyProductImage {
  url: string;
  altText?: string | null;
}

export interface ShopifyProductVariant {
  id: string;
  sku?: string | null;
  price: string; // GraphQL Money — decimal string
  compareAtPrice?: string | null;
  inventoryQuantity?: number | null;
  // Whether THIS variant can currently be sold. Shopify computes this from the
  // variant's inventory AND its inventory policy, so a variant set to "continue
  // selling when out of stock" is still `true` here. Preferred signal for the
  // catalog's stock status — see catalog-mapping.ts.
  // Field: ProductVariant.availableForSale (Boolean!), Admin API 2026-04.
  availableForSale?: boolean | null;
}

export interface ShopifyMetafield {
  namespace: string;
  key: string;
  value: string;
  type?: string | null;
}

export interface ShopifyProduct {
  id: string;
  handle: string;
  title: string;
  descriptionHtml: string;
  productType: string;
  vendor: string;
  status: "ACTIVE" | "ARCHIVED" | "DRAFT";
  publishedAt: string | null;
  tags: string[];
  onlineStoreUrl?: string | null;
  category?: { fullName?: string | null; name?: string | null } | null;
  featuredImage?: ShopifyProductImage | null;
  images: ShopifyProductImage[];
  variants: ShopifyProductVariant[];
  metafields: ShopifyMetafield[];
  // Product-level stock signals (Admin API 2026-04):
  //   Product.totalInventory  (Int)      — quantity in stock across all
  //                                         variants/locations. Null/0 when not
  //                                         tracked.
  //   Product.tracksInventory (Boolean!) — whether inventory tracking is on for
  //                                         this product. When false, quantity is
  //                                         not meaningful and availability is
  //                                         governed by the variant's policy.
  totalInventory?: number | null;
  tracksInventory?: boolean | null;
}

// Metafields we want surfaced for product mapping. The (namespace,key) pairs
// mirror what convert-catalog.mjs reads from the CSV column names. The alias
// is the GraphQL field alias used in the products query — it must be a valid
// GraphQL identifier (no hyphens), and is stored back as the metafield key
// when we hand the data to the mapper.
const METAFIELD_IDENTIFIERS: Array<{
  alias: string;
  namespace: string;
  key: string;
}> = [
  { alias: "mf_custom_hoehe", namespace: "custom", key: "hoehe" },
  { alias: "mf_custom_laenge", namespace: "custom", key: "laenge" },
  { alias: "mf_custom_gewicht", namespace: "custom", key: "gewicht" },
  { alias: "mf_custom_lieferzeit_min", namespace: "custom", key: "lieferzeit_min" },
  { alias: "mf_custom_serie", namespace: "custom", key: "serie" },
  { alias: "mf_custom_typ", namespace: "custom", key: "typ" },
  { alias: "mf_custom_zertifizierung", namespace: "custom", key: "zertifizierung" },
  { alias: "mf_shopify_material", namespace: "shopify", key: "material" },
  { alias: "mf_shopify_color_pattern", namespace: "shopify", key: "color-pattern" },
];

// One `metafield(namespace, key)` field per identifier, aliased so the
// response is a flat object: { mf_custom_hoehe: { value: "120", … }, … }.
//
// We request the raw `value` AND the reference expansion. Reference-type
// metafields (e.g. the Shopify standard-taxonomy `shopify.material` /
// `shopify.color-pattern` metaobjects) return a GID — or a JSON array of
// GIDs — in `value`; the human-readable label lives on the referenced
// Metaobject's fields. `reference` resolves single references, `references`
// resolves list references. Both are null for non-reference metafields, so
// requesting them on plain text/number metafields is harmless.
//
// `references(first:)` is kept small: it is multiplied by the products page
// size when Shopify computes the query's static cost, and 9 metafields each
// with a reference connection adds up fast (the single-query cost ceiling is
// 1000). Observed catalog data tops out at ~8-9 list values (colors), so 15
// covers every real product without truncation.
const METAFIELD_REFERENCES_PAGE_SIZE = 15;
const METAFIELD_QUERY_FIELDS = METAFIELD_IDENTIFIERS.map(
  (m) =>
    `${m.alias}: metafield(namespace: "${m.namespace}", key: "${m.key}") {
          value
          type
          reference {
            ... on Metaobject { fields { key value } }
          }
          references(first: ${METAFIELD_REFERENCES_PAGE_SIZE}) {
            nodes {
              ... on Metaobject { fields { key value } }
            }
          }
        }`
).join("\n        ");

// Page size is deliberately modest. Shopify computes a static query cost by
// multiplying each node's subtree cost by `first`; with the metaobject
// reference expansions on 9 metafields, first:100 blew past the 1000-cost
// single-query ceiling (observed cost 1550 → MAX_COST_EXCEEDED). 30 keeps the
// cost comfortably under the limit while staying well within the page cap.
// The product fields the catalog needs — extracted so the paginated full-sync
// query AND the targeted single-product query (used by the stock webhook, Part E)
// request EXACTLY the same shape and map identically. Stock signals are
// sync-fresh in the cron path and near-real-time on the webhook path; either way
// availableForSale is the authoritative "can this be sold right now" flag
// (respects oversell policy), backed by totalInventory / tracksInventory.
const PRODUCT_NODE_FIELDS = /* GraphQL */ `
    id
    handle
    title
    descriptionHtml
    productType
    vendor
    status
    publishedAt
    tags
    onlineStoreUrl
    totalInventory
    tracksInventory
    category {
      fullName
      name
    }
    featuredImage {
      url
      altText
    }
    images(first: 20) {
      nodes {
        url
        altText
      }
    }
    variants(first: 50) {
      nodes {
        id
        sku
        price
        compareAtPrice
        inventoryQuantity
        availableForSale
      }
    }
    ${METAFIELD_QUERY_FIELDS}
`;

const PRODUCTS_PAGE_SIZE = 30;
const PRODUCTS_QUERY = /* GraphQL */ `
  query CatalogProducts($cursor: String) {
    products(first: ${PRODUCTS_PAGE_SIZE}, after: $cursor) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        ${PRODUCT_NODE_FIELDS}
      }
    }
  }
`;

// Targeted fetch of specific products by GID (webhook single-product refresh).
const PRODUCTS_BY_IDS_QUERY = /* GraphQL */ `
  query CatalogProductsByIds($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Product {
        ${PRODUCT_NODE_FIELDS}
      }
    }
  }
`;

// Resolve which product an inventory item belongs to — the inventory_levels/*
// webhook carries an inventory_item_id, not a product. Admin API 2026-04.
const INVENTORY_ITEM_PRODUCT_QUERY = /* GraphQL */ `
  query InventoryItemProduct($id: ID!) {
    inventoryItem(id: $id) {
      variant {
        product {
          id
        }
      }
    }
  }
`;

// Raw metafield shape as returned by the products query (post reference
// expansion). `value` is the literal Shopify value (a GID or JSON array of
// GIDs for reference types); `reference` / `references` carry the resolved
// metaobject(s) when the metafield is a reference type.
interface RawMetaobjectField {
  key: string;
  value: string | null;
}
interface RawMetaobjectRef {
  // Empty (no `fields`) when the reference is not a Metaobject (the inline
  // fragment didn't match) or the metaobject has no fields.
  fields?: RawMetaobjectField[] | null;
}
interface RawMetafield {
  value: string | null;
  type?: string | null;
  reference?: RawMetaobjectRef | null;
  references?: { nodes: Array<RawMetaobjectRef | null> | null } | null;
}

function looksLikeGid(s: string | null | undefined): boolean {
  return typeof s === "string" && s.includes("gid://shopify/");
}

// Pull a human-readable display value out of a referenced metaobject. Shopify
// standard-taxonomy metaobjects (color, material, …) expose the label under a
// `label` field; custom metaobjects may use `name`/`title`. Fall back to the
// first non-empty, non-GID text field so we degrade gracefully across however
// the merchant modelled their metaobject.
function metaobjectDisplayValue(node: RawMetaobjectRef | null | undefined): string | null {
  const fields = node?.fields;
  if (!fields || !Array.isArray(fields)) return null;
  const pick = (k: string): string | null => {
    const f = fields.find((f) => f.key === k);
    const v = f?.value;
    return v != null && v !== "" && !looksLikeGid(v) ? v : null;
  };
  return (
    pick("label") ??
    pick("name") ??
    pick("title") ??
    pick("value") ??
    fields.find((f) => f.value != null && f.value !== "" && !looksLikeGid(f.value))?.value ??
    null
  );
}

// Resolve one metafield to a clean, human-readable string for the catalog.
// - List reference   → join each resolved metaobject label with ", ".
// - Single reference → the resolved metaobject label.
// - Plain value      → returned as-is (text/number metafields).
// Defensive fallback: if a value that should have resolved is still a raw GID
// (reference came back null/empty/unexpected), emit "—" and warn with the
// product id rather than leaking the GID to the frontend.
function resolveMetafieldValue(
  raw: RawMetafield | null | undefined,
  productId: string,
  identifier: string
): string | null {
  if (!raw) return null;

  const refNodes = raw.references?.nodes;
  if (Array.isArray(refNodes) && refNodes.length > 0) {
    const parts = refNodes
      .map((n) => metaobjectDisplayValue(n))
      .filter((v): v is string => !!v);
    if (parts.length > 0) return parts.join(", ");
    console.warn(
      `[shopify] product ${productId}: metafield ${identifier} list references did not resolve to a display value — check the source metaobject's field keys`
    );
    return "—";
  }

  if (raw.reference) {
    const v = metaobjectDisplayValue(raw.reference);
    if (v) return v;
    console.warn(
      `[shopify] product ${productId}: metafield ${identifier} reference did not resolve to a display value — check the source metaobject's field keys`
    );
    return "—";
  }

  const value = raw.value;
  if (value == null || value === "") return null;
  // A reference-type metafield whose expansion came back empty still has a GID
  // (or JSON array of GIDs) in `value` — never let that reach the catalog.
  if (looksLikeGid(value)) {
    console.warn(
      `[shopify] product ${productId}: metafield ${identifier} is an unresolved reference (${value.slice(0, 80)}) — check the source metaobject`
    );
    return "—";
  }
  return value;
}

type ProductNode = {
  id: string;
  handle: string;
  title: string;
  descriptionHtml: string;
  productType: string;
  vendor: string;
  status: ShopifyProduct["status"];
  publishedAt: string | null;
  tags: string[];
  onlineStoreUrl: string | null;
  totalInventory: number | null;
  tracksInventory: boolean | null;
  category: { fullName: string | null; name: string | null } | null;
  featuredImage: ShopifyProductImage | null;
  images: { nodes: ShopifyProductImage[] };
  variants: { nodes: ShopifyProductVariant[] };
} & {
  // Each alias becomes its own field on the response.
  [alias: string]: RawMetafield | null | unknown;
};

interface ProductsPage {
  products: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: ProductNode[];
  };
}

// One ProductNode (raw GraphQL) → the ShopifyProduct the mapper consumes,
// resolving each metafield reference to its display value. Shared by the full
// sync and the targeted webhook fetch so both produce identical shapes.
function mapProductNode(n: ProductNode): ShopifyProduct {
  const metafields: ShopifyMetafield[] = [];
  for (const id of METAFIELD_IDENTIFIERS) {
    const field = n[id.alias] as RawMetafield | null | undefined;
    const value = resolveMetafieldValue(field, n.id, `${id.namespace}.${id.key}`);
    if (value != null && value !== "") {
      metafields.push({ namespace: id.namespace, key: id.key, value });
    }
  }
  return {
    id: n.id,
    handle: n.handle,
    title: n.title,
    descriptionHtml: n.descriptionHtml ?? "",
    productType: n.productType ?? "",
    vendor: n.vendor ?? "",
    status: n.status,
    publishedAt: n.publishedAt,
    tags: Array.isArray(n.tags) ? n.tags : [],
    onlineStoreUrl: n.onlineStoreUrl,
    category: n.category,
    featuredImage: n.featuredImage,
    images: n.images?.nodes ?? [],
    variants: n.variants?.nodes ?? [],
    totalInventory: n.totalInventory,
    tracksInventory: n.tracksInventory,
    metafields,
  };
}

export async function fetchAllProducts(): Promise<ShopifyProduct[]> {
  const out: ShopifyProduct[] = [];
  let cursor: string | null = null;
  let page = 0;
  while (true) {
    page++;
    const data: ProductsPage = await graphql<ProductsPage>(PRODUCTS_QUERY, { cursor });
    for (const n of data.products.nodes) out.push(mapProductNode(n));
    if (!data.products.pageInfo.hasNextPage) break;
    cursor = data.products.pageInfo.endCursor;
    if (!cursor) break;
    if (page > 500) throw new Error("fetchAllProducts: exceeded 500 pages — bailing out");
  }
  return out;
}

/**
 * Fetch specific products by GID (e.g. "gid://shopify/Product/123"). Used by the
 * stock webhook for a TARGETED single-product refresh — same fields/mapping as
 * the full sync, so the updated record is computed identically. Ids that no
 * longer resolve to a Product (deleted/inaccessible) are silently dropped, so the
 * caller can treat a missing id as "remove from catalog".
 */
export async function fetchProductsByIds(gids: string[]): Promise<ShopifyProduct[]> {
  const ids = gids.filter((g) => typeof g === "string" && g.startsWith("gid://"));
  if (ids.length === 0) return [];
  const data = await graphql<{ nodes: Array<ProductNode | null> }>(PRODUCTS_BY_IDS_QUERY, { ids });
  const out: ShopifyProduct[] = [];
  for (const n of data.nodes ?? []) {
    // Non-Product nodes come back without a handle (the inline fragment didn't
    // match) — skip them defensively.
    if (n && typeof n.handle === "string") out.push(mapProductNode(n));
  }
  return out;
}

/**
 * Resolve the product GID that an inventory item belongs to (inventory_levels/*
 * webhooks carry an inventory_item_id, not a product). Returns null when it can't
 * be resolved (item gone, not tied to a variant/product).
 */
export async function resolveProductIdForInventoryItem(
  inventoryItemGid: string
): Promise<string | null> {
  const data = await graphql<{
    inventoryItem: { variant: { product: { id: string } | null } | null } | null;
  }>(INVENTORY_ITEM_PRODUCT_QUERY, { id: inventoryItemGid });
  return data.inventoryItem?.variant?.product?.id ?? null;
}

export function getMetafield(
  p: ShopifyProduct,
  namespace: string,
  key: string
): string | null {
  const m = p.metafields.find((m) => m.namespace === namespace && m.key === key);
  return m?.value ?? null;
}
