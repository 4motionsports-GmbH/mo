import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAIL_SIZE_BUDGET_BYTES,
  MSO_HTML_ATTRS,
  firstFontFamily,
  forOutlook,
  hideFromOutlook,
  lintOutlookHtml,
  msoButton,
  msoFontClassName,
  msoHeadHtml,
  msoPaddingAlt,
  msoRoundButton,
  msoRule,
  msoTextWidth,
  nbsp,
  outlookOnly,
  windowsFontOf,
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

test("msoHeadHtml without fonts is exactly the classic block (every classic design renders as before)", () => {
  const classic = `
    <!--[if mso]>
    <noscript><xml><o:OfficeDocumentSettings><o:AllowPNG/><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript>
    <style type="text/css">
      table, td, th { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
      * { font-family: Verdana, Geneva, sans-serif !important; }
    </style>
    <![endif]-->`;
  assert.equal(msoHeadHtml("Verdana, Geneva, sans-serif"), classic);
  assert.equal(msoHeadHtml("Verdana, Geneva, sans-serif", { fonts: [] }), classic);
});

test("msoHeadHtml with fonts: a class per own font after the `*` rule, Office fonts with their mso-font-alt first", () => {
  const head = msoHeadHtml("Verdana, Geneva, sans-serif", {
    fonts: [
      { className: "mso-font-oswald", stack: "'Arial Narrow', Arial, sans-serif" },
      { className: "mso-font-playfair", stack: "Georgia, 'Times New Roman', serif" },
    ],
  });
  const at = (s) => head.indexOf(s);
  assert.ok(at("@font-face { font-family: 'Arial Narrow'; mso-font-alt: Arial; mso-generic-font-family: swiss; }") > 0);
  assert.ok(at("@font-face") < at("* { font-family"), "the declaration before its use");
  assert.ok(at("* { font-family: Verdana") < at(".mso-font-oswald { font-family: 'Arial Narrow', Arial, sans-serif !important; }"), "classes after the `*` rule: they win by order and specificity");
  assert.ok(at(".mso-font-playfair { font-family: Georgia, 'Times New Roman', serif !important; }") > 0);
  assert.equal(head.split("@font-face").length - 1, 1, "core Windows fonts need no declaration");
  assert.equal(head.indexOf("-->"), head.length - 3, "one conditional block");
  // an Office font as the body's font gets its fallback too
  assert.match(msoHeadHtml("'Arial Narrow', Arial, sans-serif"), /@font-face \{ font-family: 'Arial Narrow'; mso-font-alt: Arial;/);
  assert.deepEqual(lintOutlookHtml(`<!DOCTYPE html><html ${MSO_HTML_ATTRS}><head>${head}</head><body><p class="mso-font-oswald">x</p></body></html>`), []);
});

test("fonts as Word sees them: first family, the Windows font of a stack, the class name", () => {
  assert.equal(firstFontFamily("'Arial Narrow', Arial, sans-serif"), "Arial Narrow");
  assert.equal(firstFontFamily('"Trebuchet MS", Tahoma !important'), "Trebuchet MS");
  assert.equal(windowsFontOf("'Montserrat', Verdana, Geneva, sans-serif"), "Verdana");
  assert.equal(windowsFontOf("'Oswald', 'Arial Narrow', Arial, sans-serif"), "Arial Narrow");
  assert.equal(windowsFontOf("'Bebas Neue', Impact, 'Arial Narrow', Arial, sans-serif"), "Impact");
  assert.equal(windowsFontOf("'Playfair Display', Georgia, 'Times New Roman', serif"), "Georgia");
  assert.equal(windowsFontOf("'Helvetica Neue', Helvetica, Arial, sans-serif"), "Arial", "Windows maps Helvetica to Arial");
  assert.equal(windowsFontOf("'trebuchet ms', tahoma"), "Trebuchet MS");
  assert.equal(windowsFontOf("'Montserrat', system-ui, Segoe UI, Arial"), null, "a system family first: no fixed expectation");
  assert.equal(windowsFontOf("'Oswald'"), null);
  assert.equal(msoFontClassName("oswald"), "mso-font-oswald");
  assert.equal(msoFontClassName("Open Sans"), "mso-font-open-sans");
});

test("msoTextWidth: a generous width of a bold label in the font Word shows", () => {
  const w = (text, fontStack = "Arial, Helvetica, sans-serif", extra = {}) => msoTextWidth(text, { fontSize: 14, fontStack, ...extra });
  // Arial Bold "Jetzt sparen" is 5.84 em = 81.8 px at 14 px; the estimate is never below it
  assert.ok(w("Jetzt sparen") >= 82 && w("Jetzt sparen") <= 90, String(w("Jetzt sparen")));
  assert.ok(w("Jetzt sparen", "Verdana, Geneva, sans-serif") > w("Jetzt sparen"), "Verdana is wider");
  assert.ok(w("Jetzt sparen", "'Arial Narrow', Arial") < w("Jetzt sparen"), "Arial Narrow is narrower");
  assert.ok(w("Jetzt sparen", "'Unknown Font'") >= w("Jetzt sparen", "Verdana"), "an unknown font counts as wide");
  assert.equal(w("Code einlösen"), w("Code einlosen"), "an umlaut is its letter");
  assert.equal(w("JETZT", undefined, { letterSpacing: 1 }), w("JETZT") + 5);
  assert.ok(w("WWWW") > w("iiii"));
  assert.equal(w(""), 0);
});

test("msoRoundButton: the VML roundrect of a rounded button — size, corners, fill, stroke, label", () => {
  const pill = msoRoundButton({ hrefAttr: "https://x.de/?a=1&amp;b=2", labelHtml: "Jetzt sparen", color: "#111111", fill: "#ffd400", width: 160, height: 50, radius: 200, fontFamily: "Verdana, Geneva, sans-serif", fontSize: 14, letterSpacing: "0.5px" });
  assert.equal(
    pill,
    '<v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="https://x.de/?a=1&amp;b=2" style="height:50px;v-text-anchor:middle;width:160px;" arcsize="50%" stroke="f" fillcolor="#ffd400"><w:anchorlock/><center style="color:#111111;font-family:Verdana, Geneva, sans-serif;font-size:14px;font-weight:bold;letter-spacing:0.5px;">Jetzt&nbsp;sparen</center></v:roundrect>'
  );
  // rounded 8 px; a 2 px stroke sits on the edge: the shape is 2 px smaller, the outer size stays
  const rounded = msoRoundButton({ hrefAttr: "u", labelHtml: "Los", color: "#fff", fill: "#008ccb", border: "#000000", borderPx: 2, width: 100, height: 50, radius: 8, fontFamily: "Arial", fontSize: 14 });
  assert.match(rounded, /style="height:48px;v-text-anchor:middle;width:98px;" arcsize="17%" strokecolor="#000000" strokeweight="2px" fillcolor="#008ccb">/);
  assert.doesNotMatch(rounded, /letter-spacing/);
  // outline: no fill (the colour behind it should Word ignore fill="f")
  const outline = msoRoundButton({ hrefAttr: "u", labelHtml: "Ansehen", color: "#111111", fill: null, border: "#111111", width: 120, height: 41, radius: 200, fontFamily: "Arial", fontSize: 13, backdrop: "#ffffff" });
  assert.match(outline, /strokecolor="#111111" strokeweight="2px" fill="f" fillcolor="#ffffff">/);
  assert.match(outline, /arcsize="50%"/);
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

test("lint: fonts of the Outlook head — a font Word lacks, an Office font without its fallback, an undeclared class", () => {
  const page = (style, body = "<p>x</p>") =>
    `<!DOCTYPE html><html lang="de" ${MSO_HTML_ATTRS}><head><!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><style type="text/css">${style}</style><![endif]--></head><body>${body}</body></html>`;
  assert.deepEqual(rules(page("* { font-family: 'Montserrat', Verdana !important; }")), ["font-word-unsafe"]);
  assert.deepEqual(rules(page("* { font-family: Arial !important; } .mso-font-oswald { font-family: 'Arial Narrow', Arial !important; }")), ["font-word-alt"]);
  assert.deepEqual(rules(page("@font-face { font-family: 'Arial Narrow'; mso-font-alt: Arial; } * { font-family: Arial !important; } .mso-font-oswald { font-family: 'Arial Narrow', Arial !important; }")), []);
  assert.deepEqual(rules(page("* { font-family: Arial !important; }", '<p class="mso-font-bebas">x</p>')), ["font-word-class"]);
  assert.deepEqual(rules(page("* { font-family: Helvetica, Arial !important; }")), [], "Windows maps Helvetica to Arial");
});

test("lint: Word drops a table's vertical margin; centring margins are fine", () => {
  assert.deepEqual(rules(doc(`<table style="direction: ltr; Margin: 0 0 12px;"><tr><td>x</td></tr></table>`)), ["table-margin"]);
  assert.deepEqual(rules(doc(`<table style="margin-top: 8px;"><tr><td>x</td></tr></table>`)), ["table-margin"]);
  assert.deepEqual(rules(doc(`<table style="Margin: 0 auto;"><tr><td>x</td></tr></table><table style="Margin: 0 0 0 auto;"><tr><td>y</td></tr></table><table style="margin: 0px;"><tr><td>z</td></tr></table>`)), []);
  assert.deepEqual(rules(doc(`<p style="Margin: 0 0 12px;">margins on paragraphs work</p>`)), []);
});

test("lint: VML buttons — clickable, sized in px, rounded by arcsize, namespaces declared", () => {
  const vml = (attrs, inner = "<w:anchorlock/><center>Los</center>") =>
    doc(forOutlook(`<v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" ${attrs}>${inner}</v:roundrect>`, `<a href="https://a">Los</a>`));
  assert.deepEqual(rules(vml('href="https://a" style="height:50px;v-text-anchor:middle;width:160px;" arcsize="50%" stroke="f" fillcolor="#008ccb"')), []);
  assert.deepEqual(rules(vml('style="height:50px;width:160px;" arcsize="50%"')), ["vml-roundrect"]);
  assert.deepEqual(rules(vml('href="https://b" style="height:50px;width:160px;" arcsize="50%"')), ["twin-links"], "another link than its original");
  assert.deepEqual(rules(vml('href="https://a" style="height:50px;" arcsize="50%"')), ["vml-roundrect"]);
  assert.deepEqual(rules(vml('href="https://a" style="height:50px;width:160px;"')), ["vml-roundrect"]);
  assert.deepEqual(rules(doc(`<!--[if mso]><v:roundrect href="https://a" style="height:5px;width:9px;" arcsize="5%"><w:anchorlock/><center>x</center><![endif]-->`)), ["vml-roundrect", "vml-roundrect"], "unclosed, and the anchorlock without xmlns:w");
});

test("lint (strict): Word's font and line height of every element as in every other client", () => {
  const head = msoHeadHtml("Verdana, Geneva, sans-serif", { fonts: [{ className: "mso-font-oswald", stack: "'Arial Narrow', Arial, sans-serif" }] });
  const page = (body) => `<!DOCTYPE html><html lang="de" ${MSO_HTML_ATTRS}><head><title>x</title>${head}</head><body>${body}</body></html>`;
  const strict = (html) => lintOutlookHtml(html, { strict: true }).map((f) => f.rule);
  const oswald = "font-family: 'Oswald', 'Arial Narrow', Arial, sans-serif;";
  // a heading in Oswald without its class collapses into the body's Verdana in Word
  assert.deepEqual(strict(page(`<p style="${oswald}">Black Week</p>`)), ["font-word"]);
  assert.deepEqual(strict(page(`<p class="mso-font-oswald" style="${oswald}">Black Week</p>`)), []);
  assert.deepEqual(strict(page(`<p class="mso-font-oswald" style="font-family: 'Montserrat', Verdana, sans-serif;">x</p>`)), ["font-word"], "the wrong class");
  assert.deepEqual(strict(page(`<p style="font-family: 'Montserrat', Verdana, Geneva, sans-serif;">body</p>`)), []);
  assert.deepEqual(strict(page(`<p style="font-family: 'Montserrat', system-ui, Segoe UI;">system</p>`)), [], "no fixed expectation");
  // relative line heights need their px value for Word under the exact rule
  assert.deepEqual(strict(page(`<p style="mso-line-height-rule: exactly; font-size: 14px; line-height: 1.5;">x</p>`)), ["line-height-word"]);
  assert.deepEqual(strict(page(`<p style="mso-line-height-rule: exactly; font-size: 14px; line-height: 150%;">x</p>`)), ["line-height-word"]);
  assert.deepEqual(strict(page(`<p style="mso-line-height-rule: exactly; font-size: 14px; line-height: 1.5; mso-line-height-alt: 21px;">x</p>`)), []);
  assert.deepEqual(strict(page(`<p style="mso-line-height-rule: exactly; font-size: 14px; line-height: 21px;">x</p><td style="mso-line-height-rule: exactly; font-size: 0; line-height: 0;">&nbsp;</td><p style="line-height: 1.5;">no exact rule</p>`)), []);
  // the default lint leaves both to the composers (their pieces are not refined yet)
  assert.deepEqual(rules(page(`<p style="${oswald} mso-line-height-rule: exactly; line-height: 1.5;">x</p>`)), []);
});

test("lint: nested elements inside a pre-wrap block and the size budget", () => {
  assert.deepEqual(rules(doc(`<div style="white-space:pre-wrap;"><div>a</div>b<br>c</div>\n<p>d\ne</p>`)), []);
  assert.deepEqual(rules(doc(`<div style="white-space:pre-wrap;"><div>a</div>b\nc</div>`)), ["raw-newline"]);
  const big = doc(`<p>${"x".repeat(MAIL_SIZE_BUDGET_BYTES)}</p>`);
  assert.deepEqual(rules(big), ["size"]);
});
