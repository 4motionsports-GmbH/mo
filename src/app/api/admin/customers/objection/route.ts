// POST /api/admin/customers/objection  { customerId, kind: "profile" | "postal", objected }
//
// Record or lift an Art. 21 DSGVO objection the person told us about (mail,
// phone): `profile` stops the AI profile (and deletes the stored one),
// `postal` stops advertising letters. Kunden → Überblick / Brief. A profile
// objection also removes Mo's `mo-…` tags in Shopify (plan D-11).

import { guardAdminPost, adminJson, adminJsonError } from "@/lib/admin-api";
import { setCustomerObjection } from "@/lib/customer-store";
import { reportError } from "@/lib/observability";
import { recordAdminAccess } from "@/lib/admin-access-log";
import { removeInsightTags } from "@/lib/shopify-insights";

export async function POST(req: Request) {
  const blocked = await guardAdminPost(req);
  if (blocked) return blocked;
  let body: { customerId?: unknown; kind?: unknown; objected?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return adminJsonError("bad_request", "Invalid JSON body", 400);
  }
  const customerId = Number(body.customerId);
  if (!Number.isInteger(customerId) || customerId <= 0) return adminJsonError("bad_request", "customerId required", 400);
  if (body.kind !== "profile" && body.kind !== "postal") return adminJsonError("bad_request", "kind must be profile or postal", 400);
  try {
    const ok = await setCustomerObjection(customerId, body.kind, body.objected === true);
    if (!ok) return adminJsonError("not_found", "Kunde nicht gefunden.", 404);
    if (body.kind === "profile" && body.objected === true) await removeInsightTags(customerId);
    await recordAdminAccess(
      { action: "customer.objection", targetCustomerId: customerId, detail: { kind: body.kind, objected: body.objected === true } },
      req
    );
    return adminJson({ ok: true });
  } catch (err) {
    reportError(err, { route: "api/admin/customers/objection" });
    return adminJsonError("internal_error", "Der Widerspruch konnte nicht gespeichert werden.", 500);
  }
}
