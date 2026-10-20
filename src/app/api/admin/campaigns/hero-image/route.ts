// POST /api/admin/campaigns/hero-image?ai=0|1&campaignId=<n>&name=<urlencoded>
//   body: the picture's raw bytes, Content-Type image/jpeg | image/png | image/webp
//   → { heroImage: CampaignHeroImage, warnings: string[] }
//
// The Kampagnenbild upload (Kampagnen-Editor → Gestaltung, also for new
// campaigns): checks and processes the picture (lib/email-hero-upload.mjs,
// email-hero-variants.mjs buildUploadedHeroVariants) and stores the desktop
// and phone files in the blob store. It writes NOTHING to the database — the
// editor keeps the returned value and „Speichern“ commits it through
// /api/admin/campaigns (create) or /update. No blob is ever deleted.
//
// Transport: ONE raw binary body (no multipart, no base64 — Vercel caps a
// request at 4.5 MB). CSRF: guardAdminPost with an exact list of image types,
// none of them CORS-safelisted, so a cross-site request still needs a
// preflight the admin never answers (lib/admin-content-type.mjs).
// `ai` is the operator's required statement where the picture comes from
// (EU label + machine-readable marking); `campaignId` only names the files
// and the access-log entry; `name` is the original file name (display only).

import { guardAdminPost, adminJson, adminJsonError } from "@/lib/admin-api";
import { recordAdminAccess } from "@/lib/admin-access-log";
import { isHeroUploadConfigured } from "@/lib/email-hero";
import {
  checkHeroUploadRequest,
  heroUploadError,
  HERO_UPLOAD_CONTENT_TYPES,
  HERO_UPLOAD_MAX_BYTES,
  parseHeroOrigin,
} from "@/lib/email-hero-upload.mjs";
import { storeCampaignHeroUpload } from "@/lib/campaign-hero-upload";
import { reportError } from "@/lib/observability";

// Decoding, one resize to 1536×720, the gradient and two JPEG encodes take a
// few seconds for a large photo; the two blob writes run in parallel.
export const maxDuration = 60;

function fail(e: { code: string; status: number; message: string }): Response {
  return adminJsonError(e.code, e.message, e.status);
}

/** Read the body, but never more than `max` bytes (a chunked body has no
 *  Content-Length to check up front). Null when it is larger. */
async function readBodyCapped(req: Request, max: number): Promise<Buffer | null> {
  if (!req.body) return Buffer.alloc(0);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks, total);
}

export async function POST(req: Request) {
  const blocked = await guardAdminPost(req, { accept: HERO_UPLOAD_CONTENT_TYPES });
  if (blocked) return blocked;

  if (!isHeroUploadConfigured()) return fail(heroUploadError("not_configured"));

  const params = new URL(req.url).searchParams;
  const aiGenerated = parseHeroOrigin(params.get("ai"));
  if (aiGenerated === null) return fail(heroUploadError("origin_required"));
  const rawId = params.get("campaignId");
  const campaignId = rawId && /^\d{1,12}$/.test(rawId) && Number(rawId) > 0 ? Number(rawId) : null;
  const name = params.get("name");

  const pre = checkHeroUploadRequest({ contentLength: req.headers.get("content-length") });
  if (!pre.ok) return fail(pre);

  try {
    const bytes = await readBodyCapped(req, HERO_UPLOAD_MAX_BYTES);
    if (!bytes) return fail(heroUploadError("too_large"));
    const read = checkHeroUploadRequest({ contentLength: bytes.length });
    if (!read.ok) return fail(read);

    const result = await storeCampaignHeroUpload(bytes, { aiGenerated, campaignId, name });
    if (!result.ok) return fail(result);

    await recordAdminAccess(
      { action: "campaign_hero.upload", detail: { campaignId, ai: aiGenerated, bytes: bytes.length } },
      req
    );
    return adminJson({ heroImage: result.heroImage, warnings: result.warnings });
  } catch (err) {
    reportError(err, { route: "api/admin/campaigns/hero-image" });
    return adminJsonError("internal_error", "Upload fehlgeschlagen — bitte erneut versuchen.", 500);
  }
}
