// Conversation title helpers for the signed-in (tier-3) history list.
//
// Pure, dependency-free, and unit-tested (conversation-title.test.mjs) so the
// LIST endpoint can label every conversation WITHOUT a model call per render:
//   * deriveConversationTitle — the cheap label shown when the customer hasn't
//     renamed a conversation: the first user message, whitespace-collapsed and
//     trimmed to a bounded length, or a neutral fallback when there is no
//     usable user text yet.
//   * sanitizeTitleInput — validates + normalises a RENAME payload (trim,
//     collapse whitespace, bound length, reject empty).
//
// Kept in plain .mjs (not .ts) so it runs under `node --test` with no build
// step, matching the other *-core.mjs / *.mjs pure modules in this folder.

// Longest derived/stored title we keep. Bounds both the cheap label and an
// explicit rename so the list stays compact and a pathological paste can't
// store an unbounded blob on the row.
export const MAX_TITLE_LENGTH = 80;

// Neutral fallback when a conversation has no usable first user message yet
// (e.g. it opened with an assistant greeting and nothing was typed). German,
// matching the customer-facing copy used across the app.
export const FALLBACK_TITLE = "Beratung";

/** Collapse all runs of whitespace (incl. newlines) to single spaces + trim. */
function collapseWhitespace(s) {
  return String(s ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Truncate to at most `max` characters, appending an ellipsis when the input
 * was actually longer. The ellipsis counts toward the budget so the result is
 * never longer than `max`. Tries not to cut mid-word: if there's a space in the
 * last quarter of the budget we break there instead.
 */
function truncate(s, max = MAX_TITLE_LENGTH) {
  if (s.length <= max) return s;
  const hard = s.slice(0, max - 1);
  const lastSpace = hard.lastIndexOf(" ");
  const cut = lastSpace > Math.floor(max * 0.75) ? hard.slice(0, lastSpace) : hard;
  return `${cut.trimEnd()}…`;
}

/**
 * The cheap, deterministic title for a conversation that hasn't been renamed.
 * Takes the first user message text and returns a bounded, single-line label,
 * or FALLBACK_TITLE when there is no usable text. No model call — this is safe
 * to run for every row of the list on every render.
 */
export function deriveConversationTitle(firstUserText, fallback = FALLBACK_TITLE) {
  const cleaned = collapseWhitespace(firstUserText);
  if (!cleaned) return fallback;
  return truncate(cleaned, MAX_TITLE_LENGTH);
}

/**
 * Validate + normalise a customer-supplied title (RENAME). Returns
 *   { ok: true, title }  — trimmed, whitespace-collapsed, length-bounded; or
 *   { ok: false, code }  — 'invalid' (not a string) / 'empty' (blank).
 * The caller maps the code to a 400. We never throw.
 */
export function sanitizeTitleInput(raw) {
  if (typeof raw !== "string") return { ok: false, code: "invalid" };
  const cleaned = collapseWhitespace(raw);
  if (!cleaned) return { ok: false, code: "empty" };
  return { ok: true, title: truncate(cleaned, MAX_TITLE_LENGTH) };
}
