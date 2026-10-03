// POST /api/admin/campaigns/letters/preview  { id, subject?, body? } → application/pdf
//
// The campaign letter as it would be printed — the stored purchase address
// (or a placeholder when none is usable yet), the text (unsaved edits may be
// passed), and the deterministic objection notice + company footer on every
// page. Read-only. guardAdminPost.

import { guardAdminPost, adminJsonError } from "@/lib/admin-api";
import { getCampaignLetter } from "@/lib/campaign-letters-store";
import { validateFullAddress } from "@/lib/physical-address.mjs";
import { buildLetterPdf } from "@/lib/letter-pdf.mjs";
import { reportError } from "@/lib/observability";

export const maxDuration = 30;

const PLACEHOLDER = {
  name: "(Empfänger:in — Adresse aus letzter Bestellung fehlt noch)",
  company: null,
  addressLine1: "(Straße)",
  addressLine2: null,
  postalCode: "(PLZ)",
  city: "(Ort)",
  country: "DE",
};

export async function POST(req: Request) {
  const blocked = await guardAdminPost(req);
  if (blocked) return blocked;
  let raw: { id?: unknown; subject?: unknown; body?: unknown };
  try {
    raw = (await req.json()) as typeof raw;
  } catch {
    return adminJsonError("bad_request", "Invalid JSON body", 400);
  }
  const id = Number(raw.id);
  if (!Number.isInteger(id) || id <= 0) return adminJsonError("bad_request", "id required", 400);
  try {
    const letter = await getCampaignLetter(id);
    if (!letter) return adminJsonError("not_found", "Brief nicht gefunden.", 404);
    const subject = typeof raw.subject === "string" ? raw.subject : letter.subject;
    const body = typeof raw.body === "string" ? raw.body : letter.body;
    if (!body?.trim()) return adminJsonError("no_text", "Noch kein Brieftext.", 409);
    const validated = letter.postalAddressSource === "purchase" ? validateFullAddress(letter.postalAddress) : { ok: false };
    const recipient = validated.ok && "address" in validated ? validated.address : PLACEHOLDER;
    const pdf = buildLetterPdf({ recipient: recipient as typeof PLACEHOLDER, subject: subject ?? null, body });
    return new Response(new Uint8Array(pdf), {
      status: 200,
      headers: { "Content-Type": "application/pdf", "Cache-Control": "no-store" },
    });
  } catch (err) {
    reportError(err, { route: "api/admin/campaigns/letters/preview" });
    return adminJsonError("internal_error", "Vorschau nicht möglich.", 500);
  }
}
