// POST /api/admin/email-hero/generate — render the (operator-edited) prompt
// with the image model, upload to Vercel Blob and store URL + prompt on the
// draft row. Body: { kind, id, prompt }. Returns { url }. Preview and send
// pick the image up automatically (withEmailRenderData on the send paths).

import { guardAdminPost, adminJson, adminJsonError } from "@/lib/admin-api";
import { isDbConfigured } from "@/lib/db";
import { recordAdminAccess } from "@/lib/admin-access-log";
import {
  generateHeroImage,
  MAX_HERO_PROMPT_CHARS,
  MAX_HERO_HEADLINE_CHARS,
  normalizeHeroPrompt,
} from "@/lib/email-hero";
import { parseEmailHeroKind, setEmailHeroHeadline } from "@/lib/email-hero-store";
import { reportError } from "@/lib/observability";

// Image generation takes tens of seconds per render, and a failed quality
// check spends one more render + check — the longest admin route we have.
export const maxDuration = 300;

export async function POST(req: Request) {
  const blocked = await guardAdminPost(req);
  if (blocked) return blocked;

  let kind, id: number, prompt: string;
  let headline: string | null = null;
  try {
    const body = (await req.json()) as {
      kind?: unknown;
      id?: unknown;
      prompt?: unknown;
      headline?: unknown;
    };
    kind = parseEmailHeroKind(body.kind);
    if (!kind || typeof body.id !== "number" || !Number.isInteger(body.id) || body.id <= 0) {
      return adminJsonError("bad_request", "kind und id erforderlich.", 400);
    }
    id = body.id;
    // Measure exactly what the generator will measure (same normalisation), so
    // the route and the generator can never disagree on the length.
    const normalizedPrompt =
      typeof body.prompt === "string" ? normalizeHeroPrompt(body.prompt) : "";
    if (!normalizedPrompt) {
      return adminJsonError("bad_request", "Bitte einen Prompt eingeben.", 400);
    }
    if (normalizedPrompt.length > MAX_HERO_PROMPT_CHARS) {
      return adminJsonError(
        "bad_request",
        `Prompt zu lang: ${normalizedPrompt.length} von ${MAX_HERO_PROMPT_CHARS} Zeichen — ` +
          `bitte die Szene um ${normalizedPrompt.length - MAX_HERO_PROMPT_CHARS} Zeichen kürzen.`,
        400
      );
    }
    prompt = normalizedPrompt;
    if (typeof body.headline === "string" && body.headline.trim()) {
      if (body.headline.length > MAX_HERO_HEADLINE_CHARS) {
        return adminJsonError(
          "bad_request",
          `Headline ist zu lang (max. ${MAX_HERO_HEADLINE_CHARS} Zeichen).`,
          400
        );
      }
      headline = body.headline.trim();
    }
  } catch {
    return adminJsonError("bad_request", "Invalid JSON body", 400);
  }

  if (!isDbConfigured()) {
    return adminJsonError("unavailable", "No database configured", 503);
  }

  try {
    await recordAdminAccess({ action: "email_hero.generate", detail: { kind, id } }, req);
    const result = await generateHeroImage(kind, id, prompt);
    if (!result.ok) return adminJsonError("bad_request", result.message, 400);
    // The headline rides along so one click saves the whole hero.
    if (headline) await setEmailHeroHeadline(kind, id, headline);
    return adminJson({ url: result.url, review: result.review });
  } catch (err) {
    reportError(err, { route: "api/admin/email-hero/generate" });
    return adminJsonError("internal_error", "Bild-Generierung fehlgeschlagen.", 500);
  }
}
