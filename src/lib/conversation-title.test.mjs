import { test } from "node:test";
import assert from "node:assert/strict";
import {
  deriveConversationTitle,
  sanitizeTitleInput,
  MAX_TITLE_LENGTH,
  FALLBACK_TITLE,
} from "./conversation-title.mjs";

test("deriveConversationTitle uses the first user message, collapsed + trimmed", () => {
  assert.equal(
    deriveConversationTitle("  Welche   Laufschuhe\n passen zu mir? "),
    "Welche Laufschuhe passen zu mir?"
  );
});

test("deriveConversationTitle falls back when there is no usable text", () => {
  assert.equal(deriveConversationTitle(""), FALLBACK_TITLE);
  assert.equal(deriveConversationTitle("   \n  "), FALLBACK_TITLE);
  assert.equal(deriveConversationTitle(null), FALLBACK_TITLE);
  assert.equal(deriveConversationTitle(undefined), FALLBACK_TITLE);
});

test("deriveConversationTitle honours a custom fallback label", () => {
  assert.equal(deriveConversationTitle("", "Neues Gespräch"), "Neues Gespräch");
});

test("deriveConversationTitle bounds length and adds an ellipsis", () => {
  const long = "a".repeat(200);
  const title = deriveConversationTitle(long);
  assert.ok(title.length <= MAX_TITLE_LENGTH, "within max length");
  assert.ok(title.endsWith("…"), "ends with ellipsis");
});

test("deriveConversationTitle prefers a word boundary when truncating", () => {
  const sentence =
    "Ich suche eine wirklich robuste Hantelbank fuer mein neues Heimstudio unten im Keller bitte sehr";
  assert.ok(sentence.length > MAX_TITLE_LENGTH, "fixture longer than the limit");
  const title = deriveConversationTitle(sentence);
  assert.ok(title.length <= MAX_TITLE_LENGTH);
  assert.ok(title.endsWith("…"));
  // We broke on a space, so the char before the ellipsis is a full word, not a
  // mid-word cut, and there's no double space.
  assert.ok(!title.includes("  "));
  assert.ok(sentence.startsWith(title.slice(0, -1)), "prefix of the original");
});

test("deriveConversationTitle leaves short messages untouched", () => {
  assert.equal(deriveConversationTitle("Hallo"), "Hallo");
});

test("sanitizeTitleInput rejects non-strings and blanks", () => {
  assert.deepEqual(sanitizeTitleInput(42), { ok: false, code: "invalid" });
  assert.deepEqual(sanitizeTitleInput(null), { ok: false, code: "invalid" });
  assert.deepEqual(sanitizeTitleInput(""), { ok: false, code: "empty" });
  assert.deepEqual(sanitizeTitleInput("   "), { ok: false, code: "empty" });
});

test("sanitizeTitleInput trims, collapses whitespace, and bounds length", () => {
  assert.deepEqual(sanitizeTitleInput("  Mein   Trainingsplan \n"), {
    ok: true,
    title: "Mein Trainingsplan",
  });
  const long = sanitizeTitleInput("x".repeat(500));
  assert.ok(long.ok);
  assert.ok(long.title.length <= MAX_TITLE_LENGTH);
});
