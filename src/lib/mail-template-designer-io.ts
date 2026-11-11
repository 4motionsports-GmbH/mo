// I/O of the AI designer („KI-Gestalter“, pure core mail-template-designer.mjs,
// wiring mail-template-assist.ts). docs/EMAIL_TEMPLATES.md §6.
//
//   * the catalog behind search_products and the submission checks
//     (loadProductCatalog, cached 60 s by catalog-store), the set of its
//     picture URLs (a product picture is only allowed when it is one) and
//     the shop's own Shopify file paths (where an attachment's pictures may
//     come from);
//   * the shop's collections and pages for list_collections and the link
//     check — Shopify Admin GraphQL, cached 10 minutes per instance (a failed
//     or empty answer 60 seconds; callers at the same time share one
//     request), fail-soft (an empty list with a German note when Shopify is
//     not configured or down);
//   * the attachments: decoded and checked (a text file over the size limit
//     is refused before it is decoded), pictures through sharp for the MODEL
//     only (EXIF-rotated, at most 1600 px wide, long screenshots cut into
//     parts, a transparent one laid on a background it stands out on — the
//     stored original is untouched), PDFs as they are, HTML / EML / TXT as
//     text (EML → its HTML part);
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
  base64DecodedBytes,
  catalogImageKeys,
  cleanHtmlForModel,
  collectionsFromGraphql,
  pagesFromGraphql,
  parseEml,
  pickFlattenBackground,
  replaceAttachmentPlaceholders,
  shopFilePrefixes,
  shopListCache,
  textAttachmentSizeProblem,
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
  /** A picture with transparency: the model's copy lies on `shownOn` (#rrggbb). */
  transparent?: boolean;
  shownOn?: string;
}

export interface ShopCollection {
  handle: string;
  title: string;
  url: string;
}

/** A page of the shop (/pages/<handle>: Ratgeber, Service, Aktionsseiten). */
export type ShopPage = ShopCollection;

/** Pixels sharp may decode for the model's copy (a full-page phone screenshot is ~30 MP). */
const MODEL_IMAGE_PIXELS = 60_000_000;
const COLLECTIONS_TTL_MS = 10 * 60 * 1000;
/** A failed or empty lookup is kept this long — a slow or broken Shopify is not asked again for every link. */
const COLLECTIONS_FAILED_TTL_MS = 60 * 1000;
const COLLECTIONS_TIMEOUT_MS = 8_000;
/** One picture upload may take this long (storeTemplateImage's own Blob timeout is 25 s). */
const IMAGE_STORE_MAX_MS = 25_000;
/** Uploads may run until this long after the model's deadline (the route's maxDuration is 15 s later). */
const IMAGE_STORE_AFTER_DEADLINE_MS = 8_000;

// ── catalog ──────────────────────────────────────────────────────────────────

const imageKeysByCatalog = new WeakMap<readonly Product[], { keys: Set<string>; prefixes: string[] }>();

/**
 * The catalog of one run, a check for its product pictures and the shop's own
 * Shopify file paths (shopFilePrefixes). Fail-soft: an empty catalog.
 */
export async function loadDesignerCatalog(): Promise<{ catalog: Product[]; isCatalogImage: (url: string) => boolean; shopFilePrefixes: string[] }> {
  let catalog: Product[] = [];
  try {
    catalog = await loadProductCatalog();
  } catch (err) {
    reportError(err, { route: "lib/mail-template-designer-io", phase: "catalog" });
  }
  let derived = imageKeysByCatalog.get(catalog);
  if (!derived) {
    derived = { keys: catalogImageKeys(catalog) as Set<string>, prefixes: shopFilePrefixes(catalog) };
    imageKeysByCatalog.set(catalog, derived);
  }
  const { keys, prefixes } = derived;
  return { catalog, isCatalogImage: (url: string) => keys.has(urlKey(url)), shopFilePrefixes: prefixes };
}

// ── collections and pages ────────────────────────────────────────────────────

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

const PAGES_QUERY = /* GraphQL */ `
  query DesignerPages($query: String) {
    pages(first: 100, query: $query) {
      nodes {
        handle
        title
        isPublished
      }
    }
  }
`;

const SEARCH_LINK_HINT = `für Kategorie-Links ${SHOP_URL}/search?q=<Begriff> verwenden`;

/** A cached Shopify list (shopListCache: 10 minutes, a failed or empty answer 60 seconds, one request at a time). */
function cachedShopList(phase: string, load: () => Promise<ShopCollection[]>) {
  return shopListCache<ShopCollection>(load, {
    okTtlMs: COLLECTIONS_TTL_MS,
    emptyTtlMs: COLLECTIONS_FAILED_TTL_MS,
    onError: (err) => reportError(err, { route: "lib/mail-template-designer-io", phase }),
  });
}

const SHOP_QUERY_OPTS = { timeoutMs: COLLECTIONS_TIMEOUT_MS, retry: false } as const;

/** The shop's collections (published ones first; when the filter finds none, all). */
const shopCollections = cachedShopList("collections", async () => {
  let list = collectionsFromGraphql(await adminGraphql(COLLECTIONS_QUERY, { query: "published_status:published" }, SHOP_QUERY_OPTS));
  if (list.length === 0) list = collectionsFromGraphql(await adminGraphql(COLLECTIONS_QUERY, { query: null }, SHOP_QUERY_OPTS));
  return list;
});

/** The shop's published pages (Ratgeber, Service, Aktionsseiten). */
const shopPages = cachedShopList("pages", async () => pagesFromGraphql(await adminGraphql(PAGES_QUERY, { query: "published_status:published" }, SHOP_QUERY_OPTS)));

/**
 * The tool list_collections: the shop's collections and pages, each with its
 * shop URL. Never throws — without Shopify, or when it is down, empty lists
 * with a German note.
 */
export async function listShopCollections(): Promise<{ collections: ShopCollection[]; pages: ShopPage[]; note?: string }> {
  if (!isShopifyConfigured()) return { collections: [], pages: [], note: `Shopify ist nicht verbunden — ${SEARCH_LINK_HINT}; Seiten (/pages/…) nur, wenn die Person sie nennt.` };
  const [collections, pages] = await Promise.all([shopCollections(), shopPages()]);
  const notes: string[] = [];
  if (collections.failed) notes.push(`Die Kollektionen konnten gerade nicht geladen werden — ${SEARCH_LINK_HINT}.`);
  else if (collections.list.length === 0) notes.push(`Der Shop hat keine Kollektionen — ${SEARCH_LINK_HINT}.`);
  if (pages.failed) notes.push("Die Seiten des Shops konnten gerade nicht geladen werden — Seiten (/pages/…) nur, wenn die Person sie nennt.");
  return { collections: collections.list, pages: pages.list, ...(notes.length ? { note: notes.join(" ") } : {}) };
}

/**
 * Does this /collections/<handle> or /pages/<handle> page of the shop exist?
 * (the submission check's isKnownShopUrl — one cached lookup per list)
 */
export async function isKnownShopPage(url: string): Promise<boolean> {
  let kind: string;
  let handle: string;
  try {
    const m = /^\/(collections|pages)\/([^/]+)\/?$/.exec(new URL(url).pathname);
    if (!m) return false;
    kind = m[1];
    handle = decodeURIComponent(m[2]);
  } catch {
    return false;
  }
  if (!isShopifyConfigured()) return false;
  const { list } = await (kind === "pages" ? shopPages() : shopCollections());
  return list.some((c) => c.handle === handle);
}

// ── attachments ──────────────────────────────────────────────────────────────

type PreparedImage = {
  width: number;
  height: number;
  parts: Array<{ data: Uint8Array; mediaType: string }>;
  transparent: boolean;
  background: string;
};

/**
 * The background a picture's model copy is laid on: white, unless the picture
 * has transparent pixels — then the one its visible pixels stand out on
 * (pickFlattenBackground over a small copy: a white logo cut-out would
 * otherwise reach the model as a blank white picture).
 */
async function flattenBackground(bytes: Buffer, hasAlpha: boolean): Promise<{ transparent: boolean; background: string }> {
  if (!hasAlpha) return { transparent: false, background: "#ffffff" };
  try {
    const { data } = await sharp(bytes, { limitInputPixels: MODEL_IMAGE_PIXELS })
      .rotate()
      .resize({ width: 64, height: 64, fit: "inside" })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    return pickFlattenBackground(data);
  } catch {
    return { transparent: false, background: "#ffffff" };
  }
}

/**
 * A picture for the model: oriented, at most 1600 px wide, a long screenshot
 * in parts (JPEG), a transparent one on a contrasting background.
 * "unreadable" / "too_large" when it cannot be used.
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
    const { transparent, background } = await flattenBackground(bytes, Boolean(meta.hasAlpha));
    const parts: Array<{ data: Uint8Array; mediaType: string }> = [];
    for (const tile of tilePlan({ width: sw, height: sh, maxTiles })) {
      let img = sharp(bytes, { limitInputPixels: MODEL_IMAGE_PIXELS }).rotate().resize({ width: sw, height: sh, fit: "fill" });
      if (tile.top > 0 || tile.height < sh) img = img.extract({ left: 0, top: tile.top, width: sw, height: tile.height });
      const data = await img.flatten({ background }).jpeg({ quality: 85, mozjpeg: true }).toBuffer();
      parts.push({ data, mediaType: "image/jpeg" });
    }
    return { width, height, parts, transparent, background };
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
    // A text file over the limit is refused BEFORE it is decoded (parseAssistRequest checks the same).
    const tooBig = textAttachmentSizeProblem(a.kind, a.mediaType, base64DecodedBytes(a.data), a.name);
    if (tooBig) return { ok: false, message: `Anhang ${index}: ${tooBig}` };
    const bytes = Buffer.from(a.data, "base64");
    if (bytes.length === 0) return { ok: false, message: `${label} ist leer.` };
    if (a.kind === "image") {
      const img = await prepareImage(bytes, maxTiles);
      if (img === "unreadable") return { ok: false, message: `${label} ist kein lesbares Bild — bitte als PNG oder JPG anhängen.` };
      if (img === "too_large") {
        return { ok: false, message: `${label} ist zu groß (über ${MODEL_IMAGE_PIXELS / 1_000_000} Megapixel) — bitte verkleinern oder in Teilen anhängen.` };
      }
      attachments.push({
        index,
        name: a.name,
        kind: "image",
        width: img.width,
        height: img.height,
        parts: img.parts,
        ...(img.transparent ? { transparent: true, shownOn: img.background } : {}),
      });
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
