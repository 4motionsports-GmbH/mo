// Pure text preparation for the text-to-speech endpoint (/api/tts).
//
// No I/O — imported by the TTS route AND by its unit tests, so it lives as a
// plain .mjs (like ai-pricing.mjs / email-offer-trigger.mjs) that the
// node:test runner can import directly.
//
// Two jobs, both done server-side regardless of what the widget pre-cleans:
//   1. stripMarkdown — the chat model emits Markdown (**bold**, `code`,
//      [links](url), bullet lists, headings). A TTS engine would otherwise read
//      the asterisks and backticks ALOUD ("star star ..."). The widget also
//      pre-cleans, but the server must never trust that.
//   2. truncateAtSentenceBoundary — a hard server-side cap on characters
//      synthesized (cost + abuse control). We cut at a sentence boundary so the
//      spoken audio ends on a natural pause, and flag truncation to the caller
//      via a response header rather than erroring.

/** Server-side hard cap on characters sent to the TTS provider. */
export const MAX_TTS_CHARS = 2000;

/**
 * Strip Markdown artifacts so nothing is read aloud as punctuation. Best-effort
 * and deliberately conservative: when in doubt it drops the marker and keeps the
 * words. Always returns a string (non-string input → "").
 */
export function stripMarkdown(input) {
  if (typeof input !== "string") return "";
  let s = input.replace(/\r\n?/g, "\n");

  // Fenced code blocks ```lang\n...``` → keep the inner text, drop the fences.
  s = s.replace(/```[^\n]*\n?([\s\S]*?)```/g, (_m, code) => code);
  // Images ![alt](url) → alt; links [label](url) → label; ref links [a][b] → a.
  s = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");
  s = s.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  s = s.replace(/\[([^\]]+)\]\[[^\]]*\]/g, "$1");
  // Inline code `code` → code.
  s = s.replace(/`+([^`]*)`+/g, "$1");
  // Emphasis: ***x***, **x**, *x*, ___x___, __x__, _x_ → x (keep inner text).
  s = s.replace(/(\*\*\*|\*\*|\*|___|__|_)(?=\S)([\s\S]*?\S)\1/g, "$2");
  // Strikethrough ~~x~~ → x.
  s = s.replace(/~~(?=\S)([\s\S]*?\S)~~/g, "$1");
  // Leading block markers: headings (#), blockquotes (>), list bullets (-,*,+),
  // and ordered-list markers (1. / 1)).
  s = s.replace(/^[ \t]*#{1,6}[ \t]+/gm, "");
  s = s.replace(/^[ \t]*>+[ \t]?/gm, "");
  s = s.replace(/^[ \t]*[-*+][ \t]+/gm, "");
  s = s.replace(/^[ \t]*\d+[.)][ \t]+/gm, "");
  // Horizontal rules (---, ***, ___ on their own line).
  s = s.replace(/^[ \t]*([-*_])(?:[ \t]*\1){2,}[ \t]*$/gm, "");

  // Safety net: drop any stray emphasis/code punctuation the structured passes
  // missed, so an unbalanced `*` or backtick is never spoken. Underscores
  // become spaces (so "snake_case" reads as two words, not "underscore").
  s = s.replace(/[*`]/g, "");
  s = s.replace(/(^|\s)#+(?=\s|$)/g, "$1");
  s = s.replace(/_/g, " ");

  // Collapse the whitespace the strips left behind.
  s = s.replace(/[ \t]+/g, " ");
  s = s.replace(/[ \t]*\n[ \t]*/g, "\n");
  s = s.replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

/** Exclusive end index of the last sentence in `s`, or -1 when none is found. */
function lastSentenceEnd(s) {
  let idx = -1;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "." || c === "!" || c === "?" || c === "…") {
      // Pull in any trailing closing quote/bracket so we don't orphan it.
      let end = i + 1;
      while (end < s.length && /["'»)\]]/.test(s[end])) end++;
      idx = end;
    }
  }
  return idx;
}

/**
 * Cap `input` at `maxChars`, cutting at the last sentence boundary that lands in
 * the second half of the budget (so we keep a natural ending without throwing
 * away most of the text). Falls back to the last word boundary, then to a hard
 * slice. Returns { text, truncated }.
 */
export function truncateAtSentenceBoundary(input, maxChars = MAX_TTS_CHARS) {
  const text = typeof input === "string" ? input : "";
  const cap =
    Number.isFinite(maxChars) && maxChars > 0 ? Math.floor(maxChars) : Infinity;
  if (text.length <= cap) return { text, truncated: false };

  const slice = text.slice(0, cap);
  const half = Math.floor(cap / 2);
  const sentEnd = lastSentenceEnd(slice);
  let cut;
  if (sentEnd >= half) {
    cut = slice.slice(0, sentEnd);
  } else {
    const ws = slice.lastIndexOf(" ");
    cut = ws >= half ? slice.slice(0, ws) : slice;
  }
  return { text: cut.trimEnd(), truncated: true };
}

/**
 * Full pipeline the route uses: strip Markdown, then enforce the character cap.
 * Returns { text, truncated, empty }. `empty` is true when nothing speakable
 * remains (the route rejects those with bad_request) — checked AFTER stripping,
 * so a body of only Markdown punctuation counts as empty.
 */
export function prepareTtsText(input, maxChars = MAX_TTS_CHARS) {
  const cleaned = stripMarkdown(input);
  if (!cleaned) return { text: "", truncated: false, empty: true };
  const { text, truncated } = truncateAtSentenceBoundary(cleaned, maxChars);
  const final = text.trim();
  return { text: final, truncated, empty: final.length === 0 };
}
