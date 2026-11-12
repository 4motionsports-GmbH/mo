// Version 2 of the block document (11.11.2026): sections with columns,
// per-block styling, card colour, template fonts, the menu and product
// blocks — and that version-1 documents keep their exact JSON.
import { test } from "node:test";
import assert from "node:assert/strict";
import { V1_RENDER_CASES } from "./__fixtures__/mail-template-v1-cases.mjs";
import {
  DEFAULT_MAIL_STYLE,
  MAIL_BLOCK_CATALOG,
  MAIL_CHILD_BLOCK_TYPES,
  MAIL_FONT_KEYS,
  MAIL_TEMPLATE_DOC_VERSION,
  MAIL_TEMPLATE_LIMITS,
  MAIL_TEMPLATE_STARTERS,
  MAIL_TOP_ONLY_TYPES,
  classicFontFor,
  contrastRatio,
  countdownLook,
  docBlockCount,
  docFontKeys,
  docFormatVersion,
  docProductRefs,
  mailFontGoogleFamily,
  mailFontMsoStack,
  mailFontStack,
  mixColor,
  mutedInk,
  normalizeColumnWidths,
  normalizeMailBlock,
  normalizeMailTemplateDoc,
  readableInk,
  shadeOf,
  strongInk,
  validateMailTemplateDoc,
  walkMailBlocks,
} from "./mail-template-doc.mjs";

const V1_DOC = {
  v: 1,
  style: { accentColor: "#ffd400", fontFamily: "arial" },
  blocks: [
    { id: "lg", type: "logo", align: "center", width: 144 },
    { id: "hd", type: "heading", text: "Hallo", size: "l", align: "center", color: null, background: null },
    { id: "tx", type: "text", text: "Text", size: "m", align: "left", color: null, background: null },
    { id: "im", type: "image", src: "https://x.de/a.jpg", alt: "A", href: "", width: "content" },
    { id: "bt", type: "button", label: "Los", href: "https://motionsports.de/", align: "center", color: null, textColor: null, fullWidth: false },
    { id: "dv", type: "divider", color: null },
    { id: "sp", type: "spacer", height: 24 },
    { id: "ft", type: "footer", showSocial: true },
  ],
};

test("a version-1 document keeps its blocks byte for byte (new optional fields stay omitted)", () => {
  const doc = normalizeMailTemplateDoc(V1_DOC);
  assert.equal(doc.v, MAIL_TEMPLATE_DOC_VERSION);
  assert.deepEqual(doc.blocks, V1_DOC.blocks);
  // the style gains the v2 tokens with their defaults
  assert.equal(doc.style.cardBackground, "#ffffff");
  assert.equal(doc.style.contentPadding, 60);
  assert.equal(doc.style.cardRadius, 0);
  assert.equal(doc.style.headingFont, null);
  assert.equal(doc.style.linkColor, null);
  // normalising twice changes nothing (the editor's JSON dirty check relies on it)
  assert.deepEqual(normalizeMailTemplateDoc(doc), doc);
});

test("every starter still normalises to itself", () => {
  for (const s of MAIL_TEMPLATE_STARTERS) {
    const d = s.build();
    assert.deepEqual(normalizeMailTemplateDoc(d), d, s.key);
  }
});

test("style v2: card colour, heading font, link colour, side padding and radius are clamped", () => {
  const { style } = normalizeMailTemplateDoc({
    style: { cardBackground: "#111", headingFont: "oswald", linkColor: "#FFD400", contentPadding: 4, cardRadius: 99, fontFamily: "poppins" },
    blocks: [],
  });
  assert.equal(style.cardBackground, "#111111");
  assert.equal(style.headingFont, "oswald");
  assert.equal(style.linkColor, "#ffd400");
  assert.equal(style.contentPadding, 16);
  assert.equal(style.cardRadius, 24);
  assert.equal(style.fontFamily, "poppins");
  assert.equal(normalizeMailTemplateDoc({ style: { headingFont: "comic-sans" } }).style.headingFont, null);
  assert.deepEqual(Object.keys(DEFAULT_MAIL_STYLE), Object.keys(style));
});

test("template fonts: stacks, Outlook fallbacks, Google families, classic mapping", () => {
  assert.ok(MAIL_FONT_KEYS.includes("montserrat") && MAIL_FONT_KEYS.includes("oswald") && MAIL_FONT_KEYS.includes("playfair"));
  assert.match(mailFontStack("oswald"), /^'Oswald'/);
  assert.match(mailFontStack("arial"), /^Arial/);
  assert.match(mailFontStack("nope"), /Montserrat/);
  assert.equal(mailFontMsoStack("playfair"), "Georgia, 'Times New Roman', serif");
  assert.equal(mailFontGoogleFamily("montserrat"), "Montserrat:wght@400;700");
  assert.equal(mailFontGoogleFamily("arial"), null);
  assert.equal(mailFontGoogleFamily("bebas"), "Bebas+Neue");
  assert.equal(classicFontFor("poppins"), "verdana");
  assert.equal(classicFontFor("georgia"), "georgia");
  assert.equal(classicFontFor("zzz"), "montserrat");
});

test("optional block fields: kept when set and valid, omitted when unset or invalid", () => {
  const h = normalizeMailBlock({ type: "heading", text: "X", padTop: "8", padBottom: 500, fontSize: 90, weight: "bold", italic: true, uppercase: "yes", letterSpacing: -9, lineHeight: 120, font: "bebas" });
  assert.deepEqual(
    { padTop: h.padTop, padBottom: h.padBottom, fontSize: h.fontSize, weight: h.weight, italic: h.italic, uppercase: h.uppercase, letterSpacing: h.letterSpacing, lineHeight: h.lineHeight, font: h.font },
    { padTop: 8, padBottom: 120, fontSize: 72, weight: "bold", italic: true, uppercase: undefined, letterSpacing: -2, lineHeight: 120, font: "bebas" }
  );
  const plain = normalizeMailBlock({ type: "heading", text: "X", fontSize: "", padTop: null, font: "nope", letterSpacing: 0 });
  for (const k of ["padTop", "fontSize", "font", "letterSpacing", "italic"]) assert.equal(k in plain, false, k);
  const img = normalizeMailBlock({ type: "image", src: "https://x.de/a.png", width: "240", align: "right", radius: 12, background: "#eee" });
  assert.equal(img.width, 240);
  assert.equal(img.align, "right");
  assert.equal(img.radius, 12);
  assert.equal(img.background, "#eeeeee");
  assert.equal(normalizeMailBlock({ type: "image", width: 9999 }).width, 600);
  assert.equal(normalizeMailBlock({ type: "image", width: "wide" }).width, "full");
  const btn = normalizeMailBlock({ type: "button", label: "A", href: "https://a.de", size: "l", shape: "square", outline: true, borderColor: "#000" });
  assert.deepEqual([btn.size, btn.shape, btn.outline, btn.borderColor], ["l", "square", true, "#000000"]);
  assert.equal("size" in normalizeMailBlock({ type: "button", size: "m" }), false);
  const text = normalizeMailBlock({ type: "text", text: "- a\n- b", bullet: "✓", accentBar: "#ff0000" });
  assert.equal(text.bullet, "✓");
  assert.equal(text.accentBar, "#ff0000");
  assert.equal("bullet" in normalizeMailBlock({ type: "text", bullet: "x" }), false);
  const div = normalizeMailBlock({ type: "divider", thickness: 3, widthPct: 40, lineStyle: "dashed", align: "left" });
  assert.deepEqual([div.thickness, div.widthPct, div.lineStyle, div.align], [3, 40, "dashed", "left"]);
  const ft = normalizeMailBlock({ type: "footer", background: "#111111", textColor: "#ffffff" });
  assert.deepEqual([ft.background, ft.textColor], ["#111111", "#ffffff"]);
});

test("menu block: items need a label or a link, at most 8, links validated", () => {
  const m = normalizeMailBlock({
    type: "menu",
    items: [
      { label: "Kraft", href: "https://motionsports.de/search?q=kraft" },
      { label: "", href: "" },
      { label: "Böse", href: "javascript:alert(1)" },
      ...Array.from({ length: 10 }, (_, i) => ({ label: `L${i}`, href: "https://motionsports.de" })),
    ],
    separator: "·",
    fontSize: 40,
  });
  assert.equal(m.items.length, MAIL_TEMPLATE_LIMITS.menuItems);
  assert.deepEqual(m.items[1], { label: "Böse", href: "" });
  assert.equal(m.separator, "·");
  assert.equal(m.fontSize, 28);
  assert.equal(m.uppercase, true);
  assert.equal(m.bold, true);
});

test("product block: one catalog ref, display switches, default button label", () => {
  const p = normalizeMailBlock({ type: "product", ref: "atx®-hantelbank-klappbar-schwarz-silber", layout: "side", showDescription: true });
  assert.equal(p.ref, "atx®-hantelbank-klappbar-schwarz-silber");
  assert.equal(p.layout, "side");
  assert.equal(p.buttonLabel, "Zum Produkt");
  assert.equal(p.showImage, true);
  assert.equal(normalizeMailBlock({ type: "product", ref: "a b" }).ref, "");
  assert.equal(normalizeMailBlock({ type: "product", buttonLabel: "" }).buttonLabel, "");
});

test("sections: 1–4 columns, widths add up to 100, children limited to column types", () => {
  const doc = normalizeMailTemplateDoc({
    blocks: [
      {
        id: "s1",
        type: "section",
        background: "#111111",
        columns: [
          { width: 40, blocks: [{ type: "image", src: "https://x.de/a.jpg", alt: "a" }, { type: "products", refs: ["x"] }, { type: "section" }] },
          { blocks: [{ type: "heading", text: "Rechts" }, { type: "button", label: "Los", href: "https://motionsports.de" }] },
          {},
          {},
          { blocks: [{ type: "text", text: "fünfte Spalte fällt weg" }] },
        ],
        gap: 99,
        padX: 0,
      },
      { type: "footer" },
    ],
  });
  const s = doc.blocks[0];
  assert.equal(s.type, "section");
  assert.equal(s.columns.length, 4);
  assert.equal(s.columns.reduce((a, c) => a + c.width, 0), 100);
  assert.equal(s.columns[0].width, 40);
  assert.deepEqual(s.columns[0].blocks.map((b) => b.type), ["image"]); // products and a nested section are refused
  assert.deepEqual(s.columns[1].blocks.map((b) => b.type), ["heading", "button"]);
  assert.equal(s.gap, 48);
  assert.equal(s.padX, 0);
  assert.equal(s.stack, true);
  // a section inside a column is never kept; a top-level only type never enters a column
  for (const t of MAIL_TOP_ONLY_TYPES) assert.equal(normalizeMailBlock({ type: t }, new Set(), { inColumn: true }), null, t);
  for (const t of MAIL_CHILD_BLOCK_TYPES) assert.notEqual(normalizeMailBlock({ type: t }, new Set(), { inColumn: true }), null, t);
});

test("ids are unique across the whole tree — duplicates inside columns get new ids", () => {
  const doc = normalizeMailTemplateDoc({
    blocks: [
      { id: "a", type: "heading", text: "1" },
      { id: "s", type: "section", columns: [{ id: "a", blocks: [{ id: "a", type: "text", text: "x" }] }, { id: "c2", blocks: [{ id: "s", type: "text", text: "y" }] }] },
    ],
  });
  const ids = [];
  for (const b of doc.blocks) {
    ids.push(b.id);
    if (b.type === "section") for (const c of b.columns) {
      ids.push(c.id);
      for (const k of c.blocks) ids.push(k.id);
    }
  }
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(doc.blocks[0].id, "a");
  assert.equal(doc.blocks[1].id, "s");
  assert.equal(doc.blocks[1].columns[1].id, "c2");
});

test("the total block budget counts nested blocks; the footer is always kept", () => {
  const many = Array.from({ length: 12 }, (_, i) => ({ type: "text", text: `t${i}` }));
  const sections = Array.from({ length: 10 }, () => ({ type: "section", columns: [{ blocks: many }] }));
  const doc = normalizeMailTemplateDoc({ blocks: [...sections, { type: "footer" }] });
  assert.ok(docBlockCount(doc) <= MAIL_TEMPLATE_LIMITS.totalBlocks);
  assert.equal(doc.blocks.at(-1).type, "footer");
});

test("normalizeColumnWidths fills unset widths and always sums to 100", () => {
  assert.deepEqual(normalizeColumnWidths([0, 0]), [50, 50]);
  assert.deepEqual(normalizeColumnWidths([0, 0, 0]).reduce((a, b) => a + b, 0), 100);
  assert.deepEqual(normalizeColumnWidths([30, 0]), [30, 70]);
  assert.deepEqual(normalizeColumnWidths([60, 60]), [50, 50]);
  for (const w of [[1, 1, 1, 97], [95, 95, 95], [10, 0, 0, 0]]) {
    const r = normalizeColumnWidths(w);
    assert.equal(r.reduce((a, b) => a + b, 0), 100, String(w));
    assert.ok(r.every((x) => x >= 5), String(w));
  }
});

test("walkMailBlocks visits nested blocks; product refs, fonts and counts include them", () => {
  const doc = normalizeMailTemplateDoc({
    style: { fontFamily: "arial", headingFont: "oswald" },
    blocks: [
      { type: "products", refs: ["a", "b"] },
      { type: "section", columns: [{ blocks: [{ type: "product", ref: "c" }, { type: "heading", text: "H", font: "playfair" }] }, { blocks: [{ type: "product", ref: "a" }] }] },
    ],
  });
  const walked = walkMailBlocks(doc);
  assert.deepEqual(walked.map((w) => w.block.type), ["products", "section", "product", "heading", "product", "footer"]);
  assert.equal(walked[2].sectionId, doc.blocks[1].id);
  assert.equal(walked[4].columnIndex, 1);
  assert.deepEqual(docProductRefs(doc), ["a", "b", "c"]);
  assert.deepEqual(docFontKeys(doc), ["arial", "oswald", "playfair"]);
  assert.equal(docBlockCount(doc), 6);
});

test("validation recurses into columns and reports the child's id", () => {
  const doc = normalizeMailTemplateDoc({
    blocks: [
      { type: "heading", text: "Start" },
      {
        id: "sec",
        type: "section",
        columns: [
          { blocks: [{ id: "img", type: "image", src: "" }, { id: "btn", type: "button", label: "Los" }] },
          { blocks: [] },
        ],
      },
      { id: "emptysec", type: "section", columns: [{ blocks: [] }] },
      { id: "pr", type: "product" },
      { id: "mn", type: "menu", items: [{ label: "Nur Text" }] },
      { id: "hx", type: "html", html: "<p>Hallo {{vorname}}</p>" },
    ],
  });
  const { errors, warnings } = validateMailTemplateDoc(doc, "bulk");
  const errFor = (id) => errors.filter((e) => e.blockId === id).map((e) => e.message);
  assert.ok(errFor("img").some((m) => /Bild fehlt/.test(m)));
  assert.ok(errFor("btn").some((m) => /Link fehlt/.test(m)));
  assert.ok(errFor("emptysec").some((m) => /keinen Inhalt/.test(m)));
  assert.ok(errFor("pr").some((m) => /kein Produkt/.test(m)));
  assert.ok(errFor("mn").some((m) => /Text und Adresse/.test(m)));
  assert.ok(errFor("hx").some((m) => /nicht ersetzt/.test(m)));
  assert.ok(warnings.some((w) => w.blockId === "sec" && /leer/.test(w.message)));
});

test("contrast: unreadable text on its effective background is a warning", () => {
  assert.ok(Math.abs(contrastRatio("#000000", "#ffffff") - 21) < 0.01);
  assert.ok(Math.abs(contrastRatio("#777777", "#777777") - 1) < 0.01);
  const doc = normalizeMailTemplateDoc({
    style: { cardBackground: "#111111", textColor: "#222222" },
    blocks: [
      { id: "t1", type: "text", text: "dunkel auf dunkel" },
      { id: "s", type: "section", background: "#ffffff", columns: [{ blocks: [{ id: "t2", type: "text", text: "dunkel auf weiß" }] }] },
      { id: "b1", type: "button", label: "Los", href: "https://motionsports.de", color: "#ffd400", textColor: "#ffff00" },
      { id: "s2", type: "section", bgImage: "https://x.de/bg.jpg", columns: [{ blocks: [{ id: "t3", type: "text", text: "auf Bild" }] }] },
    ],
  });
  const { warnings } = validateMailTemplateDoc(doc, "bulk");
  const contrastFor = (id) => warnings.some((w) => w.blockId === id && /Kontrast/.test(w.message));
  assert.equal(contrastFor("t1"), true);
  assert.equal(contrastFor("t2"), false);
  assert.equal(contrastFor("b1"), true);
  assert.equal(contrastFor("t3"), false); // on a picture: not judged
  assert.ok(warnings.some((w) => w.blockId === "s2" && /Hintergrundfarbe/.test(w.message)));
});

test("unknown merge fields are found in every text field, also in columns and menus", () => {
  const doc = normalizeMailTemplateDoc({
    blocks: [
      { type: "section", columns: [{ blocks: [{ id: "m", type: "menu", items: [{ label: "Hi {{vornme}}", href: "https://motionsports.de" }] }] }] },
      { id: "p", type: "product", ref: "x", buttonLabel: "{{name}}" },
      { id: "c", type: "coupon", code: "AB12", headline: "ok", terms: "{{bis}}" },
    ],
  });
  const { errors } = validateMailTemplateDoc(doc, "bulk");
  for (const id of ["m", "p", "c"]) assert.ok(errors.some((e) => e.blockId === id && /Unbekannter Platzhalter/.test(e.message)), id);
});

test("product contrast: the name in the heading colour is judged too", () => {
  const doc = normalizeMailTemplateDoc({
    style: { headingColor: "#fafafa", textColor: "#111111", cardBackground: "#ffffff" },
    blocks: [{ id: "p", type: "product", ref: "atx-hantelbank" }, { id: "f", type: "footer" }],
  });
  const v = validateMailTemplateDoc(doc, "bulk");
  assert.ok(v.warnings.some((w) => w.blockId === "p" && /Kontrast/.test(w.message)));
  const ok = validateMailTemplateDoc(normalizeMailTemplateDoc({ blocks: [{ id: "p", type: "product", ref: "x" }, { id: "f", type: "footer" }] }), "bulk");
  assert.ok(!ok.warnings.some((w) => /Kontrast/.test(w.message)));
});

test("text on a background picture is judged against the fallback colour", () => {
  const sec = (background) =>
    normalizeMailTemplateDoc({
      blocks: [
        { id: "s", type: "section", bgImage: "https://x.de/banner.jpg", background, columns: [{ id: "c", blocks: [{ id: "h", type: "heading", text: "Black Week", color: "#111111" }] }] },
        { id: "f", type: "footer" },
      ],
    });
  assert.ok(validateMailTemplateDoc(sec("#000000"), "bulk").warnings.some((w) => w.blockId === "h" && /Kontrast/.test(w.message)));
  assert.ok(!validateMailTemplateDoc(sec(null), "bulk").warnings.some((w) => w.blockId === "h" && /Kontrast/.test(w.message)));
});

// ── addresses and custom HTML ────────────────────────────────────────────────

/** The validation errors of a document (bulk unless said otherwise). */
const errorsOf = (raw, use = "bulk") => validateMailTemplateDoc(normalizeMailTemplateDoc(raw), use).errors;
const LINK = /Platzhalter wie \{\{vorname\}\} werden in Links nicht ersetzt — Link ohne Platzhalter eintragen\./;
const TEXT_LINK = /Platzhalter wie \{\{vorname\}\} werden in Links nicht ersetzt — nur im Linktext verwenden, nicht in der Adresse\./;
const IMAGE = /Platzhalter wie \{\{vorname\}\} werden in Bildadressen nicht ersetzt\./;
const HTML_LINK = /Eigenes HTML: Platzhalter werden in Links und Bildadressen nicht ersetzt/;

test("a placeholder in any address is an error — links are never personalised (the link text may hold {{vorname}})", () => {
  const cases = [
    [{ type: "button", label: "Los", href: "https://motionsports.de/?n={{vorname}}" }, LINK],
    [{ type: "button", label: "Los", href: "https://motionsports.de/{{vorname}}" }, LINK], // the path: percent-encoded by the URL parser
    [{ type: "button", label: "Los", href: "mailto:info@motionsports.de?subject={{vorname}}" }, LINK],
    [{ type: "image", src: "https://x.de/a.jpg", alt: "a", href: "https://x.de/#{{vorname}}" }, LINK],
    [{ type: "image", src: "https://x.de/{{vorname}}.jpg", alt: "a" }, IMAGE],
    [{ type: "menu", items: [{ label: "A", href: "https://x.de/a" }, { label: "B", href: "https://x.de/?b={{vorname|x}}" }] }, LINK],
    [{ type: "section", background: "#000000", bgImage: "https://x.de/{{vorname}}.jpg", columns: [{ blocks: [{ type: "text", text: "x" }] }] }, /Hintergrundbilds nicht ersetzt/],
    [{ type: "text", text: "Dein [Link](https://motionsports.de/pages/aktion?name={{vorname}})" }, TEXT_LINK],
    [{ type: "text", text: "Siehe https://motionsports.de/{{vorname}}." }, TEXT_LINK],
    [{ type: "text", text: "Siehe [x](https://motionsports.de/%7B%7Bvorname%7D%7D)" }, TEXT_LINK],
    [{ type: "text", text: 'Siehe <a href="https://x.de/?a={{ vorname }}">x</a>' }, TEXT_LINK],
    [{ type: "html", html: '<a href="https://x.de/%7b%7bvorname%7d%7d">x</a>' }, HTML_LINK],
    [{ type: "html", html: '<table><tr><td background="https://x.de/?n=&#123;&#123;vorname&#125;&#125;">x</td></tr></table>' }, HTML_LINK],
  ];
  for (const [block, re] of cases) {
    const where = JSON.stringify(block);
    const top = errorsOf({ blocks: [{ type: "heading", text: "Start" }, { id: "x", ...block }] });
    assert.ok(top.some((e) => e.blockId === "x" && re.test(e.message)), `${where}: ${JSON.stringify(top)}`);
    if (block.type === "section") continue;
    // inside a column: the child's id
    const nested = errorsOf({ blocks: [{ type: "section", columns: [{ blocks: [{ id: "k", ...block }] }] }] });
    assert.ok(nested.some((e) => e.blockId === "k" && re.test(e.message)), `nested ${where}`);
  }
  // the hero of a personal template and the logo address of the style
  const hero = errorsOf({ blocks: [{ id: "h", type: "hero", src: "https://x.de/{{vorname}}.jpg", alt: "a", href: "https://x.de/?n={{vorname}}" }, { type: "mo_content" }] }, "personal");
  assert.ok(hero.some((e) => e.blockId === "h" && IMAGE.test(e.message)));
  assert.ok(hero.some((e) => e.blockId === "h" && LINK.test(e.message)));
  const logo = errorsOf({ style: { logoUrl: "https://cdn.x.de/{{vorname}}.png" }, blocks: [{ type: "logo" }] });
  assert.ok(logo.some((e) => e.blockId === null && /Logo-Adresse nicht ersetzt/.test(e.message)));
  // placeholders in link texts and in the text itself stay allowed
  const fine = errorsOf({
    style: { logoUrl: "https://cdn.x.de/logo.png" },
    blocks: [
      { type: "text", text: "Hallo {{vorname|du}}, hier ist [dein Link, {{vorname}}](https://motionsports.de/pages/aktion) und https://motionsports.de/ {{vorname}}" },
      { type: "button", label: "Los, {{vorname}}", href: "https://motionsports.de/" },
      { type: "menu", items: [{ label: "Hi {{vorname}}", href: "https://motionsports.de/a" }] },
      { type: "html", html: '<a href="https://motionsports.de/">Shop</a>' },
    ],
  });
  assert.deepEqual(fine, []);
});

const STRUCTURE = /^Eigenes HTML: unvollständige Tabellen- oder Bereichs-Tags \((.+)\) — der Baustein würde die Mail darunter zerstören\.$/;
/** The structure / document errors of an html block (top level and in a column). */
const htmlErrors = (html) => {
  const top = errorsOf({ blocks: [{ type: "heading", text: "x" }, { id: "hx", type: "html", html }] }).filter((e) => e.blockId === "hx").map((e) => e.message);
  const nested = errorsOf({ blocks: [{ type: "section", columns: [{ blocks: [{ id: "hk", type: "html", html }] }] }] }).filter((e) => e.blockId === "hk").map((e) => e.message);
  assert.deepEqual(nested, top, html);
  return top;
};

test("custom HTML that would break out of its cell is an error — judged as the renderer inserts it", () => {
  const hint = (html) => htmlErrors(html).map((m) => STRUCTURE.exec(m)?.[1]).filter(Boolean);
  // the reviewer's breakout: it closes the mail's cell and tables and hides the footer in a div
  assert.deepEqual(hint('<p>Danke fürs Lesen.</p></td></tr></tbody></table></center></td></tr></tbody></table><div style="display:none">'), ["</td> ohne öffnendes <td>"]);
  assert.deepEqual(hint('<p>Danke.</p><div style="display:none">'), ["<div> wird nicht geschlossen"]);
  assert.deepEqual(hint("<table><tr><td>offen</td></tr>"), ["<table> wird nicht geschlossen"]);
  assert.deepEqual(hint("<td>neben der Mail</td>"), ["<td> außerhalb einer eigenen Tabellenzeile"]);
  assert.deepEqual(hint("<tr><td>x</td></tr>"), ["<tr> außerhalb einer eigenen Tabelle"]);
  assert.deepEqual(hint("</center><p>x</p>"), ["</center> ohne öffnendes <center>"]);
  // the 20,000-character cut inside a table leaves it open
  assert.deepEqual(hint(`<table><tr><td>${"x".repeat(MAIL_TEMPLATE_LIMITS.htmlChars)}</td></tr></table>`), ["<td> wird nicht geschlossen"]);
  // comments are removed before the check — an Outlook-only opener neither counts nor balances
  assert.deepEqual(hint("<!--[if mso]><table><tr><td><![endif]--><p>x</p><!--[if mso]></td></tr></table><![endif]-->"), []);
  assert.deepEqual(hint("<!--[if mso]><table><tr><td><![endif]--><p>x</p></td></tr></table>"), ["</td> ohne öffnendes <td>"]);
  // a whole page: only its content belongs in the block
  const page = htmlErrors("<!DOCTYPE html><html><head><title>T</title></head><body><table><tr><td>Inhalt</td></tr></table></body></html>");
  assert.equal(page.length, 1, JSON.stringify(page));
  assert.match(page[0], /^Eigenes HTML: Bitte nur den Inhalt einfügen — ohne <html>, <head> und <body>; den Rahmen der Mail baut die Vorlage\.$/);
  // balanced HTML is fine (and so is a plain text with angle brackets)
  for (const ok of [
    "<p>Nur Text</p>",
    '<table role="presentation" width="100%"><tr><td style="padding: 8px;"><a href="https://www.motionsports.de/">Shop</a></td></tr></table>',
    "<center><div><table><tbody><tr><th>a</th><td><table><tr><td>b</td></tr></table></td></tr></tbody></table></div></center>",
    "<p>Preis < 30 € und > 10 €</p>",
  ]) {
    assert.deepEqual(htmlErrors(ok), [], ok);
  }
});

test("no starter, fixture or showcase document trips the address and custom-HTML rules", () => {
  const NEW_RULES = /in Links nicht ersetzt|in Bildadressen nicht ersetzt|Hintergrundbilds nicht ersetzt|Logo-Adresse nicht ersetzt|unvollständige Tabellen|Bitte nur den Inhalt einfügen|Links und Bildadressen/;
  const docs = [...MAIL_TEMPLATE_STARTERS.map((st) => [st.key, st.build()]), ...V1_RENDER_CASES.map((c) => [c.name, c.doc()])];
  for (const [name, doc] of docs) {
    for (const use of ["template", "bulk", "personal"]) {
      const bad = validateMailTemplateDoc(normalizeMailTemplateDoc(doc), use).errors.filter((e) => NEW_RULES.test(e.message));
      assert.deepEqual(bad, [], `${name} (${use})`);
    }
  }
});

// ── the fixed blocks in the mail's look (12.11.2026) ─────────────────────────

test("coupon, countdown, products: the look fields are kept when valid, omitted when unset or invalid, numbers clamped", () => {
  const c = normalizeMailBlock({
    type: "coupon",
    code: "bw25",
    cardColor: "#FFF",
    borderStyle: "solid",
    radius: "30",
    textColor: "#222222",
    codeColor: "#ffd400",
    codeFont: "bebas",
    cta: "button",
    padTop: 8,
  });
  assert.deepEqual(
    [c.cardColor, c.borderStyle, c.radius, c.textColor, c.codeColor, c.codeFont, c.cta, c.padTop],
    ["#ffffff", "solid", 24, "#222222", "#ffd400", "bebas", "button", 8]
  );
  // defaults are never stored: dashed, 8 px, the link
  const plain = normalizeMailBlock({ type: "coupon", code: "X1", borderStyle: "dashed", radius: 8, cta: "link", cardColor: "red", codeFont: "comic", codeColor: "" });
  for (const k of ["cardColor", "borderStyle", "radius", "textColor", "codeColor", "codeFont", "cta"]) assert.equal(k in plain, false, k);
  assert.equal(normalizeMailBlock({ type: "coupon", radius: -4 }).radius, 0);
  assert.equal(normalizeMailBlock({ type: "coupon", borderStyle: "none" }).borderStyle, "none");
  assert.equal("borderStyle" in normalizeMailBlock({ type: "coupon", borderStyle: "double" }), false);

  const cd = normalizeMailBlock({ type: "countdown", until: "2030-01-01T00:00:00Z", tileColor: "#262626", digitColor: "#F5C400", labelColor: "#bdbdbd", background: "#111", padTop: 500, padBottom: "12" });
  assert.deepEqual(
    [cd.tileColor, cd.digitColor, cd.labelColor, cd.background, cd.padTop, cd.padBottom],
    ["#262626", "#f5c400", "#bdbdbd", "#111111", 120, 12]
  );
  const bare = normalizeMailBlock({ type: "countdown", tileColor: "rgb(0,0,0)", digitColor: null });
  assert.deepEqual(Object.keys(bare), ["id", "type", "until", "heading"]);

  const pr = normalizeMailBlock({ type: "products", refs: ["rack"], cardColor: "#1a1a1a", textColor: "#FFFFFF", padTop: 10 });
  assert.deepEqual([pr.cardColor, pr.textColor, "padTop" in pr], ["#1a1a1a", "#ffffff", false]);
  assert.deepEqual(Object.keys(normalizeMailBlock({ type: "products", refs: ["rack"], cardColor: "#12" })), ["id", "type", "title", "refs", "layout"]);
  // every new field is documented in the catalog (the KI-Gestalter's interface)
  for (const [type, keys] of [
    ["coupon", ["cardColor", "borderStyle", "radius", "textColor", "codeColor", "codeFont", "cta", "padTop", "padBottom", "background"]],
    ["countdown", ["tileColor", "digitColor", "labelColor", "padTop", "padBottom", "background"]],
    ["products", ["cardColor", "textColor"]],
  ]) {
    for (const k of keys) assert.ok(MAIL_BLOCK_CATALOG[type].fields[k], `${type}.${k}`);
  }
  // normalising twice changes nothing
  const doc = normalizeMailTemplateDoc({ blocks: [c, cd, pr] });
  assert.deepEqual(normalizeMailTemplateDoc(doc), doc);
});

test("countdownLook: own colours first, else the automatic look of the style", () => {
  // the default style: white ground, the classic light-grey tile, accent digits, a muted grey
  assert.deepEqual(countdownLook({}, DEFAULT_MAIL_STYLE), { bg: "#ffffff", tile: "#f5f5f5", digit: "#008ccb", label: "#646464" });
  // a dark card: lighter tiles, the accent (it reads on them), a light muted label
  const dark = { ...DEFAULT_MAIL_STYLE, cardBackground: "#111111", textColor: "#eeeeee", headingColor: "#ffffff", accentColor: "#ffd400" };
  const d = countdownLook({}, dark);
  assert.deepEqual(d, { bg: "#111111", tile: "#292929", digit: "#ffd400", label: "#a1a1a1" });
  assert.ok(contrastRatio(d.tile, d.bg) >= 1.22, "visibly different");
  assert.ok(contrastRatio(d.label, d.bg) >= 4.5 && contrastRatio(d.label, d.tile) >= 4.5, "the label reads on ground and tiles");
  // the block's background is the ground; an accent that vanishes on the tiles gives way to the heading colour
  const band = countdownLook({ background: "#ffd400" }, { ...DEFAULT_MAIL_STYLE, accentColor: "#ffd400", headingColor: "#111111" });
  assert.equal(band.bg, "#ffd400");
  assert.equal(band.digit, "#111111");
  assert.ok(contrastRatio(band.label, band.bg) >= 4.5);
  // text colour unreadable on the card (black on black): the label switches to a light ink
  const black = countdownLook({}, { ...DEFAULT_MAIL_STYLE, cardBackground: "#000000" });
  assert.ok(contrastRatio(black.label, "#000000") >= 4.5);
  // own colours win, the rest still adapts to them
  const own = countdownLook({ tileColor: "#ffffff", digitColor: "#c61724", labelColor: "#333333" }, dark);
  assert.deepEqual(own, { bg: "#111111", tile: "#ffffff", digit: "#c61724", label: "#333333" });
  assert.equal(countdownLook({ tileColor: "#ffffff" }, dark).digit, "#111111", "yellow on white does not read: the stronger ink");
});

test("colour helpers: mixColor, shadeOf, mutedInk, readableInk", () => {
  assert.equal(mixColor("#000000", "#ffffff", 0.5), "#808080");
  assert.equal(mixColor("#ffffff", "#000000", 0.04), "#f5f5f5");
  assert.equal(mixColor("nope", "#ffffff", 0.5), "nope");
  assert.equal(shadeOf("#ffffff"), "#f5f5f5");
  assert.equal(shadeOf("#111111"), "#292929");
  for (const g of ["#ffffff", "#000000", "#ffd400", "#008ccb", "#7c3aed", "#1f2937", "#fafafa"]) {
    const s = shadeOf(g);
    assert.notEqual(s, g, g);
    assert.ok(contrastRatio(s, g) >= 1.08, `${g} → ${s}`);
  }
  assert.equal(mutedInk("#111111", "#ffffff"), "#646464");
  for (const [base, grounds] of [["#111111", ["#ffffff"]], ["#ffffff", ["#111111", "#292929"]], ["#777777", ["#808080"]], ["#ffd400", ["#ffffff"]]]) {
    const m = mutedInk(base, grounds);
    for (const g of grounds) assert.ok(contrastRatio(m, g) >= 4.5, `${base} on ${g} → ${m}`);
  }
  assert.equal(readableInk("#767676", "#ffffff"), "#767676"); // 4.54 : 1
  assert.equal(readableInk("#777777", "#ffffff"), "#111111"); // 4.48 : 1
  assert.equal(readableInk("#eeeeee", "#ffffff"), "#111111");
  assert.equal(readableInk("#eeeeee", "#111111", 4.5, "#ff0000"), "#eeeeee");
  assert.equal(strongInk("#000000"), "#ffffff");
});

test("docFormatVersion: a raw version-1 document reads as 1, everything else as the current format", () => {
  assert.equal(docFormatVersion({ v: 1, blocks: [] }), 1);
  assert.equal(docFormatVersion(JSON.stringify({ v: 1 })), 1);
  assert.equal(docFormatVersion({ v: 2 }), MAIL_TEMPLATE_DOC_VERSION);
  assert.equal(docFormatVersion({ blocks: [] }), MAIL_TEMPLATE_DOC_VERSION, "no v: an import, AI output");
  for (const raw of [null, "{", [], { v: "1" }, { v: 0 }, { v: 1.5 }, { v: 99 }]) assert.equal(docFormatVersion(raw), MAIL_TEMPLATE_DOC_VERSION, JSON.stringify(raw));
  // normalising writes the current version
  assert.equal(docFormatVersion(normalizeMailTemplateDoc({ v: 1, blocks: [] })), MAIL_TEMPLATE_DOC_VERSION);
});

test("contrast of the new colour pairs: own colours are judged on the card / tiles / ground", () => {
  const doc = normalizeMailTemplateDoc({
    style: { accentColor: "#ffd400", buttonTextColor: "#ffffff" },
    blocks: [
      { id: "c1", type: "coupon", code: "A10", headline: "x", cardColor: "#111111", textColor: "#222222", codeColor: "#333333", accent: "#1a1a1a" },
      { id: "c2", type: "coupon", code: "B10", headline: "x", cta: "button" },
      { id: "c3", type: "coupon", code: "C10", headline: "x", cardColor: "#111111", textColor: "#ffffff", codeColor: "#ffd400" },
      { id: "d1", type: "countdown", until: "2099-01-01T00:00:00Z", tileColor: "#eeeeee", digitColor: "#ffffff", labelColor: "#f0f0f0" },
      { id: "d2", type: "countdown", until: "2099-01-01T00:00:00Z", background: "#111111" },
      { id: "p1", type: "products", refs: ["x"], cardColor: "#ffffff", textColor: "#fafafa" },
      { id: "p2", type: "products", refs: ["x"], cardColor: "#111111", textColor: "#ffffff" },
      { id: "f", type: "footer" },
    ],
  });
  const { warnings } = validateMailTemplateDoc(doc, "bulk", { now: new Date("2026-11-12T00:00:00Z") });
  const of = (id) => warnings.filter((w) => w.blockId === id && /Kontrast/.test(w.message)).map((w) => w.message);
  const c1 = of("c1");
  assert.ok(c1.some((m) => /Schrift auf dem Hintergrund/.test(m)), "text on the card");
  assert.ok(c1.some((m) => /Code auf der Karte/.test(m)));
  assert.ok(c1.some((m) => /Überschrift in der Rahmenfarbe/.test(m)));
  assert.ok(of("c2").some((m) => /Button-Schrift auf der Buttonfarbe/.test(m)), "white on yellow");
  assert.deepEqual(of("c3"), []);
  const d1 = of("d1");
  assert.ok(d1.some((m) => /Ziffern auf den Kacheln/.test(m)));
  assert.ok(d1.some((m) => /Beschriftung auf dem Hintergrund/.test(m)));
  assert.ok(d1.some((m) => /Beschriftung auf den Kacheln/.test(m)));
  assert.deepEqual(of("d2"), [], "the automatic look always reads");
  assert.ok(of("p1").length === 1);
  assert.deepEqual(of("p2"), []);
});
