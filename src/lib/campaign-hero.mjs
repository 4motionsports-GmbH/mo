// The „Kampagnenbild“ — a campaign's own default hero picture (migration
// 0079, campaigns.hero_image). Pure and client-safe (no sharp, no I/O): the
// stored value's shape, the URLs built from it, and the ONE precedence rule
// every campaign render path uses. docs/EMAIL_DESIGNS.md, docs/CAMPAIGNS.md.
//
// What is stored is FILE NAMES, never URLs: `campaign-default-<id|new>-
// <stamp>[-mobile]-<random>.jpg` under email-heroes/, served publicly by
// /api/email-hero-image/<file>. The URL is built when a mail is rendered, so
// it follows PUBLIC_BASE_URL — and a forged save payload can never point a
// mail at a foreign host or at another blob (normalizeCampaignHeroImage).
//
// Precedence at render time (resolveCampaignHero), resolved ONCE as a pair:
//   1. the per-draft AI hero (campaign_drafts — Kampagnen-Desk „Erzeugen“),
//   2. the Kampagnenbild,
//   3. the design's global default asset (EMAIL_HERO_DEFAULT_URL).
// hero_mode 'none' drops the per-draft hero and headline but KEEPS the
// Kampagnenbild: Performance always shows a picture, so „Kein KI-Titelbild“
// means "no AI picture", not "no picture".

import { heroImagePublicUrl, parseHeroBlobFile } from "./email-hero-blob.mjs";
import { sanitizeUploadName } from "./email-hero-upload.mjs";

/**
 * @typedef {{ v: 1, file: string, mobileFile: string, ai: boolean, name: string | null,
 *   width: number | null, height: number | null, uploadedAt: string | null }} CampaignHeroImage
 */

/** The file names the upload writes (CAMPAIGN_DEFAULT_HERO_KIND in email-hero-blob.mjs):
 *  owner = campaign id or "new" (uploaded before the campaign was saved),
 *  stamp = the shared millisecond timestamp of the pair, then the phone
 *  variant and the blob SDK's random suffix. */
const CAMPAIGN_HERO_FILE_RE = /^campaign-default-(new|\d{1,12})-(\d{13})(-mobile)?(-[A-Za-z0-9]{1,64})?\.jpg$/;

/** Largest stored picture side considered plausible (display metadata). */
const MAX_SIDE = 20_000;

/**
 * Parse one Kampagnenbild file name.
 * @param {unknown} file
 * @returns {{ owner: string, stamp: string, mobile: boolean } | null}
 */
export function parseCampaignHeroFile(file) {
  if (typeof file !== "string" || parseHeroBlobFile(file) !== file) return null;
  const m = CAMPAIGN_HERO_FILE_RE.exec(file);
  if (!m) return null;
  return { owner: m[1], stamp: m[2], mobile: Boolean(m[3]) };
}

/**
 * Is `file` a valid Kampagnenbild file of this variant? Desktop files must
 * not carry `-mobile`, phone files must.
 * @param {unknown} file
 * @param {"desktop" | "mobile"} variant
 * @returns {boolean}
 */
export function campaignHeroFileOk(file, variant) {
  const p = parseCampaignHeroFile(file);
  return Boolean(p) && p.mobile === (variant === "mobile");
}

const intOrNull = (v) => (Number.isInteger(v) && v >= 1 && v <= MAX_SIDE ? v : null);

const isoOrNull = (v) => {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
};

/**
 * The stored / submitted value, cleaned — or null when it is not a valid
 * Kampagnenbild. Both files must be ours (campaign-default-…, passing the
 * public route's validation) and belong to ONE upload (same owner and
 * stamp); `ai` must be a real boolean (the operator's statement decides the
 * EU label — never guessed). Display fields are bounded; unknown keys are
 * dropped. A foreign URL, a traversal attempt or a per-draft
 * `campaign-<contactId>-…` file can never pass.
 * @param {unknown} raw
 * @returns {CampaignHeroImage | null}
 */
export function normalizeCampaignHeroImage(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = /** @type {Record<string, unknown>} */ (raw);
  if (r.v != null && r.v !== 1) return null;
  const desktop = parseCampaignHeroFile(r.file);
  const mobile = parseCampaignHeroFile(r.mobileFile);
  if (!desktop || desktop.mobile || !mobile || !mobile.mobile) return null;
  if (desktop.owner !== mobile.owner || desktop.stamp !== mobile.stamp) return null;
  if (typeof r.ai !== "boolean") return null;
  return {
    v: 1,
    file: /** @type {string} */ (r.file),
    mobileFile: /** @type {string} */ (r.mobileFile),
    ai: r.ai,
    name: sanitizeUploadName(r.name),
    width: intOrNull(r.width),
    height: intOrNull(r.height),
    uploadedAt: isoOrNull(r.uploadedAt),
  };
}

/**
 * The public URLs of a Kampagnenbild. `baseUrl` "" gives relative
 * `/api/email-hero-image/<file>` paths (the admin preview); a mail gets
 * getBaseUrl(). Null for anything that is not a valid value.
 * @param {unknown} h
 * @param {string} baseUrl
 * @returns {{ desktop: string, mobile: string } | null}
 */
export function campaignHeroUrls(h, baseUrl) {
  const v = normalizeCampaignHeroImage(h);
  if (!v) return null;
  const base = String(baseUrl ?? "").replace(/\/+$/, "");
  return { desktop: heroImagePublicUrl(base, v.file), mobile: heroImagePublicUrl(base, v.mobileFile) };
}

/**
 * @typedef {{ heroImageUrl?: string | null, heroImageMobileUrl?: string | null,
 *   heroHeadline?: string | null }} DraftHero
 * @typedef {{ heroImageUrl: string | null, heroImageMobileUrl: string | null,
 *   heroHeadline: string | null, heroIsAiGenerated: boolean | null }} HeroRender
 * @typedef {"ai" | "campaign" | "default"} HeroSource
 */

/**
 * The hero of ONE campaign mail: per-draft AI hero → Kampagnenbild → the
 * design's default. Desktop and phone picture always come from the same
 * source (a pre-0053 AI hero without a phone crop uses its own desktop file,
 * never the Kampagnenbild's crop). The headline is the draft's unless the
 * mode is 'none', whatever the picture. `snapshotImageUrl` is what the send
 * row may record — only the per-draft URL: the shared Kampagnenbild is never
 * copied into per-person rows (erasure would delete it).
 * @param {{ heroMode?: string | null, draft?: DraftHero | null, campaignHero?: unknown, baseUrl?: string }} a
 * @returns {{ render: HeroRender, source: HeroSource, snapshotImageUrl: string | null }}
 */
export function resolveCampaignHero(a) {
  const draft = a?.heroMode === "none" ? null : a?.draft ?? null;
  const heroHeadline = draft?.heroHeadline ?? null;
  if (draft?.heroImageUrl) {
    return {
      render: {
        heroImageUrl: draft.heroImageUrl,
        heroImageMobileUrl: draft.heroImageMobileUrl || draft.heroImageUrl,
        heroHeadline,
        heroIsAiGenerated: true,
      },
      source: "ai",
      snapshotImageUrl: draft.heroImageUrl,
    };
  }
  const campaignHero = normalizeCampaignHeroImage(a?.campaignHero);
  const urls = campaignHero ? campaignHeroUrls(campaignHero, a?.baseUrl ?? "") : null;
  if (campaignHero && urls) {
    return {
      render: {
        heroImageUrl: urls.desktop,
        heroImageMobileUrl: urls.mobile,
        heroHeadline,
        heroIsAiGenerated: campaignHero.ai,
      },
      source: "campaign",
      snapshotImageUrl: null,
    };
  }
  return {
    render: { heroImageUrl: null, heroImageMobileUrl: null, heroHeadline, heroIsAiGenerated: null },
    source: "default",
    snapshotImageUrl: null,
  };
}

/**
 * The `campaign_sends.hero_variant` of a sent mail (0054, 'campaign' since
 * 0079): what the reader actually saw. A Kampagnenbild under a design
 * without a hero (Studio) is invisible, so it counts as 'default' there.
 * @param {{ source: HeroSource, designHasHero: boolean, hasDesign: boolean }} a
 * @returns {"ai" | "campaign" | "default" | "none"}
 */
export function heroVariantForSnapshot(a) {
  if (a.source === "ai") return "ai";
  if (!a.hasDesign) return "none";
  if (a.source === "campaign" && a.designHasHero) return "campaign";
  return "default";
}

/**
 * Does the hero carry the EU „KI-generiertes Bild“ label? With a picture in
 * the render data: yes unless it was explicitly declared NOT AI (an uploaded
 * photo) — absent / null means a per-draft AI hero, so it fails toward the
 * label. Without one the design's default asset decides (`defaultIsAi`).
 * @param {{ heroImageUrl?: string | null, heroIsAiGenerated?: boolean | null } | null | undefined} rd
 * @param {boolean} defaultIsAi
 * @returns {boolean}
 */
export function heroAiLabel(rd, defaultIsAi) {
  return rd?.heroImageUrl ? rd.heroIsAiGenerated !== false : defaultIsAi;
}
