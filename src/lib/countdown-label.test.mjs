import { test } from "node:test";
import assert from "node:assert/strict";
import { COUNTDOWN_LABEL_CHARS, COUNTDOWN_LABEL_MAX, countdownLabelDropped, countdownLabelText } from "./countdown-label.mjs";
import { LABEL_CAP_HEIGHT, LABEL_GLYPHS, LABEL_SPACING } from "./generated/countdown-sprite.mjs";

test("the alphabet: A–Z, Ä Ö Ü, 0–9, the space and . , ! ? - : % & / ' « » „ “ — each a glyph of the sprite", () => {
  assert.equal(COUNTDOWN_LABEL_CHARS.join(""), "ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÜ0123456789 .,!?-:%&/'«»„“");
  assert.equal(COUNTDOWN_LABEL_MAX, 32);
  for (const ch of COUNTDOWN_LABEL_CHARS) {
    const g = LABEL_GLYPHS[ch];
    assert.ok(g && g.advance > 0, `advance of „${ch}“`);
    if (ch === " ") {
      assert.ok(!g.png, "the space has no ink");
      continue;
    }
    assert.ok(g.png && g.width > 0 && g.height > 0, `glyph „${ch}“`);
    assert.ok(Number.isInteger(g.x) && Number.isInteger(g.y), `offsets of „${ch}“`);
  }
  assert.deepEqual(Object.keys(LABEL_GLYPHS).sort(), [...COUNTDOWN_LABEL_CHARS].sort(), "no glyph without a character");
  // the heading's type: letters sit on the cap height, umlauts above it, the low quote below
  assert.equal(LABEL_GLYPHS.H.y, 0);
  assert.equal(LABEL_GLYPHS.H.height, LABEL_CAP_HEIGHT);
  assert.ok(LABEL_GLYPHS["Ä"].y < 0 && LABEL_GLYPHS["„"].y > LABEL_CAP_HEIGHT / 2);
  assert.ok(LABEL_GLYPHS.W.advance > LABEL_GLYPHS.I.advance);
  assert.equal(LABEL_SPACING, 2, "1 px letter spacing at 2×, like the heading");
});

test("countdownLabelText: the canonical spelling — capitals, look-alikes mapped, the rest dropped, at most 32", () => {
  assert.equal(countdownLabelText("Nur noch kurz!"), "NUR NOCH KURZ!");
  assert.equal(countdownLabelText("Große Schnäppchen-Woche"), "GROSSE SCHNÄPPCHEN-WOCHE", "ß becomes SS, umlauts stay");
  assert.equal(countdownLabelText("Café – Crème brûlée"), "CAFE - CREME BRULEE", "accents become their base letter, dashes a hyphen");
  assert.equal(countdownLabelText("It’s “now” — ‚go‘"), "IT'S “NOW“ - 'GO'");
  assert.equal(countdownLabelText("„Black Week“ «jetzt»"), "„BLACK WEEK“ «JETZT»");
  assert.equal(countdownLabelText("50 € + 10 % 😀 #1 {{vorname}}"), "50 10 % 1 VORNAME", "€ + 😀 # { } dropped, spaces collapsed");
  assert.equal(countdownLabelText("  a\t\n  b  "), "A B");
  assert.equal(countdownLabelText("Ärger"), "ÄRGER", "a combining umlaut is composed first");
  assert.equal(countdownLabelText("x".repeat(40)), "X".repeat(32));
  assert.equal(countdownLabelText("straße".repeat(6)).length, 32, "cut after ß became SS");
  assert.equal(countdownLabelText("€€€"), "");
  assert.equal(countdownLabelText(null), "");
  assert.equal(countdownLabelText(42), "");
  // idempotent: the canonical label is its own canonical form
  for (const s of ["Nur noch kurz!", "Café „Ö“ 50 %", "It’s — now"]) assert.equal(countdownLabelText(countdownLabelText(s)), countdownLabelText(s));
});

test("countdownLabelDropped: what the picture cannot draw, once each and as typed", () => {
  assert.deepEqual(countdownLabelDropped("50 € + 10 € 😀"), ["€", "+", "😀"]);
  assert.deepEqual(countdownLabelDropped("Schnäppchen „Große“ Woche – 50 % & mehr É"), []);
  assert.deepEqual(countdownLabelDropped("{{vorname}}"), ["{", "}"]);
  assert.deepEqual(countdownLabelDropped("Ø"), ["Ø"], "a letter without a base letter of the alphabet");
  assert.deepEqual(countdownLabelDropped(undefined), []);
});
