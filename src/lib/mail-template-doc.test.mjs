import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_MAIL_STYLE,
  MAIL_BLOCK_CATALOG,
  MAIL_BLOCK_TYPES,
  MAIL_TEMPLATE_FILE_FORMAT,
  MAIL_TEMPLATE_LIMITS,
  MAIL_TEMPLATE_STARTERS,
  applyMergeFields,
  blockCatalogForPrompt,
  cleanHref,
  cleanUrl,
  docHasHero,
  docProductRefs,
  docSupportsPersonal,
  normalizeFirstName,
  normalizeMailBlock,
  normalizeMailTemplateDoc,
  parseTemplateDesignKey,
  parseTemplateImport,
  templateDesignKey,
  stripMoBlocks,
  templateExportFile,
  unknownMergeFields,
  validateMailTemplateDoc,
} from "./mail-template-doc.mjs";

test("the catalog describes every block type with label, group, description and uses", () => {
  for (const type of MAIL_BLOCK_TYPES) {
    const c = MAIL_BLOCK_CATALOG[type];
    assert.ok(c.label && c.description, type);
    assert.ok(["inhalt", "angebot", "mo", "rahmen"].includes(c.group), type);
    assert.ok(c.personal || c.bulk, type);
  }
  // Mo blocks only make sense in personal mails.
  for (const t of ["hero", "mo_content", "mo_offer", "mo_promo"]) assert.equal(MAIL_BLOCK_CATALOG[t].bulk, false, t);
  const prompt = blockCatalogForPrompt();
  for (const type of MAIL_BLOCK_TYPES) assert.ok(prompt.includes(`- ${type} (`), type);
});

test("cleanUrl / cleanHref: only absolute https (and mailto:/tel: for links)", () => {
  assert.equal(cleanUrl("https://motionsports.de/a b"), "https://motionsports.de/a%20b");
  for (const bad of ["http://x.de", "javascript:alert(1)", "data:image/png;base64,AA", "//x.de/a", "/relative", "https://user:pw@x.de", "", null]) {
    assert.equal(cleanUrl(bad), "", String(bad));
  }
  assert.equal(cleanHref("mailto:info@motionsports.de"), "mailto:info@motionsports.de");
  assert.equal(cleanHref("tel:+49 8142 448666"), "tel:+49 8142 448666");
  assert.equal(cleanHref("javascript:alert(1)"), "");
});

test("normalizeMailBlock: clamps every field, drops unknown fields and types", () => {
  const taken = new Set();
  const h = normalizeMailBlock({ type: "heading", text: "Hi\nthere", size: "huge", align: "middle", color: "red", background: "#000", extra: 1 }, taken);
  assert.deepEqual(h && { ...h, id: "x" }, { id: "x", type: "heading", text: "Hi there", size: "l", align: "center", color: null, background: "#000000" });
  assert.equal(normalizeMailBlock({ type: "script" }, taken), null);
  assert.equal(normalizeMailBlock(null, taken), null);
  const s = normalizeMailBlock({ type: "spacer", height: 500 }, taken);
  assert.equal(s?.height, 80);
  const p = normalizeMailBlock({ type: "products", refs: ["a", "a", "b~123", "../etc", 7, ...Array.from({ length: 20 }, (_, i) => `p${i}`)] }, taken);
  assert.deepEqual(p?.refs.slice(0, 3), ["a", "b~123", "p0"]);
  assert.equal(p?.refs.length, MAIL_TEMPLATE_LIMITS.productsPerBlock);
  const c = normalizeMailBlock({ type: "coupon", code: " black week25 " }, taken);
  assert.equal(c?.code, "BLACKWEEK25");
  const i = normalizeMailBlock({ type: "image", src: "javascript:x", href: "https://motionsports.de" }, taken);
  assert.equal(i?.src, "");
  assert.equal(i?.href, "https://motionsports.de/");
  // Ids stay unique: a duplicate id gets a new one.
  const a = normalizeMailBlock({ id: "same", type: "divider" }, taken);
  const b = normalizeMailBlock({ id: "same", type: "divider" }, taken);
  assert.equal(a?.id, "same");
  assert.notEqual(b?.id, "same");
});

test("normalizeMailTemplateDoc: exactly one footer at the end, one of each Mo block, default style", () => {
  const doc = normalizeMailTemplateDoc({
    style: { accentColor: "#FFD400", fontFamily: "comic-sans", logoUrl: "http://insecure.de/logo.png" },
    blocks: [
      { type: "footer", showSocial: false },
      { type: "mo_content" },
      { type: "text", text: "a" },
      { type: "mo_content" },
      { type: "footer" },
      { type: "nonsense" },
    ],
  });
  assert.deepEqual(doc.blocks.map((b) => b.type), ["mo_content", "text", "footer"]);
  assert.equal(doc.blocks.at(-1).showSocial, false);
  assert.equal(doc.style.accentColor, "#ffd400");
  assert.equal(doc.style.fontFamily, DEFAULT_MAIL_STYLE.fontFamily);
  assert.equal(doc.style.logoUrl, null);
  // A missing footer is added; garbage becomes an empty document with a footer.
  assert.deepEqual(normalizeMailTemplateDoc({ blocks: [{ type: "text", text: "x" }] }).blocks.map((b) => b.type), ["text", "footer"]);
  assert.deepEqual(normalizeMailTemplateDoc("garbage").blocks.map((b) => b.type), ["footer"]);
  // The block limit keeps the footer.
  const many = normalizeMailTemplateDoc({ blocks: Array.from({ length: 100 }, () => ({ type: "spacer" })) });
  assert.equal(many.blocks.length, MAIL_TEMPLATE_LIMITS.blocks);
  assert.equal(many.blocks.at(-1).type, "footer");
});

test("facts: personal support, hero, product refs, Mo blocks stripped for a Rundmail", () => {
  const doc = normalizeMailTemplateDoc({
    blocks: [{ type: "hero" }, { type: "mo_content" }, { type: "products", refs: ["a", "b"] }, { type: "products", refs: ["b", "c"] }],
  });
  assert.equal(docSupportsPersonal(doc), true);
  assert.equal(docHasHero(doc), true);
  assert.deepEqual(docProductRefs(doc), ["a", "b", "c"]);
  const bulk = stripMoBlocks(doc);
  assert.deepEqual(bulk.blocks.map((b) => b.type), ["products", "products", "footer"]);
  assert.equal(docSupportsPersonal(bulk), false);
});

test("normalizeFirstName: printable names only, all-lower/all-upper title-cased", () => {
  assert.equal(normalizeFirstName("  anna  "), "Anna");
  assert.equal(normalizeFirstName("ANNA-SOPHIE"), "Anna-Sophie");
  assert.equal(normalizeFirstName("McKenzie"), "McKenzie");
  assert.equal(normalizeFirstName("jean luc"), "Jean Luc");
  assert.equal(normalizeFirstName("Zoë"), "Zoë");
  for (const bad of ["", "   ", "Test", "anna@x.de", "R2D2", "a".repeat(31), null, 5, "-x"]) {
    assert.equal(normalizeFirstName(bad), null, String(bad));
  }
});

test("applyMergeFields: {{vorname}} and {{vorname|Ersatz}}, unknown fields stay", () => {
  assert.equal(applyMergeFields("Hallo {{vorname}},", { firstName: "anna" }), "Hallo Anna,");
  assert.equal(applyMergeFields("Hallo {{ Vorname }},", { firstName: null }), "Hallo ,");
  assert.equal(applyMergeFields("{{vorname|Hey}}, deine Deals", { firstName: null }), "Hey, deine Deals");
  assert.equal(applyMergeFields("{{vorname|Hey}}, deine Deals", { firstName: "Tom" }), "Tom, deine Deals");
  assert.equal(applyMergeFields("{{nachname}}", { firstName: "Tom" }), "{{nachname}}");
  // Freeze mode: one token per occurrence, with its fallback.
  const seen = [];
  const frozen = applyMergeFields("{{vorname}} und {{vorname|du}}", {}, (i, fb) => {
    seen.push(fb);
    return `{{mo:fn:${i}}}`;
  });
  assert.equal(frozen, "{{mo:fn:0}} und {{mo:fn:1}}");
  assert.deepEqual(seen, ["", "du"]);
});

test("unknownMergeFields: typos and broken braces are reported", () => {
  assert.deepEqual(unknownMergeFields("Hallo {{vorname}}"), []);
  assert.deepEqual(unknownMergeFields("Hallo {{vorname|du}}"), []);
  assert.deepEqual(unknownMergeFields("Hallo {{vornme}}"), ["{{vornme}}"]);
  assert.deepEqual(unknownMergeFields("Hallo {{vorname"), ["{{vorname"]);
  assert.deepEqual(unknownMergeFields("Hallo {{email}}"), ["{{email}}"]);
});

test("validateMailTemplateDoc: errors block, warnings inform — per use", () => {
  const now = new Date("2026-11-10T10:00:00Z");
  const doc = normalizeMailTemplateDoc({
    blocks: [
      { id: "h", type: "heading", text: "" },
      { id: "i", type: "image", src: "https://x.de/a.webp" },
      { id: "j", type: "image", src: "" },
      { id: "b", type: "button", label: "Los", href: "" },
      { id: "p", type: "products", refs: [] },
      { id: "c", type: "coupon", code: "BLACK WEEK!" },
      { id: "d", type: "countdown", until: "2026-11-01T00:00:00Z" },
      { id: "t", type: "text", text: "Hallo {{vornme}}" },
      { id: "m", type: "mo_content" },
    ],
  });
  const bulk = validateMailTemplateDoc(doc, "bulk", { now });
  const byBlock = (issues, id) => issues.filter((i) => i.blockId === id).map((i) => i.message).join(" | ");
  assert.match(byBlock(bulk.errors, "h"), /Text fehlt/);
  assert.match(byBlock(bulk.errors, "j"), /Bild fehlt/);
  assert.match(byBlock(bulk.warnings, "i"), /Alternativtext/);
  assert.match(byBlock(bulk.warnings, "i"), /WebP/);
  assert.match(byBlock(bulk.errors, "b"), /Link fehlt/);
  assert.match(byBlock(bulk.errors, "p"), /kein Produkt/);
  assert.match(byBlock(bulk.errors, "c"), /nur Buchstaben/);
  assert.match(byBlock(bulk.errors, "d"), /Vergangenheit/);
  assert.match(byBlock(bulk.errors, "t"), /Unbekannter Platzhalter \{\{vornme\}\}/);
  assert.match(byBlock(bulk.errors, "m"), /nur in persönlichen Mails/);

  const personal = validateMailTemplateDoc(normalizeMailTemplateDoc({ blocks: [{ type: "logo" }, { type: "text", text: "x" }] }), "personal", { now });
  assert.ok(personal.errors.some((e) => /Mos persönlicher Text/.test(e.message)));

  const fine = validateMailTemplateDoc(MAIL_TEMPLATE_STARTERS.find((s) => s.key === "persoenlich").build(), "personal", { now });
  assert.deepEqual(fine.errors, []);
});

test("starters build valid, normalised documents", () => {
  const now = new Date("2026-11-10T10:00:00Z");
  for (const s of MAIL_TEMPLATE_STARTERS) {
    const doc = s.build();
    assert.equal(doc.blocks.at(-1).type, "footer", s.key);
    assert.deepEqual(normalizeMailTemplateDoc(doc), doc, s.key);
    if (s.use === "personal") assert.equal(docSupportsPersonal(doc), true);
    else assert.equal(validateMailTemplateDoc(doc, "bulk", { now }).errors.some((e) => /nur in persönlichen Mails/.test(e.message)), false, s.key);
  }
});

test("export / import round trip; foreign or newer files are refused", () => {
  const doc = MAIL_TEMPLATE_STARTERS[0].build();
  const file = templateExportFile({ name: "Black Week 2026", description: "Für die Aktion", doc });
  assert.equal(file.format, MAIL_TEMPLATE_FILE_FORMAT);
  const back = parseTemplateImport(JSON.parse(JSON.stringify(file)));
  assert.equal(back.ok, true);
  assert.equal(back.ok && back.name, "Black Week 2026");
  assert.deepEqual(back.ok && back.doc, doc);
  // A bare document is accepted too.
  assert.equal(parseTemplateImport({ blocks: [{ type: "text", text: "x" }] }).ok, true);
  assert.equal(parseTemplateImport([]).ok, false);
  assert.equal(parseTemplateImport({ hello: 1 }).ok, false);
  assert.equal(parseTemplateImport({ ...file, v: 99 }).ok, false);
  assert.equal(parseTemplateImport({ format: MAIL_TEMPLATE_FILE_FORMAT, doc: { blocks: [] } }).ok, false);
});

test("design keys of templates: vorlage-<id> round trip, code designs are not templates", () => {
  assert.equal(templateDesignKey(12), "vorlage-12");
  assert.equal(parseTemplateDesignKey("vorlage-12"), 12);
  for (const k of ["classic", "performance", "vorlage-", "vorlage-x", "vorlage-1-2", null, undefined]) assert.equal(parseTemplateDesignKey(k), null, String(k));
});

test("product refs: real catalog handles with ® and other symbols are kept (the picker added them, the normaliser dropped them)", () => {
  const taken = new Set();
  const p = normalizeMailBlock(
    {
      type: "products",
      refs: [
        "atx®-hantelbank-klappbar-schwarz-silber",
        "airex®-balance-pad~45678901234",
        "kurzhantel-für-zuhause",
        " rack-plain ",
        "with space",
        "a/b",
        "<x>",
        "x~16kg",
        "y~123456789012345678901",
      ],
    },
    taken
  );
  assert.deepEqual(p?.refs, ["atx®-hantelbank-klappbar-schwarz-silber", "airex®-balance-pad~45678901234", "kurzhantel-für-zuhause", "rack-plain"]);
});

test("every product of the bundled catalog survives as a template ref", async () => {
  const { readFileSync } = await import("node:fs");
  const raw = JSON.parse(readFileSync(new URL("../data/product-catalog.json", import.meta.url), "utf8"));
  const ids = (Array.isArray(raw) ? raw : raw.products ?? Object.values(raw)).map((x) => x.id).filter(Boolean);
  assert.ok(ids.length > 500);
  const taken = new Set();
  for (let i = 0; i < ids.length; i += MAIL_TEMPLATE_LIMITS.productsPerBlock) {
    const chunk = ids.slice(i, i + MAIL_TEMPLATE_LIMITS.productsPerBlock);
    assert.deepEqual(normalizeMailBlock({ type: "products", refs: chunk }, taken)?.refs, chunk);
  }
});
