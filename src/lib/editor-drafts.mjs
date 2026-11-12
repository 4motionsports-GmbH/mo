// Local drafts of the template editor („Vorlagen“) and the Rundmail's
// „Inhalt“ — the pure half of admin/vorlagen/use-editor-draft.tsx
// (docs/ADMIN_DASHBOARD.md §3.12, §3.2). Tested (editor-drafts.test.mjs).
//
// Unsaved changes are kept in the browser (localStorage), never on the
// server: a saved template can be the live design of Mo's personal mails, and
// every save of a Rundmail's content needs a new test mail — „Speichern“
// stays the one step that publishes. One draft per object:
//
//   mo:draft:vorlage:<id>      a template („new“: one that has no id yet)
//   mo:draft:rundmail:<id>     the content of a Rundmail (its campaign id)
//
// stored as {"v":1,"savedAt":<ms>,"base":<…>,"content":{…}}:
//   * savedAt — when it was written (EDITOR_DRAFT_DEBOUNCE_MS after the last
//     change, at once when the editor is left);
//   * base    — the saved state it was made on: the template's version, the
//     Rundmail's content version (both count saves);
//   * content — what the editor edits (EDITOR_DRAFT_FIELDS).
//
//   editorDraftKey / parseEditorDraftKey — the key of one object;
//   serializeEditorDraft — the stored string; null when it is larger than
//     EDITOR_DRAFT_MAX_CHARS (~1.5 MB — that draft is skipped, no error);
//   parseEditorDraft — a stored string back, validated; null for anything
//     broken (the caller removes it);
//   stableStringify / sameEditorContent — content compared as JSON with
//     sorted keys, so a different key order is never „a change“;
//   editorDraftRestore — on opening: "auto" (the saved version is still the
//     one the draft was made on → put it back), "offer" (saved since → ask),
//     "none" (no draft, or it equals the saved state);
//   editorDraftsToPrune — broken, older than 30 days, beyond the newest 20;
//   listEditorDrafts — the drafts of one kind (the template list's badges);
//   editorDraftSavedAt — the time of a stored draft without parsing it all.

/** Every draft key starts with this. */
export const EDITOR_DRAFT_PREFIX = "mo:draft:";
/** A change is written this long after the last one. */
export const EDITOR_DRAFT_DEBOUNCE_MS = 800;
/** Drafts older than this are removed. */
export const EDITOR_DRAFT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
/** At most this many drafts are kept (the newest). */
export const EDITOR_DRAFT_MAX_COUNT = 20;
/** Longest stored draft, in characters of its JSON (~1.5 MB); a larger one is skipped. */
export const EDITOR_DRAFT_MAX_CHARS = 1_500_000;

const FORMAT = 1;

/**
 * What each editor keeps: field → kind of value. `text` a string, `language`
 * "de" | "en", `doc` the block document (a plain object — the editor
 * normalises it before use).
 */
export const EDITOR_DRAFT_FIELDS = Object.freeze({
  vorlage: Object.freeze({ name: "text", description: "text", doc: "doc" }),
  rundmail: Object.freeze({ subject: "text", preheader: "text", language: "language", doc: "doc" }),
});

/**
 * @typedef {keyof typeof EDITOR_DRAFT_FIELDS} EditorDraftKind
 * @typedef {number | string | null} EditorDraftBase
 * @typedef {{ savedAt: number, base: EditorDraftBase, content: Record<string, unknown> }} EditorDraft
 * @typedef {"auto" | "offer" | "none"} EditorDraftRestore
 */

const KEY_RE = /^mo:draft:([a-z]+):(new|[1-9]\d{0,15})$/;
const HEAD_RE = /^\{"v":1,"savedAt":(\d{1,16}),"base":/;

/** @param {unknown} v @returns {v is Record<string, unknown>} */
function isPlainObject(v) {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/** @param {unknown} kind @returns {kind is EditorDraftKind} */
function isKind(kind) {
  return typeof kind === "string" && Object.prototype.hasOwnProperty.call(EDITOR_DRAFT_FIELDS, kind);
}

/** @param {unknown} base @returns {base is EditorDraftBase} */
function isBase(base) {
  return base === null || (typeof base === "number" && Number.isFinite(base)) || (typeof base === "string" && base.length <= 100);
}

/** @param {unknown} id */
function isId(id) {
  return typeof id === "number" && Number.isSafeInteger(id) && id > 0;
}

/**
 * The storage key of one object's draft: `mo:draft:vorlage:12`,
 * `mo:draft:rundmail:7`; without an id (not saved yet) `mo:draft:vorlage:new`.
 * @param {EditorDraftKind} kind
 * @param {number | null | undefined} id
 * @returns {string}
 */
export function editorDraftKey(kind, id) {
  if (!isKind(kind)) throw new TypeError(`unknown draft kind: ${String(kind)}`);
  return `${EDITOR_DRAFT_PREFIX}${kind}:${isId(id) ? id : "new"}`;
}

/**
 * A draft key back: its kind (any lowercase word — a newer kind stays a
 * draft) and id (null for „new“); null for every other string.
 * @param {unknown} key
 * @returns {{ kind: string, id: number | null } | null}
 */
export function parseEditorDraftKey(key) {
  if (typeof key !== "string") return null;
  const m = KEY_RE.exec(key);
  if (!m) return null;
  if (m[2] === "new") return { kind: m[1], id: null };
  const id = Number(m[2]);
  return isId(id) ? { kind: m[1], id } : null;
}

/**
 * JSON with the keys of every object sorted — the same value gives the same
 * string whatever order its keys were set in. JSON semantics otherwise:
 * `undefined`, functions and symbols are left out of objects (null in
 * arrays), non-finite numbers become null, `toJSON` is used. Throws on a
 * cycle or a BigInt, like JSON.stringify.
 * @param {unknown} value
 * @returns {string | undefined} undefined for a bare undefined / function / symbol
 */
export function stableStringify(value) {
  const seen = new Set();
  /** @param {unknown} v @returns {string | undefined} */
  const walk = (v) => {
    if (v === null) return "null";
    switch (typeof v) {
      case "string":
      case "boolean":
        return JSON.stringify(v);
      case "number":
        return Number.isFinite(v) ? JSON.stringify(v) : "null";
      case "bigint":
        throw new TypeError("BigInt is not JSON");
      case "object":
        break;
      default:
        return undefined;
    }
    const obj = /** @type {Record<string, unknown> & { toJSON?: () => unknown }} */ (v);
    if (typeof obj.toJSON === "function") return walk(obj.toJSON());
    if (seen.has(obj)) throw new TypeError("cyclic value");
    seen.add(obj);
    let out;
    if (Array.isArray(obj)) {
      out = `[${obj.map((item) => walk(item) ?? "null").join(",")}]`;
    } else {
      const parts = [];
      for (const k of Object.keys(obj).sort()) {
        const s = walk(obj[k]);
        if (s !== undefined) parts.push(`${JSON.stringify(k)}:${s}`);
      }
      out = `{${parts.join(",")}}`;
    }
    seen.delete(obj);
    return out;
  };
  return walk(value);
}

/**
 * Same editor content? Compared as stable JSON (key order never matters);
 * anything that cannot be serialised is „not the same“.
 * @param {unknown} a
 * @param {unknown} b
 */
export function sameEditorContent(a, b) {
  if (a === b) return true;
  try {
    return stableStringify(a) === stableStringify(b);
  } catch {
    return false;
  }
}

/**
 * The content of one kind from untrusted input (a stored draft): exactly its
 * fields (EDITOR_DRAFT_FIELDS), each of the right kind — else null.
 * @param {EditorDraftKind} kind
 * @param {unknown} raw
 * @returns {Record<string, unknown> | null}
 */
export function editorDraftContent(kind, raw) {
  if (!isKind(kind) || !isPlainObject(raw)) return null;
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const [name, type] of Object.entries(EDITOR_DRAFT_FIELDS[kind])) {
    const v = raw[name];
    const ok = type === "text" ? typeof v === "string" : type === "language" ? v === "de" || v === "en" : isPlainObject(v);
    if (!ok) return null;
    out[name] = v;
  }
  return out;
}

/**
 * The string to store: {"v":1,"savedAt":…,"base":…,"content":…} (in this
 * order — editorDraftSavedAt reads the head). Null when the input is not a
 * draft or the result is longer than `maxChars` (the draft is then skipped).
 * @param {{ content: unknown, base: EditorDraftBase, savedAt: number }} draft
 * @param {number} [maxChars]
 * @returns {string | null}
 */
export function serializeEditorDraft(draft, maxChars = EDITOR_DRAFT_MAX_CHARS) {
  if (!draft || !isPlainObject(draft.content) || !isBase(draft.base)) return null;
  const savedAt = Math.round(Number(draft.savedAt));
  if (!Number.isSafeInteger(savedAt) || savedAt <= 0) return null;
  let body;
  try {
    body = stableStringify(draft.content);
  } catch {
    return null;
  }
  const raw = `{"v":${FORMAT},"savedAt":${savedAt},"base":${JSON.stringify(draft.base)},"content":${body}}`;
  return raw.length > maxChars ? null : raw;
}

/**
 * A stored draft of `kind` back — or null when it is anything else (not
 * JSON, another format, a bad time or base, content of the wrong shape, too
 * long): the caller removes it.
 * @param {unknown} raw
 * @param {EditorDraftKind} kind
 * @returns {EditorDraft | null}
 */
export function parseEditorDraft(raw, kind) {
  if (!isKind(kind) || typeof raw !== "string" || raw.length === 0 || raw.length > EDITOR_DRAFT_MAX_CHARS) return null;
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isPlainObject(value) || value.v !== FORMAT) return null;
  const savedAt = value.savedAt;
  if (typeof savedAt !== "number" || !Number.isSafeInteger(savedAt) || savedAt <= 0) return null;
  if (!isBase(value.base)) return null;
  const content = editorDraftContent(kind, value.content);
  return content ? { savedAt, base: value.base, content } : null;
}

/**
 * When a stored draft was written, read from its head only (no parse of the
 * whole document) — null when the string does not start like a draft.
 * @param {unknown} raw
 * @returns {number | null}
 */
export function editorDraftSavedAt(raw) {
  if (typeof raw !== "string") return null;
  const m = HEAD_RE.exec(raw);
  if (!m) return null;
  const at = Number(m[1]);
  return Number.isSafeInteger(at) && at > 0 ? at : null;
}

/**
 * What to do with a draft when its object opens:
 *   "none"  — no draft, nothing saved to compare with, or the draft equals
 *             the saved state (a stale leftover — remove it);
 *   "auto"  — it was made on the version that is still saved: put it back;
 *   "offer" — the object was saved after it was made: offer it, don't apply.
 * Bases are compared strictly (a version number with a version number).
 * @param {{ base: EditorDraftBase, content: unknown } | null | undefined} draft
 * @param {unknown} saved      the saved state, same shape as the content
 * @param {EditorDraftBase} savedBase
 * @returns {EditorDraftRestore}
 */
export function editorDraftRestore(draft, saved, savedBase) {
  if (!draft || !isPlainObject(draft.content) || saved == null) return "none";
  if (sameEditorContent(draft.content, saved)) return "none";
  return draft.base === savedBase ? "auto" : "offer";
}

/**
 * The keys to remove: drafts that are broken (key or head), older than
 * `maxAgeMs`, or beyond the newest `maxCount`. `keep` (the draft being
 * written) is never removed and counts as the newest. Other keys are ignored.
 * @param {Array<{ key: string, raw: string | null }>} entries
 * @param {number} now
 * @param {{ maxAgeMs?: number, maxCount?: number, keep?: string | null }} [options]
 * @returns {string[]}
 */
export function editorDraftsToPrune(entries, now, { maxAgeMs = EDITOR_DRAFT_MAX_AGE_MS, maxCount = EDITOR_DRAFT_MAX_COUNT, keep = null } = {}) {
  /** @type {string[]} */
  const drop = [];
  /** @type {Array<{ key: string, at: number }>} */
  const live = [];
  for (const entry of Array.isArray(entries) ? entries : []) {
    const key = entry?.key;
    if (typeof key !== "string" || !key.startsWith(EDITOR_DRAFT_PREFIX)) continue;
    if (key === keep) {
      live.push({ key, at: Infinity });
      continue;
    }
    const at = parseEditorDraftKey(key) ? editorDraftSavedAt(entry.raw) : null;
    if (at === null || now - at > maxAgeMs) drop.push(key);
    else live.push({ key, at });
  }
  live.sort((a, b) => b.at - a.at || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  for (const { key } of live.slice(Math.max(0, maxCount))) {
    if (key !== keep) drop.push(key);
  }
  return drop;
}

/**
 * The drafts of one kind with their time, newest first (what the template
 * list marks). Entries whose key or head is broken are left out.
 * @param {Array<{ key: string, raw: string | null }>} entries
 * @param {EditorDraftKind} kind
 * @returns {Array<{ key: string, id: number | null, savedAt: number }>}
 */
export function listEditorDrafts(entries, kind) {
  /** @type {Array<{ key: string, id: number | null, savedAt: number }>} */
  const out = [];
  for (const entry of Array.isArray(entries) ? entries : []) {
    const parsed = parseEditorDraftKey(entry?.key);
    if (!parsed || parsed.kind !== kind) continue;
    const savedAt = editorDraftSavedAt(entry.raw);
    if (savedAt !== null) out.push({ key: entry.key, id: parsed.id, savedAt });
  }
  return out.sort((a, b) => b.savedAt - a.savedAt);
}
