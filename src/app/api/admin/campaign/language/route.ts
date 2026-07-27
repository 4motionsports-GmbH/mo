// POST /api/admin/campaign/language  { contactId, language: "de" | "en" | null }
//
// Pin the email language for ONE campaign contact (or clear the pin with
// null, returning to the Shopify-profile derivation). The override lives in
// its own column (migration 0040) so a re-sync never clobbers it; the
// EFFECTIVE language (override ?? derived) drives draft generation and the
// send-time rendering. The route only stores the choice — the UI chains a
// regenerate so the prose matches the new language (an existing draft keeps
// its text until then; the deterministic send-time blocks always follow the
// effective language).
//
// Auth + CSRF via guardAdminPost (the proxy already gates /api/admin/*).

import { guardAdminPost, adminJson, adminJsonError } from "@/lib/admin-api";
import { setContactLanguageOverride, getContactById } from "@/lib/campaign-store";
import { reportError } from "@/lib/observability";

export const maxDuration = 10;

export async function POST(req: Request) {
  const blocked = await guardAdminPost(req);
  if (blocked) return blocked;

  let contactId: number;
  let language: "de" | "en" | null;
  try {
    const body = (await req.json()) as { contactId?: unknown; language?: unknown };
    contactId = Number(body.contactId);
    if (!Number.isInteger(contactId) || contactId <= 0) {
      return adminJsonError("bad_request", "contactId required", 400);
    }
    if (body.language === "de" || body.language === "en") {
      language = body.language;
    } else if (body.language === null) {
      language = null;
    } else {
      return adminJsonError("bad_request", 'language must be "de", "en" or null.', 400);
    }
  } catch {
    return adminJsonError("bad_request", "Invalid JSON body", 400);
  }

  try {
    const contact = await getContactById(contactId);
    if (!contact) return adminJsonError("not_found", "Contact not found.", 404);
    if (contact.status === "sent" || contact.status === "sending") {
      return adminJsonError("already_sent", "Contact has already been sent.", 409);
    }

    // Normalize: pinning the language the profile already derives is the same
    // as "automatic" — store NULL so a future profile change keeps working.
    const override = language === contact.derivedLanguage ? null : language;
    const updated = await setContactLanguageOverride(contactId, override);
    if (!updated) return adminJsonError("not_found", "Contact not found.", 404);

    return adminJson({
      ok: true,
      language: updated.language,
      derivedLanguage: updated.derivedLanguage,
      languageOverride: updated.languageOverride,
    });
  } catch (err) {
    reportError(err, { route: "api/admin/campaign/language" });
    return adminJsonError("internal_error", "Could not update the language.", 500);
  }
}
