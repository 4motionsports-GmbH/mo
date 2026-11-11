// Version 2 of the block document (11.11.2026): sections with columns,
// per-block styling, card colour, template fonts, the menu and product
// blocks — and that version-1 documents keep their exact JSON.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_MAIL_STYLE,
  MAIL_CHILD_BLOCK_TYPES,
  MAIL_FONT_KEYS,
  MAIL_TEMPLATE_DOC_VERSION,
  MAIL_TEMPLATE_LIMITS,
  MAIL_TEMPLATE_STARTERS,
  MAIL_TOP_ONLY_TYPES,
  classicFontFor,
  contrastRatio,
  docBlockCount,
  docFontKeys,
  docProductRefs,
  mailFontGoogleFamily,
  mailFontMsoStack,
  mailFontStack,
  normalizeColumnWidths,
  normalizeMailBlock,
  normalizeMailTemplateDoc,
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
