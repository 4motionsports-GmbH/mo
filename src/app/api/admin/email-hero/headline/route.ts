// POST /api/admin/email-hero/headline — save (or clear) just the hero claim of
// one draft, without re-rendering the image. Body: { kind, id, headline }.
// The claim is the two-line headline the image-first designs show in the hero;
// null/empty falls back to the design's per-type default.

import { guardAdminPost, adminJson, adminJsonError } from "@/lib/admin-api";
import { isDbConfigured } from "@/lib/db";
import { recordAdminAccess } from "@/lib/admin-access-log";
import { parseEmailHeroKind, setEmailHeroHeadline } from "@/lib/email-hero-store";
import { MAX_HERO_HEADLINE_CHARS } from "@/lib/email-hero";
import { reportError } from "@/lib/observability";

export const maxDuration = 15;

export async function POST(req: Request) {
  const blocked = await guardAdminPost(req);
  if (blocked) return blocked;

  let kind, id: number;
  let headline: string | null;
  try {
    const body = (await req.json()) as { kind?: unknown; id?: unknown; headline?: unknown };
    kind = parseEmailHeroKind(body.kind);
    if (!kind || typeof body.id !== "number" || !Number.isInteger(body.id) || body.id <= 0) {
      return adminJsonError("bad_request", "kind und id erforderlich.", 400);
    }
    id = body.id;
    if (body.headline == null || (typeof body.headline === "string" && !body.headline.trim())) {
      headline = null;
    } else if (
      typeof body.headline === "string" &&
      body.headline.length <= MAX_HERO_HEADLINE_CHARS
    ) {
      headline = body.headline.trim();
    } else {
      return adminJsonError(
        "bad_request",
        `Headline ist zu lang (max. ${MAX_HERO_HEADLINE_CHARS} Zeichen).`,
        400
      );
    }
  } catch {
    return adminJsonError("bad_request", "Invalid JSON body", 400);
  }

  if (!isDbConfigured()) {
    return adminJsonError("unavailable", "No database configured", 503);
  }

  try {
    await recordAdminAccess({ action: "email_hero.headline", detail: { kind, id } }, req);
    const result = await setEmailHeroHeadline(kind, id, headline);
    if (!result.ok) {
      return result.notFound
        ? adminJsonError("not_found", "Entwurf nicht gefunden.", 404)
        : adminJsonError("internal_error", "Speichern fehlgeschlagen.", 500);
    }
    return adminJson({ ok: true });
  } catch (err) {
    reportError(err, { route: "api/admin/email-hero/headline" });
    return adminJsonError("internal_error", "Speichern fehlgeschlagen.", 500);
  }
}
