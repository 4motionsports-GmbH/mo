import { test } from "node:test";
import assert from "node:assert/strict";
import { MAILING_HTML_HARD_LIMIT, mailingChecks, visibleText } from "./mailing-checks.mjs";

const html = (body) => `<!DOCTYPE html><html><head><title>t</title></head><body>${body}</body></html>`;
const base = (over = {}) => ({
  subject: "Black Week: 25 % auf Racks",
  preheader: "Nur bis Sonntag",
  html: html(`<p>${"Viel Text über unsere Angebote. ".repeat(20)}</p><img src="https://x.de/a.jpg" alt="a"><a href="https://motionsports.de">Shop</a>`),
  docIssues: { errors: [], warnings: [] },
  sender: { ok: true, from: "motion sports <info@motionsports.de>" },
  sendsApproved: true,
  allowSingleOptIn: false,
  audience: { total: 1200, confirmed: 1000 },
  contentVersion: 3,
  testVersion: 3,
  usesFirstName: true,
  ratePerMinute: 300,
  unknownSubjectFields: [],
  ...over,
});
const keys = (list) => list.map((c) => c.key);

test("a clean mailing passes with infos about reach, duration and sender", () => {
  const r = mailingChecks(base());
  assert.equal(r.ok, true);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(keys(r.warnings), ["single_opt_in"]);
  assert.match(r.warnings[0].message, /200 Empfänger:innen ohne nachweisbares Double-Opt-in/);
  assert.match(r.infos.find((i) => i.key === "reach").message, /etwa 1000 Empfänger:innen — Dauer etwa 4 Minuten bei 300 pro Minute/);
  assert.ok(keys(r.infos).includes("unsubscribe"));
});

test("blocking: master flag, subject, sender, empty audience, missing test, content errors", () => {
  const r = mailingChecks(
    base({
      sendsApproved: false,
      subject: " ",
      sender: { ok: false, message: "Absender kaputt" },
      audience: { total: 0, confirmed: 0 },
      testVersion: 2,
      docIssues: { errors: [{ blockId: "b1", message: "Bild fehlt" }], warnings: [] },
      unknownSubjectFields: ["{{vornme}}"],
    })
  );
  assert.equal(r.ok, false);
  assert.deepEqual(keys(r.errors).sort(), ["audience_empty", "content", "sender", "sends_not_approved", "subject_field", "subject_missing", "test_missing"].sort());
  assert.equal(r.errors.find((e) => e.key === "content").blockId, "b1");
});

test("blocking: Gmail clipping size, http images, script links", () => {
  const big = mailingChecks(base({ html: html("x".repeat(MAILING_HTML_HARD_LIMIT + 10)) }));
  assert.ok(keys(big.errors).includes("size"));
  const insecure = mailingChecks(base({ html: html('<img src="http://x.de/a.jpg"><a href="javascript:alert(1)">x</a>') }));
  assert.ok(keys(insecure.errors).includes("insecure_image"));
  assert.ok(keys(insecure.errors).includes("bad_link"));
});

test("hints: long / shouting subjects, spam words, missing preheader, image-heavy, shorteners", () => {
  const r = mailingChecks(
    base({
      subject: "MEGA BLACK WEEK DEALS NUR HEUTE!!! JETZT GRATIS VERSAND FÜR ALLE FITNESSGERÄTE im Shop",
      preheader: "",
      html: html('<img src="https://x.de/a.jpg"><img src="https://x.de/b.jpg"><a href="https://bit.ly/abc">x</a><a href="http://motionsports.de">y</a>'),
      allowSingleOptIn: true,
    })
  );
  const w = keys(r.warnings);
  for (const k of ["subject_mobile", "subject_caps", "subject_bang", "spam_words", "preheader", "image_heavy", "shortener", "http_link"]) {
    assert.ok(w.includes(k), k);
  }
  assert.ok(!w.includes("single_opt_in"), "no opt-in hint while single opt-in is allowed");
  assert.equal(r.ok, true, "hints never block");
});

test("visibleText drops markup, comments, styles and the hidden preheader filler", () => {
  assert.equal(
    visibleText('<style>p{}</style><!--[if mso]>x<![endif]--><p>Hallo&nbsp;<b>Welt</b></p><div style="display: none; overflow: hidden;">&#847;&#8204;</div>'),
    "Hallo Welt"
  );
});

test("spam words: the fixed legal footer does not count, the operator's text and preview line do", () => {
  const withFooter = (body) =>
    html(`<p>${"Viel Text über unsere Angebote. ".repeat(20)}</p>${body}<!-- mo:footer --><p>Du kannst dich jederzeit kostenlos abmelden.</p>`);
  assert.ok(!keys(mailingChecks(base({ html: withFooter("") })).warnings).includes("spam_words"));
  const inText = mailingChecks(base({ html: withFooter("<p>Versand kostenlos!</p>") }));
  assert.match(inText.warnings.find((w) => w.key === "spam_words").message, /„kostenlos“/);
  const inPreheader = mailingChecks(base({ html: withFooter(""), preheader: "Heute gratis Versand" }));
  assert.match(inPreheader.warnings.find((w) => w.key === "spam_words").message, /„gratis“/);
});

test("products prepared ahead: sold out, gone and empty blocks are warnings, never errors", () => {
  const r = mailingChecks(base({ products: { soldOut: ["ATX® Hantelbank"], unknown: ["alt-handle"], emptyBlocks: 1 } }));
  assert.equal(r.ok, true);
  assert.ok(keys(r.warnings).includes("products_sold_out"));
  assert.match(r.warnings.find((w) => w.key === "products_sold_out").message, /Gerade ausverkauft: ATX® Hantelbank — fehlt in der Rundmail, wenn es beim Freigeben noch nicht lieferbar ist/);
  assert.match(r.warnings.find((w) => w.key === "products_unknown").message, /alt-handle/);
  assert.match(r.warnings.find((w) => w.key === "products_block_empty").message, /^Ein Produkt-Baustein hat gerade kein lieferbares Produkt/);
  const two = mailingChecks(base({ products: { soldOut: [], unknown: [], emptyBlocks: 2 } }));
  assert.match(two.warnings.find((w) => w.key === "products_block_empty").message, /^2 Produkt-Bausteine/);
  // nothing to say without products
  assert.ok(!keys(mailingChecks(base()).warnings).some((k) => k.startsWith("products_")));
});
