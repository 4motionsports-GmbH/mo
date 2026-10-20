// GET /api/admin/email-hero?kind=marketing|campaign&id=<n> — the stored hero
// state of one draft (custom image URL + prompt, null = default hero) plus
// whether generation is configured. Backs the HeroImagePanel's initial load.
// `defaultUrl` is the picture the mail shows WITHOUT a per-draft hero: for a
// campaign draft the campaign's Kampagnenbild when it has one
// (`defaultSource: "campaign"`, campaign-hero.mjs), otherwise the design's
// default asset (`defaultSource: "design"`).

import { guardAdminGet, adminJson, adminJsonError } from "@/lib/admin-api";
import { isDbConfigured } from "@/lib/db";
import { getEmailHero, parseEmailHeroKind } from "@/lib/email-hero-store";
import { defaultHeroImageUrl, isHeroGenerationConfigured } from "@/lib/email-hero";
import { getCampaignForContact } from "@/lib/campaigns-store";
import { campaignHeroUrls } from "@/lib/campaign-hero.mjs";
import { getBaseUrl } from "@/lib/base-url";

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

  const db = isDbConfigured();
  const state = db ? await getEmailHero(kind, id) : null;
  // A campaign draft's id is its campaign_contacts id (null-safe lookup).
  const campaign = db && kind === "campaign" ? await getCampaignForContact(id) : null;
  const campaignHero = campaignHeroUrls(campaign?.heroImage ?? null, getBaseUrl());
  return adminJson({
    url: state?.url ?? null,
    prompt: state?.prompt ?? null,
    headline: state?.headline ?? null,
    defaultUrl: campaignHero?.desktop ?? defaultHeroImageUrl(),
    defaultSource: campaignHero ? "campaign" : "design",
    generationConfigured: isHeroGenerationConfigured(),
  });
}
