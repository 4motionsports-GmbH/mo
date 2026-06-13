import { test } from "node:test";
import assert from "node:assert/strict";

import {
  MAX_TTS_CHARS,
  stripMarkdown,
  truncateAtSentenceBoundary,
  prepareTtsText,
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
