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

// The admin chooses the discount depth as a whole-number percent (DEFAULT 0,
// range 0–50). The bounds + validation live in lib/discount-validation.mjs,
// shared by the draft routes (server-side) and the dashboard input (client-side).
// 0 mints no code; >0 mints the MS5- code below with the chosen percentage.

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
        codes?: { nodes: Array<{ code: string }> };
      } | null;
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

// Codes are short-lived by design: 7 days from mint (endsAt = now + 7d on the
// DiscountCodeBasicInput, echoed back as endsAt and stored on the send row).
// The email must state both the validity period and the concrete end date —
// see marketing-draft.ts (prompt) and marketing-email.ts (deterministic line).
function discountExpiryDays(): number {
  const raw = process.env.MARKETING_DISCOUNT_EXPIRY_DAYS;
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 7;
}

/**
 * The expiry date as the customer should read it: German format (TT.MM.JJJJ)
 * in the store's timezone (Europe/Berlin) — the instant lives in UTC, and
 * formatting it server-side without a timezone could shift the day. One shared
 * formatter so the AI prose, the deterministic email line, and the draft
 * preview can never disagree on the date string.
 */
export function formatGermanExpiryDate(d: string | Date): string {
  return new Date(d).toLocaleDateString("de-DE", {
    timeZone: "Europe/Berlin",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

/**
 * Generate a fresh, hard-to-guess code string. Short enough to read in an email,
 * random enough not to collide or be enumerated. Prefix marks its origin:
 * "MS5" = marketing sends, "WELCOME" = the one-time welcome code.
 */
export function generateDiscountCodeString(prefix = "MS5"): string {
  // 5 bytes → 8 base32-ish chars. Avoid ambiguous chars (0/O, 1/I).
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += alphabet[bytes[i] % alphabet.length];
  return `${prefix}-${s}`;
}

export interface CreateDiscountOptions {
  /** Percentage as a fraction. Defaults to 0.05 (5%). */
  percentage?: number;
  /** Admin-facing title. Defaults to a marketing label. */
  title?: string;
  /** Code prefix marking the code's origin. Defaults to the marketing "MS5". */
  codePrefix?: string;
  /** Days until the code expires. Defaults to the marketing expiry (7d). */
  expiryDays?: number;
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
  const code = generateDiscountCodeString(options.codePrefix);
  const startsAt = new Date();
  const expiryDays =
    options.expiryDays != null && options.expiryDays > 0
      ? options.expiryDays
      : discountExpiryDays();
  const endsAt = new Date(startsAt.getTime() + expiryDays * 86_400_000);

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
    const node = payload.codeDiscountNode;
    const created = node?.codeDiscount;
    const returnedCode = created?.codes?.nodes?.[0]?.code ?? code;
    return {
      code: returnedCode,
      // The DiscountCodeNode id (gid://shopify/DiscountCodeNode/…) — the durable
      // handle for auditing / later deactivation. Falls back to null if absent.
      gid: node?.id ?? null,
      expiresAt: created?.endsAt ?? endsAt.toISOString(),
    };
  } catch (err) {
    reportError(err, { route: "lib/shopify-discounts", phase: "create" });
    return null;
  }
}
