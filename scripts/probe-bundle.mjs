#!/usr/bin/env node
// scripts/probe-bundle.mjs — THROWAWAY verification probe for S9b.
//
// Purpose: answer the two [VERIFY] follow-ups in docs/BUNDLES_SPIKE.md (§1
// capability, §3 purchasability) against the LIVE store before S10 commits to
// the native-fixed-bundle architecture. This is NOT bundle-service code — it
// creates ONE disposable probe bundle, proves (as far as is possible
// server-side) that it is purchasable via a /cart/<variant>:1 permalink, and
// then ARCHIVES everything it created. Safe to delete after S9b is closed.
//
// Run (loads .env like the other scripts):
//   node --env-file=.env scripts/probe-bundle.mjs
//
// It reuses the real backend client so the auth/transport path is identical to
// production:
//   - adminGraphql / shopifyApiVersion / isShopifyConfigured  (src/lib/shopify.ts)
//   - parseNumericVariantId / SHOP_DOMAIN  (src/lib/shopify-cart-url.mjs, the
//     module that src/lib/cart.ts re-exports parseNumericVariantId from)
//
// ─── Doc-sourcing / "don't trust training data" note ──────────────────────────
// docs/BUNDLES_SPIKE.md records that shopify.dev returns HTTP 403 to automated
// fetches, so this probe does NOT trust memorised mutation shapes. Before it
// calls anything it INTROSPECTS the live 2026-04 schema (preflight()) and
// asserts that every input field / mutation argument it intends to use actually
// exists on the live server, printing the real shapes it found. If memory was
// wrong, the probe aborts loudly with the live schema dump instead of firing a
// malformed mutation. This includes each mutation's userErrors sub-selection:
// these mutations use DIFFERENT userError types (productBundleCreate → plain
// UserError with NO `code`; productVariantsBulkUpdate →
// ProductVariantsBulkUpdateUserError; etc.), so the selection is derived from
// the live schema rather than assuming a shared `{ field message code }` shape.
// (Hardcoding `code` on productBundleCreate is what caused the S9b
// false-negative: Shopify rejected the query at validation and the old
// classifier misread that bug as "capability not available".) A capability
// verdict is ONLY ever drawn from a genuine access/ownership error — never from
// a validation error, which always fails loud as a probe bug.
// Canonical docs (open in a browser to confirm):
//   productBundleCreate       — /mutations/productBundleCreate
//   ProductBundleOperation    — /objects/ProductBundleOperation
//   productVariantsBulkUpdate — /mutations/productVariantsBulkUpdate
//   productUpdate             — /mutations/productUpdate
//   publishablePublish        — /mutations/publishablePublish
//   ProductStatus (UNLISTED)  — /enums/ProductStatus
// (all under https://shopify.dev/docs/api/admin-graphql/2026-04/)

import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";
import {
  adminGraphql,
  shopifyApiVersion,
  isShopifyConfigured,
} from "../src/lib/shopify.ts";
import {
  parseNumericVariantId,
  SHOP_DOMAIN,
} from "../src/lib/shopify-cart-url.mjs";

// A nominal throwaway price for the bundle's parent variant (§Check-2 step 4).
const NOMINAL_PRICE = "1.00";
const NOMINAL_CURRENCY = "EUR";
// Poll budget for the async ProductBundleOperation (§Check-1 step 3).
const POLL_MAX_ATTEMPTS = 15;
const POLL_INTERVAL_MS = 1500;

// Everything the probe learns, echoed as a paste-ready block at the very end so
// the findings can be dropped into docs/BUNDLES_SPIKE.md.
// shopifyApiVersion() throws if SHOPIFY_API_VERSION is unset, so resolve it
// defensively — the configured-check below handles the missing-credentials case.
let resolvedApiVersion = "(unconfigured)";
try {
  resolvedApiVersion = shopifyApiVersion();
} catch {
  /* not configured — reported by the isShopifyConfigured() guard in main() */
}

const report = {
  apiVersion: resolvedApiVersion,
  shop: null,
  capability: null, // "YES" | "NO"
  capabilityError: null,
  components: [],
  operationId: null,
  pollCount: null,
  pollMs: null,
  bundleProductId: null,
  parentVariantId: null,
  numericVariantId: null,
  priceUpdate: null,
  compareAtPrice: null,
  componentsSum: null,
  statusUnlisted: null,
  published: null,
  publicationId: null,
  cartPermalink: null,
  purchasability: null,
  archived: [],
  recommendation: null,
};

function section(title) {
  console.log(`\n${"─".repeat(72)}\n${title}\n${"─".repeat(72)}`);
}

// ── introspection helpers (live-schema self-verification) ─────────────────────

// Unwrap a (possibly NON_NULL/LIST wrapped) introspection type ref to its
// underlying named type.
function namedType(t) {
  let cur = t;
  while (cur) {
    if (cur.kind === "NON_NULL" || cur.kind === "LIST") {
      cur = cur.ofType;
      continue;
    }
    return cur.name ?? null;
  }
  return null;
}

const TYPE_REF = `type { kind name ofType { kind name ofType { kind name ofType { kind name } } } }`;

async function introspectInputType(name) {
  const data = await adminGraphql(
    `query I($n: String!) { __type(name: $n) { name kind inputFields { name ${TYPE_REF} } } }`,
    { n: name }
  );
  return data.__type;
}

async function introspectEnum(name) {
  const data = await adminGraphql(
    `query E($n: String!) { __type(name: $n) { name kind enumValues { name } } }`,
    { n: name }
  );
  return data.__type;
}

// Map of mutation field name -> { args: [{ arg, type }], payload } for the
// mutations we use, so we can discover (not assume) e.g. whether productUpdate
// takes `input: ProductInput!` or `product: ProductUpdateInput!`, AND the name
// of each mutation's payload type (needed to derive its userErrors shape).
async function introspectMutations() {
  const data = await adminGraphql(
    `{ __schema { mutationType {
         fields { name ${TYPE_REF} args { name ${TYPE_REF} } }
       } } }`
  );
  const map = new Map();
  for (const f of data.__schema.mutationType.fields) {
    map.set(f.name, {
      args: f.args.map((a) => ({ arg: a.name, type: namedType(a.type) })),
      payload: namedType(f.type),
    });
  }
  return map;
}

// Introspect an OBJECT type's fields (name + type ref), cached.
const objectTypeCache = new Map();
async function introspectObjectType(name) {
  if (objectTypeCache.has(name)) return objectTypeCache.get(name);
  const data = await adminGraphql(
    `query O($n: String!) { __type(name: $n) { name kind fields { name ${TYPE_REF} } } }`,
    { n: name }
  );
  objectTypeCache.set(name, data.__type);
  return data.__type;
}

// The userErrors fields we'd like, in preference order. `code` is INTENTIONALLY
// optional: these mutations use DIFFERENT userError types and not all define
// `code` — productBundleCreate's userErrors are plain `UserError` (field +
// message only). Hardcoding `code` there is exactly what caused the S9b
// false-negative (Shopify rejected the whole query at validation, and the old
// classifier misread that as "capability not available"). So we NEVER assume a
// shared shape: we derive each selection from the live schema.
const WANT_UE_FIELDS = ["field", "message", "code"];

// Given a type that has a `userErrors` field (a mutation payload OR an object
// like ProductBundleOperation), return the space-joined selection of userErrors
// sub-fields that ACTUALLY exist on its specific userError type.
async function userErrorsSelectionForType(ownerTypeName) {
  const owner = await introspectObjectType(ownerTypeName);
  const ueField = (owner?.fields ?? []).find((f) => f.name === "userErrors");
  if (!ueField) return { ueType: null, selection: "" };
  const ueType = namedType(ueField.type);
  const ueObj = await introspectObjectType(ueType);
  const have = new Set((ueObj?.fields ?? []).map((f) => f.name));
  const selection = WANT_UE_FIELDS.filter((f) => have.has(f));
  // field+message are universal on Shopify userError types; fall back to them
  // defensively so we never emit an empty `userErrors { }` selection.
  return { ueType, selection: (selection.length ? selection : ["field", "message"]).join(" ") };
}

// Resolve a mutation's userErrors selection from its payload type, logging the
// concrete userError type + fields discovered on the live schema.
async function mutationUserErrorsSelection(mutMap, mutationName) {
  const info = mutMap.get(mutationName);
  if (!info?.payload) throw new Error(`[preflight] no payload type for ${mutationName}`);
  const { ueType, selection } = await userErrorsSelectionForType(info.payload);
  console.log(`  ${mutationName}: ${info.payload}.userErrors is ${ueType} { ${selection} }`);
  return selection;
}

// ── error classification (a capability verdict must NEVER come from a bug) ─────

// A GraphQL VALIDATION / undefined-field / bad-input error means the PROBE
// built a malformed request — a script bug. It must fail loud, never be
// reported as a capability verdict.
function isValidationError(msg) {
  return /doesn't exist on type|undefinedField|Field '[^']*' doesn't exist|argumentLiteralsIncompatible|argumentNotAccepted|InvalidValue|Parse error|parse error|Expected (?:type|value)|wasn't provided|is required but|was provided invalid|Variable \$|no field|fieldConflict|selectionMismatch/i.test(
    msg
  );
}

// ONLY genuine access / ownership / permission failures count as "capability
// not available" (merchant must install the free Shopify Bundles app, or fall
// back to §6a). Note: deliberately does NOT match a bare "bundle"/"capability"
// substring — that over-broad match is what swallowed the validation error.
function isGenuineAccessError(msg) {
  return /ACCESS_DENIED|access denied|denied access|not approved|must install|must have access|does not have access|requires? [^.]*scope|missing [^.]*scope|not authoriz|unauthoriz|forbidden|permission|app is not allowed|not (?:been )?(?:granted|enabled)[^.]*bundle|bundle[^.]*not[^.]*(?:enabled|available|approved)/i.test(
    msg
  );
}

function assertFields(typeObj, label, required) {
  if (!typeObj) throw new Error(`[preflight] input type ${label} not found in live schema`);
  const have = new Set((typeObj.inputFields ?? []).map((f) => f.name));
  const missing = required.filter((r) => !have.has(r));
  console.log(
    `  ${label}: [${[...have].join(", ")}]` +
      (missing.length ? `  ⚠ MISSING ${missing.join(", ")}` : "  ✓")
  );
  if (missing.length) {
    throw new Error(
      `[preflight] live ${label} is missing expected field(s): ${missing.join(", ")}. ` +
        `Re-check the 2026-04 schema before building S10.`
    );
  }
}

// Discover the argument name + input type for a mutation, asserting the input
// type carries the fields we need. Returns { arg, type }.
function pickArg(mutMap, mutation, acceptableTypes) {
  const info = mutMap.get(mutation);
  if (!info) throw new Error(`[preflight] mutation ${mutation} not found in live schema`);
  const args = info.args;
  const hit = args.find((a) => acceptableTypes.includes(a.type));
  if (!hit) {
    throw new Error(
      `[preflight] ${mutation} has no argument of type ${acceptableTypes.join("|")} ` +
        `(found: ${args.map((a) => `${a.arg}:${a.type}`).join(", ")})`
    );
  }
  return hit;
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`[probe-bundle] S9b verification probe — API ${report.apiVersion}`);

  if (!isShopifyConfigured()) {
    console.log(
      "\nSKIPPED — Shopify is not configured in this environment.\n" +
        "  Missing one of SHOPIFY_STORE_DOMAIN / SHOPIFY_CLIENT_ID /\n" +
        "  SHOPIFY_CLIENT_SECRET / SHOPIFY_API_VERSION.\n" +
        "  This probe must run against the LIVE store. Provide a .env (see\n" +
        "  .env.example) and re-run:  node --env-file=.env scripts/probe-bundle.mjs\n"
    );
    // Clean (no crash) exit — there is nothing to verify without credentials.
    process.exitCode = 0;
    return;
  }

  // Sanity: who are we talking to?
  const shopData = await adminGraphql(
    `{ shop { name myshopifyDomain plan { displayName } } }`
  );
  report.shop = shopData.shop;
  console.log(
    `  shop=${shopData.shop?.name} (${shopData.shop?.myshopifyDomain}) plan=${shopData.shop?.plan?.displayName}`
  );

  // ── PREFLIGHT: verify mutation/field shapes against the LIVE schema ──────────
  section("PREFLIGHT — verifying mutation shapes against the live 2026-04 schema");
  const mutMap = await introspectMutations();

  const bundleCreateInput = await introspectInputType("ProductBundleCreateInput");
  assertFields(bundleCreateInput, "ProductBundleCreateInput", ["title", "components"]);
  const componentInput = await introspectInputType("ProductBundleComponentInput");
  assertFields(componentInput, "ProductBundleComponentInput", [
    "quantity",
    "productId",
    "optionSelections",
  ]);
  const optionSelInput = await introspectInputType(
    "ProductBundleComponentOptionSelectionInput"
  );
  assertFields(optionSelInput, "ProductBundleComponentOptionSelectionInput", [
    "componentOptionId",
    "name",
    "values",
  ]);
  const variantsBulkInput = await introspectInputType("ProductVariantsBulkInput");
  assertFields(variantsBulkInput, "ProductVariantsBulkInput", [
    "id",
    "price",
    "compareAtPrice",
  ]);
  const pubInput = await introspectInputType("PublicationInput");
  assertFields(pubInput, "PublicationInput", ["publicationId"]);

  // productUpdate arg name differs across versions — discover it.
  const productUpdateArg = pickArg(mutMap, "productUpdate", [
    "ProductUpdateInput",
    "ProductInput",
  ]);
  console.log(
    `  productUpdate uses arg "${productUpdateArg.arg}: ${productUpdateArg.type}"  ✓`
  );
  const productUpdateInputType = await introspectInputType(productUpdateArg.type);
  assertFields(productUpdateInputType, productUpdateArg.type, ["id", "status"]);

  // Confirm UNLISTED exists in the live ProductStatus enum (§3 — newer enum).
  const statusEnum = await introspectEnum("ProductStatus");
  const statuses = (statusEnum?.enumValues ?? []).map((v) => v.name);
  console.log(`  ProductStatus: [${statuses.join(", ")}]`);
  if (!statuses.includes("UNLISTED")) {
    throw new Error(
      "[preflight] ProductStatus.UNLISTED is NOT present on the live schema — " +
        "§3 assumption is wrong; STOP and revisit the spike."
    );
  }
  if (!statuses.includes("ARCHIVED")) {
    throw new Error("[preflight] ProductStatus.ARCHIVED missing — cleanup would fail.");
  }

  // Derive each mutation's userErrors selection from the LIVE schema — these
  // mutations use DIFFERENT userError types, so we never assume `code` exists.
  console.log("  userErrors shapes (derived, not assumed):");
  const ueCreate = await mutationUserErrorsSelection(mutMap, "productBundleCreate");
  const ueVariants = await mutationUserErrorsSelection(mutMap, "productVariantsBulkUpdate");
  const uePublish = await mutationUserErrorsSelection(mutMap, "publishablePublish");
  const ueProductUpdate = await mutationUserErrorsSelection(mutMap, "productUpdate");
  // ProductBundleOperation is an object (queried while polling), not a mutation,
  // but it also exposes userErrors — derive its selection the same way.
  const { selection: ueOperation } = await userErrorsSelectionForType(
    "ProductBundleOperation"
  );
  console.log(`  ProductBundleOperation.userErrors { ${ueOperation} }`);

  // Helper that builds + runs productUpdate with the discovered arg name +
  // schema-derived userErrors selection.
  async function productUpdate(fields) {
    const q = `mutation U($p: ${productUpdateArg.type}!) {
      productUpdate(${productUpdateArg.arg}: $p) {
        product { id status }
        userErrors { ${ueProductUpdate} }
      }
    }`;
    const d = await adminGraphql(q, { p: fields });
    const ue = d.productUpdate?.userErrors ?? [];
    if (ue.length) throw new Error(`productUpdate userErrors: ${JSON.stringify(ue)}`);
    return d.productUpdate.product;
  }

  const createdProductIds = [];
  try {
    // ── CHECK 1 — CAPABILITY ──────────────────────────────────────────────────
    section("CHECK 1 — CAPABILITY (productBundleCreate)");

    // 1. Pick two cheap, in-stock catalog products/variants — fetched live, not
    //    hardcoded. We read the product's options + the chosen variant's
    //    selectedOptions so we can build a valid optionSelections mapping.
    const catalog = await adminGraphql(
      `{ products(first: 60, query: "status:active") {
           nodes {
             id title status
             options { id name }
             variants(first: 5) {
               nodes { id title price availableForSale selectedOptions { name value } }
             }
           }
         } }`
    );
    const candidates = [];
    for (const p of catalog.products.nodes) {
      const v = (p.variants?.nodes ?? []).find(
        (x) => x.availableForSale && Number(x.price) > 0
      );
      if (!v) continue;
      candidates.push({ product: p, variant: v, price: Number(v.price) });
    }
    candidates.sort((a, b) => a.price - b.price);
    const chosen = candidates.slice(0, 2);
    if (chosen.length < 2) {
      throw new Error(
        `Need 2 in-stock active products to form a bundle; found ${chosen.length}.`
      );
    }
    report.components = chosen.map((c) => ({
      productId: c.product.id,
      title: c.product.title,
      variantId: c.variant.id,
      price: c.variant.price,
    }));
    console.log("  chosen components (cheapest in-stock):");
    for (const c of chosen) {
      console.log(`    - ${c.product.title} @ ${c.price} (${c.variant.id})`);
    }

    // Build component inputs: one optionSelection per product option, fixing it
    // to the chosen variant's value for that option.
    const components = chosen.map((c) => ({
      quantity: 1,
      productId: c.product.id,
      optionSelections: (c.product.options ?? []).map((opt) => {
        const sel = (c.variant.selectedOptions ?? []).find((s) => s.name === opt.name);
        return {
          componentOptionId: opt.id,
          name: opt.name,
          values: [sel?.value ?? "Default Title"],
        };
      }),
    }));

    // 2. Call productBundleCreate. A capability failure can arrive either as a
    //    top-level GraphQL error (adminGraphql throws) OR as a userError. ONLY a
    //    genuine access/ownership/permission error is a capability verdict; a
    //    GraphQL VALIDATION error is a probe/script bug and must fail LOUD (it
    //    must never masquerade as "capability not available" — that was the S9b
    //    false-negative). userErrors selection is schema-derived (no `code`).
    const FALLBACK_REC =
      "NO-GO (capability) → merchant must install the free \"Shopify Bundles\" app, " +
      "or use the §6(a) plain-UNLISTED-product FALLBACK.";
    const CREATE = `mutation B($input: ProductBundleCreateInput!) {
      productBundleCreate(input: $input) {
        productBundleOperation { id status }
        userErrors { ${ueCreate} }
      }
    }`;
    let createData;
    try {
      createData = await adminGraphql(CREATE, {
        input: { title: `S9b probe bundle ${new Date().toISOString()}`, components },
      });
    } catch (err) {
      const msg = String(err?.message ?? err);
      console.log(`  productBundleCreate errored: ${msg}`);
      if (isGenuineAccessError(msg) && !isValidationError(msg)) {
        report.capability = "NO";
        report.capabilityError = msg;
        report.recommendation = FALLBACK_REC;
        console.log(
          "\n  CAPABILITY NOT AVAILABLE (genuine access/ownership error). The merchant " +
            "must install the free \"Shopify Bundles\" app in Shopify admin → Apps, or " +
            "fall back to a plain UNLISTED product (spike §6a). STOPPING."
        );
        return;
      }
      // NOT a capability signal — a real/script error (e.g. GraphQL validation).
      // Fail loud; do NOT record a capability verdict.
      throw new Error(
        `productBundleCreate failed with a NON-capability error (probe/script bug — ` +
          `NOT a capability verdict): ${msg}`
      );
    }

    const userErrors = createData.productBundleCreate?.userErrors ?? [];
    if (userErrors.length) {
      report.capabilityError = JSON.stringify(userErrors);
      console.log(`  productBundleCreate userErrors: ${report.capabilityError}`);
      const blob = userErrors.map((e) => `${e.field ?? ""}: ${e.message ?? ""}`).join(" | ");
      if (isGenuineAccessError(blob) && !isValidationError(blob)) {
        report.capability = "NO";
        report.recommendation = FALLBACK_REC;
        console.log(
          "\n  CAPABILITY NOT AVAILABLE (userErrors indicate access/ownership). Merchant " +
            "must install the free \"Shopify Bundles\" app, or use the §6a fallback. STOPPING."
        );
        return;
      }
      // Input/validation userErrors are a probe bug, not a capability verdict.
      throw new Error(
        `productBundleCreate returned NON-capability userErrors (probe/script bug): ${report.capabilityError}`
      );
    }

    const op = createData.productBundleCreate.productBundleOperation;
    report.capability = "YES";
    report.operationId = op?.id ?? null;
    console.log(`  CAPABILITY: YES — ProductBundleOperation id=${op?.id} status=${op?.status}`);

    // 3. Poll the operation to completion.
    section("CHECK 1 — polling ProductBundleOperation to completion");
    const POLL = `query P($id: ID!) {
      productBundleOperation(id: $id) {
        id status
        product { id title handle status variants(first: 5) { nodes { id } } }
        userErrors { ${ueOperation} }
      }
    }`;
    const t0 = Date.now();
    let polls = 0;
    let opProduct = null;
    while (polls < POLL_MAX_ATTEMPTS) {
      polls++;
      const pd = await adminGraphql(POLL, { id: op.id });
      const o = pd.productBundleOperation;
      console.log(`  poll #${polls}: status=${o?.status}`);
      const opUe = o?.userErrors ?? [];
      if (opUe.length) throw new Error(`operation userErrors: ${JSON.stringify(opUe)}`);
      if (o?.status === "COMPLETE" || o?.status === "ACTIVE") {
        opProduct = o.product;
        break;
      }
      await sleep(POLL_INTERVAL_MS);
    }
    report.pollCount = polls;
    report.pollMs = Date.now() - t0;
    if (!opProduct) {
      throw new Error(
        `Operation did not complete within ${POLL_MAX_ATTEMPTS} polls / ${report.pollMs}ms.`
      );
    }
    createdProductIds.push(opProduct.id);
    report.bundleProductId = opProduct.id;
    report.parentVariantId = opProduct.variants?.nodes?.[0]?.id ?? null;
    console.log(
      `  COMPLETE after ${polls} poll(s) / ${report.pollMs}ms — product=${opProduct.id} ` +
        `parentVariant=${report.parentVariantId} (status=${opProduct.status})`
    );

    // ── CHECK 2 — PURCHASABILITY ──────────────────────────────────────────────
    section("CHECK 2 — PURCHASABILITY");

    // 4a. Set the parent variant price (nominal) + compareAtPrice = the TRUE sum
    //     of the component prices (the PAngV-safe "statt €X" reference, §2).
    const componentsSum = report.components
      .reduce((s, c) => s + Number(c.price), 0)
      .toFixed(2);
    report.componentsSum = componentsSum;
    const PRICE = `mutation V($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkUpdate(productId: $productId, variants: $variants) {
        productVariants { id price compareAtPrice }
        userErrors { ${ueVariants} }
      }
    }`;
    const pr = await adminGraphql(PRICE, {
      productId: opProduct.id,
      variants: [
        { id: report.parentVariantId, price: NOMINAL_PRICE, compareAtPrice: componentsSum },
      ],
    });
    const prUe = pr.productVariantsBulkUpdate?.userErrors ?? [];
    if (prUe.length) throw new Error(`price update userErrors: ${JSON.stringify(prUe)}`);
    report.priceUpdate = `${NOMINAL_PRICE} ${NOMINAL_CURRENCY}`;
    report.compareAtPrice = `${componentsSum} ${NOMINAL_CURRENCY}`;
    console.log(`  price set: ${JSON.stringify(pr.productVariantsBulkUpdate.productVariants)}`);

    // 4b. Status -> UNLISTED.
    const unlisted = await productUpdate({ id: opProduct.id, status: "UNLISTED" });
    report.statusUnlisted = unlisted.status;
    console.log(`  status -> ${unlisted.status}`);

    // 4c. Publish to the Online Store publication.
    const pubs = await adminGraphql(`{ publications(first: 20) { nodes { id name } } }`);
    const onlineStore = (pubs.publications?.nodes ?? []).find(
      (p) => p.name === "Online Store"
    );
    if (!onlineStore) {
      throw new Error(
        `Online Store publication not found (have: ${(pubs.publications?.nodes ?? [])
          .map((p) => p.name)
          .join(", ")})`
      );
    }
    report.publicationId = onlineStore.id;
    const PUBLISH = `mutation Pub($id: ID!, $input: [PublicationInput!]!) {
      publishablePublish(id: $id, input: $input) {
        publishable { availablePublicationsCount { count } }
        userErrors { ${uePublish} }
      }
    }`;
    const pub = await adminGraphql(PUBLISH, {
      id: opProduct.id,
      input: [{ publicationId: onlineStore.id }],
    });
    const pubUe = pub.publishablePublish?.userErrors ?? [];
    if (pubUe.length) throw new Error(`publish userErrors: ${JSON.stringify(pubUe)}`);
    report.published = true;
    console.log(`  published to Online Store (${onlineStore.id})`);

    // 5. Derive numeric variant id + construct the cart permalink.
    report.numericVariantId = parseNumericVariantId(report.parentVariantId);
    report.cartPermalink = `${SHOP_DOMAIN}/cart/${report.numericVariantId}:1`;
    console.log(`  CART PERMALINK (test manually): ${report.cartPermalink}`);

    // 6. Server-side purchasability signals.
    const VERIFY = `query Ver($id: ID!, $pub: ID!) {
      product(id: $id) {
        id title handle status availableForSale
        totalInventory tracksInventory
        publishedOnPublication(publicationId: $pub)
        variants(first: 5) {
          nodes { id price availableForSale inventoryQuantity inventoryPolicy }
        }
      }
    }`;
    const ver = await adminGraphql(VERIFY, { id: opProduct.id, pub: onlineStore.id });
    const vp = ver.product;
    const parentVar =
      (vp.variants?.nodes ?? []).find((v) => v.id === report.parentVariantId) ??
      vp.variants?.nodes?.[0];
    report.purchasability = {
      status: vp.status,
      productAvailableForSale: vp.availableForSale,
      publishedOnOnlineStore: vp.publishedOnPublication,
      parentVariantAvailableForSale: parentVar?.availableForSale ?? null,
      parentVariantInventoryQuantity: parentVar?.inventoryQuantity ?? null,
      parentVariantInventoryPolicy: parentVar?.inventoryPolicy ?? null,
      totalInventory: vp.totalInventory,
      tracksInventory: vp.tracksInventory,
    };
    console.log(`  purchasability signals: ${JSON.stringify(report.purchasability, null, 2)}`);

    const buyable =
      vp.status === "UNLISTED" &&
      vp.publishedOnPublication === true &&
      (vp.availableForSale === true || parentVar?.availableForSale === true);
    report.recommendation = buyable
      ? "GO — native fixed bundle is purchasable server-side (UNLISTED + published + " +
        "availableForSale). Final click-through-to-checkout is a manual browser step."
      : "NO-GO / INVESTIGATE — server-side signals do not confirm a buyable state; " +
        "inspect purchasability block before committing S10.";
    console.log(`\n  >>> ${report.recommendation}`);
    console.log(
      "  NOTE: the FINAL confirmation (link actually reaches checkout) is a MANUAL\n" +
        "  browser step — open the permalink above in an incognito window and confirm\n" +
        "  it reaches Shopify checkout."
    );
  } finally {
    // ── CLEANUP — always archive (never delete) anything created ───────────────
    section("CLEANUP — archiving probe product(s)");
    for (const id of createdProductIds) {
      try {
        const archived = await productUpdate({ id, status: "ARCHIVED" });
        report.archived.push({ id, status: archived.status });
        console.log(`  archived ${id} -> ${archived.status}`);
      } catch (err) {
        console.log(`  ⚠ failed to archive ${id}: ${err?.message ?? err}`);
        report.archived.push({ id, status: `ARCHIVE-FAILED: ${err?.message ?? err}` });
      }
    }
    if (!createdProductIds.length) console.log("  nothing to archive.");
  }

  // ── Paste-ready findings block ──────────────────────────────────────────────
  section("FINDINGS (paste into docs/BUNDLES_SPIKE.md)");
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(`\n[probe-bundle] FATAL: ${err?.stack ?? err}`);
  console.error("\nPartial report:\n" + JSON.stringify(report, null, 2));
  process.exitCode = 1;
});
