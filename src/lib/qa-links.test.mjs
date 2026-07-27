import { test } from "node:test";
import assert from "node:assert/strict";
import { qaAnswerHtml, qaAnswerHasLink } from "./qa-links.mjs";

test("plain answers pass through escaped, unchanged otherwise", () => {
  assert.equal(qaAnswerHtml("Die Multipresse trägt bis zu 250 kg."), "Die Multipresse trägt bis zu 250 kg.");
  assert.equal(qaAnswerHtml("2 < 3 & \"quotes\""), "2 &lt; 3 &amp; &quot;quotes&quot;");
  assert.equal(qaAnswerHasLink("Keine Links hier."), false);
});

test("markdown link renders as a plain anchor with the label as text", () => {
  const html = qaAnswerHtml(
    "Passend dazu: [ATX Multipresse MPX-780](https://motionsports.de/products/atx-multipresse-mpx-780)."
  );
  assert.equal(
    html,
    'Passend dazu: <a href="https://motionsports.de/products/atx-multipresse-mpx-780" target="_blank" rel="noopener noreferrer">ATX Multipresse MPX-780</a>.'
  );
  assert.equal(qaAnswerHasLink("[X](https://a.de/x)"), true);
});

test("multiple markdown links and surrounding newlines survive", () => {
  const html = qaAnswerHtml("Siehe [A](https://a.de/1)\nund [B](https://a.de/2).");
  assert.ok(html.includes('">A</a>'));
  assert.ok(html.includes('">B</a>'));
  assert.ok(html.includes("\nund "));
});

test("bare URLs are linkified with a compact label, punctuation kept outside", () => {
  const html = qaAnswerHtml("Details: https://motionsports.de/products/laufband-x?utm=1.");
  assert.equal(
    html,
    'Details: <a href="https://motionsports.de/products/laufband-x?utm=1" target="_blank" rel="noopener noreferrer">motionsports.de/products/laufband-x</a>.'
  );
  assert.equal(qaAnswerHasLink("Siehe https://a.de/x"), true);
});

test("markdown link URLs are not double-processed by the bare-URL pass", () => {
  const html = qaAnswerHtml("[Label](https://a.de/x)");
  assert.equal(
    html,
    '<a href="https://a.de/x" target="_blank" rel="noopener noreferrer">Label</a>'
  );
});

test("non-http(s) schemes never become links", () => {
  const html = qaAnswerHtml("[klick](javascript:alert(1)) bleibt Text");
  assert.ok(!html.includes("<a "));
});

test("HTML in labels and text is escaped", () => {
  const html = qaAnswerHtml('[<b>fett</b>](https://a.de/) & <script>');
  assert.ok(html.includes("&lt;b&gt;fett&lt;/b&gt;"));
  assert.ok(html.includes("&amp; &lt;script&gt;"));
  assert.ok(!html.includes("<b>"));
});

test("empty markdown label falls back to the compact URL label", () => {
  const html = qaAnswerHtml("[ ](https://motionsports.de/products/bank)");
  assert.ok(html.includes('">motionsports.de/products/bank</a>'));
});
