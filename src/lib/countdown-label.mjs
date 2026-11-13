// The free text inside the live countdown picture („Text im Bild“ of a
// template's countdown block, docs/EMAIL_TEMPLATES.md §2, owner 13.11.2026:
// „the timer and in particular the text should also be modifiable“). The
// picture is composed from pre-rendered glyphs (no fonts at request time —
// email-countdown-image.mjs), so a label can only use the upper-case alphabet
// scripts/build-countdown-sprite.mjs renders: this module names it and turns
// what the operator typed into the one canonical spelling the picture draws,
// the image URL carries and its signature covers (email-countdown-token.mjs).
// Pure and tested (countdown-label.test.mjs); kept apart from the sprite
// module so the block format and the editor can use it without loading the
// glyphs.

/** At most this many characters (as typed; the canonical label is cut to it as well). */
export const COUNTDOWN_LABEL_MAX = 32;

/**
 * Every character the picture can draw: A–Z, Ä Ö Ü, 0–9, the space and
 * . , ! ? - : % & / ' « » „ “ — the glyphs of the sprite's label alphabet.
 */
export const COUNTDOWN_LABEL_CHARS = Object.freeze([..."ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÜ0123456789 .,!?-:%&/'«»„“"]);

const DRAWABLE = new Set(COUNTDOWN_LABEL_CHARS);

/** Look-alikes typed for a character of the alphabet (apostrophes, quotes, dashes). */
const ALIASES = Object.freeze({
  "’": "'",
  "‘": "'",
  "‚": "'",
  "´": "'",
  "`": "'",
  "”": "“",
  '"': "“",
  "‟": "“",
  "–": "-",
  "—": "-",
  "‑": "-",
  "−": "-",
  "‹": "«",
  "›": "»",
  "ẞ": "SS",
});

/**
 * One typed character as the picture writes it: upper case, a look-alike as
 * its character of the alphabet, an accented letter as its base letter
 * (É → E — Ä Ö Ü stay), whitespace as a space; "" when it cannot be drawn.
 * @param {string} ch  one code point
 */
function drawable(ch) {
  if (/\s/.test(ch)) return " ";
  let out = "";
  for (const u of ch.toUpperCase()) {
    const c = ALIASES[/** @type {keyof typeof ALIASES} */ (u)] ?? u;
    if ([...c].every((x) => DRAWABLE.has(x))) {
      out += c;
      continue;
    }
    const base = c.normalize("NFD").replace(/\p{M}+/gu, "");
    if (base && [...base].every((x) => DRAWABLE.has(x))) out += base;
    else return "";
  }
  return out;
}

/**
 * The label as the picture draws it — the canonical spelling: upper case
 * („ß“ → „SS“), look-alikes mapped, characters outside the alphabet dropped,
 * spaces collapsed and trimmed, at most COUNTDOWN_LABEL_MAX characters.
 * "" when nothing drawable is left.
 * @param {unknown} raw
 * @returns {string}
 */
export function countdownLabelText(raw) {
  if (typeof raw !== "string") return "";
  let out = "";
  for (const ch of raw.normalize("NFC")) out += drawable(ch);
  return out.replace(/ {2,}/g, " ").trim().slice(0, COUNTDOWN_LABEL_MAX).trim();
}

/**
 * The characters of `raw` the picture cannot draw (they are dropped), each
 * once and as typed — for the editor's warning.
 * @param {unknown} raw
 * @returns {string[]}
 */
export function countdownLabelDropped(raw) {
  if (typeof raw !== "string") return [];
  /** @type {string[]} */
  const out = [];
  for (const ch of raw.normalize("NFC")) if (!drawable(ch) && !out.includes(ch)) out.push(ch);
  return out;
}
