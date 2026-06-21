import { test } from "node:test";
import assert from "node:assert/strict";

import {
  MAX_TTS_CHARS,
  TTS_CHUNK_MIN_CHARS,
  TTS_CHUNK_MAX_CHARS,
  stripMarkdown,
  truncateAtSentenceBoundary,
  prepareTtsText,
  splitIntoTtsChunks,
} from "./tts-text.mjs";

test("stripMarkdown removes emphasis markers but keeps the words", () => {
  assert.equal(stripMarkdown("Das **ATX Rack** ist *super* stabil."), "Das ATX Rack ist super stabil.");
  assert.equal(stripMarkdown("__fett__ und _kursiv_"), "fett und kursiv");
});

test("stripMarkdown never leaves a stray asterisk or backtick to be read aloud", () => {
  // Unbalanced / leftover markdown punctuation is the thing we must not speak.
  const out = stripMarkdown("Preis * 2 und `code und **kaputt");
  assert.ok(!out.includes("*"), `expected no asterisks, got: ${out}`);
  assert.ok(!out.includes("`"), `expected no backticks, got: ${out}`);
});

test("stripMarkdown unwraps links and inline code to their text", () => {
  assert.equal(stripMarkdown("Siehe [die Seite](https://x.de) dazu"), "Siehe die Seite dazu");
  assert.equal(stripMarkdown("Nutze `npm run build` dafür"), "Nutze npm run build dafür");
});

test("stripMarkdown strips headings, bullets and ordered list markers", () => {
  const md = "# Titel\n- erster Punkt\n- zweiter Punkt\n1. eins\n2. zwei";
  assert.equal(stripMarkdown(md), "Titel\nerster Punkt\nzweiter Punkt\neins\nzwei");
});

test("stripMarkdown returns empty string for non-string or markup-only input", () => {
  assert.equal(stripMarkdown(undefined), "");
  assert.equal(stripMarkdown(null), "");
  assert.equal(stripMarkdown("***"), "");
});

test("truncateAtSentenceBoundary leaves short text untouched", () => {
  const r = truncateAtSentenceBoundary("Kurzer Satz.", 2000);
  assert.equal(r.truncated, false);
  assert.equal(r.text, "Kurzer Satz.");
});

test("truncateAtSentenceBoundary cuts at the last sentence boundary within the cap", () => {
  // Three sentences; cap lands inside the third → keep the first two, whole.
  const text = "Satz eins ist hier. Satz zwei folgt jetzt. Satz drei wird abgeschnitten weil zu lang.";
  const cap = 45; // falls inside sentence three
  const r = truncateAtSentenceBoundary(text, cap);
  assert.equal(r.truncated, true);
  assert.equal(r.text, "Satz eins ist hier. Satz zwei folgt jetzt.");
  assert.ok(r.text.length <= cap);
  // Ends on a sentence terminator — natural audio ending.
  assert.match(r.text, /[.!?…]$/);
});

test("truncateAtSentenceBoundary falls back to a word boundary when no sentence fits", () => {
  // One long sentence, no early terminator → cut on whitespace, not mid-word.
  const text = "eins zwei drei vier fuenf sechs sieben acht neun zehn elf zwoelf";
  const cap = 20;
  const r = truncateAtSentenceBoundary(text, cap);
  assert.equal(r.truncated, true);
  assert.ok(r.text.length <= cap);
  assert.ok(!r.text.endsWith(" "));
  // No partial trailing word (every kept token is whole).
  assert.ok(text.startsWith(r.text));
});

test("prepareTtsText strips then caps, flagging truncation", () => {
  const long = "**Hallo.** " + "Wort ".repeat(800); // well over the cap after stripping
  const r = prepareTtsText(long, MAX_TTS_CHARS);
  assert.equal(r.empty, false);
  assert.equal(r.truncated, true);
  assert.ok(r.text.length <= MAX_TTS_CHARS);
  assert.ok(!r.text.includes("*"));
});

test("prepareTtsText reports empty for blank or markup-only bodies", () => {
  assert.deepEqual(prepareTtsText(""), { text: "", truncated: false, empty: true });
  assert.deepEqual(prepareTtsText("   "), { text: "", truncated: false, empty: true });
  assert.deepEqual(prepareTtsText("**__**"), { text: "", truncated: false, empty: true });
});

test("MAX_TTS_CHARS is the documented 2000-char cap", () => {
  assert.equal(MAX_TTS_CHARS, 2000);
});

// --- splitIntoTtsChunks (streaming TTS chunking) ---------------------------

test("splitIntoTtsChunks emits a complete sentence once a following char confirms it", () => {
  // Two full sentences, each over the min, with a trailing partial.
  const text =
    "Das ATX Power Rack ist sehr stabil und kippsicher. Es passt außerdem prima in einen normalen Keller. Außerdem";
  const { chunks, rest } = splitIntoTtsChunks(text);
  assert.deepEqual(chunks, [
    "Das ATX Power Rack ist sehr stabil und kippsicher.",
    "Es passt außerdem prima in einen normalen Keller.",
  ]);
  // The unterminated tail is held (untrimmed) for the next streamed delta.
  assert.equal(rest, " Außerdem");
});

test("splitIntoTtsChunks holds the final sentence until a following char arrives, flush drains it", () => {
  // A single sentence at the very end of the buffer is NOT emitted yet (it
  // might still be streaming — e.g. a decimal in progress); flush emits it.
  const text = "Das Rack ist hervorragend für dein Heimstudio geeignet.";
  const held = splitIntoTtsChunks(text);
  assert.deepEqual(held.chunks, []);
  assert.equal(held.rest, text);

  const flushed = splitIntoTtsChunks(text, { flush: true });
  assert.deepEqual(flushed.chunks, [text]);
  assert.equal(flushed.rest, "");
});

test("splitIntoTtsChunks coalesces fragments shorter than minChars into the next sentence", () => {
  const text = "Klar! Das ATX Power Rack ist sehr stabil und gut verarbeitet. Rest";
  const { chunks } = splitIntoTtsChunks(text);
  // "Klar!" alone is < minChars, so it rides with the following sentence.
  assert.deepEqual(chunks, [
    "Klar! Das ATX Power Rack ist sehr stabil und gut verarbeitet.",
  ]);
});

test("splitIntoTtsChunks does not split German abbreviations", () => {
  const text =
    "Wir führen Power Racks, Hanteln, Bänke usw. für dein Studio im Programm. Der zweite Satz ist hier lang genug dafür. Tail";
  const { chunks } = splitIntoTtsChunks(text);
  // "usw." must NOT end the sentence; the first chunk runs through to the real
  // terminator after "Programm".
  assert.equal(chunks.length, 2);
  assert.ok(
    chunks[0].startsWith("Wir führen") && chunks[0].endsWith("im Programm."),
    `unexpected first chunk: ${chunks[0]}`
  );
});

test("splitIntoTtsChunks keeps 'z. B.' and decimals intact", () => {
  const text =
    "Für zu Hause empfehle ich z. B. das ATX Rack mit 3.5 cm Profil und viel Reserve. Danach kommt der nächste vollständige Satz. X";
  const { chunks } = splitIntoTtsChunks(text);
  assert.equal(chunks.length, 2);
  assert.ok(chunks[0].includes("z. B."), `lost abbreviation: ${chunks[0]}`);
  assert.ok(chunks[0].includes("3.5 cm"), `split a decimal: ${chunks[0]}`);
});

test("splitIntoTtsChunks force-cuts an over-long run at a clause boundary for latency", () => {
  // No sentence terminator for a long stretch — must still cut so audio starts.
  const text =
    "Das ist ein sehr langer einleitender Satz ohne Punkt, der weiterläuft und weiterläuft und immer noch nicht endet, sondern einfach weiter Inhalt anhängt und anhängt bis er deutlich über die maximale Chunk-Länge hinausgeht";
  const { chunks } = splitIntoTtsChunks(text, { maxChars: 80 });
  assert.ok(chunks.length >= 2, `expected a soft cut, got ${chunks.length} chunk(s)`);
  for (const c of chunks) {
    assert.ok(c.length <= 80 + 40, `chunk too long: ${c.length}`);
  }
  // The cut should land on a clause boundary (comma), not mid-word.
  assert.ok(chunks[0].endsWith(","), `expected clause cut, got: ${chunks[0]}`);
});

test("splitIntoTtsChunks treats newlines (list/paragraph breaks) as boundaries", () => {
  const text =
    "Hier sind drei starke Optionen für dein Heimstudio:\nDas ATX Power Rack ist ein super Allrounder.\nNächster";
  const { chunks } = splitIntoTtsChunks(text);
  assert.deepEqual(chunks, [
    "Hier sind drei starke Optionen für dein Heimstudio:",
    "Das ATX Power Rack ist ein super Allrounder.",
  ]);
});

test("splitIntoTtsChunks works incrementally as a stream of deltas (queue simulation)", () => {
  const deltas = [
    "Das ATX Power Rack ",
    "ist sehr stabil und gut. ",
    "Es passt auch ",
    "wunderbar in einen normalen Keller. ",
    "Viel Spaß beim Training damit!",
  ];
  let buffer = "";
  const spoken = [];
  for (const d of deltas) {
    buffer += d;
    const { chunks, rest } = splitIntoTtsChunks(buffer);
    spoken.push(...chunks);
    buffer = rest;
  }
  // Drain the tail at stream end.
  const tail = splitIntoTtsChunks(buffer, { flush: true });
  spoken.push(...tail.chunks);

  assert.deepEqual(spoken, [
    "Das ATX Power Rack ist sehr stabil und gut.",
    "Es passt auch wunderbar in einen normalen Keller.",
    "Viel Spaß beim Training damit!",
  ]);
  // Every spoken chunk, rejoined, equals the full answer (modulo whitespace).
  assert.equal(
    spoken.join(" ").replace(/\s+/g, " ").trim(),
    deltas.join("").replace(/\s+/g, " ").trim()
  );
});

test("splitIntoTtsChunks handles empty / non-string input safely", () => {
  assert.deepEqual(splitIntoTtsChunks(""), { chunks: [], rest: "" });
  assert.deepEqual(splitIntoTtsChunks(undefined), { chunks: [], rest: "" });
  assert.deepEqual(splitIntoTtsChunks("   ", { flush: true }), { chunks: [], rest: "" });
});

test("splitIntoTtsChunks chunk-size defaults are the documented values", () => {
  assert.equal(TTS_CHUNK_MIN_CHARS, 40);
  assert.equal(TTS_CHUNK_MAX_CHARS, 220);
});
