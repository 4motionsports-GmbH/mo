// Unique single-use marketing discount codes via the Shopify Admin GraphQL API.
//
// ⚠️ Shopify's APIs changed recently — this was written against CURRENT docs,
// not memory:
//   Mutation:  discountCodeBasicCreate(basicCodeDiscount: DiscountCodeBasicInput!)
//   Docs:      https://shopify.dev/docs/api/admin-graphql/2026-04/mutations/discountCodeBasicCreate
//              https://shopify.dev/docs/api/admin-graphql/2026-04/input-objects/DiscountCodeBasicInput
//              https://shopify.dev/docs/api/admin-graphql/2026-04/payloads/DiscountCodeBasicCreatePayload
//   Payload:   the result field is `codeDiscountNode` (a DiscountCodeNode with the
//              gid `id`), NOT a bare `codeDiscount`. Selecting a non-existent
//              field is a schema validation error that aborts the mutation BEFORE
//              execution — i.e. no code is created at all. We read the gid off
//              codeDiscountNode.id for auditing / later deactivation.
//   Verified:  2026-06-05 against API version SHOPIFY_API_VERSION = 2026-04 (the
//              configured version; we always target it, not "latest"). shopify.dev
//              blocks automated fetches (HTTP 403), so the shape was re-confirmed
//              via the public docs index: discountCodeBasicCreate takes
//              `basicCodeDiscount: DiscountCodeBasicInput!`; the value is set via
//              customerGets.value as DiscountPercentage { percentage } (a 0..1
//              fraction); usageLimit (Int) caps total redemptions;
//              appliesOncePerCustomer (Boolean) pins it to one buyer.
//   Scope:     write_discounts.
//
// COMBINABILITY (non-stackable codes) — re-verified 2026-06-10, same caveat
// (shopify.dev 403s automated fetches; shape cross-checked against an
// integration template that targets /admin/api/2026-04/graphql.json verbatim,
// plus Shopify's combinations help docs):
//   Input:  DiscountCodeBasicInput.combinesWith: DiscountCombinesWithInput
//           { orderDiscounts: Boolean, productDiscounts: Boolean,
//             shippingDiscounts: Boolean }
//           (2026-04 additionally knows productDiscountsWithTagsOnSameCartLine —
//           a tag allowlist for same-line product-discount stacking — which we
//           deliberately do NOT set: we don't want any stacking.)
//   Docs:   https://shopify.dev/docs/api/admin-graphql/2026-04/input-objects/DiscountCombinesWithInput
//           https://help.shopify.com/en/manual/discounts/discount-combinations
//   Model:  Shopify has NO "combines with other discount codes" toggle. A
//           discount declares which discount CLASSES (product/order/shipping)
//           it combines with, and two discounts stack only if EACH allows the
//           OTHER's class. Setting all three to false therefore makes our code
//           combine with NOTHING — no other code and no automatic discount.
//           Customer-facing behavior when a cart holds two non-combinable
//           discounts: Shopify applies the better one and tells the customer
//           "Some discount codes couldn't be used together. We applied the
//           best combination." — our 5% can never stack on a 10%.
//   Echo:   the created DiscountCodeBasic exposes combinesWith
//           { orderDiscounts productDiscounts shippingDiscounts }; we select it
//           and VERIFY all three came back false before using the code.
//
// Input shape we use (a single-use percentage-off code, admin-chosen depth, with
// expiry — the percentage is passed in per send, no longer hardcoded):
//   {
//     title, code,
//     startsAt, endsAt,
//     customerSelection: { all: true },
//     customerGets: { value: { percentage: 0.05 }, items: { all: true } },
//     combinesWith: { orderDiscounts: false, productDiscounts: false,
//                     shippingDiscounts: false },   // stacks with NOTHING
//     appliesOncePerCustomer: true,
//     usageLimit: 1            // single redemption across the whole store
//   }
// `percentage` is a fraction (0.05 = 5%). `usageLimit: 1` makes the code truly
// single-use; `appliesOncePerCustomer: true` additionally pins it to one buyer.

import { adminGraphql, isShopifyConfigured } from "./shopify";
import { reportError } from "./observability";

/**
 * The discount depths the admin may offer, as whole-number percents. 0 = "None"
 * (the default — applying a discount is a deliberate act). Shared by the draft
 * route (validation) and the dashboard UI (the selector).
 */
export const ALLOWED_DISCOUNT_PERCENTS = [0, 5, 10, 15] as const;
export type AllowedDiscountPercent = (typeof ALLOWED_DISCOUNT_PERCENTS)[number];

export function isAllowedDiscountPercent(n: unknown): n is AllowedDiscountPercent {
  return (
    typeof n === "number" &&
    (ALLOWED_DISCOUNT_PERCENTS as readonly number[]).includes(n)
  );
}

/**
 * The clearly-marked placeholder code shown in the DRAFT PREVIEW. No real
 * Shopify code is minted at draft time (that would waste single-use codes on
 * discarded drafts); the model weaves THIS literal into the preview body so the
 * admin sees exactly how the email will read, and at send time it is swapped
 * 1:1 for the real unique code. Kept deliberately obvious so the admin doesn't
 * mistake it for a working code.
 *
 * NOTE: this is only the DRAFT placeholder, not an issued code prefix — real
 * minted codes use the `MS5-` prefix (see generateDiscountCodeString) and are
 * unaffected by this rename. We renamed the placeholder MOIA-XXXX → MO-XXXX
 * alongside the MOIA → Mo persona rename; no already-issued code is touched.
 */
export const PLACEHOLDER_DISCOUNT_CODE = "MO-XXXX";

/** Days a minted code stays valid (env-overridable). Exposed so the draft
 * preview can show the same projected expiry the real code will get. */
export function discountExpiryDaysPublic(): number {
  return discountExpiryDays();
}

const DISCOUNT_CODE_BASIC_CREATE = /* GraphQL */ `
  mutation MarketingDiscountCreate($basicCodeDiscount: DiscountCodeBasicInput!) {
    discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
      codeDiscountNode {
        id
        codeDiscount {
          ... on DiscountCodeBasic {
            title
            status
            endsAt
            combinesWith {
              orderDiscounts
              productDiscounts
              shippingDiscounts
            }
            customerGets {
              items {
                __typename
                ... on DiscountCollections {
                  collections(first: 5) {
                    nodes { id }
                  }
                }
                ... on AllDiscountItems {
                  allItems
                }
              }
            }
            codes(first: 1) {
              nodes { code }
            }
          }
        }
      }
      userErrors {
        field
        code
        message
      }
    }
  }
`;

interface DiscountCreateResponse {
  discountCodeBasicCreate: {
    // The wrapping node — `id` is the gid://shopify/DiscountCodeNode/… handle.
    // NB: the payload field is `codeDiscountNode` (a DiscountCodeNode), NOT a
    // bare `codeDiscount` — selecting the latter is a schema error that aborts
    // the mutation before it runs (so no code is ever created). See the
    // DiscountCodeBasicCreatePayload docs cited at the top of this file.
    codeDiscountNode: {
      id: string;
      codeDiscount: {
        title?: string;
        status?: string;
        endsAt?: string | null;
        combinesWith?: DiscountCombinesWith | null;
        customerGets?: {
          items?: {
            __typename?: string;
            collections?: { nodes: Array<{ id: string }> };
            allItems?: boolean;
          } | null;
        } | null;
        codes?: { nodes: Array<{ code: string }> };
      } | null;
    } | null;
    userErrors: Array<{ field?: string[] | null; code?: string | null; message: string }>;
  };
}

/**
 * The discount-class combinability of a code, mirroring Shopify's
 * DiscountCombinesWith. All false = the code stacks with nothing.
 */
export interface DiscountCombinesWith {
  orderDiscounts: boolean;
  productDiscounts: boolean;
  shippingDiscounts: boolean;
}

/** What we always request: a code that combines with NOTHING (other codes or
 * automatic discounts) — so it can never stack on top of another discount. */
export const MARKETING_COMBINES_WITH: DiscountCombinesWith = {
  orderDiscounts: false,
  productDiscounts: false,
  shippingDiscounts: false,
};

/**
 * What the code's eligibility was scoped to, as echoed by Shopify:
 *   - "collection" — only items in the configured full-price collection are
 *     discounted (sale items in a mixed cart get nothing),
 *   - "all"        — store-wide (the fallback when no collection is configured).
 */
export type DiscountAppliesTo =
  | { scope: "all" }
  | { scope: "collection"; collectionGid: string };

/**
 * FULL-PRICE-ONLY SCOPING — what Shopify can and cannot express (investigated
 * 2026-06-10 against Admin GraphQL 2026-04; shopify.dev 403s automated fetches,
 * so verified via the smart-collections help docs + changelog and a 2026-04
 * integration template, citations below):
 *
 *   1. "On sale" (compare-at price set) is NOT a discount in Shopify's model —
 *      it's just the variant's price. combinesWith (see above) therefore can't
 *      exclude sale items; it only governs stacking with other DISCOUNTS.
 *   2. There is NO eligibility rule on a code discount like "exclude items on
 *      sale" and NO "all items except collection X". DiscountCodeBasicInput's
 *      customerGets.items can only POSITIVELY target all / products /
 *      collections (DiscountItemsInput, 2026-04).
 *   3. The closest clean construct — and what we implement: scope the code to
 *      an automated ("smart") collection whose condition is "Compare-at price
 *      is empty", i.e. full-price products. Shopify keeps that collection
 *      current as prices change, and a discount scoped to a collection applies
 *      per LINE ITEM: in a mixed cart only the full-price lines are discounted.
 *      Docs: https://help.shopify.com/en/manual/products/collections/smart-collections/conditions
 *            https://changelog.shopify.com/posts/create-an-automated-collection-based-on-the-compare-at-price-field
 *      Known limits (documented for the client in docs/DISCOUNTS.md):
 *        - membership is per PRODUCT, and "Compare-at price is empty" matches
 *          when ANY variant has no compare-at price — a product with one sale
 *          variant and one full-price variant counts as full-price, so its
 *          sale variants would be discounted too;
 *        - a compare-at price EQUAL to the price still counts as "set";
 *        - collection re-evaluation is asynchronous (short staleness window
 *          right after a price change).
 *
 * The collection is configured via SHOPIFY_FULL_PRICE_COLLECTION_GID (a
 * gid://shopify/Collection/… id). When unset, codes stay store-wide ("all") —
 * loudly warned, so the sale-item exclusion can't silently appear active.
 */
export function fullPriceCollectionGid(): string | null {
  const raw = process.env.SHOPIFY_FULL_PRICE_COLLECTION_GID?.trim();
  if (!raw) return null;
  if (!raw.startsWith("gid://shopify/Collection/")) {
    console.warn(
      `[shopify-discounts] SHOPIFY_FULL_PRICE_COLLECTION_GID is not a ` +
        `gid://shopify/Collection/… id (got "${raw.slice(0, 60)}") — ignoring it; ` +
        `discount codes will apply store-wide.`
    );
    return null;
  }
  return raw;
}

export interface CreatedDiscount {
  /** The human-facing code the customer types / that rides ?discount=CODE. */
  code: string;
  /** The discount node id (gid://shopify/DiscountCodeNode/…) for auditing. */
  gid: string | null;
  /** When the code stops working. */
  expiresAt: string;
  /** The combinability settings AS ECHOED BY SHOPIFY (verified all-false), kept
   * on the marketing_sends row as the record of the rules the code carried. */
  combinesWith: DiscountCombinesWith;
  /** The eligibility scope AS ECHOED BY SHOPIFY (full-price collection vs all),
   * likewise kept on the marketing_sends row. */
  appliesTo: DiscountAppliesTo;
}

function discountExpiryDays(): number {
  const raw = process.env.MARKETING_DISCOUNT_EXPIRY_DAYS;
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 30;
}

/**
 * Generate a fresh, hard-to-guess code string. Short enough to read in an email,
 * random enough not to collide or be enumerated. Prefix marks its origin.
 */
export function generateDiscountCodeString(): string {
  // 5 bytes → 8 base32-ish chars. Avoid ambiguous chars (0/O, 1/I).
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += alphabet[bytes[i] % alphabet.length];
  return `MS5-${s}`;
}

export interface CreateDiscountOptions {
  /** Percentage as a fraction. Defaults to 0.05 (5%). */
  percentage?: number;
  /** Admin-facing title. Defaults to a marketing label. */
  title?: string;
}

/**
 * Create a UNIQUE single-use percentage discount code. Returns the created code
 * or null when Shopify isn't configured / the mutation fails (the caller then
 * proceeds without a discount rather than blocking the whole draft). Never
 * throws.
 */
export async function createUniqueDiscountCode(
  options: CreateDiscountOptions = {}
): Promise<CreatedDiscount | null> {
  if (!isShopifyConfigured()) return null;

  const percentage = options.percentage ?? 0.05;
  const code = generateDiscountCodeString();
  const startsAt = new Date();
  const endsAt = new Date(startsAt.getTime() + discountExpiryDays() * 86_400_000);

  // FULL-PRICE-ONLY: scope eligible items to the configured full-price
  // collection (see fullPriceCollectionGid above for what this can and cannot
  // guarantee). Without the collection the code applies store-wide — warn so
  // nobody believes the sale-item exclusion is active when it isn't.
  const collectionGid = fullPriceCollectionGid();
  if (!collectionGid) {
    console.warn(
      "[shopify-discounts] SHOPIFY_FULL_PRICE_COLLECTION_GID is not set — the " +
        "minted code will apply to ALL items, including sale items."
    );
  }
  const items = collectionGid
    ? { collections: { add: [collectionGid] } }
    : { all: true };

  const basicCodeDiscount = {
    title: options.title ?? `Persönlicher Rabatt (${Math.round(percentage * 100)}%) — ${code}`,
    code,
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    customerSelection: { all: true },
    customerGets: {
      value: { percentage },
      items,
    },
    // NON-STACKABLE: combines with no other discount, of any class. See the
    // COMBINABILITY block at the top of this file for the model + doc citations.
    combinesWith: MARKETING_COMBINES_WITH,
    appliesOncePerCustomer: true,
    usageLimit: 1,
  };

  try {
    const data = await adminGraphql<DiscountCreateResponse>(DISCOUNT_CODE_BASIC_CREATE, {
      basicCodeDiscount,
    });
    const payload = data.discountCodeBasicCreate;
    if (payload.userErrors.length > 0) {
      reportError(new Error("discountCodeBasicCreate userErrors"), {
        route: "lib/shopify-discounts",
        phase: "userErrors",
        errors: JSON.stringify(payload.userErrors).slice(0, 300),
      });
      return null;
    }
    const node = payload.codeDiscountNode;
    const created = node?.codeDiscount;

    // CONFIRM the non-stackable setting on the response, not just the request:
    // every flag Shopify echoes back must be false. A mismatch would mean a
    // stackable code went live, so we refuse to use it (the send is aborted) and
    // report the gid so the stray discount can be deactivated in the admin.
    const echoed = created?.combinesWith;
    const combinesWith: DiscountCombinesWith = {
      orderDiscounts: echoed?.orderDiscounts ?? false,
      productDiscounts: echoed?.productDiscounts ?? false,
      shippingDiscounts: echoed?.shippingDiscounts ?? false,
    };
    if (
      combinesWith.orderDiscounts ||
      combinesWith.productDiscounts ||
      combinesWith.shippingDiscounts
    ) {
      reportError(new Error("discount created with unexpected combinesWith"), {
        route: "lib/shopify-discounts",
        phase: "verifyCombinesWith",
        gid: node?.id ?? "unknown",
        combinesWith: JSON.stringify(combinesWith),
      });
      return null;
    }

    // CONFIRM the eligibility scope on the response too: when we asked for the
    // full-price collection, Shopify must echo a DiscountCollections selection
    // containing exactly that collection. Anything else means the code went
    // live broader than promised — refuse it (send aborted, gid reported).
    const echoedItems = created?.customerGets?.items;
    let appliesTo: DiscountAppliesTo;
    if (collectionGid) {
      const echoedIds = echoedItems?.collections?.nodes?.map((n) => n.id) ?? [];
      if (
        echoedItems?.__typename !== "DiscountCollections" ||
        !echoedIds.includes(collectionGid)
      ) {
        reportError(new Error("discount created with unexpected items scope"), {
          route: "lib/shopify-discounts",
          phase: "verifyAppliesTo",
          gid: node?.id ?? "unknown",
          expected: collectionGid,
          echoed: JSON.stringify(echoedItems).slice(0, 300),
        });
        return null;
      }
      appliesTo = { scope: "collection", collectionGid };
    } else {
      appliesTo = { scope: "all" };
    }

    const returnedCode = created?.codes?.nodes?.[0]?.code ?? code;
    return {
      code: returnedCode,
      // The DiscountCodeNode id (gid://shopify/DiscountCodeNode/…) — the durable
      // handle for auditing / later deactivation. Falls back to null if absent.
      gid: node?.id ?? null,
      expiresAt: created?.endsAt ?? endsAt.toISOString(),
      combinesWith,
      appliesTo,
    };
  } catch (err) {
    reportError(err, { route: "lib/shopify-discounts", phase: "create" });
    return null;
  }
}
