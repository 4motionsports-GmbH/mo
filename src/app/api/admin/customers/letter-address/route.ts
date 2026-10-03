// POST /api/admin/customers/letter-address  { customerId } → AddressFillResult
//
// Kunden → Brief „Adresse aus letzter Bestellung holen“: the shipping address
// of the person's latest completed order (the only lawful source for an
// advertising letter, dossier § 6.4), read live from Shopify for that one
// order (postal-address-fill.ts). Refused while the letter channel is off.
// guardAdminPost; admin access log.

import { guardAdminPost, adminJson, adminJsonError } from "@/lib/admin-api";
import { recordAdminAccess } from "@/lib/admin-access-log";
import { fillPostalAddressesFromOrders } from "@/lib/postal-address-fill";
import { reportError } from "@/lib/observability";

export const maxDuration = 30;

export async function POST(req: Request) {
  const blocked = await guardAdminPost(req);
  if (blocked) return blocked;
  let customerId: number;
  try {
    customerId = Number(((await req.json()) as { customerId?: unknown }).customerId);
  } catch {
    return adminJsonError("bad_request", "Invalid JSON body", 400);
  }
  if (!Number.isInteger(customerId) || customerId <= 0) return adminJsonError("bad_request", "customerId required", 400);
  try {
    const r = await fillPostalAddressesFromOrders([customerId]);
    if (!r.ok && r.reason === "flag_off") {
      return adminJsonError("flag_off", "Briefversand ist nicht freigeschaltet — es werden keine Adressen geholt.", 403);
    }
    if (!r.ok && r.reason === "shopify_not_configured") return adminJsonError("shopify_not_configured", "Shopify ist nicht konfiguriert.", 503);
    if (!r.ok) return adminJsonError("internal_error", "Die Adresse konnte nicht geholt werden.", 500);
    await recordAdminAccess({ action: "customer.letter_address", targetCustomerId: customerId, detail: { filled: r.filled } }, req);
    return adminJson(r);
  } catch (err) {
    reportError(err, { route: "api/admin/customers/letter-address" });
    return adminJsonError("internal_error", "Die Adresse konnte nicht geholt werden.", 500);
  }
}
