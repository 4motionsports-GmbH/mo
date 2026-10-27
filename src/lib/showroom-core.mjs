// Showroom availability (Home-Gym-Konfigurator round of 2026-10-27) — pure.
//
// Which products are on display in the showroom (Gröbenzell). The showroom page
// of the shop (https://motionsports.de/pages/showroom-munchen-grobenzell) uses
// the theme's default page template `templates/page.json`; its products come
// from a `featured-collection` section („Teste unsere Top-Geräte live im
// Showroom“) whose `products` setting is a hand-picked list of product handles
// — no collection, tag or metafield. That list lives only in the LIVE theme, so
// the backend reads the main theme's template through the Admin API (scope
// `read_themes` — TODO(maintainer): the app does not have it yet; add the scope
// to the app and reinstall it, docs/CONFIGURATOR.md §4b), takes the
// featured-collection section(s) whose heading or subheading mentions
// „Showroom“ (or the section SHOWROOM_SECTION_ID pins) and, if such a section
// points to a collection, that collection's products as well.
//
// The last good list is kept in admin_settings (key 'showroom' — no migration)
// together with a manual fallback list from the admin; a failed refresh keeps
// the last good list (fail-soft). Unknown (never read, no manual list) → Mo
// does not suggest the showroom on his own (system-prompt-core).
//
// This file: the template parser, the stored state, the refresh flow with the
// GraphQL call injected (tests mock it; showroom-store.ts wires adminGraphql).

/** admin_settings key (migration 0078 — no new migration). */
export const SHOWROOM_SETTINGS_KEY = "showroom";

/** The theme file that holds the showroom page's sections (env SHOWROOM_THEME_FILE). */
export const DEFAULT_SHOWROOM_THEME_FILE = "templates/page.json";

export const SHOWROOM_LIMITS = Object.freeze({
  /** Products of the manual fallback list (admin). */
  manualMax: 60,
  /** Handles kept from the theme (sections + collections). */
  handlesMax: 250,
  /** Characters of a stored error. */
  errorMax: 300,
});

const HANDLE_RE = /^[^\s,~]{1,255}$/;

/** @param {unknown} v */
function asRecord(v) {
  return v && typeof v === "object" && !Array.isArray(v) ? /** @type {Record<string, unknown>} */ (v) : null;
}

/** A product handle as stored ("" when unusable; a variant ref → its product). @param {unknown} raw */
export function normalizeHandle(raw) {
  if (typeof raw !== "string") return "";
  let h = raw.trim();
  const tilde = h.indexOf("~");
  if (tilde > 0) h = h.slice(0, tilde);
  // A product_list setting may hold a GID or a URL by mistake — take the handle part.
  const m = /\/products\/([^/?#\s]+)/.exec(h);
  if (m) {
    try {
      h = decodeURIComponent(m[1]);
    } catch {
      h = m[1];
    }
  }
  return HANDLE_RE.test(h) ? h : "";
}

/** Unique handles, in order, capped. @param {unknown} list @param {number} max */
function handleList(list, max) {
  /** @type {string[]} */
  const out = [];
  for (const raw of Array.isArray(list) ? list : typeof list === "string" ? list.split(/[\s,;]+/) : []) {
    const h = normalizeHandle(raw);
    if (h && !out.includes(h)) out.push(h);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * A theme JSON template as Shopify stores it: optional BOM, then the
 * auto-generated `/* … *\/` comment block(s) Shopify puts on top of a template
 * edited in the theme editor, then the JSON. Strips the leading comments.
 * @param {unknown} text
 * @returns {string}
 */
export function stripLeadingComments(text) {
  let s = String(text ?? "").replace(/^﻿/, "").trimStart();
  for (let i = 0; i < 5 && s.startsWith("/*"); i++) {
    const end = s.indexOf("*/");
    if (end < 0) return "";
    s = s.slice(end + 2).trimStart();
  }
  return s;
}

/**
 * @typedef {{ id: string, type: string, heading: string, subheading: string, handles: string[], collection: string }} ShowroomSection
 */

/**
 * The showroom sections of a parsed template: every enabled
 * `featured-collection` section whose heading or subheading mentions
 * „Showroom“ — or, with `sectionId`, exactly that section (any type).
 * Handles come from the section's `products` setting (a product_list) and from
 * product blocks; `collection` is the section's collection handle ("" none).
 * @param {unknown} template
 * @param {{ sectionId?: string | null }} [opts]
 * @returns {ShowroomSection[]}
 */
export function showroomSections(template, opts = {}) {
  const sections = asRecord(asRecord(template)?.sections);
  if (!sections) return [];
  const pin = typeof opts.sectionId === "string" ? opts.sectionId.trim() : "";
  /** @type {ShowroomSection[]} */
  const out = [];
  for (const [id, raw] of Object.entries(sections)) {
    const s = asRecord(raw);
    if (!s || s.disabled === true) continue;
    const type = typeof s.type === "string" ? s.type : "";
    const settings = asRecord(s.settings) ?? {};
    const heading = typeof settings.heading === "string" ? settings.heading : "";
    const subheading = typeof settings.subheading === "string" ? settings.subheading : "";
    if (pin) {
      if (id !== pin) continue;
    } else if (!/featured[-_]?collection/i.test(type) || !/showroom/i.test(`${heading} ${subheading}`)) {
      continue;
    }
    /** @type {unknown[]} */
    const fromBlocks = [];
    for (const b of Object.values(asRecord(s.blocks) ?? {})) {
      const block = asRecord(b);
      if (!block || block.disabled === true) continue;
      const product = asRecord(block.settings)?.product;
      if (typeof product === "string") fromBlocks.push(product);
    }
    const collection = typeof settings.collection === "string" ? normalizeHandle(settings.collection) : "";
    out.push({
      id,
      type,
      heading: heading.trim().slice(0, 120),
      subheading: subheading.trim().slice(0, 120),
      handles: handleList([...(Array.isArray(settings.products) ? settings.products : []), ...fromBlocks], SHOWROOM_LIMITS.handlesMax),
      collection,
    });
  }
  return out;
}

/**
 * The showroom of a theme template file (its raw content): the handles of the
 * showroom section(s) and the collections they point to. German errors.
 * @param {unknown} content
 * @param {{ sectionId?: string | null }} [opts]
 * @returns {{ ok: true, handles: string[], collections: string[], sections: Array<{ id: string, heading: string }> } | { ok: false, error: string }}
 */
export function showroomFromTemplate(content, opts = {}) {
  const json = stripLeadingComments(content);
  /** @type {unknown} */
  let template;
  try {
    template = JSON.parse(json);
  } catch {
    return { ok: false, error: "Die Theme-Datei ist kein gültiges JSON." };
  }
  if (!asRecord(asRecord(template)?.sections)) return { ok: false, error: "Die Theme-Datei hat keine Abschnitte (sections)." };
  const pin = typeof opts.sectionId === "string" ? opts.sectionId.trim() : "";
  const sections = showroomSections(template, { sectionId: pin || null });
  if (!sections.length) {
    return {
      ok: false,
      error: pin
        ? `Abschnitt „${pin.slice(0, 60)}“ nicht gefunden (oder deaktiviert).`
        : "Kein Abschnitt „featured-collection“ mit „Showroom“ in der Überschrift gefunden.",
    };
  }
  const handles = handleList(sections.flatMap((s) => s.handles), SHOWROOM_LIMITS.handlesMax);
  const collections = [...new Set(sections.map((s) => s.collection).filter(Boolean))];
  if (!handles.length && !collections.length) return { ok: false, error: "Der Showroom-Abschnitt enthält keine Produkte." };
  return { ok: true, handles, collections, sections: sections.map((s) => ({ id: s.id, heading: s.heading || s.subheading })) };
}

// ---------------------------------------------------------------------------
// Admin API (read_themes) — the queries and the refresh flow
// ---------------------------------------------------------------------------

/** The main theme's file (Admin GraphQL; needs the scope read_themes). */
export const SHOWROOM_THEME_QUERY = /* GraphQL */ `
  query ShowroomThemeFile($filenames: [String!]!) {
    themes(first: 1, roles: [MAIN]) {
      nodes {
        id
        name
        files(filenames: $filenames, first: 1) {
          nodes {
            filename
            body {
              ... on OnlineStoreThemeFileBodyText {
                content
              }
              ... on OnlineStoreThemeFileBodyBase64 {
                contentBase64
              }
              ... on OnlineStoreThemeFileBodyUrl {
                url
              }
            }
          }
          userErrors {
            code
            filename
          }
        }
      }
    }
  }
`;

/** The products of a collection the showroom section points to (read_products). */
export const SHOWROOM_COLLECTION_QUERY = /* GraphQL */ `
  query ShowroomCollection($query: String!) {
    collections(first: 1, query: $query) {
      nodes {
        handle
        products(first: 250) {
          nodes {
            handle
          }
        }
      }
    }
  }
`;

/**
 * A German message for a failed theme read — the admin shows it („Berechtigung
 * read_themes fehlt?“).
 * @param {unknown} err
 */
export function showroomErrorMessage(err) {
  const msg = String(/** @type {any} */ (err)?.message ?? err ?? "");
  if (/read_themes|access denied|ACCESS_DENIED|not approved|required access/i.test(msg)) {
    return "Berechtigung read_themes fehlt — den Scope in der Shopify-App ergänzen und die App neu installieren.";
  }
  if (/Missing env var|not configured|nicht konfiguriert/i.test(msg)) return "Shopify ist nicht konfiguriert (SHOPIFY_*).";
  if (/THROTTLED|throttled/i.test(msg)) return "Shopify war ausgelastet (Rate-Limit) — später erneut versuchen.";
  if (/fetch failed|ETIMEDOUT|ECONNRESET|ENOTFOUND|TimeoutError|aborted/i.test(msg)) return "Shopify war nicht erreichbar — später erneut versuchen.";
  const short = msg.replace(/\s+/g, " ").trim().slice(0, 200);
  return short ? `Die Theme-Datei konnte nicht gelesen werden: ${short}` : "Die Theme-Datei konnte nicht gelesen werden.";
}

/** @param {string} b64 */
function decodeBase64(b64) {
  const B = /** @type {any} */ (globalThis).Buffer;
  if (B) return B.from(b64, "base64").toString("utf8");
  return new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
}

/**
 * The showroom of a template whose heading no longer says „Showroom“ (the
 * client renamed it in the theme editor): when no section matches and no
 * section is pinned (SHOWROOM_SECTION_ID), the sections of the last good read
 * (`fallbackSectionIds`) are tried by id before the error is recorded — so a
 * renamed heading does not freeze the list. Null when none of them parses.
 * @param {string} content the template file
 * @param {ReadonlyArray<string> | null | undefined} fallbackSectionIds
 * @returns {{ ok: true, handles: string[], collections: string[], sections: Array<{ id: string, heading: string }> } | null}
 */
export function showroomFromStoredSections(content, fallbackSectionIds) {
  const ids = [...new Set((fallbackSectionIds ?? []).filter((id) => typeof id === "string" && id.trim()).map((id) => id.trim()))].slice(0, 10);
  /** @type {string[]} */
  let handles = [];
  /** @type {string[]} */
  const collections = [];
  /** @type {Array<{ id: string, heading: string }>} */
  const sections = [];
  for (const id of ids) {
    const r = showroomFromTemplate(content, { sectionId: id });
    if (!r.ok) continue;
    handles = handleList([...handles, ...r.handles], SHOWROOM_LIMITS.handlesMax);
    for (const c of r.collections) if (!collections.includes(c)) collections.push(c);
    sections.push(...r.sections);
  }
  return sections.length && (handles.length || collections.length) ? { ok: true, handles, collections, sections } : null;
}

/**
 * Read the showroom from the main theme: the template file (text, base64 or a
 * URL body), the showroom section(s) — by heading, by the pin, or (heading
 * renamed, no pin) by the section ids of the last good read — then the
 * products of a linked collection. Never throws.
 * @param {{
 *   graphql: (query: string, variables: Record<string, unknown>) => Promise<any>,
 *   fetchText?: (url: string) => Promise<string>,
 *   file?: string,
 *   sectionId?: string | null,
 *   fallbackSectionIds?: ReadonlyArray<string> | null,
 * }} io
 * @returns {Promise<{ ok: true, handles: string[], collections: string[], sections: Array<{ id: string, heading: string }>, themeName: string, file: string } | { ok: false, error: string, file: string }>}
 */
export async function loadShowroomFromTheme(io) {
  const file = typeof io.file === "string" && io.file.trim() ? io.file.trim() : DEFAULT_SHOWROOM_THEME_FILE;
  try {
    const data = await io.graphql(SHOWROOM_THEME_QUERY, { filenames: [file] });
    const theme = data?.themes?.nodes?.[0];
    if (!theme) return { ok: false, error: "Kein veröffentlichtes Theme (MAIN) gefunden.", file };
    const node = theme.files?.nodes?.find((/** @type {any} */ n) => n?.filename === file) ?? theme.files?.nodes?.[0];
    if (!node) {
      const code = theme.files?.userErrors?.[0]?.code;
      return { ok: false, error: `Die Datei „${file}“ fehlt im veröffentlichten Theme${code ? ` (${code})` : ""}.`, file };
    }
    const body = node.body ?? {};
    /** @type {string} */
    let content = "";
    if (typeof body.content === "string") content = body.content;
    else if (typeof body.contentBase64 === "string") content = decodeBase64(body.contentBase64);
    else if (typeof body.url === "string" && io.fetchText) content = await io.fetchText(body.url);
    if (!content) return { ok: false, error: `Die Datei „${file}“ ist leer oder nicht lesbar.`, file };
    let parsed = showroomFromTemplate(content, { sectionId: io.sectionId ?? null });
    if (!parsed.ok && !(typeof io.sectionId === "string" && io.sectionId.trim())) {
      // A renamed heading: the sections of the last good read, by id, before recording the error.
      parsed = showroomFromStoredSections(content, io.fallbackSectionIds) ?? parsed;
    }
    if (!parsed.ok) return { ok: false, error: parsed.error, file };
    let handles = parsed.handles;
    for (const collection of parsed.collections) {
      const res = await io.graphql(SHOWROOM_COLLECTION_QUERY, { query: `handle:"${collection.replace(/"/g, "")}"` });
      const c = res?.collections?.nodes?.find((/** @type {any} */ n) => n?.handle === collection);
      const more = (c?.products?.nodes ?? []).map((/** @type {any} */ p) => p?.handle);
      handles = handleList([...handles, ...more], SHOWROOM_LIMITS.handlesMax);
    }
    if (!handles.length) return { ok: false, error: "Der Showroom-Abschnitt enthält keine Produkte.", file };
    return {
      ok: true,
      handles,
      collections: parsed.collections,
      sections: parsed.sections,
      themeName: typeof theme.name === "string" ? theme.name.slice(0, 120) : "",
      file,
    };
  } catch (err) {
    return { ok: false, error: showroomErrorMessage(err), file };
  }
}

// ---------------------------------------------------------------------------
// Stored state (admin_settings 'showroom')
// ---------------------------------------------------------------------------

/**
 * @typedef {{
 *   theme: { handles: string[], collections: string[], sections: Array<{ id: string, heading: string }>, themeName: string, file: string, fetchedAt: string | null },
 *   manualHandles: string[],
 *   lastAttemptAt: string | null,
 *   lastError: string | null,
 * }} ShowroomState
 */

/** @returns {ShowroomState} */
export function emptyShowroomState() {
  return {
    theme: { handles: [], collections: [], sections: [], themeName: "", file: DEFAULT_SHOWROOM_THEME_FILE, fetchedAt: null },
    manualHandles: [],
    lastAttemptAt: null,
    lastError: null,
  };
}

/** @param {unknown} v @returns {string | null} */
function isoOrNull(v) {
  if (typeof v !== "string" || !v.trim()) return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/**
 * The stored value → the state. Fail-soft per field (a broken row is an
 * unknown showroom, never an error).
 * @param {unknown} value
 * @returns {ShowroomState}
 */
export function parseShowroomState(value) {
  let v = value;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      v = null;
    }
  }
  const obj = asRecord(v) ?? {};
  const theme = asRecord(obj.theme) ?? {};
  const base = emptyShowroomState();
  const sections = (Array.isArray(theme.sections) ? theme.sections : [])
    .map((s) => asRecord(s))
    .filter((s) => s && typeof s.id === "string")
    .slice(0, 10)
    .map((s) => ({ id: String(/** @type {any} */ (s).id).slice(0, 120), heading: typeof s?.heading === "string" ? s.heading.slice(0, 120) : "" }));
  const handles = handleList(theme.handles, SHOWROOM_LIMITS.handlesMax);
  const fetchedAt = isoOrNull(theme.fetchedAt);
  return {
    theme: {
      handles,
      collections: handleList(theme.collections, 20),
      sections,
      themeName: typeof theme.themeName === "string" ? theme.themeName.slice(0, 120) : "",
      file: typeof theme.file === "string" && theme.file.trim() ? theme.file.trim().slice(0, 200) : base.theme.file,
      // A theme result counts only with products.
      fetchedAt: handles.length ? fetchedAt : null,
    },
    manualHandles: handleList(obj.manualHandles, SHOWROOM_LIMITS.manualMax),
    lastAttemptAt: isoOrNull(obj.lastAttemptAt),
    lastError: typeof obj.lastError === "string" && obj.lastError.trim() ? obj.lastError.trim().slice(0, SHOWROOM_LIMITS.errorMax) : null,
  };
}

/**
 * The state after a refresh: a good result replaces the theme list and clears
 * the error; a failed one keeps the last good list and records the error.
 * @param {ShowroomState} state
 * @param {Awaited<ReturnType<typeof loadShowroomFromTheme>>} result
 * @param {Date | string} [now]
 * @returns {ShowroomState}
 */
export function applyThemeResult(state, result, now = new Date()) {
  const at = new Date(now).toISOString();
  const s = parseShowroomState(state);
  if (result && result.ok === true) {
    return {
      ...s,
      theme: {
        handles: handleList(result.handles, SHOWROOM_LIMITS.handlesMax),
        collections: handleList(result.collections, 20),
        sections: (result.sections ?? []).slice(0, 10).map((x) => ({ id: String(x.id).slice(0, 120), heading: String(x.heading ?? "").slice(0, 120) })),
        themeName: String(result.themeName ?? "").slice(0, 120),
        file: result.file || s.theme.file,
        fetchedAt: at,
      },
      lastAttemptAt: at,
      lastError: null,
    };
  }
  const error = result && typeof result.error === "string" && result.error.trim() ? result.error.trim() : "Die Theme-Datei konnte nicht gelesen werden.";
  return { ...s, lastAttemptAt: at, lastError: error.slice(0, SHOWROOM_LIMITS.errorMax) };
}

/**
 * The stored value to write (the shape parseShowroomState reads).
 * @param {ShowroomState} state
 */
export function serializeShowroomState(state) {
  const s = parseShowroomState(state);
  return JSON.stringify(s);
}

/**
 * What the chat, the products endpoint and the admin use: the products on
 * display (theme list ∪ manual list, product handles) and whether the
 * showroom is known at all (a theme list was read once, or the manual list is
 * not empty). `source`: "theme" | "manual" | "theme+manual" | "none".
 * @param {ShowroomState | null | undefined} state
 * @returns {{ known: boolean, ids: Set<string>, source: "theme" | "manual" | "theme+manual" | "none", themeCount: number, manualCount: number }}
 */
export function showroomView(state) {
  const s = parseShowroomState(state ?? null);
  const theme = s.theme.fetchedAt ? s.theme.handles : [];
  const ids = new Set([...theme, ...s.manualHandles]);
  const source = theme.length && s.manualHandles.length ? "theme+manual" : theme.length ? "theme" : s.manualHandles.length ? "manual" : "none";
  return { known: ids.size > 0, ids, source, themeCount: theme.length, manualCount: s.manualHandles.length };
}

/**
 * Strict check of the admin's manual list (German messages).
 * @param {unknown} value { handles: string[] } or the list itself
 * @returns {{ ok: true, handles: string[] } | { ok: false, message: string }}
 */
export function validateManualShowroomInput(value) {
  const raw = Array.isArray(value) ? value : asRecord(value)?.handles;
  if (!Array.isArray(raw)) return { ok: false, message: "Ungültige Liste der Showroom-Produkte." };
  if (raw.length > SHOWROOM_LIMITS.manualMax) return { ok: false, message: `Höchstens ${SHOWROOM_LIMITS.manualMax} Showroom-Produkte.` };
  for (const h of raw) {
    if (!normalizeHandle(h)) return { ok: false, message: "Ungültiger Produkt-Handle in der Showroom-Liste." };
  }
  return { ok: true, handles: handleList(raw, SHOWROOM_LIMITS.manualMax) };
}

/**
 * The theme source as configured: SHOWROOM_THEME_FILE ("" → the default;
 * "off" / "0" / "false" → no theme source, the manual list only).
 * @param {unknown} raw
 * @returns {string | null}
 */
export function showroomThemeFile(raw) {
  const v = typeof raw === "string" ? raw.trim() : "";
  if (!v) return DEFAULT_SHOWROOM_THEME_FILE;
  if (/^(off|0|false|no|aus)$/i.test(v)) return null;
  return /^[\w./-]{1,200}$/.test(v) ? v : DEFAULT_SHOWROOM_THEME_FILE;
}

// ---------------------------------------------------------------------------
// The suggest_showroom tool result
// ---------------------------------------------------------------------------

/**
 * The result of suggest_showroom. The model reads all of it; the widget reads
 * `ok` (false → no card), `showroomKnown` (false → the list is unknown: a card
 * without product names) and `inShowroom` (the products the card names,
 * together with `showroom: true` of GET /api/products) — part of the widget
 * contract (API_CONTRACT §2), not model-only. Which of the products are on
 * display (`inShowroom`) and which are not (`notInShowroom`; unknown ids apart
 * in `unknownIds`). `showroomKnown` is on every result.
 *   - only unknown ids (or none) → `ok: false` with a reason to retry with the
 *     ids of the product lines — no claim about the display (a mistyped
 *     handle of a displayed machine must not be called „not on display“);
 *   - unknown list → `ok: true`, `showroomKnown: false` and a note not to
 *     promise a product;
 *   - none of the known products on display → `ok: false` with a reason about
 *     exactly those products (`notInShowroom`), the unknown ids left out of it.
 * @param {unknown} productIds the tool input's productIds (ids or variant refs)
 * @param {{ known: boolean, ids: ReadonlySet<string> }} view showroomView
 * @param {(id: string) => boolean} isKnownProduct is it a catalog product?
 * @param {"de" | "en"} [locale]
 */
export function showroomToolResult(productIds, view, isKnownProduct, locale = "de") {
  const en = locale === "en";
  const known = Boolean(view?.known);
  const ids = handleList(Array.isArray(productIds) ? productIds : [], SHOWROOM_LIMITS.handlesMax);
  const unknownIds = ids.filter((id) => !isKnownProduct(id));
  const products = ids.filter((id) => isKnownProduct(id));
  const unknown = unknownIds.length ? { unknownIds } : {};
  if (!products.length) {
    return {
      ok: false,
      showroomKnown: known,
      inShowroom: [],
      notInShowroom: [],
      unknownIds,
      reason: en
        ? "Unknown product ids — take the ids from the product lines and call suggest_showroom again; say nothing about whether these products are on display."
        : "Unbekannte Produkt-IDs — nimm die IDs aus den Produktzeilen und ruf suggest_showroom erneut auf; sag nichts darüber, ob diese Produkte ausgestellt sind.",
    };
  }
  if (!known) {
    return {
      ok: true,
      showroomKnown: false,
      inShowroom: [],
      notInShowroom: [],
      ...unknown,
      note: en
        ? "Which products are on display in the showroom is not known right now — don't promise any particular product; the team confirms it when the appointment is made."
        : "Welche Produkte im Showroom ausgestellt sind, ist gerade nicht bekannt — sag kein bestimmtes Gerät zu; das Team bestätigt es bei der Terminvereinbarung.",
    };
  }
  const inShowroom = products.filter((id) => view.ids.has(id));
  const notInShowroom = products.filter((id) => !view.ids.has(id));
  if (!inShowroom.length) {
    return {
      ok: false,
      showroomKnown: true,
      inShowroom,
      notInShowroom,
      ...unknown,
      reason: unknownIds.length
        ? en
          ? "The products in notInShowroom are not on display in the showroom — no showroom card is shown. Say honestly that these are not on display there and don't suggest the showroom for them. The ids in unknownIds are unknown: say nothing about whether they are on display (take the ids from the product lines)."
          : "Die Produkte in notInShowroom sind nicht im Showroom ausgestellt — es wird keine Showroom-Karte gezeigt. Sag ehrlich, dass diese dort nicht ausgestellt sind, und schlag den Showroom für sie nicht vor. Die IDs in unknownIds sind unbekannt: Sag nichts darüber, ob sie ausgestellt sind (nimm die IDs aus den Produktzeilen)."
        : en
          ? "None of these products is on display in the showroom — no showroom card is shown. Say honestly that they are not on display there and don't suggest the showroom for them."
          : "Keines dieser Produkte ist im Showroom ausgestellt — es wird keine Showroom-Karte gezeigt. Sag ehrlich, dass sie dort nicht ausgestellt sind, und schlag den Showroom für sie nicht vor.",
    };
  }
  return {
    ok: true,
    showroomKnown: true,
    inShowroom,
    notInShowroom,
    ...unknown,
    ...(notInShowroom.length
      ? {
          note: en
            ? "Only the products in inShowroom are on display — present only those as showroom products."
            : "Nur die Produkte in inShowroom sind ausgestellt — sprich nur über diese als Showroom-Geräte.",
        }
      : {}),
  };
}
