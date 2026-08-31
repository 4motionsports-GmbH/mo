// POST /api/admin/email-hero/suggest — draft the personalised hero-image
// prompt for one marketing send / campaign contact from the draft's actual
// context (products, prose, persona). Body: { kind, id }. Returns { prompt }
// — the operator edits it before generating. One small AI pass (costs tokens).

import { guardAdminPost, adminJson, adminJsonError } from "@/lib/admin-api";
import { recordAdminAccess } from "@/lib/admin-access-log";
import { suggestHeroPrompt } from "@/lib/email-hero";
import { parseEmailHeroKind } from "@/lib/email-hero-store";
import { reportError } from "@/lib/observability";

export const maxDuration = 30;

export async function POST(req: Request) {
  const blocked = await guardAdminPost(req);
  if (blocked) return blocked;

  let kind, id: number;
  try {
    const body = (await req.json()) as { kind?: unknown; id?: unknown };
    kind = parseEmailHeroKind(body.kind);
    if (!kind || typeof body.id !== "number" || !Number.isInteger(body.id) || body.id <= 0) {
      return adminJsonError("bad_request", "kind und id erforderlich.", 400);
    }
    id = body.id;
  } catch {
    return adminJsonError("bad_request", "Invalid JSON body", 400);
  }

  try {
    await recordAdminAccess({ action: "email_hero.suggest", detail: { kind, id } }, req);
    const result = await suggestHeroPrompt(kind, id);
    if (!result.ok) return adminJsonError("bad_request", result.message, 400);
    return adminJson({ prompt: result.prompt });
  } catch (err) {
    reportError(err, { route: "api/admin/email-hero/suggest" });
    return adminJsonError("internal_error", "Prompt-Vorschlag fehlgeschlagen.", 500);
  }
}
