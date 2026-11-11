// E-mail templates („Vorlagen“) — the fence around the „Eigenes HTML“ block.
// Pure and tested (mail-template-html.test.mjs); docs/EMAIL_TEMPLATES.md.
//
// The block's HTML goes raw into a cell of the mail, so it is read the way a
// browser reads it: a small tokenizer that respects quotes, takes "/" and the
// end of a quoted value as attribute separators (the browser does), knows
// comments (also the abrupt and the bogus ones) and the raw-text elements.
// On that token stream:
//   * sanitizeCustomHtml — what the renderer inserts: scripts, styles,
//     frames, forms, embeds, media, document wrappers, comments, event
//     handlers, remote image sets and script URLs removed; links of <a> and
//     <area> double-quoted (the Rundmail link tracking, mailing-core.mjs
//     freezeLinks, rewrites only those). Removing a piece can join its
//     neighbours into new markup ("<<script></script>img …>"), so the passes
//     repeat until nothing changes.
//   * customHtmlReport — what validation needs (mail-template-doc.mjs): the
//     sanitized HTML, whether it closes a table / cell / div it did not open
//     or leaves one open (the block would break out of its cell and could
//     take the legal footer with it), whether the input was a whole HTML page
//     (<html>, <head>, <body>), and the link and picture addresses.
// A fence, not a full sanitizer: every admin preview is a sandboxed iframe,
// and mail clients run no scripts — but the block may come from the
// KI-Gestalter working on third-party mails, so it holds against crafted input.

/** Elements dropped with everything inside them (when they are closed; else only the tag). */
const DROP_WITH_CONTENT = new Set([
  "script",
  "style",
  "iframe",
  "object",
  "form",
  "textarea",
  "select",
  "noscript",
  "template",
  "svg",
  "math",
  "title",
  "xmp",
  "plaintext",
  "noembed",
  "noframes",
]);

/** Elements whose content a browser reads as text up to their end tag (raw text / RCDATA). */
const RAW_TEXT = new Set(["script", "style", "iframe", "textarea", "noscript", "title", "xmp", "plaintext", "noembed", "noframes"]);

/** Elements whose tag is dropped, their content kept (fallback content of media, document wrappers). */
const DROP_TAG = new Set([
  "html",
  "head",
  "body",
  "meta",
  "link",
  "base",
  "input",
  "button",
  "option",
  "optgroup",
  "frame",
  "frameset",
  "applet",
  "embed",
  "param",
  "picture",
  "source",
  "track",
  "video",
  "audio",
  "bgsound",
  "listing",
  "portal",
]);

/** The wrappers of a whole HTML page — validation asks for the content only. */
const DOCUMENT_TAGS = new Set(["html", "head", "body"]);

/** Attributes that never stay: frames' documents, form targets, remote image sets, pings, namespaces. */
const DROP_ATTRS = new Set(["srcdoc", "formaction", "srcset", "imagesrcset", "poster", "ping", "dynsrc", "lowsrc", "xmlns"]);

/** Attributes holding an address (checked for script URLs). */
const URL_ATTRS = new Set([
  "href",
  "src",
  "background",
  "action",
  "xlink:href",
  "data",
  "cite",
  "longdesc",
  "usemap",
  "codebase",
  "archive",
  "classid",
  "manifest",
  "profile",
  "icon",
]);

/** A tag name worth keeping (lower case); "<scr<script>" and other junk are dropped. */
const TAG_NAME_RE = /^[a-z][a-z0-9._:-]*$/;
/** An attribute name worth keeping; names with quotes, "<" or "=" are junk a browser would keep as such. */
const ATTR_NAME_RE = /^[a-z_:][a-z0-9_.:-]*$/;

/** The passes stop when nothing changes; a crafted input that keeps changing yields nothing. */
const MAX_PASSES = 8;

const isWs = (c) => c === " " || c === "\n" || c === "\t" || c === "\f" || c === "\r";
const isAlpha = (c) => (c >= "a" && c <= "z") || (c >= "A" && c <= "Z");

/**
 * One attribute of a tag: its name (lower case), its raw value (entities not
 * decoded; null without "="), how it was quoted, and where its source text
 * starts and ends.
 * @typedef {{ name: string, value: string | null, quote: string, start: number, stop: number }} HtmlAttr
 */

/**
 * One tag as a browser tokenises it.
 * @typedef {{ start: number, stop: number, end: boolean, rawName: string, name: string, attrs: HtmlAttr[], selfClosing: boolean }} HtmlTag
 */

/**
 * The tag starting at `i` (s[i] is "<", then a letter or "/" and a letter):
 * name, attributes and the index after its ">" — or null when it never ends
 * (an open quote or no ">"), in which case it would take everything after
 * it into the tag.
 * @param {string} s
 * @param {number} i
 * @returns {HtmlTag | null}
 */
function readTag(s, i) {
  const n = s.length;
  let j = i + 1;
  const end = s[j] === "/";
  if (end) j++;
  const nameStart = j;
  while (j < n && !isWs(s[j]) && s[j] !== "/" && s[j] !== ">") j++;
  const rawName = s.slice(nameStart, j);
  /** @type {HtmlAttr[]} */
  const attrs = [];
  let selfClosing = false;
  while (j < n) {
    const c = s[j];
    if (isWs(c)) {
      j++;
      continue;
    }
    if (c === ">") return { start: i, stop: j + 1, end, rawName, name: rawName.toLowerCase(), attrs, selfClosing };
    if (c === "/") {
      // "/>" closes the tag; any other "/" only separates attributes
      selfClosing = s[j + 1] === ">";
      j++;
      continue;
    }
    selfClosing = false;
    // the name: up to whitespace, "/", ">" or "=" (its first character may be "=")
    const start = j;
    j++;
    while (j < n && !isWs(s[j]) && s[j] !== "/" && s[j] !== ">" && s[j] !== "=") j++;
    const name = s.slice(start, j).toLowerCase();
    let k = j;
    while (k < n && isWs(s[k])) k++;
    if (s[k] !== "=") {
      attrs.push({ name, value: null, quote: "", start, stop: j });
      j = k;
      continue;
    }
    k++;
    while (k < n && isWs(s[k])) k++;
    if (k >= n) return null;
    const q = s[k];
    if (q === '"' || q === "'") {
      const close = s.indexOf(q, k + 1);
      if (close < 0) return null;
      attrs.push({ name, value: s.slice(k + 1, close), quote: q, start, stop: close + 1 });
      // right after a quoted value the next attribute may follow without a space
      j = close + 1;
      continue;
    }
    if (q === ">") {
      attrs.push({ name, value: "", quote: "", start, stop: k });
      j = k;
      continue;
    }
    let v = k;
    while (v < n && !isWs(s[v]) && s[v] !== ">") v++;
    attrs.push({ name, value: s.slice(k, v), quote: "", start, stop: v });
    j = v;
  }
  return null;
}

/**
 * `(from)` → the next index of `needle` in `s` at or after `from`, or -1 —
 * for a `from` that only grows: every search starts where the last one
 * ended, so a stream of lookups stays linear.
 * @param {string} s
 * @param {string} needle
 */
function nextIndexOf(s, needle) {
  let at = -2; // not searched yet
  let searchedFrom = 0;
  return (/** @type {number} */ from) => {
    // the last answer still holds: no match after where it searched, or its match lies ahead
    if (at !== -2 && from >= searchedFrom && (at === -1 || at >= from)) return at;
    searchedFrom = from;
    at = s.indexOf(needle, from);
    return at;
  };
}

/**
 * Where comments end in `s`: `(i)` → the index after the comment starting
 * at `i` ("<!--"), or -1 when it never ends. A browser ends one at "-->" or
 * "--!>", an abrupt one at once ("<!-->", "<!--->").
 * @param {string} s
 */
function commentEnds(s) {
  const close = nextIndexOf(s, "-->");
  const bang = nextIndexOf(s, "--!>");
  return (/** @type {number} */ i) => {
    if (s.startsWith("<!-->", i)) return i + 5;
    if (s.startsWith("<!--->", i)) return i + 6;
    const a = close(i + 4);
    const b = bang(i + 4);
    if (a < 0 && b < 0) return -1;
    return b < 0 || (a >= 0 && a < b) ? a + 3 : b + 4;
  };
}

/**
 * Finds end tags in `s`: `(from, name)` → where the first end tag of `name`
 * ("</name" + whitespace, "/" or ">") at or after `from` starts, or -1. Each
 * name's end tags are collected once, so a crafted run of unclosed elements
 * costs no rescans.
 * @param {string} s
 * @returns {(from: number, name: string) => number}
 */
function endTagFinder(s) {
  /** @type {Map<string, number[]>} */
  const found = new Map();
  return (from, name) => {
    let list = found.get(name);
    if (!list) {
      list = [...s.matchAll(new RegExp(`</${name}[\\t\\n\\f\\r />]`, "gi"))].map((m) => m.index);
      found.set(name, list);
    }
    let lo = 0;
    let hi = list.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid] < from) lo = mid + 1;
      else hi = mid;
    }
    return lo < list.length ? list[lo] : -1;
  };
}

/**
 * The tokens of an HTML fragment, the way a browser tokenises it:
 *   * text (also a "<" that opens nothing),
 *   * comments — also abrupt ones (<!-->) and bogus ones (<!…>, <?…>, </1…>),
 *   * tags,
 *   * raw — the content of a raw-text element (<script>, <style>,
 *     <textarea>, <xmp> …) up to its end tag; without an end tag none (what
 *     follows is read as markup — the element is dropped anyway),
 *   * broken — a comment or tag that never ends; nothing follows it (it
 *     would swallow whatever comes after the fragment).
 * @param {string} s
 * @param {(from: number, name: string) => number} [endTagAt]  endTagFinder(s), shared with the caller
 * @returns {Generator<{ type: "text" | "comment" | "raw", start: number, end: number } | { type: "tag", tag: HtmlTag } | { type: "broken", start: number }>}
 */
function* htmlTokens(s, endTagAt = endTagFinder(s)) {
  const n = s.length;
  const commentEnd = commentEnds(s);
  let i = 0;
  while (i < n) {
    const lt = s.indexOf("<", i);
    if (lt < 0) {
      yield { type: "text", start: i, end: n };
      return;
    }
    if (lt > i) yield { type: "text", start: i, end: lt };
    i = lt;
    const c1 = s[i + 1] ?? "";
    const c2 = s[i + 2] ?? "";
    if (s.startsWith("<!--", i)) {
      const end = commentEnd(i);
      if (end < 0) {
        yield { type: "broken", start: i };
        return;
      }
      yield { type: "comment", start: i, end };
      i = end;
      continue;
    }
    if (c1 === "/" && c2 === ">") {
      i += 3; // "</>" is nothing
      continue;
    }
    if (c1 === "!" || c1 === "?" || (c1 === "/" && !isAlpha(c2))) {
      const gt = s.indexOf(">", i + 2);
      if (gt < 0) {
        yield { type: "broken", start: i };
        return;
      }
      yield { type: "comment", start: i, end: gt + 1 };
      i = gt + 1;
      continue;
    }
    if (!isAlpha(c1) && c1 !== "/") {
      yield { type: "text", start: i, end: i + 1 };
      i++;
      continue;
    }
    const tag = readTag(s, i);
    if (!tag) {
      yield { type: "broken", start: i };
      return;
    }
    yield { type: "tag", tag };
    i = tag.stop;
    if (!tag.end && RAW_TEXT.has(tag.name)) {
      const close = endTagAt(i, tag.name);
      if (close >= 0) {
        if (close > i) yield { type: "raw", start: i, end: close };
        i = close;
      }
    }
  }
}

// ── entities ─────────────────────────────────────────────────────────────────

/** Named character references worth knowing for the checks (addresses, prices, German text). */
const NAMED_ENTITIES = Object.freeze({
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  Tab: "\t",
  NewLine: "\n",
  colon: ":",
  semi: ";",
  comma: ",",
  period: ".",
  excl: "!",
  quest: "?",
  num: "#",
  percnt: "%",
  dollar: "$",
  equals: "=",
  plus: "+",
  ast: "*",
  midast: "*",
  lowbar: "_",
  sol: "/",
  bsol: "\\",
  lpar: "(",
  rpar: ")",
  lsqb: "[",
  lbrack: "[",
  rsqb: "]",
  rbrack: "]",
  lcub: "{",
  lbrace: "{",
  rcub: "}",
  rbrace: "}",
  verbar: "|",
  vert: "|",
  grave: "`",
  Hat: "^",
  commat: "@",
  euro: "€",
  cent: "¢",
  pound: "£",
  yen: "¥",
  copy: "©",
  reg: "®",
  trade: "™",
  deg: "°",
  middot: "·",
  bull: "•",
  hellip: "…",
  ndash: "–",
  mdash: "—",
  lsquo: "‘",
  rsquo: "’",
  sbquo: "‚",
  ldquo: "“",
  rdquo: "”",
  bdquo: "„",
  laquo: "«",
  raquo: "»",
  shy: "­",
  zwnj: "‌",
  zwj: "‍",
  auml: "ä",
  ouml: "ö",
  uuml: "ü",
  Auml: "Ä",
  Ouml: "Ö",
  Uuml: "Ü",
  szlig: "ß",
  times: "×",
  divide: "÷",
  frac12: "½",
  frac14: "¼",
  frac34: "¾",
  sect: "§",
  para: "¶",
});

/** Legacy references a browser also reads without the closing ";". */
const LEGACY_ENTITIES = new Set(["amp", "lt", "gt", "quot", "nbsp"]);

/**
 * Decode the character references of an HTML text or attribute value:
 * numeric ones (&#106; &#x6a; — with or without ";", any number of digits)
 * and the named ones of NAMED_ENTITIES. For checks only — never for output.
 * @param {string} text
 * @returns {string}
 */
export function decodeHtmlEntities(text) {
  return String(text ?? "").replace(/&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|([A-Za-z][A-Za-z0-9]{0,31}))(;?)/g, (all, dec, hex, name, semi) => {
    if (dec != null || hex != null) {
      const cp = dec != null ? Number(dec) : parseInt(hex, 16);
      return cp > 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff) ? String.fromCodePoint(cp) : "�";
    }
    const value = NAMED_ENTITIES[/** @type {keyof typeof NAMED_ENTITIES} */ (name)];
    if (value == null) return all;
    return semi || LEGACY_ENTITIES.has(name) ? value : all;
  });
}

// ── the sanitizer ────────────────────────────────────────────────────────────

/** Does an address run a script or embed a document (javascript:, vbscript:, data:, file:)? */
function scriptUrl(value) {
  let v = String(value);
  for (let k = 0; k < 3; k++) {
    const d = decodeHtmlEntities(v);
    if (d === v) break;
    v = d;
  }
  // The URL parser drops tabs and line breaks anywhere and leading control characters / spaces.
  v = v.replace(/[\t\n\r]/g, "").replace(/^[\u0000- ]+/, "").toLowerCase();
  return /^(?:javascript|vbscript|data|file):/.test(v);
}

/**
 * Is an inline style unsafe — escapes (\75 rl( = url(), image sets (remote
 * pictures for every resolution), IE expressions and bindings, script URLs?
 * Such a style attribute is dropped whole.
 */
function unsafeStyle(value) {
  const v = decodeHtmlEntities(value).replace(/\/\*[\s\S]*?\*\//g, "");
  return /\\|image-set\s*\(|expression\s*\(|javascript\s*:|vbscript\s*:|behaviou?r\s*:|-moz-binding/i.test(v);
}

/**
 * A tag as it may stay: verbatim when nothing is wrong with it, else rebuilt
 * from its kept attributes (their source text unchanged) — without event
 * handlers and the DROP_ATTRS, without unsafe styles, script URLs replaced by
 * "#", the first of duplicate attributes only (a browser keeps that one), and
 * the href of <a> / <area> double-quoted.
 * @param {string} s
 * @param {HtmlTag} tag
 */
function cleanTag(s, tag) {
  const raw = s.slice(tag.start, tag.stop);
  if (tag.end) return tag.attrs.length ? `</${tag.rawName}>` : raw;
  let changed = false;
  const seen = new Set();
  /** @type {string[]} */
  const kept = [];
  for (const a of tag.attrs) {
    const drop =
      seen.has(a.name) ||
      !ATTR_NAME_RE.test(a.name) ||
      a.name.startsWith("on") ||
      a.name.startsWith("xmlns:") ||
      DROP_ATTRS.has(a.name) ||
      (a.name === "style" && a.value != null && unsafeStyle(a.value));
    seen.add(a.name);
    if (drop) {
      changed = true;
      continue;
    }
    if (a.value != null && URL_ATTRS.has(a.name) && scriptUrl(a.value)) {
      kept.push(`${a.name}="#"`);
      changed = true;
      continue;
    }
    if (a.name === "href" && a.value != null && a.quote !== '"' && (tag.name === "a" || tag.name === "area")) {
      kept.push(`href="${a.value.replace(/"/g, "&quot;")}"`);
      changed = true;
      continue;
    }
    kept.push(s.slice(a.start, a.stop));
  }
  if (!changed) return raw;
  return `<${tag.rawName}${kept.map((k) => ` ${k}`).join("")}${tag.selfClosing ? " /" : ""}>`;
}

/**
 * One pass of the sanitizer. `documentTags`: the input had <html>, <head> or
 * <body> (outside comments and dropped elements).
 * @param {string} s
 */
function sanitizePass(s) {
  let out = "";
  let documentTags = false;
  /** @type {{ name: string, depth: number } | null} an element dropped with its content */
  let drop = null;
  const endTagAt = endTagFinder(s);
  for (const t of htmlTokens(s, endTagAt)) {
    if (t.type === "broken") break; // an unterminated comment / tag would swallow the rest of the mail
    if (t.type === "comment" || t.type === "raw") continue;
    if (t.type === "text") {
      if (!drop) out += s.slice(t.start, t.end);
      continue;
    }
    const tag = t.tag;
    if (drop) {
      if (tag.name === drop.name) drop.depth += tag.end ? -1 : 1;
      if (drop.depth === 0) drop = null;
      continue;
    }
    if (!TAG_NAME_RE.test(tag.name)) continue;
    if (DROP_WITH_CONTENT.has(tag.name)) {
      if (!tag.end && endTagAt(tag.stop, tag.name) >= 0) drop = { name: tag.name, depth: 1 };
      continue;
    }
    if (DROP_TAG.has(tag.name)) {
      if (DOCUMENT_TAGS.has(tag.name)) documentTags = true;
      continue;
    }
    out += cleanTag(s, tag);
  }
  return { out, documentTags };
}

/** The sanitized HTML and whether the input was a whole page (see sanitizePass). */
function sanitize(html) {
  let s = String(html ?? "").replace(/\u0000/g, "");
  let documentTags = false;
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const r = sanitizePass(s);
    documentTags ||= r.documentTags;
    if (r.out === s) return { html: s.trim(), documentTags };
    s = r.out;
  }
  return { html: "", documentTags };
}

/**
 * Strip what has no place in a mail from a custom HTML block: scripts,
 * styles, frames, forms, embeds, media wrappers (<picture>, <video> …),
 * raw-text elements (<xmp>, <plaintext>, <noembed> …), document wrappers,
 * comments (an unbalanced conditional comment would swallow the rest of the
 * mail — an unterminated one, a tag that never ends, everything after it),
 * event handlers (also after "/" or right after a quoted value), srcdoc /
 * formaction / srcset / poster / ping, styles with escapes, image sets or
 * expressions, and script URLs (also behind entities, tabs or line breaks:
 * replaced by "#"). Link targets of <a> / <area> are written double-quoted,
 * the only form the Rundmail link tracking rewrites. Everything else stays as
 * written (no width is invented for an <img>).
 * @param {string} html
 * @returns {string}
 */
export function sanitizeCustomHtml(html) {
  return sanitize(html).html;
}

// ── what validation needs ────────────────────────────────────────────────────

/** The structural elements a block must open and close itself. */
const STRUCTURE = new Set(["table", "tbody", "thead", "tfoot", "tr", "td", "th", "div", "center"]);
/** Where a table part may stand: inside which table part (the nearest open one). */
const TABLE_PARENTS = Object.freeze({
  tbody: ["table"],
  thead: ["table"],
  tfoot: ["table"],
  tr: ["table", "tbody", "thead", "tfoot"],
  td: ["tr"],
  th: ["tr"],
});
const TABLE_PARTS = new Set(["table", "tbody", "thead", "tfoot", "tr", "td", "th"]);

/**
 * The first structural fault of SANITIZED html: a table / table part / div /
 * center closed that the block did not open (`close`), a table part outside
 * its own table (`place` — a <td> would end the mail's cell), or one left
 * open (`open`). Null when every one is opened and closed in order.
 * @param {string} html
 * @returns {{ fault: "close" | "place" | "open", tag: string } | null}
 */
function structureFault(html) {
  /** @type {string[]} */
  const stack = [];
  for (const t of htmlTokens(html)) {
    if (t.type === "broken") break;
    if (t.type !== "tag" || !STRUCTURE.has(t.tag.name)) continue;
    const { name, end } = t.tag;
    if (end) {
      if (stack[stack.length - 1] !== name) return { fault: "close", tag: name };
      stack.pop();
      continue;
    }
    const parents = TABLE_PARENTS[/** @type {keyof typeof TABLE_PARENTS} */ (name)];
    if (parents) {
      let parent = null;
      for (let k = stack.length - 1; k >= 0; k--) {
        if (TABLE_PARTS.has(stack[k])) {
          parent = stack[k];
          break;
        }
      }
      if (!parent || !parents.includes(parent)) return { fault: "place", tag: name };
    }
    stack.push(name);
  }
  return stack.length ? { fault: "open", tag: stack[stack.length - 1] } : null;
}

/**
 * The link and picture addresses of HTML (href, src, background, …), with
 * their character references decoded — in source order.
 * @param {string} html
 * @returns {string[]}
 */
export function htmlUrls(html) {
  const s = String(html ?? "");
  /** @type {string[]} */
  const out = [];
  for (const t of htmlTokens(s)) {
    if (t.type === "broken") break;
    if (t.type !== "tag" || t.tag.end) continue;
    for (const a of t.tag.attrs) if (a.value != null && URL_ATTRS.has(a.name)) out.push(decodeHtmlEntities(a.value).trim());
  }
  return out;
}

/**
 * What validation needs to know about a custom HTML block, judged on the HTML
 * as the renderer inserts it (after sanitizeCustomHtml: comments — the
 * conditional ones too — and dropped elements are gone, so an Outlook-only
 * <table> inside <!--[if mso]> neither counts nor helps):
 *   * `html` — the sanitized HTML,
 *   * `documentTags` — the input was a whole page (<html>, <head>, <body>;
 *     the sanitizer drops them, the block wants the content only),
 *   * `structure` — the first structural fault (structureFault) or null,
 *   * `urls` — the addresses of the sanitized HTML (htmlUrls).
 * @param {string} rawHtml
 */
export function customHtmlReport(rawHtml) {
  const { html, documentTags } = sanitize(rawHtml);
  return { html, documentTags, structure: structureFault(html), urls: htmlUrls(html) };
}
