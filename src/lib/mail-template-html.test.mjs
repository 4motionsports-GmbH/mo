// The fence around the „Eigenes HTML“ block (mail-template-html.mjs): the
// sanitizer reads tags the way a browser does (quotes, "/" separators,
// comments, raw-text elements), repeats until nothing changes, and the
// report tells validation whether the block would break out of its cell.
import { test } from "node:test";
import assert from "node:assert/strict";
import { customHtmlReport, decodeHtmlEntities, htmlUrls, sanitizeCustomHtml } from "./mail-template-html.mjs";

/** Every attribute name of every tag in the output. */
const attrNames = (html) => [...html.matchAll(/<[a-z][^>]*>/gi)].flatMap((m) => [...m[0].matchAll(/[\s/]([a-z:-]+)\s*=/gi)].map((a) => a[1].toLowerCase()));

test("raw-text and plaintext elements are dropped — they would swallow the rest of the mail, the legal footer included", () => {
  for (const tag of ["xmp", "plaintext", "noembed", "noframes"]) {
    assert.equal(sanitizeCustomHtml(`<p>Vorher</p><${tag}>`), "<p>Vorher</p>", tag);
    assert.equal(sanitizeCustomHtml(`<p>Vorher</p><${tag}><b>weg</b></${tag}><p>Nachher</p>`), "<p>Vorher</p><p>Nachher</p>", tag);
    assert.equal(sanitizeCustomHtml(`<${tag.toUpperCase()} id=x>x`), "x", tag);
  }
  // <listing> renders like <pre>: the tag goes, its content stays
  assert.equal(sanitizeCustomHtml("<listing>Code</listing>"), "Code");
  // the title of a pasted page is no content
  assert.equal(sanitizeCustomHtml("<title>Newsletter</title><p>Hallo</p>"), "<p>Hallo</p>");
});

test("comments: complete, abrupt and bogus ones go; an unterminated one takes the rest of the block with it", () => {
  assert.equal(sanitizeCustomHtml("<p>ok</p><!-- unclosed"), "<p>ok</p>");
  assert.equal(sanitizeCustomHtml("<p>ok</p><!--[if mso]><table><tr><td>"), "<p>ok</p>");
  assert.equal(sanitizeCustomHtml("<p>a</p><!-->b<!--->c<!-- d --!>e"), "<p>a</p>bce");
  assert.equal(sanitizeCustomHtml("<!DOCTYPE html><?xml version='1.0'?><p>x</p></1 bogus>"), "<p>x</p>");
  assert.equal(sanitizeCustomHtml("<!--[if mso]><table><![endif]--><p>x</p><!--[if !mso]><!--><b>y</b><!--<![endif]-->"), "<p>x</p><b>y</b>");
  // a tag that never ends would take the following markup into its attribute
  assert.equal(sanitizeCustomHtml('<p>ok</p><td style="color:red'), "<p>ok</p>");
  assert.equal(sanitizeCustomHtml("<p>ok</p><p title='unclosed>Text"), "<p>ok</p>");
  assert.equal(sanitizeCustomHtml("<p>ok</p><!bogus"), "<p>ok</p>");
});

test("href re-quoting touches only real href attributes of <a> and <area> — never text inside another attribute", () => {
  // the reviewer's inputs: inert attribute text stays inert (v1 left them alone too)
  for (const s of [`<a title="z href='/onclick=alert(1)//'">x</a>`, `<a title="z href=/onclick=alert(1)//">x</a>`, `<p title="a href='b' c">x</p>`, `<div data-x='href=y'>z</div>`]) {
    assert.equal(sanitizeCustomHtml(s), s);
  }
  assert.equal(sanitizeCustomHtml("<area shape=rect href='https://x.de/a'>"), '<area shape=rect href="https://x.de/a">');
  assert.equal(sanitizeCustomHtml("<a class='c' href=https://x.de/?q=\"a\">a</a>"), "<a class='c' href=\"https://x.de/?q=&quot;a&quot;\">a</a>");
  // only the first of duplicate attributes counts (a browser keeps that one)
  assert.equal(sanitizeCustomHtml("<a href='https://x.de/1' href=\"https://evil.example/\">a</a>"), '<a href="https://x.de/1">a</a>');
  // other tags keep their quoting
  assert.equal(sanitizeCustomHtml("<td background='https://x.de/bg.jpg' class=x>t</td>"), "<td background='https://x.de/bg.jpg' class=x>t</td>");
});

test("event handlers go after any separator — whitespace, '/', or right after a quoted value — and so do srcdoc, formaction, xmlns:*", () => {
  const cases = {
    slashToggle: `<details/open/ontoggle="document.title='XSS-'+document.domain"><summary>Mehr</summary>Info</details>`,
    slashOnload: `<img/src="anhang:1"/onload="document.title='XSS'" alt="Bild" width="300">`,
    afterQuote: `<img src="https://x/a.png"onerror="alert(1)">`,
    leadingSlash: "<img/onerror=alert(1) src=x>",
    upper: '<p ONCLICK="x()" OnMouseOver=y style="color:red">Hi</p>',
    frames: '<a srcdoc="<script>x</script>" formaction="https://evil.example" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns="x" href="https://x.de">a</a>',
  };
  assert.equal(sanitizeCustomHtml(cases.slashToggle), "<details open><summary>Mehr</summary>Info</details>");
  assert.equal(sanitizeCustomHtml(cases.slashOnload), '<img src="anhang:1" alt="Bild" width="300">');
  assert.equal(sanitizeCustomHtml(cases.afterQuote), '<img src="https://x/a.png">');
  assert.equal(sanitizeCustomHtml(cases.leadingSlash), "<img src=x>");
  assert.equal(sanitizeCustomHtml(cases.upper), '<p style="color:red">Hi</p>');
  assert.equal(sanitizeCustomHtml(cases.frames), '<a href="https://x.de">a</a>');
  for (const [name, html] of Object.entries(cases)) {
    for (const a of attrNames(sanitizeCustomHtml(html))) assert.ok(!/^(on|srcdoc|formaction|xmlns)/.test(a), `${name}: ${a}`);
  }
  // an unquoted value runs to the next space: "x/onerror=…" is the src, no handler (as in a browser)
  assert.equal(sanitizeCustomHtml("<img src=x/onerror=alert(1)>"), "<img src=x/onerror=alert(1)>");
});

test("script URLs are found behind entities, tabs, line breaks and leading spaces — and become #", () => {
  for (const href of [
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    " javascript:alert(1)",
    "java\tscript:alert(1)",
    "java\nscript:alert(1)",
    "java&#x09;script:alert(1)",
    "java&Tab;script:alert(1)",
    "javascript&colon;alert(1)",
    "jav&#x61;script:alert(1)",
    "&#106;avascript:alert(1)",
    "&#0000106avascript:alert(1)",
    "&#x6A;&#x61;&#x76;&#x61;&#x73;&#x63;&#x72;&#x69;&#x70;&#x74;&#x3A;alert(1)",
    "vbscript:msgbox(1)",
    "data:text/html,<b>x</b>",
  ]) {
    assert.equal(sanitizeCustomHtml(`<a href="${href.replace(/"/g, "&quot;")}">x</a>`), '<a href="#">x</a>', href);
  }
  assert.equal(sanitizeCustomHtml("<a href=data:text/html,xx>x</a>"), '<a href="#">x</a>');
  assert.equal(sanitizeCustomHtml('<a xlink:href="javascript:alert(1)">x</a>'), '<a xlink:href="#">x</a>');
  assert.equal(sanitizeCustomHtml('<td background="javascript:x">t</td>'), '<td background="#">t</td>');
  // ordinary addresses stay as written
  for (const ok of ['<a href="https://motionsports.de/?a=1&amp;b=2">x</a>', '<a href="mailto:info@motionsports.de">x</a>', '<img src="https://cdn.shopify.com/a.png" width="10">']) {
    assert.equal(sanitizeCustomHtml(ok), ok);
  }
});

test("removing a piece never joins its neighbours into new markup — the passes repeat until nothing changes", () => {
  assert.equal(sanitizeCustomHtml("<<script></script>img src=x onerror=alert(1)>"), "<img src=x>");
  assert.equal(sanitizeCustomHtml("<<!-- -->img src=x onerror=alert(1)>"), "<img src=x>");
  assert.equal(sanitizeCustomHtml("<scr<script>ipt>alert(1)</script>"), "ipt>alert(1)");
  assert.equal(sanitizeCustomHtml("<<!---->a href=javascript:alert(1)>x</a>"), '<a href="#">x</a>');
  // Each level of „<“ + a dropped pair only joins into the next level's markup
  // in the following pass. What still changes after the last pass is a
  // crafted input: nothing of it goes into the mail.
  const wrap = (s) => s.replace(/</g, "<<script></script>");
  let crafted = "<img src=x onerror=alert(1)>";
  for (let level = 1; level <= 7; level++) {
    crafted = wrap(crafted);
    const out = sanitizeCustomHtml(crafted);
    assert.doesNotMatch(out, /onerror|<script/i, `level ${level}`);
    assert.equal(out, level <= 6 ? "<img src=x>" : "", `level ${level}`);
  }
  // the result is stable: sanitizing it again changes nothing
  for (const s of ["<<script></script>img src=x onerror=alert(1)>", "<p>a</p><!-- x", "<a href='x'>y</a>", "<img/src=x/onerror=y>"]) {
    const once = sanitizeCustomHtml(s);
    assert.equal(sanitizeCustomHtml(once), once, s);
  }
});

test("remote picture sets, media and embedded content are stripped (no foreign pixel slips past the picture check)", () => {
  assert.equal(sanitizeCustomHtml('<img srcset="https://evil.example/p.gif 1x" alt="x" width="1" height="1">'), '<img alt="x" width="1" height="1">');
  assert.equal(sanitizeCustomHtml('<picture><source srcset="https://evil.example/p2.gif"><img alt="x" width="1"></picture>'), '<img alt="x" width="1">');
  assert.equal(sanitizeCustomHtml('<video poster="https://evil.example/poster.gif" width="1">Kein Video</video>'), "Kein Video");
  assert.equal(sanitizeCustomHtml('<audio src="https://evil.example/a.mp3"><track src="x"></audio>'), "");
  assert.equal(sanitizeCustomHtml('<a href="https://motionsports.de/" ping="https://evil.example/ping">Shop</a>'), '<a href="https://motionsports.de/">Shop</a>');
  assert.equal(sanitizeCustomHtml('<img src="https://x.de/a.png" lowsrc="https://evil.example/l.gif" dynsrc="https://evil.example/d.gif" width="5">'), '<img src="https://x.de/a.png" width="5">');
  assert.equal(sanitizeCustomHtml("<object data=x><p>alt</p></object><embed src=x><applet code=x>a</applet><frameset><frame src=x></frameset><p>ok</p>"), "a<p>ok</p>");
  assert.equal(sanitizeCustomHtml('<bgsound src="https://evil.example/s.wav"><p>x</p>'), "<p>x</p>");
});

test("inline styles with escapes, image sets, expressions or script URLs are dropped whole", () => {
  for (const style of [
    "background-image:url(https://evil\\2e example/p.gif); height:1px",
    "background:url(&quot;https://evil\\2e example/q.gif&quot;)",
    "background:\\75 rl(https://evil.example/u.gif)",
    "color:red; background:&#92;75rl(https://evil.example/u.gif)",
    "background-image:image-set('https://evil.example/is.gif' 1x); height:1px",
    "background-image:-webkit-image-set(url(https://evil.example/w.gif) 1x)",
    "width: expression(alert(1))",
    "width:expr/**/ession(alert(1))",
    "background:url(javascript:alert(1))",
    "behavior: url(x.htc)",
  ]) {
    assert.equal(sanitizeCustomHtml(`<div style="${style}">x</div>`), "<div>x</div>", style);
  }
  // an ordinary style stays exactly as written
  const ok = `<td style="padding: 8px; background-image: url('https://cdn.shopify.com/bg.jpg'); color: #ffffff;">t</td>`;
  assert.equal(sanitizeCustomHtml(ok), ok);
});

test("the elements of v1 still go: scripts, styles, frames, forms, embeds, SVG, MathML, document wrappers", () => {
  const dirty =
    '<html><head><meta charset="utf-8"><base href="https://evil/"><link rel=stylesheet href=https://evil.css><style>p{}</style></head><body>' +
    '<script>bad()</script><iframe src="https://x"></iframe><form action="https://x"><input name="a"><button>b</button></form>' +
    '<svg><script>alert(1)</script></svg><math><mi xlink:href="javascript:alert(1)">x</mi></math><template><p>t</p></template>' +
    "<select><option>o</option></select><textarea><p>t</p></textarea><noscript><img src=x></noscript><p>Inhalt</p></body></html>";
  assert.equal(sanitizeCustomHtml(dirty), "<p>Inhalt</p>");
  // an element without its end tag loses only its tag
  assert.equal(sanitizeCustomHtml("<script>alert(1)"), "alert(1)");
  assert.equal(sanitizeCustomHtml("<form><p>Text</p>"), "<p>Text</p>");
  assert.equal(sanitizeCustomHtml("   <p>x</p>\n"), "<p>x</p>");
  assert.equal(sanitizeCustomHtml(null), "");
});

test("customHtmlReport: the structure as the renderer inserts it — breakouts, open elements, table parts outside their table", () => {
  const fault = (html) => customHtmlReport(html).structure;
  // the reviewer's breakout: closes the mail's cell and tables, hides the rest in a div
  assert.deepEqual(fault('<p>Danke fürs Lesen.</p></td></tr></tbody></table></center></td></tr></tbody></table><div style="display:none">'), { fault: "close", tag: "td" });
  assert.deepEqual(fault('<p>Danke.</p><div style="display:none">'), { fault: "open", tag: "div" });
  assert.deepEqual(fault("<table><tr><td>x</td></tr>"), { fault: "open", tag: "table" });
  assert.deepEqual(fault("<table><tr><td>a<td>b</td></tr></table>"), { fault: "place", tag: "td" });
  assert.deepEqual(fault("<td>neben der Mail</td>"), { fault: "place", tag: "td" });
  assert.deepEqual(fault("<tr><td>x</td></tr>"), { fault: "place", tag: "tr" });
  assert.deepEqual(fault("<div><table><tr><td>x</div></td></tr></table>"), { fault: "close", tag: "div" });
  assert.deepEqual(fault("</center>"), { fault: "close", tag: "center" });
  // balanced: fine (with implied tbody, nested tables, divs and centers, uppercase tags)
  for (const ok of [
    "<p>Nur Text</p>",
    '<table role="presentation" width="100%"><tr><td style="padding: 8px;"><a href="https://www.motionsports.de/">Shop</a></td></tr></table>',
    "<center><div><TABLE><TBODY><TR><TH>a</TH><TD><table><tr><td>b</td></tr></table></TD></TR></TBODY></TABLE></div></center>",
    "<table><thead><tr><th>a</th></tr></thead><tfoot><tr><td>c</td></tr></tfoot></table>",
  ]) {
    assert.equal(fault(ok), null, ok);
  }
  // comments — conditional ones too — are removed before the check: an Outlook-only opener neither counts nor helps
  assert.equal(fault("<!--[if mso]><table><tr><td><![endif]--><p>x</p><!--[if mso]></td></tr></table><![endif]-->"), null);
  assert.deepEqual(fault("<!--[if mso]><table><tr><td><![endif]--><p>x</p></td></tr></table>"), { fault: "close", tag: "td" });
  // what the sanitizer drops with its content does not count
  assert.equal(fault("<template></td></template><p>x</p>"), null);
});

test("customHtmlReport: a whole HTML page is reported (the sanitizer keeps only its content)", () => {
  const page = customHtmlReport('<!DOCTYPE html><html><head><title>T</title><style>p{}</style></head><body><table><tr><td>Inhalt</td></tr></table></body></html>');
  assert.equal(page.documentTags, true);
  assert.equal(page.html, "<table><tr><td>Inhalt</td></tr></table>");
  assert.equal(page.structure, null);
  assert.equal(customHtmlReport("<p>Der <b>body</b> ist hier Text.</p><!-- <body> -->").documentTags, false);
  assert.equal(customHtmlReport("<script>document.write('<body>')</script><p>x</p>").documentTags, false);
});

test("htmlUrls / report.urls: addresses of the sanitized HTML with their references decoded", () => {
  assert.deepEqual(htmlUrls('<a href="https://x.de/?n=&#123;&#123;vorname&#125;&#125;">a</a><img src=\'https://x.de/%7B%7Bvorname%7D%7D.png\'><td background=" https://x.de/bg.jpg ">'), [
    "https://x.de/?n={{vorname}}",
    "https://x.de/%7B%7Bvorname%7D%7D.png",
    "https://x.de/bg.jpg",
  ]);
  assert.deepEqual(customHtmlReport('<img srcset="https://evil.example/a.gif 1x"><a title="href=x" href="https://x.de">a</a>').urls, ["https://x.de"]);
});

test("decodeHtmlEntities: numeric (with or without ;) and the named references the checks need", () => {
  assert.equal(decodeHtmlEntities("&#106;&#x61;&#X76;&#97&colon;&Tab;&NewLine;"), "java:\t\n");
  assert.equal(decodeHtmlEntities("99&euro; &#8364; &#x20AC; 40&percnt; &lcub;&lcub;vorname&rcub;&rcub; &amp &ampx; &unknown; &#0; &#xD800;"), "99€ € € 40% {{vorname}} & &ampx; &unknown; � �");
  assert.equal(decodeHtmlEntities("&colon"), "&colon"); // not a legacy reference: needs its ";"
});
