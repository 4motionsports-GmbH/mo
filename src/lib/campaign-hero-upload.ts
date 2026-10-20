// The Kampagnenbild upload (I/O): process an uploaded picture into the two
// hero files and store them in the blob store. Called by
// POST /api/admin/campaigns/hero-image. docs/EMAIL_DESIGNS.md.
//
// STAGED, not saved: this writes only the blob files and returns the value
// object; the editor keeps it in its form state and „Speichern“ commits it
// through the ordinary create / update calls (validated again there by
// campaign-def.mjs). So a new campaign can get its picture before it has an
// id (key `campaign-default-new-…`), and „Entfernen“ is just `null` on save.
//
// Blobs are NEVER deleted here or anywhere else: sent mails reference the
// file names, served with a one-year immutable cache. Every upload gets a new
// name (stamp + the SDK's random suffix, no overwrite). An unsaved or
// replaced upload stays as an orphan of ~150–300 KB — accepted.

import { put } from "@vercel/blob";
import { buildUploadedHeroVariants } from "./email-hero-variants.mjs";
import { CAMPAIGN_DEFAULT_HERO_KIND, heroBlobFileFromPathname, heroBlobKey } from "./email-hero-blob.mjs";
import { heroUploadError, sanitizeUploadName } from "./email-hero-upload.mjs";
import { normalizeCampaignHeroImage } from "./campaign-hero.mjs";
import { reportError } from "./observability";
import type { CampaignHeroImage } from "./campaigns-store";

/** Longest wait for one Blob write (both run in parallel) — well under the route's 60 s. */
const BLOB_PUT_TIMEOUT_MS = 25_000;

export type CampaignHeroUploadResult =
  | { ok: true; heroImage: CampaignHeroImage; warnings: string[] }
  | { ok: false; code: string; status: number; message: string };

/**
 * Process and store one uploaded picture. `aiGenerated` is the operator's
 * statement (EU label + machine-readable marking); `campaignId` only names
 * the files (null before the first save). A fault in our own processing
 * throws (the route reports it); everything else is a result.
 */
export async function storeCampaignHeroUpload(
  bytes: Buffer,
  opts: { aiGenerated: boolean; campaignId: number | null; name: string | null }
): Promise<CampaignHeroUploadResult> {
  const built = await buildUploadedHeroVariants(bytes, { aiGenerated: opts.aiGenerated });
  if (!built.ok) return built;

  // The store is PRIVATE (it also holds the catalog + embeddings); the files
  // are published through /api/email-hero-image — see email-hero-blob.mjs.
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), BLOB_PUT_TIMEOUT_MS);
  const blobOpts = {
    access: "private" as const,
    contentType: "image/jpeg",
    addRandomSuffix: true,
    token: process.env.BLOB_READ_WRITE_TOKEN,
    // The SDK retries an unreachable store for minutes; the route has 60 s.
    // Give up in time so the operator gets „bitte erneut versuchen“ instead
    // of a gateway timeout. NOT AbortSignal.timeout(): its TimeoutError is
    // retried by @vercel/blob — only a reason-less abort() (an AbortError)
    // makes the SDK stop. One controller covers both parallel writes.
    abortSignal: abort.signal,
  };
  const owner = opts.campaignId ?? "new";
  const stamp = Date.now(); // one stamp for both files: they stay a recognisable pair
  let file: string;
  let mobileFile: string;
  try {
    const [desktopBlob, mobileBlob] = await Promise.all([
      put(heroBlobKey(CAMPAIGN_DEFAULT_HERO_KIND, owner, { ext: "jpg", stamp }), built.desktop, blobOpts),
      put(heroBlobKey(CAMPAIGN_DEFAULT_HERO_KIND, owner, { variant: "mobile", ext: "jpg", stamp }), built.mobile, blobOpts),
    ]);
    file = heroBlobFileFromPathname(desktopBlob.pathname);
    mobileFile = heroBlobFileFromPathname(mobileBlob.pathname);
  } catch (err) {
    reportError(err, { route: "lib/campaign-hero-upload", phase: "put" });
    return heroUploadError("storage_failed");
  } finally {
    clearTimeout(timer);
  }

  // Check our own output with the rule the save applies: should the blob
  // SDK ever name files differently than expected, the operator learns it
  // here — not as an unexplained „Kampagnenbild ungültig“ on every save.
  const heroImage = normalizeCampaignHeroImage({
    v: 1,
    file,
    mobileFile,
    ai: opts.aiGenerated,
    name: sanitizeUploadName(opts.name),
    width: built.sourceWidth,
    height: built.sourceHeight,
    uploadedAt: new Date().toISOString(),
  });
  if (!heroImage) {
    reportError(new Error(`unexpected hero blob names: ${file} / ${mobileFile}`), {
      route: "lib/campaign-hero-upload",
      phase: "validate",
    });
    return heroUploadError("storage_failed");
  }
  return { ok: true, heroImage, warnings: built.warnings };
}
