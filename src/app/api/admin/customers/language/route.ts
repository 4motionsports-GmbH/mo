// POST /api/admin/customers/language  { customerId, language: "de" | "en" | null }
//
// Pin (or clear) the person's e-mail language (customers.language_override,
// 0061). Every campaign and the Einzelansprache use it; open recipient rows
// follow at once.

import { guardAdminPost, adminJson, adminJsonError } from "@/lib/admin-api";
import { getSql } from "@/lib/db";
import { reportError } from "@/lib/observability";

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
  const sql = getSql();
  if (!sql) return adminJsonError("no_database", "No database configured.", 503);
  try {
    const rows = await sql`UPDATE customers SET language_override = ${language} WHERE id = ${customerId} RETURNING id`;
    if (rows.length === 0) return adminJsonError("not_found", "Kunde nicht gefunden.", 404);
    await sql`
      UPDATE campaign_contacts SET language_override = ${language}
       WHERE customer_id = ${customerId} AND status IN ('pending', 'drafted', 'draft_failed')
    `;
    return adminJson({ ok: true });
  } catch (err) {
    reportError(err, { route: "api/admin/customers/language" });
    return adminJsonError("internal_error", "Die Sprache konnte nicht gespeichert werden.", 500);
  }
}
