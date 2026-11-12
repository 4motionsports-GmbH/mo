// The block editor of e-mail templates and Rundmails (BlockEditor.tsx) — its
// pure decisions: which blocks „Baustein hinzufügen“ offers where and when a
// limit stops it, the one-line summaries of the rows, which issues a row
// shows (a collapsed section counts its children's), column widths and the
// layout presets of a section, moving a block into / out of a column, the
// rows of the menu block's link editor, which design settings of a block
// are set and the changes that may land late (a picture upload) as updaters
// of the latest document. Tested (block-editor-core.test.mjs).
//
// Every structural change is composed of the tree operations of
// mail-template-tree.mjs; the editor normalises the result
// (normalizeMailTemplateDoc), so the format's rules stay in one place.

import {
  MAIL_BLOCK_CATALOG,
  MAIL_BLOCK_TYPES,
  MAIL_FONT_KEYS,
  MAIL_TEMPLATE_LIMITS,
  MO_BLOCK_TYPES,
  docBlockCount,
  normalizeMailBlock,
  normalizeMailTemplateDoc,
  walkMailBlocks,
} from "./mail-template-doc.mjs";
import {
  SECTION_LAYOUTS,
  canStandInColumn,
  findMailBlock,
  insertMailBlock,
  removeMailBlock,
  updateMailBlock,
  updateSectionColumn,
} from "./mail-template-tree.mjs";
import { EMAIL_FONT_KEYS } from "./email-theme.mjs";
import { ADMIN_DATE_TIME_SHORT, formatAdmin } from "./admin-datetime.mjs";
import { num, plural } from "./admin-format.mjs";

// ── adding blocks ────────────────────────────────────────────────────────────

/** The groups of „Baustein hinzufügen“, in menu order. */
export const BLOCK_GROUPS = Object.freeze([
  { key: "aufbau", label: "Aufbau & Spalten" },
  { key: "inhalt", label: "Inhalt" },
  { key: "angebot", label: "Angebot" },
  { key: "mo", label: "Mo-Bausteine (persönliche Mails)" },
  { key: "rahmen", label: "Rahmen" },
]);

/**
 * The block types „Baustein hinzufügen“ offers, in catalog order: never the
 * footer (there is exactly one), no Mo blocks or hero in a Rundmail, a Mo
 * block / hero only while the document has none, in a column only the types
 * a column may hold.
 * @param {any} doc  normalised document
 * @param {"bulk" | "personal" | "template"} use
 * @param {{ inColumn?: boolean }} [opts]
 * @returns {string[]}
 */
export function addableBlockTypes(doc, use, opts = {}) {
  const present = new Set((doc?.blocks ?? []).map((/** @type {any} */ b) => b.type));
  return MAIL_BLOCK_TYPES.filter((t) => {
    const c = MAIL_BLOCK_CATALOG[t];
    if (t === "footer") return false;
    if (use === "bulk" && !c.bulk) return false;
    if (opts.inColumn && !c.inColumns) return false;
    if (MO_BLOCK_TYPES.includes(t) && present.has(t)) return false;
    return true;
  });
}

/**
 * The add menu's groups (BLOCK_GROUPS order) with their types; empty groups left out.
 * @param {string[]} types
 */
export function addMenuGroups(types) {
  return BLOCK_GROUPS.map((g) => ({
    key: g.key,
    label: g.label,
    types: types.filter((t) => MAIL_BLOCK_CATALOG[/** @type {keyof typeof MAIL_BLOCK_CATALOG} */ (t)]?.group === g.key),
  })).filter((g) => g.types.length > 0);
}

/**
 * A new block of `type` as „Baustein hinzufügen“ creates it (normalised; the
 * tree operation gives it its final id). A new section starts with two
 * columns side by side — what a section is usually for.
 * @param {string} type
 */
export function newEditorBlock(type) {
  const raw = type === "section" ? { type, columns: [{}, {}] } : { type };
  return normalizeMailBlock(raw, new Set());
}

/**
 * The column a block of `type` lands in for insertMailBlock's `where`
 * (null = the top level), or undefined when the placement is refused.
 * @param {any} doc
 * @param {string} type
 * @param {{ afterId?: string, sectionId?: string, columnIndex?: number }} where
 */
function landingColumn(doc, type, where) {
  if (where.sectionId) {
    if (!canStandInColumn(type)) return undefined;
    const sec = (doc?.blocks ?? []).find((/** @type {any} */ b) => b.id === where.sectionId && b.type === "section");
    return sec?.columns?.[where.columnIndex ?? 0] ?? undefined;
  }
  if (where.afterId) {
    const at = findMailBlock(doc, where.afterId);
    if (at && at.sectionId != null && canStandInColumn(type)) {
      const sec = doc.blocks.find((/** @type {any} */ b) => b.id === at.sectionId);
      return sec.columns[at.columnIndex];
    }
  }
  return null;
}

const L = MAIL_TEMPLATE_LIMITS;
const TOTAL_FULL = `Höchstens ${L.totalBlocks} Bausteine pro Mail (die in Abschnitten mitgezählt).`;
const TOP_FULL = `Höchstens ${L.blocks} Bausteine untereinander — Abschnitte zählen als einer.`;
const COLUMN_FULL = `Höchstens ${L.blocksPerColumn} Bausteine pro Spalte.`;

/**
 * Why a new block of `type` cannot be added at `where` (insertMailBlock's
 * placement: { afterId } | { sectionId, columnIndex } | {}), or null.
 * @param {any} doc
 * @param {string} type
 * @param {{ afterId?: string, sectionId?: string, columnIndex?: number }} [where]
 * @returns {string | null}
 */
export function insertBlockedReason(doc, type, where = {}) {
  if (docBlockCount(doc) >= L.totalBlocks) return TOTAL_FULL;
  const col = landingColumn(doc, type, where);
  if (col === undefined) return "Dieser Baustein kann nicht in einer Spalte stehen.";
  if (col) return (col.blocks?.length ?? 0) >= L.blocksPerColumn ? COLUMN_FULL : null;
  return (doc?.blocks ?? []).length >= L.blocks ? TOP_FULL : null;
}

/** How many blocks a block is (a section: itself and every block of its columns). */
function blockWeight(block) {
  if (block?.type !== "section") return 1;
  return 1 + (block.columns ?? []).reduce((/** @type {number} */ n, /** @type {any} */ c) => n + (c.blocks?.length ?? 0), 0);
}

/**
 * Why block `id` cannot be duplicated, or null.
 * @param {any} doc
 * @param {string} id
 * @returns {string | null}
 */
export function duplicateBlockedReason(doc, id) {
  const at = findMailBlock(doc, id);
  if (!at || at.block.type === "footer") return "Die Fußzeile gibt es genau einmal.";
  if (MO_BLOCK_TYPES.includes(at.block.type)) return "Diesen Baustein gibt es nur einmal pro Mail.";
  if (docBlockCount(doc) + blockWeight(at.block) > L.totalBlocks) return TOTAL_FULL;
  if (at.sectionId == null) return doc.blocks.length >= L.blocks ? TOP_FULL : null;
  const sec = doc.blocks.find((/** @type {any} */ b) => b.id === at.sectionId);
  return sec.columns[at.columnIndex].blocks.length >= L.blocksPerColumn ? COLUMN_FULL : null;
}

// ── moving a block into / out of a column ────────────────────────────────────

/**
 * Move block `id` to `where` (insertMailBlock's placement): a copy goes there,
 * the block itself is removed — both through mail-template-tree.mjs. The
 * moved block gets a new id (`newId`); a refused move leaves the document.
 * @param {any} doc
 * @param {string} id
 * @param {{ afterId?: string, sectionId?: string, columnIndex?: number }} where
 * @returns {{ doc: any, newId: string | null }}
 */
export function moveBlockTo(doc, id, where) {
  const at = findMailBlock(doc, id);
  if (!at || at.block.type === "footer" || at.block.type === "section") return { doc, newId: null };
  if (where.afterId === id) return { doc, newId: null };
  const { doc: inserted, newId } = insertMailBlock(doc, at.block, where);
  if (!newId) return { doc, newId: null };
  return { doc: removeMailBlock(inserted, id), newId };
}

/**
 * Where block `id` can be moved besides up and down: from a column into the
 * other columns of its section or out of the section (right below it, at the
 * top level); from
 * the top level into a column of the section right above or right below it.
 * Each target carries the reason it is not possible right now (a full column,
 * a full top level) or null.
 * @param {any} doc
 * @param {string} id
 * @returns {Array<{ key: string, label: string, where: { afterId?: string, sectionId?: string, columnIndex?: number }, blocked: string | null }>}
 */
export function moveTargets(doc, id) {
  const at = findMailBlock(doc, id);
  if (!at || !canStandInColumn(at.block.type)) return [];
  const blocks = doc.blocks ?? [];
  /** @type {Array<{ key: string, label: string, where: any, blocked: string | null }>} */
  const out = [];
  const columnFull = (/** @type {any} */ col) => ((col.blocks?.length ?? 0) >= L.blocksPerColumn ? COLUMN_FULL : null);
  if (at.sectionId != null) {
    const sec = blocks.find((/** @type {any} */ b) => b.id === at.sectionId);
    sec.columns.forEach((/** @type {any} */ col, /** @type {number} */ ci) => {
      if (ci === at.columnIndex) return;
      out.push({ key: `col-${ci}`, label: `In Spalte ${ci + 1}`, where: { sectionId: sec.id, columnIndex: ci }, blocked: columnFull(col) });
    });
    out.push({
      key: "out",
      label: "Aus dem Abschnitt nehmen",
      where: { afterId: sec.id },
      blocked: blocks.length >= L.blocks ? TOP_FULL : null,
    });
    return out;
  }
  const add = (/** @type {any} */ sec, /** @type {string} */ side) => {
    if (!sec || sec.type !== "section") return;
    sec.columns.forEach((/** @type {any} */ col, /** @type {number} */ ci) => {
      const label = sec.columns.length > 1 ? `In den Abschnitt ${side} · Spalte ${ci + 1}` : `In den Abschnitt ${side}`;
      out.push({ key: `${side}-${ci}`, label, where: { sectionId: sec.id, columnIndex: ci }, blocked: columnFull(col) });
    });
  };
  add(blocks[at.index - 1], "darüber");
  add(blocks[at.index + 1], "darunter");
  return out;
}

// ── issues per row ───────────────────────────────────────────────────────────

/**
 * @typedef {{ blockId: string | null, message: string }} EditorIssue
 * @typedef {{ errors: EditorIssue[], warnings: EditorIssue[] }} IssueSet
 */

/**
 * The validation issues by row: `own` per block id, `nested` per section id
 * (the issues of the blocks in its columns — a collapsed section shows them),
 * `docLevel` the ones of the whole document (blockId null).
 * @param {any} doc
 * @param {IssueSet | undefined} issues
 */
export function groupIssues(doc, issues) {
  /** @type {Map<string, string>} */
  const sectionOf = new Map();
  for (const { block, sectionId } of walkMailBlocks(doc)) if (sectionId) sectionOf.set(block.id, sectionId);
  /** @type {Map<string, IssueSet>} */
  const own = new Map();
  /** @type {Map<string, IssueSet>} */
  const nested = new Map();
  /** @type {IssueSet} */
  const docLevel = { errors: [], warnings: [] };
  const push = (/** @type {Map<string, IssueSet>} */ map, /** @type {string} */ key, /** @type {"errors" | "warnings"} */ kind, /** @type {EditorIssue} */ issue) => {
    let set = map.get(key);
    if (!set) map.set(key, (set = { errors: [], warnings: [] }));
    set[kind].push(issue);
  };
  for (const kind of /** @type {const} */ (["errors", "warnings"])) {
    for (const issue of issues?.[kind] ?? []) {
      if (issue.blockId == null) {
        docLevel[kind].push(issue);
        continue;
      }
      push(own, issue.blockId, kind, issue);
      const sec = sectionOf.get(issue.blockId);
      if (sec) push(nested, sec, kind, issue);
    }
  }
  return { own, nested, docLevel };
}

/** Two issue sets as one (a collapsed section: its own and its children's). */
export function mergeIssues(/** @type {IssueSet | undefined} */ a, /** @type {IssueSet | undefined} */ b) {
  return { errors: [...(a?.errors ?? []), ...(b?.errors ?? [])], warnings: [...(a?.warnings ?? []), ...(b?.warnings ?? [])] };
}

// ── row summaries ────────────────────────────────────────────────────────────

/** „2 Spalten · 5 Bausteine“ */
export function sectionSummary(section) {
  const cols = Array.isArray(section?.columns) ? section.columns : [];
  const n = cols.reduce((/** @type {number} */ a, /** @type {any} */ c) => a + (c.blocks?.length ?? 0), 0);
  return `${plural(cols.length, "Spalte", "Spalten")} · ${plural(n, "Baustein", "Bausteine")}`;
}

/**
 * The one-line summary of a block's collapsed row.
 * @param {any} b
 * @param {{ productName?: (ref: string) => string | undefined }} [opts]  names of catalog refs, when known
 */
export function blockSummary(b, opts = {}) {
  switch (b?.type) {
    case "heading":
    case "text":
    case "greeting":
      return String(b.text ?? "").split("\n")[0] ?? "";
    case "image":
    case "hero":
      return String(b.alt || b.src || "") || "Kein Bild gewählt";
    case "button":
      return String(b.label ?? "");
    case "products":
      return `${(b.refs ?? []).length} Produkt(e)${b.title ? ` — ${String(b.title)}` : ""}`;
    case "product":
      return b.ref ? opts.productName?.(b.ref) ?? String(b.ref) : "Kein Produkt gewählt";
    case "menu": {
      const labels = (b.items ?? []).map((/** @type {any} */ it) => String(it.label ?? "")).filter(Boolean);
      return labels.length ? labels.join(" · ") : "Noch keine Links";
    }
    case "section":
      return sectionSummary(b);
    case "coupon":
      return String(b.code || "Kein Code");
    case "countdown":
      return b.until ? formatAdmin(String(b.until), ADMIN_DATE_TIME_SHORT) : "Kein Ende gesetzt";
    case "html":
      return `${num(String(b.html ?? "").length)} Zeichen HTML`;
    case "spacer":
      return `${num(b.height)} px`;
    default:
      return MAIL_BLOCK_CATALOG[/** @type {keyof typeof MAIL_BLOCK_CATALOG} */ (b?.type)]?.description ?? "";
  }
}

// ── sections: layouts and column widths ──────────────────────────────────────

/**
 * The layout preset (SECTION_LAYOUTS) a section's widths are — within 1 % per
 * column, so 34/33/33 is „3 Spalten“ — or null for widths of their own.
 * @param {number[]} widths
 */
export function sectionLayoutPreset(widths) {
  const w = Array.isArray(widths) ? widths : [];
  return SECTION_LAYOUTS.find((l) => l.widths.length === w.length && l.widths.every((x, i) => Math.abs(x - (w[i] ?? 0)) <= 1)) ?? null;
}

/**
 * Can section `sec` take `n` columns? Fewer columns move the blocks of the
 * dropped ones into the last column that stays (setSectionColumns) — refused
 * when that column would hold more than a column may (the normaliser would
 * drop the rest).
 * @param {any} sec
 * @param {number} n
 */
export function sectionLayoutFits(sec, n) {
  const cols = Array.isArray(sec?.columns) ? sec.columns : [];
  if (n >= cols.length) return true;
  const merged = cols.slice(n - 1).reduce((/** @type {number} */ a, /** @type {any} */ c) => a + (c.blocks?.length ?? 0), 0);
  return merged <= L.blocksPerColumn;
}

/** How many blocks move into column `n` when section `sec` gets `n` columns. */
export function blocksMovedByLayout(sec, n) {
  const cols = Array.isArray(sec?.columns) ? sec.columns : [];
  return cols.slice(n).reduce((/** @type {number} */ a, /** @type {any} */ c) => a + (c.blocks?.length ?? 0), 0);
}

/**
 * The widths after column `index` was set to `value` %: the other columns
 * share the rest in their current proportions, every column keeps at least
 * 5 %, the sum stays exactly 100 (normalizeColumnWidths keeps such a list).
 * A value that is not a number leaves the widths as they are.
 * @param {number[]} widths
 * @param {number} index
 * @param {unknown} value
 * @returns {number[]}
 */
export function columnWidthsWith(widths, index, value) {
  const n = widths.length;
  if (n <= 1) return [100];
  const raw = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  if (!Number.isFinite(raw) || index < 0 || index >= n) return [...widths];
  const min = 5;
  const v = Math.min(100 - min * (n - 1), Math.max(min, Math.round(raw)));
  const rest = 100 - v;
  const othersSum = widths.reduce((a, w, i) => (i === index ? a : a + Math.max(0, w)), 0);
  const out = widths.map((w, i) => {
    if (i === index) return v;
    const share = othersSum > 0 ? (Math.max(0, w) / othersSum) * rest : rest / (n - 1);
    return Math.max(min, Math.round(share));
  });
  // Rounding and the 5 % floor can leave a remainder: the widest other column takes it.
  let diff = 100 - out.reduce((a, b) => a + b, 0);
  while (diff !== 0) {
    let j = -1;
    for (let i = 0; i < n; i++) {
      if (i === index || (diff < 0 && out[i] <= min)) continue;
      if (j < 0 || out[i] > out[j]) j = i;
    }
    if (j < 0) break;
    const step = diff > 0 ? 1 : -1;
    out[j] += step;
    diff -= step;
  }
  return out;
}

// ── fonts ────────────────────────────────────────────────────────────────────

/** The font choices, grouped: the theme fonts (every mail program), then the web fonts. */
export const MAIL_FONT_GROUPS = Object.freeze([
  { key: "standard", label: "Standardschriften", keys: MAIL_FONT_KEYS.filter((k) => EMAIL_FONT_KEYS.includes(/** @type {any} */ (k))) },
  { key: "web", label: "Web-Schriften", keys: MAIL_FONT_KEYS.filter((k) => !EMAIL_FONT_KEYS.includes(/** @type {any} */ (k))) },
]);

// ── the menu block's link rows ───────────────────────────────────────────────

/**
 * The menu items of the link editor's rows: every row with a text or a link
 * (an empty row is the next link being typed, not yet part of the mail).
 * @param {Array<{ label?: string, href?: string }>} rows
 * @returns {Array<{ label: string, href: string }>}
 */
export function menuItemsOfRows(rows) {
  return (rows ?? [])
    .filter((r) => String(r?.label ?? "").trim() || String(r?.href ?? "").trim())
    .map((r) => ({ label: String(r.label ?? ""), href: String(r.href ?? "") }));
}

/**
 * The items as the document stores them (normalizeMailBlock) — what the
 * editor expects back after its own change, to tell it from a change made
 * elsewhere (undo, the AI).
 * @param {Array<{ label: string, href: string }>} items
 */
export function normalizedMenuItems(items) {
  return /** @type {Array<{ label: string, href: string }>} */ (normalizeMailBlock({ type: "menu", items }, new Set())?.items ?? []);
}

/**
 * One row as it is stored (trimmed text, a valid link or none) — shown once
 * the operator leaves the field. A row the document drops is shown empty.
 * @param {{ label?: string, href?: string }} row
 */
export function normalizedMenuRow(row) {
  return normalizedMenuItems([{ label: String(row?.label ?? ""), href: String(row?.href ?? "") }])[0] ?? { label: "", href: "" };
}

// ── design settings („Gestaltung“) ───────────────────────────────────────────

const BOX = ["padTop", "padBottom", "background"];
const TEXT_STYLE = ["fontSize", "weight", "italic", "uppercase", "letterSpacing", "lineHeight", "font"];

/**
 * The optional design fields the „Gestaltung“ section of a block edits
 * (MAIL_BLOCK_CATALOG; omitted from the block while unset). Blocks without
 * an entry have no such section.
 * @type {Readonly<Record<string, readonly string[]>>}
 */
export const BLOCK_STYLE_FIELDS = Object.freeze({
  logo: BOX,
  heading: ["padTop", "padBottom", ...TEXT_STYLE],
  text: ["bullet", "accentBar", "padTop", "padBottom", ...TEXT_STYLE],
  greeting: ["color", ...TEXT_STYLE, ...BOX],
  image: ["align", "radius", ...BOX],
  button: ["size", "shape", "outline", "borderColor", ...BOX],
  product: BOX,
  products: ["cardColor", "textColor"],
  coupon: ["accent", "cardColor", "borderStyle", "radius", "textColor", "codeColor", "codeFont", "cta", ...BOX],
  countdown: ["tileColor", "digitColor", "labelColor", ...BOX],
  menu: ["letterSpacing", "font", ...BOX],
  divider: ["thickness", "widthPct", "lineStyle", "align", ...BOX],
  spacer: ["background"],
  social: BOX,
  html: BOX,
  footer: ["background", "textColor"],
});

/** How many of a block's design fields are set (the „Gestaltung“ row shows it). */
export function styledFieldCount(block) {
  const keys = BLOCK_STYLE_FIELDS[block?.type] ?? [];
  return keys.filter((k) => block[k] != null && block[k] !== false && block[k] !== "").length;
}

/** The section fields behind „Gestaltung“ with their defaults (normalizeSection). */
const SECTION_STYLE_DEFAULTS = Object.freeze({
  padTop: 24,
  padBottom: 24,
  padX: null,
  gap: 20,
  stack: true,
  reverse: false,
  radius: 0,
  borderColor: null,
});

/** How many of a section's design settings differ from the default. */
export function sectionStyledCount(section) {
  return Object.entries(SECTION_STYLE_DEFAULTS).filter(([k, d]) => section?.[k] !== undefined && section[k] !== d).length;
}

/** How many of a column's settings differ from the default (top, no colour, no padding). */
export function columnStyledCount(col) {
  return [col?.valign && col.valign !== "top", Boolean(col?.background), (col?.padding ?? 0) > 0].filter(Boolean).length;
}

// ── changes that may land late ───────────────────────────────────────────────
//
// A field's change as an UPDATER of the document (BlockEditor's onChange
// takes a value or an updater, like useState): it is applied to the document
// as it is when the change lands — not to the copy of the render it started
// in. That matters for everything that waits: a picture upload („Hochladen“
// in Bild, Logo, Titelbild, a section's background picture, the own logo)
// takes seconds, and meanwhile the operator keeps editing or a KI-Gestalter
// result replaces the mail. A patch of the old copy would write the old mail
// back — the edits and the AI result gone, the AI result not even on the
// undo stack. A block or column that is gone by then leaves the document as
// it is (the same object: no change, no render).

/**
 * @typedef {ReturnType<typeof normalizeMailTemplateDoc>} EditorDoc
 * @typedef {(doc: EditorDoc) => EditorDoc} EditorDocUpdate
 */

/**
 * Merge `patch` into block `id` (raw field values — normalised).
 * @param {string} id
 * @param {Record<string, unknown>} patch
 * @returns {EditorDocUpdate}
 */
export function patchBlockUpdate(id, patch) {
  return (doc) => {
    const next = updateMailBlock(doc, id, patch);
    return next === doc ? doc : normalizeMailTemplateDoc(next);
  };
}

/**
 * Merge `patch` into column `columnIndex` of section `sectionId`.
 * @param {string} sectionId
 * @param {number} columnIndex
 * @param {Record<string, unknown>} patch
 * @returns {EditorDocUpdate}
 */
export function patchColumnUpdate(sectionId, columnIndex, patch) {
  return (doc) => {
    const next = updateSectionColumn(doc, sectionId, columnIndex, patch);
    return next === doc ? doc : normalizeMailTemplateDoc(next);
  };
}

/**
 * Merge `patch` into the style of the whole mail („Farben & Schrift“).
 * @param {Record<string, unknown>} patch
 * @returns {EditorDocUpdate}
 */
export function patchStyleUpdate(patch) {
  return (doc) => normalizeMailTemplateDoc({ ...doc, style: { ...doc.style, ...patch } });
}

/**
 * Remove block `id` (after a confirmation — the document may have changed
 * while the dialog was open).
 * @param {string} id
 * @returns {EditorDocUpdate}
 */
export function removeBlockUpdate(id) {
  return (doc) => {
    const next = removeMailBlock(doc, id);
    return next === doc ? doc : normalizeMailTemplateDoc(next);
  };
}
