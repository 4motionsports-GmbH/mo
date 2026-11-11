import { test } from "node:test";
import assert from "node:assert/strict";
import {
  batchSizeFor,
  batchSpacingMs,
  classifyResendError,
  freezeLinks,
  isSendableAddress,
  isTrackableUrl,
  isWebFontStylesheetUrl,
  leftoverPlaceholders,
  MAILING_BATCH_MAX,
  MAILING_MAX_TEST_ADDRESSES,
  mailingIdempotencyKey,
  mailingProgress,
  mayRequeueBatch,
  mailingUsesFirstName,
  minutesLeft,
  parseMailingRate,
  parseTestAddresses,
  personalizeFrozen,
  resendErrorMessage,
  rewriteLinkHrefs,
  withUtm,
} from "./mailing-core.mjs";
import { normalizeMailTemplateDoc } from "./mail-template-doc.mjs";

test("rates: presets parse, unknown values fall back to normal", () => {
  assert.equal(parseMailingRate("schnell"), "schnell");
  assert.equal(parseMailingRate("turbo"), "normal");
  assert.equal(parseMailingRate(undefined), "normal");
});

test("batchSpacingMs keeps the rate and never goes below 600 ms per request", () => {
  assert.equal(batchSpacingMs(50, 300), 10_000);
  assert.equal(batchSpacingMs(50, 1000), 3_000);
  assert.equal(batchSpacingMs(1, 1000), 600);
  assert.equal(batchSpacingMs(500, 60), 100_000); // clamped to 100 per batch
});

test("batchSizeFor: a slow rate sends small batches, never more than 100", () => {
  assert.equal(batchSizeFor(50, 300), 50);
  assert.equal(batchSizeFor(50, 60), 10);
  assert.equal(batchSizeFor(500, 10_000), MAILING_BATCH_MAX);
  assert.equal(batchSizeFor(0, 5), 1);
});

test("idempotency key: stable per batch, distinct across batches and mailings", () => {
  assert.equal(mailingIdempotencyKey(7, 12), "mo-rundmail-7-12");
  assert.notEqual(mailingIdempotencyKey(7, 12), mailingIdempotencyKey(7, 13));
  assert.notEqual(mailingIdempotencyKey(7, 12), mailingIdempotencyKey(8, 12));
});

test("mayRequeueBatch: only a fresh, never attempted batch goes back to the queue", () => {
  // Fresh claim, first try refused (429, quota, config): nothing reached Resend.
  assert.equal(mayRequeueBatch({ retry: false, attempts: 0 }), true);
  // An earlier attempt of unknown outcome (timeout, 5xx, booking failed).
  assert.equal(mayRequeueBatch({ retry: false, attempts: 1 }), false);
  // Left open by a run that died during the Resend call — attempts still 0.
  assert.equal(mayRequeueBatch({ retry: true, attempts: 0 }), false);
  assert.equal(mayRequeueBatch({ retry: true, attempts: 3 }), false);
});

test("classifyResendError: what the runner does per Resend error", () => {
  const cases = [
    [{ name: "rate_limit_exceeded", statusCode: 429 }, "rate_limited"],
    [{ name: "application_error", statusCode: 429 }, "rate_limited"],
    [{ name: "daily_quota_exceeded", statusCode: 429 }, "quota"],
    [{ name: "monthly_quota_exceeded", statusCode: 429 }, "quota"],
    [{ name: "invalid_idempotent_request", statusCode: 409 }, "conflict"],
    [{ name: "concurrent_idempotent_requests", statusCode: 409 }, "transient"],
    [{ name: "invalid_from_address", statusCode: 403 }, "config"],
    [{ name: "invalid_api_key", statusCode: 403 }, "config"],
    [{ name: "restricted_api_key", statusCode: 401 }, "config"],
    [{ name: "validation_error", statusCode: 422 }, "invalid"],
    [{ name: "something_new", statusCode: 400 }, "invalid"],
    [{ name: "internal_server_error", statusCode: 500 }, "transient"],
    [{ name: "application_error", statusCode: null }, "transient"],
    [null, "transient"],
  ];
  for (const [err, expected] of cases) assert.equal(classifyResendError(err), expected, JSON.stringify(err));
  for (const c of ["rate_limited", "quota", "config", "invalid", "conflict", "transient", "not_configured"]) {
    assert.ok(resendErrorMessage(c, "x").length > 10, c);
  }
});

test("withUtm: shop links get UTM parameters once; foreign links stay", () => {
  assert.equal(
    withUtm("https://motionsports.de/collections/black-week", { campaign: "black-week" }),
    "https://motionsports.de/collections/black-week?utm_source=mo&utm_medium=email&utm_campaign=black-week"
  );
  assert.equal(withUtm("https://www.motionsports.de/?a=1", { campaign: "x" }), "https://www.motionsports.de/?a=1&utm_source=mo&utm_medium=email&utm_campaign=x");
  assert.equal(withUtm("https://motionsports.de/?utm_source=ig", { campaign: "x" }), "https://motionsports.de/?utm_source=ig");
  assert.equal(withUtm("https://instagram.com/x", { campaign: "x" }), "https://instagram.com/x");
  assert.equal(withUtm("not a url", { campaign: "x" }), "not a url");
});

test("isTrackableUrl: http(s) except the untracked legal links", () => {
  const untracked = ["https://motionsports.de/pages/impressum"];
  assert.equal(isTrackableUrl("https://motionsports.de/products/a", { untracked }), true);
  assert.equal(isTrackableUrl("https://motionsports.de/pages/impressum/", { untracked }), false);
  assert.equal(isTrackableUrl("mailto:info@motionsports.de", { untracked }), false);
  assert.equal(isTrackableUrl("{{mo:unsub}}", { untracked }), false);
});

test("freezeLinks: one index per URL in HTML and text; legal and placeholder links untouched", () => {
  const html =
    '<a href="https://motionsports.de/a?x=1&amp;y=2">A</a>' +
    '<!--[if mso]><a href="https://motionsports.de/b">B</a><![endif]--><!--[if !mso]><!--><a href="https://motionsports.de/b">B</a><!--<![endif]-->' +
    '<a href="https://motionsports.de/pages/impressum">Impressum</a><a href="{{mo:unsub}}">Abmelden</a><a href="mailto:info@motionsports.de">M</a>';
  const text = "A: https://motionsports.de/a?x=1&y=2.\nB (https://motionsports.de/b)\nAbmelden: {{mo:unsub}}";
  const out = freezeLinks({ html, text }, { campaign: "bw", untracked: ["https://motionsports.de/pages/impressum"] });
  assert.equal(out.links.length, 2);
  assert.equal(out.links[0].url, "https://motionsports.de/a?x=1&y=2&utm_source=mo&utm_medium=email&utm_campaign=bw");
  assert.match(out.html, /href="\{\{mo:link:0\}\}">A/);
  assert.equal(out.html.split("{{mo:link:1}}").length - 1, 2, "both Outlook twins get the same index");
  assert.match(out.html, /pages\/impressum/);
  assert.match(out.html, /href="\{\{mo:unsub\}\}"/);
  assert.match(out.html, /mailto:/);
  assert.equal(out.text, "A: {{mo:link:0}}.\nB ({{mo:link:1}})\nAbmelden: {{mo:unsub}}");
});

const FONT_HEAD =
  '<head><!--[if !mso]><!--><link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;700&amp;display=swap" rel="stylesheet" type="text/css">' +
  "<style>@import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@400;700&display=swap');</style><!--<![endif]--></head>";

test("freezeLinks: the web-font stylesheet stays direct — the first real link is link 0", () => {
  const html = `${FONT_HEAD}<body><a href="https://motionsports.de/">Logo</a><base href="https://motionsports.de/base"></body>`;
  const out = freezeLinks({ html, text: "" }, { campaign: "bw" });
  assert.deepEqual(out.links, [{ url: "https://motionsports.de/?utm_source=mo&utm_medium=email&utm_campaign=bw" }]);
  assert.match(out.html, /<link href="https:\/\/fonts\.googleapis\.com\/css2\?family=Montserrat:wght@400;700&amp;display=swap" rel="stylesheet"/);
  assert.match(out.html, /@import url\('https:\/\/fonts\.googleapis\.com\//);
  assert.match(out.html, /<a href="\{\{mo:link:0\}\}">Logo/);
  assert.match(out.html, /<base href="https:\/\/motionsports\.de\/base">/, "<base> is no click target");
});

test("freezeLinks: a link inside <!--[if mso]> and its twin share one index — <a>, <v:roundrect> and <area>", () => {
  const html =
    '<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" href="https://motionsports.de/sale" style="height:44px;" arcsize="50%" fillcolor="#008ccb"><center>Los</center></v:roundrect><![endif]-->' +
    '<!--[if !mso]><!--><a href="https://motionsports.de/sale" target="_blank">Los</a><!--<![endif]-->' +
    '<!--[if mso]><table><tr><td><a href="https://motionsports.de/b">B</a></td></tr></table><![endif]--><a href="https://motionsports.de/b">B</a>' +
    '<map name="m"><area shape="rect" coords="0,0,10,10" href="https://motionsports.de/area" alt="x"></map>';
  const out = freezeLinks({ html, text: "" }, { campaign: "bw" });
  assert.deepEqual(
    out.links.map((l) => l.url.replace(/\?.*$/, "")),
    ["https://motionsports.de/sale", "https://motionsports.de/b", "https://motionsports.de/area"]
  );
  assert.equal(out.html.split('href="{{mo:link:0}}"').length - 1, 2, "VML button and its HTML twin");
  assert.equal(out.html.split('href="{{mo:link:1}}"').length - 1, 2, "the <a> inside the MSO block and its twin");
  assert.match(out.html, /<area shape="rect" coords="0,0,10,10" href="\{\{mo:link:2\}\}"/);
  assert.match(out.html, /<v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" href="\{\{mo:link:0\}\}" style="height:44px;"/);
});

test("freezeLinks: single-quoted and unquoted hrefs are not touched (the renderer writes double quotes)", () => {
  const html = "<a href='https://motionsports.de/single'>s</a> <a href=https://motionsports.de/bare>b</a>";
  const out = freezeLinks({ html, text: "" }, { campaign: "bw" });
  assert.deepEqual(out.links, []);
  assert.equal(out.html, html);
});

test("freezeLinks: the text part keeps its behaviour — bare URLs, trailing punctuation, one index shared with the HTML", () => {
  const html = '<a href="https://motionsports.de/a">A</a>';
  const text =
    "Zum Angebot: https://motionsports.de/a!\n(https://motionsports.de/c), https://motionsports.de/pages/impressum\nmailto:info@motionsports.de {{mo:unsub}}";
  const out = freezeLinks({ html, text }, { campaign: "bw", untracked: ["https://motionsports.de/pages/impressum"] });
  assert.equal(out.text, "Zum Angebot: {{mo:link:0}}!\n({{mo:link:1}}), https://motionsports.de/pages/impressum\nmailto:info@motionsports.de {{mo:unsub}}");
  assert.equal(out.links.length, 2);
  assert.equal(out.links[1].url, "https://motionsports.de/c?utm_source=mo&utm_medium=email&utm_campaign=bw");
});

test("rewriteLinkHrefs: only the href of click targets; names, spacing and other attributes stay", () => {
  const seen = [];
  const html =
    '<A HREF="https://x.de/1">a</A><a title="a > b" data-href="https://x.de/data" href = "https://x.de/2" download>b</a>' +
    '<abbr href="https://x.de/abbr">c</abbr><address href="https://x.de/addr"></address><link href="https://x.de/css">' +
    '<a\n  href="https://x.de/3"\n  target="_blank">d</a><a href="https://x.de/keep">e</a><a name="anchor">f</a>';
  const out = rewriteLinkHrefs(html, (value) => {
    seen.push(value);
    return value.endsWith("/keep") ? null : "X";
  });
  assert.deepEqual(seen, ["https://x.de/1", "https://x.de/2", "https://x.de/3", "https://x.de/keep"]);
  assert.equal(
    out,
    '<A HREF="X">a</A><a title="a > b" data-href="https://x.de/data" href = "X" download>b</a>' +
      '<abbr href="https://x.de/abbr">c</abbr><address href="https://x.de/addr"></address><link href="https://x.de/css">' +
      '<a\n  href="X"\n  target="_blank">d</a><a href="https://x.de/keep">e</a><a name="anchor">f</a>'
  );
  assert.equal(rewriteLinkHrefs("", () => "X"), "");
});

test("rewriteLinkHrefs: an unclosed tag ends at the next „<“ — later links still count, broken markup stays fast", () => {
  assert.equal(
    rewriteLinkHrefs('<a title="x" <a href="https://x.de/2">2</a>', () => "X"),
    '<a title="x" <a href="X">2</a>'
  );
  // Every unclosed "<a" used to scan to the end of the mail: quadratic, minutes for this.
  const broken = `${"<a ".repeat(30_000)}${"x".repeat(100_000)}<a title="never closed ${"y".repeat(100_000)}`;
  const started = Date.now();
  assert.equal(rewriteLinkHrefs(broken, () => "X"), broken);
  assert.ok(Date.now() - started < 1500, `${Date.now() - started} ms`);
});

test("mailingUsesFirstName: the subject, a greeting or {{vorname}} anywhere — inside sections too", () => {
  const doc = (blocks) => normalizeMailTemplateDoc({ blocks });
  const plain = doc([{ type: "heading", text: "Black Week" }, { type: "text", text: "Spare jetzt." }]);
  assert.equal(mailingUsesFirstName("Black Week", plain), false);
  assert.equal(mailingUsesFirstName("{{ vorname|Hallo }}, Black Week", plain), true);
  assert.equal(mailingUsesFirstName("x", doc([{ type: "greeting" }])), true);
  assert.equal(mailingUsesFirstName("x", doc([{ type: "button", label: "Los, {{vorname}}", href: "https://motionsports.de" }])), true);
  const nested = (child) => doc([{ type: "section", columns: [{ blocks: [{ type: "text", text: "Links" }] }, { blocks: [child] }] }]);
  assert.equal(mailingUsesFirstName("x", nested({ type: "greeting", text: "Hey {{vorname}}", fallback: "Hey" })), true);
  assert.equal(mailingUsesFirstName("x", nested({ type: "text", text: "Für dich, {{Vorname|Sportsfreund}}" })), true);
  assert.equal(mailingUsesFirstName("x", nested({ type: "text", text: "Für alle" })), false);
  assert.equal(mailingUsesFirstName(null, null), false);
});

test("personalizeFrozen: per-recipient values, escaped in HTML, raw in text", () => {
  const values = {
    unsubscribeUrl: "https://mo.example.com/api/unsubscribe?token=a&locale=en",
    erasureUrl: "https://mo.example.com/api/erase-data?token=b",
    trackUrl: (n) => `https://mo.example.com/api/r/TOKEN?l=${n}`,
    firstName: "anna",
    merges: [{ fallback: "" }, { fallback: "Hey" }],
    greetings: [{ text: "Hallo {{vorname}},", fallback: "Hallo," }],
  };
  const html = personalizeFrozen(
    '<a href="{{mo:unsub}}">x</a><a href="{{mo:erase}}">y</a><a href="{{mo:link:3}}">z</a> {{mo:fn:0}} {{mo:fn:1}} {{mo:greet:0}} {{mo:fn:9}}',
    values,
    "html"
  );
  assert.equal(
    html,
    '<a href="https://mo.example.com/api/unsubscribe?token=a&amp;locale=en">x</a><a href="https://mo.example.com/api/erase-data?token=b">y</a><a href="https://mo.example.com/api/r/TOKEN?l=3">z</a> Anna Anna Hallo Anna, '
  );
  const noName = personalizeFrozen("{{mo:fn:0}}|{{mo:fn:1}}|{{mo:greet:0}}|{{mo:unsub}}", { ...values, firstName: "TEST" }, "text");
  assert.equal(noName, "|Hey|Hallo,|https://mo.example.com/api/unsubscribe?token=a&locale=en");
  // A name with markup is escaped in HTML.
  const sneaky = personalizeFrozen("{{mo:fn:0}}", { ...values, firstName: "Ann<b>" }, "html");
  assert.equal(sneaky, ""); // not a printable name → the empty fallback
  assert.deepEqual(leftoverPlaceholders(html), []);
  assert.deepEqual(leftoverPlaceholders("x {{mo:link:1}} {{vorname}}"), ["{{mo:link:1}}", "{{vorname}}"]);
});

test("addresses: sendable shapes and the test-send form", () => {
  assert.equal(isSendableAddress("anna@example.com"), true);
  for (const bad of ["Anna <anna@example.com>", "a@b", "a,b@example.com", "", null, "a b@example.com"]) assert.equal(isSendableAddress(bad), false, String(bad));
  const ok = parseTestAddresses("Me@Example.com, me@example.com; you@example.com\nthem@example.com");
  assert.deepEqual(ok.ok && ok.addresses, ["me@example.com", "you@example.com", "them@example.com"]);
  assert.equal(parseTestAddresses("").ok, false);
  assert.equal(parseTestAddresses("nope").ok, false);
  assert.equal(parseTestAddresses(Array.from({ length: MAILING_MAX_TEST_ADDRESSES + 1 }, (_, i) => `a${i}@x.de`)).ok, false);
});

test("progress and time left", () => {
  assert.deepEqual(mailingProgress({ total: 100, pending: 40, sending: 10, sent: 45, skipped: 3, suppressed: 2, failed: 0 }), {
    total: 100,
    done: 50,
    open: 50,
    percent: 50,
  });
  assert.equal(mailingProgress({ total: 0, pending: 0, sending: 0, sent: 0, skipped: 0, suppressed: 0, failed: 0 }).percent, 0);
  assert.equal(minutesLeft(0, 300), 0);
  assert.equal(minutesLeft(301, 300), 2);
});

test("isWebFontStylesheetUrl recognises the font stylesheet of old frozen link tables", () => {
  assert.equal(isWebFontStylesheetUrl("https://fonts.googleapis.com/css2?family=Montserrat:wght@400;700&display=swap"), true);
  assert.equal(isWebFontStylesheetUrl("https://fonts.gstatic.com/s/x.woff2"), true);
  assert.equal(isWebFontStylesheetUrl("https://www.motionsports.de/?utm_source=x"), false);
  assert.equal(isWebFontStylesheetUrl("kein link"), false);
  assert.equal(isWebFontStylesheetUrl(null), false);
});
