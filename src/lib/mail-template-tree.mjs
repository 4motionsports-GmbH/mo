// E-mail templates („Vorlagen“) — tree operations on a block document
// (mail-template-doc.mjs, version 2): find, change, remove, move, duplicate
// and insert a block wherever it stands — at the top level or inside a column
// of a section — and change a section's columns. Pure and tested
// (mail-template-tree.test.mjs); the block editor (admin/vorlagen/BlockEditor)
// calls these and normalises the result (normalizeMailTemplateDoc), so every
// rule of the format (footer last, ids unique across the tree, which blocks a
// column may hold, limits) is applied in ONE place.
//
// Every function takes a normalised document and returns a NEW document
// object (inputs are never mutated); unknown ids leave the document as it is.

import { MAIL_CHILD_BLOCK_TYPES, newBlockId, normalizeColumnWidths, walkMailBlocks } from "./mail-template-doc.mjs";

/** The column layouts the editor offers (widths in %). */
export const SECTION_LAYOUTS = Object.freeze([
  { key: "1", label: "1 Spalte", widths: [100] },
  { key: "1-1", label: "2 Spalten (½ + ½)", widths: [50, 50] },
  { key: "1-2", label: "2 Spalten (⅓ + ⅔)", widths: [33, 67] },
  { key: "2-1", label: "2 Spalten (⅔ + ⅓)", widths: [67, 33] },
  { key: "1-1-1", label: "3 Spalten", widths: [33, 34, 33] },
  { key: "1-1-1-1", label: "4 Spalten", widths: [25, 25, 25, 25] },
]);

/** The layout key of a section's widths (closest preset), for the editor's select. */
export function sectionLayoutKey(widths) {
  const n = Array.isArray(widths) ? widths.length : 0;
  let best = null;
  let bestDist = Infinity;
  for (const l of SECTION_LAYOUTS) {
    if (l.widths.length !== n) continue;
    const dist = l.widths.reduce((a, w, i) => a + Math.abs(w - (widths[i] ?? 0)), 0);
    if (dist < bestDist) {
      best = l.key;
      bestDist = dist;
    }
  }
  return best ?? "1";
}

/** May a block of this type stand inside a column? */
export function canStandInColumn(type) {
  return MAIL_CHILD_BLOCK_TYPES.includes(type);
}

const clone = (v) => JSON.parse(JSON.stringify(v));

/**
 * Where a block stands.
 * @returns {{ block: any, sectionId: string | null, columnIndex: number | null, index: number } | null}
 */
export function findMailBlock(doc, id) {
  const blocks = doc?.blocks ?? [];
  const top = blocks.findIndex((b) => b.id === id);
  if (top >= 0) return { block: blocks[top], sectionId: null, columnIndex: null, index: top };
  for (const s of blocks) {
    if (s.type !== "section") continue;
    for (let c = 0; c < (s.columns ?? []).length; c++) {
      const i = s.columns[c].blocks.findIndex((b) => b.id === id);
      if (i >= 0) return { block: s.columns[c].blocks[i], sectionId: s.id, columnIndex: c, index: i };
    }
  }
  return null;
}

/** Apply `fn(list, index)` to the list that holds block `id` (a copy of the document). */
function inListOf(doc, id, fn) {
  const at = findMailBlock(doc, id);
  if (!at) return doc;
  const next = clone(doc);
  if (at.sectionId == null) {
    fn(next.blocks, at.index, true);
  } else {
    const sec = next.blocks.find((b) => b.id === at.sectionId);
    fn(sec.columns[at.columnIndex].blocks, at.index, false);
  }
  return next;
}

/** Merge `patch` into block `id` (shallow — the normaliser drops what does not belong). */
export function updateMailBlock(doc, id, patch) {
  return inListOf(doc, id, (list, i) => {
    list[i] = { ...list[i], ...patch, id: list[i].id, type: list[i].type };
  });
}

/** Remove block `id` (never the footer). */
export function removeMailBlock(doc, id) {
  const at = findMailBlock(doc, id);
  if (!at || at.block.type === "footer") return doc;
  return inListOf(doc, id, (list, i) => {
    list.splice(i, 1);
  });
}

/** Move block `id` one step up (-1) or down (+1) inside its list; the footer stays last. */
export function moveMailBlock(doc, id, dir) {
  const at = findMailBlock(doc, id);
  if (!at || at.block.type === "footer") return doc;
  return inListOf(doc, id, (list, i, top) => {
    const j = i + dir;
    const last = top ? list.length - 2 : list.length - 1; // top level: in front of the footer
    if (j < 0 || j > last) return;
    [list[i], list[j]] = [list[j], list[i]];
  });
}

/** Can block `id` move one step in `dir`? (for disabling the arrows) */
export function canMoveMailBlock(doc, id, dir) {
  const at = findMailBlock(doc, id);
  if (!at || at.block.type === "footer") return false;
  const list = at.sectionId == null ? doc.blocks : doc.blocks.find((b) => b.id === at.sectionId).columns[at.columnIndex].blocks;
  const last = at.sectionId == null ? list.length - 2 : list.length - 1;
  const j = at.index + dir;
  return j >= 0 && j <= last;
}

/** Give a block (and, for a section, its columns and their blocks) fresh ids. */
function withFreshIds(block, taken) {
  const copy = clone(block);
  copy.id = newBlockId(taken);
  taken.add(copy.id);
  if (copy.type === "section") {
    for (const c of copy.columns ?? []) {
      c.id = newBlockId(taken);
      taken.add(c.id);
      for (const k of c.blocks ?? []) {
        k.id = newBlockId(taken);
        taken.add(k.id);
      }
    }
  }
  return copy;
}

/** Every id of the document (blocks and columns). */
function allIds(doc) {
  const ids = new Set();
  for (const { block } of walkMailBlocks(doc)) ids.add(block.id);
  for (const b of doc?.blocks ?? []) if (b.type === "section") for (const c of b.columns ?? []) ids.add(c.id);
  return ids;
}

/**
 * Duplicate block `id` right after itself (fresh ids for the copy and all it holds).
 * @returns {{ doc: any, newId: string | null }}
 */
export function duplicateMailBlock(doc, id) {
  const at = findMailBlock(doc, id);
  if (!at || at.block.type === "footer") return { doc, newId: null };
  const copy = withFreshIds(at.block, allIds(doc));
  const next = inListOf(doc, id, (list, i) => {
    list.splice(i + 1, 0, copy);
  });
  return { doc: next, newId: copy.id };
}

/**
 * Insert a (new) block. `where`:
 *   { afterId }                 — right after that block, in the same list
 *                                 (after the footer = in front of it);
 *   { sectionId, columnIndex }  — at the end of that column (child types only);
 *   {}                          — at the end of the mail, in front of the footer.
 * The block gets a fresh id. A child-only placement of a top-level type is refused.
 * @returns {{ doc: any, newId: string | null }}
 */
export function insertMailBlock(doc, block, where = {}) {
  const copy = withFreshIds(block, allIds(doc));
  const next = clone(doc);
  if (where.sectionId) {
    if (!canStandInColumn(copy.type)) return { doc, newId: null };
    const sec = next.blocks.find((b) => b.id === where.sectionId && b.type === "section");
    const col = sec?.columns?.[where.columnIndex ?? 0];
    if (!col) return { doc, newId: null };
    col.blocks.push(copy);
    return { doc: next, newId: copy.id };
  }
  if (where.afterId) {
    const at = findMailBlock(doc, where.afterId);
    if (at && at.sectionId != null) {
      if (!canStandInColumn(copy.type)) {
        // a top-level type goes after the section that holds the open block
        const si = next.blocks.findIndex((b) => b.id === at.sectionId);
        next.blocks.splice(si + 1, 0, copy);
        return { doc: next, newId: copy.id };
      }
      const sec = next.blocks.find((b) => b.id === at.sectionId);
      sec.columns[at.columnIndex].blocks.splice(at.index + 1, 0, copy);
      return { doc: next, newId: copy.id };
    }
    if (at) {
      const footerAt = next.blocks.findIndex((b) => b.type === "footer");
      const pos = Math.min(at.index + 1, footerAt >= 0 ? footerAt : next.blocks.length);
      next.blocks.splice(pos, 0, copy);
      return { doc: next, newId: copy.id };
    }
  }
  const footerAt = next.blocks.findIndex((b) => b.type === "footer");
  next.blocks.splice(footerAt >= 0 ? footerAt : next.blocks.length, 0, copy);
  return { doc: next, newId: copy.id };
}

/**
 * Give section `sectionId` the column widths `widths` (1–4 columns). New
 * columns start empty; when columns are dropped, their blocks join the last
 * column that stays — nothing is lost as long as that column keeps within its
 * 12 blocks (the normaliser cuts the rest; the editor offers such a layout
 * only when it fits — block-editor-core.mjs sectionLayoutFits).
 */
export function setSectionColumns(doc, sectionId, widths) {
  const next = clone(doc);
  const sec = next.blocks.find((b) => b.id === sectionId && b.type === "section");
  if (!sec || !Array.isArray(widths) || widths.length < 1) return doc;
  const n = Math.min(4, widths.length);
  const taken = allIds(doc);
  const cols = sec.columns.slice(0, n);
  const dropped = sec.columns.slice(n).flatMap((c) => c.blocks);
  if (dropped.length) cols[cols.length - 1].blocks.push(...dropped);
  while (cols.length < n) {
    const id = newBlockId(taken);
    taken.add(id);
    cols.push({ id, width: 0, valign: "top", background: null, padding: 0, blocks: [] });
  }
  const w = normalizeColumnWidths(widths.slice(0, n));
  cols.forEach((c, i) => {
    c.width = w[i];
  });
  sec.columns = cols;
  return next;
}

/** Merge `patch` into column `columnIndex` of section `sectionId` (width, valign, background, padding). */
export function updateSectionColumn(doc, sectionId, columnIndex, patch) {
  const next = clone(doc);
  const sec = next.blocks.find((b) => b.id === sectionId && b.type === "section");
  const col = sec?.columns?.[columnIndex];
  if (!col) return doc;
  for (const [k, v] of Object.entries(patch ?? {})) {
    if (k !== "blocks" && k !== "id") col[k] = v;
  }
  return next;
}
