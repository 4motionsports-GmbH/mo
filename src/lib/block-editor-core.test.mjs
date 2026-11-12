import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAIL_BLOCK_CATALOG,
  MAIL_CHILD_BLOCK_TYPES,
  MAIL_FONT_KEYS,
  MAIL_TEMPLATE_LIMITS,
  normalizeColumnWidths,
  normalizeMailTemplateDoc,
  walkMailBlocks,
} from "./mail-template-doc.mjs";
import { findMailBlock, setSectionColumns, updateMailBlock } from "./mail-template-tree.mjs";
import { ADMIN_DATE_TIME_SHORT, formatAdmin } from "./admin-datetime.mjs";
import { docHistoryReducer } from "./mail-designer-client.mjs";
import {
  BLOCK_GROUPS,
  BLOCK_STYLE_FIELDS,
  MAIL_FONT_GROUPS,
  addMenuGroups,
  addableBlockTypes,
  blockSummary,
  blocksMovedByLayout,
  columnStyledCount,
  columnWidthsWith,
  duplicateBlockedReason,
  groupIssues,
  insertBlockedReason,
  menuItemsOfRows,
  mergeIssues,
  moveBlockTo,
  moveTargets,
  newEditorBlock,
  normalizedMenuItems,
  normalizedMenuRow,
  patchBlockUpdate,
  patchColumnUpdate,
  patchStyleUpdate,
  removeBlockUpdate,
  sectionLayoutFits,
  sectionLayoutPreset,
  sectionStyledCount,
  sectionSummary,
  styledFieldCount,
} from "./block-editor-core.mjs";

function sample() {
  return normalizeMailTemplateDoc({
    blocks: [
      { id: "lg", type: "logo" },
      {
        id: "sec",
        type: "section",
        columns: [
          { id: "c1", blocks: [{ id: "im", type: "image", src: "https://x.de/a.jpg", alt: "A" }] },
          { id: "c2", blocks: [{ id: "h", type: "heading", text: "H" }, { id: "t", type: "text", text: "T" }] },
        ],
      },
      { id: "bt", type: "button", label: "Los", href: "https://motionsports.de" },
      { id: "ft", type: "footer" },
    ],
  });
}

const ids = (doc) => walkMailBlocks(doc).map((w) => w.block.id);
const text = (i) => ({ type: "text", text: `T${i}` });

// ── adding ───────────────────────────────────────────────────────────────────

test("addableBlockTypes: never the footer, no Mo blocks in a Rundmail, singletons once", () => {
  const doc = normalizeMailTemplateDoc({ blocks: [{ type: "mo_content" }, { type: "footer" }] });
  const template = addableBlockTypes(doc, "template");
  assert.ok(!template.includes("footer"));
  assert.ok(!template.includes("mo_content"), "already in the document");
  assert.ok(template.includes("mo_offer") && template.includes("hero") && template.includes("section"));
  const bulk = addableBlockTypes(doc, "bulk");
  for (const t of ["hero", "mo_content", "mo_offer", "mo_promo"]) assert.ok(!bulk.includes(t), t);
  assert.ok(bulk.includes("section") && bulk.includes("menu") && bulk.includes("product"));
});

test("addableBlockTypes in a column: only the types a column may hold", () => {
  const types = addableBlockTypes(sample(), "template", { inColumn: true });
  assert.deepEqual(types, [...MAIL_CHILD_BLOCK_TYPES]);
  assert.ok(!types.includes("section") && !types.includes("products") && !types.includes("footer"));
});

test("addMenuGroups: „Aufbau & Spalten“ first, empty groups left out", () => {
  const groups = addMenuGroups(addableBlockTypes(sample(), "bulk"));
  assert.deepEqual(
    groups.map((g) => g.key),
    ["aufbau", "inhalt", "angebot", "rahmen"]
  );
  assert.equal(groups[0].label, "Aufbau & Spalten");
  assert.deepEqual(groups[0].types, ["section"]);
  for (const g of groups) for (const t of g.types) assert.equal(MAIL_BLOCK_CATALOG[t].group, g.key);
  assert.deepEqual(BLOCK_GROUPS.map((g) => g.key), ["aufbau", "inhalt", "angebot", "mo", "rahmen"]);
});

test("newEditorBlock: a section starts with two equal columns, other types with their defaults", () => {
  const sec = newEditorBlock("section");
  assert.equal(sec.columns.length, 2);
  assert.deepEqual(sec.columns.map((c) => c.width), [50, 50]);
  assert.deepEqual(sec.columns.map((c) => c.blocks), [[], []]);
  const menu = newEditorBlock("menu");
  assert.equal(menu.type, "menu");
  assert.deepEqual(menu.items, []);
  assert.equal(newEditorBlock("nope"), null);
});

test("insertBlockedReason: the limits of the whole mail, the top level and a column", () => {
  const doc = sample();
  assert.equal(insertBlockedReason(doc, "text"), null);
  assert.equal(insertBlockedReason(doc, "text", { sectionId: "sec", columnIndex: 0 }), null);
  assert.match(insertBlockedReason(doc, "products", { sectionId: "sec", columnIndex: 0 }), /nicht in einer Spalte/);

  // top level full (40 incl. the footer) — a column still takes blocks
  const top = normalizeMailTemplateDoc({
    blocks: [{ id: "s", type: "section", columns: [{ blocks: [text(0)] }] }, ...Array.from({ length: 38 }, (_, i) => text(i + 1))],
  });
  assert.equal(top.blocks.length, MAIL_TEMPLATE_LIMITS.blocks);
  assert.match(insertBlockedReason(top, "text"), /untereinander/);
  assert.match(insertBlockedReason(top, "section", { afterId: "s" }), /untereinander/);
  assert.equal(insertBlockedReason(top, "text", { sectionId: "s", columnIndex: 0 }), null);
  // after a block inside a column: a child type lands in that column
  const firstChild = top.blocks[0].columns[0].blocks[0].id;
  assert.equal(insertBlockedReason(top, "text", { afterId: firstChild }), null);
  assert.match(insertBlockedReason(top, "products", { afterId: firstChild }), /untereinander/);

  // a full column
  const col = normalizeMailTemplateDoc({ blocks: [{ id: "s", type: "section", columns: [{ blocks: Array.from({ length: 12 }, (_, i) => text(i)) }] }] });
  assert.match(insertBlockedReason(col, "text", { sectionId: "s", columnIndex: 0 }), /pro Spalte/);
  assert.equal(insertBlockedReason(col, "text"), null);

  // the whole mail full (80 incl. the footer)
  const sections = Array.from({ length: 7 }, (_, s) => ({ type: "section", columns: [{ blocks: Array.from({ length: 10 }, (_, i) => text(s * 10 + i)) }] }));
  const full = normalizeMailTemplateDoc({ blocks: [...sections, text(99), text(100)] });
  assert.equal(walkMailBlocks(full).length, MAIL_TEMPLATE_LIMITS.totalBlocks);
  assert.match(insertBlockedReason(full, "text"), /pro Mail/);
  assert.match(insertBlockedReason(full, "text", { sectionId: full.blocks[0].id, columnIndex: 0 }), /pro Mail/);
});

test("duplicateBlockedReason: singletons, the footer, the weight of a section, a full column", () => {
  const doc = sample();
  assert.equal(duplicateBlockedReason(doc, "bt"), null);
  assert.equal(duplicateBlockedReason(doc, "t"), null);
  assert.equal(duplicateBlockedReason(doc, "sec"), null);
  assert.match(duplicateBlockedReason(doc, "ft"), /Fußzeile/);
  assert.match(duplicateBlockedReason(doc, "nope"), /Fußzeile/);
  const personal = normalizeMailTemplateDoc({ blocks: [{ id: "mc", type: "mo_content" }] });
  assert.match(duplicateBlockedReason(personal, "mc"), /nur einmal/);

  // 78 blocks (footer included): a single block still fits, a section with 3 children (4 blocks) does not
  const sections = Array.from({ length: 6 }, (_, s) => ({ type: "section", columns: [{ blocks: Array.from({ length: 11 }, (_, i) => text(s * 11 + i)) }] }));
  const almost = normalizeMailTemplateDoc({
    blocks: [{ id: "big", type: "section", columns: [{ blocks: [text(90), text(91), text(92)] }] }, ...sections, { ...text(93), id: "last" }],
  });
  assert.equal(walkMailBlocks(almost).length, 78);
  assert.equal(duplicateBlockedReason(almost, "last"), null);
  assert.match(duplicateBlockedReason(almost, "big"), /pro Mail/);

  const col = normalizeMailTemplateDoc({ blocks: [{ id: "s", type: "section", columns: [{ blocks: Array.from({ length: 12 }, (_, i) => ({ ...text(i), id: `k${i}` })) }] }] });
  assert.match(duplicateBlockedReason(col, "k0"), /pro Spalte/);
});

// ── moving ───────────────────────────────────────────────────────────────────

test("moveBlockTo: into another column, out of the section, into a section — content kept, new id", () => {
  const doc = sample();
  const across = moveBlockTo(doc, "t", { sectionId: "sec", columnIndex: 0 });
  const next = normalizeMailTemplateDoc(across.doc);
  assert.ok(across.newId && across.newId !== "t");
  assert.equal(findMailBlock(next, "t"), null);
  const moved = findMailBlock(next, across.newId);
  assert.equal(moved.sectionId, "sec");
  assert.equal(moved.columnIndex, 0);
  assert.equal(moved.index, 1, "at the end of the column");
  assert.equal(moved.block.text, "T");

  const out = moveBlockTo(doc, "h", { afterId: "sec" });
  const outDoc = normalizeMailTemplateDoc(out.doc);
  assert.deepEqual(ids(outDoc), ["lg", "sec", "im", "t", out.newId, "bt", "ft"]);
  assert.equal(findMailBlock(outDoc, out.newId).sectionId, null);

  const into = moveBlockTo(doc, "bt", { sectionId: "sec", columnIndex: 1 });
  const intoDoc = normalizeMailTemplateDoc(into.doc);
  assert.deepEqual(ids(intoDoc), ["lg", "sec", "im", "h", "t", into.newId, "ft"]);
  assert.equal(findMailBlock(intoDoc, into.newId).block.label, "Los");
  assert.equal(findMailBlock(doc, "bt").block.label, "Los", "the input is not touched");
});

test("moveBlockTo refuses sections, the footer, unknown ids and top-only types in a column", () => {
  const doc = normalizeMailTemplateDoc({
    blocks: [{ id: "p", type: "products", refs: [] }, { id: "s", type: "section", columns: [{ blocks: [] }] }],
  });
  for (const [id, where] of [
    ["s", { afterId: "p" }],
    ["nope", { afterId: "s" }],
    ["p", { sectionId: "s", columnIndex: 0 }],
    [doc.blocks.at(-1).id, { afterId: "p" }],
  ]) {
    const res = moveBlockTo(doc, id, where);
    assert.equal(res.newId, null, id);
    assert.equal(res.doc, doc, id);
  }
});

test("moveTargets: the other columns and out of the section for a child, the neighbour sections for a top-level block", () => {
  const doc = sample();
  assert.deepEqual(
    moveTargets(doc, "t").map((t) => [t.label, t.where, t.blocked]),
    [
      ["In Spalte 1", { sectionId: "sec", columnIndex: 0 }, null],
      ["Aus dem Abschnitt nehmen", { afterId: "sec" }, null],
    ]
  );
  assert.deepEqual(
    moveTargets(doc, "lg").map((t) => t.label),
    ["In den Abschnitt darunter · Spalte 1", "In den Abschnitt darunter · Spalte 2"]
  );
  assert.deepEqual(
    moveTargets(doc, "bt").map((t) => [t.label, t.where]),
    [
      ["In den Abschnitt darüber · Spalte 1", { sectionId: "sec", columnIndex: 0 }],
      ["In den Abschnitt darüber · Spalte 2", { sectionId: "sec", columnIndex: 1 }],
    ]
  );
  assert.deepEqual(moveTargets(doc, "sec"), [], "a section never stands in a column");
  assert.deepEqual(moveTargets(doc, "ft"), []);

  const single = normalizeMailTemplateDoc({
    blocks: [{ id: "s", type: "section", columns: [{ blocks: Array.from({ length: 12 }, (_, i) => text(i)) }] }, { id: "x", type: "text", text: "x" }],
  });
  const [target] = moveTargets(single, "x");
  assert.equal(target.label, "In den Abschnitt darüber");
  assert.match(target.blocked, /pro Spalte/);
});

// ── issues ───────────────────────────────────────────────────────────────────

test("groupIssues: own issues per block, a section's children summed, the document's own", () => {
  const doc = sample();
  const issues = {
    errors: [
      { blockId: null, message: "Die Vorlage hat noch keinen Inhalt." },
      { blockId: "t", message: "Text: Text fehlt." },
      { blockId: "sec", message: "Abschnitt: leer" },
      { blockId: "bt", message: "Button: Link fehlt." },
    ],
    warnings: [{ blockId: "im", message: "Bild: Alternativtext fehlt." }],
  };
  const g = groupIssues(doc, issues);
  assert.deepEqual(g.docLevel.errors.map((x) => x.message), ["Die Vorlage hat noch keinen Inhalt."]);
  assert.equal(g.docLevel.warnings.length, 0);
  assert.equal(g.own.get("t").errors.length, 1);
  assert.equal(g.own.get("sec").errors.length, 1);
  assert.equal(g.own.get("lg"), undefined);
  assert.deepEqual(g.nested.get("sec").errors.map((x) => x.blockId), ["t"]);
  assert.deepEqual(g.nested.get("sec").warnings.map((x) => x.blockId), ["im"]);
  assert.equal(g.nested.get("bt"), undefined);
  const collapsed = mergeIssues(g.own.get("sec"), g.nested.get("sec"));
  assert.equal(collapsed.errors.length, 2);
  assert.equal(collapsed.warnings.length, 1);
  assert.deepEqual(mergeIssues(undefined, undefined), { errors: [], warnings: [] });
  assert.equal(groupIssues(doc, undefined).docLevel.errors.length, 0);
});

// ── summaries ────────────────────────────────────────────────────────────────

test("sectionSummary counts columns and blocks in German", () => {
  assert.equal(sectionSummary(sample().blocks[1]), "2 Spalten · 3 Bausteine");
  assert.equal(sectionSummary({ columns: [{ blocks: [{}] }] }), "1 Spalte · 1 Baustein");
  assert.equal(sectionSummary({ columns: [{ blocks: [] }] }), "1 Spalte · 0 Bausteine");
});

test("blockSummary: section, menu labels, product name or ref, and the v1 blocks as before", () => {
  const doc = sample();
  assert.equal(blockSummary(doc.blocks[1]), "2 Spalten · 3 Bausteine");
  assert.equal(blockSummary({ type: "menu", items: [{ label: "Kraft", href: "" }, { label: "", href: "https://x.de/" }, { label: "Sale" }] }), "Kraft · Sale");
  assert.equal(blockSummary({ type: "menu", items: [] }), "Noch keine Links");
  assert.equal(blockSummary({ type: "product", ref: "" }), "Kein Produkt gewählt");
  assert.equal(blockSummary({ type: "product", ref: "hantelbank~42" }), "hantelbank~42");
  assert.equal(blockSummary({ type: "product", ref: "hantelbank" }, { productName: (r) => (r === "hantelbank" ? "Hantelbank X" : undefined) }), "Hantelbank X");
  assert.equal(blockSummary({ type: "product", ref: "andere" }, { productName: () => undefined }), "andere");
  assert.equal(blockSummary({ type: "text", text: "Zeile 1\nZeile 2" }), "Zeile 1");
  assert.equal(blockSummary({ type: "image", src: "", alt: "" }), "Kein Bild gewählt");
  assert.equal(blockSummary({ type: "products", refs: ["a", "b"], title: "Deals" }), "2 Produkt(e) — Deals");
  assert.equal(blockSummary({ type: "coupon", code: "" }), "Kein Code");
  assert.equal(blockSummary({ type: "countdown", until: null }), "Kein Ende gesetzt");
  const until = "2026-11-30T22:59:00.000Z";
  assert.equal(blockSummary({ type: "countdown", until }), formatAdmin(until, ADMIN_DATE_TIME_SHORT));
  assert.equal(blockSummary({ type: "html", html: "x".repeat(1234) }), "1.234 Zeichen HTML");
  assert.equal(blockSummary({ type: "spacer", height: 24 }), "24 px");
  assert.equal(blockSummary({ type: "social" }), MAIL_BLOCK_CATALOG.social.description);
});

// ── sections ─────────────────────────────────────────────────────────────────

test("sectionLayoutPreset: within 1 % per column, else null (widths of their own)", () => {
  assert.equal(sectionLayoutPreset([50, 50]).key, "1-1");
  assert.equal(sectionLayoutPreset([34, 33, 33]).key, "1-1-1");
  assert.equal(sectionLayoutPreset([33, 67]).key, "1-2");
  assert.equal(sectionLayoutPreset([100]).key, "1");
  assert.equal(sectionLayoutPreset([60, 40]), null);
  assert.equal(sectionLayoutPreset([]), null);
  assert.equal(sectionLayoutPreset(undefined), null);
});

test("sectionLayoutFits / blocksMovedByLayout: fewer columns only while the last kept column can take the blocks", () => {
  const sec = normalizeMailTemplateDoc({
    blocks: [
      {
        type: "section",
        columns: [{ blocks: Array.from({ length: 8 }, (_, i) => text(i)) }, { blocks: Array.from({ length: 4 }, (_, i) => text(i)) }, { blocks: [text(1)] }],
      },
    ],
  }).blocks[0];
  assert.equal(sectionLayoutFits(sec, 4), true);
  assert.equal(sectionLayoutFits(sec, 3), true);
  assert.equal(sectionLayoutFits(sec, 2), true, "4 + 1 in the second column");
  assert.equal(sectionLayoutFits(sec, 1), false, "8 + 4 + 1 > 12");
  assert.equal(blocksMovedByLayout(sec, 2), 1);
  assert.equal(blocksMovedByLayout(sec, 1), 5);
  assert.equal(blocksMovedByLayout(sec, 3), 0);
});

test("columnWidthsWith: the others share the rest in proportion, at least 5 %, the sum stays 100", () => {
  assert.deepEqual(columnWidthsWith([50, 50], 0, 60), [60, 40]);
  assert.deepEqual(columnWidthsWith([50, 50], 1, "70"), [30, 70]);
  assert.deepEqual(columnWidthsWith([50, 50], 0, 99), [95, 5], "the other column keeps 5 %");
  assert.deepEqual(columnWidthsWith([50, 50], 0, 1), [5, 95]);
  assert.deepEqual(columnWidthsWith([25, 25, 25, 25], 2, 70), [10, 10, 70, 10]);
  assert.deepEqual(columnWidthsWith([20, 60, 20], 1, 40), [30, 40, 30]);
  assert.deepEqual(columnWidthsWith([10, 85, 5], 1, 90), [5, 90, 5]);
  assert.deepEqual(columnWidthsWith([100], 0, 40), [100]);
  assert.deepEqual(columnWidthsWith([50, 50], 0, ""), [50, 50], "empty: unchanged");
  assert.deepEqual(columnWidthsWith([50, 50], 0, "abc"), [50, 50]);
  assert.deepEqual(columnWidthsWith([50, 50], 5, 60), [50, 50], "unknown column");
  for (const [w, i, v] of [
    [[33, 34, 33], 0, 47],
    [[34, 33, 33], 2, 11],
    [[25, 25, 25, 25], 0, 96],
    [[5, 5, 90], 2, 6],
  ]) {
    const out = columnWidthsWith(w, i, v);
    assert.equal(out.reduce((a, b) => a + b, 0), 100, JSON.stringify([w, i, v]));
    assert.ok(out.every((x) => x >= 5), JSON.stringify(out));
    assert.deepEqual(normalizeColumnWidths(out), out, "the normaliser keeps the list as it is");
  }
});

test("columnWidthsWith through setSectionColumns + normalise keeps exactly the typed width", () => {
  const doc = sample();
  const next = normalizeMailTemplateDoc(setSectionColumns(doc, "sec", columnWidthsWith([50, 50], 0, 62)));
  assert.deepEqual(next.blocks[1].columns.map((c) => c.width), [62, 38]);
  assert.deepEqual(ids(next), ids(doc), "blocks stay where they are");
});

// ── fonts ────────────────────────────────────────────────────────────────────

test("MAIL_FONT_GROUPS: every font exactly once, the theme fonts first", () => {
  const all = MAIL_FONT_GROUPS.flatMap((g) => g.keys);
  assert.deepEqual([...all].sort(), [...MAIL_FONT_KEYS].sort());
  assert.equal(new Set(all).size, all.length);
  assert.equal(MAIL_FONT_GROUPS[0].keys[0], "montserrat");
  assert.ok(MAIL_FONT_GROUPS[1].keys.includes("oswald"));
});

// ── menu rows ────────────────────────────────────────────────────────────────

test("menuItemsOfRows: rows with a text or a link; the empty row is not part of the mail", () => {
  assert.deepEqual(
    menuItemsOfRows([
      { key: "a", label: "Kraft", href: "https://motionsports.de/kraft" },
      { key: "b", label: "  ", href: "" },
      { key: "c", label: "", href: "https://x" },
    ]),
    [
      { label: "Kraft", href: "https://motionsports.de/kraft" },
      { label: "", href: "https://x" },
    ]
  );
  assert.deepEqual(menuItemsOfRows([]), []);
});

test("normalizedMenuItems / normalizedMenuRow: what the document keeps", () => {
  assert.deepEqual(normalizedMenuItems([{ label: " Kraft ", href: "https://motionsports.de" }, { label: "", href: "htt" }]), [
    { label: "Kraft", href: "https://motionsports.de/" },
  ]);
  assert.deepEqual(normalizedMenuRow({ label: " Sale ", href: "motionsports.de" }), { label: "Sale", href: "" });
  assert.deepEqual(normalizedMenuRow({ label: "", href: "kein link" }), { label: "", href: "" });
  assert.deepEqual(normalizedMenuRow({ label: "", href: "mailto:info@motionsports.de" }), { label: "", href: "mailto:info@motionsports.de" });
});

// ── design settings ──────────────────────────────────────────────────────────

test("styledFieldCount counts the design settings a block has", () => {
  const doc = normalizeMailTemplateDoc({
    blocks: [
      { id: "h", type: "heading", text: "H" },
      { id: "t", type: "text", text: "T", padTop: 0, italic: true, bullet: "✓", fontSize: "" },
      { id: "b", type: "button", label: "x", href: "https://x.de", size: "m", shape: "square", outline: true },
      { id: "f", type: "footer", background: "#000000", textColor: "#ffffff" },
    ],
  });
  const at = (id) => findMailBlock(doc, id).block;
  assert.equal(styledFieldCount(at("h")), 0);
  assert.equal(styledFieldCount(at("t")), 3, "padTop 0 counts, the empty font size does not");
  assert.equal(styledFieldCount(at("b")), 2, "size m is the default");
  assert.equal(styledFieldCount(at("f")), 2);
  assert.equal(styledFieldCount({ type: "countdown" }), 0);
  // the fixed blocks' look (12.11.2026): defaults are never stored, so they never count
  const look = normalizeMailTemplateDoc({
    blocks: [
      { id: "cd", type: "countdown", tileColor: "#262626", digitColor: "#ffd400", background: "#111111" },
      { id: "cp", type: "coupon", code: "X10", borderStyle: "dashed", radius: 8, cta: "link", cardColor: "#ffd400", codeFont: "bebas" },
      { id: "pr", type: "products", refs: ["x"], textColor: "#ffffff" },
    ],
  });
  const lookAt = (id) => findMailBlock(look, id).block;
  assert.equal(styledFieldCount(lookAt("cd")), 3);
  assert.equal(styledFieldCount(lookAt("cp")), 2, "dashed, 8 px and the link are the defaults");
  assert.equal(styledFieldCount(lookAt("pr")), 1);
  for (const [type, keys] of Object.entries(BLOCK_STYLE_FIELDS)) {
    assert.ok(MAIL_BLOCK_CATALOG[type], type);
    for (const k of keys) assert.ok(k in MAIL_BLOCK_CATALOG[type].fields, `${type}.${k} is a catalog field`);
  }
});

test("sectionStyledCount / columnStyledCount count what differs from the default", () => {
  const sec = newEditorBlock("section");
  assert.equal(sectionStyledCount(sec), 0);
  assert.equal(sectionStyledCount({ ...sec, padTop: 0, stack: false, padX: 0, borderColor: "#000000" }), 4);
  assert.equal(columnStyledCount(sec.columns[0]), 0);
  assert.equal(columnStyledCount({ ...sec.columns[0], valign: "middle", background: "#eeeeee", padding: 12 }), 3);
});

// ── changes that land late (a picture upload) ────────────────────────────────

test("a picture upload that finishes after edits and a KI-Gestalter result patches the LATEST document", () => {
  // the editor's history (useDocHistory) with the real reducer
  let state = { doc: sample(), undo: [] };
  const dispatch = (action) => (state = docHistoryReducer(state, action));
  const start = state.doc;

  // „Hochladen“ on the image: the change is built when the file is picked …
  const uploaded = patchBlockUpdate("im", { src: "https://example.blob.vercel-storage.com/banner.jpg" });
  // … during the 1–5 s upload: a hand edit (alt text) and the AI result (accent yellow, AI answer 4)
  dispatch({ type: "set", doc: patchBlockUpdate("im", { alt: "Hantelbank im Studio" }) });
  const aiDoc = normalizeMailTemplateDoc({ ...state.doc, style: { ...state.doc.style, accentColor: "#ffd400" } });
  dispatch({ type: "replace", doc: aiDoc, tag: 4 });
  // the upload lands
  dispatch({ type: "set", doc: uploaded });

  const img = findMailBlock(state.doc, "im").block;
  assert.equal(img.src, "https://example.blob.vercel-storage.com/banner.jpg");
  assert.equal(img.alt, "Hantelbank im Studio", "the edit made during the upload survives");
  assert.equal(state.doc.style.accentColor, "#ffd400", "the AI result survives");
  assert.equal(state.undo.length, 1, "the upload is a hand edit — no step of its own");
  // „Rückgängig“ still goes back to the mail before the AI result (with the hand edit, without the upload)
  dispatch({ type: "undo" });
  assert.notEqual(state.doc.style.accentColor, "#ffd400");
  assert.equal(findMailBlock(state.doc, "im").block.alt, "Hantelbank im Studio");
  assert.equal(findMailBlock(state.doc, "im").block.src, findMailBlock(start, "im").block.src);

  // the old way — a value built from the render's copy — would have lost both (the reviewer's reproduction)
  let old = { doc: start, undo: [] };
  const stale = normalizeMailTemplateDoc(updateMailBlock(start, "im", { src: "https://x.de/new.jpg" }));
  old = docHistoryReducer(old, { type: "replace", doc: aiDoc, tag: 4 });
  old = docHistoryReducer(old, { type: "set", doc: stale });
  assert.notEqual(old.doc.style.accentColor, "#ffd400");
});

test("late changes: a block or column that is gone leaves the document as it is; style, column and remove updaters", () => {
  const doc = sample();
  // the AI rebuilt the mail (the image is gone) — the upload changes nothing, not even the object
  const gone = patchBlockUpdate("nope", { src: "https://x.de/b.jpg" });
  assert.equal(gone(doc), doc);
  assert.equal(patchColumnUpdate("sec", 5, { background: "#eeeeee" })(doc), doc);
  assert.equal(patchColumnUpdate("lg", 0, { background: "#eeeeee" })(doc), doc, "not a section");
  assert.equal(removeBlockUpdate("nope")(doc), doc);
  assert.equal(removeBlockUpdate("ft")(doc), doc, "never the footer");
  // with the history: an unchanged document is no change at all
  const state = { doc, undo: [] };
  assert.equal(docHistoryReducer(state, { type: "set", doc: gone }), state);

  // the updaters normalise like the editor does
  const patched = patchBlockUpdate("bt", { label: "  Jetzt kaufen  ", href: "javascript:alert(1)" })(doc);
  const bt = findMailBlock(patched, "bt").block;
  assert.equal(bt.label, "Jetzt kaufen");
  assert.notEqual(bt.href, "javascript:alert(1)");
  const col = patchColumnUpdate("sec", 1, { background: "#EEEEEE", padding: 16, blocks: [] })(doc);
  const sec = findMailBlock(col, "sec").block;
  assert.equal(sec.columns[1].background, "#eeeeee");
  assert.equal(sec.columns[1].padding, 16);
  assert.equal(sec.columns[1].blocks.length, 2, "a patch never replaces a column's blocks");
  const styled = patchStyleUpdate({ accentColor: "#FFD400", logoUrl: "https://example.blob.vercel-storage.com/logo.png" })(doc);
  assert.equal(styled.style.accentColor, "#ffd400");
  assert.equal(styled.style.logoUrl, "https://example.blob.vercel-storage.com/logo.png");
  assert.equal(styled.style.textColor, doc.style.textColor, "the rest of the style stays");
  const removed = removeBlockUpdate("t")(doc);
  assert.equal(findMailBlock(removed, "t"), null);
  assert.ok(findMailBlock(removed, "h"));
  // the logo upload after an AI result keeps the AI's colours
  const ai = normalizeMailTemplateDoc({ ...doc, style: { ...doc.style, accentColor: "#123456" } });
  assert.equal(patchStyleUpdate({ logoUrl: "https://example.blob.vercel-storage.com/l.png" })(ai).style.accentColor, "#123456");
});
