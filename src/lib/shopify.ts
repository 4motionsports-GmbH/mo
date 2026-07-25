// Shopify Admin API client.
//
// Auth: OAuth client-credentials grant. Built against
// https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/client-credentials-grant
// (verified working 2026-05-28; see scripts/verify-shopify-auth.mjs).
// Tokens TTL ≈ 24h — cached in memory and refreshed when within
// REFRESH_BUFFER_MS of expiry.

import { planThrottleRetry, THROTTLE_MAX_RETRIES } from "./shopify-throttle.mjs";
import {
  planTransientRetry,
  isMutation,
  TRANSIENT_MAX_RETRIES,
} from "./shopify-retry.mjs";

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

interface ShopifyThrottleStatus {
  maximumAvailable?: number;
  currentlyAvailable?: number;
  restoreRate?: number;
}
interface ShopifyQueryCost {
  requestedQueryCost?: number;
  actualQueryCost?: number | null;
  throttleStatus?: ShopifyThrottleStatus;
}
interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string; extensions?: Record<string, unknown> }>;
  // Top-level cost block — present on every Admin GraphQL response, and the
  // source of the leaky-bucket state we use to time a throttle retry.
  extensions?: { cost?: ShopifyQueryCost };
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

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

async function graphql<T>(
  query: string,
  variables?: Record<string, unknown>,
  attempt = 0
): Promise<T> {
  const token = await getAdminToken();
  const url = `https://${storeDomain()}/admin/api/${apiVersion()}/graphql.json`;
  // Only idempotent ops (queries) are auto-retried on a transport failure — a
  // mutation might already have taken effect when a 502 / socket reset arrives, so
  // retrying it could double a write (see shopify-retry.mjs). `attempt` is a single
  // shared budget across throttle + transient retries, so the recursion always
  // terminates regardless of which failure modes interleave.
  const idempotent = !isMutation(query);

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token,
      },
      body: JSON.stringify({ query, variables }),
    });
  } catch (err) {
    // NETWORK-level failure: fetch() rejected before any response — a connect
    // timeout, socket reset or DNS hiccup, all surfaced by Node's undici as
    // `TypeError: fetch failed` (specifics on .cause). The request never
    // completed, so retrying an idempotent op is safe. Ride out a transient blip
    // with backoff; rethrow once the cap is hit (→ the webhook 500s so Shopify
    // redelivers, or a read path trips its bundled-catalog fallback).
    const plan = planTransientRetry({ networkError: true, idempotent, attempt });
    if (plan.retry) {
      console.warn(
        `[shopify] network error — retry ${attempt + 1}/${TRANSIENT_MAX_RETRIES} ` +
          `in ${plan.waitMs}ms (${(err as Error).message})`
      );
      await sleep(plan.waitMs);
      return graphql<T>(query, variables, attempt + 1);
    }
    throw err;
  }

  // Read the body once; a THROTTLED response is HTTP 200 with errors[] +
  // extensions.cost.throttleStatus, so we must parse before deciding.
  const text = await res.text();
  let json: GraphQLResponse<T> | null = null;
  try {
    json = text ? (JSON.parse(text) as GraphQLResponse<T>) : null;
  } catch {
    json = null;
  }

  // RIDE OUT a throttle (HTTP 429 or errors[] code THROTTLED) instead of throwing:
  // wait for the leaky bucket to refill the deficit, then retry. Only when the
  // retry cap is exhausted do we fall through and throw (last-resort fallback).
  const plan = planThrottleRetry({ json, httpStatus: res.status, attempt });
  if (plan.retry) {
    // DISTINCT log: a transient throttle we are RETRYING — not a hard failure.
    console.warn(
      `[shopify] THROTTLED — retry ${attempt + 1}/${THROTTLE_MAX_RETRIES} in ${plan.waitMs}ms ` +
        `(throttleStatus=${JSON.stringify(json?.extensions?.cost?.throttleStatus ?? {})})`
    );
    await sleep(plan.waitMs);
    return graphql<T>(query, variables, attempt + 1);
  }
  if (plan.reason === "max-retries-exhausted") {
    // DISTINCT log: throttling PERSISTED past the cap — this is a genuine degrade
    // (the caller's catch will fall back to the bundled catalog).
    console.error(
      `[shopify] THROTTLED — gave up after ${attempt} retries; the request is still ` +
        `rate-limited. Falling back. (throttleStatus=${JSON.stringify(json?.extensions?.cost?.throttleStatus ?? {})})`
    );
  }

  // RIDE OUT a transient upstream failure — a 502/503/504 (or 500/408) from
  // Shopify's origin or its Cloudflare front. DISTINCT from a throttle: the
  // request was fine, the server momentarily wasn't. Retry idempotent ops with
  // backoff; a mutation (or the exhausted cap) falls through to the throw below so
  // the error still surfaces.
  const transient = planTransientRetry({ httpStatus: res.status, idempotent, attempt });
  if (transient.retry) {
    console.warn(
      `[shopify] HTTP ${res.status} ${res.statusText} — retry ${attempt + 1}/` +
        `${TRANSIENT_MAX_RETRIES} in ${transient.waitMs}ms (transient upstream error)`
    );
    await sleep(transient.waitMs);
    return graphql<T>(query, variables, attempt + 1);
  }

  if (!res.ok) {
    throw new Error(`Shopify GraphQL ${res.status} ${res.statusText}: ${text.slice(0, 500)}`);
  }
  if (json?.errors?.length) {
    throw new Error(`Shopify GraphQL errors: ${JSON.stringify(json.errors)}`);
  }
  if (!json?.data) {
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
  barcode?: string | null; // GTIN/EAN as maintained in the admin ("Barcode")
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

export interface ShopifyProductSeo {
  title?: string | null;
  description?: string | null;
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
  seo?: ShopifyProductSeo | null;
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

// Product metafields are fetched via the generic `metafields(first:)`
// connection — scalar-only (namespace/key/value/type) — instead of a
// hardcoded alias list. This captures EVERYTHING the merchant maintains in
// the admin (custom.kurzinfo / kurztext / versandtyp / sperrgut / vorlaufzeit
// / liefereinheit, the reviews.* rating fields, the Search & Discovery
// complementary/related products, and the per-category taxonomy metafields
// like shopify.pull-up-bar) without a code change per new metafield.
//
// Reference-type metafields carry a GID (or JSON array of GIDs) in `value`.
// Instead of expanding references inline (which multiplied query cost by the
// products page size and forced the old 9-alias whitelist), the GIDs are
// resolved AFTER each page via one batched `nodes(ids:)` lookup with a
// per-run cache — taxonomy metaobjects (colors, materials, …) repeat across
// products, so the cache collapses most of the work. See
// resolveReferenceGids().
//
// 60 comfortably covers the store's densest products (the full metafield
// vocabulary across ALL categories is ~90 columns in the CSV export, but a
// single product only ever populates a small subset). pageInfo lets us warn
// if a product ever exceeds it instead of silently truncating.
const METAFIELDS_PAGE_SIZE = 60;

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
    seo {
      title
      description
    }
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
        barcode
        price
        compareAtPrice
        inventoryQuantity
        availableForSale
      }
    }
    metafields(first: ${METAFIELDS_PAGE_SIZE}) {
      pageInfo {
        hasNextPage
      }
      nodes {
        namespace
        key
        value
        type
      }
    }
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

// Raw metafield node from the generic `metafields(first:)` connection.
// `value` is the literal Shopify value: plain text/number, a JSON array for
// list types, or a GID / JSON array of GIDs for reference types.
interface RawMetafieldNode {
  namespace: string;
  key: string;
  value: string | null;
  type?: string | null;
}

interface RawMetaobjectField {
  key: string;
  value: string | null;
}
interface RawMetaobjectRef {
  // Empty (no `fields`) when the resolved node is not a Metaobject (the
  // inline fragment didn't match) or the metaobject has no fields.
  fields?: RawMetaobjectField[] | null;
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

// ---------------- Metafield reference resolution ----------------

/** GID → resolved display value. `null` marks a GID we tried and could not
 *  resolve (deleted node, unsupported type), so it is never re-queried. */
type ReferenceCache = Map<string, string | null>;

// Extract the reference GIDs a metafield value carries: a single GID for
// `*_reference` types, a JSON array of GIDs for `list.*_reference` types.
// Returns [] for plain values (including non-GID JSON like list.text or the
// reviews.rating JSON object), so callers can branch on "is this a reference".
function extractReferenceGids(value: string | null | undefined): string[] {
  if (!value) return [];
  const v = value.trim();
  if (v.startsWith("[")) {
    try {
      const arr: unknown = JSON.parse(v);
      return Array.isArray(arr)
        ? arr.filter((x): x is string => looksLikeGid(typeof x === "string" ? x : null))
        : [];
    } catch {
      return [];
    }
  }
  return looksLikeGid(v) ? [v] : [];
}

// File/media references (slide images, Zusatzbilder, …) are theme assets —
// the catalog's images come from the images connection, so resolving these
// would only add noise. Skipped wholesale.
function isFileReference(type: string | null | undefined): boolean {
  return typeof type === "string" && type.includes("file_reference");
}

// Batched lookup for reference GIDs collected from a page of products.
// Metaobjects (taxonomy values: colors, materials, pull-up-bar, …) resolve to
// their display label; Products (Search & Discovery complementary/related
// products) resolve to their HANDLE — the catalog's Product.id — so the
// mapper can link accessories directly. Chunked to stay far below the query
// cost ceiling; the per-run cache collapses repeats (taxonomy values are
// shared by many products).
const RESOLVE_REFERENCES_QUERY = /* GraphQL */ `
  query ResolveReferenceNodes($ids: [ID!]!) {
    nodes(ids: $ids) {
      __typename
      ... on Metaobject {
        id
        fields {
          key
          value
        }
      }
      ... on Product {
        id
        handle
      }
    }
  }
`;
const RESOLVE_CHUNK_SIZE = 50;

async function resolveReferenceGids(
  gids: Iterable<string>,
  cache: ReferenceCache
): Promise<void> {
  const pending = Array.from(new Set(gids)).filter((g) => !cache.has(g));
  for (let i = 0; i < pending.length; i += RESOLVE_CHUNK_SIZE) {
    const chunk = pending.slice(i, i + RESOLVE_CHUNK_SIZE);
    const data = await graphql<{
      nodes: Array<
        | ({ __typename?: string; id?: string; handle?: string } & RawMetaobjectRef)
        | null
      >;
    }>(RESOLVE_REFERENCES_QUERY, { ids: chunk });
    const byId = new Map<string, { handle?: string } & RawMetaobjectRef>();
    for (const node of data.nodes ?? []) {
      if (node?.id) byId.set(node.id, node);
    }
    for (const gid of chunk) {
      const node = byId.get(gid);
      if (!node) {
        cache.set(gid, null);
        continue;
      }
      cache.set(
        gid,
        typeof node.handle === "string" && node.handle
          ? node.handle
          : metaobjectDisplayValue(node)
      );
    }
  }
}

// Collect every reference GID a set of raw product nodes carries, so one
// batched resolution pass can warm the cache before mapping.
function collectReferenceGids(nodes: ProductNode[]): string[] {
  const gids: string[] = [];
  for (const n of nodes) {
    for (const mf of n.metafields?.nodes ?? []) {
      if (isFileReference(mf.type)) continue;
      gids.push(...extractReferenceGids(mf.value));
    }
  }
  return gids;
}

// Resolve one raw metafield node to a clean, human-readable string:
// - Reference (single/list) → resolved label(s)/handle(s), ", "-joined.
// - JSON list of plain strings (list.single_line_text_field …) → ", "-joined.
// - Plain value → as-is (the mapper parses JSON payloads like reviews.rating).
// Returns null (drop the metafield) for empty values, file references, and
// references that could not be resolved — a raw GID must never reach the
// catalog/frontend.
function resolveMetafieldNode(
  mf: RawMetafieldNode,
  cache: ReferenceCache,
  productId: string
): string | null {
  const value = mf.value;
  if (value == null || value === "") return null;
  if (isFileReference(mf.type)) return null;

  const gids = extractReferenceGids(value);
  if (gids.length > 0) {
    const parts = gids
      .map((g) => cache.get(g))
      .filter((v): v is string => !!v);
    if (parts.length === 0) {
      console.warn(
        `[shopify] product ${productId}: metafield ${mf.namespace}.${mf.key} references did not resolve (${value.slice(0, 80)}) — dropped`
      );
      return null;
    }
    return parts.join(", ");
  }

  // JSON list of plain strings → readable joined text.
  const v = value.trim();
  if (v.startsWith("[")) {
    try {
      const arr: unknown = JSON.parse(v);
      if (Array.isArray(arr) && arr.every((x) => typeof x === "string")) {
        const parts = (arr as string[]).map((s) => s.trim()).filter(Boolean);
        if (parts.length > 0) return parts.join(", ");
        return null;
      }
    } catch {
      // fall through — keep the raw value
    }
  }

  if (looksLikeGid(value)) {
    console.warn(
      `[shopify] product ${productId}: metafield ${mf.namespace}.${mf.key} is an unresolved reference (${value.slice(0, 80)}) — dropped`
    );
    return null;
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
  seo: ShopifyProductSeo | null;
  category: { fullName: string | null; name: string | null } | null;
  featuredImage: ShopifyProductImage | null;
  images: { nodes: ShopifyProductImage[] };
  variants: { nodes: ShopifyProductVariant[] };
  metafields: {
    pageInfo?: { hasNextPage?: boolean | null } | null;
    nodes: RawMetafieldNode[];
  } | null;
};

interface ProductsPage {
  products: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: ProductNode[];
  };
}

// One ProductNode (raw GraphQL) → the ShopifyProduct the mapper consumes,
// resolving each metafield reference to its display value via the pre-warmed
// cache. Shared by the full sync and the targeted webhook fetch so both
// produce identical shapes.
function mapProductNode(n: ProductNode, cache: ReferenceCache): ShopifyProduct {
  const metafields: ShopifyMetafield[] = [];
  if (n.metafields?.pageInfo?.hasNextPage) {
    console.warn(
      `[shopify] product ${n.id}: more than ${METAFIELDS_PAGE_SIZE} metafields — the overflow was not fetched (raise METAFIELDS_PAGE_SIZE)`
    );
  }
  for (const mf of n.metafields?.nodes ?? []) {
    const value = resolveMetafieldNode(mf, cache, n.id);
    if (value != null && value !== "") {
      metafields.push({
        namespace: mf.namespace,
        key: mf.key,
        value,
        type: mf.type ?? null,
      });
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
    seo: n.seo ?? null,
    category: n.category,
    featuredImage: n.featuredImage,
    images: n.images?.nodes ?? [],
    variants: n.variants?.nodes ?? [],
    totalInventory: n.totalInventory,
    tracksInventory: n.tracksInventory,
    metafields,
  };
}

// Pace the sequential pagination so the cost-based leaky bucket doesn't drain in
// a burst. Page size stays at the proven-safe 30 (raising it risks the per-query
// cost ceiling the metaobject expansions already push toward — see above); the
// small inter-page delay plus graphql()'s THROTTLED-retry are what keep the run
// on live Shopify data instead of throttling into the bundle fallback.
const INTER_PAGE_DELAY_MS = 500;

export async function fetchAllProducts(): Promise<ShopifyProduct[]> {
  const out: ShopifyProduct[] = [];
  // One reference cache for the whole run — taxonomy metaobjects (colors,
  // materials, …) repeat across products, so later pages resolve mostly from
  // cache instead of extra API calls.
  const cache: ReferenceCache = new Map();
  let cursor: string | null = null;
  let page = 0;
  while (true) {
    page++;
    const data: ProductsPage = await graphql<ProductsPage>(PRODUCTS_QUERY, { cursor });
    await resolveReferenceGids(collectReferenceGids(data.products.nodes), cache);
    for (const n of data.products.nodes) out.push(mapProductNode(n, cache));
    if (!data.products.pageInfo.hasNextPage) break;
    cursor = data.products.pageInfo.endCursor;
    if (!cursor) break;
    if (page > 500) throw new Error("fetchAllProducts: exceeded 500 pages — bailing out");
    // Polite pacing between pages (graphql() still rides out any actual throttle).
    await sleep(INTER_PAGE_DELAY_MS);
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
  // Non-Product nodes come back without a handle (the inline fragment didn't
  // match) — skip them defensively.
  const nodes = (data.nodes ?? []).filter(
    (n): n is ProductNode => !!n && typeof n.handle === "string"
  );
  const cache: ReferenceCache = new Map();
  await resolveReferenceGids(collectReferenceGids(nodes), cache);
  return nodes.map((n) => mapProductNode(n, cache));
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
