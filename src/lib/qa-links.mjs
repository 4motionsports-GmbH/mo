// Product links in Q&A answers (pure, no I/O) — the Wissen tab's answer field
// accepts markdown links `[Angezeigter Text](https://…)`, and THIS module turns
// them into storefront-ready HTML so the link reads as clickable text, never as
// a raw pasted URL.
//
// Same link vocabulary as the campaign/marketing emails (email-prose.mjs):
//   1. Markdown links `[Produktname](https://…)` — what the admin UI's
//      "Produkt verlinken" helper inserts and the operator can type by hand.
//   2. Bare http(s) URLs — hand-pasted links are linkified with a compact
//      host/path label so they still render as text.
// Unlike the email renderer the output carries NO inline styles: the anchor is
// plain (`target="_blank" rel="noopener noreferrer"`) so the storefront theme /
// admin preview style it with their own CSS.
//
// Consumers:
//   * qa-core.serializeQaMetafield — writes `a_html`/`a_en_html` next to the
//     raw markdown text into the custom.qa metafield (only for answers that
//     actually contain a link), so the theme renders clickable links without
//     needing a markdown parser in Liquid.
//   * WissenWorkspace (client) — live preview of the rendered answer.
// Mo's prompt context keeps the RAW markdown (`a`): the chat renders markdown
// links natively, so Mo can reuse them verbatim.
//
// SECURITY: every text fragment and attribute is escaped HERE; only http(s)
// URLs ever become links (never javascript:/data:).

import { compactUrlLabel } from "./email-prose.mjs";

// Markdown link: [label](https://url) — label without brackets/newlines, URL
// without whitespace/closing paren (same shape as email-prose.mjs).
const MD_LINK_RE = /\[([^\]\n]{1,200})\]\((https?:\/\/[^\s()]+)\)/g;

// Bare URL: stops at whitespace/quotes/brackets; trailing sentence punctuation
// is not part of the link.
const BARE_URL_RE = /https?:\/\/[^\s<>()[\]"']+/g;
const TRAILING_PUNCT_RE = /[.,;:!?…]+$/;

function escapeHtml(s) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function anchorHtml(url, label) {
  if (!/^https?:\/\//i.test(url)) return escapeHtml(label);
  return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(
    label
  )}</a>`;
}

/**
 * Whether an answer contains anything the HTML rendering would turn into a
 * link — used to keep the metafield lean (no `a_html` for plain-text answers)
 * and to toggle the admin preview.
 * @param {string} answer
 * @returns {boolean}
 */
export function qaAnswerHasLink(answer) {
  const s = typeof answer === "string" ? answer : "";
  MD_LINK_RE.lastIndex = 0;
  BARE_URL_RE.lastIndex = 0;
  return MD_LINK_RE.test(s) || BARE_URL_RE.test(s);
}

/**
 * Render a Q&A answer to storefront-ready HTML: everything escaped, markdown
 * links and bare URLs turned into plain anchors. Newlines are kept as `\n` —
 * the consumer's container decides (CSS `white-space: pre-line` or Liquid
 * `newline_to_br`).
 *
 * @param {string} answer
 * @returns {string} HTML string (no wrapping element).
 */
export function qaAnswerHtml(answer) {
  const body = typeof answer === "string" ? answer : "";

  // Pass 1 — split on markdown links so their URLs are never re-processed by
  // the bare-URL pass.
  const parts = [];
  let last = 0;
  MD_LINK_RE.lastIndex = 0;
  for (const m of body.matchAll(MD_LINK_RE)) {
    if (m.index > last) parts.push({ text: body.slice(last, m.index) });
    parts.push({ link: { url: m[2], label: m[1].trim() || compactUrlLabel(m[2]) } });
    last = m.index + m[0].length;
  }
  if (last < body.length) parts.push({ text: body.slice(last) });

  // Pass 2 — linkify bare URLs inside the remaining text fragments.
  let html = "";
  for (const part of parts) {
    if (part.link) {
      html += anchorHtml(part.link.url, part.link.label);
      continue;
    }
    let fragLast = 0;
    for (const m of part.text.matchAll(BARE_URL_RE)) {
      const trimmed = m[0].replace(TRAILING_PUNCT_RE, "");
      const punct = m[0].slice(trimmed.length);
      html += escapeHtml(part.text.slice(fragLast, m.index));
      html += anchorHtml(trimmed, compactUrlLabel(trimmed));
      html += escapeHtml(punct);
      fragLast = m.index + m[0].length;
    }
    html += escapeHtml(part.text.slice(fragLast));
  }
  return html;
}
