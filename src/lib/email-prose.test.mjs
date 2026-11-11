import { test } from "node:test";
import assert from "node:assert/strict";

import {
  compactUrlLabel,
  emailLinkHtml,
  isLinkableProseUrl,
  proseLinks,
  proseLinkUrls,
  renderEmailProseHtml,
  emailProseToText,
  plainTextEmailHtml,
  productNameLookup,
} from "./email-prose.mjs";

/** The hrefs of rendered prose, entity-decoded (what a mail client opens). */
function renderedHrefs(html) {
  return [...html.matchAll(/<a href="([^"]*)"/g)].map((m) =>
    m[1].replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
  );
}

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
// renderEmailProseHtml — literal HTML anchors in the prose
// ---------------------------------------------------------------------------

test("literal HTML anchor renders as ONE clean link (no tag soup)", () => {
  const html = renderEmailProseHtml(
    'könnte die <a href="https://shop.example/products/hex-bar">Hex Bar 50mm in Chrom</a> passen.'
  );
  assert.equal((html.match(/<a /g) ?? []).length, 1);
  assert.match(html, /<a href="https:\/\/shop\.example\/products\/hex-bar"/);
  assert.match(html, />Hex Bar 50mm in Chrom<\/a>/);
  assert.doesNotMatch(html, /&lt;a\s|&lt;\/a&gt;/);
});

test("HTML anchor with single-quoted href and extra attributes works", () => {
  const html = renderEmailProseHtml(
    "<a target='_blank' href='https://a.example/x' class='y'>Label</a>"
  );
  assert.equal((html.match(/<a /g) ?? []).length, 1);
  assert.match(html, /href="https:\/\/a\.example\/x"/);
  assert.match(html, />Label<\/a>/);
});

test("HTML anchor with empty/taggy label falls back to a URL label", () => {
  const html = renderEmailProseHtml('<a href="https://a.example/products/rack"><b></b></a>', {
    labelForUrl: (url) => (url.endsWith("/rack") ? "Power Rack" : null),
  });
  assert.match(html, />Power Rack<\/a>/);
});

test("non-http anchor href is not linkified and never emits raw tags", () => {
  const html = renderEmailProseHtml('<a href="javascript:alert(1)">x</a>');
  assert.doesNotMatch(html, /<a /);
  assert.doesNotMatch(html, /javascript:alert\(1\)">/);
});

test("markdown and HTML anchors mix in one body", () => {
  const html = renderEmailProseHtml(
    '[A](https://a.example/1) und <a href="https://a.example/2">B</a>'
  );
  assert.equal((html.match(/<a /g) ?? []).length, 2);
  assert.match(html, />A<\/a> und <a /);
  assert.match(html, />B<\/a>/);
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

test("plain prose without URLs is escaped text with <br> line breaks", () => {
  const html = renderEmailProseHtml("Hallo Max,\n\nwie läuft's?");
  assert.equal(html, "Hallo Max,<br><br>wie läuft&#39;s?");
});

// ---------------------------------------------------------------------------
// renderEmailProseHtml — line breaks (Outlook for Windows ignores pre-wrap)
// ---------------------------------------------------------------------------

test("every line-break spelling becomes exactly one <br>", () => {
  assert.equal(renderEmailProseHtml("a\r\nb\rc\nd"), "a<br>b<br>c<br>d");
  assert.equal(renderEmailProseHtml("a\r\n\r\nb"), "a<br><br>b");
  // Runs of spaces are left to the container's white-space:pre-wrap.
  assert.equal(renderEmailProseHtml("-  zwei  Leerzeichen\n  eingerückt"), "-  zwei  Leerzeichen<br>  eingerückt");
});

test("no raw newline survives anywhere in the HTML (text, links, bold, attributes)", () => {
  const bodies = [
    "Hallo,\n\nzeile\r\nzwei\rdrei\n",
    "\n\n**Fett:**\n- [Bank](https://a.example/bank)\n- https://a.example/x.\n\nGruß\r\nMo\n",
    '<a href="https://a.example/x\n/y">zwei\nZeilen</a>\nund <a href=\'https://a.example/z\'>Z</a>',
    "**a\nb** und **[Name](https://a.example/n)**\n",
  ];
  for (const body of bodies) {
    const html = renderEmailProseHtml(body, { linkStyle: "color: #123456;\ntext-decoration: underline;" });
    assert.doesNotMatch(html, /[\r\n]/, JSON.stringify(body));
  }
  const anchor = renderEmailProseHtml('<a href="https://a.example/x\n/y">zwei\nZeilen</a>');
  // The href loses the newline (URL parsing drops it anyway) — never a <br>.
  assert.match(anchor, /<a href="https:\/\/a\.example\/x\/y"/);
  assert.match(anchor, />zwei<br>Zeilen<\/a>/);
});

test("a bold span never crosses a <br>", () => {
  for (const body of ["**a\nb**", "**a\r\nb**", "**a\rb**", "x **a\n\nb** y"]) {
    const html = renderEmailProseHtml(body);
    assert.doesNotMatch(html, /<strong>/, JSON.stringify(body));
    assert.match(html, /\*\*a<br>/);
  }
  const html = renderEmailProseHtml("**Eins:**\n**Zwei:** Text\n**Drei**");
  assert.equal(html, "<strong>Eins:</strong><br><strong>Zwei:</strong> Text<br><strong>Drei</strong>");
  assert.doesNotMatch(html, /<strong>(?:(?!<\/strong>).)*<br>/);
});

// ---------------------------------------------------------------------------
// plainTextEmailHtml — the operator's typed reply
// ---------------------------------------------------------------------------

test("plainTextEmailHtml escapes everything and turns line breaks into <br>", () => {
  assert.equal(
    plainTextEmailHtml(`Hallo "Max",\r\n\r\n<b>fett</b> & it's\nGruß\rMo`),
    "Hallo &quot;Max&quot;,<br><br>&lt;b&gt;fett&lt;/b&gt; &amp; it&#39;s<br>Gruß<br>Mo"
  );
});

test("plainTextEmailHtml keeps links, markdown and spaces as typed and leaves no newline", () => {
  const html = plainTextEmailHtml("\n  **nicht fett** [x](https://a.example) https://a.example/y\n\n\n");
  assert.equal(html, "<br>  **nicht fett** [x](https://a.example) https://a.example/y<br><br><br>");
  assert.doesNotMatch(html, /<a |<strong>|[\r\n]/);
  assert.equal(plainTextEmailHtml(""), "");
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

test("HTML anchors flatten to 'label (url)' for the text part", () => {
  assert.equal(
    emailProseToText('Die <a href="https://a.example/x">Hex Bar</a> passt.'),
    "Die Hex Bar (https://a.example/x) passt."
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

// ---------------------------------------------------------------------------
// markdown bold (**…**) — renders as <strong>, never as literal asterisks
// ---------------------------------------------------------------------------

test("renderEmailProseHtml renders **bold** as <strong>", () => {
  const html = renderEmailProseHtml("Hallo,\n\n**Gezielte Kraft & Stabilität:**\nDer Trainer passt gut.");
  assert.match(html, /<strong>Gezielte Kraft &amp; Stabilität:<\/strong>/);
  assert.doesNotMatch(html, /\*\*/);
});

test("renderEmailProseHtml bolds a markdown-linked label (**[Name](url)**)", () => {
  const html = renderEmailProseHtml(
    "**[Laufband X](https://shop.example/products/laufband-x)** ist super."
  );
  assert.match(html, /<strong><a [^>]*>Laufband X<\/a><\/strong>/);
});

test("renderEmailProseHtml leaves unpaired/empty asterisks alone", () => {
  assert.match(renderEmailProseHtml("2 ** 3 und 5 * 7"), /2 \*\* 3 und 5 \* 7/);
  assert.equal(renderEmailProseHtml("****"), "****");
  // No pairing across lines.
  assert.doesNotMatch(renderEmailProseHtml("**a\nb**"), /<strong>/);
});

test("emailProseToText strips bold markers", () => {
  assert.equal(
    emailProseToText("**Rücken und Core:** Die [Bank](https://s.example/p) hilft."),
    "Rücken und Core: Die Bank (https://s.example/p) hilft."
  );
});

// ---------------------------------------------------------------------------
// links with a user name / password — a disguised host is never a link
// ---------------------------------------------------------------------------

/** The reviewer's payloads: each LOOKS like the shop and would open evil.example. */
const USERINFO_PAYLOADS = {
  mdApostrophe: "Jetzt [Konto bestätigen](https://motionsports.de'@evil.example/login) und sparen.",
  mdQuote: 'Jetzt [Konto bestätigen](https://motionsports.de"@evil.example/login) und sparen.',
  mdBracket: "Jetzt [Konto bestätigen](https://motionsports.de]@evil.example/login) und sparen.",
  mdBrace: "Jetzt [Konto bestätigen](https://motionsports.de{@evil.example/login) und sparen.",
  bareBrace: "Hier entlang: https://motionsports.de{@evil.example/login und sparen.",
  anchorSingleQ: `Jetzt <a href='https://motionsports.de"@evil.example/login'>Konto bestätigen</a> und sparen.`,
  plainUserinfo: "Jetzt [Konto](https://user:pass@motionsports.de/login) prüfen.",
};

test("a URL with a user name or password is shown as text, never as a link", () => {
  for (const [name, body] of Object.entries(USERINFO_PAYLOADS)) {
    const html = renderEmailProseHtml(body);
    assert.doesNotMatch(html, /<a /, name);
    assert.deepEqual(proseLinkUrls(body), [], name);
    // the check still sees the URL (to tell the author) — just not as linkable
    const links = proseLinks(body);
    assert.equal(links.length, 1, name);
    assert.equal(links[0].linkable, false, name);
  }
  assert.equal(renderEmailProseHtml(USERINFO_PAYLOADS.mdApostrophe), "Jetzt Konto bestätigen und sparen.");
  assert.equal(emailLinkHtml("https://motionsports.de'@evil.example/x", "Shop"), "Shop");
  assert.equal(emailLinkHtml("https://a:b@a.example/", "<x>"), "&lt;x&gt;");
  assert.equal(isLinkableProseUrl("https://motionsports.de/products/x?a=1&b=2"), true);
  assert.equal(isLinkableProseUrl("HTTPS://MOTIONSPORTS.DE/"), true);
  assert.equal(isLinkableProseUrl("https://motionsports.de@evil.example/"), false);
  assert.equal(isLinkableProseUrl("https://a.example:99999/"), false, "an unparseable URL is no link");
  assert.equal(isLinkableProseUrl("javascript:alert(1)"), false);
  assert.equal(isLinkableProseUrl(null), false);
});

// ---------------------------------------------------------------------------
// proseLinks / proseLinkUrls — exactly the links the renderer makes
// ---------------------------------------------------------------------------

test("proseLinks: kind, URL, label and where it stands — the same scan as the renderer", () => {
  const body = 'A [Bank](https://a.example/bank) und <a class="x" href="https://a.example/z">Z</a>, dann https://a.example/y. Ende';
  const links = proseLinks(body);
  assert.deepEqual(
    links.map((l) => [l.kind, l.url, l.label, l.linkable]),
    [
      ["markdown", "https://a.example/bank", "Bank", true],
      ["anchor", "https://a.example/z", "Z", true],
      ["bare", "https://a.example/y", "", true],
    ]
  );
  for (const l of links) assert.equal(body.slice(l.urlStart, l.urlEnd), l.url);
  assert.equal(body.slice(links[0].start, links[0].end), "[Bank](https://a.example/bank)");
  assert.equal(body.slice(links[1].start, links[1].end), '<a class="x" href="https://a.example/z">Z</a>');
  assert.deepEqual(proseLinkUrls(body), renderedHrefs(renderEmailProseHtml(body)));
  // an anchor href across lines: the URL as linked (no line break), the span as written
  const multi = '<a href="https://a.example/x\n/y">L</a>';
  const [m] = proseLinks(multi);
  assert.equal(m.url, "https://a.example/x/y");
  assert.equal(multi.slice(m.urlStart, m.urlEnd), "https://a.example/x\n/y");
  assert.deepEqual(proseLinks("kein Link, nur Text"), []);
});

test("proseLinkUrls equals the rendered hrefs — also where a narrower URL pattern would stop early", () => {
  const bodies = [
    ...Object.values(USERINFO_PAYLOADS),
    "Mehr [im Blog](https://motionsports.de/blogs/x) und auf https://fremd.example/x.",
    "[a](https://a.example/x{y}) https://b.example/p{q}r 'https://c.example/q'",
    "<a data-href=\"https://a.example/first\" href=\"https://a.example/second\">x</a>",
    "**[Name](https://a.example/n)** und **fett**",
    "x https://a.example/**y** z",
  ];
  for (const body of bodies) assert.deepEqual(proseLinkUrls(body), renderedHrefs(renderEmailProseHtml(body)), body);
  // the anchor pattern takes the first href-like attribute — and so does the scan
  assert.deepEqual(proseLinkUrls("<a data-href=\"https://a.example/first\" href=\"https://a.example/second\">x</a>"), ["https://a.example/first"]);
});

test("asterisks inside a linked URL never become <strong> inside the href", () => {
  const html = renderEmailProseHtml("x https://a.example/**y** z **fett**");
  assert.match(html, /<a href="https:\/\/a\.example\/\*\*y\*\*"/);
  assert.match(html, /<strong>fett<\/strong>/);
  // a bold span around a link still works
  assert.match(renderEmailProseHtml("**[Laufband X](https://a.example/l)** ist super."), /^<strong><a [^>]*>Laufband X<\/a><\/strong>/);
});
