// POST /api/admin/customers/language  { customerId, language: "de" | "en" | null }
//
// Pin (or clear) the person's e-mail language (customers.language_override,
// 0061). Every campaign and the Einzelansprache use it; open recipient rows
// follow at once.

import { guardAdminPost, adminJson, adminJsonError } from "@/lib/admin-api";
import { setCustomerLanguageOverride } from "@/lib/customer-store";

export async function POST(req: Request) {
  const blocked = await guardAdminPost(req);
  if (blocked) return blocked;
  let body: { customerId?: unknown; language?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return adminJsonError("bad_request", "Invalid JSON body", 400);
  }
  const customerId = Number(body.customerId);
  const language = body.language === "de" || body.language === "en" ? body.language : null;
  if (!Number.isInteger(customerId) || customerId <= 0) return adminJsonError("bad_request", "customerId required", 400);
  const ok = await setCustomerLanguageOverride(customerId, language);
  if (ok === false) return adminJsonError("not_found", "Kunde nicht gefunden.", 404);
  if (ok === null) return adminJsonError("internal_error", "Die Sprache konnte nicht gespeichert werden.", 500);
  return adminJson({ ok: true });
}
