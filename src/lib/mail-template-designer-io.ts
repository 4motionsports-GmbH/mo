// I/O of the AI designer („KI-Gestalter“, pure core mail-template-designer.mjs,
// wiring mail-template-assist.ts). docs/EMAIL_TEMPLATES.md §6.
//
//   * the catalog behind search_products and the submission checks
//     (loadProductCatalog, cached 60 s by catalog-store) and the set of its
//     picture URLs (a product picture is only allowed when it is one);
//   * the shop's collections for list_collections and the link check —
//     Shopify Admin GraphQL, cached 10 minutes per instance, fail-soft (an
//     empty list with a German note when Shopify is not configured or down);
//   * the attachments: decoded and checked, pictures through sharp for the
//     MODEL only (EXIF-rotated, at most 1600 px wide, long screenshots cut
//     into parts — the stored original is untouched), PDFs as they are,
//     HTML / EML / TXT as text (EML → its HTML part);
//   * after an accepted design, the attachment pictures it uses („anhang:N“)
//     stored with storeTemplateImage and swapped in (or cleared with a note
//     when Blob is not configured or the upload fails).
//
// Every function here is fail-soft: a failure becomes a German message or a
// warning, never a thrown error into the stream.

import sharp from "sharp";
import { loadProductCatalog } from "./catalog-store";
import { adminGraphql, isShopifyConfigured } from "./shopify";
import { isTemplateImageUploadConfigured, storeTemplateImage } from "./mail-template-image";
import { reportError } from "./observability";
import {
  DESIGNER_LIMITS,
  SHOP_URL,
  catalogImageKeys,
  cleanHtmlForModel,
  collectionsFromGraphql,
  parseEml,
  replaceAttachmentPlaceholders,
  tilePlan,
  tilesPerImageFor,
  urlKey,
} from "./mail-template-designer.mjs";
import type { Product } from "./types";

/** A request attachment (parseAssistRequest). */
export interface DesignerAttachmentInput {
  name: string;
  mediaType: string;
  kind: "image" | "pdf" | "html" | "text" | "eml";
  data: string;
}

/** An attachment as the model gets it (designerUserContent). */
export interface PreparedDesignerAttachment {
  index: number;
  name: string;
  kind: "image" | "pdf" | "html" | "text" | "eml";
  width?: number;
  height?: number;
  parts?: Array<{ data: Uint8Array; mediaType: string }>;
  data?: Uint8Array;
  text?: string;
  subject?: string | null;
  truncated?: boolean;
}

export interface ShopCollection {
  handle: string;
  title: string;
  url: string;
}

/** Pixels sharp may decode for the model's copy (a full-page phone screenshot is ~30 MP). */
const MODEL_IMAGE_PIXELS = 60_000_000;
const COLLECTIONS_TTL_MS = 10 * 60 * 1000;
const COLLECTIONS_TIMEOUT_MS = 8_000;
/** One picture upload may take this long (storeTemplateImage's own Blob timeout is 25 s). */
const IMAGE_STORE_MAX_MS = 25_000;
/** Uploads may run until this long after the model's deadline (the route's maxDuration is 15 s later). */
const IMAGE_STORE_AFTER_DEADLINE_MS = 8_000;

// ── catalog ──────────────────────────────────────────────────────────────────

const imageKeysByCatalog = new WeakMap<readonly Product[], Set<string>>();

/** The catalog of one run and a check for its product pictures. Fail-soft: an empty catalog. */
export async function loadDesignerCatalog(): Promise<{ catalog: Product[]; isCatalogImage: (url: string) => boolean }> {
  let catalog: Product[] = [];
  try {
    catalog = await loadProductCatalog();
  } catch (err) {
    reportError(err, { route: "lib/mail-template-designer-io", phase: "catalog" });
  }
  let keys = imageKeysByCatalog.get(catalog);
  if (!keys) {
    keys = catalogImageKeys(catalog) as Set<string>;
    imageKeysByCatalog.set(catalog, keys);
  }
  const set = keys;
  return { catalog, isCatalogImage: (url: string) => set.has(urlKey(url)) };
}

// ── collections ──────────────────────────────────────────────────────────────

const COLLECTIONS_QUERY = /* GraphQL */ `
  query DesignerCollections($query: String) {
    collections(first: 100, query: $query) {
      nodes {
        handle
        title
      }
    }
  }
`;

let collectionsCache: { at: number; list: ShopCollection[] } | null = null;

const SEARCH_LINK_HINT = `für Kategorie-Links ${SHOP_URL}/search?q=<Begriff> verwenden`;

/**
 * The shop's collections (published ones first; when the filter finds none,
 * all), cached 10 minutes. Never throws.
 */
export async function listShopCollections(): Promise<{ collections: ShopCollection[]; note?: string }> {
  if (!isShopifyConfigured()) return { collections: [], note: `Shopify ist nicht verbunden — ${SEARCH_LINK_HINT}.` };
  if (collectionsCache && Date.now() - collectionsCache.at < COLLECTIONS_TTL_MS) return { collections: collectionsCache.list };
  try {
    const opts = { timeoutMs: COLLECTIONS_TIMEOUT_MS, retry: false } as const;
    let list = collectionsFromGraphql(await adminGraphql(COLLECTIONS_QUERY, { query: "published_status:published" }, opts));
    if (list.length === 0) list = collectionsFromGraphql(await adminGraphql(COLLECTIONS_QUERY, { query: null }, opts));
    collectionsCache = { at: Date.now(), list };
    return list.length ? { collections: list } : { collections: [], note: `Der Shop hat keine Kollektionen — ${SEARCH_LINK_HINT}.` };
  } catch (err) {
    reportError(err, { route: "lib/mail-template-designer-io", phase: "collections" });
    return { collections: [], note: `Die Kollektionen konnten gerade nicht geladen werden — ${SEARCH_LINK_HINT}.` };
  }
}

/** Is this a /collections/<handle> page of the shop? (the submission check's isKnownShopUrl) */
export async function isKnownCollectionUrl(url: string): Promise<boolean> {
  let handle: string;
  try {
    const m = /^\/collections\/([^/]+)\/?$/.exec(new URL(url).pathname);
    if (!m) return false;
    handle = decodeURIComponent(m[1]);
  } catch {
    return false;
  }
  const { collections } = await listShopCollections();
  return collections.some((c) => c.handle === handle);
}

// ── attachments ──────────────────────────────────────────────────────────────

type PreparedImage = { width: number; height: number; parts: Array<{ data: Uint8Array; mediaType: string }> };

/**
 * A picture for the model: oriented, at most 1600 px wide, a long screenshot
 * in parts (JPEG). "unreadable" / "too_large" when it cannot be used.
 */
async function prepareImage(bytes: Buffer, maxTiles: number): Promise<PreparedImage | "unreadable" | "too_large"> {
  let meta: sharp.Metadata;
  try {
    meta = await sharp(bytes).metadata();
  } catch {
    return "unreadable";
  }
  const rawWidth = meta.width ?? 0;
  // An animated GIF stacks its frames: the first frame (what sharp reads) is pageHeight tall.
  const rawHeight = meta.pageHeight ?? meta.height ?? 0;
  if (!rawWidth || !rawHeight) return "unreadable";
  if (rawWidth * rawHeight > MODEL_IMAGE_PIXELS) return "too_large";
  const swapped = (meta.orientation ?? 1) >= 5;
  const width = swapped ? rawHeight : rawWidth;
  const height = swapped ? rawWidth : rawHeight;
  const scale = Math.min(1, DESIGNER_LIMITS.imageMaxWidth / width);
  const sw = Math.max(1, Math.round(width * scale));
  const sh = Math.max(1, Math.round(height * scale));
  try {
    const parts: Array<{ data: Uint8Array; mediaType: string }> = [];
    for (const tile of tilePlan({ width: sw, height: sh, maxTiles })) {
      let img = sharp(bytes, { limitInputPixels: MODEL_IMAGE_PIXELS }).rotate().resize({ width: sw, height: sh, fit: "fill" });
      if (tile.top > 0 || tile.height < sh) img = img.extract({ left: 0, top: tile.top, width: sw, height: tile.height });
      const data = await img.flatten({ background: "#ffffff" }).jpeg({ quality: 85, mozjpeg: true }).toBuffer();
      parts.push({ data, mediaType: "image/jpeg" });
    }
    return { width, height, parts };
  } catch (err) {
    reportError(err, { route: "lib/mail-template-designer-io", phase: "image" });
    return "unreadable";
  }
}

/** Plain text for the model, cut to `max` characters. */
function clipPlainText(text: string, max: number): { text: string; truncated: boolean } {
  const s = text.replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (s.length <= max) return { text: s, truncated: false };
  return { text: `${s.slice(0, Math.max(0, max))}\n… [gekürzt]`, truncated: true };
}

/**
 * Decode and check the attachments and prepare them for the model. Returns
 * the prepared list and the original bytes of every picture (for storing the
 * ones the design uses), or a German message naming the attachment.
 */
export async function prepareDesignerAttachments(
  list: DesignerAttachmentInput[]
): Promise<{ ok: true; attachments: PreparedDesignerAttachment[]; originals: Map<number, Buffer> } | { ok: false; message: string }> {
  const attachments: PreparedDesignerAttachment[] = [];
  const originals = new Map<number, Buffer>();
  const maxTiles = tilesPerImageFor(list.filter((a) => a.kind === "image").length);
  let textBudget: number = DESIGNER_LIMITS.textCharsTotal;
  for (const [i, a] of list.entries()) {
    const index = i + 1;
    const label = `Anhang ${index} („${a.name}“)`;
    const bytes = Buffer.from(a.data, "base64");
    if (bytes.length === 0) return { ok: false, message: `${label} ist leer.` };
    if (a.kind === "image") {
      const img = await prepareImage(bytes, maxTiles);
      if (img === "unreadable") return { ok: false, message: `${label} ist kein lesbares Bild — bitte als PNG oder JPG anhängen.` };
      if (img === "too_large") {
        return { ok: false, message: `${label} ist zu groß (über ${MODEL_IMAGE_PIXELS / 1_000_000} Megapixel) — bitte verkleinern oder in Teilen anhängen.` };
      }
      attachments.push({ index, name: a.name, kind: "image", width: img.width, height: img.height, parts: img.parts });
      originals.set(index, bytes);
      continue;
    }
    if (a.kind === "pdf") {
      if (bytes.subarray(0, 5).toString("latin1") !== "%PDF-") return { ok: false, message: `${label} ist keine gültige PDF-Datei.` };
      attachments.push({ index, name: a.name, kind: "pdf", data: bytes });
      continue;
    }
    const raw = bytes.toString("utf8");
    const limit = Math.max(0, Math.min(DESIGNER_LIMITS.textChars, textBudget));
    if (a.kind === "eml") {
      const mail = parseEml(raw);
      if (!mail.html && !mail.text) return { ok: false, message: `${label}: In der E-Mail-Datei wurde kein lesbarer Inhalt gefunden.` };
      const body = mail.html ? cleanHtmlForModel(mail.html, limit) : clipPlainText(mail.text ?? "", limit);
      textBudget -= body.text.length;
      attachments.push({ index, name: a.name, kind: "eml", text: body.text, truncated: body.truncated, subject: mail.subject });
      continue;
    }
    const body = a.kind === "html" ? cleanHtmlForModel(raw, limit) : clipPlainText(raw, limit);
    if (!body.text) return { ok: false, message: `${label} ist leer.` };
    textBudget -= body.text.length;
    attachments.push({ index, name: a.name, kind: a.kind, text: body.text, truncated: body.truncated });
  }
  return { ok: true, attachments, originals };
}

// ── pictures of the accepted design ──────────────────────────────────────────

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), Math.max(0, ms));
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      }
    );
  });
}

/**
 * Store the attachment pictures an accepted design uses (original bytes →
 * storeTemplateImage: rotated, ≤ 1200 px, WebP → JPEG, served from
 * /api/email-hero-image/) and swap their placeholders for the URLs. Without
 * BLOB_READ_WRITE_TOKEN, or when an upload fails, the picture is cleared and
 * a warning says so. Never throws.
 */
export async function storeDesignerImages(
  doc: unknown,
  used: number[],
  originals: Map<number, Buffer>,
  opts: { deadlineAt?: number | null; onProgress?: (text: string) => void } = {}
): Promise<{ doc: ReturnType<typeof replaceAttachmentPlaceholders>; warnings: string[] }> {
  if (used.length === 0) return { doc: replaceAttachmentPlaceholders(doc, {}), warnings: [] };
  const names = used.map((n) => `Anhang ${n}`).join(", ");
  if (!isTemplateImageUploadConfigured()) {
    return { doc: replaceAttachmentPlaceholders(doc, {}), warnings: [`Bild-Upload nicht eingerichtet — Bild bitte selbst hochladen (${names}).`] };
  }
  opts.onProgress?.(used.length === 1 ? "Speichert das Bild aus dem Anhang …" : `Speichert ${used.length} Bilder aus den Anhängen …`);
  const until = opts.deadlineAt != null ? opts.deadlineAt + IMAGE_STORE_AFTER_DEADLINE_MS : Infinity;
  const budget = Math.max(3_000, Math.min(IMAGE_STORE_MAX_MS, until - Date.now()));
  const urls: Record<number, string> = {};
  const warnings: string[] = [];
  const results = await Promise.all(
    used.map(async (n) => {
      const bytes = originals.get(n);
      if (!bytes) return { n, result: null };
      const result = await withTimeout(storeTemplateImage(bytes), budget, null);
      return { n, result };
    })
  );
  for (const { n, result } of results) {
    if (result?.ok) {
      urls[n] = result.url;
      for (const w of result.warnings) warnings.push(`Anhang ${n}: ${w}`);
    } else {
      warnings.push(`Anhang ${n} konnte nicht gespeichert werden${result ? ` (${result.message})` : ""} — Bild bitte selbst hochladen.`);
    }
  }
  return { doc: replaceAttachmentPlaceholders(doc, urls), warnings };
}
