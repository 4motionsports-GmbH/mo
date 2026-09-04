// Reference photos for the hero render: the catalogue pictures of the exact
// products the scene should show, handed to the image model alongside the
// prompt (images.edit with input_fidelity "high") so it reproduces the real
// rack, bench or plate instead of a plausible generic one.
//
// Pure selection + prompt text here (tested); the fetch/resize helper takes
// its fetch implementation as a parameter so it is testable without network.

/** How many reference pictures go to the model: every recommended product
 * (a marketing mail carries up to 4, a campaign mail 3) plus up to two owned
 * ones for the "familiar" pieces. gpt-image-2 accepts up to 16. */
export const MAX_REFERENCE_IMAGES = 6;
export const MAX_OWNED_REFERENCES = 2;

/** Longest edge of a reference picture. Enough for shape, colour and
 * markings; image-input tokens scale with pixels, so no larger. */
export const REFERENCE_MAX_PX = 768;
export const REFERENCE_JPEG_QUALITY = 85;

/** First https picture of a catalogue product, or null. */
export function firstProductImage(product) {
  const images = Array.isArray(product?.images) ? product.images : [];
  return images.find((u) => typeof u === "string" && u.startsWith("https://")) ?? null;
}

/**
 * Catalogue ids of products the customer already owns, newest order first,
 * from either purchase-history shape (campaign: `productId`, chat customer:
 * `handle` — both are the catalogue id).
 * @param {{ orders?: Array<{ items?: Array<{ productId?: string | null, handle?: string | null }> }> } | null | undefined} history
 * @param {number} [limit]
 * @returns {string[]}
 */
export function ownedProductIds(history, limit = MAX_OWNED_REFERENCES) {
  const out = [];
  const seen = new Set();
  for (const order of Array.isArray(history?.orders) ? history.orders : []) {
    for (const item of Array.isArray(order?.items) ? order.items : []) {
      const id = (typeof item?.productId === "string" && item.productId) ||
        (typeof item?.handle === "string" && item.handle) || "";
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push(id);
      if (out.length >= limit) return out;
    }
  }
  return out;
}

/**
 * Which pictures to send, in order: the recommended products first (the ones
 * the mail sells — they must look right), then owned ones. One picture per
 * product, de-duplicated by URL, capped at MAX_REFERENCE_IMAGES.
 * @param {{ recommended?: Array<{ name?: string, images?: string[] }>, owned?: Array<{ name?: string, images?: string[] }>, max?: number }} input
 * @returns {{ label: string, url: string, role: "new" | "owned" }[]}
 */
export function pickReferenceCandidates({ recommended = [], owned = [], max = MAX_REFERENCE_IMAGES } = {}) {
  const out = [];
  const seen = new Set();
  const add = (p, role) => {
    if (out.length >= max) return;
    const url = firstProductImage(p);
    const label = typeof p?.name === "string" ? p.name.trim() : "";
    if (!url || !label || seen.has(url)) return;
    seen.add(url);
    out.push({ label, url, role });
  };
  for (const p of recommended) add(p, "new");
  for (const p of owned.slice(0, MAX_OWNED_REFERENCES)) add(p, "owned");
  return out;
}

/**
 * The prompt block that tells the model what the attached pictures are —
 * appended after the scene + style tail. Numbered so the model can map
 * pictures to the products named in the scene.
 * @param {{ label: string, role: "new" | "owned" }[]} refs
 * @returns {string}
 */
export function referenceInstruction(refs) {
  if (!refs.length) return "";
  const list = refs
    .map((r, i) => `picture ${i + 1} = ${r.label}${r.role === "owned" ? " (already owned, background)" : ""}`)
    .join("; ");
  return (
    `REFERENCE PHOTOS: the attached pictures are catalogue photos of the exact products to show — ${list}. ` +
    "Reproduce each product's real shape, proportions, colour, finish and markings faithfully, " +
    "but PHOTOGRAPH them naturally inside the scene: correct perspective, the scene's own light and shadows, " +
    "standing on the floor or mounted as such equipment is used. Never paste them in as flat cut-outs, " +
    "never show their white catalogue backgrounds, never render them as stickers or screenshots."
  );
}

/** Prompt + reference block (unchanged prompt when there are no references). */
export function withReferenceInstruction(prompt, refs) {
  const block = referenceInstruction(refs);
  return block ? `${prompt}\n\n${block}` : prompt;
}

/**
 * Downscale a catalogue picture for the model: longest edge REFERENCE_MAX_PX,
 * JPEG. Returns the bytes.
 * @param {Buffer | Uint8Array} image
 * @returns {Promise<Buffer>}
 */
export async function prepareReferenceImage(image) {
  const { default: sharp } = await import("sharp");
  return sharp(image)
    .resize({ width: REFERENCE_MAX_PX, height: REFERENCE_MAX_PX, fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: REFERENCE_JPEG_QUALITY, mozjpeg: true })
    .toBuffer();
}

/**
 * Fetch + prepare the candidate pictures. Every failure (timeout, 404, not
 * an image) just drops that picture — the render must never fail because a
 * catalogue picture is unreachable.
 * @param {{ label: string, url: string, role: "new" | "owned" }[]} candidates
 * @param {{ fetchImpl?: typeof fetch, timeoutMs?: number, prepare?: (bytes: Buffer) => Promise<Buffer> }} [opts]
 * @returns {Promise<{ label: string, url: string, role: "new" | "owned", bytes: Buffer }[]>}
 */
export async function loadReferenceImages(candidates, opts = {}) {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 8000;
  const prepare = opts.prepare ?? prepareReferenceImage;
  const results = await Promise.all(
    candidates.map(async (c) => {
      try {
        const res = await fetchImpl(c.url, { signal: AbortSignal.timeout(timeoutMs) });
        if (!res.ok) return null;
        const type = res.headers?.get?.("content-type") ?? "";
        if (type && !type.startsWith("image/")) return null;
        const bytes = Buffer.from(await res.arrayBuffer());
        if (!bytes.length) return null;
        return { ...c, bytes: await prepare(bytes) };
      } catch {
        return null;
      }
    })
  );
  return results.filter(Boolean);
}
