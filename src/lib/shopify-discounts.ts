// Unique single-use marketing discount codes via the Shopify Admin GraphQL API.
//
// ⚠️ Shopify's APIs changed recently — this was written against CURRENT docs,
// not memory:
//   Mutation:  discountCodeBasicCreate(basicCodeDiscount: DiscountCodeBasicInput!)
//   Docs:      https://shopify.dev/docs/api/admin-graphql/2026-04/mutations/discountCodeBasicCreate
//              https://shopify.dev/docs/api/admin-graphql/2026-04/input-objects/DiscountCodeBasicInput
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
// Input shape we use (a single-use percentage-off code, admin-chosen depth, with
// expiry — the percentage is passed in per send, no longer hardcoded):
//   {
//     title, code,
//     startsAt, endsAt,
//     customerSelection: { all: true },
//     customerGets: { value: { percentage: 0.05 }, items: { all: true } },
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
 */
export const PLACEHOLDER_DISCOUNT_CODE = "MOIA-XXXX";

/** Days a minted code stays valid (env-overridable). Exposed so the draft
 * preview can show the same projected expiry the real code will get. */
export function discountExpiryDaysPublic(): number {
  return discountExpiryDays();
}

const DISCOUNT_CODE_BASIC_CREATE = /* GraphQL */ `
  mutation MarketingDiscountCreate($basicCodeDiscount: DiscountCodeBasicInput!) {
    discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
      codeDiscount {
        ... on DiscountCodeBasic {
          title
          status
          endsAt
          codes(first: 1) {
            nodes { code }
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
    codeDiscount: {
      title?: string;
      status?: string;
      endsAt?: string | null;
      codes?: { nodes: Array<{ code: string }> };
    } | null;
    userErrors: Array<{ field?: string[] | null; code?: string | null; message: string }>;
  };
}

export interface CreatedDiscount {
  /** The human-facing code the customer types / that rides ?discount=CODE. */
  code: string;
  /** The discount node id (gid://shopify/DiscountCodeNode/…) for auditing. */
  gid: string | null;
  /** When the code stops working. */
  expiresAt: string;
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

  const basicCodeDiscount = {
    title: options.title ?? `Persönlicher Rabatt (${Math.round(percentage * 100)}%) — ${code}`,
    code,
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    customerSelection: { all: true },
    customerGets: {
      value: { percentage },
      items: { all: true },
    },
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
    const created = payload.codeDiscount;
    const returnedCode = created?.codes?.nodes?.[0]?.code ?? code;
    return {
      code: returnedCode,
      // Shopify returns the DiscountCodeBasic node, not the wrapping
      // DiscountCodeNode id, on this payload — we keep the title-derived code as
      // the durable handle and leave gid null when absent.
      gid: null,
      expiresAt: created?.endsAt ?? endsAt.toISOString(),
    };
  } catch (err) {
    reportError(err, { route: "lib/shopify-discounts", phase: "create" });
    return null;
  }
}
