// Prose → email rendering for LLM-written (and admin-edited) email bodies:
// links are always presented as CLICKABLE TEXT, never as a raw pasted URL.
//
// Two link sources are handled:
//   1. Markdown links `[Produktname](https://…)` — what the draft prompts ask
//      the model to write for product recommendations.
//   2. Bare URLs — legacy drafts (written before the markdown instruction) and
//      hand-pasted links. These are linkified too: when the caller can name
//      the URL (catalog product URL → product name) that name becomes the link
//      text; otherwise a compact host/path label is shown.
//
// Plain .mjs (like the other prose/validation cores) so it is unit-testable
// under node --test and importable from client components (the copy path).
//
// SECURITY: the output is email HTML — every text fragment and attribute is
// escaped HERE; only http(s) URLs that parse and carry no user name or
// password are ever turned into links (`https://shop.example'@evil.example/`
// would open evil.example) — the rest is shown as text. proseLinks reports
// exactly the links the renderer makes, so a link check (the KI-Gestalter's,
// mail-template-designer.mjs) reads the same URLs the mail will hold.

/** Default link styling — the brand accent used for CTA buttons
 * (EMAIL_ACCENT_COLOR in email-template.ts). Inline, email-client-safe. */
const DEFAULT_LINK_STYLE =
  "color: #008ccb; text-decoration: underline; word-wrap: break-word;";

// Markdown link: [label](https://url) — label without brackets/newlines, URL
// without whitespace/closing paren (matches what the draft prompts request).
const MD_LINK_RE = /\[([^\]\n]{1,200})\]\((https?:\/\/[^\s()]+)\)/g;

// Literal HTML anchor in the prose: <a href="https://…">label</a>. The prompts
// forbid HTML, but models occasionally emit it anyway (and pre-markdown drafts
// may carry it) — without this pass the tags would escape into visible
// "<a href=…>" tag soup. Only http(s) hrefs match; the label may itself
// contain stray inline tags, which are stripped. Groups: 1 = the attributes
// before `href`, 2 = the `=` with its spaces (both only to locate the URL —
// they do not change what matches), 3 / 4 = the URL in double / single
// quotes, 5 = the label.
const HTML_ANCHOR_RE =
  /<a\s([^>]*?)href(\s*=\s*)(?:"(https?:\/\/[^"]+)"|'(https?:\/\/[^']+)')[^>]*>([\s\S]{0,300}?)<\/a\s*>/gi;

/** Visible text of an HTML fragment (tags dropped, entities kept as-is). */
function stripTags(s) {
  return s.replace(/<[^>]*>/g, "");
}

// Bare URL: stops at whitespace/quotes/brackets; trailing punctuation that is
// almost certainly sentence punctuation (.,;:!?…) is not part of the link.
const BARE_URL_RE = /https?:\/\/[^\s<>()[\]"']+/g;
const TRAILING_PUNCT_RE = /[.,;:!?…]+$/;

// Markdown bold: **text** on one line (first inner char must not be another
// asterisk so "****" never matches). Models emit this despite the plain-text
// instruction — without this pass the asterisks render literally. A lone CR
// counts as a line break too (see NEWLINE_RE).
const BOLD_RE = /\*\*([^\r\n*][^\r\n]*?)\*\*/g;

// Every line-break spelling (CRLF, CR, LF). Outlook for Windows (Word) does
// not support white-space:pre-wrap and collapses raw newlines into spaces, so
// mail HTML carries its line breaks as <br>.
const NEWLINE_RE = /\r\n?|\n/g;

function escapeHtml(s) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Compact human label for a URL nobody could name: host + shortened path,
 * no protocol/www ("motionsports.de/products/laufband-x…"). */
export function compactUrlLabel(url, maxLength = 48) {
  let label = url.replace(/^https?:\/\//, "").replace(/^www\./, "");
  // Drop query/fragment — they never help a human reader.
  label = label.replace(/[?#].*$/, "").replace(/\/+$/, "");
  if (label.length > maxLength) label = `${label.slice(0, maxLength - 1)}…`;
  return label;
}

/**
 * May this URL become a clickable link in a mail? Only an http(s) URL that
 * parses, and never one with a user name or password: in
 * `https://motionsports.de'@evil.example/login` everything before the last
 * „@“ of the address is userinfo, so the link LOOKS like the shop and goes to
 * evil.example. Such a URL is shown as text instead (emailLinkHtml).
 * @param {unknown} url
 * @returns {boolean}
 */
export function isLinkableProseUrl(url) {
  if (typeof url !== "string" || !/^https?:\/\//i.test(url)) return false;
  let u;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  return !u.username && !u.password;
}

/** One escaped, inline-styled email link. A URL that may not be a link
 * (isLinkableProseUrl: not http(s), unparseable, or with a user name or
 * password) returns the escaped label only — never a clickable
 * javascript:/data: link or a disguised host. */
export function emailLinkHtml(url, label, linkStyle = DEFAULT_LINK_STYLE) {
  if (!isLinkableProseUrl(url)) return escapeHtml(label);
  return `<a href="${escapeHtml(url)}" target="_blank" style="${escapeHtml(
    linkStyle
  )}">${escapeHtml(label)}</a>`;
}

/**
 * Split prose into text and explicit links (markdown AND literal HTML
 * anchors), merged by position; overlaps keep the earlier one. The one scan
 * both renderEmailProseHtml and proseLinks use, so a check reads exactly the
 * links the mail will have.
 * @param {string} body
 */
function proseParts(body) {
  const matches = [];
  for (const m of body.matchAll(MD_LINK_RE)) {
    // "[" label "](" url ")"
    const urlStart = m.index + m[1].length + 3;
    matches.push({ kind: "markdown", index: m.index, length: m[0].length, url: m[2], label: m[1].trim(), urlStart, urlEnd: urlStart + m[2].length });
  }
  for (const m of body.matchAll(HTML_ANCHOR_RE)) {
    const raw = m[3] ?? m[4];
    // "<a" + one whitespace + attributes + "href" + "=" with spaces + the quote
    const urlStart = m.index + 3 + m[1].length + 4 + m[2].length + 1;
    // A quoted href may span lines; URL parsing drops tabs and newlines
    // anyway, and pass 4 must never put a <br> inside an attribute.
    matches.push({
      kind: "anchor",
      index: m.index,
      length: m[0].length,
      url: raw.replace(/[\t\r\n]/g, ""),
      label: stripTags(m[5]).trim(),
      urlStart,
      urlEnd: urlStart + raw.length,
    });
  }
  matches.sort((a, b) => a.index - b.index);

  /** @type {Array<{ text: string, offset: number } | { link: (typeof matches)[number] }>} */
  const parts = [];
  let last = 0;
  for (const m of matches) {
    if (m.index < last) continue; // overlap — earlier match already consumed it
    if (m.index > last) parts.push({ text: body.slice(last, m.index), offset: last });
    parts.push({ link: m });
    last = m.index + m.length;
  }
  if (last < body.length) parts.push({ text: body.slice(last), offset: last });
  return parts;
}

/**
 * The bare URLs of a text fragment as pass 2 of renderEmailProseHtml links
 * them: the URL without its trailing sentence punctuation, and where it stands.
 * @param {string} text
 */
function bareUrls(text) {
  const out = [];
  for (const m of text.matchAll(BARE_URL_RE)) {
    const url = m[0].replace(TRAILING_PUNCT_RE, "");
    out.push({ index: m.index, length: m[0].length, url, punct: m[0].slice(url.length) });
  }
  return out;
}

/**
 * Every link renderEmailProseHtml makes of `body`, in order — the same
 * patterns, the same cleaning (an anchor's href without tabs and line breaks,
 * a bare URL without its sentence punctuation) and the same overlap rule:
 *   kind      "markdown" | "anchor" | "bare"
 *   url       the URL as it would be written into the href
 *   label     the visible text of a markdown link or an anchor ("" for a bare URL)
 *   start/end the whole link in `body` (for a bare URL: the URL itself)
 *   urlStart/urlEnd  the URL as written in `body`
 *   linkable  false when emailLinkHtml shows it as text (isLinkableProseUrl)
 * @param {string} body
 * @returns {Array<{ kind: "markdown" | "anchor" | "bare", url: string, label: string, start: number, end: number, urlStart: number, urlEnd: number, linkable: boolean }>}
 */
export function proseLinks(body) {
  const out = [];
  for (const part of proseParts(String(body ?? ""))) {
    if ("link" in part) {
      const l = part.link;
      out.push({ kind: l.kind, url: l.url, label: l.label, start: l.index, end: l.index + l.length, urlStart: l.urlStart, urlEnd: l.urlEnd, linkable: isLinkableProseUrl(l.url) });
      continue;
    }
    for (const b of bareUrls(part.text)) {
      const start = part.offset + b.index;
      const end = start + b.url.length;
      out.push({ kind: "bare", url: b.url, label: "", start, end, urlStart: start, urlEnd: end, linkable: isLinkableProseUrl(b.url) });
    }
  }
  return /** @type {any} */ (out);
}

/**
 * The hrefs renderEmailProseHtml writes for `body` — exactly, in order (what a
 * link check must look at).
 * @param {string} body
 * @returns {string[]}
 */
export function proseLinkUrls(body) {
  return proseLinks(body)
    .filter((l) => l.linkable)
    .map((l) => l.url);
}

/**
 * Render prose to email-body HTML: escape everything, turn markdown links and
 * bare URLs into styled <a> tags, and every line break into <br>. Outlook for
 * Windows (Word) ignores `white-space: pre-wrap` and would run greeting,
 * paragraphs and sign-off together; a <br> renders exactly like the newline
 * it replaces in every other client. Callers keep `white-space: pre-wrap` on
 * the container so runs of spaces survive there. No raw newline is left in
 * the result.
 *
 * @param {string} body
 * @param {object} [opts]
 * @param {(url: string) => string | null} [opts.labelForUrl]  Name a bare URL
 *   (e.g. catalog product URL → product name); null → compact host/path label.
 * @param {string} [opts.linkStyle]  Inline CSS for <a> tags.
 * @returns {string} HTML string (no wrapping element).
 */
export function renderEmailProseHtml(body, opts = {}) {
  // No newline may sit in an attribute: pass 4 would put a <br> inside it.
  const linkStyle = (opts.linkStyle ?? DEFAULT_LINK_STYLE).replace(NEWLINE_RE, " ");
  const labelForUrl = opts.labelForUrl ?? (() => null);

  // Pass 1 — split on explicit links (markdown AND literal HTML anchors) so
  // their URLs/labels are handled as units and never double-processed by the
  // bare-URL pass (proseParts — the same scan proseLinks reports).
  // Pass 2 — linkify bare URLs inside the remaining text fragments.
  let html = "";
  for (const part of proseParts(body)) {
    if ("link" in part) {
      const { url, label } = part.link;
      html += emailLinkHtml(url, label || labelForUrl(url) || compactUrlLabel(url), linkStyle);
      continue;
    }
    let fragLast = 0;
    for (const m of bareUrls(part.text)) {
      html += escapeHtml(part.text.slice(fragLast, m.index));
      const label = labelForUrl(m.url) ?? compactUrlLabel(m.url);
      html += emailLinkHtml(m.url, label, linkStyle);
      html += escapeHtml(m.punct);
      fragLast = m.index + m.length;
    }
    html += escapeHtml(part.text.slice(fragLast));
  }
  // Pass 3 — markdown bold. Runs on the assembled HTML: everything is already
  // escaped (or a link we built ourselves), so wrapping a span in <strong> is
  // safe, and a bolded link label ("**[Name](url)**") works too. The start
  // tags of our links are masked meanwhile (as "<N>" — escaped text never
  // holds a "<"), so asterisks inside an href never pair up and the href stays
  // exactly the URL proseLinks reports.
  // Pass 4 — line breaks to <br>. AFTER the bold pass, whose pattern stops at
  // a line break: "**a\nb**" must not become a bold span across a <br>.
  const tags = [];
  const masked = html.replace(LINK_START_TAG_RE, (tag) => `<${tags.push(tag) - 1}>`);
  return masked
    .replace(BOLD_RE, "<strong>$1</strong>")
    .replace(MASKED_TAG_RE, (_all, i) => tags[Number(i)])
    .replace(NEWLINE_RE, "<br>");
}

/** The start tag of a link emailLinkHtml built (attribute values escaped: no ">" inside). */
const LINK_START_TAG_RE = /<a [^>]*>/g;
const MASKED_TAG_RE = /<(\d+)>/g;

/**
 * Plain text (an operator's typed reply) → mail HTML: everything escaped and
 * every line break a <br> — Outlook for Windows (Word) ignores
 * `white-space: pre-wrap` and would collapse the reply into one paragraph.
 * No links, no markdown: the text shows exactly as typed.
 * @param {string} text
 * @returns {string} HTML string (no wrapping element).
 */
export function plainTextEmailHtml(text) {
  return escapeHtml(String(text ?? "")).replace(NEWLINE_RE, "<br>");
}

/**
 * Convert prose with markdown links (or literal HTML anchors) to the
 * plain-text part / clipboard form: `[Laufband X](https://…)` and
 * `<a href="https://…">Laufband X</a>` both become `Laufband X (https://…)`.
 * Bare URLs stay as they are — a text part must show real URLs.
 */
export function emailProseToText(body) {
  return body
    .replace(MD_LINK_RE, (_all, label, url) => `${label.trim() || url} (${url})`)
    .replace(HTML_ANCHOR_RE, (_all, _attrs, _eq, urlDq, urlSq, label) => {
      const url = urlDq ?? urlSq;
      const text = stripTags(label).trim();
      return `${text || url} (${url})`;
    })
    .replace(BOLD_RE, "$1"); // markdown bold markers never ship in plain text
}

/**
 * Build a labelForUrl lookup from catalog products ({ name, shopifyUrl }):
 * exact URL match, ignoring a trailing slash. Products without a URL are
 * skipped. Returns (url) => name | null.
 */
export function productNameLookup(products) {
  const byUrl = new Map();
  for (const p of products ?? []) {
    const url = typeof p?.shopifyUrl === "string" ? p.shopifyUrl.replace(/\/+$/, "") : "";
    const name = typeof p?.name === "string" ? p.name.trim() : "";
    if (url && name && !byUrl.has(url)) byUrl.set(url, name);
  }
  return (url) => byUrl.get(String(url).replace(/\/+$/, "")) ?? null;
}
