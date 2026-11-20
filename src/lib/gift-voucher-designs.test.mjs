// Tests for the gift voucher artwork (gift-voucher-designs.mjs) with the real
// bundled fonts: every design × panel × layout builds well-formed SVG made of
// outlines only (no <text>), the address circle on the card's back stays
// empty, lettering keeps the safe margin of the print file, and the output is
// deterministic.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import opentype from "opentype.js";
import QRCode from "qrcode";
import { GIFT_VOUCHER_DESIGN_KEYS } from "./gift-voucher-core.mjs";
import {
  GIFT_VOUCHER_DESIGNS,
  GIFT_VOUCHER_PRINT_SPREAD,
  buildGiftVoucherPanelSvg,
  buildGiftVoucherPdfPageSvg,
  buildGiftVoucherSpreadSvg,
  formatGiftVoucherDate,
  giftVoucherBackgroundSvg,
  giftVoucherDesign,
  giftVoucherTextAnchors,
  layoutGiftVoucherPanel,
} from "./gift-voucher-designs.mjs";

const FONT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "assets", "fonts");

/** @param {string} file */
function font(file) {
  const buf = readFileSync(path.join(FONT_DIR, file));
  return opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

const FONTS = {
  regular: font("montserrat-400.ttf"),
  semibold: font("montserrat-600.ttf"),
  bold: font("montserrat-700.ttf"),
  extrabold: font("montserrat-800.ttf"),
  script: font("caveat-500.ttf"),
  scriptBold: font("caveat-700.ttf"),
};

const qr = QRCode.create("https://www.motionsports.de/pages/gutschein#guthaben", { errorCorrectionLevel: "M" });
const QR = { size: qr.modules.size, data: qr.modules.data };

const DATA = {
  locale: /** @type {const} */ ("de"),
  amountCents: 5000,
  recipientName: "Lena",
  senderName: "Jonas",
  message: "Liebe Lena,\nfür deine neuen Trainingsziele — such dir etwas Schönes aus!\nAlles Liebe",
  code: "K7QM4TXP9HDA2RWN",
  number: "G-2026-00042",
  expiresOn: "2029-12-31",
  sample: false,
  issuerLine: "4motionsports GmbH · Am Weidegrund 1 · 82194 Gröbenzell",
  termsUrl: "https://www.motionsports.de/pages/gutscheinbedingungen",
};

// A 1×1 JPEG as data URI (the photo design's input).
const PHOTO =
  "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";

/**
 * A strict little XML well-formedness check: tags nest and close, attributes
 * are quoted, `&` only starts an entity, one root element.
 * @param {string} xml
 */
function assertWellFormed(xml) {
  const tag = /<(\/?)([A-Za-z][\w:.-]*)((?:\s+[A-Za-z_:][\w:.-]*="[^"<]*")*)\s*(\/?)>/y;
  const text = /[^<]*/y;
  /** @type {string[]} */
  const stack = [];
  let roots = 0;
  let i = 0;
  while (i < xml.length) {
    if (xml[i] === "<") {
      tag.lastIndex = i;
      const m = tag.exec(xml);
      assert.ok(m, `malformed tag at ${i}: ${xml.slice(i, i + 60)}`);
      const [, close, name, attrs, selfClose] = m;
      for (const v of attrs.matchAll(/="([^"]*)"/g)) {
        assert.ok(!/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/.test(v[1]), `raw & in attribute of <${name}>`);
      }
      if (close) {
        assert.equal(stack.pop(), name, `</${name}> closes the wrong element`);
      } else if (!selfClose) {
        if (stack.length === 0) roots++;
        stack.push(name);
      } else if (stack.length === 0) roots++;
      i = tag.lastIndex;
    } else {
      text.lastIndex = i;
      const m = /** @type {RegExpExecArray} */ (text.exec(xml));
      assert.ok(!/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/.test(m[0]), "raw & in text");
      assert.ok(stack.length > 0 || m[0].trim() === "", "text outside the root element");
      i = text.lastIndex;
    }
  }
  assert.deepEqual(stack, [], "unclosed elements");
  assert.equal(roots, 1, "exactly one root element");
}

/** @param {string} svg */
function assertOutlinesOnly(svg) {
  assert.ok(!/<text[\s>]/.test(svg) && !/<tspan[\s>]/.test(svg), "no <text>/<tspan> elements — all lettering is paths");
  assert.match(svg, /<path d="M/);
}

const PANELS = {
  landscape: /** @type {const} */ (["front", "inside"]),
  square: /** @type {const} */ (["front", "back", "inside-message", "inside-info"]),
};

/** @param {string} key @param {"landscape" | "square"} layout @param {string} panel @param {object} [extra] */
function layoutOf(key, layout, panel, extra = {}) {
  const sq = layout === "square";
  return layoutGiftVoucherPanel({
    panel: /** @type {any} */ (panel),
    layout,
    widthPx: sq ? GIFT_VOUCHER_PRINT_SPREAD.panelPx : 1819,
    heightPx: sq ? GIFT_VOUCHER_PRINT_SPREAD.heightPx : 1286,
    bleedPx: sq ? GIFT_VOUCHER_PRINT_SPREAD.bleedPx : 0,
    design: giftVoucherDesign(key),
    data: DATA,
    fonts: FONTS,
    photoDataUri: key === "photo" ? PHOTO : null,
    qrMatrix: QR,
    ...extra,
  });
}

test("the designs are exactly GIFT_VOUCHER_DESIGN_KEYS, complete and frozen", () => {
  assert.deepEqual(
    GIFT_VOUCHER_DESIGNS.map((d) => d.key),
    [...GIFT_VOUCHER_DESIGN_KEYS]
  );
  for (const d of GIFT_VOUCHER_DESIGNS) {
    assert.ok(d.name.de && d.name.en && d.description.de && d.description.en && d.defaultMessage.de && d.defaultMessage.en, d.key);
    for (const c of Object.values(d.colors)) assert.match(c, /^#[0-9a-f]{6}$/);
    assert.ok(Object.isFrozen(d) && Object.isFrozen(d.colors));
    assert.equal(giftVoucherDesign(d.key), d);
  }
  assert.equal(GIFT_VOUCHER_DESIGNS.filter((d) => d.photo).map((d) => d.key).join(), "photo");
  assert.equal(giftVoucherDesign("nope"), null);
  assert.equal(giftVoucherDesign(undefined), null);
});

test("every design × layout × panel is well-formed SVG made of outlines only", () => {
  for (const { key } of GIFT_VOUCHER_DESIGNS) {
    for (const layout of /** @type {const} */ (["landscape", "square"])) {
      for (const panel of PANELS[layout]) {
        const l = layoutOf(key, layout, panel);
        assertWellFormed(l.svg);
        assertOutlinesOnly(l.svg);
        assert.match(l.svg, new RegExp(`^<svg [^>]*width="${l.widthPx}" height="${l.heightPx}"`));
        assert.ok(l.elements.some((e) => e.role === "background"), `${key} ${layout} ${panel} has a background`);
      }
    }
  }
});

test("the inside panels carry the code, the QR code and the number", () => {
  for (const { key } of GIFT_VOUCHER_DESIGNS) {
    for (const l of [layoutOf(key, "landscape", "inside"), layoutOf(key, "square", "inside-info")]) {
      const roles = new Set(l.elements.map((e) => e.role));
      assert.ok(roles.has("code") && roles.has("qr") && roles.has("number"), key);
      const anchors = giftVoucherTextAnchors(l);
      assert.ok(anchors.code && anchors.code.x2 > anchors.code.x1 && anchors.number, key);
    }
  }
});

test("the back of the card keeps the address circle (Ø 95 mm) empty", () => {
  const { panelPx, bleedPx, keepOutDiameterMm } = GIFT_VOUCHER_PRINT_SPREAD;
  for (const { key } of GIFT_VOUCHER_DESIGNS) {
    const l = layoutOf(key, "square", "back");
    const center = panelPx / 2;
    const r = (keepOutDiameterMm / 2) * l.pxPerMm;
    assert.ok(Math.abs(l.pxPerMm - (panelPx - 2 * bleedPx) / 140) < 1e-9);
    const drawn = l.elements.filter((e) => e.role !== "background");
    assert.ok(drawn.length >= 2, `${key}: wordmark and site on the back`);
    for (const e of drawn) {
      assert.ok(e.bbox, `${key}: ${e.role} has a box`);
      const b = /** @type {{ x1: number, y1: number, x2: number, y2: number }} */ (e.bbox);
      // Distance from the circle's centre to the nearest point of the box.
      const dx = Math.max(b.x1 - center, 0, center - b.x2);
      const dy = Math.max(b.y1 - center, 0, center - b.y2);
      assert.ok(Math.hypot(dx, dy) > r, `${key}: ${e.role} at ${JSON.stringify(b)} enters the address circle`);
    }
  }
});

test("print panels keep all lettering, the code and the QR code 5 mm inside the trim", () => {
  const { panelPx, bleedPx, safeMarginMm } = GIFT_VOUCHER_PRINT_SPREAD;
  for (const { key } of GIFT_VOUCHER_DESIGNS) {
    for (const panel of PANELS.square) {
      for (const extra of [{}, { data: { ...DATA, recipientName: "Maximiliane Musterfrau-Schönberger", amountCents: 50000, senderName: "Familie Schönberger-Wiesenthal" } }]) {
        const l = layoutOf(key, "square", panel, extra);
        const lo = bleedPx + safeMarginMm * l.pxPerMm;
        const hi = panelPx - bleedPx - safeMarginMm * l.pxPerMm;
        for (const e of l.elements) {
          if (!["text", "value", "code", "number", "qr"].includes(e.role) || !e.bbox) continue;
          const b = e.bbox;
          assert.ok(b.x1 >= lo && b.y1 >= lo && b.x2 <= hi && b.y2 <= hi, `${key} ${panel}: ${e.role} ${JSON.stringify(b)} outside the safe area`);
        }
      }
    }
  }
});

test("the artwork is deterministic", () => {
  for (const { key } of GIFT_VOUCHER_DESIGNS) {
    assert.equal(layoutOf(key, "square", "front").svg, layoutOf(key, "square", "front").svg);
    assert.equal(layoutOf(key, "landscape", "inside").svg, layoutOf(key, "landscape", "inside").svg);
    assert.equal(giftVoucherBackgroundSvg(key, { width: 140, height: 140 }), giftVoucherBackgroundSvg(key, { width: 140, height: 140 }));
  }
});

test("characters the fonts lack are dropped, not drawn as boxes, and nothing breaks", () => {
  const l = layoutOf("birthday", "landscape", "inside", {
    data: { ...DATA, message: "Hallo 😀 Welt\u0007 ✨", recipientName: "Zoë 🎉", senderName: "Jo" },
  });
  assertWellFormed(l.svg);
  assertOutlinesOnly(l.svg);
  const front = layoutOf("birthday", "landscape", "front", { data: { ...DATA, recipientName: "😀😀" } });
  assertWellFormed(front.svg);
  // A message with nothing drawable left prints the design's default line.
  assert.equal(
    layoutOf("thanks", "landscape", "inside", { data: { ...DATA, message: "😀 🎉" } }).svg,
    layoutOf("thanks", "landscape", "inside", { data: { ...DATA, message: null } }).svg
  );
});

test("the photo design shows the photo, and falls back to classic without one", () => {
  const withPhoto = layoutOf("photo", "landscape", "front");
  assert.ok(withPhoto.elements.some((e) => e.role === "image"));
  assert.match(withPhoto.svg, /<image [^>]*preserveAspectRatio="xMidYMid slice" xlink:href="data:image\/jpeg;base64,/);
  const without = layoutOf("photo", "landscape", "front", { photoDataUri: null });
  assert.ok(!without.elements.some((e) => e.role === "image"));
  assert.match(without.svg, /-knurl"/, "classic's knurl pattern");
  const injected = layoutOf("photo", "landscape", "front", { photoDataUri: 'data:image/jpeg;base64,AAAA" onload="x' });
  assert.ok(!injected.svg.includes("onload"), "an odd data URI is never embedded");
});

test("a sample carries the watermark, a real voucher does not", () => {
  const sample = layoutOf("christmas", "landscape", "inside", { data: { ...DATA, sample: true, code: null, number: null } });
  assert.ok(sample.elements.some((e) => e.role === "watermark"));
  assert.equal(giftVoucherTextAnchors(sample).number, null, "the sample number is not a real number");
  const real = layoutOf("christmas", "landscape", "inside");
  assert.ok(!real.elements.some((e) => e.role === "watermark"));
});

test("fronts work without recipient, message, expiry, in English and with odd amounts", () => {
  for (const { key } of GIFT_VOUCHER_DESIGNS) {
    for (const data of [
      { ...DATA, recipientName: null, senderName: null, message: null, expiresOn: null },
      { ...DATA, locale: /** @type {const} */ ("en"), amountCents: 4990 },
      { ...DATA, amountCents: 100000 },
    ]) {
      for (const panel of ["front", "inside"]) {
        const l = layoutOf(key, "landscape", panel, { data });
        assertWellFormed(l.svg);
        // Nothing of the lettering leaves the panel.
        for (const e of l.elements) {
          if (!["text", "value", "code"].includes(e.role) || !e.bbox) continue;
          assert.ok(e.bbox.x1 >= 0 && e.bbox.x2 <= l.widthPx && e.bbox.y1 >= 0 && e.bbox.y2 <= l.heightPx, `${key} ${panel}`);
        }
      }
    }
  }
});

test("buildGiftVoucherPanelSvg: square inside is the opened card (two panels side by side)", () => {
  const svg = buildGiftVoucherPanelSvg({
    panel: "inside",
    layout: "square",
    widthPx: 1600,
    heightPx: 800,
    design: giftVoucherDesign("thanks"),
    data: DATA,
    fonts: FONTS,
    qrMatrix: QR,
  });
  assertWellFormed(svg);
  assert.match(svg, /^<svg [^>]*width="1600" height="800"/);
  assert.equal((svg.match(/<svg /g) ?? []).length, 3);
  assert.throws(() => buildGiftVoucherPanelSvg({ panel: "front", layout: "landscape", widthPx: 100, heightPx: 70, design: null }), TypeError);
});

test("the spread loses each panel's bleed at the fold", () => {
  const G = GIFT_VOUCHER_PRINT_SPREAD;
  assert.equal(G.foldX * 2, G.widthPx);
  assert.equal(G.panelPx, G.foldX + G.bleedPx);
  const left = layoutOf("classic", "square", "back");
  const right = layoutOf("classic", "square", "front");
  const svg = buildGiftVoucherSpreadSvg({ left, right, widthPx: G.widthPx, heightPx: G.heightPx, bleedPx: G.bleedPx });
  assertWellFormed(svg);
  assert.match(svg, /<svg x="0" y="0" width="1689" height="1724" viewBox="0 0 1689 1724"/);
  assert.match(svg, /<svg x="1689" y="0" width="1689" height="1724" viewBox="35 0 1689 1724"/);
});

test("the A4 page puts front and inside on one page with the cut line", () => {
  const front = layoutOf("training", "landscape", "front");
  const inside = layoutOf("training", "landscape", "inside");
  const svg = buildGiftVoucherPdfPageSvg({ front, inside, widthPx: 1819, heightPx: 2572, fonts: FONTS, locale: "de" });
  assertWellFormed(svg);
  assertOutlinesOnly(svg);
  assert.match(svg, /stroke-dasharray=/);
  assert.match(svg, /<svg x="0" y="1286" width="1819" height="1286"/);
});

test("background layers for the storefront: decorative only, unique ids per design and format", () => {
  /** @type {Set<string>} */
  const ids = new Set();
  for (const { key } of GIFT_VOUCHER_DESIGNS) {
    for (const box of [{ width: 210, height: 148 }, { width: 140, height: 140 }]) {
      const svg = giftVoucherBackgroundSvg(key, box);
      assertWellFormed(svg);
      assert.ok(!/<text[\s>]/.test(svg) && !svg.includes("<image"));
      assert.match(svg, new RegExp(`^<svg [^>]*width="${box.width}" height="${box.height}" viewBox="0 0 ${box.width} ${box.height}"`));
      assert.ok(svg.length < 60000, `${key}: ${svg.length} bytes`);
      for (const m of svg.matchAll(/ id="([^"]+)"/g)) {
        assert.ok(!ids.has(m[1]), `duplicate id ${m[1]}`);
        ids.add(m[1]);
      }
    }
  }
  assert.equal(giftVoucherBackgroundSvg("unknown"), giftVoucherBackgroundSvg("classic"));
});

test("formatGiftVoucherDate", () => {
  assert.equal(formatGiftVoucherDate("2029-12-31"), "31.12.2029");
  assert.equal(formatGiftVoucherDate("2029-12-31", "en"), "31 Dec 2029");
  assert.equal(formatGiftVoucherDate("2029-02-05", "en"), "5 Feb 2029");
  assert.equal(formatGiftVoucherDate(null), null);
  assert.equal(formatGiftVoucherDate("31.12.2029"), null);
  assert.equal(formatGiftVoucherDate("2029-13-01"), null);
});
