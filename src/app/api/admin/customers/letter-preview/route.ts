// POST /api/admin/customers/letter-preview  { customerId, subject?, body? }
//
// Render the CURRENT letter (the on-screen subject/body, falling back to the
// stored draft) to a PDF and return it as application/pdf, so the admin sees the
// complete, print-accurate letter in a preview before sending. READ-ONLY: nothing
// is stored and no letter is submitted to Pingen.
//
// The recipient is the customer's lawfully-held postal address when present; if
// none is held yet, a clearly-marked placeholder is used so the layout/content is
// still visible (the real send still refuses without a complete lawful address).
//
// Auth + CSRF: guardAdminPost (the proxy already gates /api/admin/*).

import { guardAdminPost, adminJsonError } from "@/lib/admin-api";
import { getCustomerById } from "@/lib/customer-store";
import { physicalEligibilityForCustomer } from "@/lib/physical-mail";
import { buildLetterPdf } from "@/lib/letter-pdf.mjs";
import { reportError } from "@/lib/observability";

export const maxDuration = 30;

const PLACEHOLDER_RECIPIENT = {
  name: "(Empfänger:in — noch keine Adresse hinterlegt)",
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

  let customerId: number;
  let subject: string | null;
  let body: string;
  try {
    const json = (await req.json()) as { customerId?: unknown; subject?: unknown; body?: unknown };
    customerId = Number(json.customerId);
    if (!Number.isInteger(customerId) || customerId <= 0) {
      return adminJsonError("bad_request", "customerId required", 400);
    }
    subject = typeof json.subject === "string" ? json.subject : null;
    body = typeof json.body === "string" ? json.body : "";
  } catch {
    return adminJsonError("bad_request", "Invalid JSON body", 400);
  }

  try {
    const customer = await getCustomerById(customerId);
    if (!customer) return adminJsonError("not_found", "Kunde nicht gefunden.", 404);

    // Use the lawful address when held; otherwise a placeholder so the layout shows.
    const eligibility = physicalEligibilityForCustomer(customer);
    const recipient = eligibility.address ?? PLACEHOLDER_RECIPIENT;

    const effectiveSubject = subject ?? customer.letterDraftSubject;
    const effectiveBody = body.trim() ? body : customer.letterDraftBody ?? "";

    const pdf = buildLetterPdf({ recipient, subject: effectiveSubject, body: effectiveBody });

    return new Response(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="brief-vorschau-${customerId}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    reportError(err, { route: "api/admin/customers/letter-preview" });
    return adminJsonError("internal_error", "Vorschau fehlgeschlagen.", 500);
  }
}
