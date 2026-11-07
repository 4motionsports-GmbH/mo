import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAILING_BATCH_MAX,
  MAILING_MAX_TEST_ADDRESSES,
  batchSizeFor,
  batchSpacingMs,
  classifyResendError,
  freezeLinks,
  isSendableAddress,
  isTrackableUrl,
  leftoverPlaceholders,
  mailingIdempotencyKey,
  mailingProgress,
  minutesLeft,
  parseMailingRate,
  parseTestAddresses,
  personalizeFrozen,
  resendErrorMessage,
  withUtm,
} from "./mailing-core.mjs";

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
