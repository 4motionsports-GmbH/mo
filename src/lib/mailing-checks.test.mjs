import { test } from "node:test";
import assert from "node:assert/strict";
import { MAILING_HTML_HARD_LIMIT, mailingChecks, renderedMailErrors, visibleText } from "./mailing-checks.mjs";
import { MAIL_FOOTER_MARKER } from "./mail-template-render.mjs";

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
  // the duration at the measured real speed (80 % of the label): 1000 ÷ 240 → 5 minutes
  assert.match(
    r.infos.find((i) => i.key === "reach").message,
    /etwa 1000 Empfänger:innen — Dauer etwa 5 Min\. \(Tempo 300 pro Minute, real etwa 240\)/
  );
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

test("image-heavy counts the content only — the legal footer's text and icons do not hide it", () => {
  const footer = `${MAIL_FOOTER_MARKER}<p>${"Du erhältst diese Mail, weil du eingewilligt hast. Abmelden · Daten löschen · Impressum. ".repeat(6)}</p><img src="https://x.de/fb.png" alt="Facebook"><img src="https://x.de/ig.png" alt="Instagram">`;
  const imageOnly = mailingChecks(
    base({ html: html(`<img src="https://x.de/banner.jpg" alt="Black Week"><img src="https://x.de/p.jpg" alt="Rack"><a href="https://motionsports.de">Zum Shop</a>${footer}`) })
  );
  assert.ok(keys(imageOnly.warnings).includes("image_heavy"));
  // Real text in the content: no warning, however many icons the footer has.
  const withText = mailingChecks(
    base({ html: html(`<p>${"Viel Text über unsere Angebote. ".repeat(20)}</p><img src="https://x.de/a.jpg" alt="a"><img src="https://x.de/b.jpg" alt="b">${footer}`) })
  );
  assert.ok(!keys(withText.warnings).includes("image_heavy"));
  // A countdown's phone twin is the same picture: one image, not two.
  const countdownOnly = mailingChecks(
    base({ html: html(`<img src="https://x.de/cd.gif" alt="Countdown" class="cd-desk"><!--[if !mso]><!--><img src="https://x.de/cd.gif?w=m" alt="Countdown" class="cd-phone"><!--<![endif]--><a href="https://motionsports.de">Zum Shop</a>${footer}`) })
  );
  assert.ok(!keys(countdownOnly.warnings).includes("image_heavy"));
  // So is a picture's phone version (mail-template-render.mjs: the hidden „ph-phone“ wrapper).
  const phoneVersion = mailingChecks(
    base({
      html: html(
        `<a href="https://motionsports.de"><img src="https://x.de/banner.jpg" alt="Black Week" class="ph-desk"></a><!--[if !mso]><!--><div class="ph-phone" style="display: none; max-height: 0; overflow: hidden; mso-hide: all;"><a href="https://motionsports.de"><img src="https://x.de/banner-m.jpg" alt="Black Week"></a></div><!--<![endif]-->${footer}`
      ),
    })
  );
  assert.ok(!keys(phoneVersion.warnings).includes("image_heavy"));
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
  assert.match(r.warnings.find((w) => w.key === "products_sold_out").message, /Gerade ausverkauft: ATX® Hantelbank — fehlt in der Rundmail, wenn es beim Versandstart noch nicht lieferbar ist/);
  assert.match(r.warnings.find((w) => w.key === "products_unknown").message, /alt-handle/);
  assert.match(r.warnings.find((w) => w.key === "products_block_empty").message, /^Ein Produkt-Baustein hat gerade kein lieferbares Produkt/);
  const two = mailingChecks(base({ products: { soldOut: [], unknown: [], emptyBlocks: 2 } }));
  assert.match(two.warnings.find((w) => w.key === "products_block_empty").message, /^2 Produkt-Bausteine/);
  // nothing to say without products
  assert.ok(!keys(mailingChecks(base()).warnings).some((k) => k.startsWith("products_")));
});

test("the web-font stylesheet is no link — many_links counts click targets only", () => {
  const head = '<link href="https://fonts.googleapis.com/css2?family=Oswald:wght@400;700&amp;display=swap" rel="stylesheet">';
  const links = Array.from({ length: 30 }, (_, i) => `<a href="https://motionsports.de/p/${i}">p${i}</a>`).join("");
  assert.ok(!keys(mailingChecks(base({ html: html(head + links) })).warnings).includes("many_links"));
  const more = mailingChecks(base({ html: html(head + links + '<a href="https://motionsports.de/x">x</a>') }));
  assert.match(more.warnings.find((w) => w.key === "many_links").message, /^31 verschiedene Links/);
});

test("the render checks run on their own too (the content rendered again at the send start)", () => {
  const clean = html(`<p>Text</p><img src="https://x.de/a.jpg" alt=""><a href="https://motionsports.de">Shop</a>`);
  assert.deepEqual(renderedMailErrors({ html: clean }), []);
  assert.deepEqual(keys(renderedMailErrors({ html: clean, bytes: MAILING_HTML_HARD_LIMIT + 1 })), ["size"]);
  assert.deepEqual(keys(renderedMailErrors({ html: html('<img src="http://x.de/a.jpg">') })), ["insecure_image"]);
  assert.deepEqual(keys(renderedMailErrors({ html: html('<a href="javascript:alert(1)">x</a>') })), ["bad_link"]);
  // the frozen render: Mo's own placeholders are fine, anything else is not
  assert.deepEqual(renderedMailErrors({ html: clean, frozen: "{{mo:link:0}} {{mo:unsub}} {{mo:fn:0}} {{mo:greet:0}}" }), []);
  const left = renderedMailErrors({ html: clean, frozen: "Hallo {{vorname}} {{mo:link:1}}" });
  assert.deepEqual(keys(left), ["placeholders"]);
  assert.match(left[0].message, /Unbekannte Platzhalter: \{\{vorname\}\}/);
  // the same rules and messages as the full checks
  const full = mailingChecks(base({ html: html('<img src="http://x.de/a.jpg"><a href="data:text/html,x">x</a>') }));
  assert.deepEqual(
    full.errors.filter((e) => e.key === "insecure_image" || e.key === "bad_link"),
    renderedMailErrors({ html: html('<img src="http://x.de/a.jpg"><a href="data:text/html,x">x</a>') })
  );
});

test("an audience that hangs on a Rundmail not sent yet may be empty (a reminder prepared ahead)", () => {
  const empty = mailingChecks(base({ audience: { total: 0, confirmed: 0 } }));
  assert.ok(keys(empty.errors).includes("audience_empty"));
  const pending = mailingChecks(base({ audience: { total: 0, confirmed: 0 }, audiencePending: "Black Friday" }));
  assert.equal(keys(pending.errors).includes("audience_empty"), false);
  assert.equal(pending.ok, true);
  assert.match(pending.warnings.find((w) => w.key === "audience_pending").message, /Rundmail „Black Friday“, die noch nicht fertig versendet ist/);
  assert.match(pending.infos.find((i) => i.key === "reach").message, /an niemanden — die Zielgruppe wird beim Versandstart frisch ermittelt/);
  // with recipients the dependency says nothing
  assert.equal(keys(mailingChecks(base({ audiencePending: "Black Friday" })).warnings).includes("audience_pending"), false);
});
