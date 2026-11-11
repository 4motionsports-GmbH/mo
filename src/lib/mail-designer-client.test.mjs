import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DESIGNER_FAILED_MESSAGE,
  DESIGNER_HISTORY_CHARS,
  DESIGNER_INCOMPLETE_MESSAGE,
  DESIGNER_UNDO_LIMIT,
  designerCanSend,
  designerHistory,
  docHistoryReducer,
  elapsedLabel,
  interpretDesignerEvent,
  sameDoc,
} from "./mail-designer-client.mjs";
import { normalizeMailTemplateDoc } from "./mail-template-doc.mjs";

const user = (id, text, attachments = []) => ({ id, role: "user", text, attachments });
const ai = (id, text, extra = {}) => ({ id, role: "assistant", text, subject: null, preheader: null, warnings: [], ...extra });
const err = (id, text) => ({ id, role: "error", text });

test("history: answered turns only, with attachment names and suggestions", () => {
  const turns = [
    user(1, "Black-Week-Mail bitte", ["screenshot.png", "foto.jpg"]),
    ai(2, "Ich habe das Banner oben gesetzt.", { subject: "Black Week: 25 % auf alles", preheader: "Nur bis Sonntag" }),
    user(3, "Mach es blau"),
    err(4, "Verbindung abgebrochen — bitte erneut versuchen."),
    user(5, "Mach es blau"),
    { id: 6, role: "notice", text: "Abgebrochen." },
    user(7, "Mach es dunkelblau"),
    ai(8, ""),
  ];
  assert.deepEqual(designerHistory(turns), [
    { role: "user", text: "Black-Week-Mail bitte\n[Anhänge: screenshot.png, foto.jpg]" },
    {
      role: "assistant",
      text: "Ich habe das Banner oben gesetzt.\nBetreff-Vorschlag: „Black Week: 25 % auf alles“\nVorschauzeile-Vorschlag: „Nur bis Sonntag“",
    },
    { role: "user", text: "Mach es dunkelblau" },
    { role: "assistant", text: "Erledigt." },
  ]);
});

test("history: the last 8 turns, always starting with the operator; a running turn is not part of it", () => {
  const turns = [];
  for (let i = 0; i < 6; i++) turns.push(user(i * 2, `Anweisung ${i}`), ai(i * 2 + 1, `Antwort ${i}`));
  turns.push(user(99, "läuft gerade"));
  const h = designerHistory(turns);
  assert.equal(h.length, 8);
  assert.equal(h[0].role, "user");
  assert.equal(h[0].text, "Anweisung 2");
  assert.equal(h[7].text, "Antwort 5");
  assert.equal(designerHistory(turns, 3).length, 2); // odd max → whole exchanges
  assert.deepEqual(designerHistory(turns, 0), []);
  assert.deepEqual(designerHistory([]), []);
  // @ts-expect-error garbage
  assert.deepEqual(designerHistory(null), []);
});

test("history: an attachments-only turn and long texts are bounded", () => {
  const h = designerHistory([user(1, "", ["mail.png"]), ai(2, "x".repeat(DESIGNER_HISTORY_CHARS + 50))]);
  assert.equal(h[0].text, "[Anhänge: mail.png]");
  assert.equal(h[1].text.length, DESIGNER_HISTORY_CHARS);
  assert.ok(h[1].text.endsWith("…"));
  assert.equal(designerHistory([user(1, "  "), ai(2, "ok")])[0].text, "(ohne Text)");
});

test("can send: 3 characters or an attachment", () => {
  assert.equal(designerCanSend("", 0), false);
  assert.equal(designerCanSend("  ab ", 0), false);
  assert.equal(designerCanSend("abc", 0), true);
  assert.equal(designerCanSend("", 1), true);
  assert.equal(designerCanSend(null, 0), false);
});

test("events: heartbeats and unknown lines are ignored, progress is one short line", () => {
  assert.equal(interpretDesignerEvent({ type: "progress", stage: "heartbeat", text: "…" }), null);
  assert.equal(interpretDesignerEvent({ type: "progress", stage: "tools", text: "   " }), null);
  assert.equal(interpretDesignerEvent({ type: "something" }), null);
  assert.equal(interpretDesignerEvent(null), null);
  assert.equal(interpretDesignerEvent([1]), null);
  assert.equal(interpretDesignerEvent("text"), null);
  assert.deepEqual(interpretDesignerEvent({ type: "progress", stage: "search", text: "Sucht\n  Produkte …" }), {
    kind: "progress",
    stage: "search",
    text: "Sucht Produkte …",
  });
  const long = interpretDesignerEvent({ type: "progress", text: "y".repeat(500) });
  assert.equal(long?.kind === "progress" ? long.text.length : 0, 160);
  assert.equal(long?.kind === "progress" ? long.stage : "x", "");
});

test("events: a result carries the normalised document, notes, suggestions and warnings", () => {
  const raw = {
    type: "result",
    doc: { blocks: [{ type: "heading", text: "Hallo" }, { type: "unknown" }] },
    notes: "  Banner oben, Button gelb.  ",
    subject: "  Black   Week ",
    preheader: "",
    warnings: ["Bild prüfen", 3, "", "  Code   prüfen "],
  };
  const ev = interpretDesignerEvent(raw);
  assert.equal(ev?.kind, "result");
  if (ev?.kind !== "result") return;
  assert.equal(ev.doc.v, 2);
  assert.deepEqual(
    ev.doc.blocks.map((b) => b.type),
    ["heading", "footer"]
  );
  assert.equal(ev.notes, "Banner oben, Button gelb.");
  assert.equal(ev.subject, "Black Week");
  assert.equal(ev.preheader, null);
  assert.deepEqual(ev.warnings, ["Bild prüfen", "Code prüfen"]);
  const bare = interpretDesignerEvent({ type: "result", doc: { blocks: [] } });
  assert.deepEqual(bare?.kind === "result" ? [bare.notes, bare.subject, bare.preheader, bare.warnings] : null, ["", null, null, []]);
  // subject/preheader are cut to the fields' 150 characters
  const longSubject = interpretDesignerEvent({ type: "result", doc: {}, subject: "s".repeat(200) });
  assert.equal(longSubject?.kind === "result" ? longSubject.subject?.length : 0, 150);
});

test("events: a result without a document is an error; an error keeps its message", () => {
  assert.deepEqual(interpretDesignerEvent({ type: "result", notes: "x" }), { kind: "error", message: DESIGNER_INCOMPLETE_MESSAGE });
  assert.deepEqual(interpretDesignerEvent({ type: "result", doc: [] }), { kind: "error", message: DESIGNER_INCOMPLETE_MESSAGE });
  assert.deepEqual(interpretDesignerEvent({ type: "error", message: "Das Kontingent ist erschöpft." }), {
    kind: "error",
    message: "Das Kontingent ist erschöpft.",
  });
  assert.deepEqual(interpretDesignerEvent({ type: "error" }), { kind: "error", message: DESIGNER_FAILED_MESSAGE });
});

test("undo: AI results and „Vorlage laden“ push a step, hand edits do not, undo pops one", () => {
  const d0 = normalizeMailTemplateDoc({ blocks: [{ type: "heading", text: "A", id: "h" }] });
  const d1 = normalizeMailTemplateDoc({ blocks: [{ type: "heading", text: "B", id: "h" }] });
  const d2 = normalizeMailTemplateDoc({ blocks: [{ type: "heading", text: "C", id: "h" }] });
  let s = { doc: d0, undo: [] };
  s = docHistoryReducer(s, { type: "replace", doc: d1 });
  assert.equal(s.doc, d1);
  assert.deepEqual(s.undo, [d0]);
  // a hand edit: no step
  const d1b = { ...d1, style: { ...d1.style, accentColor: "#ff0000" } };
  s = docHistoryReducer(s, { type: "set", doc: d1b });
  assert.equal(s.doc, d1b);
  assert.equal(s.undo.length, 1);
  // an updater works like useState's
  s = docHistoryReducer(s, { type: "set", doc: (prev) => ({ ...prev, style: { ...prev.style, textColor: "#222222" } }) });
  assert.equal(s.doc.style.textColor, "#222222");
  const edited = s.doc;
  s = docHistoryReducer(s, { type: "replace", doc: d2 });
  assert.deepEqual(s.undo, [d0, edited]);
  s = docHistoryReducer(s, { type: "undo" });
  assert.equal(s.doc, edited);
  s = docHistoryReducer(s, { type: "undo" });
  assert.equal(s.doc, d0);
  assert.deepEqual(s.undo, []);
  const same = docHistoryReducer(s, { type: "undo" });
  assert.equal(same, s);
});

test("undo: an unchanged result adds no step, at most 20 steps, reset clears, null start", () => {
  const d0 = normalizeMailTemplateDoc({ blocks: [{ type: "text", text: "x", id: "t" }] });
  let s = { doc: d0, undo: [] };
  const again = docHistoryReducer(s, { type: "replace", doc: JSON.parse(JSON.stringify(d0)) });
  assert.equal(again, s);
  for (let i = 0; i < DESIGNER_UNDO_LIMIT + 5; i++) {
    s = docHistoryReducer(s, { type: "replace", doc: normalizeMailTemplateDoc({ blocks: [{ type: "text", text: `v${i}`, id: "t" }] }) });
  }
  assert.equal(s.undo.length, DESIGNER_UNDO_LIMIT);
  assert.equal(s.undo[0].blocks[0].text, "v4"); // the oldest ones were dropped
  s = docHistoryReducer(s, { type: "reset", doc: d0 });
  assert.deepEqual(s, { doc: d0, undo: [] });
  // the template editor starts without a document: the first one is no step
  let n = { doc: null, undo: [] };
  n = docHistoryReducer(n, { type: "replace", doc: d0 });
  assert.deepEqual(n, { doc: d0, undo: [] });
  const unknown = docHistoryReducer(n, /** @type {any} */ ({ type: "nope" }));
  assert.equal(unknown, n);
  // setting the same object is a no-op
  assert.equal(docHistoryReducer(n, { type: "set", doc: d0 }), n);
});

test("sameDoc compares by value", () => {
  assert.equal(sameDoc({ a: 1 }, { a: 1 }), true);
  assert.equal(sameDoc({ a: 1 }, { a: 2 }), false);
  const cyclic = {};
  cyclic.self = cyclic;
  assert.equal(sameDoc(cyclic, {}), false);
});

test("elapsed time label", () => {
  assert.equal(elapsedLabel(0), "0 s");
  assert.equal(elapsedLabel(999), "0 s");
  assert.equal(elapsedLabel(42_300), "42 s");
  assert.equal(elapsedLabel(59_999), "59 s");
  assert.equal(elapsedLabel(60_000), "1:00 Min.");
  assert.equal(elapsedLabel(125_000), "2:05 Min.");
  assert.equal(elapsedLabel(-5), "0 s");
  assert.equal(elapsedLabel("x"), "0 s");
});
