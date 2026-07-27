import { test } from "node:test";
import assert from "node:assert/strict";

import {
  compactUrlLabel,
  emailLinkHtml,
  renderEmailProseHtml,
  emailProseToText,
  productNameLookup,
} from "./email-prose.mjs";

// ---------------------------------------------------------------------------
// renderEmailProseHtml — markdown links
// ---------------------------------------------------------------------------

test("markdown link renders as styled <a> with escaped label", () => {
  const html = renderEmailProseHtml(
    "Schau dir [das Laufband X](https://motionsports.de/products/laufband-x) an."
  );
  assert.match(html, /<a href="https:\/\/motionsports\.de\/products\/laufband-x"/);
  assert.match(html, />das Laufband X<\/a>/);
  assert.match(html, /^Schau dir /);
  assert.match(html, / an\.$/);
  assert.doesNotMatch(html, /\[|\]\(/);
});

test("multiple markdown links in one body all render", () => {
  const html = renderEmailProseHtml(
    "[A](https://a.example/x) und [B](https://b.example/y)"
  );
  assert.equal((html.match(/<a /g) ?? []).length, 2);
  assert.match(html, />A<\/a> und <a /);
});

test("markdown label and surrounding text are HTML-escaped", () => {
  const html = renderEmailProseHtml(
    '<b>hi</b> [x<script>](https://a.example/p?a=1&b=2) & "quotes"'
  );
  assert.doesNotMatch(html, /<b>|<script>/);
  assert.match(html, /&lt;b&gt;hi&lt;\/b&gt;/);
  assert.match(html, /x&lt;script&gt;<\/a>/);
  assert.match(html, /href="https:\/\/a.example\/p\?a=1&amp;b=2"/);
  assert.match(html, /&amp; &quot;quotes&quot;$/);
});

test("non-http(s) markdown URL is not linkified", () => {
  const html = renderEmailProseHtml("[click](javascript:alert(1)) here");
  assert.doesNotMatch(html, /<a /);
});

// ---------------------------------------------------------------------------
// renderEmailProseHtml — bare URLs
// ---------------------------------------------------------------------------

test("bare URL becomes a link with a compact label", () => {
  const html = renderEmailProseHtml(
    "Hier: https://www.motionsports.de/products/laufband-x?utm=mail — viel Spaß."
  );
  assert.match(html, /<a href="https:\/\/www\.motionsports\.de\/products\/laufband-x\?utm=mail"/);
  assert.match(html, />motionsports\.de\/products\/laufband-x<\/a>/);
});

test("bare URL uses labelForUrl when it names the URL", () => {
  const html = renderEmailProseHtml("Empfehlung: https://shop.example/products/rack", {
    labelForUrl: (url) => (url.endsWith("/rack") ? "Power Rack" : null),
  });
  assert.match(html, />Power Rack<\/a>/);
});

test("sentence punctuation after a bare URL stays outside the link", () => {
  const html = renderEmailProseHtml("Siehe https://a.example/x. Danach mehr");
  assert.match(html, /<a href="https:\/\/a\.example\/x"/);
  assert.match(html, /<\/a>\. Danach mehr$/);
});

test("bare URL inside a markdown link is not double-linkified", () => {
  const html = renderEmailProseHtml("[Laufband](https://a.example/x)");
  assert.equal((html.match(/<a /g) ?? []).length, 1);
});

test("custom linkStyle is applied", () => {
  const html = renderEmailProseHtml("https://a.example/x", { linkStyle: "color: #123456;" });
  assert.match(html, /style="color: #123456;"/);
});

test("plain prose without URLs is just escaped text", () => {
  const html = renderEmailProseHtml("Hallo Max,\n\nwie läuft's?");
  assert.equal(html, "Hallo Max,\n\nwie läuft's?".replaceAll("'", "&#39;"));
});

// ---------------------------------------------------------------------------
// emailProseToText
// ---------------------------------------------------------------------------

test("markdown links flatten to 'label (url)' for the text part", () => {
  assert.equal(
    emailProseToText("Schau dir [das Laufband](https://a.example/x) an."),
    "Schau dir das Laufband (https://a.example/x) an."
  );
});

test("bare URLs are left untouched in the text part", () => {
  const s = "Hier: https://a.example/x.";
  assert.equal(emailProseToText(s), s);
});

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

test("compactUrlLabel strips protocol/www/query and truncates", () => {
  assert.equal(
    compactUrlLabel("https://www.motionsports.de/products/laufband-x?a=1#frag"),
    "motionsports.de/products/laufband-x"
  );
  const long = `https://example.de/${"a".repeat(100)}`;
  assert.equal(compactUrlLabel(long).length, 48);
  assert.match(compactUrlLabel(long), /…$/);
});

test("emailLinkHtml escapes url + label and refuses non-http schemes", () => {
  const html = emailLinkHtml('https://a.example/"x', "<b>");
  assert.match(html, /href="https:\/\/a\.example\/&quot;x"/);
  assert.match(html, />&lt;b&gt;<\/a>/);
  assert.equal(emailLinkHtml("javascript:alert(1)", "x"), "x");
});

test("productNameLookup matches exact URL ignoring trailing slash", () => {
  const lookup = productNameLookup([
    { name: "Laufband X", shopifyUrl: "https://shop.example/products/laufband-x" },
    { name: "", shopifyUrl: "https://shop.example/products/empty" },
    { name: "No URL" },
  ]);
  assert.equal(lookup("https://shop.example/products/laufband-x/"), "Laufband X");
  assert.equal(lookup("https://shop.example/products/other"), null);
  assert.equal(lookup("https://shop.example/products/empty"), null);
});
