// STUB — replaced by P1 Renderer (spec §7, gift-voucher-render.ts).
//
// The exact exports of the voucher renderer, so the issuing, storefront,
// print and admin code compiles while the renderer is being built. The
// placeholders never throw: a one-page text PDF (number and value, never the
// code) and plain single-colour JPEGs in the right sizes. loadGiftVoucherPhoto
// and giftVoucherRenderInputFromVoucher are already the real thing.

import sharp from "sharp";
import { GIFT_VOUCHER_DESIGNS, giftVoucherDesign } from "./gift-voucher-designs.mjs";
import { formatEuro } from "./gift-voucher-core.mjs";
import { getGiftVoucherBlob } from "./gift-voucher-blob";
import type { GiftVoucher } from "./gift-voucher-store";
import { reportError } from "./observability";
import { MARGIN_X, PAGE_H, assemblePdf, textOp } from "./pdf-core.mjs";

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
const SPREAD_W = 3378;
const SPREAD_H = 1724;

function colors(designKey: string) {
  return (giftVoucherDesign(designKey) ?? GIFT_VOUCHER_DESIGNS[0]).colors;
}

/** A plain JPEG of one colour (placeholder), or an empty buffer when sharp fails. */
async function solidJpeg(width: number, height: number, hex: string, density?: number): Promise<Buffer> {
  try {
    const img = sharp({ create: { width, height, channels: 3, background: hex } }).jpeg({ quality: 80 });
    return await (density ? img.withMetadata({ density }) : img).toBuffer();
  } catch (err) {
    reportError(err, { route: ROUTE, phase: "placeholder" });
    return Buffer.alloc(0);
  }
}

/** The download PDF — STUB: one A4 page with the voucher number and value, no code. */
export async function renderGiftVoucherPdf(input: GiftVoucherRenderInput): Promise<Buffer> {
  const en = input.locale === "en";
  const lines = [
    textOp("F2", MARGIN_X, PAGE_H - 120, 22, en ? "Gift voucher" : "Geschenkgutschein"),
    textOp("F1", MARGIN_X, PAGE_H - 150, 14, `${en ? "Value" : "Wert"} ${formatEuro(input.amountCents, input.locale)}`),
    textOp("F1", MARGIN_X, PAGE_H - 172, 11, `${en ? "Voucher no." : "Gutschein-Nr."} ${input.sample ? "MUSTER" : (input.number ?? "-")}`),
    textOp("F1", MARGIN_X, PAGE_H - 200, 9, en ? "Preview - the designed voucher follows." : "Vorschau - der gestaltete Gutschein folgt."),
  ];
  return assemblePdf([lines.join("")]);
}

/** Preview images (JPEG) — STUB: the design's colours in the layout's proportions. */
export async function renderGiftVoucherPreview(
  input: GiftVoucherRenderInput,
  opts: { layout: "landscape" | "square"; width?: number }
): Promise<{ front: Buffer; inside: Buffer }> {
  const width = typeof opts.width === "number" && opts.width >= 200 && opts.width <= 2400 ? Math.round(opts.width) : 1000;
  const height = opts.layout === "square" ? width : Math.round((width * 148) / 210);
  const c = colors(input.designKey);
  const [front, inside] = await Promise.all([
    solidJpeg(width, height, c.background),
    solidJpeg(width, height, c.insideBackground),
  ]);
  return { front, inside };
}

/** The two SQ14 print spreads (JPEG 3378 × 1724, 300 dpi) — STUB: plain colour. */
export async function renderGiftVoucherPrintSpreads(input: GiftVoucherRenderInput): Promise<{ outside: Buffer; inside: Buffer }> {
  const c = colors(input.designKey);
  const [outside, inside] = await Promise.all([
    solidJpeg(SPREAD_W, SPREAD_H, c.background, 300),
    solidJpeg(SPREAD_W, SPREAD_H, c.insideBackground, 300),
  ]);
  return { outside, inside };
}

/** The customer's photo from the private Blob store, or null. Never throws. */
export async function loadGiftVoucherPhoto(pathname: string | null): Promise<Buffer | null> {
  if (!pathname) return null;
  const file = await getGiftVoucherBlob(pathname);
  return file?.bytes ?? null;
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
