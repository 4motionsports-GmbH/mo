import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DESIGNER_FAILED_MESSAGE,
  DESIGNER_HISTORY_CHARS,
  DESIGNER_INCOMPLETE_MESSAGE,
  DESIGNER_UNDONE_MARK,
  DESIGNER_UNDO_LIMIT,
  designerCanSend,
  designerHistory,
  designerNotesText,
  designerRunLine,
  docHistoryReducer,
  elapsedLabel,
  interpretDesignerEvent,
  lastUndoTag,
  parseDesignerRun,
  runDurationLabel,
  sameDoc,
  undoDesignerTurn,
} from "./mail-designer-client.mjs";
import { normalizeMailTemplateDoc } from "./mail-template-doc.mjs";
import { eur } from "./admin-format.mjs";

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

test("undo in the conversation: the answer is marked, a notice names the instruction, the history says so", () => {
  const turns = [
    user(1, "Black-Week-Mail bitte", ["screenshot.png"]),
    ai(2, "Banner oben, Countdown bis Sonntag."),
    user(3, "Mach den Button gelb und direkt unter das Bild"),
    ai(4, "Button gelb, direkt unter dem Banner.", { subject: "Black Week" }),
  ];
  const once = undoDesignerTurn(turns, 4, 5);
  assert.equal(once.length, 5);
  assert.equal(once[3].role === "assistant" && once[3].undone, true);
  assert.equal(once[1].role === "assistant" && once[1].undone, undefined); // only that answer
  assert.deepEqual(once[4], {
    id: 5,
    role: "notice",
    undo: true,
    text: "Rückgängig gemacht: „Mach den Button gelb und direkt unter das Bild“ — die Mail ist wieder wie davor.",
  });
  assert.equal(turns[3].undone, undefined); // the input stays as it was
  // the history: the undone answer goes with the mark first (so it survives cutting), the notice stays out
  const h = designerHistory(once);
  assert.equal(h.length, 4);
  assert.deepEqual(h[3], {
    role: "assistant",
    text: `${DESIGNER_UNDONE_MARK}\nButton gelb, direkt unter dem Banner.\nBetreff-Vorschlag: „Black Week“`,
  });
  assert.equal(h[1].text, "Banner oben, Countdown bis Sonntag.");
  const long = designerHistory(undoDesignerTurn([user(1, "x"), ai(2, "y".repeat(DESIGNER_HISTORY_CHARS * 2))], 2, 3));
  assert.ok(long[1].text.startsWith(DESIGNER_UNDONE_MARK));
  // a second „Rückgängig“ takes back the answer before: attachments-only instruction
  const both = undoDesignerTurn(undoDesignerTurn([user(1, "", ["mail.png"]), ai(2, "Nachgebaut.")], 2, 3), 2, 4);
  assert.equal(both.length, 3); // already undone: unchanged
  assert.equal(both[2].text, "Rückgängig gemacht: die Gestaltung nach den Anhängen — die Mail ist wieder wie davor.");
  // nothing to mark: the answer is gone („Neues Gespräch“) or is no answer
  assert.equal(undoDesignerTurn(turns, 99, 5), turns);
  assert.equal(undoDesignerTurn(turns, 3, 5), turns);
  assert.equal(undoDesignerTurn(turns, null, 5), turns);
  // a long instruction is cut in the notice
  const longAsk = undoDesignerTurn([user(1, `Bitte ${"sehr ".repeat(40)}groß`), ai(2, "ok")], 2, 3);
  assert.match(longAsk[2].text, /^Rückgängig gemacht: „Bitte sehr .*…“ — die Mail ist wieder wie davor\.$/);
});

test("undo while a request runs: the notice does not split that request from its answer", () => {
  // „Rückgängig“ of answer 2 while instruction 3 runs → notice 4, then answer 5 arrives
  let turns = [user(1, "Mach es blau"), ai(2, "Blau."), user(3, "Und die Schrift größer")];
  turns = [...undoDesignerTurn(turns, 2, 4), ai(5, "Schrift größer.")];
  assert.deepEqual(
    turns.map((t) => t.role),
    ["user", "assistant", "user", "notice", "assistant"]
  );
  const h = designerHistory(turns);
  assert.deepEqual(
    h.map((t) => t.text),
    ["Mach es blau", `${DESIGNER_UNDONE_MARK}\nBlau.`, "Und die Schrift größer", "Schrift größer."]
  );
  // an undo of answer 5 now finds its instruction across the notice
  const again = undoDesignerTurn(turns, 5, 6);
  assert.equal(again[5].text, "Rückgängig gemacht: „Und die Schrift größer“ — die Mail ist wieder wie davor.");
  // other notices still mean „no answer“ (a cancelled or failed request)
  assert.deepEqual(designerHistory([user(1, "x"), { id: 2, role: "notice", text: "Abgebrochen." }, ai(3, "y")]), []);
});

test("notes are plain text: Markdown links show their address, bold markers go, nothing else changes", () => {
  assert.equal(designerNotesText("Banner oben, Button gelb."), "Banner oben, Button gelb.");
  assert.equal(
    designerNotesText("Bild bitte hier neu hochladen: [Upload](https://evil.example/mo-login)"),
    "Bild bitte hier neu hochladen: Upload (https://evil.example/mo-login)"
  );
  assert.equal(designerNotesText("[https://motionsports.de/](https://motionsports.de/)"), "https://motionsports.de/");
  assert.equal(designerNotesText("**Wichtig:** Code fehlt. __Bitte__ ergänzen."), "Wichtig: Code fehlt. Bitte ergänzen.");
  // line breaks and lone stars stay (the panel keeps the lines)
  assert.equal(designerNotesText("Preis*\n- erster Punkt\n- zweiter ** Punkt"), "Preis*\n- erster Punkt\n- zweiter ** Punkt");
  assert.equal(designerNotesText(null), "");
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
  assert.deepEqual(interpretDesignerEvent({ type: "result", notes: "x" }), { kind: "error", message: DESIGNER_INCOMPLETE_MESSAGE, run: null });
  assert.deepEqual(interpretDesignerEvent({ type: "result", doc: [] }), { kind: "error", message: DESIGNER_INCOMPLETE_MESSAGE, run: null });
  assert.deepEqual(interpretDesignerEvent({ type: "error", message: "Das Kontingent ist erschöpft." }), {
    kind: "error",
    message: "Das Kontingent ist erschöpft.",
    run: null,
  });
  assert.deepEqual(interpretDesignerEvent({ type: "error" }), { kind: "error", message: DESIGNER_FAILED_MESSAGE, run: null });
});

const RUN = {
  model: "claude-opus-5-5",
  effort: "high",
  label: "Gründlich · Claude Opus 5.5 · Denktiefe Hoch",
  freedom: "ausgewogen",
  proactive: true,
  seconds: 101.6,
  costEur: 0.3812,
  fallbackFrom: null,
};

test("events: the run of a result or an error line — what ran, how long, what it cost", () => {
  const ev = interpretDesignerEvent({ type: "result", doc: { blocks: [] }, notes: "ok", run: RUN });
  assert.deepEqual(ev?.kind === "result" ? ev.run : null, { ...RUN, seconds: 102 });
  // a failed run carries its cost too; an incomplete result keeps its run
  const failed = interpretDesignerEvent({ type: "error", message: "Zeit abgelaufen.", run: { ...RUN, costEur: 1.2, seconds: 285 } });
  assert.deepEqual(failed, { kind: "error", message: "Zeit abgelaufen.", run: { ...RUN, costEur: 1.2, seconds: 285 } });
  const incomplete = interpretDesignerEvent({ type: "result", run: RUN });
  assert.equal(incomplete?.kind === "error" ? incomplete.run?.model : null, "claude-opus-5-5");
  // the model that actually ran after a fallback, with the one that was unavailable
  const fell = parseDesignerRun({ ...RUN, fallbackFrom: "  claude-fable-5-2 " });
  assert.equal(fell?.fallbackFrom, "claude-fable-5-2");
  assert.equal(fell?.model, "claude-opus-5-5");
});

test("events: a run is read leniently — no model or effort → no run; a broken duration or cost is left out", () => {
  assert.equal(parseDesignerRun(null), null);
  assert.equal(parseDesignerRun("run"), null);
  assert.equal(parseDesignerRun([RUN]), null);
  assert.equal(parseDesignerRun({ ...RUN, model: "" }), null);
  assert.equal(parseDesignerRun({ ...RUN, effort: 3 }), null);
  assert.deepEqual(parseDesignerRun({ model: "claude-fable-5-2", effort: "high" }), {
    model: "claude-fable-5-2",
    effort: "high",
    label: "Maximal · Claude Fable 5.2 · Denktiefe Hoch", // built when the line has none
    freedom: null,
    proactive: null,
    seconds: null,
    costEur: null,
    fallbackFrom: null,
  });
  const broken = parseDesignerRun({ ...RUN, seconds: -4, costEur: "0,38", proactive: "ja", label: "   " });
  assert.deepEqual(
    broken && [broken.seconds, broken.costEur, broken.proactive, broken.label],
    [null, null, null, "Gründlich · Claude Opus 5.5 · Denktiefe Hoch"]
  );
  assert.equal(parseDesignerRun({ ...RUN, costEur: Number.POSITIVE_INFINITY })?.costEur, null);
  assert.equal(parseDesignerRun({ ...RUN, costEur: 0 })?.costEur, 0);
  assert.equal(parseDesignerRun({ ...RUN, label: "x".repeat(400) })?.label.length, 160);
});

test("run line: label · m:ss min · ≈ cost — cost or duration left out when unknown", () => {
  const run = parseDesignerRun(RUN);
  assert.equal(designerRunLine(run), `Gründlich · Claude Opus 5.5 · Denktiefe Hoch · 1:42 min · ≈ ${eur(0.3812)}`);
  assert.equal(eur(0.3812), eur(0.38)); // two decimals
  assert.equal(designerRunLine(parseDesignerRun({ ...RUN, costEur: null })), "Gründlich · Claude Opus 5.5 · Denktiefe Hoch · 1:42 min");
  assert.equal(
    designerRunLine(parseDesignerRun({ model: "claude-opus-5-5", effort: "xhigh", costEur: 2.5 })),
    `Eigene Einstellung · Claude Opus 5.5 · Denktiefe Sehr hoch · ≈ ${eur(2.5)}`
  );
  assert.equal(designerRunLine(null), "");
  assert.equal(designerRunLine(undefined), "");
});

test("run line: the pictures generate_image made — before the cost (it includes them), left out when none", () => {
  const run = parseDesignerRun({ ...RUN, pictures: 2, costEur: 0.74 });
  assert.equal(run?.pictures, 2);
  assert.equal(designerRunLine(run), `Gründlich · Claude Opus 5.5 · Denktiefe Hoch · 1:42 min · 2 KI-Bilder · ≈ ${eur(0.74)}`);
  assert.equal(designerRunLine(parseDesignerRun({ ...RUN, pictures: 1 })), `Gründlich · Claude Opus 5.5 · Denktiefe Hoch · 1:42 min · 1 KI-Bild · ≈ ${eur(0.3812)}`);
  // none, zero or junk: no key, no part
  for (const pictures of [undefined, 0, -1, "2", Number.NaN, 0.4]) {
    const r = parseDesignerRun({ ...RUN, pictures });
    assert.equal(r && "pictures" in r, false, String(pictures));
    assert.ok(!designerRunLine(r).includes("KI-Bild"));
  }
  assert.equal(parseDesignerRun({ ...RUN, pictures: 2.7 })?.pictures, 2);
});

test("a reply's run stays in the panel: never in the history sent to the AI, kept by „Rückgängig“", () => {
  const run = parseDesignerRun(RUN);
  const turns = [user(1, "Mach es blau"), ai(2, "Blau.", { run }), user(3, "Und größer"), { id: 4, role: "error", text: "Zeit abgelaufen.", run }];
  assert.deepEqual(designerHistory(turns), [
    { role: "user", text: "Mach es blau" },
    { role: "assistant", text: "Blau." },
  ]);
  const undone = undoDesignerTurn(turns, 2, 5);
  assert.deepEqual(undone[1].role === "assistant" ? [undone[1].undone, undone[1].run] : null, [true, run]);
});

test("run duration as m:ss", () => {
  assert.equal(runDurationLabel(0), "0:00");
  assert.equal(runDurationLabel(5), "0:05");
  assert.equal(runDurationLabel(59.6), "1:00");
  assert.equal(runDurationLabel(102), "1:42");
  assert.equal(runDurationLabel(285), "4:45");
  assert.equal(runDurationLabel(605), "10:05");
  assert.equal(runDurationLabel(-3), "0:00");
  assert.equal(runDurationLabel("x"), "0:00");
});

test("undo: AI results and „Vorlage laden“ push a step, hand edits do not, undo pops one", () => {
  const d0 = normalizeMailTemplateDoc({ blocks: [{ type: "heading", text: "A", id: "h" }] });
  const d1 = normalizeMailTemplateDoc({ blocks: [{ type: "heading", text: "B", id: "h" }] });
  const d2 = normalizeMailTemplateDoc({ blocks: [{ type: "heading", text: "C", id: "h" }] });
  let s = { doc: d0, undo: [] };
  s = docHistoryReducer(s, { type: "replace", doc: d1 });
  assert.equal(s.doc, d1);
  assert.deepEqual(s.undo, [{ doc: d0, tag: null }]);
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
  assert.deepEqual(
    s.undo.map((step) => step.doc),
    [d0, edited]
  );
  s = docHistoryReducer(s, { type: "undo" });
  assert.equal(s.doc, edited);
  s = docHistoryReducer(s, { type: "undo" });
  assert.equal(s.doc, d0);
  assert.deepEqual(s.undo, []);
  const same = docHistoryReducer(s, { type: "undo" });
  assert.equal(same, s);
});

test("undo: a step carries the AI answer whose result it replaced; „Vorlage laden“ and garbage tags carry none", () => {
  const d = (text) => normalizeMailTemplateDoc({ blocks: [{ type: "heading", text, id: "h" }] });
  let s = { doc: d("A"), undo: [] };
  assert.equal(lastUndoTag(s), null);
  s = docHistoryReducer(s, { type: "replace", doc: d("B"), tag: 7 }); // AI answer 7
  s = docHistoryReducer(s, { type: "replace", doc: d("C") }); // „Vorlage laden“
  s = docHistoryReducer(s, { type: "replace", doc: d("D"), tag: 12 }); // AI answer 12
  // an AI result that changes nothing adds no step — „Rückgängig“ can never point at it
  s = docHistoryReducer(s, { type: "replace", doc: JSON.parse(JSON.stringify(s.doc)), tag: 15 });
  assert.deepEqual(
    s.undo.map((step) => step.tag),
    [7, null, 12]
  );
  assert.equal(lastUndoTag(s), 12);
  s = docHistoryReducer(s, { type: "undo" });
  assert.equal(s.doc.blocks[0].text, "C");
  assert.equal(lastUndoTag(s), null);
  s = docHistoryReducer(s, { type: "undo" });
  assert.equal(lastUndoTag(s), 7);
  // @ts-expect-error a tag is a number or nothing
  s = docHistoryReducer(s, { type: "replace", doc: d("E"), tag: "7" });
  assert.equal(lastUndoTag(s), null);
  assert.equal(lastUndoTag(null), null);
  assert.equal(lastUndoTag({ undo: [{ tag: "x" }] }), null);
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
  assert.equal(s.undo[0].doc.blocks[0].text, "v4"); // the oldest ones were dropped
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
