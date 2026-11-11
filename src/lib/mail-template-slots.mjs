// E-mail templates („Vorlagen“) — the pure half of the slots: what the
// TypeScript layer (mail-template-design.ts renderDocSlots /
// docProductAvailability) hands the template renderer (mail-template-render.mjs)
// for the blocks that show live catalog data. Tested
// (mail-template-slots.test.mjs); docs/EMAIL_TEMPLATES.md.
//
//   * `product` („Produkt-Highlight“): no pre-rendered HTML — the renderer
//     lays the card out in the template's own colours and fonts from DATA
//     (name, picture, link, price line, short description); the slot also
//     carries the product's line of the text part.
//   * `products`: the text-part lines under the classic product rows / grid.
//   * the Rundmail check „Produkt-Baustein ohne lieferbares Produkt“.
//
// Name, link and price line (sale price, „ab“ price of a product in all its
// variants, variant names) come from the ONE projection every product grid
// uses — productGridItem in email-products.ts; the TypeScript side passes it
// in, so a template never prices a product differently from the other mails.
//
// Also here, for the routes that save a document (Vorlagen, Rundmail): the
// block limits of a raw request body (docBlockLimitProblem).

import { MAIL_TEMPLATE_LIMITS, docBlockCount, walkMailBlocks } from "./mail-template-doc.mjs";

/** The longest short description a product card shows (characters, „…“ included). */
export const PRODUCT_SLOT_DESCRIPTION_CHARS = 220;

/**
 * The data of a „Produkt-Highlight“ card (MailRenderContext.slots[id].product) —
 * defined once, by the renderer that draws it.
 * @typedef {import("./mail-template-render.mjs").MailSlotProduct} MailSlotProduct
 */

/**
 * What productGridItem (email-products.ts) returns for a display product.
 * @typedef {{
 *   name: string,
 *   imageUrl: string | null,
 *   url?: string | null,
 *   priceLabel?: string | null,
 *   compareAtLabel?: string | null,
 * }} SlotGridItem
 */

/** The path (lower case) and the `format` conversion parameter of an image URL. */
function imageUrlParts(url) {
  if (typeof url !== "string" || !url) return { path: "", format: "" };
  try {
    const u = new URL(url);
    return { path: u.pathname.toLowerCase(), format: (u.searchParams.get("format") ?? "").toLowerCase() };
  } catch {
    return { path: url.replace(/[?#].*$/, "").toLowerCase(), format: "" };
  }
}

/**
 * Is an image URL a WebP picture — by its file name or a `format=webp`
 * conversion (Shopify's CDN)? Outlook for Windows shows none.
 * @param {unknown} url
 */
export function isWebpImageUrl(url) {
  const { path, format } = imageUrlParts(url);
  return format === "webp" || (!format && path.endsWith(".webp"));
}

/**
 * Is an image URL an https JPG, PNG or GIF — a picture every mail client shows?
 * @param {unknown} url
 */
export function isMailSafeImageUrl(url) {
  if (typeof url !== "string" || !url.startsWith("https://")) return false;
  const { path, format } = imageUrlParts(url);
  if (format) return ["jpg", "jpeg", "pjpg", "png", "gif"].includes(format);
  return /\.(?:jpe?g|png|gif)$/.test(path);
}

/**
 * The picture a mail shows for a product: `primary` (the grid's first https
 * image) unless it is a WebP and the product has an https JPG/PNG/GIF among
 * its images — then the first of those. Without one the WebP stays (every
 * client but Outlook shows it).
 * @param {string | null | undefined} primary
 * @param {ReadonlyArray<unknown> | null | undefined} images
 * @returns {string | null}
 */
export function mailProductImageUrl(primary, images) {
  const first = typeof primary === "string" && primary ? primary : null;
  if (first && !isWebpImageUrl(first)) return first;
  const safe = (Array.isArray(images) ? images : []).find((u) => isMailSafeImageUrl(u));
  return typeof safe === "string" ? safe : first;
}

/**
 * The catalog's short description as card text: plain, on one line, at most
 * `max` characters — a longer one is cut at a word and ends in „…“. Null when
 * there is none.
 * @param {unknown} raw
 * @param {number} [max]
 * @returns {string | null}
 */
export function shortProductDescription(raw, max = PRODUCT_SLOT_DESCRIPTION_CHARS) {
  const s = String(raw ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return null;
  if (s.length <= max) return s;
  const room = Math.max(1, max - 1); // one character for „…“
  let cut = s.slice(0, room);
  // the next character is a space: the cut already ends on a whole word
  const space = s[room] === " " ? room : cut.lastIndexOf(" ");
  if (space >= room * 0.6) cut = cut.slice(0, space);
  else if (/[\ud800-\udbff]$/.test(cut)) cut = cut.slice(0, -1); // never half an emoji
  const head = cut.replace(/[\s,;:.!?–—-]+$/u, "");
  return head ? `${head}…` : null;
}

/**
 * The product's line in the text part: „Name — Preis“ and the link below it.
 * Without `showPrice` (the card hides its price) just the name.
 * @param {{ name?: unknown, priceLabel?: unknown, url?: unknown }} item
 * @param {{ showPrice?: boolean }} [opts]
 */
export function productSlotText(item, opts = {}) {
  const name = String(item?.name ?? "").trim();
  const price = opts.showPrice === false ? "" : String(item?.priceLabel ?? "").trim();
  const url = String(item?.url ?? "").trim();
  return [name && price ? `${name} — ${price}` : name || price, url].filter(Boolean).join("\n");
}

/**
 * The slot of a „Produkt-Highlight“ block: no pre-rendered HTML (the template
 * renderer lays the card out from `product`), its line of the text part and
 * the card data — the grid projection (price line, link, variant name), a
 * mail-safe picture and the short description.
 * @param {SlotGridItem} item  productGridItem(display, language)
 * @param {{ images?: ReadonlyArray<unknown> | null, shortDescription?: unknown } | null | undefined} display  the display product
 * @param {{ showPrice?: boolean }} [opts]  the block's showPrice (text part only — the card data stays complete)
 * @returns {{ html: string, text: string, product: MailSlotProduct }}
 */
export function productHighlightSlot(item, display, opts = {}) {
  /** @type {MailSlotProduct} */
  const product = {
    name: String(item?.name ?? "").trim(),
    imageUrl: mailProductImageUrl(item?.imageUrl, display?.images),
    url: typeof item?.url === "string" && item.url.trim() ? item.url.trim() : null,
    priceLabel: typeof item?.priceLabel === "string" && item.priceLabel.trim() ? item.priceLabel.trim() : null,
    compareAtLabel: typeof item?.compareAtLabel === "string" && item.compareAtLabel.trim() ? item.compareAtLabel.trim() : null,
    description: shortProductDescription(display?.shortDescription),
  };
  return { html: "", text: productSlotText(product, opts), product };
}

/**
 * The text part of a `products` block: one „- Name — Preis“ line per
 * product, its link indented below — the same price line as the rows / grid.
 * @param {ReadonlyArray<SlotGridItem>} items
 */
export function productListText(items) {
  return (items ?? [])
    .map((it) => {
      const price = String(it?.priceLabel ?? "").trim();
      const url = String(it?.url ?? "").trim();
      return `- ${String(it?.name ?? "").trim()}${price ? ` — ${price}` : ""}${url ? `\n  ${url}` : ""}`;
    })
    .join("\n");
}

/**
 * How many product blocks would show nothing right now (and so be left out of
 * a send): `products` blocks none of whose products is showable, and
 * `product` blocks whose product is not — inside sections too. Blocks without
 * a product chosen are not counted (validation reports them).
 * @param {{ blocks?: unknown } | null | undefined} doc
 * @param {(ref: string) => boolean} showable
 */
export function emptyProductBlocks(doc, showable) {
  let n = 0;
  for (const { block: b } of walkMailBlocks(doc)) {
    if (b.type === "products" && Array.isArray(b.refs) && b.refs.length > 0) {
      if (!b.refs.some((/** @type {string} */ ref) => showable(ref))) n++;
    } else if (b.type === "product" && typeof b.ref === "string" && b.ref && !showable(b.ref)) {
      n++;
    }
  }
  return n;
}

// ── request limits ───────────────────────────────────────────────────────────

/**
 * Does a RAW document body (a save of a template or a Rundmail) hold more
 * blocks than a document may — more than MAIL_TEMPLATE_LIMITS.blocks one
 * below the other, or more than .totalBlocks in all, the blocks inside the
 * columns of a section counted? The editor normalises on every change and
 * never sends such a body; the normaliser would cut the rest silently, so the
 * routes refuse it with this German message. Null when the body is within
 * the limits (or no document at all — normalising that is the route's call).
 * @param {unknown} raw
 * @returns {string | null}
 */
export function docBlockLimitProblem(raw) {
  const L = MAIL_TEMPLATE_LIMITS;
  const top = raw && typeof raw === "object" ? /** @type {{ blocks?: unknown }} */ (raw).blocks : null;
  const tooMany = (Array.isArray(top) && top.length > L.blocks) || docBlockCount(raw) > L.totalBlocks;
  return tooMany ? `Zu viele Bausteine — höchstens ${L.blocks} untereinander und ${L.totalBlocks} insgesamt (Bausteine in Abschnitten mitgezählt).` : null;
}
