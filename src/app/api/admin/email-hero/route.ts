// GET /api/admin/email-hero?kind=marketing|campaign&id=<n> — the stored hero
// state of one draft (custom image URL + prompt, null = default hero) plus
// whether generation is configured. Backs the HeroImagePanel's initial load.

import { guardAdminGet, adminJson, adminJsonError } from "@/lib/admin-api";
import { isDbConfigured } from "@/lib/db";
import { getEmailHero, parseEmailHeroKind } from "@/lib/email-hero-store";
import { defaultHeroImageUrl, isHeroGenerationConfigured } from "@/lib/email-hero";

export const maxDuration = 15;

export async function GET(req: Request) {
  const blocked = await guardAdminGet();
  if (blocked) return blocked;

  const url = new URL(req.url);
  const kind = parseEmailHeroKind(url.searchParams.get("kind"));
  const id = Number(url.searchParams.get("id"));
  if (!kind || !Number.isInteger(id) || id <= 0) {
    return adminJsonError("bad_request", "kind und id erforderlich.", 400);
  }

  const state = isDbConfigured() ? await getEmailHero(kind, id) : null;
  return adminJson({
    url: state?.url ?? null,
    prompt: state?.prompt ?? null,
    defaultUrl: defaultHeroImageUrl(),
    generationConfigured: isHeroGenerationConfigured(),
  });
}
