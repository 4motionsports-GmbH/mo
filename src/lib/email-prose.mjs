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
// escaped HERE; only http(s) URLs are ever turned into links.

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
// contain stray inline tags, which are stripped.
const HTML_ANCHOR_RE =
  /<a\s[^>]*?href\s*=\s*(?:"(https?:\/\/[^"]+)"|'(https?:\/\/[^']+)')[^>]*>([\s\S]{0,300}?)<\/a\s*>/gi;

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

/** One escaped, inline-styled email link. Non-http(s) URLs return the escaped
 * label only (never a clickable javascript:/data: link). */
export function emailLinkHtml(url, label, linkStyle = DEFAULT_LINK_STYLE) {
  if (!/^https?:\/\//i.test(url)) return escapeHtml(label);
  return `<a href="${escapeHtml(url)}" target="_blank" style="${escapeHtml(
    linkStyle
  )}">${escapeHtml(label)}</a>`;
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
  // bare-URL pass. Matches are merged by position; overlaps keep the earlier.
  const matches = [];
  for (const m of body.matchAll(MD_LINK_RE)) {
    matches.push({ index: m.index, length: m[0].length, url: m[2], label: m[1].trim() });
  }
  for (const m of body.matchAll(HTML_ANCHOR_RE)) {
    // A quoted href may span lines; URL parsing drops tabs and newlines
    // anyway, and pass 4 must never put a <br> inside an attribute.
    const url = (m[1] ?? m[2]).replace(/[\t\r\n]/g, "");
    matches.push({ index: m.index, length: m[0].length, url, label: stripTags(m[3]).trim() });
  }
  matches.sort((a, b) => a.index - b.index);

  const parts = [];
  let last = 0;
  for (const m of matches) {
    if (m.index < last) continue; // overlap — earlier match already consumed it
    if (m.index > last) parts.push({ text: body.slice(last, m.index) });
    parts.push({ link: { url: m.url, label: m.label || labelForUrl(m.url) || compactUrlLabel(m.url) } });
    last = m.index + m.length;
  }
  if (last < body.length) parts.push({ text: body.slice(last) });

  // Pass 2 — linkify bare URLs inside the remaining text fragments.
  let html = "";
  for (const part of parts) {
    if (part.link) {
      html += emailLinkHtml(part.link.url, part.link.label, linkStyle);
      continue;
    }
    let fragLast = 0;
    for (const m of part.text.matchAll(BARE_URL_RE)) {
      let url = m[0];
      const trimmed = url.replace(TRAILING_PUNCT_RE, "");
      const punct = url.slice(trimmed.length);
      url = trimmed;
      html += escapeHtml(part.text.slice(fragLast, m.index));
      const label = labelForUrl(url) ?? compactUrlLabel(url);
      html += emailLinkHtml(url, label, linkStyle);
      html += escapeHtml(punct);
      fragLast = m.index + m[0].length;
    }
    html += escapeHtml(part.text.slice(fragLast));
  }
  // Pass 3 — markdown bold. Runs on the assembled HTML: everything is already
  // escaped (or a link we built ourselves), so wrapping a span in <strong> is
  // safe, and a bolded link label ("**[Name](url)**") works too.
  // Pass 4 — line breaks to <br>. AFTER the bold pass, whose pattern stops at
  // a line break: "**a\nb**" must not become a bold span across a <br>.
  return html.replace(BOLD_RE, "<strong>$1</strong>").replace(NEWLINE_RE, "<br>");
}

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
    .replace(HTML_ANCHOR_RE, (_all, urlDq, urlSq, label) => {
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
