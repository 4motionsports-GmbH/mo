// GET  /api/admin/campaign/test-contacts            → { contacts: [...] }
// POST /api/admin/campaign/test-contacts
//   { action: "create", email, firstName?, language?, sourceEmail?,
//     discountPercent?, textMode? }                 → { contact, drafted }
//   { action: "delete", contactId }                 → { ok: true }
//
// Testkontakte for the Kampagne desk (migration 0057, docs/CAMPAIGNS.md §5):
// the operator's own inboxes as campaign contacts that survive every send.
// "create" also drafts the contact right away (with the desk's Vorbereiten
// settings, optionally borrowing a real customer's purchase history), so the
// card appears in the queue in one step. Everything a test send does is real —
// MK- code, set, tracked link, unsubscribe — only the KPIs ignore it.
//
// Auth + CSRF via guardAdminPost / guardAdminGet (the proxy already gates
// /api/admin/*).

import { guardAdminGet, guardAdminPost, adminJson, adminJsonError } from "@/lib/admin-api";
import {
  createTestContact,
  deleteTestContact,
  listTestContacts,
} from "@/lib/campaign-store";
import { prepareDraftForContact } from "@/lib/campaign-prepare";
import { isDbConfigured } from "@/lib/db";
import { parseDiscountPercent, DISCOUNT_PERCENT_MAX } from "@/lib/discount-validation.mjs";
import { DEFAULT_EMAIL_TEXT_MODE, EMAIL_TEXT_MODES, parseEmailTextMode } from "@/lib/email-text-mode.mjs";
import type { EmailTextMode } from "@/lib/marketing-draft";
import { reportError } from "@/lib/observability";

export const maxDuration = 60;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function contactPayload(hit: { contact: { id: number; email: string; firstName: string | null; lastName: string | null; language: "de" | "en"; status: string; testSourceEmail: string | null; sentAt: string | null }; hasDraft: boolean }) {
  return {
    id: hit.contact.id,
    email: hit.contact.email,
    firstName: hit.contact.firstName,
    lastName: hit.contact.lastName,
    language: hit.contact.language,
    status: hit.contact.status,
    sourceEmail: hit.contact.testSourceEmail,
    hasDraft: hit.hasDraft,
  };
}

export async function GET() {
  const blocked = await guardAdminGet();
  if (blocked) return blocked;
  const contacts = await listTestContacts();
  return adminJson({ contacts: contacts.map(contactPayload) });
}

export async function POST(req: Request) {
  const blocked = await guardAdminPost(req);
  if (blocked) return blocked;
  if (!isDbConfigured()) {
    return adminJsonError("no_database", "No database configured.", 503);
  }

  let body: {
    action?: unknown;
    contactId?: unknown;
    email?: unknown;
    firstName?: unknown;
    language?: unknown;
    sourceEmail?: unknown;
    discountPercent?: unknown;
    textMode?: unknown;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return adminJsonError("bad_request", "Invalid JSON body", 400);
  }

  if (body.action === "delete") {
    const contactId = Number(body.contactId);
    if (!Number.isInteger(contactId) || contactId <= 0) {
      return adminJsonError("bad_request", "contactId required", 400);
    }
    try {
      const deleted = await deleteTestContact(contactId);
      if (!deleted) return adminJsonError("not_found", "Testkontakt nicht gefunden.", 404);
      return adminJson({ ok: true });
    } catch (err) {
      reportError(err, { route: "api/admin/campaign/test-contacts", phase: "delete" });
      return adminJsonError("internal_error", "Could not delete the test contact.", 500);
    }
  }

  if (body.action !== "create") {
    return adminJsonError("bad_request", "action must be create or delete", 400);
  }
  const email = String(body.email ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) {
    return adminJsonError("bad_request", "Bitte eine gültige E-Mail-Adresse angeben.", 400);
  }
  const sourceEmail = String(body.sourceEmail ?? "").trim().toLowerCase();
  if (sourceEmail && !EMAIL_RE.test(sourceEmail)) {
    return adminJsonError("bad_request", "Die Kunden-E-Mail für die Kaufhistorie ist ungültig.", 400);
  }
  const firstName = String(body.firstName ?? "").trim() || null;
  const language: "de" | "en" = body.language === "en" ? "en" : "de";
  const parsedPercent = parseDiscountPercent(body.discountPercent ?? 0);
  if (parsedPercent === null) {
    return adminJsonError(
      "bad_request",
      `discountPercent must be a whole number between 0 and ${DISCOUNT_PERCENT_MAX}.`,
      400
    );
  }
  const parsedMode = body.textMode == null ? DEFAULT_EMAIL_TEXT_MODE : parseEmailTextMode(body.textMode);
  if (parsedMode === null) {
    return adminJsonError("bad_request", `textMode must be one of: ${EMAIL_TEXT_MODES.join(", ")}.`, 400);
  }

  try {
    const contact = await createTestContact({
      email,
      firstName,
      lastName: null,
      language,
      sourceEmail: sourceEmail || null,
    });
    if (!contact) return adminJsonError("internal_error", "Could not create the test contact.", 500);

    // Draft right away so the card is in the queue; a generation failure
    // leaves the contact 'pending' (the sheet offers „Entwurf erstellen“).
    let drafted = false;
    try {
      const draft = await prepareDraftForContact(contact, parsedPercent, {
        textMode: parsedMode as EmailTextMode,
        refreshRecommendations: true,
      });
      drafted = draft !== null;
    } catch (err) {
      reportError(err, { route: "api/admin/campaign/test-contacts", phase: "draft" });
    }
    const hits = await listTestContacts();
    const hit = hits.find((h) => h.contact.id === contact.id);
    return adminJson({
      contact: hit ? contactPayload(hit) : contactPayload({ contact, hasDraft: drafted }),
      drafted,
    });
  } catch (err) {
    reportError(err, { route: "api/admin/campaign/test-contacts", phase: "create" });
    return adminJsonError("internal_error", "Could not create the test contact.", 500);
  }
}
