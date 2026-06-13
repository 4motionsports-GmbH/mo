// POST /api/admin/bundles/create
//   { customerId?, components: [{ productId, quantity? }],
//     bundlePriceOverride?, title?, expiryDays?, marketingSendId? }
//
// Create a personalized bundle offer (S10). customerId is optional (null = an
// ad-hoc offer). All the validation, snapshotting, Shopify creation and
// persistence live in createBundleOffer (lib/bundle-offers).
//
// Auth + CSRF via guardAdminPost (the proxy already gates /api/admin/*).

import { guardAdminPost, adminJson, adminJsonError } from "@/lib/admin-api";
import {
  createBundleOffer,
  type BundleComponentInput,
  type CreateBundleOfferOptions,
} from "@/lib/bundle-offers";
import { reportError } from "@/lib/observability";

export const maxDuration = 60;

// Domain refusal reasons → HTTP statuses.
const STATUS_BY_REASON: Record<string, number> = {
  not_configured: 503,
  no_db: 503,
  empty: 400,
  unknown_products: 400,
  sold_out: 409,
  no_variant: 422,
  bad_price: 400,
  create_failed: 502,
};

export async function POST(req: Request) {
  const blocked = await guardAdminPost(req);
  if (blocked) return blocked;

  let customerId: number | null;
  let components: BundleComponentInput[];
  let options: CreateBundleOfferOptions;
  try {
    const body = (await req.json()) as {
      customerId?: unknown;
      components?: unknown;
      bundlePriceOverride?: unknown;
      title?: unknown;
      expiryDays?: unknown;
      marketingSendId?: unknown;
    };

    // customerId optional (null = ad-hoc); when present it must be a positive int.
    if (body.customerId == null) {
      customerId = null;
    } else {
      const cid = Number(body.customerId);
      if (!Number.isInteger(cid) || cid <= 0) {
        return adminJsonError("bad_request", "customerId must be a positive integer or omitted", 400);
      }
      customerId = cid;
    }

    if (!Array.isArray(body.components) || body.components.length === 0) {
      return adminJsonError("bad_request", "components must be a non-empty array", 400);
    }
    components = body.components.map((c) => {
      const item = c as { productId?: unknown; quantity?: unknown };
      const productId = String(item.productId ?? "").trim();
      const quantity = item.quantity != null ? Number(item.quantity) : undefined;
      return { productId, ...(quantity != null ? { quantity } : {}) };
    });
    if (components.some((c) => !c.productId)) {
      return adminJsonError("bad_request", "every component needs a productId", 400);
    }

    const expiryDays = body.expiryDays != null ? Number(body.expiryDays) : undefined;
    if (expiryDays != null && (!Number.isFinite(expiryDays) || expiryDays <= 0)) {
      return adminJsonError("bad_request", "expiryDays must be a positive number", 400);
    }
    const marketingSendId = body.marketingSendId != null ? Number(body.marketingSendId) : null;

    options = {
      bundlePriceOverride:
        body.bundlePriceOverride != null ? (body.bundlePriceOverride as number | string) : null,
      title: body.title != null ? String(body.title) : null,
      ...(expiryDays != null ? { expiryDays } : {}),
      marketingSendId: Number.isInteger(marketingSendId) ? marketingSendId : null,
    };
  } catch {
    return adminJsonError("bad_request", "Invalid JSON body", 400);
  }

  try {
    const result = await createBundleOffer(customerId, components, options);
    if (result.ok) {
      return adminJson({ ok: true, offer: result.offer, redirectUrl: result.redirectUrl });
    }
    const status = STATUS_BY_REASON[result.reason] ?? 400;
    // Error envelope ({ error: { code, message } }) plus structured detail so the
    // S11 UI can surface which components were sold out / unknown.
    return adminJson(
      {
        error: { code: result.reason, message: result.message },
        ...(result.offenders ? { offenders: result.offenders } : {}),
        ...(result.offer ? { offer: result.offer } : {}),
      },
      status
    );
  } catch (err) {
    reportError(err, { route: "api/admin/bundles/create" });
    return adminJsonError("internal_error", "Bundle creation failed.", 500);
  }
}
