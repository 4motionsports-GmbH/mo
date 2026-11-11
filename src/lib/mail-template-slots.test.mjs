import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PRODUCT_SLOT_DESCRIPTION_CHARS,
  docBlockLimitProblem,
  emptyProductBlocks,
  isMailSafeImageUrl,
  isWebpImageUrl,
  mailProductImageUrl,
  productHighlightSlot,
  productListText,
  productSlotText,
  shortProductDescription,
} from "./mail-template-slots.mjs";
import { MAIL_TEMPLATE_LIMITS, normalizeMailTemplateDoc } from "./mail-template-doc.mjs";

const CDN = "https://cdn.shopify.com/s/files/1/0823/4896/6217/files";

test("isWebpImageUrl / isMailSafeImageUrl: by file name or Shopify's format conversion", () => {
  assert.equal(isWebpImageUrl(`${CDN}/rack.webp?v=1730791599`), true);
  assert.equal(isWebpImageUrl(`${CDN}/RACK.WEBP`), true);
  assert.equal(isWebpImageUrl(`${CDN}/rack.jpg?format=webp`), true);
  assert.equal(isWebpImageUrl(`${CDN}/rack.webp?format=pjpg`), false, "converted to JPG by the CDN");
  assert.equal(isWebpImageUrl(`${CDN}/rack.jpg?v=1`), false);
  assert.equal(isWebpImageUrl("/relative/rack.webp"), true);
  assert.equal(isWebpImageUrl(null), false);
  for (const ok of [`${CDN}/a.jpg?v=1`, `${CDN}/a.JPEG`, `${CDN}/a.png`, `${CDN}/a.gif`, `${CDN}/a.webp?format=pjpg`]) {
    assert.equal(isMailSafeImageUrl(ok), true, ok);
  }
  for (const bad of [`${CDN}/a.webp`, `${CDN}/a.avif`, `${CDN}/a.svg`, `${CDN}/a`, "http://cdn.example.com/a.jpg", `${CDN}/a.png?format=webp`, 7]) {
    assert.equal(isMailSafeImageUrl(bad), false, String(bad));
  }
});

test("mailProductImageUrl: a WebP gives way to the product's first JPG/PNG/GIF, else stays", () => {
  const webp = `${CDN}/front.webp?v=1`;
  const jpg = `${CDN}/side.jpg?v=2`;
  assert.equal(mailProductImageUrl(`${CDN}/front.jpg`, [webp, jpg]), `${CDN}/front.jpg`, "a JPG first image is kept");
  assert.equal(mailProductImageUrl(webp, [webp, `${CDN}/detail.webp`, jpg, `${CDN}/z.png`]), jpg);
  assert.equal(mailProductImageUrl(webp, [webp, `${CDN}/detail.webp`]), webp, "no alternative: the WebP stays");
  assert.equal(mailProductImageUrl(webp, [webp, "http://cdn.example.com/x.jpg", `${CDN}/x.avif`]), webp, "only https JPG/PNG/GIF count");
  assert.equal(mailProductImageUrl(null, [jpg]), jpg, "no first image: a mail-safe one of the list");
  assert.equal(mailProductImageUrl(null, null), null);
  assert.equal(mailProductImageUrl("", []), null);
});

test("shortProductDescription: plain, one line, at most 220 characters, cut at a word", () => {
  assert.equal(PRODUCT_SLOT_DESCRIPTION_CHARS, 220);
  assert.equal(shortProductDescription("  Stabile Hantelbank,\n\nklappbar.\t"), "Stabile Hantelbank, klappbar.");
  assert.equal(shortProductDescription(""), null);
  assert.equal(shortProductDescription(null), null);
  assert.equal(shortProductDescription(" \n "), null);
  const words = Array.from({ length: 60 }, (_, i) => `Wort${i}`).join(" "); // > 220 characters
  const cut = shortProductDescription(words);
  assert.ok(cut.length <= 220, `${cut.length}`);
  assert.ok(cut.endsWith("…"));
  assert.ok(words.startsWith(cut.slice(0, -1)), "cut at a word, nothing invented");
  assert.match(cut, /Wort\d+…$/, "no half word");
  // The cut lands right before a space: the whole last word stays.
  const exact = `${"a".repeat(219)} b`;
  assert.equal(shortProductDescription(exact), `${"a".repeat(219)}…`);
  // No space in reach: a hard cut, never half an emoji.
  assert.equal(shortProductDescription("x".repeat(300)), `${"x".repeat(219)}…`);
  assert.equal(shortProductDescription(`${"x".repeat(218)}😀${"y".repeat(50)}`), `${"x".repeat(218)}…`);
  // Punctuation before the ellipsis goes.
  assert.equal(shortProductDescription("Eins zwei, drei vier fünf", 13), "Eins zwei…");
  assert.equal(shortProductDescription("Kurz. Und noch viel mehr Text", 8), "Kurz…");
  assert.equal(shortProductDescription("----------", 5), null);
  // A description already within the limit (the catalog may end it in „…“) stays as it is.
  assert.equal(shortProductDescription("Bis 150 kg belastbar…"), "Bis 150 kg belastbar…");
});

test("productSlotText: „Name — Preis“ and the link; the price only when the card shows it", () => {
  const item = { name: "Power Rack", priceLabel: "ab 499,00 €", url: "https://motionsports.de/products/rack" };
  assert.equal(productSlotText(item), "Power Rack — ab 499,00 €\nhttps://motionsports.de/products/rack");
  assert.equal(productSlotText(item, { showPrice: false }), "Power Rack\nhttps://motionsports.de/products/rack");
  assert.equal(productSlotText({ name: "Rack", priceLabel: null, url: null }), "Rack");
  assert.equal(productSlotText({ name: " Rack ", priceLabel: "9,00 €", url: "" }), "Rack — 9,00 €");
});

test("productHighlightSlot: the grid projection + a mail-safe picture + the short description; no HTML", () => {
  const item = {
    name: "Power Rack (Schwarz)",
    imageUrl: `${CDN}/front.webp?v=1`,
    url: "https://motionsports.de/products/rack?variant=42",
    priceLabel: "449,00 €",
    compareAtLabel: "499,00 €",
  };
  const display = { images: [`${CDN}/front.webp?v=1`, `${CDN}/side.png`], shortDescription: "Stabil.\nFür dein Home-Gym." };
  assert.deepEqual(productHighlightSlot(item, display), {
    html: "",
    text: "Power Rack (Schwarz) — 449,00 €\nhttps://motionsports.de/products/rack?variant=42",
    product: {
      name: "Power Rack (Schwarz)",
      imageUrl: `${CDN}/side.png`,
      url: "https://motionsports.de/products/rack?variant=42",
      priceLabel: "449,00 €",
      compareAtLabel: "499,00 €",
      description: "Stabil. Für dein Home-Gym.",
    },
  });
  // Missing pieces become null — never "" or undefined.
  const bare = productHighlightSlot({ name: "Matte", imageUrl: null, url: "", priceLabel: "19,00 €", compareAtLabel: null }, { images: [], shortDescription: "" }, { showPrice: false });
  assert.deepEqual(bare, {
    html: "",
    text: "Matte",
    product: { name: "Matte", imageUrl: null, url: null, priceLabel: "19,00 €", compareAtLabel: null, description: null },
  });
  assert.equal(productHighlightSlot({ name: "X", imageUrl: null }, null).product.description, null);
});

test("productListText: the text part of a products block — one line per product, the link below", () => {
  assert.equal(
    productListText([
      { name: "Rack", priceLabel: "499,00 €", url: "https://motionsports.de/products/rack" },
      { name: "Bank", priceLabel: "ab 99,00 €", url: null },
      { name: "Matte", priceLabel: null, url: "https://motionsports.de/products/matte" },
    ]),
    "- Rack — 499,00 €\n  https://motionsports.de/products/rack\n- Bank — ab 99,00 €\n- Matte\n  https://motionsports.de/products/matte"
  );
  assert.equal(productListText([]), "");
});

test("emptyProductBlocks: products blocks with nothing showable plus product blocks whose product is not — nested too", () => {
  const doc = normalizeMailTemplateDoc({
    blocks: [
      { type: "products", refs: ["rack", "gone"] }, // one showable → shown
      { type: "products", refs: ["gone", "sold"] }, // nothing → empty
      { type: "products", refs: [] }, // nothing chosen → validation, not counted
      { type: "product", ref: "rack" },
      { type: "product", ref: "sold" }, // empty
      { type: "product" }, // nothing chosen → not counted
      {
        type: "section",
        columns: [{ blocks: [{ type: "product", ref: "gone" }] }, { blocks: [{ type: "product", ref: "rack" }, { type: "text", text: "x" }] }],
      },
    ],
  });
  const showable = (ref) => ref === "rack";
  assert.equal(emptyProductBlocks(doc, showable), 3);
  assert.equal(emptyProductBlocks(doc, () => true), 0);
  assert.equal(emptyProductBlocks(normalizeMailTemplateDoc({ blocks: [{ type: "text", text: "x" }] }), () => false), 0);
  assert.equal(emptyProductBlocks(null, () => false), 0);
});

test("docBlockLimitProblem: a raw body over 40 blocks one below the other or 80 in all is refused", () => {
  const L = MAIL_TEMPLATE_LIMITS;
  const texts = (n) => Array.from({ length: n }, (_, i) => ({ type: "text", text: `T${i}` }));
  assert.equal(docBlockLimitProblem({ blocks: texts(L.blocks) }), null);
  assert.match(docBlockLimitProblem({ blocks: texts(L.blocks + 1) }), /^Zu viele Bausteine — höchstens 40 untereinander und 80 insgesamt/);
  // 20 sections × 3 children + 20 = 80 blocks → fine; one more child → too many
  const sections = (children) => Array.from({ length: 20 }, () => ({ type: "section", columns: [{ blocks: texts(children) }] }));
  assert.equal(docBlockLimitProblem({ blocks: sections(3) }), null);
  assert.notEqual(docBlockLimitProblem({ blocks: [...sections(3), { type: "footer" }] }), null);
  // every normalised document is within the limits
  assert.equal(docBlockLimitProblem(normalizeMailTemplateDoc({ blocks: [...sections(5), ...texts(50)] })), null);
  for (const nothing of [null, undefined, "{}", 7, {}, { blocks: "x" }]) assert.equal(docBlockLimitProblem(nothing), null, String(nothing));
});
