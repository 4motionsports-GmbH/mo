import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DEFAULT_SHOWROOM_THEME_FILE,
  SHOWROOM_COLLECTION_QUERY,
  SHOWROOM_LIMITS,
  SHOWROOM_SETTINGS_KEY,
  SHOWROOM_THEME_QUERY,
  applyThemeResult,
  emptyShowroomState,
  loadShowroomFromTheme,
  normalizeHandle,
  parseShowroomState,
  serializeShowroomState,
  showroomErrorMessage,
  showroomFromTemplate,
  showroomSections,
  showroomThemeFile,
  showroomView,
  stripLeadingComments,
  validateManualShowroomInput,
} from "./showroom-core.mjs";

// The theme repo's templates/page.json (ms_shopify_clone, as of 2026-10-27) —
// the template of the showroom page; its featured-collection section holds the
// hand-picked showroom products.
const PAGE = readFileSync(new URL("./showroom-page.fixture.json", import.meta.url), "utf8");
const SHOPIFY_HEADER =
  "/*\n * ------------------------------------------------------------\n * IMPORTANT: The contents of this file are auto-generated.\n * ------------------------------------------------------------\n */\n";

test("stripLeadingComments: BOM and Shopify's generated comment block(s) before the JSON", () => {
  assert.equal(stripLeadingComments('{"a":1}'), '{"a":1}');
  assert.equal(stripLeadingComments(`﻿${SHOPIFY_HEADER}{"a":1}`), '{"a":1}');
  assert.equal(stripLeadingComments('/* one */ /* two */\n{"a":1}'), '{"a":1}');
  assert.equal(stripLeadingComments("/* never closed {"), "");
  assert.equal(stripLeadingComments(null), "");
});

test("showroomFromTemplate: the repo's page.json — the hand-picked products of the showroom section", () => {
  const r = showroomFromTemplate(PAGE);
  assert.equal(r.ok, true);
  assert.equal(r.handles.length, 23);
  assert.equal(r.handles[0], "atx®-trinity-tower-latzugstation-3-in-1");
  assert.ok(r.handles.includes("atx®-power-rack-prx-780"));
  assert.ok(r.handles.includes("wadenmaschine-sitzend-plate-load-vision-fitness"));
  assert.deepEqual(r.collections, []);
  assert.deepEqual(r.sections, [{ id: "featured_collection_hzmn37", heading: "Teste unsere Top-Geräte live im Showroom" }]);
  // the same with the comment Shopify puts on top of a template edited in the theme editor
  assert.deepEqual(showroomFromTemplate(SHOPIFY_HEADER + PAGE), r);
});

test("showroomFromTemplate: a pinned section, sections without „Showroom“, disabled ones, collections and blocks", () => {
  const page = JSON.parse(PAGE);
  // pinned by id (SHOWROOM_SECTION_ID)
  assert.equal(showroomFromTemplate(PAGE, { sectionId: "featured_collection_hzmn37" }).handles.length, 23);
  const missing = showroomFromTemplate(PAGE, { sectionId: "nope" });
  assert.equal(missing.ok, false);
  assert.match(missing.error, /Abschnitt „nope“ nicht gefunden/);
  assert.match(showroomFromTemplate(PAGE, { sectionId: "custom_liquid_jDpfwb" }).error, /enthält keine Produkte/);
  // another heading → not a showroom section
  const other = structuredClone(page);
  other.sections.featured_collection_hzmn37.settings.heading = "Bestseller";
  other.sections.featured_collection_hzmn37.settings.subheading = "";
  assert.match(showroomFromTemplate(JSON.stringify(other)).error, /Kein Abschnitt „featured-collection“ mit „Showroom“/);
  // the subheading counts too
  other.sections.featured_collection_hzmn37.settings.subheading = "Live im SHOWROOM testen";
  assert.equal(showroomFromTemplate(JSON.stringify(other)).ok, true);
  // a disabled section is not on the page
  const disabled = structuredClone(page);
  disabled.sections.featured_collection_hzmn37.disabled = true;
  assert.equal(showroomFromTemplate(JSON.stringify(disabled)).ok, false);
  // a collection instead of (or besides) the hand-picked list; product blocks
  const coll = structuredClone(page);
  coll.sections.featured_collection_hzmn37.settings.products = [];
  coll.sections.featured_collection_hzmn37.settings.collection = "showroom";
  coll.sections.featured_collection_hzmn37.blocks = { b1: { type: "product", settings: { product: "atx®-hantelbank" } }, b2: { type: "product", disabled: true, settings: { product: "x" } } };
  const c = showroomFromTemplate(JSON.stringify(coll));
  assert.deepEqual([c.ok, c.handles, c.collections], [true, ["atx®-hantelbank"], ["showroom"]]);
  // empty section / broken file
  const empty = structuredClone(page);
  empty.sections.featured_collection_hzmn37.settings.products = [];
  assert.match(showroomFromTemplate(JSON.stringify(empty)).error, /enthält keine Produkte/);
  assert.match(showroomFromTemplate("{ nope").error, /kein gültiges JSON/);
  assert.match(showroomFromTemplate("[]").error, /keine Abschnitte/);
  assert.deepEqual(showroomSections(null), []);
});

test("normalizeHandle: handles, refs → product, product URLs → handle, junk → empty", () => {
  assert.equal(normalizeHandle(" atx®-power-rack-prx-780 "), "atx®-power-rack-prx-780");
  assert.equal(normalizeHandle("rack~4711"), "rack");
  assert.equal(normalizeHandle("https://motionsports.de/products/atx%C2%AE-rack?variant=1"), "atx®-rack");
  assert.equal(normalizeHandle("bad handle"), "");
  assert.equal(normalizeHandle(42), "");
});

/** A mocked Admin GraphQL: the theme file and (optionally) collections. */
function mockGraphql({ body, theme = true, userErrors = [], collections = {}, throwWith = null } = {}) {
  const calls = [];
  const graphql = async (query, variables) => {
    calls.push({ query, variables });
    if (throwWith) throw throwWith;
    if (query === SHOWROOM_THEME_QUERY) {
      if (!theme) return { themes: { nodes: [] } };
      return {
        themes: {
          nodes: [
            {
              id: "gid://shopify/OnlineStoreTheme/1",
              name: "Live-Theme",
              files: { nodes: body ? [{ filename: variables.filenames[0], body }] : [], userErrors },
            },
          ],
        },
      };
    }
    if (query === SHOWROOM_COLLECTION_QUERY) {
      const handle = /handle:"([^"]+)"/.exec(variables.query)?.[1];
      const products = collections[handle];
      return { collections: { nodes: products ? [{ handle, products: { nodes: products.map((h) => ({ handle: h })) } }] : [] } };
    }
    throw new Error("unexpected query");
  };
  return { graphql, calls };
}

test("loadShowroomFromTheme: reads the main theme's file through the (mocked) Admin API", async () => {
  const text = mockGraphql({ body: { content: SHOPIFY_HEADER + PAGE } });
  const r = await loadShowroomFromTheme({ graphql: text.graphql });
  assert.equal(r.ok, true);
  assert.equal(r.handles.length, 23);
  assert.equal(r.themeName, "Live-Theme");
  assert.equal(r.file, DEFAULT_SHOWROOM_THEME_FILE);
  assert.deepEqual(text.calls[0].variables, { filenames: ["templates/page.json"] });
  // base64 and URL bodies
  const b64 = mockGraphql({ body: { contentBase64: Buffer.from(PAGE, "utf8").toString("base64") } });
  assert.equal((await loadShowroomFromTheme({ graphql: b64.graphql })).handles.length, 23);
  const url = mockGraphql({ body: { url: "https://cdn/x.json" } });
  assert.equal((await loadShowroomFromTheme({ graphql: url.graphql, fetchText: async () => PAGE })).handles.length, 23);
  assert.match((await loadShowroomFromTheme({ graphql: url.graphql })).error, /leer oder nicht lesbar/);
  // another file / a pinned section
  const pinned = mockGraphql({ body: { content: PAGE } });
  const p = await loadShowroomFromTheme({ graphql: pinned.graphql, file: "templates/page.showroom.json", sectionId: "featured_collection_hzmn37" });
  assert.equal(p.ok, true);
  assert.deepEqual(pinned.calls[0].variables, { filenames: ["templates/page.showroom.json"] });
});

test("loadShowroomFromTheme: the linked collection's products join; errors become German messages", async () => {
  const page = JSON.parse(PAGE);
  page.sections.featured_collection_hzmn37.settings.collection = "showroom-geraete";
  const m = mockGraphql({ body: { content: JSON.stringify(page) }, collections: { "showroom-geraete": ["atx®-power-rack-prx-780", "neues-geraet"] } });
  const r = await loadShowroomFromTheme({ graphql: m.graphql });
  assert.equal(r.handles.length, 24);
  assert.equal(r.handles.at(-1), "neues-geraet");
  assert.deepEqual(r.collections, ["showroom-geraete"]);
  assert.equal(m.calls[1].variables.query, 'handle:"showroom-geraete"');
  // no published theme, file missing, missing scope, unreachable
  assert.match((await loadShowroomFromTheme({ graphql: mockGraphql({ theme: false }).graphql })).error, /Kein veröffentlichtes Theme/);
  assert.match(
    (await loadShowroomFromTheme({ graphql: mockGraphql({ userErrors: [{ code: "NOT_FOUND", filename: "templates/page.json" }] }).graphql })).error,
    /„templates\/page\.json“ fehlt im veröffentlichten Theme \(NOT_FOUND\)/
  );
  const denied = new Error('Shopify GraphQL errors: [{"message":"Access denied for themes field. Required access: `read_themes` access scope."}]');
  const d = await loadShowroomFromTheme({ graphql: mockGraphql({ throwWith: denied }).graphql });
  assert.equal(d.ok, false);
  assert.match(d.error, /Berechtigung read_themes fehlt/);
  assert.match(showroomErrorMessage(new TypeError("fetch failed")), /nicht erreichbar/);
  assert.match(showroomErrorMessage(new Error("Missing env var SHOPIFY_STORE_DOMAIN")), /nicht konfiguriert/);
  assert.match(showroomErrorMessage(new Error("Shopify GraphQL throttled after 6 retries")), /Rate-Limit/);
  assert.match(showroomErrorMessage(new Error("boom")), /^Die Theme-Datei konnte nicht gelesen werden: boom$/);
});

test("state: fail-soft parse, a failed refresh keeps the last good list, the view knows its source", () => {
  assert.equal(SHOWROOM_SETTINGS_KEY, "showroom");
  assert.deepEqual(parseShowroomState(null), emptyShowroomState());
  assert.deepEqual(parseShowroomState("{broken"), emptyShowroomState());
  const unknown = showroomView(null);
  assert.deepEqual([unknown.known, unknown.ids.size, unknown.source], [false, 0, "none"]);

  const ok = applyThemeResult(emptyShowroomState(), { ok: true, handles: ["rack", "bike"], collections: [], sections: [{ id: "s", heading: "Showroom" }], themeName: "Live", file: "templates/page.json" }, "2026-10-27T03:00:00Z");
  assert.equal(ok.theme.fetchedAt, "2026-10-27T03:00:00.000Z");
  assert.equal(ok.lastError, null);
  assert.deepEqual(showroomView(ok).ids, new Set(["rack", "bike"]));
  assert.equal(showroomView(ok).source, "theme");

  const failed = applyThemeResult(ok, { ok: false, error: "Berechtigung read_themes fehlt …", file: "templates/page.json" }, "2026-10-28T03:00:00Z");
  assert.deepEqual(failed.theme.handles, ["rack", "bike"]); // the last good list stays
  assert.equal(failed.theme.fetchedAt, "2026-10-27T03:00:00.000Z");
  assert.equal(failed.lastAttemptAt, "2026-10-28T03:00:00.000Z");
  assert.match(failed.lastError, /read_themes/);
  assert.equal(showroomView(failed).known, true);

  // the manual list alone makes it known; both together
  const manual = { ...emptyShowroomState(), manualHandles: ["bank"] };
  assert.deepEqual([showroomView(manual).known, showroomView(manual).source], [true, "manual"]);
  const both = { ...failed, manualHandles: ["bank", "rack"] };
  assert.deepEqual(showroomView(both).ids, new Set(["rack", "bike", "bank"]));
  assert.deepEqual([showroomView(both).source, showroomView(both).themeCount, showroomView(both).manualCount], ["theme+manual", 2, 2]);

  // round trip through the stored JSON; a theme result without products never counts as read
  assert.deepEqual(parseShowroomState(serializeShowroomState(both)), parseShowroomState(both));
  const hollow = parseShowroomState({ theme: { handles: [], fetchedAt: "2026-10-27T03:00:00Z" } });
  assert.equal(hollow.theme.fetchedAt, null);
  assert.equal(showroomView(hollow).known, false);
  // the error is clipped
  assert.equal(applyThemeResult(emptyShowroomState(), { ok: false, error: "x".repeat(500) }).lastError.length, SHOWROOM_LIMITS.errorMax);
});

test("validateManualShowroomInput and showroomThemeFile", () => {
  assert.deepEqual(validateManualShowroomInput({ handles: ["rack", " bank ", "rack~1", "rack"] }), { ok: true, handles: ["rack", "bank"] });
  assert.deepEqual(validateManualShowroomInput([]), { ok: true, handles: [] });
  assert.equal(validateManualShowroomInput({ handles: "rack" }).ok, false);
  assert.match(validateManualShowroomInput({ handles: ["bad handle"] }).message, /Ungültiger Produkt-Handle/);
  assert.match(validateManualShowroomInput({ handles: Array.from({ length: 61 }, (_, i) => `p${i}`) }).message, /Höchstens 60/);
  assert.equal(showroomThemeFile(undefined), DEFAULT_SHOWROOM_THEME_FILE);
  assert.equal(showroomThemeFile(""), DEFAULT_SHOWROOM_THEME_FILE);
  assert.equal(showroomThemeFile("templates/page.showroom.json"), "templates/page.showroom.json");
  assert.equal(showroomThemeFile("off"), null);
  assert.equal(showroomThemeFile("0"), null);
  assert.equal(showroomThemeFile("../../etc passwd"), DEFAULT_SHOWROOM_THEME_FILE);
});

test("showroomToolResult: on display or not, none → ok false, unknown list → no promise; showroomKnown on every result", async () => {
  const { showroomToolResult } = await import("./showroom-core.mjs");
  const catalog = new Set(["rack", "bike", "bank"]);
  const isKnown = (id) => catalog.has(id);
  const view = { known: true, ids: new Set(["rack"]) };
  // the widget reads ok / showroomKnown / inShowroom — both known-list branches say showroomKnown: true
  assert.deepEqual(showroomToolResult(["rack~7", "rack"], view, isKnown), { ok: true, showroomKnown: true, inShowroom: ["rack"], notInShowroom: [] });
  const mixed = showroomToolResult(["rack", "bike", "ghost"], view, isKnown);
  assert.equal(mixed.ok, true);
  assert.equal(mixed.showroomKnown, true);
  assert.deepEqual([mixed.inShowroom, mixed.notInShowroom, mixed.unknownIds], [["rack"], ["bike"], ["ghost"]]);
  assert.match(mixed.note, /Nur die Produkte in inShowroom sind ausgestellt/);
  const none = showroomToolResult(["bike", "bank"], view, isKnown);
  assert.deepEqual([none.ok, none.showroomKnown], [false, true]);
  assert.deepEqual(none.inShowroom, []);
  assert.deepEqual(none.notInShowroom, ["bike", "bank"]);
  assert.equal("unknownIds" in none, false);
  assert.match(none.reason, /Keines dieser Produkte ist im Showroom ausgestellt — es wird keine Showroom-Karte gezeigt/);
  assert.match(showroomToolResult(["bike"], view, isKnown, "en").reason, /None of these products is on display/);
  // only unknown ids (a mistyped handle of a displayed machine): no claim about the display — retry with the right ids
  for (const ids of [["ghost"], ["atx-rack", "ghost~4"], [], null]) {
    const u = showroomToolResult(ids, view, isKnown);
    assert.deepEqual([u.ok, u.showroomKnown, u.inShowroom, u.notInShowroom], [false, true, [], []], JSON.stringify(ids));
    assert.match(u.reason, /^Unbekannte Produkt-IDs — nimm die IDs aus den Produktzeilen und ruf suggest_showroom erneut auf; sag nichts darüber, ob diese Produkte ausgestellt sind\.$/);
    assert.doesNotMatch(u.reason, /nicht ausgestellt|Keines/);
  }
  assert.deepEqual(showroomToolResult(["ghost", "atx-rack"], view, isKnown).unknownIds, ["ghost", "atx-rack"]);
  assert.match(showroomToolResult(["ghost"], view, isKnown, "en").reason, /^Unknown product ids — take the ids from the product lines and call suggest_showroom again; say nothing about whether these products are on display\.$/);
  // unknown and not-displayed ids: the reason speaks only about notInShowroom
  const notShownAndUnknown = showroomToolResult(["bike", "ghost"], view, isKnown);
  assert.deepEqual([notShownAndUnknown.ok, notShownAndUnknown.notInShowroom, notShownAndUnknown.unknownIds], [false, ["bike"], ["ghost"]]);
  assert.match(notShownAndUnknown.reason, /^Die Produkte in notInShowroom sind nicht im Showroom ausgestellt — es wird keine Showroom-Karte gezeigt\. Sag ehrlich, dass diese dort nicht ausgestellt sind, und schlag den Showroom für sie nicht vor\. Die IDs in unknownIds sind unbekannt: Sag nichts darüber, ob sie ausgestellt sind/);
  assert.match(showroomToolResult(["bike", "ghost"], view, isKnown, "en").reason, /^The products in notInShowroom are not on display in the showroom/);
  // the unknown list: no promise, showroomKnown false; only unknown ids → retry, no card either
  const unknown = showroomToolResult(["bike"], { known: false, ids: new Set() }, isKnown);
  assert.deepEqual([unknown.ok, unknown.showroomKnown, unknown.inShowroom], [true, false, []]);
  assert.match(unknown.note, /gerade nicht bekannt — sag kein bestimmtes Gerät zu/);
  const unknownGhost = showroomToolResult(["ghost"], { known: false, ids: new Set() }, isKnown);
  assert.deepEqual([unknownGhost.ok, unknownGhost.showroomKnown, unknownGhost.unknownIds], [false, false, ["ghost"]]);
});

test("loadShowroomFromTheme: a renamed heading falls back to the section ids of the last good read", async () => {
  const { showroomFromStoredSections } = await import("./showroom-core.mjs");
  const renamed = JSON.parse(PAGE);
  renamed.sections.featured_collection_hzmn37.settings.heading = "Teste unsere Top-Geräte live in Gröbenzell";
  const content = JSON.stringify(renamed);
  // without a fallback: the heading no longer says „Showroom“ → the error
  const plain = await loadShowroomFromTheme({ graphql: mockGraphql({ body: { content } }).graphql });
  assert.equal(plain.ok, false);
  assert.match(plain.error, /Kein Abschnitt „featured-collection“ mit „Showroom“/);
  // with the stored id of the last good read: the list keeps following the theme
  const r = await loadShowroomFromTheme({ graphql: mockGraphql({ body: { content } }).graphql, fallbackSectionIds: ["featured_collection_hzmn37"] });
  assert.equal(r.ok, true);
  assert.equal(r.handles.length, 23);
  assert.deepEqual(r.sections, [{ id: "featured_collection_hzmn37", heading: "Teste unsere Top-Geräte live in Gröbenzell" }]);
  // a hand-picked change after the rename reaches the list
  renamed.sections.featured_collection_hzmn37.settings.products = ["atx®-power-rack-prx-780", "neues-geraet"];
  const changed = await loadShowroomFromTheme({ graphql: mockGraphql({ body: { content: JSON.stringify(renamed) } }).graphql, fallbackSectionIds: ["featured_collection_hzmn37"] });
  assert.deepEqual(changed.handles, ["atx®-power-rack-prx-780", "neues-geraet"]);
  // the stored section is gone too → the original error is recorded
  const gone = await loadShowroomFromTheme({ graphql: mockGraphql({ body: { content } }).graphql, fallbackSectionIds: ["deleted_section"] });
  assert.equal(gone.ok, false);
  assert.match(gone.error, /Kein Abschnitt „featured-collection“ mit „Showroom“/);
  // a pinned section (SHOWROOM_SECTION_ID) never falls back
  const pinned = await loadShowroomFromTheme({ graphql: mockGraphql({ body: { content } }).graphql, sectionId: "nope", fallbackSectionIds: ["featured_collection_hzmn37"] });
  assert.equal(pinned.ok, false);
  assert.match(pinned.error, /Abschnitt „nope“ nicht gefunden/);
  // a heading that still matches is read as before, the fallback unused
  const normal = await loadShowroomFromTheme({ graphql: mockGraphql({ body: { content: PAGE } }).graphql, fallbackSectionIds: ["custom_liquid_jDpfwb"] });
  assert.deepEqual([normal.ok, normal.handles.length, normal.sections[0].id], [true, 23, "featured_collection_hzmn37"]);
  // the pure helper: empty / junk ids → null; an empty stored section → null
  assert.equal(showroomFromStoredSections(content, []), null);
  assert.equal(showroomFromStoredSections(content, null), null);
  assert.equal(showroomFromStoredSections(content, ["custom_liquid_jDpfwb"]), null);
  assert.equal(showroomFromStoredSections("{ nope", ["featured_collection_hzmn37"]), null);
});
