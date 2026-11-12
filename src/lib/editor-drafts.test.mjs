import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EDITOR_DRAFT_MAX_AGE_MS,
  EDITOR_DRAFT_MAX_CHARS,
  EDITOR_DRAFT_MAX_COUNT,
  EDITOR_DRAFT_PREFIX,
  editorDraftContent,
  editorDraftKey,
  editorDraftRestore,
  editorDraftSavedAt,
  editorDraftsToPrune,
  listEditorDrafts,
  parseEditorDraft,
  parseEditorDraftKey,
  sameEditorContent,
  serializeEditorDraft,
  stableStringify,
} from "./editor-drafts.mjs";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 12, 13, 0, 0);

const doc = { v: 2, style: { accentColor: "#e30613", fontFamily: "system" }, blocks: [{ id: "b1", type: "text", text: "Hallo" }] };
const vorlage = { name: "Black Week", description: "Rabatt-Mail", doc };
const rundmail = { subject: "Black Week: 25 %", preheader: "Nur bis Sonntag", language: "de", doc };

test("editorDraftKey: one key per object, „new“ without an id", () => {
  assert.equal(editorDraftKey("vorlage", 12), "mo:draft:vorlage:12");
  assert.equal(editorDraftKey("rundmail", 7), "mo:draft:rundmail:7");
  assert.equal(editorDraftKey("vorlage", null), "mo:draft:vorlage:new");
  assert.equal(editorDraftKey("vorlage", undefined), "mo:draft:vorlage:new");
  for (const bad of [0, -3, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 2]) {
    assert.equal(editorDraftKey("vorlage", bad), "mo:draft:vorlage:new", String(bad));
  }
  assert.ok(editorDraftKey("vorlage", 1).startsWith(EDITOR_DRAFT_PREFIX));
  assert.throws(() => editorDraftKey(/** @type {any} */ ("kampagne"), 1), TypeError);
  assert.throws(() => editorDraftKey(/** @type {any} */ ("toString"), 1), TypeError, "no prototype keys");
});

test("parseEditorDraftKey: round trip, other strings → null", () => {
  assert.deepEqual(parseEditorDraftKey(editorDraftKey("vorlage", 12)), { kind: "vorlage", id: 12 });
  assert.deepEqual(parseEditorDraftKey(editorDraftKey("rundmail", 7)), { kind: "rundmail", id: 7 });
  assert.deepEqual(parseEditorDraftKey("mo:draft:vorlage:new"), { kind: "vorlage", id: null });
  assert.deepEqual(parseEditorDraftKey("mo:draft:kampagne:3"), { kind: "kampagne", id: 3 }, "a newer kind is still a draft key");
  for (const bad of ["mo:draft:vorlage:0", "mo:draft:vorlage:01", "mo:draft:vorlage:", "mo:draft:Vorlage:1", "mo:draft:vorlage:1:x", "ms-campaign-test-inbox", "", null, 12]) {
    assert.equal(parseEditorDraftKey(bad), null, String(bad));
  }
});

test("stableStringify: key order never matters, JSON semantics otherwise", () => {
  assert.equal(stableStringify({ b: 1, a: { d: [3, { y: 1, x: 2 }], c: "é" } }), '{"a":{"c":"é","d":[3,{"x":2,"y":1}]},"b":1}');
  assert.equal(stableStringify({ a: 1, b: 2 }), stableStringify({ b: 2, a: 1 }));
  assert.notEqual(stableStringify([1, 2]), stableStringify([2, 1]), "arrays keep their order");
  assert.equal(stableStringify({ a: undefined, b: () => 1, c: null }), '{"c":null}');
  assert.equal(stableStringify([undefined, Number.NaN, Infinity]), "[null,null,null]");
  assert.equal(stableStringify(new Date(NOW)), JSON.stringify(new Date(NOW)));
  assert.equal(stableStringify(undefined), undefined);
  assert.equal(stableStringify('a"b\n'), JSON.stringify('a"b\n'));
  const value = { text: "Zeile 1\nZeile 2 — „Zitat“", n: -0.5, t: true, list: [{ q: 1 }] };
  assert.deepEqual(JSON.parse(/** @type {string} */ (stableStringify(value))), value, "valid JSON");
  const cyclic = /** @type {Record<string, unknown>} */ ({ a: 1 });
  cyclic.self = cyclic;
  assert.throws(() => stableStringify(cyclic), TypeError);
  assert.throws(() => stableStringify({ n: 1n }), TypeError);
  const shared = { x: 1 };
  assert.equal(stableStringify({ a: shared, b: shared }), '{"a":{"x":1},"b":{"x":1}}', "a value used twice is no cycle");
});

test("sameEditorContent: stable comparison", () => {
  assert.equal(sameEditorContent(vorlage, { doc: { blocks: doc.blocks, style: doc.style, v: 2 }, description: "Rabatt-Mail", name: "Black Week" }), true);
  assert.equal(sameEditorContent(vorlage, { ...vorlage, name: "Black Week " }), false);
  assert.equal(sameEditorContent(vorlage, { ...vorlage, doc: { ...doc, blocks: [] } }), false);
  assert.equal(sameEditorContent(null, null), true);
  assert.equal(sameEditorContent(null, undefined), false);
  const cyclic = /** @type {Record<string, unknown>} */ ({});
  cyclic.self = cyclic;
  assert.equal(sameEditorContent(cyclic, { self: {} }), false, "not serialisable → not the same");
});

test("editorDraftContent: exactly the fields of the kind, else null", () => {
  assert.deepEqual(editorDraftContent("vorlage", { ...vorlage, extra: 1 }), vorlage, "extra fields dropped");
  assert.deepEqual(editorDraftContent("rundmail", rundmail), rundmail);
  assert.equal(editorDraftContent("vorlage", { ...vorlage, name: 3 }), null);
  assert.equal(editorDraftContent("vorlage", { name: "x", description: "y" }), null, "doc missing");
  assert.equal(editorDraftContent("vorlage", { ...vorlage, doc: [] }), null, "doc must be an object");
  assert.equal(editorDraftContent("vorlage", { ...vorlage, doc: null }), null);
  assert.equal(editorDraftContent("rundmail", { ...rundmail, language: "fr" }), null);
  assert.equal(editorDraftContent("rundmail", vorlage), null, "another kind's content");
  assert.equal(editorDraftContent("vorlage", "x"), null);
  assert.equal(editorDraftContent(/** @type {any} */ ("kampagne"), vorlage), null);
});

test("serializeEditorDraft → parseEditorDraft: round trip for both kinds", () => {
  const raw = serializeEditorDraft({ content: vorlage, base: 3, savedAt: NOW });
  assert.ok(raw);
  assert.ok(raw.startsWith(`{"v":1,"savedAt":${NOW},"base":3,"content":{`), "fixed head");
  assert.deepEqual(parseEditorDraft(raw, "vorlage"), { savedAt: NOW, base: 3, content: vorlage });
  const r2 = serializeEditorDraft({ content: rundmail, base: 12, savedAt: NOW + 0.4 });
  assert.deepEqual(parseEditorDraft(r2, "rundmail"), { savedAt: NOW, base: 12, content: rundmail }, "savedAt rounded");
  const r3 = serializeEditorDraft({ content: vorlage, base: null, savedAt: NOW });
  assert.equal(parseEditorDraft(r3, "vorlage")?.base, null, "a new template has no base");
  assert.equal(serializeEditorDraft({ content: vorlage, base: 3, savedAt: NOW }), serializeEditorDraft({ content: { doc, description: "Rabatt-Mail", name: "Black Week" }, base: 3, savedAt: NOW }), "stable");
});

test("serializeEditorDraft: not a draft or too large → null (skipped)", () => {
  assert.equal(serializeEditorDraft(/** @type {any} */ (null)), null);
  assert.equal(serializeEditorDraft({ content: [], base: 1, savedAt: NOW }), null);
  assert.equal(serializeEditorDraft({ content: vorlage, base: /** @type {any} */ ({}), savedAt: NOW }), null);
  assert.equal(serializeEditorDraft({ content: vorlage, base: 1, savedAt: Number.NaN }), null);
  assert.equal(serializeEditorDraft({ content: vorlage, base: 1, savedAt: 0 }), null);
  const cyclic = /** @type {Record<string, unknown>} */ ({ name: "x" });
  cyclic.doc = cyclic;
  assert.equal(serializeEditorDraft({ content: cyclic, base: 1, savedAt: NOW }), null);
  const raw = /** @type {string} */ (serializeEditorDraft({ content: vorlage, base: 1, savedAt: NOW }));
  assert.equal(serializeEditorDraft({ content: vorlage, base: 1, savedAt: NOW }, raw.length), raw, "exactly at the limit");
  assert.equal(serializeEditorDraft({ content: vorlage, base: 1, savedAt: NOW }, raw.length - 1), null, "one over");
  const big = { ...vorlage, description: "x".repeat(EDITOR_DRAFT_MAX_CHARS) };
  assert.equal(serializeEditorDraft({ content: big, base: 1, savedAt: NOW }), null, "~1.5 MB guard");
});

test("parseEditorDraft: anything broken → null", () => {
  const ok = /** @type {string} */ (serializeEditorDraft({ content: vorlage, base: 3, savedAt: NOW }));
  const cases = [
    null,
    undefined,
    42,
    "",
    "{",
    "null",
    "[]",
    '"text"',
    ok.slice(0, -1),
    ok.replace('"v":1', '"v":2'),
    JSON.stringify({ v: 1, base: 3, content: vorlage }),
    JSON.stringify({ v: 1, savedAt: -5, base: 3, content: vorlage }),
    JSON.stringify({ v: 1, savedAt: 1.5, base: 3, content: vorlage }),
    JSON.stringify({ v: 1, savedAt: "1731420000000", base: 3, content: vorlage }),
    JSON.stringify({ v: 1, savedAt: NOW, base: [3], content: vorlage }),
    JSON.stringify({ v: 1, savedAt: NOW, base: 3, content: { ...vorlage, doc: "{}" } }),
    JSON.stringify({ v: 1, savedAt: NOW, base: 3 }),
  ];
  for (const raw of cases) assert.equal(parseEditorDraft(raw, "vorlage"), null, String(raw).slice(0, 60));
  assert.equal(parseEditorDraft(ok, "rundmail"), null, "a template draft is no Rundmail draft");
  assert.equal(parseEditorDraft(ok, /** @type {any} */ ("kampagne")), null);
  assert.equal(parseEditorDraft(`${ok}${" ".repeat(EDITOR_DRAFT_MAX_CHARS)}`, "vorlage"), null, "longer than any draft we write");
  // the base key missing is a broken draft too (undefined is not a base)
  assert.equal(parseEditorDraft(JSON.stringify({ v: 1, savedAt: NOW, content: vorlage }), "vorlage"), null);
});

test("editorDraftSavedAt: from the head only", () => {
  const raw = serializeEditorDraft({ content: rundmail, base: 5, savedAt: NOW });
  assert.equal(editorDraftSavedAt(raw), NOW);
  assert.equal(editorDraftSavedAt(`${raw}garbage`), NOW, "the body is not read");
  for (const bad of [null, undefined, 5, "", "{}", '{"savedAt":1,"v":1,"base":1}', '{"v":1,"savedAt":0,"base":1}', '{"v":2,"savedAt":5,"base":1}']) {
    assert.equal(editorDraftSavedAt(bad), null, String(bad));
  }
});

test("editorDraftRestore: auto on the same base, offer after a newer save, none otherwise", () => {
  const draft = { savedAt: NOW, base: 3, content: { ...vorlage, name: "Black Week 2026" } };
  assert.equal(editorDraftRestore(draft, vorlage, 3), "auto");
  assert.equal(editorDraftRestore(draft, vorlage, 4), "offer", "saved after the draft was made");
  assert.equal(editorDraftRestore(draft, vorlage, null), "offer");
  assert.equal(editorDraftRestore({ ...draft, base: "3" }, vorlage, 3), "offer", "bases compare strictly");
  assert.equal(editorDraftRestore({ ...draft, content: vorlage }, vorlage, 3), "none", "equal to the saved state");
  assert.equal(
    editorDraftRestore({ ...draft, content: { doc, description: "Rabatt-Mail", name: "Black Week" } }, vorlage, 4),
    "none",
    "key order is no change — even after a newer save"
  );
  assert.equal(editorDraftRestore(null, vorlage, 3), "none");
  assert.equal(editorDraftRestore(undefined, vorlage, 3), "none");
  assert.equal(editorDraftRestore(draft, null, 3), "none", "nothing saved to compare with");
  assert.equal(editorDraftRestore({ base: 3, content: null }, vorlage, 3), "none");
  assert.equal(editorDraftRestore({ base: null, content: vorlage }, { ...vorlage, name: "" }, null), "auto", "a never saved object");
});

/** @param {number} at @param {number} [base] */
const stored = (at, base = 1) => serializeEditorDraft({ content: vorlage, base, savedAt: at });

test("editorDraftsToPrune: broken, older than 30 days, beyond the newest 20", () => {
  const entries = [
    { key: "mo:draft:vorlage:1", raw: stored(NOW - DAY) },
    { key: "mo:draft:vorlage:2", raw: stored(NOW - EDITOR_DRAFT_MAX_AGE_MS - 1) },
    { key: "mo:draft:vorlage:3", raw: stored(NOW - EDITOR_DRAFT_MAX_AGE_MS) },
    { key: "mo:draft:rundmail:4", raw: "kaputt" },
    { key: "mo:draft:rundmail:5", raw: null },
    { key: "mo:draft:", raw: stored(NOW) },
    { key: "ms-campaign-test-inbox", raw: "du@motionsports.de" },
    { key: "mo:draft:kampagne:6", raw: stored(NOW) },
  ];
  assert.deepEqual(editorDraftsToPrune(entries, NOW).sort(), ["mo:draft:", "mo:draft:rundmail:4", "mo:draft:rundmail:5", "mo:draft:vorlage:2"]);
  assert.deepEqual(editorDraftsToPrune([], NOW), []);
  assert.deepEqual(editorDraftsToPrune(/** @type {any} */ (null), NOW), []);
});

test("editorDraftsToPrune: keeps the newest MAX_COUNT, never the one being written", () => {
  const entries = Array.from({ length: EDITOR_DRAFT_MAX_COUNT + 3 }, (_, i) => ({ key: `mo:draft:vorlage:${i + 1}`, raw: stored(NOW - i * 60_000) }));
  assert.deepEqual(editorDraftsToPrune(entries, NOW), ["mo:draft:vorlage:21", "mo:draft:vorlage:22", "mo:draft:vorlage:23"]);
  // the oldest is the one being written: it stays, the next oldest go
  assert.deepEqual(editorDraftsToPrune(entries, NOW, { keep: "mo:draft:vorlage:23" }), [
    "mo:draft:vorlage:20",
    "mo:draft:vorlage:21",
    "mo:draft:vorlage:22",
  ]);
  // even when it looks broken or old (it is written right now)
  assert.deepEqual(editorDraftsToPrune([{ key: "mo:draft:vorlage:9", raw: "x" }], NOW, { keep: "mo:draft:vorlage:9" }), []);
  assert.deepEqual(editorDraftsToPrune(entries.slice(0, 3), NOW, { maxCount: 1 }), ["mo:draft:vorlage:2", "mo:draft:vorlage:3"]);
  assert.deepEqual(editorDraftsToPrune(entries.slice(0, 2), NOW, { maxAgeMs: 30_000 }), ["mo:draft:vorlage:2"]);
});

test("listEditorDrafts: one kind, newest first, broken ones left out", () => {
  const entries = [
    { key: "mo:draft:vorlage:3", raw: stored(NOW - 2 * DAY) },
    { key: "mo:draft:vorlage:8", raw: stored(NOW - DAY) },
    { key: "mo:draft:vorlage:new", raw: stored(NOW - 3 * DAY) },
    { key: "mo:draft:vorlage:9", raw: "kaputt" },
    { key: "mo:draft:rundmail:3", raw: stored(NOW) },
    { key: "other", raw: stored(NOW) },
  ];
  assert.deepEqual(listEditorDrafts(entries, "vorlage"), [
    { key: "mo:draft:vorlage:8", id: 8, savedAt: NOW - DAY },
    { key: "mo:draft:vorlage:3", id: 3, savedAt: NOW - 2 * DAY },
    { key: "mo:draft:vorlage:new", id: null, savedAt: NOW - 3 * DAY },
  ]);
  assert.deepEqual(listEditorDrafts(entries, "rundmail"), [{ key: "mo:draft:rundmail:3", id: 3, savedAt: NOW }]);
  assert.deepEqual(listEditorDrafts(/** @type {any} */ (undefined), "vorlage"), []);
});
