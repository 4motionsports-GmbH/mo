// The Geschenkgutschein renderer: designs (gift-voucher-designs.mjs, pure SVG)
// → raster (sharp) → JPEG / PDF. docs/GIFT_VOUCHERS.md.
//
// - renderGiftVoucherPdf: the download PDF — ONE A4 page, the landscape front
//   on top, the inside below, a dashed cut/fold line between; one JPEG
//   (~220 dpi, q 88, baseline) plus an invisible text layer with the code and
//   the voucher number so they can be copied (pdf-core assembleImagePdf).
// - renderGiftVoucherPreview: JPEG previews for the storefront and the admin
//   ("MUSTER" watermark when `sample`).
// - renderGiftVoucherPrintSpreads: the two print.one SQ14 spreads
//   (3378 × 1724 px, 300 dpi, sRGB, 3 mm bleed).
//
// Fonts (Montserrat, Caveat — OFL, src/assets/fonts, traced into the routes by
// next.config outputFileTracingIncludes) are read from disk and parsed once
// per instance. The QR code points to GIFT_VOUCHER_PAGE_URL#guthaben (never to
// the code). Renders run at most two at a time per instance.
//
// Nothing here throws: a failed PDF falls back to a plain text PDF that still
// carries the code (reported); a failed preview or print file is an EMPTY
// Buffer (reported) — callers check `.length` before using it. Codes, names
// and messages never reach reportError.

import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { create as createQr } from "qrcode";
import { parse as parseFont } from "opentype.js";
import {
  GIFT_VOUCHER_DESIGNS,
  GIFT_VOUCHER_PRINT_SPREAD,
  buildGiftVoucherPdfPageSvg,
  buildGiftVoucherSpreadSvg,
  giftVoucherDesign,
  giftVoucherTextAnchors,
  layoutGiftVoucherPanel,
} from "./gift-voucher-designs.mjs";
import type {
  GiftVoucherDesign,
  GiftVoucherFonts,
  GiftVoucherPanelData,
  GiftVoucherPanelKind,
  GiftVoucherPanelLayout,
  GiftVoucherQrMatrix,
} from "./gift-voucher-designs.mjs";
import { formatEuro, formatGiftVoucherCode } from "./gift-voucher-core.mjs";
import { giftVoucherIssuerLine, giftVoucherPageUrl, giftVoucherTermsUrl, printOneFrontSide } from "./gift-voucher-flags.mjs";
import { getGiftVoucherBlob } from "./gift-voucher-blob";
import type { GiftVoucher } from "./gift-voucher-store";
import { reportError } from "./observability";
import { MARGIN_X, PAGE_H, PAGE_W, assembleImagePdf, assemblePdf, brandHeaderOps, footerOp, textOp, wrapText } from "./pdf-core.mjs";

export interface GiftVoucherRenderInput {
  designKey: string;
  amountCents: number;
  recipientName: string | null;
  senderName: string | null;
  message: string | null;
  photo: Buffer | null;
  code: string | null;
  number: string | null;
  expiresOn: string | null;
  sample: boolean;
  locale: "de" | "en";
}

const ROUTE = "lib/gift-voucher-render";

/** The download PDF is rasterised at this resolution (A4 → 1819 × 2572 px). */
export const GIFT_VOUCHER_PDF_DPI = 220;
const A4_W_PX = Math.round((210 / 25.4) * GIFT_VOUCHER_PDF_DPI);
const A4_HALF_PX = Math.round(((297 / 25.4) * GIFT_VOUCHER_PDF_DPI) / 2);
const A4_H_PX = A4_HALF_PX * 2;

const PREVIEW_DEFAULT_WIDTH = { landscape: 1000, square: 800 } as const;
const MAX_CONCURRENT_RENDERS = 2;

// ---------------------------------------------------------------------------
// Fonts (parsed once per instance)
// ---------------------------------------------------------------------------

export const GIFT_VOUCHER_FONT_DIR = path.join(process.cwd(), "src", "assets", "fonts");
const FONT_FILES: Record<keyof GiftVoucherFonts, string> = {
  regular: "montserrat-400.ttf",
  semibold: "montserrat-600.ttf",
  bold: "montserrat-700.ttf",
  extrabold: "montserrat-800.ttf",
  script: "caveat-500.ttf",
  scriptBold: "caveat-700.ttf",
};

const cache = globalThis as typeof globalThis & { __moGiftVoucherFonts?: Promise<GiftVoucherFonts> };

/** The six fonts of the artwork, parsed once per instance (a failed load is retried next time). Throws. */
export function loadGiftVoucherFonts(): Promise<GiftVoucherFonts> {
  if (!cache.__moGiftVoucherFonts) {
    const pending = (async () => {
      const entries = await Promise.all(
        (Object.keys(FONT_FILES) as Array<keyof GiftVoucherFonts>).map(async (key) => {
          const buf = await readFile(path.join(GIFT_VOUCHER_FONT_DIR, FONT_FILES[key]));
          const font = parseFont(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
          return [key, font] as const;
        })
      );
      return Object.fromEntries(entries) as unknown as GiftVoucherFonts;
    })();
    cache.__moGiftVoucherFonts = pending;
    pending.catch(() => {
      if (cache.__moGiftVoucherFonts === pending) cache.__moGiftVoucherFonts = undefined;
    });
  }
  return cache.__moGiftVoucherFonts;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let activeRenders = 0;
const waiting: Array<() => void> = [];

/** At most MAX_CONCURRENT_RENDERS rasterisations at a time per instance (memory, CPU). */
async function withRenderSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (activeRenders >= MAX_CONCURRENT_RENDERS) await new Promise<void>((resolve) => waiting.push(resolve));
  activeRenders++;
  try {
    return await fn();
  } finally {
    activeRenders--;
    waiting.shift()?.();
  }
}

function designOf(key: string): Readonly<GiftVoucherDesign> {
  return giftVoucherDesign(key) ?? GIFT_VOUCHER_DESIGNS[0];
}

/** The QR target: the voucher page's balance check. */
function balanceUrl(): string {
  return `${giftVoucherPageUrl().split("#")[0]}#guthaben`;
}

function qrMatrix(): GiftVoucherQrMatrix | null {
  try {
    const qr = createQr(balanceUrl(), { errorCorrectionLevel: "M" });
    return { size: qr.modules.size, data: qr.modules.data };
  } catch (err) {
    reportError(err, { route: ROUTE, phase: "qr" });
    return null;
  }
}

function panelData(input: GiftVoucherRenderInput): GiftVoucherPanelData {
  return {
    locale: input.locale === "en" ? "en" : "de",
    amountCents: input.amountCents,
    recipientName: input.recipientName,
    senderName: input.senderName,
    message: input.message,
    code: input.sample ? null : input.code,
    number: input.number,
    expiresOn: input.expiresOn,
    sample: input.sample === true,
    issuerLine: giftVoucherIssuerLine(),
    termsUrl: giftVoucherTermsUrl(),
  };
}

/** The customer's photo, cover-cropped to the panel's pixels, as a JPEG data URI (null → design falls back). */
async function photoDataUri(input: GiftVoucherRenderInput, width: number, height: number): Promise<string | null> {
  if (!designOf(input.designKey).photo || !input.photo || input.photo.length === 0) return null;
  try {
    const jpeg = await sharp(input.photo, { limitInputPixels: 40_000_000 })
      .rotate()
      .resize(width, height, { fit: "cover", position: "centre" })
      .flatten({ background: "#ffffff" })
      .toColourspace("srgb")
      .jpeg({ quality: 90, mozjpeg: true })
      .toBuffer();
    return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
  } catch (err) {
    reportError(err, { route: ROUTE, phase: "photo" });
    return null;
  }
}

interface RasterOptions {
  width: number;
  height: number;
  background: string;
  quality: number;
  /** Baseline JPEG (for PDF embedding) instead of mozjpeg's progressive scans. */
  baseline?: boolean;
  /** Pixel density metadata (dpi) + an sRGB profile (print files). */
  density?: number;
}

/** SVG → JPEG of exactly width × height px, flattened onto the background, sRGB. */
async function rasterize(svg: string, o: RasterOptions): Promise<Buffer> {
  let img = sharp(Buffer.from(svg, "utf8"), { density: 72, limitInputPixels: 80_000_000 })
    .resize(o.width, o.height, { fit: "fill", kernel: "lanczos3" })
    .flatten({ background: o.background })
    .toColourspace("srgb")
    .jpeg(
      o.baseline
        ? {
            quality: o.quality,
            chromaSubsampling: "4:4:4",
            trellisQuantisation: true,
            overshootDeringing: true,
            quantisationTable: 3,
            progressive: false,
          }
        : { quality: o.quality, chromaSubsampling: "4:4:4", mozjpeg: true }
    );
  if (o.density) img = img.withMetadata({ density: o.density });
  return img.toBuffer();
}

function layoutPanel(
  input: GiftVoucherRenderInput,
  fonts: GiftVoucherFonts,
  o: { panel: GiftVoucherPanelKind; layout: "landscape" | "square"; widthPx: number; heightPx: number; bleedPx?: number },
  photo: string | null,
  qr: GiftVoucherQrMatrix | null
): GiftVoucherPanelLayout {
  return layoutGiftVoucherPanel({
    ...o,
    design: designOf(input.designKey),
    data: panelData(input),
    fonts,
    photoDataUri: o.panel === "front" ? photo : null,
    qrMatrix: qr,
  });
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

/** A plain text voucher (base-14 fonts) — the fallback when the artwork cannot be rendered. */
function fallbackPdf(input: GiftVoucherRenderInput): Buffer {
  const en = input.locale === "en";
  const expiry = input.expiresOn && /^\d{4}-\d{2}-\d{2}$/.test(input.expiresOn) ? input.expiresOn.split("-").reverse().join(".") : null;
  let y = PAGE_H - 150;
  const ops = [brandHeaderOps(), textOp("F2", MARGIN_X, y, 24, en ? "Gift voucher" : "Geschenkgutschein")];
  const line = (font: "F1" | "F2", size: number, text: string, gap: number) => {
    y -= gap;
    ops.push(textOp(font, MARGIN_X, y, size, text));
  };
  line("F2", 18, `${en ? "Value" : "Wert"}: ${formatEuro(input.amountCents, input.locale)}`, 40);
  if (input.recipientName) line("F1", 12, `${en ? "For" : "Für"}: ${input.recipientName}`, 24);
  const code = input.sample || !input.code ? "XXXX XXXX XXXX XXXX" : formatGiftVoucherCode(input.code);
  line("F1", 11, en ? "Your voucher code" : "Dein Gutscheincode", 34);
  line("F2", 20, code, 26);
  line("F1", 11, expiry ? `${en ? "Valid until" : "Gültig bis"} ${expiry}` : en ? "No expiry date" : "Unbegrenzt gültig", 30);
  const number = input.sample ? (en ? "SAMPLE" : "MUSTER") : (input.number ?? "-");
  line("F1", 11, `${en ? "Voucher no." : "Gutschein-Nr."} ${number}`, 18);
  y -= 16;
  const how = en
    ? "How to redeem: enter the code at checkout on motionsports.de. Any remaining balance stays on the card. No cash payout."
    : "So löst du ihn ein: Code im Checkout auf motionsports.de eingeben. Restguthaben bleibt erhalten. Keine Barauszahlung.";
  for (const l of wrapText(how, 88)) line("F1", 10, l, 15);
  y -= 12;
  line("F1", 9, giftVoucherIssuerLine(), 15);
  line("F1", 9, `${en ? "Terms" : "Bedingungen"}: ${giftVoucherTermsUrl().replace(/^https?:\/\//, "")}`, 13);
  ops.push(footerOp());
  return assemblePdf([ops.join("")]);
}

/**
 * The download PDF: one A4 page (front on top, inside below), the code and
 * the number copyable. Never throws — a failed render falls back to a plain
 * text PDF with the same facts (reported).
 */
export async function renderGiftVoucherPdf(input: GiftVoucherRenderInput): Promise<Buffer> {
  try {
    return await withRenderSlot(async () => {
      const fonts = await loadGiftVoucherFonts();
      const qr = qrMatrix();
      const photo = await photoDataUri(input, A4_W_PX, A4_HALF_PX);
      const dims = { layout: "landscape" as const, widthPx: A4_W_PX, heightPx: A4_HALF_PX };
      const front = layoutPanel(input, fonts, { ...dims, panel: "front" }, photo, qr);
      const inside = layoutPanel(input, fonts, { ...dims, panel: "inside" }, null, qr);
      const svg = buildGiftVoucherPdfPageSvg({ front, inside, widthPx: A4_W_PX, heightPx: A4_H_PX, fonts, locale: input.locale });
      const jpeg = await rasterize(svg, { width: A4_W_PX, height: A4_H_PX, background: "#ffffff", quality: 88, baseline: true });

      // Invisible text over the printed code and number (px → pt; the inside
      // panel starts half way down the page).
      const kx = PAGE_W / A4_W_PX;
      const ky = PAGE_H / A4_H_PX;
      const anchors = giftVoucherTextAnchors(inside);
      const texts: Array<{ text: string; x: number; y: number; size: number; width?: number }> = [];
      const place = (text: string, box: { x1: number; y1: number; x2: number; y2: number } | null) => {
        if (!box) return;
        const capPt = (box.y2 - box.y1) * ky;
        texts.push({
          text,
          x: box.x1 * kx,
          y: PAGE_H - (A4_HALF_PX + box.y2) * ky,
          size: Math.max(4, capPt / 0.72),
          width: (box.x2 - box.x1) * kx,
        });
      };
      if (!input.sample && input.code) place(formatGiftVoucherCode(input.code), anchors.code);
      const numberLabel = input.locale === "en" ? "Voucher no." : "Gutschein-Nr.";
      if (!input.sample && input.number) place(`${numberLabel} ${input.number}`, anchors.number);

      const title = `${input.locale === "en" ? "Gift voucher" : "Geschenkgutschein"} ${input.sample ? (input.locale === "en" ? "SAMPLE" : "MUSTER") : (input.number ?? "")}`.trim();
      return assembleImagePdf([{ width: PAGE_W, height: PAGE_H, images: [{ data: jpeg, x: 0, y: 0, width: PAGE_W, height: PAGE_H }], texts }], {
        title,
        author: "motion sports",
        lang: input.locale === "en" ? "en" : "de-DE",
      });
    });
  } catch (err) {
    reportError(err, { route: ROUTE, phase: "pdf" });
    return fallbackPdf(input);
  }
}

// ---------------------------------------------------------------------------
// Previews and print files
// ---------------------------------------------------------------------------

/**
 * Preview images (JPEG, q 84). `landscape`: front and inside, `width` ×
 * width·148/210 (default 1000 px wide). `square` (the Premium-Karte): the
 * front `width` × `width` and the opened card (message | code) 2·width ×
 * width (default width 800). A diagonal „MUSTER“ when `sample`. Never throws:
 * empty Buffers when rendering failed (reported).
 */
export async function renderGiftVoucherPreview(
  input: GiftVoucherRenderInput,
  opts: { layout: "landscape" | "square"; width?: number }
): Promise<{ front: Buffer; inside: Buffer }> {
  const layout = opts.layout === "square" ? "square" : "landscape";
  const width =
    typeof opts.width === "number" && Number.isFinite(opts.width) && opts.width >= 200 && opts.width <= 2400
      ? Math.round(opts.width)
      : PREVIEW_DEFAULT_WIDTH[layout];
  try {
    return await withRenderSlot(async () => {
      const fonts = await loadGiftVoucherFonts();
      const qr = qrMatrix();
      if (layout === "square") {
        const photo = await photoDataUri(input, width, width);
        const front = layoutPanel(input, fonts, { panel: "front", layout, widthPx: width, heightPx: width }, photo, qr);
        const half = { layout, widthPx: width, heightPx: width } as const;
        const insideSvg = buildGiftVoucherSpreadSvg({
          left: layoutPanel(input, fonts, { ...half, panel: "inside-message" }, null, qr),
          right: layoutPanel(input, fonts, { ...half, panel: "inside-info" }, null, qr),
          widthPx: width * 2,
          heightPx: width,
          bleedPx: 0,
        });
        const [frontJpeg, insideJpeg] = await Promise.all([
          rasterize(front.svg, { width, height: width, background: "#ffffff", quality: 84 }),
          rasterize(insideSvg, { width: width * 2, height: width, background: "#ffffff", quality: 84 }),
        ]);
        return { front: frontJpeg, inside: insideJpeg };
      }
      const height = Math.round((width * 148) / 210);
      const photo = await photoDataUri(input, width, height);
      const dims = { layout, widthPx: width, heightPx: height } as const;
      const front = layoutPanel(input, fonts, { ...dims, panel: "front" }, photo, qr);
      const inside = layoutPanel(input, fonts, { ...dims, panel: "inside" }, null, qr);
      const [frontJpeg, insideJpeg] = await Promise.all([
        rasterize(front.svg, { width, height, background: "#ffffff", quality: 84 }),
        rasterize(inside.svg, { width, height, background: "#ffffff", quality: 84 }),
      ]);
      return { front: frontJpeg, inside: insideJpeg };
    });
  } catch (err) {
    reportError(err, { route: ROUTE, phase: "preview" });
    return { front: Buffer.alloc(0), inside: Buffer.alloc(0) };
  }
}

/**
 * The two print.one SQ14 spreads: JPEG 3378 × 1724 px, 300 dpi, sRGB, 3 mm
 * bleed. `outside` = [back | front] (PRINTONE_FRONT_SIDE=right, else
 * mirrored), `inside` = [message | code]. Never throws: empty Buffers when
 * rendering failed (reported) — never upload those.
 */
export async function renderGiftVoucherPrintSpreads(input: GiftVoucherRenderInput): Promise<{ outside: Buffer; inside: Buffer }> {
  const G = GIFT_VOUCHER_PRINT_SPREAD;
  try {
    return await withRenderSlot(async () => {
      const fonts = await loadGiftVoucherFonts();
      const qr = qrMatrix();
      const photo = await photoDataUri(input, G.panelPx, G.panelPx);
      const dims = { layout: "square" as const, widthPx: G.panelPx, heightPx: G.heightPx, bleedPx: G.bleedPx };
      const front = layoutPanel(input, fonts, { ...dims, panel: "front" }, photo, qr);
      const back = layoutPanel(input, fonts, { ...dims, panel: "back" }, null, qr);
      const frontRight = printOneFrontSide() === "right";
      const outsideSvg = buildGiftVoucherSpreadSvg({
        left: frontRight ? back : front,
        right: frontRight ? front : back,
        widthPx: G.widthPx,
        heightPx: G.heightPx,
        bleedPx: G.bleedPx,
      });
      const insideSvg = buildGiftVoucherSpreadSvg({
        left: layoutPanel(input, fonts, { ...dims, panel: "inside-message" }, null, qr),
        right: layoutPanel(input, fonts, { ...dims, panel: "inside-info" }, null, qr),
        widthPx: G.widthPx,
        heightPx: G.heightPx,
        bleedPx: G.bleedPx,
      });
      const raster = { width: G.widthPx, height: G.heightPx, background: "#ffffff", quality: 92, density: G.dpi };
      const [outside, inside] = await Promise.all([rasterize(outsideSvg, raster), rasterize(insideSvg, raster)]);
      return { outside, inside };
    });
  } catch (err) {
    reportError(err, { route: ROUTE, phase: "print" });
    return { outside: Buffer.alloc(0), inside: Buffer.alloc(0) };
  }
}

/** The customer's photo from the private Blob store, or null. Never throws. */
export async function loadGiftVoucherPhoto(pathname: string | null): Promise<Buffer | null> {
  if (!pathname) return null;
  try {
    const file = await getGiftVoucherBlob(pathname);
    return file?.bytes ?? null;
  } catch (err) {
    reportError(err, { route: ROUTE, phase: "photo_load" });
    return null;
  }
}

/** A stored voucher → the renderer's input (the code and the photo are loaded by the caller). */
export function giftVoucherRenderInputFromVoucher(v: GiftVoucher, code: string | null, photo: Buffer | null): GiftVoucherRenderInput {
  return {
    designKey: v.designKey,
    amountCents: v.amountCents,
    recipientName: v.recipientName,
    senderName: v.senderName,
    message: v.message,
    photo,
    code,
    number: v.number,
    expiresOn: v.expiresOn,
    sample: false,
    locale: v.locale,
  };
}
