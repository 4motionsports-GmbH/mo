// POST /api/admin/catalog/availability  { refs: string[] }
//   → { items: CampaignRecommendationView[] }  (same order as refs)
//
// The set dialog's final check: re-resolves the card's recommendation refs
// (bare ids or "handle~variantId") against the CURRENT catalog right before a
// set is built — the desk's list may be hours old. Each item carries the same
// view the review desk uses: availability (null = no longer in the catalog),
// unit price and stock (stock-level.mjs). Read-only.
//
// Auth + CSRF via guardAdminPost (the proxy already gates /api/admin/*).

import { guardAdminPost, adminJson, adminJsonError } from "@/lib/admin-api";
import { resolveProductSelections } from "@/lib/product-catalog";
import { recommendationView } from "@/lib/campaign-recommendation-view";
import { reportError } from "@/lib/observability";

export const maxDuration = 15;

const MAX_REFS = 50;

export async function POST(req: Request) {
  const blocked = await guardAdminPost(req);
  if (blocked) return blocked;

  let refs: string[];
  try {
    const body = (await req.json()) as { refs?: unknown };
    if (!Array.isArray(body.refs) || body.refs.length === 0 || body.refs.length > MAX_REFS) {
      return adminJsonError("bad_request", `refs: 1 bis ${MAX_REFS} Produkt-Referenzen.`, 400);
    }
    refs = body.refs.map((r) => String(r ?? "").trim()).filter(Boolean);
    if (refs.length === 0) return adminJsonError("bad_request", "refs: leere Referenzen.", 400);
  } catch {
    return adminJsonError("bad_request", "Invalid JSON body", 400);
  }

  try {
    const selections = await resolveProductSelections(refs);
    const byRef = new Map(selections.map((s) => [s.ref, s]));
    return adminJson({ items: refs.map((ref) => recommendationView(ref, byRef.get(ref))) });
  } catch (err) {
    reportError(err, { route: "api/admin/catalog/availability" });
    return adminJsonError("internal_error", "Verfügbarkeit konnte nicht geprüft werden.", 500);
  }
}
