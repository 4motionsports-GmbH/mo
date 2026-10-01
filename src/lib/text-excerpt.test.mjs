import { test } from "node:test";
import assert from "node:assert/strict";
import { plainExcerpt } from "./text-excerpt.mjs";

test("drops headings and bold-only title lines, strips markers", () => {
  const md = "**Aktuelles Verständnis**\n\nLaura trainiert **zu Hause** mit [Kurzhanteln](https://x).\n- Budget ca. 600 €\n## Offene Fragen\n1. Lieferzeit";
  assert.equal(plainExcerpt(md), "Laura trainiert zu Hause mit Kurzhanteln. Budget ca. 600 € Lieferzeit");
});

test("cuts at a word boundary and handles empty input", () => {
  assert.equal(plainExcerpt("eins zwei drei vier fünf", 12), "eins zwei …");
  assert.equal(plainExcerpt(null), null);
  assert.equal(plainExcerpt("# Nur Überschrift"), null);
});
