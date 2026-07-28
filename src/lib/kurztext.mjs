// Parse the merchant's custom.kurztext metafield — the condensed spec sheet
// that the storefront PDP renders as the "Technische Daten" details tab
// ("Marke: ATX Serie: 700 Breite: 2000 mm Höhe: 2300 mm Belastbarkeit:
// Rahmenlast 650 kg", single- or multi-line).
//
// WHY: this text is what the customer sees on the product page, so it is the
// authoritative spec source for Mo. Before this parser existed the kurztext
// was only appended to the END of detailedDescription — and the prompt clips
// that field, so for products with long descriptions the tech data (incl. the
// height the customer can read on the details tab) never reached Mo. Mo then
// fell back to the legacy custom.hoehe metafield (maintained in cm, and not
// always in sync with the kurztext), answering e.g. "225 cm" while the PDP
// says "2300" (mm). Parsing the kurztext into structured spec pairs — and
// preferring its dimension values — makes Mo's answer match the storefront.

const MAX_PAIRS = 30;
const MAX_KEY_LEN = 40;
const MAX_VALUE_LEN = 200;

// A spec key: starts with an uppercase letter (German nouns), 1–3 words,
// immediately followed by ":" and whitespace. Word chars cover umlauts, ß,
// digits and the punctuation seen in real sheets ("Lochung / Raster:",
// "Gewicht ca.:", "J-Cups:").
const KEY_RE = /(^|\s)([A-ZÄÖÜ][\wäöüß()./-]*(?:[ ][\wäöüß()./-]+){0,2}):(?=\s)/g;

/**
 * Parse a German-formatted number: "2.195" (thousands dot) → 2195,
 * "1.234,5" → 1234.5, "2,5" → 2.5, "650" → 650. Returns null when the string
 * doesn't start with a number.
 */
export function parseGermanNumber(s) {
  const m = /^-?[\d.,]+/.exec(String(s ?? "").trim());
  if (!m) return null;
  let num = m[0];
  if (num.includes(",")) {
    // Comma is the decimal separator; any dots are thousands separators.
    num = num.replace(/\./g, "").replace(",", ".");
  } else if (/^-?\d{1,3}(\.\d{3})+$/.test(num)) {
    // Dots in pure thousands groups ("2.195") — strip them.
    num = num.replace(/\./g, "");
  }
  const n = parseFloat(num);
  return Number.isFinite(n) ? n : null;
}

/**
 * Split a kurztext into ordered [key, value] spec pairs. Tolerant of the
 * single-line "Key: Value Key: Value" run-on format as well as one pair per
 * line; junk in → as few pairs as can be safely extracted out.
 *
 * @param {string | null | undefined} text
 * @returns {Array<[string, string]>}
 */
export function parseKurztextSpecs(text) {
  const s = String(text ?? "").trim();
  if (!s) return [];
  const keys = [];
  let m;
  KEY_RE.lastIndex = 0;
  while ((m = KEY_RE.exec(s)) !== null) {
    keys.push({ key: m[2], valueStart: m.index + m[0].length, keyStart: m.index + m[1].length });
  }
  const pairs = [];
  for (let i = 0; i < keys.length && pairs.length < MAX_PAIRS; i++) {
    const end = i + 1 < keys.length ? keys[i + 1].keyStart : s.length;
    const key = keys[i].key.trim();
    let value = s.slice(keys[i].valueStart, end).replace(/\s+/g, " ").trim();
    // Run-on ambiguity ("Marke: ATX Serie: 700"): the scanner reads
    // "ATX Serie" as one key, leaving Marke's value empty. When that happens,
    // the next key's leading words are really THIS pair's value — shift them
    // over and keep only the last word as the next key ("Serie").
    if (!value && i + 1 < keys.length) {
      const nextWords = keys[i + 1].key.trim().split(/\s+/);
      if (nextWords.length > 1) {
        value = nextWords.slice(0, -1).join(" ");
        keys[i + 1].key = nextWords[nextWords.length - 1];
      }
    }
    if (!key || !value) continue;
    if (key.length > MAX_KEY_LEN || value.length > MAX_VALUE_LEN) continue;
    pairs.push([key, value]);
  }
  return pairs;
}

// Exact dimension keys (after lowercasing and stripping an optional "ca."
// suffix). Deliberately tight — "Höhe verstellbar" must NOT be mistaken for
// the product height.
const DIMENSION_KEY_RE = /^(?:produkt-?)?(breite|höhe|hoehe|tiefe|länge|laenge|gewicht)(?:\s*\(?ca\.?\)?)?$/;

// Value → centimeters. Explicit unit wins; without one, anything over 400 is
// assumed to be millimeters (no home/studio equipment is 4 m tall — but ATX
// sheets routinely write bare mm values like "Höhe: 2300").
function toCm(value) {
  const n = parseGermanNumber(value);
  if (n == null || n <= 0) return null;
  const unit = /^-?[\d.,]+\s*(mm|cm|m)\b/i.exec(String(value).trim())?.[1]?.toLowerCase();
  if (unit === "mm") return n / 10;
  if (unit === "m") return n * 100;
  if (unit === "cm") return n;
  return n > 400 ? n / 10 : n;
}

function toKg(value) {
  const n = parseGermanNumber(value);
  if (n == null || n <= 0) return null;
  const unit = /^-?[\d.,]+\s*(kg|g|t)\b/i.exec(String(value).trim())?.[1]?.toLowerCase();
  if (unit === "g") return n / 1000;
  if (unit === "t") return n * 1000;
  return n; // kg or unit-less
}

const round1 = (n) => Math.round(n * 10) / 10;

/**
 * Pull the physical dimensions out of parsed kurztext pairs, normalised to
 * cm / kg. "Tiefe" is preferred over "Länge" for depth when both appear.
 *
 * @param {Array<[string, string]>} pairs
 * @returns {{widthCm: number|null, heightCm: number|null, depthCm: number|null, weightKg: number|null}}
 */
export function extractKurztextDimensions(pairs) {
  const out = { widthCm: null, heightCm: null, depthCm: null, weightKg: null };
  let depthFromTiefe = false;
  for (const [key, value] of pairs ?? []) {
    const m = DIMENSION_KEY_RE.exec(String(key).toLowerCase().trim());
    if (!m) continue;
    const kind = m[1];
    if (kind === "gewicht") {
      if (out.weightKg == null) out.weightKg = toKg(value);
      continue;
    }
    const cm = toCm(value);
    if (cm == null) continue;
    if (kind === "breite") {
      if (out.widthCm == null) out.widthCm = round1(cm);
    } else if (kind === "höhe" || kind === "hoehe") {
      if (out.heightCm == null) out.heightCm = round1(cm);
    } else if (kind === "tiefe") {
      if (!depthFromTiefe) {
        out.depthCm = round1(cm);
        depthFromTiefe = true;
      }
    } else if ((kind === "länge" || kind === "laenge") && !depthFromTiefe) {
      if (out.depthCm == null) out.depthCm = round1(cm);
    }
  }
  return out;
}
