// POST /api/admin/campaign/recommendations  { contactId, productIds }
//
// Review-time manual control over a draft's recommended products: the admin
// swaps products in/out via the catalog picker (same /api/admin/catalog/search
// backing as the set composer). Item mails only — while a set is attached the
// mail shows only the set (offer-mode.mjs) and its contents are fixed, so the
// list cannot change (409 set_attached; remove the set first).
//
// Validation against the sync-fresh catalog, per ref ("handle~variantId" pins a
// variant): a NEWLY added ref must be in the catalog, keep its variant and be
// available — same bar as generation's filterAvailable. A ref that was ALREADY
// on the draft and has since sold out or vanished is dropped instead of
// blocking the edit (returned as `dropped`), so a stale pick can always be
// replaced. Refusals are German and name the products.
//
// The PROSE is not touched here — the UI chains a regenerate right after,
// which PRESERVES this curated list (prepareDraftForContact), so the fresh
// text talks about exactly these products. Auth + CSRF via guardAdminPost.

import { guardAdminPost, adminJson, adminJsonError } from "@/lib/admin-api";
import {
  getContactById,
  getDraftForContact,
  updateCampaignDraftRecommendations,
} from "@/lib/campaign-store";
import { getActiveBundleForCampaignContact } from "@/lib/bundle-offers-store";
import { shouldRenderBundleBlock } from "@/lib/bundle-email-core.mjs";
import { resolveProductSelections } from "@/lib/product-catalog";
import { recommendationView } from "@/lib/campaign-recommendation-view";
import { reportError } from "@/lib/observability";

export const maxDuration = 60;

// Keep the email focused — same ballpark as the generated 2–3 picks.
const MAX_RECOMMENDATIONS = 5;

export async function POST(req: Request) {
  const blocked = await guardAdminPost(req);
  if (blocked) return blocked;

  let contactId: number;
  let productIds: string[];
  try {
    const body = (await req.json()) as { contactId?: unknown; productIds?: unknown };
    contactId = Number(body.contactId);
    if (!Number.isInteger(contactId) || contactId <= 0) {
      return adminJsonError("bad_request", "contactId required", 400);
    }
    if (!Array.isArray(body.productIds)) {
      return adminJsonError("bad_request", "productIds must be an array", 400);
    }
    productIds = [...new Set(body.productIds.map((p) => String(p ?? "").trim()))].filter(
      Boolean
    );
    if (productIds.length === 0 || productIds.length > MAX_RECOMMENDATIONS) {
      return adminJsonError(
        "bad_request",
        `Eine Mail empfiehlt 1 bis ${MAX_RECOMMENDATIONS} Produkte.`,
        400
      );
    }
  } catch {
    return adminJsonError("bad_request", "Invalid JSON body", 400);
  }

  try {
    const contact = await getContactById(contactId);
    if (!contact) return adminJsonError("not_found", "Contact not found.", 404);
    if (contact.status !== "drafted") {
      return adminJsonError("not_editable", "Contact is not in review.", 409);
    }

    // A set mail's contents are the set — the recommendations are its source
    // and must not drift away from it.
    const activeSet = await getActiveBundleForCampaignContact(contactId);
    if (activeSet && shouldRenderBundleBlock(activeSet)) {
      return adminJsonError(
        "set_attached",
        "Solange ein Set angehängt ist, zeigt die Mail nur das Set — zum Ändern das Set entfernen und neu erstellen.",
        409
      );
    }

    const existingDraft = await getDraftForContact(contactId);
    const stored = new Set(existingDraft?.recommendedProductIds ?? []);
    const selections = await resolveProductSelections(productIds);
    const byRef = new Map(selections.map((s) => [s.ref, s]));
    const usable = (ref: string) => {
      const s = byRef.get(ref);
      return Boolean(s && !s.missingVariant && s.available);
    };
    const nameOf = (ref: string) => byRef.get(ref)?.product.name ?? ref;

    // Newly added refs must be recommendable now.
    const added = productIds.filter((ref) => !stored.has(ref));
    const unknown = added.filter((ref) => !byRef.has(ref));
    if (unknown.length > 0) {
      return adminJson(
        { error: { code: "unknown_products", message: `Nicht im Katalog: ${unknown.join(", ")}.` }, offenders: unknown },
        400
      );
    }
    const goneVariants = added.filter((ref) => byRef.get(ref)?.missingVariant);
    if (goneVariants.length > 0) {
      return adminJson(
        {
          error: {
            code: "variant_not_found",
            message: `Die gewählte Variante gibt es nicht mehr — bitte neu wählen: ${goneVariants.map(nameOf).join(", ")}.`,
          },
          offenders: goneVariants,
          offenderNames: Object.fromEntries(goneVariants.map((r) => [r, nameOf(r)])),
        },
        409
      );
    }
    const soldOut = added.filter((ref) => !usable(ref));
    if (soldOut.length > 0) {
      return adminJson(
        {
          error: {
            code: "sold_out",
            message: `Ausverkauft — kann nicht empfohlen werden: ${soldOut.map(nameOf).join(", ")}.`,
          },
          offenders: soldOut,
          offenderNames: Object.fromEntries(soldOut.map((r) => [r, nameOf(r)])),
        },
        409
      );
    }

    // Refs that were already on the draft but are no longer available drop out.
    const dropped = productIds.filter((ref) => stored.has(ref) && !usable(ref));
    const kept = productIds.filter((ref) => !dropped.includes(ref));
    if (kept.length === 0) {
      return adminJson(
        {
          error: {
            code: "nothing_available",
            message: `Keine verfügbare Empfehlung übrig (${dropped.map(nameOf).join(", ")}) — bitte ein verfügbares Produkt hinzufügen.`,
          },
          offenders: dropped,
          offenderNames: Object.fromEntries(dropped.map((r) => [r, nameOf(r)])),
        },
        409
      );
    }

    const draft = await updateCampaignDraftRecommendations(contactId, kept);
    if (!draft) {
      return adminJsonError("not_editable", "Draft not found or no longer editable.", 409);
    }

    return adminJson({
      ok: true,
      // id = the full ref, so the review card round-trips variants intact;
      // name/url are the variant-projected display values.
      recommendations: kept.map((ref) => recommendationView(ref, byRef.get(ref))),
      dropped,
    });
  } catch (err) {
    reportError(err, { route: "api/admin/campaign/recommendations" });
    return adminJsonError("internal_error", "Could not update the recommendations.", 500);
  }
}
