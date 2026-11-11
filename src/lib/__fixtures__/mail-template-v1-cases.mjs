// Version-1 block documents and render contexts whose output the template
// renderer (mail-template-render.mjs) must keep byte for byte: the HTML and
// text snapshots in ./mail-template-v1/ were captured from the version-1
// renderer right before the version-2 refactor (sections, columns, per-block
// styling — 11.11.2026). mail-template-render-v2.test.mjs compares every case
// against its snapshot; after an INTENDED change of the output, rewrite the
// snapshots with
//   MAIL_TEMPLATE_FIXTURES=update node --test src/lib/mail-template-render-v2.test.mjs
// and review the diff.
//
// Only version-1 fields appear here (no section, menu, product, no optional
// spacing / type fields) — between them the cases reach every branch of the
// version-1 renderer: each block type and alignment, backgrounds, empty
// images and slots with and without preview placeholders, the English
// labels, the Mo pieces of a personal mail (placed, flat and unplaced) and
// the AI label of the hero.

import { MAIL_TEMPLATE_STARTERS, applyMergeFields } from "../mail-template-doc.mjs";

export const FIXTURE_ASSETS = Object.freeze({
  logoUrl: "https://cdn.example.com/logo.png",
  shopUrl: "https://www.motionsports.de",
  imprintUrl: "https://motionsports.de/pages/impressum",
  socialLinks: [
    { alt: "instagram", icon: "https://cdn.example.com/ig.png", url: "https://instagram.com/x" },
    { alt: "facebook", icon: "https://cdn.example.com/fb.png", url: "https://facebook.com/x" },
  ],
  aiLabelIconUrl: "https://mo.example.com/eu-ai-icon-email.png",
});

export const FIXTURE_FOOTER = Object.freeze({
  unsubscribeHtml: '<p style="Margin: 0;" align="center">Abmelden: <a href="https://mo.example.com/api/unsubscribe?token=t">Abmelden</a>.</p>',
  unsubscribeText: "Abmelden: https://mo.example.com/api/unsubscribe?token=t",
});

/** The render context of a case (fixed year — the footer prints it). */
export function fixtureContext(extra = {}) {
  return { subject: "Black Week", preheader: "Bis zu 30 %", locale: "de", assets: FIXTURE_ASSETS, footer: FIXTURE_FOOTER, year: 2026, ...extra };
}

const mergeFor = (firstName) => (t) => applyMergeFields(t, { firstName });

/** A pre-rendered card row, the way mail-template-design.ts hands over product rows and the countdown. */
const slotRow = (inner) => `
                <tr>
                  <td class="content-pad" align="center" bgcolor="#ffffff" style="mso-line-height-rule: exactly; padding: 10px 60px 20px;" valign="top">${inner}</td>
                </tr>`;

const PRODUCT_SLOT = Object.freeze({
  html: slotRow('<img src="https://cdn.example.com/p.jpg" width="160" alt="Rack">'),
  text: "- Rack — 499,00 €\n  https://motionsports.de/products/rack",
});
const COUNTDOWN_SLOT = Object.freeze({
  html: slotRow('<img src="https://cdn.example.com/cd.gif" width="480" alt="Countdown">'),
  text: "Endet in 3 Tagen",
});

/** The composer's pieces of a personal mail (mail-template-design.ts moContext). */
const MO = Object.freeze({
  heading: "Deine persönliche Empfehlung",
  bodyHtml: `
                    <p style="Margin: 0;">Hallo Anna, MO-TEXT.</p>`,
  moAvatarUrl: "https://mo.example.com/mo.png",
  offerRowsHtml: slotRow("OFFER"),
  promoRowsHtml: slotRow("PROMO"),
  ctaRowsHtml: slotRow('<a href="https://motionsports.de/cart">CTA</a>'),
  footnoteRowHtml: slotRow("FOOTNOTE"),
  postCtaRowsHtml: slotRow("POST"),
  preCtaRowsHtml: slotRow("PRE"),
});

/** A starter with fixed block ids (the ids never reach the HTML, but a snapshot stays deterministic). */
function starterDoc(key) {
  const s = MAIL_TEMPLATE_STARTERS.find((x) => x.key === key);
  if (!s) throw new Error(`unknown starter ${key}`);
  const doc = s.build();
  return { ...doc, v: 1, blocks: doc.blocks.map((b, i) => ({ ...b, id: `s${i}` })) };
}

/** Every block type with content (the full document of mail-template-render.test.mjs). */
function fullDoc() {
  return {
    v: 1,
    style: { accentColor: "#ffd400", buttonTextColor: "#111111", outerBackground: "#111111", fontFamily: "arial", buttonShape: "square" },
    blocks: [
      { id: "logo", type: "logo" },
      { id: "band", type: "heading", text: "BLACK WEEK", size: "xl", background: "#111111", color: "#ffd400" },
      { id: "img", type: "image", src: "https://cdn.example.com/banner.gif", alt: "Black Week", href: "https://motionsports.de/collections/black-week" },
      { id: "greet", type: "greeting", text: "Hallo {{vorname}},", fallback: "Hallo," },
      { id: "txt", type: "text", text: "Spare **jetzt** auf [Racks](https://motionsports.de/collections/racks).\n\n- Hanteln\n- Bänke" },
      { id: "cp", type: "coupon", code: "BLACKWEEK25", headline: "25 % auf alles", terms: "Gültig bis 30.11." },
      { id: "cd", type: "countdown", until: "2030-11-30T22:59:00Z", heading: "Endet in" },
      { id: "pr", type: "products", title: "Deals", refs: ["rack"] },
      { id: "btn", type: "button", label: "{{vorname|Jetzt}} sparen", href: "https://motionsports.de", fullWidth: true },
      { id: "div", type: "divider" },
      { id: "sp", type: "spacer", height: 16 },
      { id: "so", type: "social" },
      { id: "h", type: "html", html: '<table role="presentation"><tr><td><p style="Margin:0">Eigenes <b>HTML</b></p></td></tr></table><script>alert(1)</script>' },
      { id: "ft", type: "footer", showSocial: true },
    ],
  };
}

/** Every alignment, size, colour and empty state of the version-1 blocks. */
function variantsDoc(style = {}) {
  return {
    v: 1,
    style: {
      accentColor: "#ffffff",
      buttonTextColor: "#111111",
      textColor: "#222222",
      headingColor: "#333333",
      outerBackground: "#eeeeee",
      fontFamily: "verdana",
      buttonShape: "rounded",
      logoUrl: null,
      ...style,
    },
    blocks: [
      { id: "l1", type: "logo", align: "left", width: 200 },
      { id: "l2", type: "logo", align: "center", width: 60 },
      { id: "h1", type: "heading", text: "Klein links", size: "s", align: "left", color: null, background: null },
      { id: "h2", type: "heading", text: "Mittel rechts {{vorname|du}}", size: "m", align: "right", color: "#aa0000", background: null },
      { id: "h3", type: "heading", text: "Band", size: "xl", align: "center", color: "#ffffff", background: "#000000" },
      { id: "t1", type: "text", text: "Klein und farbig.", size: "s", align: "center", color: "#444444", background: null },
      {
        id: "t2",
        type: "text",
        text: "Groß auf Farbe mit **fett** und https://motionsports.de/pages/faq.\nZweite Zeile.\n\n• Eins\n• Zwei mit [Link](https://motionsports.de/a)\n\nSchluss, {{vorname|du}}.",
        size: "l",
        align: "right",
        color: null,
        background: "#f0f0f0",
      },
      { id: "g1", type: "greeting", text: "Hi {{vorname}}!", fallback: "Hi!", align: "center" },
      { id: "i1", type: "image", src: "https://cdn.example.com/content.jpg", alt: "Inhalt", href: "", width: "content" },
      { id: "i2", type: "image", src: "", alt: "Leer", href: "", width: "full" },
      { id: "i3", type: "image", src: "", alt: "Leer", href: "", width: "content" },
      { id: "b1", type: "button", label: "Links", href: "https://motionsports.de/a", align: "left", color: null, textColor: null, fullWidth: false },
      { id: "b2", type: "button", label: "Rechts", href: "mailto:info@motionsports.de", align: "right", color: "#00aa00", textColor: "#ffffff", fullWidth: false },
      { id: "b3", type: "button", label: "Mitte", href: "tel:+49 8142 448666", align: "center", color: null, textColor: null, fullWidth: false },
      { id: "c1", type: "coupon", code: "SOMMER10", headline: "", terms: "" },
      { id: "c2", type: "coupon", code: "", headline: "leer", terms: "" },
      { id: "pr", type: "products", title: "", refs: ["rack"], layout: "grid" },
      { id: "cd", type: "countdown", until: "2030-01-01T00:00:00.000Z", heading: "" },
      { id: "d1", type: "divider", color: "#ff0000" },
      { id: "s1", type: "spacer", height: 80 },
      { id: "so", type: "social" },
      { id: "x1", type: "html", html: "<p>Nur <i>HTML</i></p>" },
      { id: "x2", type: "html", html: "<script>x()</script>" },
      { id: "ft", type: "footer", showSocial: false },
    ],
  };
}

/** A template for personal mails: logo, hero, Mo's text, offer and hint. */
function personalDoc(blocks) {
  return {
    v: 1,
    style: { fontFamily: "montserrat" },
    blocks: blocks ?? [
      { id: "lg", type: "logo", align: "center", width: 144 },
      { id: "he", type: "hero", src: "https://cdn.example.com/fallback.jpg", alt: "Szene", href: "https://motionsports.de", showHeadline: true },
      { id: "mc", type: "mo_content", showHeading: true },
      { id: "tx", type: "text", text: "Zwischen Text und Angebot.", size: "m", align: "left", color: null, background: null },
      { id: "mf", type: "mo_offer" },
      { id: "mp", type: "mo_promo" },
      { id: "ft", type: "footer", showSocial: true },
    ],
  };
}

/** @type {ReadonlyArray<{ name: string, doc: () => object, ctx: () => any }>} */
export const V1_RENDER_CASES = Object.freeze([
  ...MAIL_TEMPLATE_STARTERS.flatMap((s) => [
    { name: `starter-${s.key}-preview`, doc: () => starterDoc(s.key), ctx: () => fixtureContext({ previewPlaceholders: true }) },
    // A send of „Leer“ renders exactly like its preview, and the personal
    // starter without Mo's pieces exactly like „Leer“ — both kept once.
    ...(s.key === "leer" || s.key === "persoenlich"
      ? []
      : [{ name: `starter-${s.key}-send`, doc: () => starterDoc(s.key), ctx: () => fixtureContext({ merge: mergeFor("anna") }) }]),
  ]),
  {
    name: "full",
    doc: fullDoc,
    ctx: () => fixtureContext({ merge: mergeFor("anna"), slots: { pr: PRODUCT_SLOT, cd: COUNTDOWN_SLOT } }),
  },
  {
    name: "full-frozen",
    doc: fullDoc,
    ctx: () =>
      fixtureContext({
        merge: (t) => applyMergeFields(t, {}, (i, fb) => `{{mo:fn:${i}|${fb}}}`),
        greeting: () => "{{mo:greet:0}}",
        slots: { pr: PRODUCT_SLOT },
      }),
  },
  { name: "variants-preview", doc: () => variantsDoc(), ctx: () => fixtureContext({ previewPlaceholders: true, merge: mergeFor(null) }) },
  {
    name: "variants-en",
    doc: () => variantsDoc({ fontFamily: "georgia", buttonShape: "square", logoUrl: "https://cdn.example.com/own-logo.png", accentColor: "#c61724" }),
    ctx: () => fixtureContext({ locale: "en", preheader: null, previewPlaceholders: true, merge: mergeFor("TOM") }),
  },
  {
    name: "personal",
    doc: () => personalDoc(),
    ctx: () =>
      fixtureContext({
        merge: mergeFor("anna"),
        mo: MO,
        hero: { imageUrl: "https://cdn.example.com/hero.jpg", mobileUrl: "https://cdn.example.com/hero-m.jpg", headline: "Dein Setup", isAi: true },
      }),
  },
  { name: "personal-flat", doc: () => personalDoc(), ctx: () => fixtureContext({ mo: { ...MO, offerRowsHtml: null, promoRowsHtml: null, moAvatarUrl: null }, hero: null }) },
  {
    name: "personal-partial",
    doc: () =>
      personalDoc([
        { id: "he", type: "hero", src: "https://cdn.example.com/fallback.jpg", alt: "Szene", href: "", showHeadline: false },
        { id: "mc", type: "mo_content", showHeading: false },
        { id: "mp", type: "mo_promo" },
        { id: "ft", type: "footer", showSocial: false },
      ]),
    ctx: () => fixtureContext({ mo: MO, hero: { imageUrl: "https://cdn.example.com/photo.jpg", mobileUrl: null, headline: "Nie gezeigt", isAi: false } }),
  },
  {
    name: "personal-unplaced",
    doc: () =>
      personalDoc([
        { id: "lg", type: "logo", align: "center", width: 144 },
        { id: "tx", type: "text", text: "Ohne Mos Text.", size: "m", align: "left", color: null, background: null },
        { id: "ft", type: "footer", showSocial: true },
      ]),
    ctx: () => fixtureContext({ mo: MO }),
  },
]);
