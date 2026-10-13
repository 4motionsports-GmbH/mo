import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAIL_SIZE_BUDGET_BYTES,
  MSO_HTML_ATTRS,
  forOutlook,
  hideFromOutlook,
  lintOutlookHtml,
  msoButton,
  msoHeadHtml,
  msoPaddingAlt,
  msoRule,
  nbsp,
  outlookOnly,
} from "./email-outlook.mjs";

const rules = (html, opts) => lintOutlookHtml(html, opts).map((f) => f.rule);
const doc = (body) =>
  `<!DOCTYPE html><html lang="de" ${MSO_HTML_ATTRS}><head><title>x</title>${msoHeadHtml("Arial, Helvetica, sans-serif")}</head><body>${body}</body></html>`;

test("conditional wrappers", () => {
  assert.equal(outlookOnly("<b>x</b>"), "<!--[if mso]><b>x</b><![endif]-->");
  assert.equal(hideFromOutlook("<b>x</b>"), "<!--[if !mso]><!--><b>x</b><!--<![endif]-->");
  assert.equal(forOutlook("<i>o</i>", "<b>x</b>"), "<!--[if mso]><i>o</i><![endif]--><!--[if !mso]><!--><b>x</b><!--<![endif]-->");
  assert.equal(nbsp("ZUM PRODUKT&nbsp;&#8594;"), "ZUM&nbsp;PRODUKT&nbsp;&#8594;");
});

test("msoHeadHtml: 96 DPI, PNG, table spacing and one font — all inside [if mso]", () => {
  const head = msoHeadHtml("Arial, Helvetica, sans-serif").trim();
  assert.match(head, /^<!--\[if mso\]>/);
  assert.match(head, /<!\[endif\]-->$/);
  assert.match(head, /<o:PixelsPerInch>96<\/o:PixelsPerInch>/);
  assert.match(head, /<o:AllowPNG\/>/);
  assert.match(head, /mso-table-lspace: 0pt/);
  assert.match(head, /font-family: Arial, Helvetica, sans-serif !important/);
  assert.equal(head.indexOf("-->"), head.length - 3, "no '-->' before the end");
  assert.match(MSO_HTML_ATTRS, /xmlns:v="urn:schemas-microsoft-com:vml"/);
  assert.match(MSO_HTML_ATTRS, /xmlns:o="urn:schemas-microsoft-com:office:office"/);
});

test("msoPaddingAlt adds the border to every side of 1–4 values", () => {
  assert.equal(msoPaddingAlt("14px 28px", 3), "17px 31px 17px 31px");
  assert.equal(msoPaddingAlt("13px 24px", 1), "14px 25px 14px 25px");
  assert.equal(msoPaddingAlt("10px"), "10px 10px 10px 10px");
  assert.equal(msoPaddingAlt("1px 2px 3px", 1), "2px 3px 4px 3px");
  assert.equal(msoPaddingAlt("1px 2px 3px 4px", 0), "1px 2px 3px 4px");
  assert.throws(() => msoPaddingAlt("auto"));
});

test("msoButton: the cell carries colour, border and padding; the link only the text", () => {
  const b = msoButton({ hrefAttr: "https://x.de/?a=1&amp;b=2", labelHtml: "ZUM PRODUKT&nbsp;&#8594;", color: "#111111", bg: "#ffffff", border: "1px solid #111111", padding: "10px 15px", fontSize: 11, lineHeight: 13, align: "center", nowrap: true });
  assert.match(b, /^<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center">/);
  assert.match(b, /<td align="center" bgcolor="#ffffff" nowrap style="padding:10px 15px; border:1px solid #111111; background:#ffffff; mso-line-height-rule:exactly; line-height:13px;">/);
  assert.match(b, /<a href="https:\/\/x\.de\/\?a=1&amp;b=2" target="_blank" style="color:#111111; font-family:Arial, Helvetica, sans-serif; font-size:11px; font-weight:bold; text-decoration:none;">/);
  assert.match(b, /<span style="color:#111111;">ZUM&nbsp;PRODUKT&nbsp;&#8594;<\/span>/);
  const full = msoButton({ hrefAttr: "u", labelHtml: "CODE EINLÖSEN", color: "#fff", bg: "#e30613", padding: "14px 24px", fontSize: 13, lineHeight: 15, letterSpacing: "0.2px", fullWidth: true });
  assert.match(full, /border="0" width="100%">/);
  assert.doesNotMatch(full, /<table[^>]*align=/);
  assert.match(full, /letter-spacing:0\.2px;/);
  assert.match(full, />CODE EINLÖSEN</, "no nbsp without nowrap");
  const plain = msoButton({ hrefAttr: "u", labelHtml: "L", color: "#111111", padding: "11px 15px", fontSize: 10, lineHeight: 12 });
  assert.doesNotMatch(plain, /bgcolor|background|border:/);
  assert.doesNotMatch(msoButton({ hrefAttr: "u", labelHtml: "L", color: "#000", padding: "1px", fontSize: 1, lineHeight: 1, align: "left" }), /align="left"/);
});

test("msoRule: a sized coloured cell with exact line height", () => {
  const r = msoRule({ color: "#008ccb", padTop: 10, padBottom: 10 });
  assert.match(r, /<td style="padding:10px 0 10px 0;">/);
  assert.match(r, /<td width="14" height="2" bgcolor="#008ccb" style="width:14px; height:2px; font-size:1px; line-height:2px; mso-line-height-rule:exactly;">&nbsp;<\/td>/);
});

test("lint: a clean document with every intended pattern has no findings", () => {
  const html = doc(`
    <div style="display:none; max-height:0; overflow:hidden; mso-hide:all;">Preheader</div>
    <table><tr><td align="center" bgcolor="#e30613" style="padding:0; mso-padding-alt:14px 25px;"><a href="https://a" style="display:block; padding:13px 24px; mso-padding-alt:0;">GO</a></td></tr></table>
    ${forOutlook(msoButton({ hrefAttr: "https://b", labelHtml: "B", color: "#111", padding: "10px", fontSize: 11, lineHeight: 13 }), `<a href="https://b" style="display:inline-block; padding:10px;">B</a>`)}
    ${hideFromOutlook(`<tr class="hero-mobile-row"><td><img src="m.jpg" width="640" style="display:none;"></td></tr>`)}
    ${forOutlook(msoRule({ color: "#008ccb" }), `<div style="width:14px; height:2px; background:#008ccb;">&nbsp;</div>`)}
    <div style="height:8px; font-size:8px; line-height:8px; mso-line-height-rule:exactly;">&nbsp;</div>
    <p style="Margin:0; Margin-top:8px;">Text</p>
    <p style="white-space: pre-wrap;">Hallo Max,<br><br>wie geht's?</p>
    <img src="p.jpg" width="130" alt="">
    ${hideFromOutlook(`<link href="https://fonts.googleapis.com/css2?family=Montserrat" rel="stylesheet"><style>@import url('https://fonts.googleapis.com/x');</style>`)}
    <!--[if gte mso 9]><v:rect style="width:640px;height:300px;"><v:fill type="frame" src="h.jpg" aspect="atleast" /><v:textbox style="mso-fit-shape-to-text:true" inset="0,0,0,0"><![endif]--><table><tr><td>Hero</td></tr></table><!--[if gte mso 9]></v:textbox></v:rect><![endif]-->`);
  assert.deepEqual(lintOutlookHtml(html, { maxImageWidth: 564 }), []);
});

test("lint: the traps of the 13.10. Outlook report are all caught", () => {
  assert.deepEqual(rules(doc(`<img src="m.jpg" width="640" class="hero-mobile-img" style="width:100%; display:none;">`)), ["hidden-img"]);
  assert.deepEqual(rules(doc(`<div style="display:none; max-height:0;">Preheader</div>`)), ["hidden-element"]);
  assert.deepEqual(rules(doc(`<td><a href="u" style="display:inline-block; padding:10px 15px;">ZUM PRODUKT</a></td>`)), ["padded-link"]);
  assert.deepEqual(rules(doc(`<td bgcolor="#000" style="padding:0;"><a href="u" style="padding:13px 24px;">X</a></td>`)), ["padded-link"]);
  assert.deepEqual(rules(doc(`<p style="Margin:0; padding-top: 8px;">x</p>`)), ["padded-p"]);
  assert.deepEqual(rules(doc(`<span style="display:inline-block; padding:9px 12px; background:#008ccb;">BUNDLE DEAL</span>`)), ["padded-span"]);
  assert.deepEqual(rules(doc(`<div style="width:14px; height:2px; background:#008ccb; margin:10px 0; font-size:0; line-height:0;">&nbsp;</div>`)), ["drawn-div", "spacer-div"]);
  assert.deepEqual(rules(doc(`<div style="height:8px; font-size:0; line-height:0;">&nbsp;</div>`)), ["spacer-div"]);
  assert.deepEqual(rules(doc(`<p style="white-space: pre-wrap;">Hallo Max,\n\nwie geht's?</p>`)), ["raw-newline"]);
  assert.deepEqual(rules(doc(`<img src="a.jpg" style="height:28px; width:auto;" height="28">`)), ["img-width"]);
  assert.deepEqual(rules(doc(`<img src="a.jpg" width="564">`), { maxImageWidth: 480 }), ["img-width"]);
  assert.deepEqual(rules(doc(`<style>@import url('https://fonts.googleapis.com/x');</style>`)), ["web-font"]);
  assert.deepEqual(rules(doc(`<link href="https://fonts.googleapis.com/css2?family=Montserrat" rel="stylesheet">`)), ["web-font"]);
});

test("lint: head, conditional syntax, VML and twins", () => {
  assert.deepEqual(rules(`<!DOCTYPE html><html lang="de"><head></head><body></body></html>`), ["head-namespaces", "head-dpi"]);
  assert.deepEqual(rules(`<p>x</p>`), [], "fragments need no head");
  assert.deepEqual(rules(doc(`<!--[if !mso]><p>x</p><![endif]-->`)), ["conditional-syntax"]);
  assert.deepEqual(rules(doc(`<!--[if !mso]><!--><p>x</p>`)), ["conditional-syntax"]);
  assert.deepEqual(rules(doc(`<p>x</p><!--<![endif]-->`)), ["conditional-syntax"]);
  assert.deepEqual(rules(doc(`<!--[if mso]><table align="left"><tr><td>x</td></tr></table><![endif]-->`)), ["mso-table-align"]);
  assert.deepEqual(rules(doc(`<!--[if gte mso 9]><v:rect><v:fill type="frame" src="h.jpg" /><v:textbox inset="0,0,0,0"><![endif]-->`)), ["vml-fill-aspect", "vml-textbox-fit"]);
  assert.deepEqual(
    rules(doc(forOutlook(`<a href="https://one">A</a>`, `<a href="https://two">A</a>`))),
    ["twin-links"]
  );
  assert.deepEqual(rules(doc(`<!--[if mso]><style>* { font-family: Arial !important; }</style><![endif]-->${hideFromOutlook(`<link href="https://fonts.googleapis.com/x" rel="stylesheet">`)}`)), []);
  // A conditional block that is NOT a twin (the hero's closing VML) followed
  // later by a hidden mobile row is not compared.
  assert.deepEqual(rules(doc(`<!--[if gte mso 9]></v:textbox></v:rect><![endif]--></td></tr>${hideFromOutlook(`<tr><td><a href="https://shop">x</a></td></tr>`)}`)), []);
});

test("lint: nested elements inside a pre-wrap block and the size budget", () => {
  assert.deepEqual(rules(doc(`<div style="white-space:pre-wrap;"><div>a</div>b<br>c</div>\n<p>d\ne</p>`)), []);
  assert.deepEqual(rules(doc(`<div style="white-space:pre-wrap;"><div>a</div>b\nc</div>`)), ["raw-newline"]);
  const big = doc(`<p>${"x".repeat(MAIL_SIZE_BUDGET_BYTES)}</p>`);
  assert.deepEqual(rules(big), ["size"]);
});
