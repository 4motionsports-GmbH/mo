// The renderer of block documents, version 2 (11.11.2026): sections with
// columns, per-block spacing and type, card colour and radius, web fonts,
// the menu and product blocks — and that version-1 documents keep their
// output byte for byte (snapshots in __fixtures__/mail-template-v1/).
//
// After an INTENDED change of the version-1 output, rewrite the snapshots:
//   MAIL_TEMPLATE_FIXTURES=update node --test src/lib/mail-template-render-v2.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { EMAIL_SHELL_CSS } from "./email-shell-css.mjs";
import { firstFontFamily, lintOutlookHtml, MAIL_SIZE_BUDGET_BYTES, msoTextWidth, windowsFontOf } from "./email-outlook.mjs";
import {
  MAIL_FONT_KEYS,
  MAIL_TEMPLATE_STARTERS,
  applyMergeFields,
  contrastRatio,
  countdownLook,
  mailFontMsoStack,
  mailFontStack,
  normalizeMailTemplateDoc,
} from "./mail-template-doc.mjs";
import { freezeLinks } from "./mailing-core.mjs";
import {
  MAIL_CARD_WIDTH,
  MAIL_FOOTER_MARKER,
  isDarkCard,
  mailWhitePanel,
  renderMailTemplateHtml,
  renderMailTemplateText,
  sanitizeCustomHtml,
  sectionColumnWidths,
  socialIconLayout,
} from "./mail-template-render.mjs";
import { FIXTURE_ASSETS, FIXTURE_FOOTER, V1_RENDER_CASES, fixtureContext } from "./__fixtures__/mail-template-v1-cases.mjs";

const lint = (html) => lintOutlookHtml(html, { maxImageWidth: MAIL_CARD_WIDTH });
/** The lint with the rules the template renderer meets on its own (Word's fonts and line heights) — not for the composers' pieces. */
const strictLint = (html) => lintOutlookHtml(html, { maxImageWidth: MAIL_CARD_WIDTH, strict: true });
const bytes = (html) => new TextEncoder().encode(html).length;
const anna = (t) => applyMergeFields(t, { firstName: "anna" });
const ctx = (extra = {}) => fixtureContext({ merge: anna, ...extra });
/** A document of these blocks (and style) — footer added by the normaliser. */
const docOf = (blocks, style = {}) => ({ v: 2, style, blocks });
/** The rendered rows between the card's <tbody> and the footer marker. */
const body = (html) => html.slice(html.indexOf('class="email-container"'), html.indexOf(MAIL_FOOTER_MARKER));
/** Every <img …> tag. */
const imgs = (html) => html.match(/<img\b[^>]*>/g) ?? [];

/** Product data of a `product` slot (mail-template-design.ts renderDocSlots). */
const product = (n, extra = {}) => ({
  name: `Produkt ${n}`,
  imageUrl: `https://cdn.shopify.com/p${n}.jpg`,
  url: `https://motionsports.de/products/p${n}`,
  priceLabel: "399,00 €",
  compareAtLabel: null,
  description: `Beschreibung ${n}`,
  ...extra,
});
const slot = (p) => ({ html: "", text: "", product: p });

// ── version-1 documents stay as they were ────────────────────────────────────

const FIXTURES = new URL("./__fixtures__/mail-template-v1/", import.meta.url);
const UPDATE = process.env.MAIL_TEMPLATE_FIXTURES === "update";
/** The shared shell CSS of a render: the last <style> block of the head. */
const SHELL_CSS_RE = /<style type="text\/css">\n((?:(?!<style)[\s\S])*?)\n {4}<\/style>\n {2}<\/head>/;
/**
 * Intended changes of version 2 for version-1 documents: the coupon card
 * takes the separate border model, so its 8 px radius finally shows.
 */
const V2_DELTAS = [["Margin: 0 auto; border: 2px dashed", "Margin: 0 auto; border-collapse: separate !important; border-spacing: 0; border: 2px dashed"]];
const readSnapshot = (name) => readFileSync(new URL(name, FIXTURES), "utf8").replace(/\r\n/g, "\n").replace(/\n$/, "");

test("version-1 documents render byte for byte as before (the shared CSS only gained rules)", () => {
  assert.ok(V1_RENDER_CASES.length >= 10);
  for (const c of V1_RENDER_CASES) {
    const html = renderMailTemplateHtml(c.doc(), c.ctx());
    const text = renderMailTemplateText(c.doc(), c.ctx());
    if (UPDATE) {
      writeFileSync(new URL(`${c.name}.html`, FIXTURES), `${html}\n`);
      writeFileSync(new URL(`${c.name}.txt`, FIXTURES), `${text}\n`);
      continue;
    }
    const snapshot = readSnapshot(`${c.name}.html`);
    const oldCss = SHELL_CSS_RE.exec(snapshot)?.[1];
    assert.ok(oldCss, `${c.name}: snapshot without the shell CSS`);
    // EMAIL_SHELL_CSS is shared with the classic shell: rules are only ever ADDED.
    const lines = EMAIL_SHELL_CSS.split("\n");
    let at = 0;
    for (const l of oldCss.split("\n")) {
      while (at < lines.length && lines[at] !== l) at++;
      assert.ok(at++ < lines.length, `${c.name}: shell CSS lost the line ${l.trim()}`);
    }
    let expected = snapshot.replace(oldCss, () => EMAIL_SHELL_CSS);
    for (const [from, to] of V2_DELTAS) expected = expected.split(from).join(to);
    assert.equal(html, expected, c.name);
    assert.equal(text, readSnapshot(`${c.name}.txt`), `${c.name} (text part)`);
  }
});

test("the version-1 starters are among the snapshots, in preview and send", () => {
  const names = new Set(V1_RENDER_CASES.map((c) => c.name));
  for (const s of MAIL_TEMPLATE_STARTERS) assert.ok(names.has(`starter-${s.key}-preview`), s.key);
  assert.ok(names.has("starter-black-week-send") && names.has("starter-newsletter-send"));
});

test("the shell CSS stacks section columns on phones", () => {
  const media = EMAIL_SHELL_CSS.slice(EMAIL_SHELL_CSS.indexOf("@media only screen and (max-width:480px)"));
  assert.match(media, /\.col-stack \{ display: block !important; width: 100% !important; max-width: 100% !important; box-sizing: border-box !important; \}/);
  assert.match(media, /\.col-gap \{ display: block !important; width: 100% !important; height: 16px !important; line-height: 16px !important; font-size: 0 !important; \}/);
  assert.match(media, /\.col-img \{ width: 100% !important; max-width: 100% !important; height: auto !important; \}/);
});

// ── the showcase: every feature of version 2 in one mail ─────────────────────

function showcase() {
  return {
    v: 2,
    style: {
      accentColor: "#ffd400",
      buttonTextColor: "#111111",
      textColor: "#eeeeee",
      headingColor: "#ffffff",
      outerBackground: "#000000",
      fontFamily: "poppins",
      buttonShape: "rounded",
      cardBackground: "#161616",
      headingFont: "oswald",
      linkColor: "#7fd3ff",
      contentPadding: 32,
      cardRadius: 16,
    },
    blocks: [
      {
        id: "hdr",
        type: "section",
        padTop: 16,
        padBottom: 16,
        stack: false,
        gap: 12,
        columns: [
          { id: "hdrL", width: 35, valign: "middle", blocks: [{ id: "lg", type: "logo", align: "left", width: 120 }] },
          {
            id: "hdrR",
            width: 65,
            valign: "middle",
            blocks: [
              {
                id: "mn",
                type: "menu",
                align: "right",
                separator: "·",
                uppercase: true,
                bold: true,
                fontSize: 12,
                letterSpacing: 1,
                color: "#ffd400",
                font: "inter",
                items: [
                  { label: "Kraft", href: "https://motionsports.de/collections/kraft" },
                  { label: "Cardio", href: "https://motionsports.de/collections/cardio" },
                  { label: "Hallo {{vorname|du}}", href: "https://motionsports.de/account" },
                ],
              },
            ],
          },
        ],
      },
      {
        id: "hero",
        type: "section",
        background: "#222222",
        bgImage: "https://cdn.example.com/hero.jpg",
        minHeight: 320,
        padTop: 48,
        padBottom: 48,
        columns: [
          {
            id: "heroC",
            valign: "middle",
            blocks: [
              { id: "h1", type: "heading", text: "Black Week", size: "xl", color: "#ffd400", fontSize: 56, uppercase: true, letterSpacing: 4, lineHeight: 110, font: "bebas" },
              { id: "t1", type: "text", text: "Bis zu 40 % auf Home-Gym-Geräte", size: "l", align: "center", italic: true, weight: "bold", fontSize: 18 },
              { id: "b1", type: "button", label: "Jetzt sparen", href: "https://motionsports.de/collections/black-week", size: "l", shape: "pill" },
            ],
          },
        ],
      },
      {
        id: "duo",
        type: "section",
        reverse: true,
        radius: 12,
        borderColor: "#333333",
        background: "#1f1f1f",
        padX: 24,
        gap: 24,
        columns: [
          { id: "duoL", width: 45, blocks: [{ id: "im1", type: "image", src: "https://cdn.example.com/rack.jpg", alt: "Rack", href: "https://motionsports.de/products/rack", width: "full", radius: 8 }] },
          {
            id: "duoR",
            width: 55,
            padding: 16,
            valign: "middle",
            background: "#262626",
            blocks: [
              { id: "h2", type: "heading", text: "Dein Rack", size: "m", align: "left", weight: "normal" },
              { id: "t2", type: "text", text: "- Stahl\n- Sicher\n- Schnell geliefert", bullet: "✓", accentBar: "#ffd400" },
              { id: "b2", type: "button", label: "Ansehen", href: "https://motionsports.de/products/rack", align: "left", size: "s", outline: true },
            ],
          },
        ],
      },
      {
        id: "tiles",
        type: "section",
        gap: 16,
        columns: [
          { id: "c1", blocks: [{ id: "p1", type: "product", ref: "p1", buttonLabel: "Für {{vorname|dich}}" }] },
          { id: "c2", blocks: [{ id: "p2", type: "product", ref: "p2", showDescription: true, buttonLabel: "", nameSize: 14, color: "#ffffff" }] },
          { id: "c3", blocks: [{ id: "p3", type: "product", ref: "p3" }] },
        ],
      },
      {
        id: "usp",
        type: "section",
        gap: 8,
        padX: 0,
        background: "#ffd400",
        padTop: 12,
        padBottom: 12,
        columns: [
          { id: "u1", blocks: [{ id: "ui1", type: "image", src: "https://cdn.example.com/i1.png", alt: "Versand", width: 40 }, { id: "ut1", type: "text", text: "Gratis Versand", size: "s", align: "center", color: "#111111" }] },
          { id: "u2", blocks: [{ id: "ui2", type: "image", src: "https://cdn.example.com/i2.png", alt: "Rückgabe", width: 40, align: "left" }, { id: "ut2", type: "text", text: "30 Tage Rückgabe", size: "s", align: "center", color: "#111111" }] },
          { id: "u3", blocks: [{ id: "cpn", type: "coupon", code: "BLACKWEEK25", headline: "25 %", terms: "Nur {{vorname|du}}", background: "#ffffff" }] },
          { id: "u4", blocks: [{ id: "ui4", type: "image", src: "", alt: "Leer", width: "content", align: "right" }, { id: "p4", type: "product", ref: "p4" }] },
        ],
      },
      { id: "ps", type: "product", ref: "rack", layout: "side", showDescription: true, buttonLabel: "Ansehen, {{vorname|du}}", align: "left", color: "#ffffff", nameSize: 22, background: "#202020", padTop: 20, padBottom: 20 },
      { id: "cp", type: "coupon", code: "BLACKWEEK25", headline: "25 % auf alles", terms: "Nur für dich, {{vorname|du}} · bis 30.11.", accent: "#ff3366", background: "#ffffff", padTop: 30 },
      { id: "im2", type: "image", src: "https://cdn.example.com/banner.gif", alt: "Banner", width: 240, align: "right", radius: 12, padTop: 4, padBottom: 4 },
      { id: "im3", type: "image", src: "https://cdn.example.com/full.jpg", alt: "Full", href: "https://motionsports.de", width: "full", background: "#000000", padBottom: 12 },
      { id: "t3", type: "text", text: "- Erstens\n- Zweitens\n- Drittens", background: "#202020", bullet: "1.", lineHeight: 180, letterSpacing: 1, uppercase: true, font: "georgia" },
      { id: "t4", type: "text", text: "- Pfeil\n- Liste", size: "s", bullet: "→" },
      { id: "t5", type: "text", text: "- Strich", size: "s", bullet: "–", padTop: 0 },
      { id: "t6", type: "text", text: "- Stern\n- [Link](https://motionsports.de/pages/faq)", size: "s", bullet: "★", padBottom: 0 },
      { id: "gr", type: "greeting", text: "Hallo {{vorname}},", fallback: "Hallo,", color: "#ffd400", fontSize: 18, weight: "bold", background: "#1a1a1a" },
      { id: "b3", type: "button", label: "Rahmen", href: "https://motionsports.de", color: "#ffd400", textColor: "#111111", fullWidth: true, borderColor: "#ffffff", shape: "square", background: "#000000", padTop: 20 },
      { id: "dv", type: "divider", color: "#ffd400", thickness: 3, widthPct: 40, lineStyle: "dashed", align: "left" },
      { id: "dv2", type: "divider", color: "#555555", widthPct: 50, lineStyle: "dotted" },
      { id: "sp", type: "spacer", height: 32, background: "#0a0a0a" },
      { id: "so", type: "social", align: "right", padTop: 4, background: "#111111" },
      { id: "mn2", type: "menu", separator: "none", uppercase: false, bold: false, items: [{ label: "Impressum", href: "https://motionsports.de/pages/impressum" }, { label: "FAQ", href: "https://motionsports.de/pages/faq" }] },
      { id: "lg2", type: "logo", align: "right", width: 100, padTop: 10, padBottom: 10, background: "#ffffff" },
      { id: "hx", type: "html", html: "<p style='color:#ffffff'>Eigenes <a href='https://motionsports.de/pages/faq'>HTML</a></p>", padTop: 8, padBottom: 8, background: "#000000" },
      { id: "ft", type: "footer", showSocial: true, background: "#000000", textColor: "#cccccc" },
    ],
  };
}
const SHOWCASE_SLOTS = {
  p1: slot(product(1, { compareAtLabel: "499,00 €" })),
  p2: slot(product(2)),
  ps: slot(product(9, { compareAtLabel: "999,00 €" })),
};

test("showcase: every version-2 feature renders Outlook-safe and under the size budget", () => {
  for (const previewPlaceholders of [false, true]) {
    const html = renderMailTemplateHtml(showcase(), ctx({ slots: SHOWCASE_SLOTS, previewPlaceholders }));
    assert.deepEqual(strictLint(html), [], `preview=${previewPlaceholders}`);
    assert.ok(bytes(html) < MAIL_SIZE_BUDGET_BYTES, `${bytes(html)} bytes`);
  }
});

test("showcase: the columns stack (col-stack / col-gap), reverse and the background picture with its VML twin", () => {
  const html = renderMailTemplateHtml(showcase(), ctx({ slots: SHOWCASE_SLOTS }));
  assert.ok((html.match(/class="col-stack"/g) ?? []).length >= 8);
  assert.ok((html.match(/class="col-gap"/g) ?? []).length >= 4);
  assert.match(html, /class="col-img"/);
  // background picture: attribute, CSS and the Word rectangle
  assert.match(html, /background="https:\/\/cdn\.example\.com\/hero\.jpg"/);
  assert.match(html, /background-image: url\('https:\/\/cdn\.example\.com\/hero\.jpg'\); background-size: cover; background-position: center;/);
  assert.match(html, /<!--\[if gte mso 9\]><v:rect xmlns:v="urn:schemas-microsoft-com:vml" fill="true" stroke="false" style="width:600px;height:320px;">/);
  assert.match(html, /<v:fill type="frame" src="https:\/\/cdn\.example\.com\/hero\.jpg" color="#222222" size="1,1" aspect="atleast" origin="0\.5,0\.5" position="0\.5,0\.5" \/>/);
  assert.match(html, /<v:textbox style="mso-fit-shape-to-text:true" inset="0,0,0,0">/);
  assert.match(html, /<\/v:textbox><\/v:rect><!\[endif\]-->/);
  // reverse: right-to-left table, left-to-right cells
  assert.match(html, /role="presentation" dir="rtl" bgcolor="#1f1f1f" style="direction: rtl; border-collapse: separate !important; border-spacing: 0; border: 1px solid #333333; border-radius: 12px; overflow: hidden; background-color: #1f1f1f;">/);
  assert.match(html, /dir="ltr"/);
});

test("showcase: {{vorname}} is merged in menu labels, product buttons and coupon terms", () => {
  const html = renderMailTemplateHtml(showcase(), ctx({ slots: SHOWCASE_SLOTS }));
  assert.match(html, />Hallo&nbsp;Anna<\/a>/);
  assert.match(html, /Für Anna/);
  assert.match(html, /Ansehen, Anna/);
  assert.match(html, /Nur für dich, Anna · bis 30\.11\./);
  assert.match(html, /Nur Anna/);
  assert.match(html, /Hallo Anna,/);
  assert.doesNotMatch(html, /\{\{/);
});

test("showcase: the footer marker stands once, after every content block and right before the footer", () => {
  const html = renderMailTemplateHtml(showcase(), ctx({ slots: SHOWCASE_SLOTS }));
  assert.equal(html.split(MAIL_FOOTER_MARKER).length, 2);
  const at = html.indexOf(MAIL_FOOTER_MARKER);
  assert.ok(html.lastIndexOf("Eigenes") < at, "content after the marker");
  assert.ok(at < html.indexOf("4motionsports GmbH"));
  assert.match(html.slice(at), /^<!-- mo:footer -->\s*<tr>\s*<td height="20" bgcolor="#161616"/);
  assert.match(html.slice(at), /bgcolor="#000000" style="mso-line-height-rule: exactly; padding: 24px 32px;"/);
  assert.match(html.slice(at), /Abmelden/);
});

test("showcase: the text part follows the reading order — sections column by column, the original order when reversed", () => {
  const text = renderMailTemplateText(showcase(), ctx({ slots: SHOWCASE_SLOTS }));
  const order = [
    "Kraft: https://motionsports.de/collections/kraft",
    "Hallo Anna: https://motionsports.de/account",
    "Black Week",
    "Jetzt sparen: https://motionsports.de/collections/black-week",
    "Rack: https://motionsports.de/products/rack",
    "Dein Rack",
    "Produkt 1 — 399,00 €\nhttps://motionsports.de/products/p1",
    "Produkt 2 — 399,00 €",
    "Gratis Versand",
    "Nur Anna",
    "Produkt 9 — 399,00 €",
    "Nur für dich, Anna · bis 30.11.",
    "Full: https://motionsports.de/",
    "- Erstens",
    "Hallo Anna,",
    "Rahmen: https://motionsports.de/",
    "Impressum: https://motionsports.de/pages/impressum\nFAQ: https://motionsports.de/pages/faq",
    "Eigenes HTML",
    "\n\n—\n\n", // the legal footer
  ];
  let last = -1;
  for (const s of order) {
    const i = text.indexOf(s);
    assert.ok(i > last, `"${s}" out of order (${i} after ${last})`);
    last = i;
  }
  assert.doesNotMatch(text, /Produkt 3|Produkt 4/); // no data: not in the mail
  assert.doesNotMatch(text, /<[a-z]/i);
});

test("every starter in a version-2 style (dark card, radius, web fonts, narrow padding) stays lint-clean", () => {
  const style = { cardBackground: "#111111", textColor: "#ffffff", headingColor: "#ffd400", cardRadius: 12, contentPadding: 24, fontFamily: "lato", headingFont: "playfair" };
  for (const s of MAIL_TEMPLATE_STARTERS) {
    const d = s.build();
    for (const previewPlaceholders of [true, false]) {
      const html = renderMailTemplateHtml({ ...d, style: { ...d.style, ...style } }, ctx({ previewPlaceholders }));
      assert.deepEqual(strictLint(html), [], s.key);
    }
  }
});

test("every child block type in every column of a narrow 4-column section stays lint-clean", () => {
  const kids = (i) => [
    { type: "logo", width: 300 },
    { type: "heading", text: `Titel ${i}`, background: "#eeeeee" },
    { type: "text", text: "- a\n- b", bullet: "1." },
    { type: "image", src: "https://x.de/a.jpg", alt: "a", width: 600 },
    { type: "image", src: "https://x.de/b.jpg", alt: "b", width: "content", background: "#eeeeee" },
    { type: "button", label: "Los", href: "https://motionsports.de", fullWidth: true, size: "l" },
    { type: "coupon", code: "SEHRLANGERCODE2026", headline: "x" },
    { type: "divider", widthPct: 50 },
    { type: "spacer", height: 4 },
    { type: "social" },
    { type: "html", html: '<img src="https://x.de/c.png" width="40" alt="">' },
    { type: "greeting", text: "Hi {{vorname}}", fallback: "Hi" },
  ];
  const doc = docOf([
    { type: "section", gap: 48, columns: [0, 1, 2, 3].map((i) => ({ blocks: kids(i), padding: 12 })) },
    { type: "section", columns: [{ blocks: [{ type: "menu", items: [{ label: "A", href: "https://a.de" }] }, { type: "product", ref: "x" }] }] },
  ]);
  for (const previewPlaceholders of [true, false]) {
    const html = renderMailTemplateHtml(doc, ctx({ previewPlaceholders, slots: {} }));
    assert.deepEqual(strictLint(html), []);
    const { widths } = sectionColumnWidths(normalizeMailTemplateDoc(doc).blocks[0], 60);
    for (const tag of imgs(body(html))) {
      const w = Number(/width="(\d+)"/.exec(tag)?.[1]);
      assert.ok(w <= Math.max(...widths), tag);
    }
  }
});

// ── sections ─────────────────────────────────────────────────────────────────

test("sectionColumnWidths: card minus side padding, border and gaps, shared by the percentages", () => {
  assert.deepEqual(sectionColumnWidths({ columns: [{ width: 50 }, { width: 50 }], padX: null, gap: 20 }, 60), { padX: 60, inner: 480, gap: 20, widths: [230, 230] });
  assert.deepEqual(sectionColumnWidths({ columns: [{ width: 100 }], padX: 0, gap: 20 }), { padX: 0, inner: 600, gap: 0, widths: [600] });
  const three = sectionColumnWidths({ columns: [{ width: 33 }, { width: 34 }, { width: 33 }], padX: 30, gap: 16, borderColor: "#000000" });
  assert.equal(three.inner, 538);
  assert.equal(three.widths.reduce((a, b) => a + b, 0) + 2 * three.gap, three.inner);
  assert.deepEqual(three.widths, [167, 172, 167]);
  // the last column takes the rounding remainder
  const odd = sectionColumnWidths({ columns: [{ width: 33 }, { width: 33 }, { width: 34 }], padX: 0, gap: 0 });
  assert.equal(odd.widths.reduce((a, b) => a + b, 0), 600);
  // a gap never eats the columns
  assert.ok(sectionColumnWidths({ columns: [{ width: 25 }, { width: 25 }, { width: 25 }, { width: 25 }], padX: 60, gap: 48 }).widths.every((w) => w > 50));
});

test("section: outer cell with the section colour and side padding (content-pad only with padding)", () => {
  const doc = docOf([
    { type: "section", background: "#ffd400", padTop: 10, padBottom: 30, columns: [{ blocks: [{ type: "text", text: "A" }] }] },
    { type: "section", padX: 0, columns: [{ blocks: [{ type: "text", text: "B" }] }] },
  ]);
  const html = renderMailTemplateHtml(doc, ctx());
  assert.match(html, /<td class="content-pad" align="left" valign="top" bgcolor="#ffd400" style="mso-line-height-rule: exactly; padding: 10px 60px 30px; background-color: #ffd400;">/);
  assert.match(html, /<td align="left" valign="top" bgcolor="#ffffff" style="mso-line-height-rule: exactly; padding: 24px 0; background-color: #ffffff;">/);
  assert.match(html, /<td class="col-stack" width="480" valign="top" style="mso-line-height-rule: exactly; width: 480px; padding: 0;">/);
  assert.deepEqual(lint(html), []);
});

test("section: reverse lays the cells out right to left in reversed DOM order (phones stack the last column first)", () => {
  const doc = docOf([
    { type: "section", reverse: true, columns: [{ width: 40, blocks: [{ type: "text", text: "LINKS" }] }, { width: 60, blocks: [{ type: "text", text: "RECHTS" }] }] },
  ]);
  const html = renderMailTemplateHtml(doc, ctx());
  assert.ok(html.indexOf("RECHTS") < html.indexOf("LINKS"), "DOM order reversed");
  assert.match(html, /<table cellspacing="0" cellpadding="0" border="0" width="100%" role="presentation" dir="rtl" style="direction: rtl;">/);
  assert.equal((html.match(/<td class="col-stack" width="\d+" valign="top" dir="ltr" style="[^"]*direction: ltr;">/g) ?? []).length, 2);
  assert.match(html, /width="276"[^>]*>[\s\S]*RECHTS[\s\S]*class="col-gap" width="20"[\s\S]*width="184"[^>]*>[\s\S]*LINKS/);
  // the text part keeps the reading order
  const text = renderMailTemplateText(doc, ctx());
  assert.ok(text.indexOf("LINKS") < text.indexOf("RECHTS"));
});

test("section: stack:false keeps the columns side by side — whole percentages, no stacking classes", () => {
  const doc = docOf([
    { type: "section", stack: false, gap: 12, columns: [{ width: 30, blocks: [{ type: "logo" }] }, { width: 70, blocks: [{ type: "menu", items: [{ label: "A", href: "https://a.de" }] }] }] },
  ]);
  const html = renderMailTemplateHtml(doc, ctx());
  assert.doesNotMatch(body(html), /col-stack|col-gap/);
  const cells = [...body(html).matchAll(/<td width="(\d+)%"/g)].map((m) => Number(m[1]));
  assert.equal(cells.length, 3); // two columns and the gap
  assert.equal(cells.reduce((a, b) => a + b, 0), 100);
  assert.match(html, /<td width="\d+%" style="mso-line-height-rule: exactly; width: \d+%; font-size: 0; line-height: 0;">&nbsp;<\/td>/);
  assert.deepEqual(lint(html), []);
});

test("section: rounded corners or a border make a box — its colour inside the frame, the card colour around it", () => {
  const doc = docOf([{ type: "section", radius: 10, background: "#f2f2f2", columns: [{ blocks: [{ type: "text", text: "Box" }] }] }]);
  const html = renderMailTemplateHtml(doc, ctx());
  assert.match(html, /bgcolor="#ffffff" style="mso-line-height-rule: exactly; padding: 24px 60px; background-color: #ffffff;">/);
  assert.match(html, /role="presentation" bgcolor="#f2f2f2" style="direction: ltr; border-collapse: separate !important; border-spacing: 0; border-radius: 10px; overflow: hidden; background-color: #f2f2f2;">/);
});

test("section: a background picture — fallback colour, Outlook rectangle, minimum height without the padding", () => {
  const doc = docOf([
    { type: "section", background: "#101010", bgImage: "https://x.de/bg (1).jpg", minHeight: 300, padTop: 40, padBottom: 60, columns: [{ valign: "bottom", blocks: [{ type: "heading", text: "Über dem Bild" }] }] },
  ]);
  const html = renderMailTemplateHtml(doc, ctx());
  assert.match(html, /<td align="left" valign="top" bgcolor="#101010" background="https:\/\/x\.de\/bg%20\(1\)\.jpg" style="mso-line-height-rule: exactly; padding: 0; background-color: #101010; background-image: url\('https:\/\/x\.de\/bg%20%281%29\.jpg'\);/);
  assert.match(html, /<td height="300" valign="bottom" style="height:300px;"><!\[endif\]-->/);
  assert.match(html, /<td class="content-pad" valign="bottom" height="200" style="mso-line-height-rule: exactly; padding: 40px 60px 60px; height: 200px;">/);
  assert.doesNotMatch(body(html), /<tr>\s*<td class="content-pad" align="center" bgcolor=/); // the rows inside stay transparent
  assert.deepEqual(lint(html), []);
  // without a minimum height the rectangle grows with its content
  const free = renderMailTemplateHtml(docOf([{ type: "section", bgImage: "https://x.de/bg.jpg", columns: [{ blocks: [{ type: "text", text: "x" }] }] }]), ctx());
  assert.match(free, /style="width:600px;"><v:fill type="frame" src="https:\/\/x\.de\/bg\.jpg" color="#ffffff"/);
  assert.match(free, /<tr><td valign="top"><!\[endif\]-->/);
});

test("section: a background picture in a box — the picture carries the frame, nothing opaque lies over it", () => {
  const content = [
    { type: "heading", text: "Über dem Bild", color: "#ffffff" },
    { type: "text", text: "Zwei Sätze Text über dem Bild.", color: "#ffffff" },
    { type: "button", label: "Jetzt ansehen", href: "https://motionsports.de/" },
  ];
  for (const frame of [{ radius: 16 }, { borderColor: "#444444" }, { radius: 12, borderColor: "#444444", minHeight: 300, reverse: true }]) {
    const where = JSON.stringify(frame);
    const doc = docOf([{ type: "section", background: "#222222", bgImage: "https://cdn.example.com/hero.jpg", ...frame, columns: [{ valign: "middle", blocks: content }] }]);
    const html = renderMailTemplateHtml(doc, ctx());
    assert.deepEqual(lint(html), [], where);
    // the picture cell: fallback colour, background attribute, CSS cover; minHeight is the picture's height
    const cell = /<td align="left" valign="(\w+)" bgcolor="#222222" background="https:\/\/cdn\.example\.com\/hero\.jpg"( height="300")? style="mso-line-height-rule: exactly; padding: 0;( height: 300px;)? background-color: #222222; background-image: url\('https:\/\/cdn\.example\.com\/hero\.jpg'\); background-size: cover; background-position: center; background-repeat: no-repeat;( border-radius: (\d+)px;)?">/.exec(html);
    assert.ok(cell, where);
    assert.equal(Boolean(cell[2]), Boolean(frame.minHeight), where);
    assert.equal(cell[1], frame.minHeight ? "middle" : "top", where);
    if (frame.radius) assert.equal(Number(cell[5]), frame.radius - (frame.borderColor ? 1 : 0), where);
    // nothing between the picture and the content paints a colour
    const over = html.slice(cell.index + cell[0].length, html.indexOf("Über dem Bild"));
    assert.doesNotMatch(over, /bgcolor=|background-color:/, where);
    // the frame: border and rounded corners on the table around the picture cell
    const before = html.slice(0, cell.index);
    const frameTable = before.slice(before.lastIndexOf("<table"));
    assert.match(frameTable, /^<table cellspacing="0" cellpadding="0" border="0" width="100%" role="presentation" style="direction: ltr; border-collapse: separate !important; border-spacing: 0;/, where);
    if (frame.radius) assert.match(frameTable, new RegExp(`border-radius: ${frame.radius}px; overflow: hidden;">`), where);
    if (frame.borderColor) assert.match(frameTable, /border: 1px solid #444444;/, where);
    assert.doesNotMatch(frameTable, /bgcolor=|background-color:/, where);
    // around the box: the card colour and the section's padding
    assert.match(html, /<td class="content-pad" align="left" valign="top" bgcolor="#ffffff" style="mso-line-height-rule: exactly; padding: 24px 60px; background-color: #ffffff;">\s*<table [^>]*border-collapse: separate/, where);
    // Outlook: the rectangle inside the picture cell, as wide as the inside of the box
    const inner = frame.borderColor ? 478 : 480;
    assert.match(over, new RegExp(`^\\s*<!--\\[if gte mso 9\\]><v:rect xmlns:v="urn:schemas-microsoft-com:vml" fill="true" stroke="false" style="width:${inner}px;${frame.minHeight ? "height:300px;" : ""}"><v:fill type="frame" src="https://cdn\\.example\\.com/hero\\.jpg" color="#222222"`), where);
    assert.match(over, frame.reverse ? /role="presentation" dir="rtl" style="direction: rtl;">/ : /role="presentation" style="direction: ltr;">\s*<tr>/, where);
  }
});

test("section: columns — own colour, padding on a cell inside (the column keeps its exact width), empty columns keep their cell", () => {
  const doc = docOf([
    { type: "section", columns: [{ background: "#eeeeee", padding: 20, valign: "middle", blocks: [{ type: "image", src: "https://x.de/a.jpg", alt: "a", width: "full" }] }, { blocks: [] }] },
  ]);
  const html = renderMailTemplateHtml(doc, ctx());
  assert.match(
    html,
    /<td class="col-stack" width="230" valign="middle" bgcolor="#eeeeee" style="mso-line-height-rule: exactly; width: 230px; padding: 0; background-color: #eeeeee;">\s*<table [^>]*width="100%"[^>]*>\s*<tr>\s*<td style="mso-line-height-rule: exactly; padding: 20px;">/
  );
  assert.match(html, /<img src="https:\/\/x\.de\/a\.jpg" width="190"/); // 230 − 2 × 20
  assert.doesNotMatch(body(html), /class="col-stack"[^>]*padding: (?!0;)/);
  assert.match(html, /<td height="1" style="mso-line-height-rule: exactly; font-size: 0; line-height: 1px;">&nbsp;<\/td>/);
  assert.deepEqual(lint(html), []);
});

test("inside a column: no phone padding class, no row colour of its own, the outer spacing collapses at the edges", () => {
  const doc = docOf([
    {
      type: "section",
      columns: [
        {
          blocks: [
            { type: "heading", text: "Oben" },
            { type: "text", text: "Mitte" },
            { type: "text", text: "Eigener Abstand", padTop: 7 },
            { type: "button", label: "Unten", href: "https://motionsports.de" },
          ],
        },
      ],
    },
  ]);
  const inner = body(renderMailTemplateHtml(doc, ctx()));
  const section = inner.slice(inner.indexOf('class="col-stack"'));
  assert.doesNotMatch(section, /content-pad/);
  assert.match(section, /<td align="center" style="mso-line-height-rule: exactly; padding: 0 0 8px;" valign="top">\s*<p [^>]*>Oben/);
  assert.match(section, /<td align="left" style="mso-line-height-rule: exactly; padding: 10px 0;" valign="top">\s*<p [^>]*>Mitte/);
  assert.match(section, /padding: 7px 0 10px;" valign="top">\s*<p [^>]*>Eigener Abstand/);
  // (the pill button: its VML twin for Outlook, then the cell pattern)
  assert.match(section, /<td align="center" style="mso-line-height-rule: exactly; padding: 12px 0 0;" valign="top">\s*<!--\[if mso\]><v:roundrect [^>]*><w:anchorlock\/><center [^>]*>Unten<\/center><\/v:roundrect><!\[endif\]--><!--\[if !mso\]><!-->\s*<table[^>]*>\s*<tr>\s*<td align="center" bgcolor="#008ccb"/);
  // a block with its own colour keeps its spacing (inside the colour) and gets side room
  const band = body(renderMailTemplateHtml(docOf([{ type: "section", columns: [{ blocks: [{ type: "heading", text: "Band", background: "#111111", color: "#ffffff" }] }] }]), ctx()));
  assert.match(band, /<td align="center" bgcolor="#111111" style="mso-line-height-rule: exactly; padding: 26px 16px;" valign="top">/);
});

test("images in columns: width attribute = their px width, never wider than the column; column-wide ones fill the stacked column", () => {
  const doc = docOf([
    {
      type: "section",
      gap: 20,
      columns: [
        { width: 50, blocks: [{ type: "image", src: "https://x.de/full.jpg", alt: "f", width: "full" }, { type: "image", src: "https://x.de/px.jpg", alt: "p", width: 120, align: "left", radius: 6 }] },
        { width: 50, padding: 10, blocks: [{ type: "image", src: "https://x.de/big.jpg", alt: "b", width: 500 }, { type: "image", src: "https://x.de/content.jpg", alt: "c", width: "content" }] },
      ],
    },
  ]);
  const html = renderMailTemplateHtml(doc, ctx());
  const tag = (name) => imgs(html).find((t) => t.includes(name)) ?? "";
  assert.match(tag("full.jpg"), /width="230" alt="f" border="0" class="col-img" style="width: 100%; max-width: 230px; height: auto; display: block; Margin: 0 auto;"/);
  assert.match(tag("px.jpg"), /width="120" alt="p" border="0" style="width: 100%; max-width: 120px; height: auto; display: block; Margin: 0; border-radius: 6px;"/);
  assert.match(tag("big.jpg"), /width="210" [^>]*class="col-img"/);
  assert.match(tag("content.jpg"), /width="210" [^>]*class="col-img"/);
  assert.deepEqual(lint(html), []);
});

// ── blocks: type, spacing, colours ───────────────────────────────────────────

test("text styles: size, weight, italic, uppercase, letter spacing, line height and font — only when set", () => {
  const doc = docOf(
    [
      { type: "heading", text: "Groß", fontSize: 40, weight: "normal", italic: true, uppercase: true, letterSpacing: 3, lineHeight: 120, font: "bebas" },
      { type: "heading", text: "Standard" },
      { type: "text", text: "Fließtext", fontSize: 18, weight: "bold", lineHeight: 200, letterSpacing: -1, font: "georgia" },
      { type: "greeting", text: "Hallo {{vorname}}", fallback: "Hallo", color: "#aa0000", fontSize: 20, italic: true },
    ],
    { headingFont: "playfair", fontFamily: "arial" }
  );
  const html = renderMailTemplateHtml(doc, ctx());
  assert.match(html, /font-family: 'Bebas Neue', Impact, 'Arial Narrow', Arial, sans-serif; font-size: 40px; line-height: 48px; font-weight: 400; font-style: italic; text-transform: uppercase; letter-spacing: 3px; color: #111111; Margin: 0;" align="center">Groß</);
  // the heading font of the style, the version-1 declarations
  assert.match(html, /style="mso-line-height-rule: exactly; direction: ltr; font-family: 'Playfair Display', Georgia, 'Times New Roman', serif; font-size: 26px; line-height: 33px; font-weight: 700; color: #111111; Margin: 0;" align="center">Standard</);
  assert.match(html, /font-family: Georgia, 'Times New Roman', serif; font-size: 18px; line-height: 36px; font-weight: 700; letter-spacing: -1px; color: #111111; Margin: 0;" align="left">Fließtext/);
  assert.match(html, /font-family: Arial, Helvetica, sans-serif; font-size: 20px; line-height: 1\.5; mso-line-height-alt: 30px; font-weight: 400; font-style: italic; color: #aa0000; Margin: 0;" align="left">Hallo Anna/);
  // Outlook: each own font as Word's Windows equivalent (a class after the body's `*` rule)
  assert.match(html, /<p class="mso-font-bebas" style="direction: ltr; font-family: 'Bebas Neue'/, "120 % is tighter than the font: a minimum for Word, no exact rule");
  assert.match(html, /<p class="mso-font-playfair" style="mso-line-height-rule: exactly; direction: ltr; font-family: 'Playfair Display'/);
  assert.match(html, /<p class="mso-font-georgia" style="mso-line-height-rule: exactly; [^"]*" align="left">Fließtext/);
  assert.doesNotMatch(html, /<p class="[^"]*" [^>]*>Hallo Anna/, "the body font needs no class");
  assert.match(html, /\* \{ font-family: Arial, Helvetica, sans-serif !important; \}\n {6}\.mso-font-bebas \{ font-family: Impact, 'Arial Narrow', Arial, sans-serif !important; \}\n {6}\.mso-font-playfair \{ font-family: Georgia, 'Times New Roman', serif !important; \}\n {6}\.mso-font-georgia \{ font-family: Georgia, 'Times New Roman', serif !important; \}/);
  assert.deepEqual(lintOutlookHtml(html, { maxImageWidth: MAIL_CARD_WIDTH, strict: true }), []);
});

test("spacing: padTop / padBottom replace the default vertical spacing, the side padding follows the style", () => {
  const doc = docOf(
    [
      { type: "text", text: "A", padTop: 0, padBottom: 40 },
      { type: "heading", text: "B", padBottom: 0 },
      { type: "image", src: "https://x.de/a.jpg", alt: "a", width: "content", padTop: 5 },
      { type: "logo", padTop: 0 },
    ],
    { contentPadding: 40 }
  );
  const html = renderMailTemplateHtml(doc, ctx());
  assert.match(html, /padding: 0 40px 40px;" valign="top">\s*<p [^>]*>A</);
  assert.match(html, /padding: 24px 40px 0;" valign="top">\s*<p [^>]*>B</);
  assert.match(html, /padding: 5px 40px 10px;" valign="top">\s*<img src="https:\/\/x\.de\/a\.jpg" width="520"/);
  assert.match(html, /padding: 0 40px 20px;">\s*<a href="https:\/\/www\.motionsports\.de"/);
  assert.match(html, /padding: 24px 40px;">\s*<table border="0" width="100%"/); // footer
});

test("block backgrounds: the row takes the colour, the card colour elsewhere", () => {
  const doc = docOf(
    [
      { type: "button", label: "Los", href: "https://a.de", background: "#ff0000" },
      { type: "divider", background: "#00ff00" },
      { type: "social", background: "#0000ff" },
      { type: "spacer", height: 4, background: "#123456" },
      { type: "spacer", height: 200 },
      { type: "html", html: "<p>x</p>", background: "#abcdef" },
    ],
    { cardBackground: "#fafafa" }
  );
  const html = renderMailTemplateHtml(doc, ctx());
  assert.match(html, /bgcolor="#ff0000" style="mso-line-height-rule: exactly; padding: 12px 60px;"/);
  assert.match(html, /bgcolor="#00ff00" style="mso-line-height-rule: exactly; padding: 14px 60px;"/);
  assert.match(html, /bgcolor="#0000ff" style="mso-line-height-rule: exactly; padding: 14px 60px;"/);
  assert.match(html, /<td height="4" bgcolor="#123456" style="mso-line-height-rule: exactly; font-size: 0; line-height: 4px;">/);
  assert.match(html, /<td height="200" bgcolor="#fafafa"/);
  assert.match(html, /<td align="center" bgcolor="#abcdef" style="mso-line-height-rule: exactly; padding: 0;" valign="top">/);
});

test("text: bullets ✓ → – ★ and numbered lists, the accent bar as a cell border", () => {
  const glyph = (bullet) => renderMailTemplateHtml(docOf([{ type: "text", text: "- a\n- b", bullet }]), ctx());
  assert.match(glyph("✓"), />&#10003;<\/td>/);
  assert.match(glyph("→"), />&#8594;<\/td>/);
  assert.match(glyph("–"), />&#8211;<\/td>/);
  assert.match(glyph("★"), />&#9733;<\/td>/);
  const numbered = glyph("1.");
  assert.match(numbered, /<td valign="top" width="22" [^>]*>1\.<\/td>[\s\S]*>2\.<\/td>/);
  assert.doesNotMatch(numbered, /&#8226;/);
  const bar = renderMailTemplateHtml(docOf([{ type: "text", text: "Zitat", accentBar: "#ff3366" }]), ctx());
  assert.match(bar, /<td valign="top" style="mso-line-height-rule: exactly; border-left: 4px solid #ff3366; padding: 2px 0 2px 16px;">\s*<p [^>]*>Zitat<\/p>/);
  assert.deepEqual(lint(bar), []);
});

test("links in text take the link colour of the style (else the accent colour)", () => {
  const doc = (style) => docOf([{ type: "text", text: "[Shop](https://motionsports.de)" }], style);
  assert.match(renderMailTemplateHtml(doc({ linkColor: "#0055aa" }), ctx()), /<a href="https:\/\/motionsports\.de" target="_blank" style="color: #0055aa; text-decoration: underline;/);
  assert.match(renderMailTemplateHtml(doc({ accentColor: "#ff0000" }), ctx()), /style="color: #ff0000; text-decoration: underline;/);
});

test("images at the top level: content width follows the side padding, px widths align, rounded corners", () => {
  const doc = docOf(
    [
      { type: "image", src: "https://x.de/c.jpg", alt: "c", width: "content" },
      { type: "image", src: "https://x.de/r.jpg", alt: "r", width: 200, align: "right", radius: 10 },
      { type: "image", src: "https://x.de/l.jpg", alt: "l", width: 560, align: "left" },
      { type: "image", src: "https://x.de/f.jpg", alt: "f", width: 600 },
    ],
    { contentPadding: 30 }
  );
  const html = renderMailTemplateHtml(doc, ctx());
  const tag = (name) => imgs(html).find((t) => t.includes(name)) ?? "";
  assert.match(tag("c.jpg"), /width="540"/);
  assert.match(tag("r.jpg"), /width="200" alt="r" border="0" style="width: 100%; max-width: 200px; height: auto; display: block; Margin: 0 0 0 auto; border-radius: 10px;"/);
  assert.match(html, /<td class="content-pad" align="right" bgcolor="#ffffff" style="mso-line-height-rule: exactly; padding: 10px 30px;" valign="top">\s*<img src="https:\/\/x\.de\/r\.jpg"/);
  assert.match(tag("l.jpg"), /width="540"[^>]*Margin: 0;"/); // never wider than the content area
  assert.match(tag("f.jpg"), /width="600"/); // as wide as the card = full width
  assert.match(html, /<td align="center" bgcolor="#ffffff" style="mso-line-height-rule: exactly; padding: 0;" valign="top">\s*<img src="https:\/\/x\.de\/f\.jpg"/);
  assert.ok(!imgs(html).some((t) => t.includes("col-img")), "no phone class at the top level");
});

test("buttons: sizes, shapes, outline and border keep the Outlook-safe cell pattern", () => {
  const button = (extra) => renderMailTemplateHtml(docOf([{ type: "button", label: "Los", href: "https://motionsports.de", ...extra }]), ctx());
  const small = button({ size: "s" });
  assert.match(small, /mso-padding-alt: 12px 22px 12px 22px;/);
  assert.match(small, /style="font-size: 13px; line-height: 17px; [^"]*padding: 10px 20px; border: 2px solid #008ccb; mso-padding-alt: 0;"/);
  const large = button({ size: "l", shape: "square" });
  assert.match(large, /mso-padding-alt: 20px 38px 20px 38px; border-radius: 0;/);
  assert.match(large, /font-size: 16px; line-height: 20px;[^"]*padding: 18px 36px;/);
  assert.match(button({ shape: "rounded" }), /border-radius: 8px;/);
  const outline = button({ outline: true, color: "#111111" });
  assert.match(outline, /border-collapse: separate !important;/);
  assert.match(outline, /<td align="center" style="mso-line-height-rule: exactly; mso-padding-alt: 14px 28px 14px 28px; border: 2px solid #111111; border-radius: 200px;" valign="top">/);
  assert.match(outline, /<a href="https:\/\/motionsports\.de\/" target="_blank" style="font-size: 14px; line-height: 18px; color: #111111; text-decoration: none; border-radius: 200px; display: block;/);
  assert.doesNotMatch(outline, /bgcolor="#111111"/);
  const bordered = button({ borderColor: "#000000", color: "#ffd400", textColor: "#111111" });
  assert.match(bordered, /<td align="center" bgcolor="#ffd400" style="mso-line-height-rule: exactly; mso-padding-alt: 14px 28px 14px 28px; border: 2px solid #000000; border-radius: 200px; background-color: #ffd400;" valign="top">/);
  for (const html of [small, large, outline, bordered]) assert.deepEqual(lint(html), []);
});

test("dividers: thickness, line style, shorter lines aligned by cells (no floating table)", () => {
  const divider = (extra) => body(renderMailTemplateHtml(docOf([{ type: "divider", color: "#333333", ...extra }]), ctx()));
  // the line is the top border of the cell — Word draws cell borders (a version-1 document keeps its table border)
  assert.match(divider({ thickness: 4, lineStyle: "dotted" }), /width="100%" role="presentation" style="border-spacing: 0 !important; border-collapse: collapse !important;"><tr><td style="border-top: 4px dotted #333333; font-size: 0; line-height: 0; mso-line-height-rule: exactly; mso-line-height-alt: 1px;">&nbsp;<\/td><\/tr><\/table>/);
  assert.match(body(renderMailTemplateHtml({ ...docOf([{ type: "divider", color: "#333333" }]), v: 1 }, ctx())), /role="presentation" style="border-top: 1px solid #333333; border-spacing: 0 !important;/);
  assert.match(divider({ widthPct: 40 }), /<tr><td width="30%" [^>]*>&nbsp;<\/td><td width="40%" style="border-top: 1px solid #333333; [^"]*">&nbsp;<\/td><td width="30%"/);
  assert.match(divider({ widthPct: 30, align: "left", lineStyle: "dashed" }), /<tr><td width="30%" style="border-top: 1px dashed #333333; [^"]*">&nbsp;<\/td><td width="70%"/);
  assert.match(divider({ widthPct: 25, align: "right" }), /<tr><td width="75%" [^>]*>&nbsp;<\/td><td width="25%" style="border-top/);
  assert.doesNotMatch(divider({ widthPct: 25, align: "right" }), /<table[^>]*align="(left|right)"/);
});

test("coupon: accent colour for frame and headline, the separate border model for its radius, terms merged", () => {
  const html = renderMailTemplateHtml(docOf([{ type: "coupon", code: "SOMMER10", headline: "10 %", terms: "Für {{vorname|dich}}", accent: "#ff3366" }]), ctx());
  assert.match(html, /style="direction: ltr; Margin: 0 auto; border-collapse: separate !important; border-spacing: 0; border: 2px dashed #ff3366; border-radius: 8px;"/);
  assert.match(html, /color: #ff3366; Margin: 0; font-weight: 700;" align="center">10 %<\/p>/);
  assert.match(html, />Für Anna<\/p>/);
  assert.match(html, /href="https:\/\/motionsports\.de\/discount\/SOMMER10"/);
});

test("coupon in a narrow column: the code shrinks to fit, the ticket fills the column", () => {
  const doc = docOf([{ type: "section", gap: 20, columns: [{ width: 25, blocks: [{ type: "coupon", code: "BLACKWEEK2026", headline: "x" }] }, { width: 75, blocks: [{ type: "text", text: "y" }] }] }]);
  const html = renderMailTemplateHtml(doc, ctx());
  const m = /font-size: (\d+)px; line-height: \d+px; font-weight: 700; letter-spacing: ([\d.]+)px; color: #111111; Margin: 4px 0 6px; word-break: break-all;/.exec(html);
  const [size, tracking] = [Number(m?.[1]), Number(m?.[2])];
  assert.ok(size >= 11 && size < 18, String(size));
  assert.equal(tracking, 0); // the tracking goes before the size shrinks
  // in a wider column the code keeps couponCodeType's size (13 characters: 18 px)
  const wide = renderMailTemplateHtml(docOf([{ type: "section", columns: [{ width: 80, blocks: [{ type: "coupon", code: "BLACKWEEK2026" }] }, { width: 20, blocks: [] }] }]), ctx());
  assert.match(wide, /font-size: 18px; line-height: 24px; font-weight: 700; letter-spacing: 1px; color: #111111; Margin: 4px 0 6px;"/);
  assert.match(wide, /padding: 16px 20px;/);
  assert.match(html, /border="0" width="100%" align="center" role="presentation" style="direction: ltr; Margin: 0 auto; border-collapse: separate !important;/);
  assert.match(html, /padding: 14px 10px;/);
  assert.deepEqual(lint(html), []);
});

test("coupon on a colour other than the card's: readable label, terms and link", () => {
  const style = { cardBackground: "#111111", textColor: "#ffffff", linkColor: "#ffffff", accentColor: "#ffd400" };
  const blocks = [{ type: "coupon", code: "DARK10", headline: "10 %", terms: "Bedingungen", background: "#ffffff" }];
  const slice = (html) => html.slice(html.indexOf("Dein Code") - 400, html.indexOf("Code einlösen") + 40);
  // version 1: the classic coupon — dark label, grey terms
  const v1 = slice(renderMailTemplateHtml({ ...docOf(blocks, style), v: 1 }, ctx()));
  assert.doesNotMatch(v1, /color: #ffffff/);
  assert.match(v1, /color: #111111; Margin: 0; text-transform: uppercase;/);
  assert.match(v1, /color: #555555; Margin: 0;" align="center">Bedingungen/);
  // format 2: the mail's text colour made readable, label and terms muted from it
  const v2 = slice(renderMailTemplateHtml(docOf(blocks, style), ctx()));
  assert.doesNotMatch(v2, /color: #ffffff/);
  assert.match(v2, /color: #646464; Margin: 0; text-transform: uppercase;/);
  assert.match(v2, /color: #646464; Margin: 0;" align="center">Bedingungen/);
  assert.match(v2, /color: #111111; Margin: 0; font-weight: 700;" align="center">10 %/);
  // on the card colour itself the template's colours stay (v2: the label muted)
  const onCard = renderMailTemplateHtml(docOf([{ type: "coupon", code: "DARK10", headline: "10 %" }], style), ctx());
  assert.match(onCard, /color: #acacac; Margin: 0; text-transform: uppercase;/);
  assert.match(onCard, /color: #ffffff; Margin: 0; font-weight: 700;" align="center">10 %/);
  assert.match(onCard, /border: 2px dashed #ffd400;/);
  const onCardV1 = renderMailTemplateHtml({ ...docOf([{ type: "coupon", code: "DARK10", headline: "10 %" }], style), v: 1 }, ctx());
  assert.match(onCardV1, /color: #ffffff; Margin: 0; text-transform: uppercase;/);
});

test("social icons can stand left or right", () => {
  const html = renderMailTemplateHtml(docOf([{ type: "social", align: "right" }]), ctx());
  assert.match(html, /<td class="content-pad" align="right" bgcolor="#ffffff" style="mso-line-height-rule: exactly; padding: 14px 60px;" valign="top">\s*<table cellspacing="0" cellpadding="0" border="0" align="right" role="presentation" style="direction: ltr; Margin: 0 0 0 auto;">/);
});

/** The six icons of production (email-template.ts EMAIL_SOCIAL_LINKS). */
const SIX_SOCIAL = ["facebook", "instagram", "pinterest", "youtube", "tiktok", "linkedin"].map((alt) => ({ alt, icon: `https://cdn.example.com/${alt}.png`, url: `https://${alt}.com/motionsports` }));
const sixIcons = (extra = {}) => ctx({ assets: { ...FIXTURE_ASSETS, socialLinks: SIX_SOCIAL }, ...extra });
/** The width of every row of social icons in `html`: per cell the icon plus its padding on both sides. */
const iconRowWidths = (html) =>
  [...html.matchAll(/<tr>((?:\s*<td align="center" valign="middle" style="mso-line-height-rule: exactly; padding: 0 \d+px;">\s*<a [^>]*><img [^>]*><\/a>\s*<\/td>)+)\s*<\/tr>/g)].map((m) =>
    [...m[1].matchAll(/padding: 0 (\d+)px;">\s*<a [^>]*><img [^>]*\swidth="(\d+)"/g)].reduce((sum, c) => sum + Number(c[2]) + 2 * Number(c[1]), 0)
  );

test("social: the six production icons fit narrow columns — less padding, smaller icons, then two rows", () => {
  // at the top level and in the footer: one row as in version 1 (20 px icons, 6 px on each side)
  const top = renderMailTemplateHtml(docOf([{ type: "social" }, { type: "footer", showSocial: true }]), sixIcons());
  assert.deepEqual(iconRowWidths(top), [192, 192]);
  assert.equal((top.match(/padding: 0 6px;">\s*<a [^>]*><img [^>]*width="20" height="20"/g) ?? []).length, 12);
  // the reviewer's layouts: 60 / 40 text | social, logo | text | social, a 4-column section
  const layouts = [
    { columns: [{ width: 60, blocks: [{ type: "text", text: "Text" }] }, { width: 40, blocks: [{ type: "social" }] }], at: 1 },
    { columns: [{ blocks: [{ type: "logo" }] }, { blocks: [{ type: "text", text: "Text" }] }, { blocks: [{ type: "social" }] }], at: 2 },
    { columns: [{ blocks: [{ type: "social" }] }, { blocks: [{ type: "text", text: "a" }] }, { blocks: [{ type: "text", text: "b" }] }, { blocks: [{ type: "text", text: "c" }] }], at: 0 },
  ];
  for (const { columns, at } of layouts) {
    const section = { type: "section", columns };
    const html = renderMailTemplateHtml(docOf([section]), sixIcons());
    const { widths } = sectionColumnWidths(normalizeMailTemplateDoc(docOf([section])).blocks[0], 60);
    const rows = iconRowWidths(body(html));
    assert.ok(rows.length >= 1 && rows.every((w) => w <= widths[at]), `${columns.length} columns: rows ${rows} in ${widths[at]} px`);
    assert.equal((body(html).match(/<img [^>]*alt="(facebook|instagram|pinterest|youtube|tiktok|linkedin)"/g) ?? []).length, 6, "every icon is kept");
    assert.deepEqual(lint(html), []);
  }
  // 40 % column (184 px): one row, the padding shrinks; 4 columns (105 px): two rows of three
  assert.deepEqual(socialIconLayout(6, 184), { perRow: 6, size: 20, pad: 5 });
  assert.deepEqual(socialIconLayout(6, 105), { perRow: 3, size: 20, pad: 6 });
  assert.deepEqual(socialIconLayout(6, 120), { perRow: 6, size: 16, pad: 2 });
  assert.deepEqual(socialIconLayout(6, 480), { perRow: 6, size: 20, pad: 6 });
  assert.deepEqual(socialIconLayout(2, 480), { perRow: 2, size: 20, pad: 6 });
  // two rows: each row its own table, aligned like the block
  const four = renderMailTemplateHtml(docOf([layouts[2]].map(({ columns }) => ({ type: "section", columns }))), sixIcons());
  assert.equal(iconRowWidths(body(four)).length, 2);
  assert.match(body(four), /<td align="center" style="mso-line-height-rule: exactly; padding: 8px 0 0;">\s*<table cellspacing="0" cellpadding="0" border="0" align="center" role="presentation"/);
});

test("social: no row of icons is ever wider than the room of its column (every column count, padding, gap and band)", () => {
  for (const n of [1, 2, 3, 4]) {
    for (const padX of [0, 24, 60]) {
      for (const gap of [0, 20, 48]) {
        for (const padding of [0, 16]) {
          for (const background of [null, "#eeeeee"]) {
            const columns = Array.from({ length: n }, (_, i) => ({ padding, blocks: i === n - 1 ? [{ type: "social", background }] : [{ type: "text", text: "x" }] }));
            const section = normalizeMailTemplateDoc(docOf([{ type: "section", padX, gap, columns }])).blocks[0];
            const html = renderMailTemplateHtml(docOf([section]), sixIcons());
            const inner = Math.max(20, sectionColumnWidths(section, 60).widths[n - 1] - 2 * padding);
            const side = background ? Math.min(16, Math.max(8, Math.round(inner / 12))) : 0;
            const where = `${n} columns, padX ${padX}, gap ${gap}, padding ${padding}, band ${Boolean(background)}`;
            for (const w of iconRowWidths(body(html))) assert.ok(w <= inner - 2 * side, `${where}: row ${w} px in ${inner - 2 * side} px`);
            assert.deepEqual(lint(html), [], where);
          }
        }
      }
    }
  }
});

test("logo: right alignment, never wider than its column", () => {
  const right = renderMailTemplateHtml(docOf([{ type: "logo", align: "right", width: 200 }]), ctx());
  assert.match(right, /<td class="content-pad" align="right" bgcolor="#ffffff" style="mso-line-height-rule: exactly; padding: 30px 60px 20px;">/);
  assert.match(right, /width="200" border="0" style="width: 200px; height: auto !important; max-width: 100%; display: block; Margin: 0 0 0 auto;">/);
  const narrow = renderMailTemplateHtml(docOf([{ type: "section", columns: [{ width: 20, blocks: [{ type: "logo", width: 300 }] }, { width: 80, blocks: [] }] }]), ctx());
  const { widths } = sectionColumnWidths({ columns: [{ width: 20 }, { width: 80 }], padX: null, gap: 20 }, 60);
  assert.match(narrow, new RegExp(`alt="motion sports" width="${widths[0]}" border="0" style="width: ${widths[0]}px;`));
});

// ── Mo's pieces on any card ──────────────────────────────────────────────────

/** A card row of the composer the way templateSectionRow hands it over on a dark card: on the white panel. */
const panelRow = (card, inner) => `
                <tr>
                  <td class="content-pad" align="center" bgcolor="${card}" style="mso-line-height-rule: exactly; padding: 20px 60px;" valign="top">${mailWhitePanel(inner)}
                  </td>
                </tr>`;
/** The composer's pieces of a personal mail: Mo's text in emailTextStyle() black, as campaign-email.ts writes it. */
const composerPieces = (card) => {
  const black = "mso-line-height-rule: exactly; direction: ltr; font-family: Arial, Helvetica, sans-serif; font-size: 13px; line-height: 1.5; font-weight: 400; text-transform: none; color: #000000; Margin: 0;";
  const row = (inner) => (isDarkCard(card) ? panelRow(card, inner) : panelRow(card, inner).replace(mailWhitePanel(inner), inner));
  return {
    heading: "Deine persönliche Empfehlung",
    bodyHtml: `
                    <p style="${black} white-space: pre-wrap;" align="left">Hallo Anna, MOS TEXT mit <a href="https://motionsports.de/products/rack" target="_blank" style="color: #ffd400; text-decoration: underline; word-wrap: break-word;">Rack</a>.</p>`,
    moAvatarUrl: "https://mo.example.com/moorb.gif",
    offerRowsHtml: row(`<p style="${black}">OFFER</p>`),
    promoRowsHtml: row(`<p style="${black}">PROMO</p>`),
    ctaRowsHtml: row('<a href="https://motionsports.de/cart">CTA</a>'),
    footnoteRowHtml: row(`<p style="${black}">FOOTNOTE</p>`),
    postCtaRowsHtml: "",
    preCtaRowsHtml: "",
  };
};
/** The colour behind position `at` of `html`: the innermost bgcolor of the cells and tables open there. */
function backgroundAt(html, at) {
  const stack = [];
  for (const m of html.slice(0, at).matchAll(/<(\/?)(td|table|body)\b([^>]*)>/gi)) {
    if (m[1]) stack.pop();
    else stack.push(/\sbgcolor="(#[0-9a-f]{6})"/i.exec(m[3])?.[1]?.toLowerCase() ?? null);
  }
  for (let k = stack.length - 1; k >= 0; k--) if (stack[k]) return stack[k];
  return null;
}
const personalDoc = (style) =>
  docOf(
    [
      { type: "logo" },
      { type: "hero", src: "https://cdn.example.com/fallback.jpg", alt: "Szene", showHeadline: true },
      { type: "mo_content", showHeading: true },
      { type: "mo_offer" },
      { type: "mo_promo" },
      { type: "footer", background: "#000000", textColor: "#cccccc" },
    ],
    style
  );

test("Mo's pieces on a dark card: Mo's text and avatar on the white panel, never black on the dark card", () => {
  const style = { cardBackground: "#111111", textColor: "#eeeeee", headingColor: "#ffffff", outerBackground: "#000000", accentColor: "#ffd400" };
  const hero = { imageUrl: "https://cdn.example.com/hero.jpg", headline: "Dein Setup", isAi: false };
  const html = renderMailTemplateHtml(personalDoc(style), ctx({ mo: composerPieces("#111111"), hero }));
  assert.deepEqual(lint(html), []);
  const card = body(html);
  // every piece of black ink stands on a colour it reads on
  const blacks = [...card.matchAll(/color: #000000/g)];
  assert.ok(blacks.length >= 4);
  for (const m of blacks) {
    const bg = backgroundAt(card, m.index);
    assert.ok((contrastRatio("#000000", bg) ?? 0) >= 4.5, `black on ${bg}: ${card.slice(m.index, m.index + 120)}`);
  }
  // Mo's text and the avatar (a picture on white) share one panel
  const text = card.indexOf("MOS TEXT");
  const avatar = card.indexOf('alt="Mo"');
  assert.equal(backgroundAt(card, text), "#ffffff");
  assert.equal(backgroundAt(card, avatar), "#ffffff");
  assert.ok(card.lastIndexOf('<td bgcolor="#ffffff" align="center" style="background-color: #ffffff; border-radius: 8px; padding: 16px;">', avatar) > card.lastIndexOf("</td>", avatar), "avatar and text in the same panel");
  assert.match(card, /<td class="content-pad" align="left" bgcolor="#111111" style="mso-line-height-rule: exactly; padding: 25px 60px 10px;" valign="top">\s*<table role="presentation" width="100%"/);
  // heading and hero headline in the template's heading colour
  assert.match(card, /color: #ffffff; Margin: 0;" align="center">Deine persönliche Empfehlung<\/p>/);
  assert.match(card, /color: #ffffff; Margin: 0;" align="left">Dein Setup<\/p>/);
  // Mo's link came in the accent (yellow, chosen for the dark card): on the white panel the classic link blue
  assert.match(card, /<a href="https:\/\/motionsports\.de\/products\/rack" target="_blank" style="color: #008ccb; text-decoration: underline;/);
  // an accent that reads on white stays
  const blue = renderMailTemplateHtml(personalDoc({ ...style, accentColor: "#c61724" }), ctx({ mo: { ...composerPieces("#111111"), bodyHtml: composerPieces("#111111").bodyHtml.replace("#ffd400", "#c61724") } }));
  assert.match(blue, /href="https:\/\/motionsports\.de\/products\/rack" target="_blank" style="color: #c61724;/);
});

test("Mo's heading and the hero headline stay readable when the heading colour would vanish on the card", () => {
  const html = renderMailTemplateHtml(personalDoc({ cardBackground: "#111111", headingColor: "#222222", textColor: "#eeeeee" }), ctx({ mo: composerPieces("#111111"), hero: { imageUrl: "https://cdn.example.com/hero.jpg", headline: "Dein Setup" } }));
  assert.match(html, /color: #ffffff; Margin: 0;" align="center">Deine persönliche Empfehlung<\/p>/);
  assert.match(html, /color: #ffffff; Margin: 0;" align="left">Dein Setup<\/p>/);
  // a template without „Mos persönlicher Text“: Mo's text before the footer, on the panel too
  const unplaced = renderMailTemplateHtml(docOf([{ type: "logo" }, { type: "footer" }], { cardBackground: "#1a1a1a" }), ctx({ mo: composerPieces("#1a1a1a") }));
  assert.equal(backgroundAt(body(unplaced), body(unplaced).indexOf("MOS TEXT")), "#ffffff");
});

test("Mo's pieces on a light card stay exactly as in version 1 — no panel, the avatar in its own row", () => {
  for (const cardBackground of ["#ffffff", "#f4f1ea", "#ffd400"]) {
    const html = renderMailTemplateHtml(personalDoc({ cardBackground }), ctx({ mo: composerPieces(cardBackground) }));
    assert.doesNotMatch(body(html), /border-radius: 8px; padding: 16px;/, cardBackground);
    assert.match(
      html,
      new RegExp(`<td class="content-pad" align="center" bgcolor="${cardBackground}" style="mso-line-height-rule: exactly; padding: 25px 60px 0;" valign="top">\\s*<img src="https://mo\\.example\\.com/moorb\\.gif" alt="Mo" width="64" height="64"`),
      cardBackground
    );
    assert.match(html, new RegExp(`<td class="content-pad" align="left" bgcolor="${cardBackground}" style="mso-line-height-rule: exactly; padding: 25px 60px 10px;" valign="top">\\s*<p style="[^"]*color: #000000;`), cardBackground);
  }
});

// ── footer, card, fonts ──────────────────────────────────────────────────────

test("footer: own background and text colour — the legal notice recoloured, never unreadable", () => {
  const html = renderMailTemplateHtml(docOf([{ type: "text", text: "x" }, { type: "footer", background: "#111111", textColor: "#dddddd" }]), ctx());
  const footer = html.slice(html.indexOf(MAIL_FOOTER_MARKER));
  assert.match(footer, /<td class="content-pad" align="center" bgcolor="#111111" style="mso-line-height-rule: exactly; padding: 24px 60px;">/);
  assert.match(footer, /font-size: 11px; line-height: 1\.5; mso-line-height-alt: 16\.5px; font-weight: 400; color: #dddddd; Margin: 0;" align="center">4motionsports GmbH/);
  assert.match(footer, /<a href="mailto:info@motionsports\.de" style="color: #dddddd;/);
  assert.match(footer, /Impressum<\/a>/);
  assert.doesNotMatch(footer, /#000000/); // the unsubscribe notice follows the footer colour
  // an unreadable choice falls back to black or white
  const dark = renderMailTemplateHtml(docOf([{ type: "text", text: "x" }, { type: "footer", background: "#000000", textColor: "#111111" }]), ctx());
  assert.match(dark.slice(dark.indexOf(MAIL_FOOTER_MARKER)), /color: #ffffff; Margin: 0;" align="center">4motionsports GmbH/);
  const darkNoColour = renderMailTemplateHtml(docOf([{ type: "text", text: "x" }, { type: "footer", background: "#000000" }]), ctx());
  assert.match(darkNoColour.slice(darkNoColour.indexOf(MAIL_FOOTER_MARKER)), /color: #ffffff; Margin: 0;" align="center">4motionsports GmbH/);
});

test("card: its own colour on the card and every top-level row; rounded corners with the separate border model", () => {
  const html = renderMailTemplateHtml(docOf([{ type: "text", text: "x" }, { type: "logo" }], { cardBackground: "#fff8e1", cardRadius: 20 }), ctx());
  assert.match(html, /style="width: 600px; max-width: 600px; direction: ltr; Margin: 0 auto; table-layout: fixed; border-radius: 20px; border-collapse: separate !important; border-spacing: 0; overflow: hidden;" class="email-container" role="presentation" bgcolor="#fff8e1">/);
  assert.match(html, /<td class="content-pad" align="left" bgcolor="#fff8e1" style="mso-line-height-rule: exactly; padding: 10px 60px;" valign="top">/);
  assert.match(html, /<td class="content-pad" align="center" bgcolor="#fff8e1" style="mso-line-height-rule: exactly; padding: 30px 60px 20px;">/);
  assert.match(html, /<td height="20" bgcolor="#fff8e1"/);
  assert.doesNotMatch(body(html), /bgcolor="#ffffff"/);
});

test("web fonts: one Google-Fonts link for every web font in use, hidden from Outlook, which keeps one safe font", () => {
  const html = renderMailTemplateHtml(
    docOf([{ type: "heading", text: "x" }, { type: "section", columns: [{ blocks: [{ type: "menu", font: "bebas", items: [{ label: "A", href: "https://a.de" }] }] }] }], {
      fontFamily: "poppins",
      headingFont: "oswald",
    }),
    ctx()
  );
  const url = "https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&family=Oswald:wght@400;600;700&family=Bebas+Neue&display=swap";
  assert.ok(html.includes(`<!--[if !mso]><!-->\n    <link href="${url.replace(/&/g, "&amp;")}" rel="stylesheet" type="text/css">\n    <style type="text/css">\n      @import url('${url}');\n    </style>\n    <!--<![endif]-->`));
  assert.equal(html.split("fonts.googleapis.com").length - 1, 2);
  assert.match(html, /\* \{ font-family: Verdana, Geneva, sans-serif !important; \}/); // Word: Poppins' safe stack
  assert.deepEqual(lint(html), []);
  // system fonts only: no link at all
  assert.doesNotMatch(renderMailTemplateHtml(docOf([{ type: "text", text: "x" }], { fontFamily: "arial", headingFont: "georgia" }), ctx()), /fonts\.googleapis/);
});

// ── menu and product ─────────────────────────────────────────────────────────

test("menu: one paragraph of double-quoted links with the separator, type settings, labels merged and escaped", () => {
  const doc = docOf([
    {
      type: "menu",
      align: "left",
      separator: "/",
      fontSize: 15,
      letterSpacing: 2,
      color: "#222222",
      font: "lato",
      items: [
        { label: "Home Gym", href: "https://motionsports.de/collections/home-gym" },
        { label: "Für {{vorname|dich}}", href: "https://motionsports.de/?a=1&b=2" },
        { label: "<b>Ohne Link</b>", href: "" },
      ],
    },
  ]);
  const html = renderMailTemplateHtml(doc, ctx());
  // Lato on a Montserrat mail: Word's Arial (not the body's Verdana) on the paragraph, each link and separator
  const p = /<p class="mso-font-lato" style="([^"]*)" align="left">(.*)<\/p>/.exec(html);
  assert.ok(p);
  assert.equal(p[1], "mso-line-height-rule: exactly; direction: ltr; font-family: 'Lato', Arial, Helvetica, sans-serif; font-size: 15px; line-height: 24px; font-weight: 700; text-transform: uppercase; letter-spacing: 2px; color: #222222; Margin: 0;");
  assert.equal(
    p[2],
    '<a class="mso-font-lato" href="https://motionsports.de/collections/home-gym" target="_blank" style="color: #222222; text-decoration: none;">Home&nbsp;Gym</a> <span class="mso-font-lato" style="color: #222222;">&nbsp;/&nbsp;</span> ' +
      '<a class="mso-font-lato" href="https://motionsports.de/?a=1&amp;b=2" target="_blank" style="color: #222222; text-decoration: none;">Für&nbsp;Anna</a> <span class="mso-font-lato" style="color: #222222;">&nbsp;/&nbsp;</span> &lt;b&gt;Ohne&nbsp;Link&lt;/b&gt;'
  );
  assert.match(html, /\.mso-font-lato \{ font-family: Arial, Helvetica, sans-serif !important; \}/);
  const plain = renderMailTemplateHtml(docOf([{ type: "menu", separator: "none", uppercase: false, bold: false, items: [{ label: "A", href: "https://a.de" }, { label: "B", href: "https://b.de" }] }]), ctx());
  assert.match(plain, /font-weight: 400; color: #111111; Margin: 0;" align="center"><a href="https:\/\/a\.de\/"[^>]*>A<\/a> <span style="color: #111111;">&nbsp;&nbsp;<\/span> <a/);
  assert.match(renderMailTemplateHtml(docOf([{ type: "menu", items: [{ label: "A", href: "https://a.de" }, { label: "B", href: "https://b.de" }] }]), ctx()), /&nbsp;\|&nbsp;/);
  assert.match(renderMailTemplateHtml(docOf([{ type: "menu", separator: "·", items: [{ label: "A", href: "https://a.de" }, { label: "B", href: "https://b.de" }] }]), ctx()), /&nbsp;&#183;&nbsp;/);
  // a long label may wrap (narrow columns), a short one never breaks
  assert.match(renderMailTemplateHtml(docOf([{ type: "menu", items: [{ label: "Alle Angebote der Black Week", href: "https://a.de" }] }]), ctx()), />Alle Angebote der Black Week<\/a>/);
  // a menu without links: a hint in previews, nothing in a mail
  const empty = docOf([{ type: "menu", items: [] }]);
  assert.match(renderMailTemplateHtml(empty, ctx({ previewPlaceholders: true })), /Navigation: noch keine Links\./);
  assert.doesNotMatch(renderMailTemplateHtml(empty, ctx()), /Navigation/);
});

test("product (stacked): picture as wide as its room, name, struck price, description, button — from the slot's data", () => {
  const doc = docOf([{ type: "product", id: "p", ref: "rack", showDescription: true, buttonLabel: "Für {{vorname|dich}}" }], { headingFont: "oswald" });
  const html = renderMailTemplateHtml(doc, ctx({ slots: { p: slot(product(1, { compareAtLabel: "499,00 €", description: "Stabil & <sicher>" })) } }));
  assert.match(html, /<img src="https:\/\/cdn\.shopify\.com\/p1\.jpg" width="480" alt="Produkt 1" border="0" class="col-img" style="width: 100%; max-width: 480px; height: auto; display: block; Margin: 0 auto;">/);
  // the name in the heading font — for Word its Windows equivalent, Arial Narrow (class on the paragraph and the link)
  assert.match(html, /<p class="mso-font-oswald" style="[^"]*font-family: 'Oswald', 'Arial Narrow', Arial, sans-serif; font-size: 20px; line-height: 26px; font-weight: 700; color: #111111; Margin: 0;" align="center"><a class="mso-font-oswald" href="https:\/\/motionsports\.de\/products\/p1" target="_blank" style="color: #111111; text-decoration: none;">Produkt 1<\/a>/);
  assert.match(html, /@font-face \{ font-family: 'Arial Narrow'; mso-font-alt: Arial; mso-generic-font-family: swiss; \}/);
  assert.match(html, /<span style="text-decoration: line-through; font-weight: 400; color: #c61724;">499,00 €<\/span>&nbsp; 399,00 €<\/p>/);
  assert.match(html, />Stabil &amp; &lt;sicher&gt;<\/p>/);
  assert.match(html, /<td align="center" bgcolor="#008ccb" style="mso-line-height-rule: exactly; mso-padding-alt: 16px 30px 16px 30px;/);
  assert.match(html, /<span style="color: #ffffff;">Für Anna<\/span>/);
  assert.match(html, /<v:roundrect [^>]*href="https:\/\/motionsports\.de\/products\/p1"[^>]*>[\s\S]*?>Für&nbsp;Anna<\/center>/, "the pill's Outlook twin");
  assert.deepEqual(lintOutlookHtml(html, { maxImageWidth: MAIL_CARD_WIDTH, strict: true }), []);
  assert.match(html, /<td class="content-pad" align="center" bgcolor="#ffffff" style="mso-line-height-rule: exactly; padding: 14px 60px;" valign="top">/);
  assert.deepEqual(lint(html), []);
  // switches: no price, no description, no button
  const lean = renderMailTemplateHtml(docOf([{ type: "product", id: "p", ref: "rack", showPrice: false, buttonLabel: "" }]), ctx({ slots: { p: slot(product(1)) } }));
  assert.doesNotMatch(lean, /399,00|Beschreibung 1|mso-padding-alt/);
  const noImage = renderMailTemplateHtml(docOf([{ type: "product", id: "p", ref: "rack", showImage: false }]), ctx({ slots: { p: slot(product(1)) } }));
  assert.doesNotMatch(noImage, /p1\.jpg/);
  // without a product page: no links, no button — and no merge placeholder for it (Rundmail freeze)
  const merged = [];
  const linkless = renderMailTemplateHtml(docOf([{ type: "product", id: "p", ref: "rack", buttonLabel: "Für {{vorname}}" }]), ctx({
    slots: { p: slot(product(1, { url: null })) },
    merge: (t) => (merged.push(t), anna(t)),
  }));
  assert.doesNotMatch(body(linkless), /<a |Für/);
  assert.ok(!merged.includes("Für {{vorname}}"));
});

test("product (side): picture 40 % | text 60 %, stacking on phones", () => {
  const html = renderMailTemplateHtml(docOf([{ type: "product", id: "p", ref: "rack", layout: "side", align: "left" }]), ctx({ slots: { p: slot(product(7)) } }));
  // 480 px room: (480 − 16) × 0.4 = 186 | 16 | 278
  assert.match(html, /<td class="col-stack" width="186" valign="top" align="center" style="mso-line-height-rule: exactly; width: 186px; font-size: 0; line-height: 0;"><a href="https:\/\/motionsports\.de\/products\/p7" [^>]*><img src="https:\/\/cdn\.shopify\.com\/p7\.jpg" width="186"/);
  assert.match(html, /<td class="col-gap" width="16" style="mso-line-height-rule: exactly; width: 16px; font-size: 0; line-height: 0;">&nbsp;<\/td>/);
  assert.match(html, /<td class="col-stack" width="278" valign="middle" align="left" style="mso-line-height-rule: exactly; width: 278px;">/);
  assert.deepEqual(lint(html), []);
  // without a picture the side layout falls back to the text alone
  const textOnly = renderMailTemplateHtml(docOf([{ type: "product", id: "p", ref: "rack", layout: "side" }]), ctx({ slots: { p: slot(product(7, { imageUrl: null })) } }));
  assert.doesNotMatch(body(textOnly), /col-stack/);
  assert.match(textOnly, /Produkt 7/);
});

test("product without data: nothing in a mail (sold out, unknown), a placeholder in previews", () => {
  const doc = docOf([{ type: "section", columns: [{ blocks: [{ type: "product", id: "p", ref: "weg" }] }] }, { type: "product", id: "q", ref: "auch-weg" }]);
  const send = renderMailTemplateHtml(doc, ctx({ slots: {} }));
  assert.doesNotMatch(send, /Hier erscheint das gewählte Produkt/);
  const preview = renderMailTemplateHtml(doc, ctx({ slots: {}, previewPlaceholders: true }));
  assert.equal(preview.split("Hier erscheint das gewählte Produkt.").length - 1, 2);
  assert.match(renderMailTemplateHtml(doc, ctx({ slots: {}, previewPlaceholders: true, locale: "en" })), /The chosen product appears here\./);
  assert.equal(renderMailTemplateText(doc, ctx({ slots: {} })).includes("weg"), false);
});

test("product in a narrow column: smaller type and button, picture as wide as the column", () => {
  const doc = docOf([{ type: "section", gap: 12, columns: [0, 1, 2, 3].map((i) => ({ blocks: [{ type: "product", id: `p${i}`, ref: `r${i}` }] })) }]);
  const slots = Object.fromEntries([0, 1, 2, 3].map((i) => [`p${i}`, slot(product(i))]));
  const html = renderMailTemplateHtml(doc, ctx({ slots }));
  const { widths } = sectionColumnWidths(normalizeMailTemplateDoc(doc).blocks[0], 60);
  assert.match(html, new RegExp(`<img src="https://cdn\\.shopify\\.com/p0\\.jpg" width="${widths[0]}"`));
  assert.match(html, /font-size: 14px; line-height: 18px; font-weight: 700;/); // name
  assert.match(html, /mso-padding-alt: 12px 22px 12px 22px;/); // button size s
  assert.deepEqual(lint(html), []);
});

// ── escaping, merge fields, custom HTML ──────────────────────────────────────

test("escaping: no text, label or link of the new blocks can open a tag or an attribute", () => {
  const doc = docOf([
    { type: "menu", items: [{ label: '"><script>x</script>', href: 'https://x.de/?q="a"' }] },
    { type: "product", id: "p", ref: "r", buttonLabel: '<img src=x onerror=1>' },
    { type: "section", bgImage: "https://x.de/a.jpg?x=\"');background:url(evil", columns: [{ blocks: [{ type: "text", text: "<b>" }] }] },
  ]);
  const html = renderMailTemplateHtml(doc, ctx({ slots: { p: slot(product(1, { name: '<b onclick="x">Name</b>', url: 'https://x.de/"><script>' })) } }));
  assert.doesNotMatch(html, /<script/);
  assert.doesNotMatch(html, /<b onclick/);
  assert.doesNotMatch(html, /<img src=x/);
  assert.doesNotMatch(html, /url\('[^']*'[^;]*evil/);
  assert.match(html, /&lt;b onclick=&quot;x&quot;&gt;Name&lt;\/b&gt;/);
});

test("merge fields are never applied to custom HTML, alt texts or links", () => {
  const seen = [];
  const merge = (t) => {
    seen.push(t);
    return anna(t);
  };
  const doc = docOf([
    { type: "html", html: "<p>{{vorname}}</p>" },
    { type: "image", src: "https://x.de/a.jpg", alt: "{{vorname}}", href: "https://x.de/?n={{vorname}}" },
    { type: "menu", items: [{ label: "Hi {{vorname}}", href: "https://motionsports.de/{{vorname}}" }] },
  ]);
  const html = renderMailTemplateHtml(doc, ctx({ merge }));
  assert.match(html, /<p>\{\{vorname\}\}<\/p>/);
  assert.match(html, /alt="\{\{vorname\}\}"/);
  assert.ok(seen.includes("Hi {{vorname}}"));
  assert.ok(!seen.some((t) => /<p>|^https?:/.test(t)), seen.join(" | "));
});

test("links in text blocks are never personalised: merge fields stay in the address, the link text is merged", () => {
  const doc = docOf([
    { type: "text", text: "Dein [Link für {{vorname|dich}}](https://motionsports.de/pages/aktion?name={{vorname}}) und https://motionsports.de/{{vorname}} — Grüße, {{vorname}}" },
  ]);
  const html = renderMailTemplateHtml(doc, ctx());
  assert.match(html, /href="https:\/\/motionsports\.de\/pages\/aktion\?name=\{\{vorname\}\}"[^>]*>Link für Anna<\/a>/);
  assert.match(html, /href="https:\/\/motionsports\.de\/\{\{vorname\}\}"/);
  assert.match(html, /Grüße, Anna/);
  assert.doesNotMatch(html, /name=Anna|motionsports\.de\/Anna/);
  const text = renderMailTemplateText(doc, ctx());
  assert.match(text, /aktion\?name=\{\{vorname\}\}/);
  assert.match(text, /Grüße, Anna/);
  // the Rundmail freeze writes no per-recipient token into an address
  const tokens = [];
  const freeze = (t) => applyMergeFields(t, {}, (_i, fb) => `{{mo:fn:${tokens.push(fb) - 1}}}`);
  const frozen = renderMailTemplateHtml(doc, ctx({ merge: freeze }));
  assert.doesNotMatch(frozen, /href="[^"]*mo:fn/);
  assert.match(frozen, />Link für \{\{mo:fn:\d+\}\}<\/a>/);
  // a text without links merges as before
  assert.match(renderMailTemplateHtml(docOf([{ type: "text", text: "Hallo {{vorname}}, https ist kein Link." }]), ctx()), /Hallo Anna, https ist kein Link\./);
});

test("an html block cannot swallow the mail below it: raw-text elements, unterminated comments and tags end at the block", () => {
  for (const html of ["<p>Vorher</p><noembed>", "<p>Vorher</p><xmp>", "<p>Vorher</p><plaintext>", "<p>Vorher</p><noframes>", "<p>Vorher</p><!-- offen", "<p>Vorher</p><p title='offen>", '<p>Vorher</p><td style="x']) {
    const out = renderMailTemplateHtml(docOf([{ type: "html", html }, { type: "text", text: "Danach" }]), ctx());
    assert.doesNotMatch(out, /<(noembed|xmp|plaintext|noframes)\b|<!-- offen|title='offen|style="x/i, html);
    assert.match(out, /<p>Vorher<\/p>\s*<\/td>/, html);
    assert.ok(out.indexOf("Danach") > out.indexOf("Vorher") && out.indexOf("Impressum") > out.indexOf(MAIL_FOOTER_MARKER), html);
    assert.deepEqual(lint(out), [], html);
  }
});

test("sanitizeCustomHtml: single-quoted and unquoted links become double-quoted (link tracking), the rest as before", () => {
  assert.equal(sanitizeCustomHtml("<a href='https://x.de/a'>a</a>"), '<a href="https://x.de/a">a</a>');
  assert.equal(sanitizeCustomHtml("<a href=https://x.de/b?c=1 class=x>b</a>"), '<a href="https://x.de/b?c=1" class=x>b</a>');
  assert.equal(sanitizeCustomHtml(`<a HREF = 'https://x.de/"q"'>q</a>`), '<a href="https://x.de/&quot;q&quot;">q</a>');
  assert.equal(sanitizeCustomHtml('<a href="https://x.de/d">d</a>'), '<a href="https://x.de/d">d</a>');
  assert.equal(sanitizeCustomHtml("<a href='javascript:alert(1)'>x</a>"), '<a href="#">x</a>');
  assert.equal(sanitizeCustomHtml("<a href=javascript:alert(1)>x</a>"), '<a href="#">x</a>');
  assert.equal(sanitizeCustomHtml("<img src='https://x.de/a.png'>"), "<img src='https://x.de/a.png'>"); // no width is invented
  // every link of a custom block is double-quoted in the mail
  const html = renderMailTemplateHtml(docOf([{ type: "html", html: "<a href='https://x.de/1'>1</a> <a href=https://x.de/2>2</a>" }]), ctx());
  assert.match(html, /<a href="https:\/\/x\.de\/1">1<\/a> <a href="https:\/\/x\.de\/2">2<\/a>/);
});

test("text part: menu lines, product lines from the slot, merged coupon terms", () => {
  const doc = docOf([
    { type: "menu", items: [{ label: "Kraft", href: "https://motionsports.de/kraft" }, { label: "Ohne", href: "" }] },
    { type: "product", id: "p", ref: "r" },
    { type: "product", id: "q", ref: "r2", showPrice: false },
    { type: "coupon", code: "X10", terms: "Für {{vorname|dich}}" },
  ]);
  const text = renderMailTemplateText(doc, ctx({ slots: { p: slot(product(1)), q: slot(product(2)) } }));
  assert.match(text, /^Kraft: https:\/\/motionsports\.de\/kraft\n\nProdukt 1 — 399,00 €\nhttps:\/\/motionsports\.de\/products\/p1\n\nProdukt 2\nhttps:\/\/motionsports\.de\/products\/p2\n\nDein Code: X10\nFür Anna\nCode einlösen: https:\/\/motionsports\.de\/discount\/X10/);
  assert.doesNotMatch(text, /Ohne/);
  // the slot's own line (mail-template-slots.mjs productSlotText) wins; no data, no line
  const own = renderMailTemplateText(doc, ctx({ slots: { p: { ...slot(product(1)), text: "EIGENE ZEILE" }, q: { html: "", text: "OHNE DATEN" } } }));
  assert.match(own, /EIGENE ZEILE/);
  assert.doesNotMatch(own, /Produkt 1|OHNE DATEN/);
});

test("the render context of a send: assets and footer of the fixtures are complete", () => {
  // guards the shared fixture context the snapshots were taken with
  assert.ok(FIXTURE_ASSETS.socialLinks.length >= 1 && FIXTURE_FOOTER.unsubscribeHtml.includes("unsubscribe"));
});

// ── the fixed blocks in the mail's look (coupon, countdown, products) ────────

/** A countdown slot as mail-template-design.ts hands it over (signed URLs in the block's colours). */
const countdownSlot = (extra = {}) => ({
  html: "",
  text: "Dein Angebot gilt noch 3 Tage",
  countdown: {
    imageUrl: "https://mo.example.com/api/email-countdown/tok?bg=111111&tile=292929&digit=ffd400&label=a1a1a1&cs=sig",
    imageUrlMobile: "https://mo.example.com/api/email-countdown/tok?w=m&bg=111111&tile=292929&digit=ffd400&label=a1a1a1&cs=sig",
    imageAlt: "Dein Angebot gilt noch 3 Tage und 4 Stunden",
    imageWidth: 564,
    imageHeight: 116,
    imageWidthMobile: 350,
    lead: "Dein Angebot gilt noch 3 Tage 4 Stunden",
    until: "bis Sa., 12.12.2026, 23:59 Uhr",
    ...extra,
  },
});
/** A products slot (the rows' description and button label; null in the grid). */
const productsSlot = (layout, n = 2) => ({
  html: "",
  text: "- Produkt 1 — 399,00 €",
  products: {
    layout,
    items: Array.from({ length: n }, (_, i) => ({
      ...product(i + 1, i === 1 ? { compareAtLabel: "499,00 €" } : {}),
      description: layout === "rows" ? `Beschreibung ${i + 1}` : null,
      ctaLabel: layout === "rows" ? "Zum Produkt" : null,
    })),
  },
});
/** The automatic look of the first countdown of a raw document. */
const countdownLookOf = (doc) => {
  const d = normalizeMailTemplateDoc(doc);
  return countdownLook(d.blocks.find((b) => b.type === "countdown"), d.style);
};
const DARK_STYLE = { cardBackground: "#111111", textColor: "#eeeeee", headingColor: "#ffffff", accentColor: "#ffd400", buttonTextColor: "#111111", headingFont: "oswald", buttonShape: "square" };

test("coupon look: card colour, frame style, corners, text and code colour, code font", () => {
  const html = renderMailTemplateHtml(
    docOf([{ type: "coupon", code: "GELB20", headline: "20 %", terms: "Nur online", cardColor: "#ffd400", borderStyle: "solid", radius: 16, textColor: "#222222", codeColor: "#000000", codeFont: "bebas", accent: "#111111" }]),
    ctx()
  );
  assert.match(html, /border-spacing: 0; border: 2px solid #111111; border-radius: 16px;"/);
  // the card's colour fills the cell (Word: the bgcolor), rounded inside the 2 px frame
  assert.match(html, /<td align="center" bgcolor="#ffd400" style="mso-line-height-rule: exactly; padding: 16px 28px; background-color: #ffd400; border-radius: 14px;">/);
  assert.match(html, /font-family: 'Bebas Neue', Impact, 'Arial Narrow', Arial, sans-serif; font-size: 24px; line-height: 30px; font-weight: 700; letter-spacing: 2px; color: #000000;/);
  assert.match(html, /color: #222222; Margin: 0; text-transform: uppercase; letter-spacing: 1px;" align="center">Dein Code/);
  assert.match(html, /color: #222222; Margin: 0;" align="center">Nur online/);
  assert.match(html, /color: #111111; Margin: 0; font-weight: 700;" align="center">20 %/, "the headline in the frame colour");
  // without a frame: no border at all, the corners stay
  const none = renderMailTemplateHtml(docOf([{ type: "coupon", code: "X10", borderStyle: "none", radius: 0 }]), ctx());
  assert.doesNotMatch(none, /border: 2px/);
  assert.match(none, /border-spacing: 0; border-radius: 0px;"/);
  assert.deepEqual(lint(html), []);
  assert.deepEqual(lint(none), []);
});

test("coupon look (format 2): the code in the heading font and colour, texts in the text colour, made readable", () => {
  const style = { headingFont: "playfair", headingColor: "#c61724", textColor: "#333333", fontFamily: "lato" };
  const html = renderMailTemplateHtml(docOf([{ type: "coupon", code: "TREUE15", headline: "15 %", terms: "Einmalig" }], style), ctx());
  assert.match(html, /font-family: 'Playfair Display', Georgia, 'Times New Roman', serif; font-size: 24px; line-height: 30px; font-weight: 700; letter-spacing: 2px; color: #c61724;/);
  assert.match(html, /font-family: 'Lato', Arial, Helvetica, sans-serif; font-size: 14px; line-height: 1\.5; mso-line-height-alt: 21px; font-weight: 400; color: #333333; Margin: 0; font-weight: 700;" align="center">15 %/);
  // Word: the code in Georgia (Playfair's Windows equivalent), the texts in the body's Arial (Lato's)
  assert.match(html, /<p class="mso-font-playfair" style="mso-line-height-rule: exactly; font-family: 'Playfair Display'[^"]*" align="center">TREUE15<\/p>/);
  assert.deepEqual(lintOutlookHtml(html, { maxImageWidth: MAIL_CARD_WIDTH, strict: true }), []);
  // version 1 keeps the classic coupon: the body font and the dark ink for the code
  const v1 = renderMailTemplateHtml({ ...docOf([{ type: "coupon", code: "TREUE15", headline: "15 %" }], style), v: 1 }, ctx());
  assert.match(v1, /font-family: 'Lato', Arial, Helvetica, sans-serif; font-size: 24px; line-height: 30px; font-weight: 700; letter-spacing: 2px; color: #111111;/);
  // a heading colour that vanishes on the card gives way to a readable ink
  const pale = renderMailTemplateHtml(docOf([{ type: "coupon", code: "PALE10" }], { headingColor: "#fafafa" }), ctx());
  assert.match(pale, /letter-spacing: 2px; color: #111111; Margin: 4px 0 6px;" align="center">PALE10/);
});

test("coupon with cta button: a filled button in the mail's button look, Outlook's padding on the cell; never invisible", () => {
  const style = { accentColor: "#008ccb", buttonTextColor: "#ffffff", buttonShape: "rounded" };
  const html = renderMailTemplateHtml(docOf([{ type: "coupon", code: "SOMMER10", headline: "10 %", cta: "button" }], style), ctx());
  const coupon = html.slice(html.indexOf("Dein Code"), html.indexOf(MAIL_FOOTER_MARKER));
  assert.match(coupon, /<td align="center" bgcolor="#008ccb" style="mso-line-height-rule: exactly; mso-padding-alt: 16px 30px 16px 30px; border-radius: 8px;" valign="top">/);
  assert.match(coupon, /<a href="https:\/\/motionsports\.de\/discount\/SOMMER10" target="_blank" style="font-size: 14px; line-height: 18px; color: #ffffff;[^"]*"><span style="color: #ffffff;">Code einlösen<\/span><\/a>/);
  assert.doesNotMatch(coupon, /&#8594;/, "no arrow link");
  assert.deepEqual(lint(html), []);
  // an accent that vanishes on the coupon's ground (black on a black column): the frame colour fills it
  const column = renderMailTemplateHtml(
    docOf([{ type: "section", background: "#111111", columns: [{ blocks: [{ type: "coupon", code: "SPALTE15", cta: "button" }] }, { blocks: [{ type: "text", text: "x", color: "#ffffff" }] }] }], {
      accentColor: "#111111",
      buttonTextColor: "#ffd400",
    }),
    ctx()
  );
  assert.match(column, /border: 2px dashed #ffffff;/);
  assert.match(column, /bgcolor="#ffffff" style="mso-line-height-rule: exactly; mso-padding-alt: /);
  assert.match(column, /<span style="color: #111111;">Code einlösen<\/span>/);
  assert.deepEqual(lint(column), []);
});

test("countdown (format 2): image in the block's colours, the phone variant hidden from Outlook, the line in the label colour", () => {
  const doc = docOf([{ id: "cd", type: "countdown", until: "2030-01-01T00:00:00Z", heading: "Endet in" }], DARK_STYLE);
  const html = renderMailTemplateHtml(doc, ctx({ slots: { cd: countdownSlot() } }));
  // the heading in the heading font, a readable heading colour, on the card
  assert.match(html, /bgcolor="#111111" style="mso-line-height-rule: exactly; padding: 24px 60px 8px;" valign="top">\s*<p class="mso-font-oswald" style="[^"]*'Oswald'[^"]*color: #ffffff;[^"]*" align="center">Endet in<\/p>/);
  // desktop image: Word sizes it by the content width; browsers by the CSS
  assert.match(html, /<img src="https:\/\/mo\.example\.com\/api\/email-countdown\/tok\?bg=111111&amp;tile=292929&amp;digit=ffd400&amp;label=a1a1a1&amp;cs=sig" width="480" height="99" alt="Dein Angebot gilt noch 3 Tage und 4 Stunden" border="0" class="cd-desk" style="width: 100%; max-width: 564px; height: auto; display: block; Margin: 0 auto;">/);
  assert.match(html, /<!--\[if !mso\]><!--><img src="https:\/\/mo\.example\.com\/api\/email-countdown\/tok\?w=m&amp;[^"]*" width="350" [^>]*class="cd-phone" style="[^"]*display: none;[^"]*"><!--<!\[endif\]-->/);
  // the swap rule only in a mail that has the phone image
  assert.match(html, /\.cd-desk \{ display: none !important; \}\s*\.cd-phone \{ display: block !important; \}/);
  assert.doesNotMatch(renderMailTemplateHtml(docOf([{ type: "text", text: "x" }]), ctx()), /cd-phone/);
  // the exact deadline under the image in the label colour (countdownLook)
  assert.match(html, /color: #a1a1a1; Margin: 8px 0 0;" align="center"><strong>Dein Angebot gilt noch 3 Tage 4 Stunden<\/strong> &#8212; bis Sa\., 12\.12\.2026, 23:59 Uhr<\/p>/);
  assert.deepEqual(lint(html), []);
  // without a signing secret: no image, only the line
  const bare = renderMailTemplateHtml(doc, ctx({ slots: { cd: countdownSlot({ imageUrl: null, imageUrlMobile: null }) } }));
  assert.doesNotMatch(bare, /<img [^>]*cd-desk|cd-phone/);
  assert.match(bare, /Margin: 0;" align="center"><strong>Dein Angebot gilt noch/);
});

test("countdown band: its background carries heading and image (the image's ground), spacing as set", () => {
  const doc = docOf([{ id: "cd", type: "countdown", until: "2030-01-01T00:00:00Z", heading: "Nur noch kurz", background: "#ffd400", padTop: 40, padBottom: 30 }], { accentColor: "#ffd400" });
  const html = renderMailTemplateHtml(doc, ctx({ slots: { cd: countdownSlot() } }));
  assert.match(html, /bgcolor="#ffd400" style="mso-line-height-rule: exactly; padding: 40px 60px 8px;" valign="top">\s*<p style="[^"]*color: #111111;[^"]*" align="center">Nur noch kurz/);
  assert.match(html, /bgcolor="#ffd400" style="mso-line-height-rule: exactly; padding: 4px 60px 30px;" valign="top">\s*<img /);
  const look = countdownLookOf(doc);
  assert.equal(look.bg, "#ffd400");
  assert.match(html, new RegExp(`color: ${look.label}; Margin: 8px 0 0;`));
  // no heading: the band's own default spacing around the image
  const noHeading = renderMailTemplateHtml(docOf([{ id: "cd", type: "countdown", until: "2030-01-01T00:00:00Z", background: "#ffd400" }]), ctx({ slots: { cd: countdownSlot() } }));
  assert.match(noHeading, /bgcolor="#ffd400" style="mso-line-height-rule: exactly; padding: 12px 60px 22px;" valign="top">\s*<img /);
});

test("countdown and products keep the pre-rendered rows of a version-1 document (and of a slot without data)", () => {
  const rows = '\n                <tr><td>KLASSISCH</td></tr>';
  const blocks = [{ id: "cd", type: "countdown", until: "2030-01-01T00:00:00Z", heading: "Endet in" }, { id: "pr", type: "products", refs: ["p1"], title: "Deals" }];
  const slots = { cd: { ...countdownSlot(), html: rows }, pr: { ...productsSlot("rows"), html: rows } };
  const v1 = renderMailTemplateHtml({ ...docOf(blocks), v: 1 }, ctx({ slots }));
  assert.equal(v1.split("KLASSISCH").length - 1, 2);
  assert.doesNotMatch(v1, /cd-desk|Beschreibung 1/);
  const legacy = renderMailTemplateHtml(docOf(blocks), ctx({ slots: { cd: { html: rows, text: "x" }, pr: { html: rows, text: "x" } } }));
  assert.equal(legacy.split("KLASSISCH").length - 1, 2);
});

test("products (format 2) rows: names in the heading font and colour, texts in the text colour, the button in the mail's look", () => {
  const style = { headingFont: "oswald", headingColor: "#1f4e3d", textColor: "#333333", accentColor: "#1f4e3d", buttonTextColor: "#ffffff", buttonShape: "rounded" };
  const html = renderMailTemplateHtml(docOf([{ id: "pr", type: "products", refs: ["p1", "p2"], title: "Für dich" }], style), ctx({ slots: { pr: productsSlot("rows") } }));
  const list = body(html);
  assert.match(list, /<p class="mso-font-oswald" style="[^"]*'Oswald'[^"]*font-size: 14px; line-height: 1\.35; mso-line-height-alt: 18\.9px;[^"]*color: #1f4e3d; Margin: 0 0 4px;" align="left"><a class="mso-font-oswald" href="https:\/\/motionsports\.de\/products\/p1" target="_blank" style="text-decoration: none; color: #1f4e3d;">Produkt 1<\/a><\/p>/);
  assert.match(list, /color: #333333; Margin: 0 0 8px;" align="left"><span style="text-decoration: line-through; color: #c61724;">499,00 €<\/span> <strong style="color: #333333;">399,00 €<\/strong><\/p>/);
  assert.match(list, /color: #333333; Margin: 0;" align="left">Beschreibung 1<\/p>/);
  assert.match(list, /bgcolor="#1f4e3d" style="mso-line-height-rule: exactly; mso-padding-alt: 12px 22px 12px 22px; border-radius: 8px;"/);
  assert.match(list, /<span style="color: #ffffff;">Zum Produkt<\/span>/);
  // picture in the left third, a hairline between the rows, the title in the heading colour
  assert.match(list, /<img src="https:\/\/cdn\.shopify\.com\/p1\.jpg" class="prow-image" alt="Produkt 1" border="0" width="140" height="140"/);
  assert.match(list, /border-top: 1px solid #e2e2e2;/);
  assert.match(list, /color: #1f4e3d;[^"]*" align="center">Für dich<\/p>/);
  assert.doesNotMatch(list, /#000000/, "no classic black");
  assert.deepEqual(lint(html), []);
});

test("products (format 2) grid and cards: 2-up tiles with the Outlook ghost table, each product on its own card", () => {
  const html = renderMailTemplateHtml(docOf([{ id: "pr", type: "products", refs: ["p1", "p2", "p3"], layout: "grid", cardColor: "#f4f6f8" }]), ctx({ slots: { pr: productsSlot("grid", 3) } }));
  const list = body(html);
  assert.equal((list.match(/class="grid-column"/g) ?? []).length, 3);
  assert.match(list, /<!--\[if mso\]><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td width="50%" valign="top"><!\[endif\]-->/);
  assert.match(list, /<!--\[if mso\]><\/td><\/tr><tr><td colspan="2" align="center" valign="top"><!\[endif\]-->/, "the odd last tile spans both columns");
  assert.equal((list.match(/bgcolor="#f4f6f8" style="width: 100%; direction: ltr; border-collapse: separate !important; border-spacing: 0; border-radius: 8px; background-color: #f4f6f8;"/g) ?? []).length, 3);
  assert.match(list, /class="grid-image" alt="Produkt 1" border="0" width="204" height="204"/, "the picture inside the card's padding");
  assert.deepEqual(lint(html), []);
  const rows = renderMailTemplateHtml(docOf([{ id: "pr", type: "products", refs: ["p1", "p2"], cardColor: "#1a1a1a", textColor: "#ffffff" }], DARK_STYLE), ctx({ slots: { pr: productsSlot("rows") } }));
  assert.equal((body(rows).match(/bgcolor="#1a1a1a" style="width: 100%;/g) ?? []).length, 2);
  assert.doesNotMatch(body(rows), /border-top: 1px solid/, "cards instead of hairlines");
  assert.match(body(rows), /text-decoration: none; color: #ffffff;">Produkt 1<\/a>/);
  assert.deepEqual(lint(rows), []);
});

test("products on a dark card: on the dark ground when the colours read, else on the white panel", () => {
  const readable = renderMailTemplateHtml(docOf([{ id: "pr", type: "products", refs: ["p1"] }], DARK_STYLE), ctx({ slots: { pr: productsSlot("rows", 1) } }));
  assert.doesNotMatch(body(readable), /<td bgcolor="#ffffff" align="center" style="background-color: #ffffff; border-radius: 8px; padding: 16px;">/);
  assert.match(body(readable), /color: #eeeeee; Margin: 0;" align="left">Beschreibung 1/);
  assert.match(body(readable), /<td class="content-pad" align="center" bgcolor="#111111" style="mso-line-height-rule: exactly; padding: 10px 60px 20px;"/);
  // black text on a black card (the style was never adapted): the classic white panel, inks that read on it
  const unreadable = renderMailTemplateHtml(docOf([{ id: "pr", type: "products", refs: ["p1"] }], { cardBackground: "#111111" }), ctx({ slots: { pr: productsSlot("rows", 1) } }));
  assert.match(body(unreadable), /<td bgcolor="#ffffff" align="center" style="background-color: #ffffff; border-radius: 8px; padding: 16px;">/);
  assert.match(body(unreadable), /padding: 10px 44px 20px;/, "the panel's padding comes out of the row's");
  assert.match(body(unreadable), /color: #111111; Margin: 0;" align="left">Beschreibung 1/);
  assert.deepEqual(lint(unreadable), []);
});

test("a dark showcase of every new look field renders Outlook-safe and under the size budget", () => {
  const doc = docOf(
    [
      { id: "cd", type: "countdown", until: "2030-01-01T00:00:00Z", heading: "Endet in", tileColor: "#262626", digitColor: "#f5c400", labelColor: "#bdbdbd", background: "#000000", padTop: 32, padBottom: 32 },
      { id: "cp", type: "coupon", code: "BLACKWEEK25", headline: "25 %", terms: "bis 30.11.", cardColor: "#1f1f1f", borderStyle: "solid", radius: 20, textColor: "#eeeeee", codeColor: "#f5c400", codeFont: "bebas", cta: "button", background: "#000000", padTop: 20 },
      { type: "section", columns: [{ blocks: [{ type: "coupon", code: "SPALTE15", cta: "button", borderStyle: "none", cardColor: "#262626" }] }, { blocks: [{ type: "coupon", code: "LINK10" }] }] },
      { id: "pg", type: "products", refs: ["p1", "p2", "p3", "p4"], layout: "grid", title: "Deals", cardColor: "#1c1c1c", textColor: "#ffffff" },
      { id: "pr", type: "products", refs: ["p1", "p2"], title: "Für dich", cardColor: "#1c1c1c" },
    ],
    DARK_STYLE
  );
  const slots = { cd: countdownSlot(), pg: productsSlot("grid", 4), pr: productsSlot("rows") };
  for (const previewPlaceholders of [false, true]) {
    const html = renderMailTemplateHtml(doc, ctx({ slots, previewPlaceholders }));
    assert.deepEqual(strictLint(html), [], `preview=${previewPlaceholders}`);
    assert.ok(bytes(html) < MAIL_SIZE_BUDGET_BYTES, `${bytes(html)} bytes`);
    assert.doesNotMatch(html, /undefined|NaN|null/);
  }
});

// ── Outlook for Windows (Word): what format 2 adds for it ────────────────────
// Everything below lives in conditional comments, mso-* properties, class
// attributes Word alone styles, or moves a space / line onto a cell — browsers
// render it pixel for pixel as before (checked with Chromium, 13.11.2026).

/** A Rundmail freeze: every first name becomes a per-recipient placeholder. */
const freezeNames = (t) => applyMergeFields(t, {}, (i, fb) => `{{mo:fn:${i}|${fb}}}`);
/** The Outlook twin of each button: the roundrect tag, the label's style and the label. */
const vmlButtons = (html) =>
  [...html.matchAll(/<!--\[if mso\]>(<v:roundrect [^>]*>)<w:anchorlock\/><center style="([^"]*)">([^<]*)<\/center><\/v:roundrect><!\[endif\]--><!--\[if !mso\]><!-->/g)].map((m) => ({ tag: m[1], style: m[2], label: m[3] }));

test("Outlook fonts: every font key shows in Word the Windows font its stack shows everywhere else", () => {
  for (const key of MAIL_FONT_KEYS) assert.equal(firstFontFamily(mailFontMsoStack(key)), windowsFontOf(mailFontStack(key)), key);
  // the condensed display fonts stay condensed (they were Arial before)
  assert.equal(firstFontFamily(mailFontMsoStack("oswald")), "Arial Narrow");
  assert.equal(firstFontFamily(mailFontMsoStack("bebas")), "Impact");
});

test("Outlook fonts: headings, own fonts, the coupon code, menus and product names get Word's equivalent — the body stays on the `*` rule", () => {
  const doc = docOf(
    [
      { type: "heading", text: "Black Week" },
      { type: "heading", text: "Wie der Text", font: "poppins" },
      { type: "text", text: "Spare **jetzt** auf [Racks](https://motionsports.de/collections/racks).", font: "georgia" },
      { type: "text", text: "- Eins\n- [Zwei](https://motionsports.de/a)", font: "playfair" },
      { type: "greeting", text: "Hallo {{vorname}},", fallback: "Hallo,", font: "bebas" },
      { type: "text", text: "Fließtext im Körper." },
      { type: "coupon", code: "BLACKWEEK25", headline: "25 %" },
      { type: "menu", font: "inter", items: [{ label: "Kraft", href: "https://motionsports.de/k" }] },
      { id: "pr", type: "products", refs: ["p1"] },
    ],
    { fontFamily: "montserrat", headingFont: "oswald" }
  );
  const html = renderMailTemplateHtml(doc, ctx({ slots: { pr: productsSlot("rows", 1) } }));
  assert.match(html, /<p class="mso-font-oswald" style="[^"]*" align="center">Black Week<\/p>/);
  assert.match(html, /<p style="[^"]*'Poppins'[^"]*" align="center">Wie der Text<\/p>/, "Poppins is Verdana in Word, like the body: no class");
  assert.match(html, /<p class="mso-font-georgia" style="[^"]*" align="left">Spare <strong class="mso-font-georgia">jetzt<\/strong> auf <a class="mso-font-georgia" href="https:\/\/motionsports\.de\/collections\/racks"/);
  assert.match(html, /<td class="mso-font-playfair" valign="top" width="18" [^>]*>&#8226;<\/td>\s*<td class="mso-font-playfair" valign="top" [^>]*><a class="mso-font-playfair" href="https:\/\/motionsports\.de\/a"/);
  assert.match(html, /<p class="mso-font-bebas" style="[^"]*" align="left">Hallo Anna,<\/p>/);
  assert.match(html, /<p style="mso-line-height-rule: exactly; direction: ltr; font-family: 'Montserrat'[^"]*" align="left">Fließtext im Körper\.<\/p>/);
  assert.match(html, /<p class="mso-font-oswald" style="[^"]*" align="center">BLACKWEEK25<\/p>/, "the code in the heading font");
  assert.match(html, /<p class="mso-font-inter" style="[^"]*" align="center"><a class="mso-font-inter" href="https:\/\/motionsports\.de\/k"/);
  assert.match(html, /<p class="mso-font-oswald" style="[^"]*" align="left"><a class="mso-font-oswald" href="https:\/\/motionsports\.de\/products\/p1"/);
  // the head declares exactly the classes in use, Arial Narrow with its fallback
  const used = [...new Set([...body(html).matchAll(/class="(mso-font-[a-z0-9-]+)"/g)].map((m) => m[1]))].sort();
  const declared = [...html.matchAll(/^ {6}\.(mso-font-[a-z0-9-]+) \{ font-family: ([^}]*) !important; \}$/gm)].map((m) => m[1]).sort();
  assert.deepEqual(used, ["mso-font-bebas", "mso-font-georgia", "mso-font-inter", "mso-font-oswald", "mso-font-playfair"]);
  assert.deepEqual(declared, used);
  assert.match(html, /@font-face \{ font-family: 'Arial Narrow'; mso-font-alt: Arial; mso-generic-font-family: swiss; \}/);
  assert.match(html, /\* \{ font-family: Verdana, Geneva, sans-serif !important; \}/);
  assert.deepEqual(strictLint(html), []);
  // without the classes Word would set all of it in the body's Verdana — the strict lint names each
  const collapsed = strictLint(html.replace(/ class="mso-font-[a-z0-9-]+"/g, ""));
  assert.ok(collapsed.filter((f) => f.rule === "font-word").length >= 8, JSON.stringify(collapsed.map((f) => f.rule)));
  // a version-1 document keeps its output: no classes, the classic head
  const v1 = renderMailTemplateHtml({ ...doc, v: 1 }, ctx({ slots: { pr: productsSlot("rows", 1) } }));
  assert.doesNotMatch(v1, /mso-font-|@font-face/);
});

test("Outlook buttons: a rounded or pill button gets a VML twin of its size, colours and link; a square one keeps the cell", () => {
  const button = (extra = {}, style = {}) => renderMailTemplateHtml(docOf([{ type: "button", label: "Jetzt sparen", href: "https://motionsports.de/sale", ...extra }], style), ctx());
  const verdana = "Verdana, Geneva, sans-serif";
  const width = (fontSize, label = "Jetzt sparen") => msoTextWidth(label, { fontSize, fontStack: verdana, letterSpacing: 0.5 });
  // pill (default): 2 × 14 px padding + 18 px line + 2 × 2 px border = 50 px high; the label + 2 × 28 px + 4 px wide
  const pill = button();
  const [p] = vmlButtons(pill);
  assert.equal(p.tag, `<v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="https://motionsports.de/sale" style="height:50px;v-text-anchor:middle;width:${width(14) + 60}px;" arcsize="50%" stroke="f" fillcolor="#008ccb">`);
  assert.equal(p.style, `color:#ffffff;font-family:${verdana};font-size:14px;font-weight:bold;letter-spacing:0.5px;`);
  assert.equal(p.label, "Jetzt&nbsp;sparen");
  assert.ok(width(14) + 60 >= 140 && width(14) + 60 <= 180, String(width(14) + 60));
  // the original stays for every other client, right after the twin
  assert.match(pill, /<!--\[if !mso\]><!-->\s*<table [^>]*>\s*<tr>\s*<td align="center" bgcolor="#008ccb" style="mso-line-height-rule: exactly; mso-padding-alt: 16px 30px 16px 30px; border-radius: 200px;"/);
  // rounded, small: 41 px high, 8 px of it the corner (20 %)
  const [r] = vmlButtons(button({ shape: "rounded", size: "s" }));
  assert.match(r.tag, new RegExp(`style="height:41px;v-text-anchor:middle;width:${width(13) + 44}px;" arcsize="20%" stroke="f" fillcolor="#008ccb">`));
  // outline: the border as the stroke (on the edge: 2 px smaller), no fill — the colour behind it, should Word fill anyway
  const [o] = vmlButtons(button({ outline: true, color: "#111111" }));
  assert.match(o.tag, new RegExp(`style="height:48px;v-text-anchor:middle;width:${width(14) + 58}px;" arcsize="50%" strokecolor="#111111" strokeweight="2px" fill="f" fillcolor="#ffffff">`));
  assert.match(o.style, /^color:#111111;/);
  // filled with an own border
  const [bd] = vmlButtons(button({ borderColor: "#000000", color: "#ffd400", textColor: "#111111", shape: "rounded" }));
  assert.match(bd.tag, /arcsize="17%" strokecolor="#000000" strokeweight="2px" fillcolor="#ffd400">/);
  // full width: the whole room — the card's 480 px, a column's own width
  assert.match(vmlButtons(button({ fullWidth: true }))[0].tag, /width:480px;/);
  const column = renderMailTemplateHtml(docOf([{ type: "section", columns: [{ blocks: [{ type: "button", label: "Los", href: "https://a.de", fullWidth: true }] }, { blocks: [{ type: "text", text: "x" }] }] }]), ctx());
  assert.match(vmlButtons(column)[0].tag, /width:230px;/);
  // square: the cell is the shape already
  assert.equal(vmlButtons(button({ shape: "square" })).length, 0);
  assert.equal(vmlButtons(button({}, { buttonShape: "square" })).length, 0);
  for (const html of [pill, column, button({ outline: true }), button({ size: "l", shape: "rounded" })]) assert.deepEqual(strictLint(html), []);
});

test("Outlook buttons: no twin where its width is unknown or too small — the square cell grows with its label", () => {
  // a Rundmail's per-recipient name: its length is unknown when the mail is frozen
  const named = docOf([{ type: "button", label: "{{vorname|Du}}, spar jetzt", href: "https://motionsports.de/sale" }]);
  assert.equal(vmlButtons(renderMailTemplateHtml(named, ctx({ merge: freezeNames }))).length, 0);
  assert.equal(vmlButtons(renderMailTemplateHtml(named, ctx())).length, 1, "the test mail and the preview know the name");
  // a long label in a narrow column would wrap
  const narrow = docOf([{ type: "section", columns: [0, 1, 2, 3].map(() => ({ blocks: [{ type: "button", label: "Alle Angebote der Black Week ansehen", href: "https://a.de" }, { type: "button", label: "Los", href: "https://b.de" }] })) }]);
  const html = renderMailTemplateHtml(narrow, ctx());
  assert.deepEqual(vmlButtons(html).map((b) => b.label), ["Los", "Los", "Los", "Los"]);
  assert.deepEqual(strictLint(html), []);
  // a version-1 document keeps its output
  assert.equal(vmlButtons(renderMailTemplateHtml({ ...docOf([{ type: "button", label: "Los", href: "https://a.de" }]), v: 1 }, ctx())).length, 0);
});

test("Outlook buttons: the coupon's button and the product rows' buttons get their twins; a frozen Rundmail tracks twin and original as one link", () => {
  const doc = docOf([{ type: "coupon", code: "X10", cta: "button" }, { id: "pr", type: "products", refs: ["p1", "p2"] }], { buttonShape: "rounded" });
  const html = renderMailTemplateHtml(doc, ctx({ slots: { pr: productsSlot("rows", 2) } }));
  const twins = vmlButtons(html);
  assert.deepEqual(twins.map((t) => /href="([^"]*)"/.exec(t.tag)?.[1]), ["https://motionsports.de/discount/X10", "https://motionsports.de/products/p1", "https://motionsports.de/products/p2"]);
  assert.deepEqual(twins.map((t) => t.label), ["Code&nbsp;einlösen", "Zum&nbsp;Produkt", "Zum&nbsp;Produkt"]);
  assert.deepEqual(strictLint(html), []);
  const frozen = freezeLinks({ html, text: "" }, { campaign: "bw" });
  const discount = frozen.links.findIndex((l) => l.url.includes("/discount/X10"));
  assert.ok(discount >= 0);
  assert.equal(frozen.html.split(`href="{{mo:link:${discount}}}"`).length - 1, 2, "the twin and the original share one index");
  assert.doesNotMatch(frozen.html, /href="https:\/\/motionsports\.de\/(discount|products)/);
});

test("Outlook line heights: a relative one carries its px value for Word; a line set tighter than its font is a minimum there", () => {
  const doc = docOf([
    { type: "text", text: "Vierzehn" },
    { type: "text", text: "Zwölf", size: "s" },
    { type: "heading", text: "Px" },
    { type: "heading", text: "Eng", fontSize: 48, lineHeight: 105, font: "bebas" },
    { type: "text", text: "- Eng\n- Liste", lineHeight: 110 },
    { type: "heading", text: "Weit", lineHeight: 150 },
  ]);
  const html = renderMailTemplateHtml(doc, ctx());
  assert.match(html, /font-size: 14px; line-height: 1\.5; mso-line-height-alt: 21px; font-weight: 400; color: #111111; Margin: 0;" align="left">Vierzehn/);
  assert.match(html, /font-size: 12px; line-height: 1\.5; mso-line-height-alt: 18px; [^"]*" align="left">Zwölf/);
  assert.match(html, /font-size: 26px; line-height: 33px; font-weight: 700; [^"]*" align="center">Px</, "px line heights need nothing");
  // 105 % / 110 %: Word takes the height as a minimum (an exact one would cut the tops of the letters)
  assert.match(html, /<p class="mso-font-bebas" style="direction: ltr; [^"]*font-size: 48px; line-height: 50px;[^"]*" align="center">Eng<\/p>/);
  assert.match(html, /<td valign="top" width="18" style="direction: ltr; [^"]*line-height: 15px;[^"]*">&#8226;<\/td>/);
  assert.match(html, /style="mso-line-height-rule: exactly; direction: ltr; [^"]*font-size: 26px; line-height: 39px;[^"]*" align="center">Weit/);
  assert.match(html.slice(html.indexOf(MAIL_FOOTER_MARKER)), /font-size: 11px; line-height: 1\.5; mso-line-height-alt: 16\.5px;/);
  assert.deepEqual(strictLint(html), []);
  // a version-1 document keeps its output
  const v1 = renderMailTemplateHtml({ ...doc, v: 1 }, ctx());
  assert.doesNotMatch(v1, /mso-line-height-alt: (?!1px)/);
  assert.match(v1, /style="mso-line-height-rule: exactly; direction: ltr; [^"]*font-size: 48px; line-height: 50px;/);
});

test("Outlook refinements never move a mail into a higher size zone (80 KB warning, 90 KB budget); `outlook: false` is the output before them", () => {
  const lists = 5;
  const doc = (n) =>
    docOf(
      [
        { type: "heading", text: "Black Week" },
        { type: "button", label: "Jetzt sparen", href: "https://motionsports.de/sale" },
        ...Array.from({ length: lists }, (_, k) => ({ id: `l${k}`, type: "products", refs: Array.from({ length: n }, (_, i) => `p${i}`), title: `Liste ${k}` })),
      ],
      { ...DARK_STYLE, buttonShape: "pill", fontFamily: "lato" }
    );
  const rows = (n) => ({
    ...productsSlot("rows", n),
    products: { layout: "rows", items: productsSlot("rows", n).products.items.map((it) => ({ ...it, name: `${it.name} — Hantelbank klappbar, schwarz-silber`, description: "Stabil, klappbar und platzsparend — die Bank für jedes Home-Gym, bis 300 kg belastbar." })) },
  });
  const twins = (html) => (html.match(/<v:roundrect /g) ?? []).length;
  const seen = new Set();
  for (let n = 1; n <= 8; n++) {
    const c = ctx({ slots: Object.fromEntries(Array.from({ length: lists }, (_, k) => [`l${k}`, rows(n)])) });
    const html = renderMailTemplateHtml(doc(n), c);
    const plain = renderMailTemplateHtml(doc(n), { ...c, outlook: false });
    assert.doesNotMatch(plain, /<v:roundrect|mso-font-|mso-line-height-alt: (?!1px)/, "no refinement at all");
    const zone = [80 * 1024, MAIL_SIZE_BUDGET_BYTES].find((z) => bytes(plain) <= z);
    if (zone === undefined) assert.equal(html, plain, `${n} per list: above the budget without them — exactly as before`);
    else assert.ok(bytes(html) <= zone, `${n} per list: ${bytes(html)} bytes over the zone of ${zone}`);
    assert.deepEqual(strictLint(html).filter((f) => f.rule !== "size" && !(html === plain && /^(font-word|line-height-word)$/.test(f.rule))), [], `${n} per list`);
    seen.add(html === plain ? "plain" : twins(html) === 1 + lists * n ? "all" : twins(html) === 1 ? "primary" : twins(html) === 0 ? "none" : `?${twins(html)}`);
  }
  assert.ok(seen.has("all") && seen.has("plain"), [...seen].join(", "));
  assert.ok(![...seen].some((s) => s.startsWith("?")), [...seen].join(", "));
});

test("Outlook lists: the space after a list sits in its last row's cells — Word drops a table's margin", () => {
  const doc = docOf([{ type: "text", text: "- Eins\n- Zwei\n\nDanach." }]);
  const html = renderMailTemplateHtml(doc, ctx());
  assert.match(
    html,
    /<table cellspacing="0" cellpadding="0" border="0" width="100%" role="presentation" style="direction: ltr;">\s*<tr>\s*<td valign="top" width="18" style="[^"]*Margin: 0;">&#8226;<\/td>\s*<td valign="top" style="[^"]*Margin: 0;">Eins<\/td>\s*<\/tr>\s*<tr>\s*<td valign="top" width="18" style="[^"]*Margin: 0; padding-bottom: 12px;">&#8226;<\/td>\s*<td valign="top" style="[^"]*Margin: 0; padding-bottom: 12px;">Zwei<\/td>/
  );
  assert.deepEqual(strictLint(html), []);
  // version 1 keeps the table's margin (its snapshots) — the lint names the trap
  const v1 = renderMailTemplateHtml({ ...doc, v: 1 }, ctx());
  assert.match(v1, /role="presentation" style="direction: ltr; Margin: 0 0 12px;"/);
  assert.deepEqual(lint(v1).map((f) => f.rule), ["table-margin"]);
  // the last list of a block needs no space after it
  const last = body(renderMailTemplateHtml(docOf([{ type: "text", text: "Davor.\n\n- Eins\n- Zwei" }]), ctx()));
  assert.doesNotMatch(last, /padding-bottom: 12px|role="presentation" style="direction: ltr; Margin: 0 0 12px;"/);
});
