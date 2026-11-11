import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeMailTemplateDoc, walkMailBlocks } from "./mail-template-doc.mjs";
import {
  SECTION_LAYOUTS,
  canMoveMailBlock,
  canStandInColumn,
  duplicateMailBlock,
  findMailBlock,
  insertMailBlock,
  moveMailBlock,
  removeMailBlock,
  sectionLayoutKey,
  setSectionColumns,
  updateMailBlock,
  updateSectionColumn,
} from "./mail-template-tree.mjs";

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

test("findMailBlock locates top-level and nested blocks", () => {
  const doc = sample();
  assert.deepEqual(findMailBlock(doc, "bt"), { block: doc.blocks[2], sectionId: null, columnIndex: null, index: 2 });
  const t = findMailBlock(doc, "t");
  assert.equal(t.sectionId, "sec");
  assert.equal(t.columnIndex, 1);
  assert.equal(t.index, 1);
  assert.equal(findMailBlock(doc, "nope"), null);
});

test("updateMailBlock patches a nested block without touching the input", () => {
  const doc = sample();
  const next = normalizeMailTemplateDoc(updateMailBlock(doc, "t", { text: "Neu", fontSize: 18, type: "image", id: "x" }));
  assert.equal(findMailBlock(next, "t").block.text, "Neu");
  assert.equal(findMailBlock(next, "t").block.fontSize, 18);
  assert.equal(findMailBlock(next, "t").block.type, "text"); // type and id are never patched
  assert.equal(findMailBlock(doc, "t").block.text, "T");
});

test("removeMailBlock removes nested blocks, never the footer", () => {
  const doc = sample();
  assert.deepEqual(ids(removeMailBlock(doc, "h")), ["lg", "sec", "im", "t", "bt", "ft"]);
  assert.deepEqual(ids(removeMailBlock(doc, "ft")), ids(doc));
  assert.deepEqual(ids(removeMailBlock(doc, "sec")), ["lg", "bt", "ft"]);
});

test("moveMailBlock moves within its list; the top-level footer stays last", () => {
  const doc = sample();
  assert.deepEqual(ids(moveMailBlock(doc, "t", -1)), ["lg", "sec", "im", "t", "h", "bt", "ft"]);
  assert.deepEqual(ids(moveMailBlock(doc, "bt", 1)), ids(doc)); // would pass the footer
  assert.deepEqual(ids(moveMailBlock(doc, "h", -1)), ids(doc)); // first in its column
  assert.equal(canMoveMailBlock(doc, "bt", 1), false);
  assert.equal(canMoveMailBlock(doc, "bt", -1), true);
  assert.equal(canMoveMailBlock(doc, "t", 1), false);
  assert.equal(canMoveMailBlock(doc, "ft", -1), false);
});

test("duplicateMailBlock copies a section with fresh ids for every column and block", () => {
  const doc = sample();
  const { doc: next, newId } = duplicateMailBlock(doc, "sec");
  const norm = normalizeMailTemplateDoc(next);
  assert.equal(norm.blocks[2].id, newId);
  assert.equal(norm.blocks[2].type, "section");
  const all = [];
  for (const b of norm.blocks) {
    all.push(b.id);
    if (b.type === "section") for (const c of b.columns) all.push(c.id, ...c.blocks.map((k) => k.id));
  }
  assert.equal(new Set(all).size, all.length);
  assert.equal(norm.blocks[2].columns[1].blocks[0].text, "H");
  // a nested block is duplicated inside its column
  const d2 = duplicateMailBlock(doc, "h");
  assert.equal(findMailBlock(d2.doc, d2.newId).sectionId, "sec");
  assert.equal(duplicateMailBlock(doc, "ft").newId, null);
});

test("insertMailBlock: after a block, into a column, or in front of the footer", () => {
  const doc = sample();
  const a = insertMailBlock(doc, { type: "divider" }, { afterId: "lg" });
  assert.equal(normalizeMailTemplateDoc(a.doc).blocks[1].type, "divider");
  const b = insertMailBlock(doc, { type: "button", label: "X" }, { sectionId: "sec", columnIndex: 0 });
  assert.equal(findMailBlock(b.doc, b.newId).columnIndex, 0);
  const c = insertMailBlock(doc, { type: "spacer" });
  const nc = normalizeMailTemplateDoc(c.doc);
  assert.equal(nc.blocks.at(-2).type, "spacer");
  assert.equal(nc.blocks.at(-1).type, "footer");
  // after a nested block: a child type stays in the column, a top-level type goes after the section
  const d = insertMailBlock(doc, { type: "text", text: "x" }, { afterId: "h" });
  assert.equal(findMailBlock(d.doc, d.newId).sectionId, "sec");
  const e = insertMailBlock(doc, { type: "products" }, { afterId: "h" });
  assert.equal(findMailBlock(e.doc, e.newId).sectionId, null);
  assert.equal(findMailBlock(e.doc, e.newId).index, 2);
  // a top-level type can never be put into a column
  assert.equal(insertMailBlock(doc, { type: "countdown" }, { sectionId: "sec", columnIndex: 0 }).newId, null);
  // after the footer = in front of it
  const f = insertMailBlock(doc, { type: "divider" }, { afterId: "ft" });
  assert.equal(normalizeMailTemplateDoc(f.doc).blocks.at(-1).type, "footer");
});

test("setSectionColumns: more columns start empty, fewer columns keep every block", () => {
  const doc = sample();
  const three = normalizeMailTemplateDoc(setSectionColumns(doc, "sec", [33, 34, 33]));
  const s3 = three.blocks[1];
  assert.equal(s3.columns.length, 3);
  assert.deepEqual(s3.columns.map((c) => c.blocks.length), [1, 2, 0]);
  const one = normalizeMailTemplateDoc(setSectionColumns(doc, "sec", [100]));
  assert.deepEqual(one.blocks[1].columns[0].blocks.map((b) => b.id), ["im", "h", "t"]);
  assert.equal(one.blocks[1].columns[0].width, 100);
});

test("updateSectionColumn changes a column's settings, never its blocks", () => {
  const doc = sample();
  const next = normalizeMailTemplateDoc(updateSectionColumn(doc, "sec", 1, { background: "#eeeeee", valign: "middle", blocks: [] }));
  assert.equal(next.blocks[1].columns[1].background, "#eeeeee");
  assert.equal(next.blocks[1].columns[1].valign, "middle");
  assert.equal(next.blocks[1].columns[1].blocks.length, 2);
});

test("layouts and helpers", () => {
  assert.equal(sectionLayoutKey([50, 50]), "1-1");
  assert.equal(sectionLayoutKey([30, 70]), "1-2");
  assert.equal(sectionLayoutKey([25, 25, 25, 25]), "1-1-1-1");
  for (const l of SECTION_LAYOUTS) assert.equal(l.widths.reduce((a, b) => a + b, 0), 100, l.key);
  assert.equal(canStandInColumn("text"), true);
  assert.equal(canStandInColumn("products"), false);
  assert.equal(canStandInColumn("section"), false);
});
