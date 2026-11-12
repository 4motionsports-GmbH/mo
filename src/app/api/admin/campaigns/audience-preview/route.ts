// POST /api/admin/campaigns/audience-preview  { audience, letterMode? }
//   → { spec, description, preview, allowSingleOptIn }
//
// The wizard's live count: how many customers WITH consent the spec matches,
// how many of them with double opt-in, how many talked to Mo, the language
// split and a few names; with „Nur diese Adressen“ the status of every listed
// address (in, unknown, no consent, blocked, left out by the other filters).
// `allowSingleOptIn` = CAMPAIGN_ALLOW_SINGLE_OPT_IN (without it only the
// double opt-in matches are sent). Pure DB.

import { guardAdminPost, adminJson, adminJsonError } from "@/lib/admin-api";
import { previewAudience } from "@/lib/audience-store";
import { describeAudienceSpec, normalizeAudienceSpec } from "@/lib/audience-spec.mjs";
import { getCampaign } from "@/lib/campaigns-store";
import { isSingleOptInAllowed } from "@/lib/campaign-flags.mjs";
import { ARCHETYPE_META } from "@/lib/persona";
import type { PersonaArchetype } from "@/lib/types";
import { reportError } from "@/lib/observability";

export const maxDuration = 60;

export async function POST(req: Request) {
  const blocked = await guardAdminPost(req);
  if (blocked) return blocked;
  let raw: unknown;
  let letterMode: "ohne_einwilligung" | "alle" | null = null;
  try {
    const body = (await req.json()) as { audience?: unknown; letterMode?: unknown };
    raw = body.audience;
    if (body.letterMode === "ohne_einwilligung" || body.letterMode === "alle") letterMode = body.letterMode;
  } catch {
    return adminJsonError("bad_request", "Invalid JSON body", 400);
  }
  try {
    const spec = normalizeAudienceSpec(raw);
    // The campaign names the description uses („nicht in: …“, „hat „…“ erhalten“).
    const ids = [...new Set([...(spec.excludeCampaignIds ?? []), ...(spec.receivedCampaign ? [spec.receivedCampaign.id] : [])])];
    const [preview, named] = await Promise.all([
      previewAudience(spec, undefined, { letterMode }),
      Promise.all(ids.map((id) => getCampaign(id))),
    ]);
    const names = new Map(named.flatMap((c) => (c ? [[c.id, c.name] as const] : [])));
    const description = describeAudienceSpec(spec, {
      personaLabel: (k: string) =>
        k === "unknown" ? "ohne Persona" : (ARCHETYPE_META[k as PersonaArchetype]?.label ?? k),
      campaignName: (id: number) => names.get(id) ?? `#${id}`,
    });
    return adminJson({ spec, description, preview, allowSingleOptIn: isSingleOptInAllowed() });
  } catch (err) {
    reportError(err, { route: "api/admin/campaigns/audience-preview" });
    return adminJsonError("internal_error", "Die Vorschau ist gerade nicht verfügbar.", 500);
  }
}
