// Unit tests for the Shopify rich-text → plain-text converter (node --test).

import { test } from "node:test";
import assert from "node:assert/strict";
import { richTextToPlainText, normalizeProductText } from "./shopify-richtext.mjs";

const RICH = JSON.stringify({
  type: "root",
  children: [
    {
      type: "list",
      listType: "unordered",
      children: [
        { type: "list-item", children: [{ type: "text", value: "isoliertes Training der Core Muskulatur" }] },
        { type: "list-item", children: [{ type: "text", value: "Gewichtsblock: 86,2 kg" }] },
        { type: "list-item", children: [{ type: "text", value: "Zertifizierung: ISO 9001" }] },
      ],
    },
  ],
});

test("rich-text list becomes readable plain text", () => {
  assert.equal(
    richTextToPlainText(RICH),
    "isoliertes Training der Core Muskulatur · Gewichtsblock: 86,2 kg · Zertifizierung: ISO 9001"
  );
});

test("paragraphs are flattened and whitespace collapsed", () => {
  const doc = JSON.stringify({
    type: "root",
    children: [
      { type: "paragraph", children: [{ type: "text", value: "Erste  Zeile" }] },
      { type: "paragraph", children: [{ type: "text", value: "Zweite Zeile" }] },
    ],
  });
  assert.equal(richTextToPlainText(doc), "Erste Zeile Zweite Zeile");
});

test("nested link nodes keep their text", () => {
  const doc = JSON.stringify({
    type: "root",
    children: [
      {
        type: "paragraph",
        children: [
          { type: "text", value: "Mehr auf " },
          { type: "link", url: "https://x.de", children: [{ type: "text", value: "motionsports.de" }] },
        ],
      },
    ],
  });
  assert.equal(richTextToPlainText(doc), "Mehr auf motionsports.de");
});

test("plain text passes through untouched", () => {
  const plain = "Das ATX Vorteilspaket ist robust und günstig.";
  assert.equal(richTextToPlainText(plain), plain);
  assert.equal(richTextToPlainText(""), "");
  assert.equal(richTextToPlainText("{nicht json"), "{nicht json");
  assert.equal(richTextToPlainText('{"type":"other"}'), '{"type":"other"}');
});

test("non-strings and broken JSON never throw", () => {
  assert.equal(richTextToPlainText(null), "");
  assert.equal(richTextToPlainText(42), "");
  assert.equal(richTextToPlainText('{"type":"root","children":'), '{"type":"root","children":');
});

test("a document that flattens to nothing keeps the original", () => {
  const empty = JSON.stringify({ type: "root", children: [] });
  assert.equal(richTextToPlainText(empty), empty);
});

test("normalizeProductText rewrites only when needed", () => {
  const plain = { name: "A", shortDescription: "Kurz und knapp." };
  assert.equal(normalizeProductText(plain), plain, "unchanged object keeps identity");
  const rich = { name: "B", shortDescription: RICH };
  const out = normalizeProductText(rich);
  assert.notEqual(out, rich);
  assert.equal(out.name, "B");
  assert.ok(out.shortDescription.startsWith("isoliertes Training"));
  assert.deepEqual(normalizeProductText({ name: "C" }), { name: "C" });
});
