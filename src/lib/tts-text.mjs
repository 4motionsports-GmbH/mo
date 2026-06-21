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

// ---------------------------------------------------------------------------
// Streaming TTS chunking (item 3 — audio while the chat text streams).
//
// As the SSE chat answer streams in, the widget accumulates the text and feeds
// it through splitIntoTtsChunks(); each returned chunk is fired at /api/tts
// (`stream: true`, incrementing `seq`) so the first audio plays ~1 s after the
// FIRST sentence instead of after the whole answer. This is the CANONICAL,
// unit-tested reference implementation of the boundary logic the streaming-TTS
// contract describes (docs/frontend-handoff/API_CONTRACT.md §8.3) — the widget
// mirrors it so chunk boundaries match what the server expects to synthesize.
//
// Pure logic, no I/O — lives here next to the other TTS text helpers so the
// node:test runner imports it directly and the route can re-export the
// defaults. The route still calls prepareTtsText() on every chunk, so a stray
// short/markup-only chunk is cleaned (and rejected) server-side regardless.

/**
 * Default min/max chunk size (characters) the widget uses when chunking the
 * streamed answer. MIN coalesces tiny fragments ("Ja.") forward so we never
 * fire a request for a word or two; MAX force-cuts an over-long run at a clause
 * boundary so a long opening sentence can't delay the first audio. Both are
 * overridable per call (and documented in the frontend handoff).
 */
export const TTS_CHUNK_MIN_CHARS = 40;
export const TTS_CHUNK_MAX_CHARS = 220;

// Sentence terminators and the closing quotes/brackets that may trail one (so a
// boundary doesn't orphan a closing `"` / `)` / `»`).
const TTS_TERMINATORS = new Set([".", "!", "?", "…"]);
const TTS_CLOSERS = /["'»«)\]”’]/;
// Clause separators used for the over-long-sentence soft cut.
const TTS_CLAUSE_SEPS = ",;:–—";

// Tokens whose trailing "." is an abbreviation, NOT a sentence end (lowercased,
// without the dot). German + common; single letters (initials, "z. B.") are
// handled separately. Missing one only risks an early split that coalescing or
// the flush smooths over — never a crash.
const TTS_ABBREVIATIONS = new Set([
  "z", "b", "bzw", "ca", "d", "h", "etc", "evtl", "ggf", "ggfs", "inkl", "exkl",
  "zzgl", "max", "min", "mind", "nr", "sog", "tel", "u", "v", "vgl", "vs", "usw",
  "geb", "gem", "bspw", "dt", "engl", "frz", "ital", "span", "ehem", "dr",
  "prof", "hr", "fr", "st", "abs", "art", "kap", "f", "ff", "no", "mr", "mrs",
  "ms", "co", "ungef", "urspr", "versch", "zb",
]);

function ttsIsDigit(ch) {
  return ch >= "0" && ch <= "9";
}
function ttsIsLetter(ch) {
  return typeof ch === "string" && /[A-Za-zÀ-ÖØ-öø-ÿ]/.test(ch);
}

/**
 * Exclusive end index of a real boundary that begins at `s[i]` (a terminator or
 * a newline), or -1 when `s[i]` is not a sentence end. Guards against decimals
 * (`3.5`), abbreviations (`z. B.`, `usw.`), single-letter initials (`A.`), and
 * mid-token dots (`google.com`, `v1.2`) by requiring the boundary to be
 * followed by whitespace or end-of-string.
 */
function ttsBoundaryEnd(s, i) {
  const ch = s[i];
  if (ch === "\n") {
    let end = i + 1;
    while (end < s.length && (s[end] === "\n" || s[end] === " " || s[end] === "\t")) end++;
    return end;
  }
  if (!TTS_TERMINATORS.has(ch)) return -1;
  if (ch === ".") {
    // Decimal / thousands separator: a digit on both sides.
    if (ttsIsDigit(s[i - 1]) && ttsIsDigit(s[i + 1])) return -1;
    // Abbreviation or single-letter initial: inspect the alpha run before the dot.
    let j = i - 1;
    let tok = "";
    while (j >= 0 && ttsIsLetter(s[j])) {
      tok = s[j] + tok;
      j--;
    }
    if (tok.length === 1) return -1;
    if (tok && TTS_ABBREVIATIONS.has(tok.toLowerCase())) return -1;
  }
  let end = i + 1;
  while (end < s.length && TTS_TERMINATORS.has(s[end])) end++; // run: "?!", "..."
  while (end < s.length && TTS_CLOSERS.test(s[end])) end++; // trailing closers
  // A terminator inside a token (followed by a non-space char) isn't a sentence
  // end. At end-of-string it's a candidate the caller gates on `flush`.
  if (end < s.length && !/\s/.test(s[end])) return -1;
  return end;
}

/**
 * Best index to cut an over-long run within `s[lo..hi]`: the last clause
 * separator, else the last whitespace, else a hard cut at `hi`. Never returns
 * <= lo, so the caller always makes progress.
 */
function ttsSoftCut(s, lo, hi, minChars) {
  const floor = Math.min(hi, lo + Math.max(1, minChars));
  for (let k = hi; k >= floor; k--) {
    if (TTS_CLAUSE_SEPS.includes(s[k])) return k + 1;
  }
  for (let k = hi; k >= floor; k--) {
    if (/\s/.test(s[k])) return k + 1;
  }
  return hi;
}

function ttsPosInt(v, fallback) {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Split accumulated streamed `text` into complete sentence/clause chunks ready
 * to synthesize, plus the trailing incomplete `rest` to carry into the next
 * delta.
 *
 *   const { chunks, rest } = splitIntoTtsChunks(buffer);
 *   // fire each chunk at POST /api/tts { text, stream: true, seq: seq++ }
 *   buffer = rest;                       // prepend to the next streamed delta
 *   // at stream end: splitIntoTtsChunks(buffer, { flush: true }) drains `rest`
 *
 * Behaviour:
 *  - emits a chunk the moment a sentence terminator (or newline) completes it,
 *    so the first audio starts right after the first sentence;
 *  - coalesces fragments shorter than `minChars` forward (no one-word requests);
 *  - force-cuts a run longer than `maxChars` at a clause/space boundary so a
 *    long opening sentence can't stall the first audio;
 *  - holds the unterminated tail as `rest` (returned untrimmed so the next
 *    delta appends cleanly) until `flush: true`, which emits whatever remains.
 *
 * @param {string} text
 * @param {{ minChars?: number, maxChars?: number, flush?: boolean }} [opts]
 * @returns {{ chunks: string[], rest: string }}
 */
export function splitIntoTtsChunks(text, opts = {}) {
  const minChars = ttsPosInt(opts.minChars, TTS_CHUNK_MIN_CHARS);
  const maxChars = Math.max(minChars, ttsPosInt(opts.maxChars, TTS_CHUNK_MAX_CHARS));
  const flush = opts.flush === true;
  const s = typeof text === "string" ? text.replace(/\r\n?/g, "\n") : "";
  if (!s) return { chunks: [], rest: "" };

  const chunks = [];
  let start = 0; // start of the pending (not-yet-emitted) run
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === "\n" || TTS_TERMINATORS.has(ch)) {
      const end = ttsBoundaryEnd(s, i);
      // A boundary at end-of-buffer is only usable when flushing: otherwise the
      // sentence (or a decimal) might still be streaming, so we wait for more.
      if (end > start && (end < s.length || flush)) {
        const candidate = s.slice(start, end).trim();
        if (candidate.length >= minChars) {
          chunks.push(candidate);
          start = end;
        }
        // else: too short — keep accumulating (coalesce into the next sentence).
        i = end;
        continue;
      }
      if (end >= 0) {
        i = Math.max(i + 1, end);
        continue;
      }
    }
    // Latency guard: a run that has grown past maxChars without a usable
    // boundary is force-cut at the best clause/space break.
    if (i - start >= maxChars) {
      const cutAt = ttsSoftCut(s, start, i, minChars);
      const candidate = s.slice(start, cutAt).trim();
      if (candidate) chunks.push(candidate);
      start = cutAt;
      i = Math.max(cutAt, i + 1);
      continue;
    }
    i++;
  }

  let rest = s.slice(start);
  if (flush) {
    const tail = rest.trim();
    if (tail) chunks.push(tail);
    rest = "";
  }
  return { chunks, rest };
}
