import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DESIGNER_ATTACHMENT_ACCEPT,
  DESIGNER_ATTACHMENT_BUDGET_BYTES,
  DESIGNER_ATTACHMENT_LIMITS as L,
  attachmentKindLabel,
  attachmentSizeProblem,
  base64Size,
  designerAttachmentType,
  fitImageSize,
  formatFileSize,
  hasTransparentPixel,
  pastedImageName,
  planImageAttachment,
  pngTransparency,
  readTextAttachment,
  requestBudgetMessage,
  sniffImageType,
  unreadableImageMessage,
} from "./mail-designer-attachments.mjs";

/** A PNG's first chunks: signature, IHDR (with `colorType`), optional extra chunks, IDAT. */
function png(colorType, extra = [], afterData = []) {
  const chunk = (type, data) => {
    const out = new Uint8Array(12 + data.length);
    new DataView(out.buffer).setUint32(0, data.length);
    out.set([...type].map((c) => c.charCodeAt(0)), 4);
    out.set(data, 8);
    return out; // CRC left as zeros — not checked
  };
  const ihdr = new Uint8Array(13);
  new DataView(ihdr.buffer).setUint32(0, 10);
  new DataView(ihdr.buffer).setUint32(4, 10);
  ihdr[8] = 8;
  ihdr[9] = colorType;
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    ...extra.map(([t, d]) => chunk(t, d)),
    chunk("IDAT", new Uint8Array(4)),
    ...afterData.map(([t, d]) => chunk(t, d)),
    chunk("IEND", new Uint8Array(0)),
  ];
  const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let off = 0;
  for (const p of parts) {
    all.set(p, off);
    off += p.length;
  }
  return all;
}
const ascii = (s) => new Uint8Array([...s].map((c) => c.charCodeAt(0)));

test("limits as agreed with the route: 6 files, 4.2 MB request, PDF 3 MB, text 400 KB, 1400 px", () => {
  assert.equal(L.maxCount, 6);
  assert.equal(L.maxRequestBytes, 4_200_000);
  assert.equal(L.maxPdfBytes, 3_000_000);
  assert.equal(L.maxTextBytes, 400_000);
  assert.equal(L.keepImageBytes, 1_500_000);
  assert.equal(L.maxImageWidth, 1400);
  assert.equal(L.maxImageHeight, 12_000);
  assert.equal(L.jpegQualities[0], 0.85);
  for (let i = 1; i < L.jpegQualities.length; i++) assert.ok(L.jpegQualities[i] < L.jpegQualities[i - 1]);
  // a picture at the target size still fits the request as base64
  assert.ok(base64Size(L.imageTargetBytes) < L.maxRequestBytes);
});

test("accept lists images, PDF, HTML, e-mails and text — not HEIC (iOS converts it)", () => {
  const parts = DESIGNER_ATTACHMENT_ACCEPT.split(",");
  for (const p of ["image/png", "image/jpeg", "image/webp", "image/gif", "application/pdf", ".pdf", ".html", ".htm", ".eml", ".txt", ".md"]) {
    assert.ok(parts.includes(p), p);
  }
  assert.ok(!parts.some((p) => /heic/i.test(p)));
});

test("type: document extensions decide, then the browser type, then picture extensions", () => {
  const ok = (type, name) => {
    const r = designerAttachmentType(type, name);
    assert.ok(r.ok, `${type} ${name}`);
    return r.ok ? [r.kind, r.mediaType] : null;
  };
  assert.deepEqual(ok("image/png", "a.png"), ["image", "image/png"]);
  assert.deepEqual(ok("image/jpg", "a"), ["image", "image/jpeg"]);
  assert.deepEqual(ok("IMAGE/JPEG; q=1", "a.jpeg"), ["image", "image/jpeg"]);
  assert.deepEqual(ok("image/webp", "a.webp"), ["image", "image/webp"]);
  assert.deepEqual(ok("image/gif", "a.gif"), ["image", "image/gif"]);
  assert.deepEqual(ok("", "Foto.JPG"), ["image", "image/jpeg"]);
  assert.deepEqual(ok("", "IMG_1.heic"), ["image", "image/heic"]);
  assert.deepEqual(ok("image/heif", "x"), ["image", "image/heic"]);
  assert.deepEqual(ok("application/pdf", "Katalog.pdf"), ["pdf", "application/pdf"]);
  assert.deepEqual(ok("", "Katalog.PDF"), ["pdf", "application/pdf"]);
  assert.deepEqual(ok("text/html", "mail.html"), ["text", "text/html"]);
  assert.deepEqual(ok("", "mail.htm"), ["text", "text/html"]);
  // operating systems report .eml / .md unreliably — the extension wins
  assert.deepEqual(ok("", "Newsletter.eml"), ["text", "message/rfc822"]);
  assert.deepEqual(ok("application/octet-stream", "Newsletter.eml"), ["text", "message/rfc822"]);
  assert.deepEqual(ok("text/plain", "Newsletter.eml"), ["text", "message/rfc822"]);
  assert.deepEqual(ok("message/rfc822", "x"), ["text", "message/rfc822"]);
  assert.deepEqual(ok("", "Briefing.md"), ["text", "text/plain"]);
  assert.deepEqual(ok("text/markdown", "Briefing.md"), ["text", "text/plain"]);
  assert.deepEqual(ok("", "notizen.txt"), ["text", "text/plain"]);
  assert.deepEqual(ok("text/plain", "x"), ["text", "text/plain"]);
});

test("type: refused formats get a German reason naming the file", () => {
  const msg = (type, name) => {
    const r = designerAttachmentType(type, name);
    assert.equal(r.ok, false, `${type} ${name}`);
    return r.ok ? "" : r.message;
  };
  assert.match(msg("image/svg+xml", "logo.svg"), /„logo\.svg“: SVG-Grafiken bitte vorher als PNG/);
  assert.match(msg("application/vnd.openxmlformats-officedocument.wordprocessingml.document", "Brief.docx"), /als PDF speichern/);
  assert.match(msg("", "Präsentation.key"), /als PDF speichern/);
  assert.match(msg("application/zip", "bilder.zip"), /„bilder\.zip“: Dieses Format kann die KI nicht lesen — bitte Bilder \(PNG, JPG, WebP, GIF\), PDF/);
  assert.match(msg("", ""), /^Die Datei: Dieses Format/);
  // a very long name is shortened
  assert.match(msg("", `${"x".repeat(80)}.zip`), /…“/);
});

test("size: empty, PDF over 3 MB, text over 400 KB (with the right advice), huge pictures", () => {
  assert.equal(attachmentSizeProblem("image", "image/png", 1000, "a.png"), null);
  assert.equal(attachmentSizeProblem("pdf", "application/pdf", L.maxPdfBytes, "a.pdf"), null);
  assert.equal(attachmentSizeProblem("text", "text/plain", L.maxTextBytes, "a.txt"), null);
  assert.match(attachmentSizeProblem("image", "image/png", 0, "a.png") ?? "", /„a\.png“ ist leer/);
  assert.match(attachmentSizeProblem("pdf", "application/pdf", L.maxPdfBytes + 1, "a.pdf") ?? "", /größer als 3 MB — bitte nur die wichtigen Seiten/);
  assert.match(attachmentSizeProblem("text", "message/rfc822", L.maxTextBytes + 1, "a.eml") ?? "", /größer als 400 KB \(vermutlich mit eingebetteten Bildern\) — bitte stattdessen einen Screenshot der Mail/);
  assert.match(attachmentSizeProblem("text", "text/html", L.maxTextBytes + 1, "a.html") ?? "", /Screenshot anhängen/);
  assert.match(attachmentSizeProblem("text", "text/plain", L.maxTextBytes + 1, "a.md") ?? "", /nur den nötigen Text/);
  assert.match(attachmentSizeProblem("image", "image/jpeg", L.maxSourceImageBytes + 1, "a.jpg") ?? "", /zu groß \(über 40 MB\)/);
  // a big picture is fine — it gets shrunk
  assert.equal(attachmentSizeProblem("image", "image/jpeg", 12_000_000, "a.jpg"), null);
});

test("unreadable picture: HEIC gets the export hint", () => {
  assert.match(unreadableImageMessage("IMG.heic", "image/heic"), /HEIC.*als JPG exportieren/);
  assert.match(unreadableImageMessage("a.png", "image/png"), /„a\.png“ konnte nicht gelesen werden/);
});

test("sniff: the bytes decide what a picture is", () => {
  assert.equal(sniffImageType(png(6)), "image/png");
  assert.equal(sniffImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0])), "image/jpeg");
  assert.equal(sniffImageType(ascii("GIF89a......")), "image/gif");
  assert.equal(sniffImageType(ascii("GIF87a")), "image/gif");
  assert.equal(sniffImageType(ascii("RIFF\u0000\u0000\u0000\u0000WEBPVP8 ")), "image/webp");
  assert.equal(sniffImageType(ascii("RIFF\u0000\u0000\u0000\u0000WAVE")), null);
  assert.equal(sniffImageType(ascii("<svg")), null);
  assert.equal(sniffImageType(new Uint8Array(0)), null);
  // @ts-expect-error not bytes
  assert.equal(sniffImageType(null), null);
});

test("png transparency: alpha colour types, a tRNS chunk, none, not a PNG", () => {
  assert.equal(pngTransparency(png(6)), "alpha"); // RGBA
  assert.equal(pngTransparency(png(4)), "alpha"); // grey + alpha
  assert.equal(pngTransparency(png(2)), "none"); // RGB
  assert.equal(pngTransparency(png(3, [["PLTE", new Uint8Array(6)], ["tRNS", new Uint8Array(2)]])), "trns");
  assert.equal(pngTransparency(png(2, [["tEXt", ascii("Comment\u0000hi")], ["tRNS", new Uint8Array(6)]])), "trns");
  // a tRNS AFTER the image data does not count (it would be invalid anyway)
  assert.equal(pngTransparency(png(2, [], [["tRNS", new Uint8Array(6)]])), "none");
  assert.equal(pngTransparency(new Uint8Array([0xff, 0xd8, 0xff])), null);
  assert.equal(pngTransparency(png(6).subarray(0, 20)), null);
});

test("transparent pixels: any alpha below the threshold", () => {
  assert.equal(hasTransparentPixel(new Uint8ClampedArray([1, 2, 3, 255, 4, 5, 6, 255])), false);
  assert.equal(hasTransparentPixel(new Uint8ClampedArray([1, 2, 3, 255, 4, 5, 6, 0])), true);
  assert.equal(hasTransparentPixel(new Uint8ClampedArray([1, 2, 3, 251])), false);
  assert.equal(hasTransparentPixel(new Uint8ClampedArray([1, 2, 3, 249])), true);
  assert.equal(hasTransparentPixel(new Uint8ClampedArray([1, 2, 3, 200]), 180), false);
  assert.equal(hasTransparentPixel([]), false);
});

test("fit: at most 1400 px wide, tall screenshots stay tall up to 12 000 px, never enlarged", () => {
  assert.deepEqual(fitImageSize(1200, 800), { width: 1200, height: 800, scaled: false });
  assert.deepEqual(fitImageSize(2800, 1000), { width: 1400, height: 500, scaled: true });
  // a full-page screenshot: width halved, height kept proportional
  assert.deepEqual(fitImageSize(2880, 16000), { width: 1400, height: 7778, scaled: true });
  // an extremely tall one is capped at 12 000 px height (narrower than 1400)
  assert.deepEqual(fitImageSize(1400, 30000), { width: 560, height: 12000, scaled: true });
  assert.deepEqual(fitImageSize(1, 1), { width: 1, height: 1, scaled: false });
  assert.deepEqual(fitImageSize(100, 100, 50, 50), { width: 50, height: 50, scaled: true });
});

test("plan: GIF and transparent PNG up to 1.5 MB as they are, everything else JPEG at the fitted size", () => {
  const base = { bytes: 1_000_000, width: 2000, height: 1000, name: "a" };
  assert.deepEqual(planImageAttachment({ ...base, type: "image/gif" }), { ok: true, reencode: false, width: 2000, height: 1000, mediaType: "image/gif" });
  assert.deepEqual(planImageAttachment({ ...base, type: "image/png", transparent: true }), {
    ok: true,
    reencode: false,
    width: 2000,
    height: 1000,
    mediaType: "image/png",
  });
  const jpeg = { ok: true, reencode: true, width: 1400, height: 700, mediaType: "image/jpeg" };
  assert.deepEqual(planImageAttachment({ ...base, type: "image/png", transparent: false }), jpeg);
  assert.deepEqual(planImageAttachment({ ...base, type: "image/png", transparent: true, bytes: L.keepImageBytes + 1 }), jpeg);
  assert.deepEqual(planImageAttachment({ ...base, type: "image/gif", bytes: L.keepImageBytes + 1 }), jpeg);
  assert.deepEqual(planImageAttachment({ ...base, type: "image/webp" }), jpeg);
  assert.deepEqual(planImageAttachment({ ...base, type: "image/jpeg" }), jpeg);
  // decoded by the browser only (HEIC, AVIF): re-encoded
  assert.deepEqual(planImageAttachment({ ...base, type: null }), jpeg);
  // a small JPEG is re-encoded at its own size (orientation applied)
  assert.deepEqual(planImageAttachment({ ...base, type: "image/jpeg", width: 600, height: 400 }), {
    ok: true,
    reencode: true,
    width: 600,
    height: 400,
    mediaType: "image/jpeg",
  });
});

test("plan: unreadable sizes and too many pixels are refused", () => {
  const r1 = planImageAttachment({ type: "image/png", bytes: 10, width: 0, height: 10, name: "a.png" });
  assert.equal(r1.ok, false);
  const r2 = planImageAttachment({ type: "image/png", bytes: 10, width: 20_000, height: 20_000, name: "riesig.png" });
  assert.equal(r2.ok, false);
  assert.match(r2.ok ? "" : r2.message, /„riesig\.png“ ist zu groß \(über 100 Megapixel\)/);
});

test("text files: UTF-8, else Windows-1252; NUL bytes are not text; empty is refused", () => {
  const utf8 = new TextEncoder().encode("Grüße — „Black Week“ ✓");
  assert.deepEqual(readTextAttachment(utf8, "a.txt"), { ok: true, text: "Grüße — „Black Week“ ✓" });
  // "Grüße" in Windows-1252
  const cp1252 = new Uint8Array([0x47, 0x72, 0xfc, 0xdf, 0x65, 0x20, 0x84, 0x96, 0x93]);
  assert.deepEqual(readTextAttachment(cp1252, "a.txt"), { ok: true, text: "Grüße „–“" });
  // a BOM is dropped
  assert.deepEqual(readTextAttachment(new Uint8Array([0xef, 0xbb, 0xbf, 0x48, 0x69]), "a.txt"), { ok: true, text: "Hi" });
  const bin = readTextAttachment(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]), "x.txt");
  assert.equal(bin.ok, false);
  assert.match(bin.ok ? "" : bin.message, /keine Textdatei/);
  const empty = readTextAttachment(new TextEncoder().encode(" \n "), "x.md");
  assert.equal(empty.ok, false);
});

test("base64 size", () => {
  assert.equal(base64Size(0), 0);
  assert.equal(base64Size(1), 4);
  assert.equal(base64Size(3), 4);
  assert.equal(base64Size(4), 8);
  assert.equal(base64Size(3_000_000), 4_000_000);
  assert.equal(base64Size(-5), 0);
});

test("request budget: null when it fits, else names the largest attachments (with their file size) until the rest fits", () => {
  const attachments = [
    { name: "klein.png", size: 400_000, fileSize: 300_000 },
    { name: "screenshot.png", size: 2_800_000, fileSize: 2_100_000 },
    { name: "katalog.pdf", size: 1_900_000 },
  ];
  assert.equal(requestBudgetMessage({ requestBytes: 4_200_000, attachments }), null);
  const one = requestBudgetMessage({ requestBytes: 5_100_000, attachments });
  assert.equal(one, "Die Anhänge sind zusammen zu groß für eine Anfrage. Bitte diesen Anhang entfernen: „screenshot.png“ (2,1 MB).");
  const two = requestBudgetMessage({ requestBytes: 8_000_000, attachments });
  // without a file size the request size is named
  assert.match(two ?? "", /Bitte diese Anhänge entfernen: „screenshot\.png“ \(2,1 MB\), „katalog\.pdf“ \(1,9 MB\)\.$/);
  // nothing to remove that would help: the document itself is too big
  const doc = requestBudgetMessage({ requestBytes: 5_000_000, attachments: [] });
  assert.equal(doc, "Die Mail ist für die KI zu umfangreich (5 MB, höchstens 4,2 MB) — bitte „Neues Gespräch“ beginnen oder Bausteine entfernen.");
  assert.match(requestBudgetMessage({ requestBytes: 10, attachments: [], limit: 5 }) ?? "", /zu umfangreich/);
});

test("the attachment budget shown to the operator fits the request limit as base64", () => {
  assert.equal(DESIGNER_ATTACHMENT_BUDGET_BYTES, 3_075_000);
  assert.ok(base64Size(DESIGNER_ATTACHMENT_BUDGET_BYTES) + 100_000 <= L.maxRequestBytes);
  assert.equal(formatFileSize(DESIGNER_ATTACHMENT_BUDGET_BYTES), "3,1 MB");
});

test("file sizes in German decimal units", () => {
  assert.equal(formatFileSize(0), "0 B");
  assert.equal(formatFileSize(850), "850 B");
  assert.equal(formatFileSize(1000), "1 KB");
  assert.equal(formatFileSize(400_000), "400 KB");
  assert.equal(formatFileSize(999_400), "999 KB");
  assert.equal(formatFileSize(999_600), "1 MB");
  assert.equal(formatFileSize(1_240_000), "1,2 MB");
  assert.equal(formatFileSize(4_200_000), "4,2 MB");
  assert.equal(formatFileSize(12_345_678), "12,3 MB");
  assert.equal(formatFileSize(-1), "—");
  assert.equal(formatFileSize("x"), "—");
});

test("pasted pictures get a readable name; kind labels", () => {
  assert.equal(pastedImageName(1, "image/png"), "Eingefügtes Bild 1.png");
  assert.equal(pastedImageName(2, "image/jpeg"), "Eingefügtes Bild 2.jpg");
  assert.equal(pastedImageName(3, "image/gif"), "Eingefügtes Bild 3.gif");
  assert.equal(pastedImageName(4, "image/webp"), "Eingefügtes Bild 4.webp");
  assert.equal(attachmentKindLabel("image/jpeg"), "Bild");
  assert.equal(attachmentKindLabel("application/pdf"), "PDF");
  assert.equal(attachmentKindLabel("text/html"), "HTML");
  assert.equal(attachmentKindLabel("message/rfc822"), "E-Mail");
  assert.equal(attachmentKindLabel("text/plain"), "Text");
});
