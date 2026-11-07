import { test } from "node:test";
import assert from "node:assert/strict";
import { lintOutlookHtml, MAIL_SIZE_BUDGET_BYTES } from "./email-outlook.mjs";
import { MAIL_TEMPLATE_STARTERS, normalizeMailTemplateDoc, applyMergeFields } from "./mail-template-doc.mjs";
import {
  MAIL_CARD_WIDTH,
  MAIL_CONTENT_WIDTH,
  renderMailTemplateHtml,
  renderMailTemplateText,
  sanitizeCustomHtml,
  docMoPlacement,
} from "./mail-template-render.mjs";

const assets = {
  logoUrl: "https://cdn.example.com/logo.png",
  shopUrl: "https://www.motionsports.de",
  imprintUrl: "https://motionsports.de/pages/impressum",
  socialLinks: [{ alt: "instagram", icon: "https://cdn.example.com/ig.png", url: "https://instagram.com/x" }],
  aiLabelIconUrl: "https://mo.example.com/eu-ai-icon-email.png",
};
const footer = {
  unsubscribeHtml: '<p style="Margin: 0;" align="center">Abmelden: <a href="https://mo.example.com/api/unsubscribe?token=t">Abmelden</a>.</p>',
  unsubscribeText: "Abmelden: https://mo.example.com/api/unsubscribe?token=t",
};
const base = (extra = {}) => ({ subject: "Black Week", preheader: "Bis zu 30 %", locale: "de", assets, footer, year: 2026, ...extra });

const productSlot = {
  html: `
                <tr>
                  <td class="content-pad" align="center" bgcolor="#ffffff" style="mso-line-height-rule: exactly; padding: 10px 60px 20px;" valign="top"><img src="https://cdn.example.com/p.jpg" width="160" alt="Rack"></td>
                </tr>`,
  text: "- Rack — 499,00 €\n  https://motionsports.de/products/rack",
};

function fullDoc() {
  return normalizeMailTemplateDoc({
    style: { accentColor: "#ffd400", buttonTextColor: "#111111", outerBackground: "#111111", fontFamily: "arial", buttonShape: "square" },
    blocks: [
      { id: "logo", type: "logo" },
      { id: "band", type: "heading", text: "BLACK WEEK", size: "xl", background: "#111111", color: "#ffd400" },
      { id: "img", type: "image", src: "https://cdn.example.com/banner.gif", alt: "Black Week", href: "https://motionsports.de/collections/black-week" },
      { id: "greet", type: "greeting", text: "Hallo {{vorname}},", fallback: "Hallo," },
      { id: "txt", type: "text", text: "Spare **jetzt** auf [Racks](https://motionsports.de/collections/racks).\n\n- Hanteln\n- Bänke" },
      { id: "cp", type: "coupon", code: "BLACKWEEK25", headline: "25 % auf alles", terms: "Gültig bis 30.11." },
      { id: "cd", type: "countdown", until: "2030-11-30T22:59:00Z", heading: "Endet in" },
      { id: "pr", type: "products", title: "Deals", refs: ["rack"] },
      { id: "btn", type: "button", label: "{{vorname|Jetzt}} sparen", href: "https://motionsports.de", fullWidth: true },
      { id: "div", type: "divider" },
      { id: "sp", type: "spacer", height: 16 },
      { id: "so", type: "social" },
      { id: "h", type: "html", html: '<table role="presentation"><tr><td><p style="Margin:0">Eigenes <b>HTML</b></p></td></tr></table><script>alert(1)</script>' },
      { type: "footer", showSocial: true },
    ],
  });
}

test("a full document renders every block, the footer with the unsubscribe link, and passes the Outlook lint", () => {
  const html = renderMailTemplateHtml(fullDoc(), base({ merge: (t) => applyMergeFields(t, { firstName: "anna" }), slots: { pr: productSlot, cd: { html: productSlot.html.replace("p.jpg", "cd.gif"), text: "Endet in 3 Tagen" } } }));
  assert.match(html, /^<!DOCTYPE html>/);
  assert.match(html, /<title>Black Week<\/title>/);
  assert.match(html, /Bis zu 30 %/); // preheader
  assert.match(html, /BLACK WEEK/);
  assert.match(html, /banner\.gif/);
  assert.match(html, /Hallo Anna,/);
  assert.match(html, /<strong>jetzt<\/strong>/);
  assert.match(html, /href="https:\/\/motionsports\.de\/collections\/racks"/);
  assert.match(html, /&#8226;/); // bullet list
  assert.match(html, /BLACKWEEK25/);
  assert.match(html, /https:\/\/motionsports\.de\/discount\/BLACKWEEK25/);
  assert.match(html, /cd\.gif/);
  assert.match(html, /p\.jpg/);
  assert.match(html, /Anna sparen/);
  assert.match(html, /Eigenes <b>HTML<\/b>/);
  assert.doesNotMatch(html, /<script/);
  assert.match(html, /api\/unsubscribe\?token=t/);
  assert.match(html, /Impressum/);
  assert.match(html, /4motionsports GmbH/);
  assert.match(html, new RegExp(`width="${MAIL_CARD_WIDTH}"`));
  assert.deepEqual(lintOutlookHtml(html, { maxImageWidth: MAIL_CARD_WIDTH }), []);
  assert.ok(new TextEncoder().encode(html).length < MAIL_SIZE_BUDGET_BYTES);
});

test("every starter renders lint-clean (with preview placeholders for empty images/slots)", () => {
  for (const s of MAIL_TEMPLATE_STARTERS) {
    const html = renderMailTemplateHtml(s.build(), base({ previewPlaceholders: true }));
    assert.deepEqual(lintOutlookHtml(html, { maxImageWidth: MAIL_CARD_WIDTH }), [], s.key);
  }
});

test("empty images: a grey placeholder only in previews, nothing in a real mail", () => {
  const doc = normalizeMailTemplateDoc({ blocks: [{ type: "image", src: "", alt: "x" }] });
  assert.match(renderMailTemplateHtml(doc, base({ previewPlaceholders: true })), /Bild fehlt/);
  assert.doesNotMatch(renderMailTemplateHtml(doc, base()), /Bild fehlt/);
});

test("content images use the content width, full images the card width", () => {
  const doc = normalizeMailTemplateDoc({
    blocks: [
      { type: "image", src: "https://x.de/a.jpg", alt: "a", width: "content" },
      { type: "image", src: "https://x.de/b.jpg", alt: "b", width: "full" },
    ],
  });
  const html = renderMailTemplateHtml(doc, base());
  assert.match(html, new RegExp(`a\\.jpg" width="${MAIL_CONTENT_WIDTH}"`));
  assert.match(html, new RegExp(`b\\.jpg" width="${MAIL_CARD_WIDTH}"`));
});

test("escaping: no operator text can open a tag or an attribute", () => {
  const doc = normalizeMailTemplateDoc({
    blocks: [
      { type: "heading", text: '<img src=x onerror=alert(1)> "quoted"' },
      { type: "button", label: '"><script>', href: 'https://x.de/?a="b"' },
      { type: "image", src: 'https://x.de/a.jpg?"onload="x', alt: '"><b>' },
    ],
  });
  const html = renderMailTemplateHtml(doc, base());
  assert.doesNotMatch(html, /<img src=x/);
  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /alt=""><b>/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test("Mo blocks place the composer's pieces; unplaced pieces follow Mo's text; nothing is lost", () => {
  const mo = {
    heading: "Deine persönliche Empfehlung",
    bodyHtml: "<p>MO-TEXT</p>",
    moAvatarUrl: null,
    offerRowsHtml: "<tr><td>OFFER</td></tr>",
    promoRowsHtml: "<tr><td>PROMO</td></tr>",
    ctaRowsHtml: "<tr><td>CTA</td></tr>",
    footnoteRowHtml: "",
    postCtaRowsHtml: "",
    preCtaRowsHtml: "<tr><td>OFFER</td></tr><tr><td>PROMO</td></tr>",
  };
  const order = (html) => ["MO-TEXT", "OFFER", "PROMO", "CTA", "Impressum"].map((k) => html.indexOf(k));
  // All three blocks, promo placed BEFORE the offer by the template.
  const placed = normalizeMailTemplateDoc({ blocks: [{ type: "mo_content" }, { type: "mo_promo" }, { type: "text", text: "MID" }, { type: "mo_offer" }] });
  const h1 = renderMailTemplateHtml(placed, base({ mo }));
  assert.ok(h1.indexOf("PROMO") < h1.indexOf("MID") && h1.indexOf("MID") < h1.indexOf("OFFER"));
  assert.equal(h1.split("OFFER").length - 1, 1, "offer exactly once");
  // Only Mo's text: offer, promo and the CTA follow it, in classic order.
  const onlyContent = renderMailTemplateHtml(normalizeMailTemplateDoc({ blocks: [{ type: "mo_content" }, { type: "text", text: "AFTER" }] }), base({ mo }));
  const o = order(onlyContent);
  assert.ok(o.every((v, i) => i === 0 || v > o[i - 1]), String(o));
  assert.ok(onlyContent.indexOf("CTA") < onlyContent.indexOf("AFTER"));
  // No Mo text at all (never selectable, but never lossy): everything before the footer.
  const none = renderMailTemplateHtml(normalizeMailTemplateDoc({ blocks: [{ type: "text", text: "X" }] }), base({ mo }));
  assert.ok(order(none).every((v) => v > 0));
  // A composer without structured pieces (summary, DOI): preCta + CTA after the text.
  const flat = renderMailTemplateHtml(placed, base({ mo: { ...mo, offerRowsHtml: null, promoRowsHtml: null } }));
  assert.equal(flat.split("OFFER").length - 1, 1);
  assert.ok(flat.indexOf("MO-TEXT") < flat.indexOf("OFFER"));
  // The heading of the composer shows unless switched off.
  assert.match(h1, /Deine persönliche Empfehlung/);
  const noHeading = renderMailTemplateHtml(normalizeMailTemplateDoc({ blocks: [{ type: "mo_content", showHeading: false }] }), base({ mo }));
  assert.doesNotMatch(noHeading, /Deine persönliche Empfehlung/);
});

test("hero: the mail's own picture (phone crop preferred) with the EU label when AI, else the block's image", () => {
  const doc = normalizeMailTemplateDoc({ blocks: [{ type: "hero", src: "https://x.de/fallback.jpg", alt: "Szene", showHeadline: true }, { type: "mo_content" }] });
  const ai = renderMailTemplateHtml(doc, base({ hero: { imageUrl: "https://x.de/d.jpg", mobileUrl: "https://x.de/m.jpg", headline: "Dein Setup", isAi: true } }));
  assert.match(ai, /m\.jpg/);
  assert.match(ai, /eu-ai-icon-email\.png/);
  assert.match(ai, /KI-generiertes Bild/);
  assert.match(ai, /Dein Setup/);
  const photo = renderMailTemplateHtml(doc, base({ hero: { imageUrl: "https://x.de/d.jpg", mobileUrl: null, headline: null, isAi: false } }));
  assert.match(photo, /d\.jpg/);
  assert.doesNotMatch(photo, /eu-ai-icon/);
  const fallback = renderMailTemplateHtml(doc, base());
  assert.match(fallback, /fallback\.jpg/);
  assert.doesNotMatch(fallback, /eu-ai-icon/);
});

test("greeting: the name text with a name, the fallback without; freezable per recipient", () => {
  const doc = normalizeMailTemplateDoc({ blocks: [{ type: "greeting", text: "Hallo {{vorname}},", fallback: "Guten Tag," }] });
  assert.match(renderMailTemplateHtml(doc, base({ merge: (t) => applyMergeFields(t, { firstName: "tom" }) })), /Hallo Tom,/);
  assert.match(renderMailTemplateHtml(doc, base({ merge: (t) => applyMergeFields(t, { firstName: null }) })), /Guten Tag,/);
  assert.match(renderMailTemplateHtml(doc, base({ greeting: () => "{{mo:greet:0}}" })), /\{\{mo:greet:0\}\}/);
});

test("text part: headings, prose, buttons, coupon, slots and the legal footer", () => {
  const text = renderMailTemplateText(fullDoc(), base({ merge: (t) => applyMergeFields(t, { firstName: null }), slots: { pr: productSlot } }));
  assert.match(text, /BLACK WEEK/);
  assert.match(text, /Hallo,/);
  assert.match(text, /Racks \(https:\/\/motionsports\.de\/collections\/racks\)/);
  assert.match(text, /Jetzt sparen: https:\/\/motionsports\.de/);
  assert.match(text, /Dein Code: BLACKWEEK25 — 25 % auf alles/);
  assert.match(text, /Code einlösen: https:\/\/motionsports\.de\/discount\/BLACKWEEK25/);
  assert.match(text, /Deals\n- Rack — 499,00 €/);
  assert.match(text, /Eigenes HTML/);
  assert.match(text, /Abmelden: https:\/\/mo\.example\.com\/api\/unsubscribe\?token=t/);
  assert.match(text, /Impressum: https:\/\/motionsports\.de\/pages\/impressum/);
  assert.doesNotMatch(text, /<[a-z]/i);
});

test("sanitizeCustomHtml: removes scripts, handlers, frames, forms, comments and script URLs", () => {
  const dirty =
    '<!--[if mso]><table><![endif]--><p onclick="x()" style="color:red">Hi</p><script>bad()</script>' +
    '<a href="javascript:alert(1)">x</a><a href=\'data:text/html,1\'>y</a><iframe src="https://x"></iframe>' +
    '<form action="https://x"><input name="a"></form><img src="https://x.de/a.png" onerror="z">' +
    '<div style="width: expression(alert(1))">e</div>';
  const clean = sanitizeCustomHtml(dirty);
  for (const bad of ["<!--", "onclick", "<script", "bad()", "javascript:", "data:text", "<iframe", "<form", "<input", "onerror", "expression("]) {
    assert.ok(!clean.includes(bad), bad);
  }
  assert.match(clean, /<p style="color:red">Hi<\/p>/);
  assert.match(clean, /<img src="https:\/\/x\.de\/a\.png">/);
});

test("docMoPlacement reports which Mo blocks a document places", () => {
  assert.deepEqual(docMoPlacement({ blocks: [{ type: "mo_content" }, { type: "mo_offer" }] }), {
    hero: false,
    mo_content: true,
    mo_offer: true,
    mo_promo: false,
  });
});
