// POST /api/admin/campaigns/audience-preview  { audience } → { spec, description, preview }
//
// The wizard's live count: how many customers WITH consent the spec matches,
// how many talked to Mo, the language split and a few names. Pure DB.

import { guardAdminPost, adminJson, adminJsonError } from "@/lib/admin-api";
import { previewAudience } from "@/lib/audience-store";
import { describeAudienceSpec, normalizeAudienceSpec } from "@/lib/audience-spec.mjs";
import { ARCHETYPE_META } from "@/lib/persona";
import type { PersonaArchetype } from "@/lib/types";
import { reportError } from "@/lib/observability";

export const maxDuration = 60;

export async function POST(req: Request) {
  const blocked = await guardAdminPost(req);
  if (blocked) return blocked;
  let raw: unknown;
  try {
    raw = ((await req.json()) as { audience?: unknown }).audience;
  } catch {
    return adminJsonError("bad_request", "Invalid JSON body", 400);
  }
  try {
    const spec = normalizeAudienceSpec(raw);
    const preview = await previewAudience(spec);
    const description = describeAudienceSpec(spec, {
      personaLabel: (k: string) =>
        k === "unknown" ? "ohne Persona" : (ARCHETYPE_META[k as PersonaArchetype]?.label ?? k),
    });
    return adminJson({ spec, description, preview });
  } catch (err) {
    reportError(err, { route: "api/admin/campaigns/audience-preview" });
    return adminJsonError("internal_error", "Die Vorschau ist gerade nicht verfügbar.", 500);
  }
}
