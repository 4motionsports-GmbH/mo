// The attachments of the AI designer („KI-Gestalter“, admin/vorlagen/
// DesignerPanel) — the rules the BROWSER applies before a file goes out with
// POST /api/admin/vorlagen/assist. Pure and tested
// (mail-designer-attachments.test.mjs); the decoding, the canvas and the
// FileReader live in admin/vorlagen/designer-attachments.ts. The server
// checks every attachment again — nothing here is trusted.
//
// Why the browser shrinks pictures: the whole request is ONE JSON body (the
// attachments as base64, the document, the conversation), and Vercel refuses
// a body over 4.5 MB with its own 413 before the route runs. A picture
// therefore goes out at most 1400 px wide (a model looks at about 1500 px
// anyway) — a tall screenshot stays tall, up to 12 000 px, and the server
// tiles it — re-encoded as JPEG 0.85 (the EXIF orientation applied). Sent as
// they are: a GIF up to 1.5 MB (it may be animated) and a PNG with real
// transparency up to 1.5 MB (a logo cut-out stays a cut-out).
//
// What may be attached: pictures (PNG, JPG, WebP, GIF; HEIC/AVIF/BMP when the
// browser can decode them — re-encoded), PDF up to 3 MB, HTML (.html, .htm),
// e-mails (.eml, the raw message) and text (.txt, .md) up to 400 KB each; at
// most 6 attachments, the whole request at most 4.2 MB. Refused with a hint:
// SVG (export as PNG), Office / Pages files (save as PDF), Outlook mails
// (.msg, .oft: a screenshot, or „Speichern unter → HTML“). Several files at
// once are sorted before any is read (sortAttachmentFiles): a refused file
// never takes one of the 6 places.

import { num } from "./admin-format.mjs";

export const DESIGNER_ATTACHMENT_LIMITS = Object.freeze({
  /** attachments per request — they stay for the whole conversation */
  maxCount: 6,
  /** the whole JSON body, the base64 attachments included (under Vercel's 4.5 MB) */
  maxRequestBytes: 4_200_000,
  maxPdfBytes: 3_000_000,
  /** HTML, e-mail (.eml) and text (.txt, .md) */
  maxTextBytes: 400_000,
  /** a GIF or a PNG with transparency up to this size is sent unchanged */
  keepImageBytes: 1_500_000,
  maxImageWidth: 1400,
  maxImageHeight: 12_000,
  /** the largest picture file the browser decodes at all */
  maxSourceImageBytes: 40_000_000,
  /** … and the most pixels (decoding memory) */
  maxSourcePixels: 100_000_000,
  /** JPEG qualities tried in turn — the first result up to imageTargetBytes wins */
  jpegQualities: Object.freeze([0.85, 0.75, 0.65]),
  imageTargetBytes: 2_500_000,
});

/**
 * What the attachments may weigh together as FILES (base64 makes them 4/3 as
 * large in the request; about 100 KB stay for the document and the
 * conversation) — what the panel shows; the exact check is
 * requestBudgetMessage on the real request.
 */
export const DESIGNER_ATTACHMENT_BUDGET_BYTES = Math.floor(((DESIGNER_ATTACHMENT_LIMITS.maxRequestBytes - 100_000) * 3) / 4);

/** `accept` of the file picker (HEIC is left out: iOS converts it to JPEG for this list). */
export const DESIGNER_ATTACHMENT_ACCEPT = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "application/pdf",
  ".pdf",
  "text/html",
  ".html",
  ".htm",
  "message/rfc822",
  ".eml",
  "text/plain",
  ".txt",
  "text/markdown",
  ".md",
].join(",");

/**
 * @typedef {"image/png" | "image/jpeg" | "image/webp" | "image/gif" | "application/pdf" | "text/html" | "text/plain" | "message/rfc822"} DesignerMediaType
 * @typedef {"image" | "pdf" | "text"} DesignerAttachmentKind
 */

/** Browser types → what is sent (images: what the file claims to be — the bytes decide later). */
const BY_TYPE = Object.freeze({
  "image/png": "image/png",
  "image/x-png": "image/png",
  "image/apng": "image/png",
  "image/jpeg": "image/jpeg",
  "image/jpg": "image/jpeg",
  "image/pjpeg": "image/jpeg",
  "image/webp": "image/webp",
  "image/gif": "image/gif",
  "image/heic": "image/heic",
  "image/heif": "image/heic",
  "image/avif": "image/avif",
  "image/bmp": "image/bmp",
  "application/pdf": "application/pdf",
  "application/x-pdf": "application/pdf",
  "text/html": "text/html",
  "application/xhtml+xml": "text/html",
  "message/rfc822": "message/rfc822",
  "text/plain": "text/plain",
  "text/markdown": "text/plain",
  "text/x-markdown": "text/plain",
});

/** Extensions that decide over the browser's type (operating systems report these unreliably or not at all). */
const DOCUMENT_EXTENSIONS = Object.freeze({
  pdf: "application/pdf",
  html: "text/html",
  htm: "text/html",
  xhtml: "text/html",
  eml: "message/rfc822",
  txt: "text/plain",
  text: "text/plain",
  md: "text/plain",
  markdown: "text/plain",
});

/** Picture extensions — used when the browser reports no type (some drag sources). */
const IMAGE_EXTENSIONS = Object.freeze({
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  jfif: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  heic: "image/heic",
  heif: "image/heic",
  avif: "image/avif",
  bmp: "image/bmp",
});

const OFFICE_EXTENSIONS = ["doc", "docx", "odt", "pages", "rtf", "ppt", "pptx", "key", "odp", "xls", "xlsx", "numbers", "ods"];

/**
 * Outlook's own mail files: a mail dragged out of Outlook for Windows arrives
 * as .msg (a template as .oft) — a binary format the KI cannot read, and
 * Outlook for Windows cannot save the .eml the general message asks for.
 */
const OUTLOOK_EXTENSIONS = ["msg", "oft"];
const OUTLOOK_TYPES = ["application/vnd.ms-outlook", "application/vnd.ms-outlook-template"];

/** The refusal of an Outlook mail file — also the advice of the panel's InfoTip „Was Anhänge bewirken“. */
export const OUTLOOK_MAIL_ADVICE =
  "Outlook-Mails (.msg) kann die KI nicht lesen — bitte einen Screenshot der Mail anhängen oder sie in Outlook über „Speichern unter → HTML“ speichern und die HTML-Datei anhängen.";

const ALLOWED_TEXT = "Bilder (PNG, JPG, WebP, GIF), PDF, HTML, E-Mails (.eml) oder Text (.txt, .md)";

/** @param {unknown} name */
function display(name) {
  const n = typeof name === "string" ? name.trim() : "";
  return n ? `„${n.length > 60 ? `${n.slice(0, 57)}…` : n}“` : "Die Datei";
}

/** @param {unknown} name */
function extensionOf(name) {
  return typeof name === "string" ? (/\.([A-Za-z0-9]+)$/.exec(name.trim())?.[1] ?? "").toLowerCase() : "";
}

/**
 * What a picked, dropped or pasted file is: its kind and the type it is sent
 * as (for pictures the claimed type — the bytes decide later), or the German
 * reason it cannot be attached.
 * @param {unknown} type  File.type
 * @param {unknown} name  File.name
 * @returns {{ ok: true, kind: DesignerAttachmentKind, mediaType: string } | { ok: false, message: string }}
 */
export function designerAttachmentType(type, name) {
  const t = typeof type === "string" ? type.split(";")[0].trim().toLowerCase() : "";
  const ext = extensionOf(name);
  const mediaType =
    /** @type {Record<string, string>} */ (DOCUMENT_EXTENSIONS)[ext] ??
    /** @type {Record<string, string>} */ (BY_TYPE)[t] ??
    /** @type {Record<string, string>} */ (IMAGE_EXTENSIONS)[ext] ??
    null;
  if (mediaType) {
    const kind = mediaType.startsWith("image/") ? "image" : mediaType === "application/pdf" ? "pdf" : "text";
    return { ok: true, kind, mediaType };
  }
  if (t === "image/svg+xml" || ext === "svg") {
    return { ok: false, message: `${display(name)}: SVG-Grafiken bitte vorher als PNG exportieren.` };
  }
  if (OUTLOOK_EXTENSIONS.includes(ext) || OUTLOOK_TYPES.includes(t)) {
    return { ok: false, message: `${display(name)}: ${OUTLOOK_MAIL_ADVICE}` };
  }
  if (OFFICE_EXTENSIONS.includes(ext)) {
    return { ok: false, message: `${display(name)}: Office- und Pages-Dateien bitte vorher als PDF speichern.` };
  }
  return { ok: false, message: `${display(name)}: Dieses Format kann die KI nicht lesen — bitte ${ALLOWED_TEXT} anhängen.` };
}

/**
 * Which of the files picked, dropped or pasted AT ONCE become attachments —
 * decided before any of them is read, so a file that cannot be attached never
 * takes one of the `max` places: a copy of a file that is already attached is
 * left out (copies), then type and size are checked (refused, with the German
 * reason), and only what passes counts against the limit (overLimit — „erst
 * einen Anhang entfernen“). Reading and decoding (a broken picture …) can
 * still fail later, one file at a time.
 * @param {ReadonlyArray<{ name?: unknown, type?: unknown, size?: unknown, key?: string | null }>} files
 *   in the order they came; key: name|size|lastModified of the file — null for a pasted picture (never a copy)
 * @param {{ count?: number, keys?: Iterable<string>, max?: number }} [current]
 *   count: attachments there already (also those still being read); keys: their keys
 * @returns {{ attach: number[], copies: number[], refused: Array<{ index: number, message: string }>, overLimit: number[] }}
 *   indexes into `files`
 */
export function sortAttachmentFiles(files, current = {}) {
  const max = Number.isFinite(current.max) ? Number(current.max) : DESIGNER_ATTACHMENT_LIMITS.maxCount;
  const keys = new Set(current.keys ?? []);
  let count = Math.max(0, Number(current.count) || 0);
  /** @type {number[]} */
  const attach = [];
  /** @type {number[]} */
  const copies = [];
  /** @type {Array<{ index: number, message: string }>} */
  const refused = [];
  /** @type {number[]} */
  const overLimit = [];
  (Array.isArray(files) ? files : []).forEach((f, index) => {
    const key = typeof f?.key === "string" && f.key ? f.key : null;
    if (key && keys.has(key)) {
      copies.push(index);
      return;
    }
    const type = designerAttachmentType(f?.type, f?.name);
    if (!type.ok) {
      refused.push({ index, message: type.message });
      return;
    }
    const tooBig = attachmentSizeProblem(type.kind, type.mediaType, Number(f?.size) || 0, f?.name);
    if (tooBig) {
      refused.push({ index, message: tooBig });
      return;
    }
    if (count >= max) {
      overLimit.push(index);
      return;
    }
    count += 1;
    if (key) keys.add(key);
    attach.push(index);
  });
  return { attach, copies, refused, overLimit };
}

/**
 * Is the file too big (or empty) for its kind? Null when it fits, else the
 * German message with what to do instead.
 * @param {DesignerAttachmentKind} kind
 * @param {string} mediaType
 * @param {number} bytes
 * @param {unknown} name
 * @returns {string | null}
 */
export function attachmentSizeProblem(kind, mediaType, bytes, name) {
  const L = DESIGNER_ATTACHMENT_LIMITS;
  const n = Number(bytes) || 0;
  if (n <= 0) return `${display(name)} ist leer.`;
  if (kind === "pdf" && n > L.maxPdfBytes) {
    return `${display(name)} ist größer als ${formatFileSize(L.maxPdfBytes)} — bitte nur die wichtigen Seiten als PDF speichern oder einen Screenshot anhängen.`;
  }
  if (kind === "text" && n > L.maxTextBytes) {
    const max = formatFileSize(L.maxTextBytes);
    if (mediaType === "message/rfc822") {
      return `${display(name)} ist größer als ${max} (vermutlich mit eingebetteten Bildern) — bitte stattdessen einen Screenshot der Mail anhängen.`;
    }
    if (mediaType === "text/html") return `${display(name)} ist größer als ${max} — bitte stattdessen einen Screenshot anhängen.`;
    return `${display(name)} ist größer als ${max} — bitte nur den nötigen Text anhängen.`;
  }
  if (kind === "image" && n > L.maxSourceImageBytes) {
    return `${display(name)} ist zu groß (über ${formatFileSize(L.maxSourceImageBytes)}) — bitte verkleinern oder einen Ausschnitt anhängen.`;
  }
  return null;
}

/** The message for a picture the browser cannot decode. */
export function unreadableImageMessage(name, mediaType) {
  if (mediaType === "image/heic") {
    return `${display(name)}: iPhone-Fotos (HEIC) kann dieser Browser nicht lesen — bitte vorher als JPG exportieren.`;
  }
  return `${display(name)} konnte nicht gelesen werden (beschädigt oder kein Bild).`;
}

/**
 * The real format of a picture from its first bytes (a file's name and type
 * can lie), or null.
 * @param {Uint8Array} bytes  at least the first 12 bytes
 * @returns {"image/png" | "image/jpeg" | "image/gif" | "image/webp" | null}
 */
export function sniffImageType(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(0);
  const ascii = (i, n) => String.fromCharCode(...b.subarray(i, i + n));
  const sig = (i, values) => values.every((v, k) => b[i + k] === v);
  if (b.length >= 8 && sig(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (b.length >= 3 && sig(0, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (b.length >= 6 && (ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a")) return "image/gif";
  if (b.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") return "image/webp";
  return null;
}

/**
 * Can a PNG be transparent at all? "alpha" (grey+alpha or RGBA), "trns" (a
 * transparency chunk), "none" — or null when the bytes are not a PNG. Many
 * screenshots are RGBA without a single transparent pixel, so "alpha" and
 * "trns" only mean the pixels are worth checking (hasTransparentPixel).
 * @param {Uint8Array} bytes  the whole file (the tRNS chunk sits before the image data)
 * @returns {"alpha" | "trns" | "none" | null}
 */
export function pngTransparency(bytes) {
  if (sniffImageType(bytes) !== "image/png" || bytes.length < 33) return null;
  const ascii = (i, n) => String.fromCharCode(...bytes.subarray(i, i + n));
  if (ascii(12, 4) !== "IHDR") return null;
  const colorType = bytes[25];
  if (colorType === 4 || colorType === 6) return "alpha";
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let off = 8;
  while (off + 8 <= bytes.length) {
    const len = view.getUint32(off);
    const type = ascii(off + 4, 4);
    if (type === "tRNS") return "trns";
    if (type === "IDAT" || type === "IEND") break;
    off += 12 + len;
  }
  return "none";
}

/**
 * Does RGBA pixel data (canvas getImageData) hold a visibly transparent
 * pixel? `threshold`: alpha below it counts (a downscaled edge keeps some).
 * @param {ArrayLike<number>} rgba
 * @param {number} [threshold]
 */
export function hasTransparentPixel(rgba, threshold = 250) {
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] < threshold) return true;
  return false;
}

/**
 * The size a picture is sent at: at most maxWidth wide and maxHeight tall,
 * the proportions kept (never enlarged).
 * @param {number} width
 * @param {number} height
 * @param {number} [maxWidth]
 * @param {number} [maxHeight]
 * @returns {{ width: number, height: number, scaled: boolean }}
 */
export function fitImageSize(width, height, maxWidth = DESIGNER_ATTACHMENT_LIMITS.maxImageWidth, maxHeight = DESIGNER_ATTACHMENT_LIMITS.maxImageHeight) {
  const scale = Math.min(1, maxWidth / width, maxHeight / height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    scaled: scale < 1,
  };
}

/**
 * What the browser does with a decoded picture: refuse it, send the original
 * bytes (a GIF, or a PNG with real transparency, up to keepImageBytes), or
 * re-encode it as JPEG at the planned size.
 * @param {{ type: string | null, bytes: number, width: number, height: number, transparent?: boolean, name?: unknown }} p
 *   type: the SNIFFED format (sniffImageType) — null for one only the browser could decode (HEIC, AVIF …);
 *   width/height: the oriented size (EXIF rotation applied)
 * @returns {{ ok: true, reencode: boolean, width: number, height: number, mediaType: "image/gif" | "image/png" | "image/jpeg" } | { ok: false, message: string }}
 */
export function planImageAttachment(p) {
  const L = DESIGNER_ATTACHMENT_LIMITS;
  const width = Number(p.width);
  const height = Number(p.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { ok: false, message: unreadableImageMessage(p.name, p.type) };
  }
  if (width * height > L.maxSourcePixels) {
    return {
      ok: false,
      message: `${display(p.name)} ist zu groß (über ${num(L.maxSourcePixels / 1_000_000)} Megapixel) — bitte verkleinern oder einen Ausschnitt anhängen.`,
    };
  }
  const bytes = Number(p.bytes) || 0;
  if (p.type === "image/gif" && bytes <= L.keepImageBytes) return { ok: true, reencode: false, width, height, mediaType: "image/gif" };
  if (p.type === "image/png" && p.transparent && bytes <= L.keepImageBytes) {
    return { ok: true, reencode: false, width, height, mediaType: "image/png" };
  }
  const fit = fitImageSize(width, height);
  return { ok: true, reencode: true, width: fit.width, height: fit.height, mediaType: "image/jpeg" };
}

/**
 * The text of an HTML or text file: UTF-8 when it is valid UTF-8, else
 * Windows-1252 (an old export) — sent re-encoded as UTF-8. A file with NUL
 * characters is not text.
 * @param {Uint8Array} bytes
 * @param {unknown} name
 * @returns {{ ok: true, text: string } | { ok: false, message: string }}
 */
export function readTextAttachment(bytes, name) {
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    text = new TextDecoder("windows-1252").decode(bytes);
  }
  if (text.includes("\u0000")) return { ok: false, message: `${display(name)} ist keine Textdatei.` };
  if (!text.trim()) return { ok: false, message: `${display(name)} ist leer.` };
  return { ok: true, text };
}

/** Bytes a file of `bytes` takes as base64. */
export function base64Size(bytes) {
  const n = Math.max(0, Number(bytes) || 0);
  return 4 * Math.ceil(n / 3);
}

/**
 * Does the request fit? Null when it does, else the German message naming the
 * attachments to remove — the largest first, until the rest fits. The names
 * carry the FILE size the operator sees on the attachment.
 * @param {{ requestBytes: number, attachments: Array<{ name: string, size: number, fileSize?: number }>, limit?: number }} p
 *   size: what the attachment takes in the request (its base64 length); fileSize: its file size
 * @returns {string | null}
 */
export function requestBudgetMessage({ requestBytes, attachments, limit = DESIGNER_ATTACHMENT_LIMITS.maxRequestBytes }) {
  const total = Number(requestBytes) || 0;
  if (total <= limit) return null;
  const sorted = [...(attachments ?? [])].sort((a, b) => b.size - a.size);
  /** @type {Array<{ name: string, size: number, fileSize?: number }>} */
  const remove = [];
  let left = total;
  for (const a of sorted) {
    if (left <= limit) break;
    remove.push(a);
    left -= a.size;
  }
  if (left > limit || remove.length === 0) {
    return `Die Mail ist für die KI zu umfangreich (${formatFileSize(total)}, höchstens ${formatFileSize(limit)}) — bitte „Neues Gespräch“ beginnen oder Bausteine entfernen.`;
  }
  const names = remove.map((a) => `${display(a.name)} (${formatFileSize(a.fileSize ?? a.size)})`).join(", ");
  return `Die Anhänge sind zusammen zu groß für eine Anfrage. Bitte ${remove.length === 1 ? "diesen Anhang" : "diese Anhänge"} entfernen: ${names}.`;
}

/**
 * A file size in German: „850 B“, „400 KB“, „1,2 MB“ (decimal units, like
 * the limits).
 * @param {unknown} bytes
 */
export function formatFileSize(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n < 1000) return `${num(n)} B`;
  const kb = Math.round(n / 1000);
  if (kb < 1000) return `${num(kb)} KB`;
  return `${num(n / 1_000_000, 1)} MB`;
}

/** The name of a picture pasted from the clipboard (the browser calls every one „image.png“). */
export function pastedImageName(index, mediaType) {
  const ext = mediaType === "image/jpeg" ? "jpg" : mediaType === "image/gif" ? "gif" : mediaType === "image/webp" ? "webp" : "png";
  return `Eingefügtes Bild ${index}.${ext}`;
}

/** What an attachment is, in one word (chips, screen readers). */
export function attachmentKindLabel(mediaType) {
  if (typeof mediaType === "string" && mediaType.startsWith("image/")) return "Bild";
  if (mediaType === "application/pdf") return "PDF";
  if (mediaType === "text/html") return "HTML";
  if (mediaType === "message/rfc822") return "E-Mail";
  return "Text";
}
