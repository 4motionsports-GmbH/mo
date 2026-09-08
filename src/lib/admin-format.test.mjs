import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FORMAT_EMPTY,
  compactNum,
  eur,
  eurFromCents,
  hours,
  money,
  num,
  pct,
  plural,
  ratio,
  relativeTime,
  truncate,
} from "./admin-format.mjs";

// ICU separates number and currency/unit with a non-breaking space; compare
// with plain spaces so the tests stay readable.
const plain = (text) => text.replace(/\u00a0/g, " ");

test("num renders de-DE thousands separators and caps fraction digits", () => {
  assert.equal(num(1234), "1.234");
  assert.equal(num(12.567, 1), "12,6");
  assert.equal(num("42"), "42");
  assert.equal(num(0), "0");
});

test("num falls back for absent or unparseable input", () => {
  assert.equal(num(null), FORMAT_EMPTY);
  assert.equal(num(undefined), FORMAT_EMPTY);
  assert.equal(num(Number.NaN), FORMAT_EMPTY);
  assert.equal(num("abc"), FORMAT_EMPTY);
  assert.equal(num("", 0, "n/a"), "n/a");
});

test("compactNum abbreviates large values", () => {
  assert.equal(plain(compactNum(842)), "842");
  assert.equal(plain(compactNum(1_250_000)), "1,3 Mio.");
  assert.equal(compactNum(null), FORMAT_EMPTY);
});

test("eur keeps the two-decimal floor and honours extra digits for AI costs", () => {
  assert.equal(plain(eur(12.5)), "12,50 €");
  assert.equal(plain(eur(12)), "12,00 €");
  assert.equal(plain(eur(0.0239, 4)), "0,0239 €");
  assert.equal(plain(eur(0.5, 4)), "0,50 €");
  assert.equal(plain(eur(1234.567)), "1.234,57 €");
  assert.equal(eur(null), FORMAT_EMPTY);
});

test("money handles foreign and invalid currency codes", () => {
  assert.equal(plain(money(9.99, "USD")), "9,99 $");
  assert.equal(plain(money(9.99, "CHF")), "9,99 CHF");
  assert.equal(plain(money(9.99, "NOPE")), "9,99 NOPE");
  assert.equal(plain(money("12", "EUR", 0)), "12 €");
});

test("eurFromCents divides integer cents", () => {
  assert.equal(plain(eurFromCents(449)), "4,49 €");
  assert.equal(plain(eurFromCents(112800)), "1.128,00 €");
  assert.equal(eurFromCents(null), FORMAT_EMPTY);
});

test("pct and ratio format percentages", () => {
  assert.equal(pct(12.34), "12,3 %");
  assert.equal(pct(12.34, 0), "12 %");
  assert.equal(pct(3.2, 1, { sign: true }), "+3,2 %");
  assert.equal(pct(-3.2, 1, { sign: true }), "-3,2 %");
  assert.equal(pct(0, 1, { sign: true }), "0 %");
  assert.equal(ratio(0.5), "50 %");
  assert.equal(ratio(0.1234, 2), "12,34 %");
  assert.equal(ratio(null), FORMAT_EMPTY);
});

test("hours switches to days from 48 hours", () => {
  assert.equal(hours(3.46), "3,5 Std.");
  assert.equal(hours(47.9), "47,9 Std.");
  assert.equal(hours(48), "2 Tage");
  assert.equal(hours(60), "2,5 Tage");
  assert.equal(hours(null), FORMAT_EMPTY);
});

test("plural picks the German noun form", () => {
  assert.equal(plural(1, "Kontakt", "Kontakte"), "1 Kontakt");
  assert.equal(plural(0, "Kontakt", "Kontakte"), "0 Kontakte");
  assert.equal(plural(1200, "Gespräch", "Gespräche"), "1.200 Gespräche");
  assert.equal(plural(null, "Kontakt", "Kontakte"), "— Kontakte");
});

test("relativeTime describes past instants in German", () => {
  const now = Date.parse("2026-09-08T12:00:00Z");
  const ago = (ms) => new Date(now - ms).toISOString();
  assert.equal(relativeTime(ago(10_000), now), "gerade eben");
  assert.equal(relativeTime(ago(5 * 60_000), now), "vor 5 Min.");
  assert.equal(relativeTime(ago(60 * 60_000), now), "vor 1 Std.");
  assert.equal(relativeTime(ago(23.8 * 3_600_000), now), "vor 1 Tag");
  assert.equal(relativeTime(ago(3 * 86_400_000), now), "vor 3 Tagen");
  assert.equal(relativeTime(ago(13 * 86_400_000), now), "vor 2 Wochen");
  assert.equal(relativeTime(ago(70 * 86_400_000), now), "vor 2 Monaten");
  assert.equal(relativeTime(ago(75 * 86_400_000), now), "vor 3 Monaten");
  assert.equal(relativeTime(ago(400 * 86_400_000), now), "vor 1 Jahr");
  assert.equal(relativeTime(ago(800 * 86_400_000), now), "vor 2 Jahren");
});

test("relativeTime handles future instants, Date input and bad input", () => {
  const now = new Date("2026-09-08T12:00:00Z");
  assert.equal(relativeTime(new Date(now.getTime() + 20_000), now), "gleich");
  assert.equal(relativeTime(new Date(now.getTime() + 15 * 60_000), now), "in 15 Min.");
  assert.equal(relativeTime(now.getTime() - 2 * 3_600_000, now), "vor 2 Std.");
  assert.equal(relativeTime(null, now), FORMAT_EMPTY);
  assert.equal(relativeTime("not a date", now), FORMAT_EMPTY);
  assert.equal(relativeTime("", now, "nie"), "nie");
});

test("truncate cuts with an ellipsis and trims trailing spaces", () => {
  assert.equal(truncate("kurz", 10), "kurz");
  assert.equal(truncate("Hallo Welt, wie geht es", 11), "Hallo Welt…");
  assert.equal(truncate("Hallo Welt", 6), "Hallo…");
  assert.equal(truncate(null), "");
  assert.equal(truncate("abc", 0), "…");
});
