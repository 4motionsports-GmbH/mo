// Shopify Admin API operations for bundle offers (S10).
//
// This is the "create the Shopify product" SEAM behind which the two creation
// modes live (config flag BUNDLE_CREATION_MODE — see bundle-offer-core.mjs):
//
//   PRIMARY  native_fixed_bundle    productBundleCreate → poll node(id:) → … (spike §RECOMMENDED)
//   FALLBACK plain_unlisted_product productCreate (UNLISTED), components in body (spike §6a)
//
// EVERYTHING around the create step is shared (finalizeBundleProduct +
// pollParentVariantInventory + archiveBundleProduct), so switching modes is a
// localized swap of just the create call — exactly as the spike de-risks it.
//
// ⚠️ Mutation shapes are taken from the LIVE-VERIFIED probe sequence
// (scripts/probe-bundle.mjs; "Probe results (S9b, 2026-06-13)" in
// docs/BUNDLES_SPIKE.md), NOT from memory. The verified, version-pinned (2026-04)
// facts this relies on:
//   - productBundleCreate(input: ProductBundleCreateInput!) returns a
//     ProductBundleOperation; the product populates only at lifecycle COMPLETE
//     and is read via the GENERIC node(id:) interface (there is NO top-level
//     productBundleOperation(id:) field).
//   - userErrors types DIFFER: productBundleCreate → plain UserError (field,
//     message; NO `code`); productVariantsBulkUpdate →
//     ProductVariantsBulkUpdateUserError (field, message, code). We select per
//     each mutation's real type — never a shared shape.
//   - productUpdate takes `product: ProductUpdateInput!`.
//   - Publishing to the Online Store needs read_publications + write_publications
//     (the §1 "write_products is enough" claim was DISPROVED by the probe).
//
// Scope: read_products + write_products (create/price/status) AND
// read_publications + write_publications (publish) — for BOTH paths. The app
// must be (re)installed after any scope change for the client-credentials token
// to carry them. assertPublicationScopes() fails loud if they're missing.

import { adminGraphql } from "./shopify";
import { parseNumericVariantId } from "./shopify-cart-url.mjs";
import { escapeHtml } from "./html-escape";
import {
  NATIVE_FIXED_BUNDLE,
  PLAIN_UNLISTED_PRODUCT,
  pickBundleCreator,
} from "./bundle-offer-core.mjs";

// ── Shared types ─────────────────────────────────────────────────────────────

/** A component snapshot as persisted on the offer (subset used by the seam). */
export interface BundleComponentSnapshot {
  productId: string; // catalog id == Shopify handle
  title: string;
  variantId: string; // parent variant GID or numeric — the chosen variant
  numericVariantId: string | null;
  quantity: number;
  unitPrice: string;
  currency: string;
}

export interface CreateBundleProductArgs {
  mode: string;
  title: string;
  components: BundleComponentSnapshot[];
  bundlePrice: string; // Money string
  /** True component sum to write as compareAtPrice, or null per the PAngV rule. */
  compareAtPrice: string | null;
}

export interface CreatedBundleProduct {
  productId: string; // gid://shopify/Product/...
  variantId: string; // parent variant gid
  numericVariantId: string | null;
  handle: string | null;
  operationId: string | null; // ProductBundleOperation gid (native only)
  availableForSale: boolean | null;
}

/** A "bare" created product (DRAFT) returned by a seam impl before shared steps. */
interface BareCreatedProduct {
  productId: string;
  variantId: string;
  handle: string | null;
  operationId: string | null;
}

// ── Polling budgets (observed ~2 polls / ~2s in the probe) ───────────────────

const OP_POLL_MAX_ATTEMPTS = 15;
const OP_POLL_INTERVAL_MS = 1500;
const INV_POLL_MAX_ATTEMPTS = 8;
const INV_POLL_INTERVAL_MS = 1500;

const ONLINE_STORE_PUBLICATION = "Online Store";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface UserError {
  field?: string[] | null;
  message: string;
  code?: string | null;
}

function throwOnUserErrors(label: string, errors: UserError[] | null | undefined): void {
  if (errors && errors.length > 0) {
    throw new Error(`${label} userErrors: ${JSON.stringify(errors)}`);
  }
}

// ── Scope guard ──────────────────────────────────────────────────────────────

/**
 * Confirm the client-credentials token carries BOTH read_publications and
 * write_publications before we attempt any create+publish flow. The probe
 * proved publishing returns ACCESS_DENIED without them, and a native bundle
 * that can't be published is not purchasable — so we fail LOUD here rather than
 * leaving a half-built, unbuyable product behind (the spike's "STOP and report"
 * instruction). Applies to the §6a fallback too (same publishablePublish call).
 */
export async function assertPublicationScopes(): Promise<void> {
  const data = await adminGraphql<{
    currentAppInstallation: { accessScopes: Array<{ handle: string }> } | null;
  }>(`{ currentAppInstallation { accessScopes { handle } } }`);
  const granted = new Set(
    (data.currentAppInstallation?.accessScopes ?? []).map((s) => s.handle)
  );
  const required = ["read_publications", "write_publications"];
  const missing = required.filter((s) => !granted.has(s));
  if (missing.length) {
    throw new Error(
      `Bundle publishing requires Shopify scope(s) ${missing.join(" + ")}, which the ` +
        `app's token does NOT hold. Add them in the Dev Dashboard and REINSTALL the app ` +
        `on the store (client-credentials tokens only carry scopes granted at install), ` +
        `then retry. See docs/BUNDLES.md → "Required Shopify scopes".`
    );
  }
}

// ── Component resolution (native path needs the product GID + optionSelections) ─

interface LiveProduct {
  id: string; // product GID
  options: Array<{ id: string; name: string }>;
  variants: Array<{ id: string; selectedOptions: Array<{ name: string; value: string }> }>;
}

async function resolveLiveProductByHandle(handle: string): Promise<LiveProduct | null> {
  // `product(handle:)` historically isn't on the Admin query root; the robust,
  // version-stable lookup is products(query:"handle:…"). The catalog product id
  // IS the Shopify handle (see catalog-mapping.ts: `id: p.handle`).
  const data = await adminGraphql<{
    products: {
      nodes: Array<{
        id: string;
        options: Array<{ id: string; name: string }>;
        variants: { nodes: Array<{ id: string; selectedOptions: Array<{ name: string; value: string }> }> };
      }>;
    };
  }>(
    `query ResolveBundleComponent($q: String!) {
       products(first: 1, query: $q) {
         nodes {
           id
           options { id name }
           variants(first: 100) { nodes { id selectedOptions { name value } } }
         }
       }
     }`,
    { q: `handle:${handle}` }
  );
  const node = data.products?.nodes?.[0];
  if (!node) return null;
  return { id: node.id, options: node.options ?? [], variants: node.variants?.nodes ?? [] };
}

interface ProductBundleComponentInput {
  quantity: number;
  productId: string;
  optionSelections: Array<{ componentOptionId: string; name: string; values: string[] }>;
}

/**
 * Build the productBundleCreate `components` input from the offer's component
 * snapshots: for each component we resolve the live product (GID + options) and
 * pin every option to the chosen variant's value, exactly as the probe does.
 */
async function buildBundleComponentInputs(
  components: BundleComponentSnapshot[]
): Promise<ProductBundleComponentInput[]> {
  const out: ProductBundleComponentInput[] = [];
  for (const c of components) {
    const live = await resolveLiveProductByHandle(c.productId);
    if (!live) {
      throw new Error(`Bundle component not found on Shopify: handle "${c.productId}"`);
    }
    // Match the snapshotted variant by numeric id; fall back to the first variant.
    const variant =
      live.variants.find((v) => parseNumericVariantId(v.id) === c.numericVariantId) ??
      live.variants[0];
    const optionSelections = live.options.map((opt) => {
      const sel = variant?.selectedOptions?.find((s) => s.name === opt.name);
      return {
        componentOptionId: opt.id,
        name: opt.name,
        values: [sel?.value ?? "Default Title"],
      };
    });
    out.push({ quantity: c.quantity, productId: live.id, optionSelections });
  }
  return out;
}

// ── Seam impl 1: native fixed bundle ─────────────────────────────────────────

async function createNativeFixedBundleProduct(
  args: CreateBundleProductArgs
): Promise<BareCreatedProduct> {
  const components = await buildBundleComponentInputs(args.components);

  // productBundleCreate → ProductBundleOperation. userErrors are plain UserError
  // (field + message ONLY — no `code`; asking for code is a validation error
  // that aborts the mutation, the S9b false-negative).
  const created = await adminGraphql<{
    productBundleCreate: {
      productBundleOperation: { id: string; status: string } | null;
      userErrors: UserError[];
    };
  }>(
    `mutation BundleCreate($input: ProductBundleCreateInput!) {
       productBundleCreate(input: $input) {
         productBundleOperation { id status }
         userErrors { field message }
       }
     }`,
    { input: { title: args.title, components } }
  );
  throwOnUserErrors("productBundleCreate", created.productBundleCreate?.userErrors);
  const operationId = created.productBundleCreate?.productBundleOperation?.id ?? null;
  if (!operationId) {
    throw new Error("productBundleCreate returned no ProductBundleOperation id");
  }

  // Poll the operation via the GENERIC node(id:) interface. The product
  // populates only at COMPLETE; break as soon as a product GID is present.
  const t0 = Date.now();
  let product: { id: string; handle: string | null; variantId: string | null } | null = null;
  for (let attempt = 1; attempt <= OP_POLL_MAX_ATTEMPTS; attempt++) {
    const polled = await adminGraphql<{
      node: {
        id: string;
        status: string;
        product: { id: string; handle: string | null; variants: { nodes: Array<{ id: string }> } } | null;
        userErrors: UserError[] | null;
      } | null;
    }>(
      `query PollBundleOperation($id: ID!) {
         node(id: $id) {
           ... on ProductBundleOperation {
             id status
             product { id handle variants(first: 5) { nodes { id } } }
             userErrors { field message }
           }
         }
       }`,
      { id: operationId }
    );
    const op = polled.node;
    throwOnUserErrors("ProductBundleOperation", op?.userErrors);
    if (op?.product?.id) {
      product = {
        id: op.product.id,
        handle: op.product.handle ?? null,
        variantId: op.product.variants?.nodes?.[0]?.id ?? null,
      };
      break;
    }
    if (op?.status === "COMPLETE") {
      throw new Error(
        `ProductBundleOperation ${operationId} COMPLETE but returned no product`
      );
    }
    if (attempt < OP_POLL_MAX_ATTEMPTS) await sleep(OP_POLL_INTERVAL_MS);
  }
  if (!product?.variantId) {
    throw new Error(
      `ProductBundleOperation ${operationId} did not complete within ${OP_POLL_MAX_ATTEMPTS} polls / ${Date.now() - t0}ms`
    );
  }
  return {
    productId: product.id,
    variantId: product.variantId,
    handle: product.handle,
    operationId,
  };
}

// ── Seam impl 2: plain UNLISTED product (fallback, spike §6a) ─────────────────

function componentsDescriptionHtml(components: BundleComponentSnapshot[]): string {
  const items = components
    .map((c) => {
      const qty = c.quantity > 1 ? `${c.quantity}× ` : "";
      return `<li>${qty}${escapeHtml(c.title)}</li>`;
    })
    .join("");
  return `<p>Dieses Set enthält:</p><ul>${items}</ul>`;
}

async function createPlainUnlistedProduct(
  args: CreateBundleProductArgs
): Promise<BareCreatedProduct> {
  // A single-variant product at the bundle price; components listed in the body
  // (the only fulfilment linkage on this path — see the spike §6a CON). Created
  // DRAFT; the SHARED finalize step prices it + flips it to UNLISTED + publishes,
  // identical to the native path. No native inventory linkage on this path.
  const created = await adminGraphql<{
    productCreate: {
      product: { id: string; handle: string | null; variants: { nodes: Array<{ id: string }> } } | null;
      userErrors: UserError[];
    };
  }>(
    `mutation BundleFallbackCreate($product: ProductCreateInput!) {
       productCreate(product: $product) {
         product { id handle variants(first: 1) { nodes { id } } }
         userErrors { field message }
       }
     }`,
    {
      product: {
        title: args.title,
        descriptionHtml: componentsDescriptionHtml(args.components),
        status: "DRAFT",
      },
    }
  );
  throwOnUserErrors("productCreate", created.productCreate?.userErrors);
  const product = created.productCreate?.product;
  const variantId = product?.variants?.nodes?.[0]?.id ?? null;
  if (!product?.id || !variantId) {
    throw new Error("productCreate returned no product / default variant");
  }
  return {
    productId: product.id,
    variantId,
    handle: product.handle ?? null,
    operationId: null,
  };
}

// The seam registry — dispatched by validated mode via pickBundleCreator.
const BUNDLE_CREATORS: Record<
  string,
  (args: CreateBundleProductArgs) => Promise<BareCreatedProduct>
> = {
  [NATIVE_FIXED_BUNDLE]: createNativeFixedBundleProduct,
  [PLAIN_UNLISTED_PRODUCT]: createPlainUnlistedProduct,
};

// ── Shared steps (identical for both paths) ──────────────────────────────────

/**
 * Step 3–5: price the parent variant (price + PAngV-safe compareAtPrice), flip
 * the product to UNLISTED, and publish it to the Online Store. Shared by both
 * creation modes.
 */
async function finalizeBundleProduct(
  productId: string,
  variantId: string,
  bundlePrice: string,
  compareAtPrice: string | null
): Promise<void> {
  // 3. price + compare-at. userErrors here ARE ProductVariantsBulkUpdateUserError
  //    (has `code`) — a different type from productBundleCreate's plain UserError.
  const variantInput: { id: string; price: string; compareAtPrice?: string | null } = {
    id: variantId,
    price: bundlePrice,
    // Explicitly clear any inherited compare-at when the rule says "no strike".
    compareAtPrice: compareAtPrice ?? null,
  };
  const priced = await adminGraphql<{
    productVariantsBulkUpdate: { userErrors: UserError[] };
  }>(
    `mutation BundlePrice($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
       productVariantsBulkUpdate(productId: $productId, variants: $variants) {
         productVariants { id price compareAtPrice }
         userErrors { field message code }
       }
     }`,
    { productId, variants: [variantInput] }
  );
  throwOnUserErrors("productVariantsBulkUpdate", priced.productVariantsBulkUpdate?.userErrors);

  // 4. status → UNLISTED (productUpdate takes `product: ProductUpdateInput!`).
  const updated = await adminGraphql<{
    productUpdate: { product: { id: string; status: string } | null; userErrors: UserError[] };
  }>(
    `mutation BundleUnlist($product: ProductUpdateInput!) {
       productUpdate(product: $product) {
         product { id status }
         userErrors { field message }
       }
     }`,
    { product: { id: productId, status: "UNLISTED" } }
  );
  throwOnUserErrors("productUpdate(UNLISTED)", updated.productUpdate?.userErrors);

  // 5. publish to the Online Store publication.
  const pubs = await adminGraphql<{
    publications: { nodes: Array<{ id: string; name: string }> };
  }>(`{ publications(first: 20) { nodes { id name } } }`);
  const onlineStore = (pubs.publications?.nodes ?? []).find(
    (p) => p.name === ONLINE_STORE_PUBLICATION
  );
  if (!onlineStore) {
    throw new Error(
      `"${ONLINE_STORE_PUBLICATION}" publication not found (have: ${(pubs.publications?.nodes ?? [])
        .map((p) => p.name)
        .join(", ")})`
    );
  }
  const published = await adminGraphql<{
    publishablePublish: { userErrors: UserError[] };
  }>(
    `mutation BundlePublish($id: ID!, $input: [PublicationInput!]!) {
       publishablePublish(id: $id, input: $input) {
         publishable { availablePublicationsCount { count } }
         userErrors { field message }
       }
     }`,
    { id: productId, input: [{ publicationId: onlineStore.id }] }
  );
  throwOnUserErrors("publishablePublish", published.publishablePublish?.userErrors);
}

/**
 * Step 6: re-poll the parent variant inventory until availableForSale settles
 * (a fixed bundle computes its inventory from components asynchronously — the
 * probe saw it settle on the 1st re-poll). Best-effort: returns the last-read
 * availability rather than throwing, so a slow settle never fails an otherwise
 * fully-created offer.
 */
async function pollParentVariantInventory(
  productId: string,
  variantId: string
): Promise<boolean | null> {
  let available: boolean | null = null;
  for (let attempt = 1; attempt <= INV_POLL_MAX_ATTEMPTS; attempt++) {
    const data = await adminGraphql<{
      product: { variants: { nodes: Array<{ id: string; availableForSale: boolean }> } } | null;
    }>(
      `query BundleInventory($id: ID!) {
         product(id: $id) {
           variants(first: 5) { nodes { id availableForSale } }
         }
       }`,
      { id: productId }
    );
    const variant =
      (data.product?.variants?.nodes ?? []).find((v) => v.id === variantId) ??
      data.product?.variants?.nodes?.[0];
    available = variant?.availableForSale ?? null;
    if (available === true) break;
    if (attempt < INV_POLL_MAX_ATTEMPTS) await sleep(INV_POLL_INTERVAL_MS);
  }
  return available;
}

// ── Public seam entry point ──────────────────────────────────────────────────

/**
 * Create the Shopify bundle product end-to-end (seam create + shared finalize +
 * inventory settle), selecting the impl by BUNDLE_CREATION_MODE. Throws on any
 * failure so the service layer can record status='failed' and (best-effort)
 * archive a partial product.
 */
export async function createBundleProduct(
  args: CreateBundleProductArgs
): Promise<CreatedBundleProduct> {
  // STOP-and-report scope precheck (both paths need the publication scopes).
  await assertPublicationScopes();

  const creator = pickBundleCreator(BUNDLE_CREATORS, args.mode);
  const bare = await creator(args);
  await finalizeBundleProduct(bare.productId, bare.variantId, args.bundlePrice, args.compareAtPrice);
  const availableForSale = await pollParentVariantInventory(bare.productId, bare.variantId);

  return {
    productId: bare.productId,
    variantId: bare.variantId,
    numericVariantId: parseNumericVariantId(bare.variantId),
    handle: bare.handle,
    operationId: bare.operationId,
    availableForSale,
  };
}

/**
 * Archive (NOT delete) a bundle's Shopify product — the expiry path and the
 * failure-cleanup path. ARCHIVE preserves order history, is reversible, and
 * leaves the record intact for audit/KPIs (spike §5). Idempotent: archiving an
 * already-archived product is a harmless no-op on Shopify's side.
 */
export async function archiveBundleProduct(productId: string): Promise<void> {
  const data = await adminGraphql<{
    productUpdate: { product: { id: string; status: string } | null; userErrors: UserError[] };
  }>(
    `mutation BundleArchive($product: ProductUpdateInput!) {
       productUpdate(product: $product) {
         product { id status }
         userErrors { field message }
       }
     }`,
    { product: { id: productId, status: "ARCHIVED" } }
  );
  throwOnUserErrors("productUpdate(ARCHIVED)", data.productUpdate?.userErrors);
}
