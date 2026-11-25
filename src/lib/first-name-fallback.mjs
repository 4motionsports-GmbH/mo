// First-name fallbacks — what a mail says to someone whose first name is not
// known (pure, tested: first-name-fallback.test.mjs). docs/EMAIL_TEMPLATES.md §2.
//
// A greeting block has its text with {{vorname}} („Mit Vornamen“) and its
// fallback („Ohne Vornamen“); {{vorname|Ersatz}} in any text, heading, button
// or the subject carries a fallback of its own. Everyone whose first name is
// not known reads the fallback — above all the newsletter-only subscribers
// (an e-mail address, nothing else). 25.11.2026: a Black Friday Rundmail
// went out with a person's name in its fallback, so every newsletter-only
// recipient was greeted as „Lucas“. Hence:
//
//   * firstNameFallbacks(subject, doc) — every fallback a mail would use,
//     where it stands (the release checks show them and test them);
//     fallbacksOfMerges(merges) — the same for a released (frozen) Rundmail.
//   * fallbackNameWords(fallbacks) — the words of the fallbacks that could be
//     a first name (letters, not a greeting word). The I/O looks them up among
//     the customers' first names (knownFirstNames, customer-store.ts): a word
//     somebody is called is a name, and a name never belongs in a fallback.
//   * stripNames(text, names) / neutralizeMerges(merges, names) — the
//     fallbacks with those names taken out („Hallo Lucas,“ → „Hallo,“): the
//     send-time safety net for a mail released before the check existed;
//     neutralizeDoc(doc, names) the same for a Vorlage that designs the
//     personal mails of a Kampagne.

import { MERGE_FIELD_RE, MERGE_FIELDS, applyMergeFields, walkMailBlocks } from "./mail-template-doc.mjs";

/**
 * Words a fallback may hold that are never taken for a name, even when a
 * customer happens to be called that way (lower case): greetings, the
 * neutral forms of address, the words around them.
 */
const NEVER_A_NAME = new Set(
  [
    "hallo", "hi", "hey", "hello", "servus", "moin", "moinsen", "grüezi", "grüß", "gott", "guten", "tag", "morgen",
    "abend", "willkommen", "welcome", "dear", "liebe", "lieber", "liebes", "ihr", "du", "sie", "dich", "dir", "euch",
    "alle", "zusammen", "leute", "team", "freund", "freundin", "freunde", "sportfreund", "sportfreundin",
    "sportsfreund", "sportsfreundin", "fitness", "fan", "fans", "kunde", "kundin", "kunden", "athlet", "athletin",
    "champion", "black", "week", "friday", "cyber", "monday", "deal", "deals", "sale", "motion", "sports", "mo",
  ].map((w) => w.normalize("NFC"))
);

/**
 * Salutations that only make sense with a name after them (lower case): a
 * fallback left with nothing else („Lieber,“) becomes the neutral greeting.
 */
const NEEDS_A_NAME = new Set(["liebe", "lieber", "liebes", "dear", "sehr", "geehrte", "geehrter"]);

/** The neutral greeting of a language. @param {unknown} language */
export const neutralGreetingFor = (language) => (language === "en" ? "Hi," : "Hallo,");

/** A word of a fallback: letters, then letters, apostrophes or hyphens. */
const WORD_RE = /\p{L}[\p{L}'’-]*/gu;

/**
 * @typedef {{ where: string, fallback: string, text?: string, reads?: string }} FirstNameFallback
 *   `where`: „Betreff“, „Anrede“ or the block it stands in; `text`: the
 *   greeting's text with {{vorname}} (greetings only); `reads`: the line
 *   someone without a known first name reads there (namelessReading)
 */

/** The longest reading the release checks show. */
const READING_MAX = 90;

/**
 * What someone without a known first name reads in a text: the sentence of
 * its first {{vorname}}, the fallbacks filled in and tidied
 * („{{vorname|Hey}}, die Black Week ist da“ → „Hey, die Black Week ist da“;
 * „{{vorname}}, die …“ → „Die …“), tags out, at most READING_MAX characters
 * („…“ where it is cut).
 * @param {unknown} text
 * @returns {string}
 */
export function namelessReading(text) {
  const s = String(text ?? "");
  const at = s.search(new RegExp(MERGE_FIELD_RE.source));
  let start = 0;
  if (at > 0) for (const m of s.slice(0, at).matchAll(/[.!?…]["“”»«)]?\s+|\n+/g)) start = (m.index ?? 0) + m[0].length;
  const read = applyMergeFields(s.slice(start), { firstName: null })
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const cut = read.length > READING_MAX ? `${read.slice(0, READING_MAX - 1).replace(/\s+\S*$/, "")} …` : read;
  return start > 0 && cut ? `… ${cut}` : cut;
}

/** The {{vorname|…}} fallbacks of one text, in order. @param {unknown} text */
function mergeFallbacksOf(text) {
  /** @type {string[]} */
  const out = [];
  for (const m of String(text ?? "").matchAll(MERGE_FIELD_RE)) {
    if (MERGE_FIELDS.includes(String(m[1]).toLowerCase())) out.push((m[2] ?? "").trim());
  }
  return out;
}

/** Every string inside a value (a block's fields, nested). @param {unknown} v @param {string[]} out */
function stringsOf(v, out = []) {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) for (const x of v) stringsOf(x, out);
  else if (v && typeof v === "object") for (const x of Object.values(v)) stringsOf(x, out);
  return out;
}

const BLOCK_LABELS = /** @type {Record<string, string>} */ ({
  heading: "Überschrift",
  text: "Text",
  button: "Button",
  hero: "Titelbild",
  image: "Bild",
  coupon: "Gutschein-Code",
  countdown: "Countdown",
  html: "Eigenes HTML",
  menu: "Navigation",
  footer: "Fußzeile",
});

/**
 * Every first-name fallback a mail would use: the greeting blocks (their
 * „Ohne Vornamen“, with the text), each {{vorname}} / {{vorname|…}} in the
 * subject and in any field of any block (the blocks inside the columns of a
 * section included). A {{vorname}} without „|…“ falls back to "" (nothing).
 * @param {unknown} subject
 * @param {{ blocks?: unknown } | null | undefined} doc  a normalised document
 * @returns {FirstNameFallback[]}
 */
export function firstNameFallbacks(subject, doc) {
  /** @type {FirstNameFallback[]} */
  const out = [];
  for (const fallback of mergeFallbacksOf(subject)) out.push({ where: "Betreff", fallback, reads: namelessReading(subject) });
  for (const { block } of walkMailBlocks(doc)) {
    const b = /** @type {Record<string, unknown>} */ (block);
    if (b.type === "section") continue;
    if (b.type === "greeting") {
      out.push({ where: "Anrede", text: String(b.text ?? ""), fallback: String(b.fallback ?? "") });
      continue;
    }
    const where = BLOCK_LABELS[String(b.type)] ?? "Baustein";
    for (const s of stringsOf(b)) for (const fallback of mergeFallbacksOf(s)) out.push({ where, fallback, reads: namelessReading(s) });
  }
  return out;
}

/**
 * The fallbacks of a released Rundmail (campaign_mailings.merges).
 * @param {{ body?: Array<{ fallback: string }>, greetings?: Array<{ text: string, fallback: string }>, subject?: Array<{ fallback: string }> } | null | undefined} merges
 * @returns {FirstNameFallback[]}
 */
export function fallbacksOfMerges(merges) {
  const m = merges ?? {};
  return [
    ...(m.subject ?? []).map((x) => ({ where: "Betreff", fallback: String(x?.fallback ?? "") })),
    ...(m.greetings ?? []).map((x) => ({ where: "Anrede", text: String(x?.text ?? ""), fallback: String(x?.fallback ?? "") })),
    ...(m.body ?? []).map((x) => ({ where: "Text", fallback: String(x?.fallback ?? "") })),
  ];
}

/**
 * The words of the fallbacks that could be a first name, lower case, each
 * once: written with a capital letter, two letters at least, not a greeting
 * word (NEVER_A_NAME). The I/O keeps those a customer is called.
 * @param {ReadonlyArray<{ fallback: string }>} fallbacks
 * @returns {string[]}
 */
export function fallbackNameWords(fallbacks) {
  const out = new Set();
  for (const f of fallbacks) {
    for (const m of String(f.fallback ?? "").normalize("NFC").matchAll(WORD_RE)) {
      const word = m[0].replace(/['’-]+$/, "");
      if (word.length < 2 || word[0] === word[0].toLowerCase()) continue;
      const lower = word.toLowerCase();
      if (!NEVER_A_NAME.has(lower)) out.add(lower);
    }
  }
  return [...out];
}

/**
 * The names of a fallback (the words `names` holds, lower case), in order.
 * @param {string} text
 * @param {ReadonlySet<string> | ReadonlyArray<string>} names
 */
export function namesIn(text, names) {
  const set = names instanceof Set ? names : new Set(names);
  /** @type {string[]} */
  const out = [];
  for (const m of String(text ?? "").normalize("NFC").matchAll(WORD_RE)) {
    const word = m[0].replace(/['’-]+$/, "");
    if (set.has(word.toLowerCase()) && !out.includes(word)) out.push(word);
  }
  return out;
}

/**
 * A text without the names `names` holds — „Hallo Lucas,“ → „Hallo,“,
 * „Lucas“ → "", „Lucas, schön dass du da bist“ → „schön dass du da bist“.
 * Spaces before punctuation and doubled spaces go too.
 * @param {string} text
 * @param {ReadonlySet<string> | ReadonlyArray<string>} names
 */
export function stripNames(text, names) {
  const set = names instanceof Set ? names : new Set(names);
  const s = String(text ?? "")
    .normalize("NFC")
    .replace(WORD_RE, (w) => (set.has(w.replace(/['’-]+$/, "").toLowerCase()) ? "" : w));
  return s
    .replace(/\s+([,.!?:;…])/g, "$1")
    .replace(/([,.!?:;])\1+/g, "$1")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s,;:]+/, "")
    .trim();
}

/** Words left that stand on their own (not only „Lieber“, „Dear“ …)? @param {string} s */
const standsAlone = (s) => [...s.normalize("NFC").matchAll(WORD_RE)].some((m) => !NEEDS_A_NAME.has(m[0].toLowerCase()));

/**
 * A greeting's neutral fallback: its own without the names; when nothing
 * that stands alone is left, the greeting text without {{vorname}} („Hallo
 * {{vorname}},“ → „Hallo,“); else the neutral greeting („Hallo,“ / „Hi,“).
 * @param {{ text?: string, fallback: string }} g
 * @param {ReadonlySet<string>} names
 * @param {string} neutral
 */
function neutralGreeting(g, names, neutral) {
  const own = stripNames(g.fallback, names);
  if (standsAlone(own)) return own;
  const fromText = stripNames(String(g.text ?? "").replace(MERGE_FIELD_RE, ""), names);
  return standsAlone(fromText) ? fromText : neutral;
}

/**
 * The merges of a released Rundmail with every name taken out of the
 * fallbacks — the send-time safety net. `changed` lists what was replaced
 * (for the report); the merges come back as they were when nothing was.
 * @template {{ body?: Array<{ fallback: string }>, greetings?: Array<{ text: string, fallback: string }>, subject?: Array<{ fallback: string }> }} M
 * @param {M} merges
 * @param {ReadonlyArray<string>} names  lower case
 * @param {{ language?: string }} [opts]  the mail's language (the neutral greeting)
 * @returns {{ merges: M, changed: Array<{ where: string, from: string, to: string }> }}
 */
export function neutralizeMerges(merges, names, opts = {}) {
  const neutral = neutralGreetingFor(opts.language);
  const set = new Set(names.map((n) => n.toLowerCase()));
  /** @type {Array<{ where: string, from: string, to: string }>} */
  const changed = [];
  if (set.size === 0 || !merges) return { merges, changed };
  /** @param {string} where @param {string} from @param {string} to */
  const fix = (where, from, to) => {
    if (from !== to) changed.push({ where, from, to });
    return to;
  };
  const subject = merges.subject?.map((x) =>
    namesIn(x.fallback, set).length ? { ...x, fallback: fix("Betreff", x.fallback, stripNames(x.fallback, set)) } : x
  );
  const greetings = merges.greetings?.map((g) =>
    namesIn(g.fallback, set).length ? { ...g, fallback: fix("Anrede", g.fallback, neutralGreeting(g, set, neutral)) } : g
  );
  const body = merges.body?.map((x) =>
    namesIn(x.fallback, set).length ? { ...x, fallback: fix("Text", x.fallback, stripNames(x.fallback, set)) } : x
  );
  if (changed.length === 0) return { merges, changed };
  const out = /** @type {M} */ ({
    ...merges,
    ...(subject ? { subject } : {}),
    ...(greetings ? { greetings } : {}),
    ...(body ? { body } : {}),
  });
  return { merges: out, changed };
}

/**
 * A template document with every name taken out of its fallbacks — the same
 * safety net for the personal mails that use a Vorlage as their design
 * (mail-template-design.ts): a greeting's „Ohne Vornamen“ as in
 * neutralizeMerges, a {{vorname|…}} keeps its field with the fallback
 * without the names ({{vorname|Lucas}} → {{vorname}}, which tidyEmptyNames
 * reads away). The document comes back as it was when nothing was changed.
 * @template {{ blocks?: unknown }} D
 * @param {D} doc  a normalised document
 * @param {ReadonlyArray<string>} names  lower case
 * @param {{ language?: string }} [opts]  the mail's language (the neutral greeting)
 * @returns {{ doc: D, changed: Array<{ where: string, from: string, to: string }> }}
 */
export function neutralizeDoc(doc, names, opts = {}) {
  const neutral = neutralGreetingFor(opts.language);
  const set = new Set(names.map((n) => n.toLowerCase()));
  /** @type {Array<{ where: string, from: string, to: string }>} */
  const changed = [];
  const blocks = /** @type {unknown} */ (doc?.blocks);
  if (set.size === 0 || !Array.isArray(blocks)) return { doc, changed };
  /** @param {string} where @param {string} s */
  const fixText = (where, s) =>
    s.replace(MERGE_FIELD_RE, (all, name, fallback) => {
      if (!MERGE_FIELDS.includes(String(name).toLowerCase()) || fallback === undefined) return all;
      if (namesIn(fallback, set).length === 0) return all;
      const to = stripNames(fallback, set);
      changed.push({ where, from: fallback.trim(), to });
      return to ? `{{${name}|${to}}}` : `{{${name}}}`;
    });
  /** @param {string} where @param {unknown} v @returns {unknown} */
  const deep = (where, v) => {
    if (typeof v === "string") return fixText(where, v);
    if (Array.isArray(v)) return v.map((x) => deep(where, x));
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deep(where, x)]));
    return v;
  };
  /** @param {any} b @returns {any} */
  const fixBlock = (b) => {
    if (!b || typeof b !== "object") return b;
    if (b.type === "section") {
      return Array.isArray(b.columns)
        ? { ...b, columns: b.columns.map((/** @type {any} */ c) => (Array.isArray(c?.blocks) ? { ...c, blocks: c.blocks.map(fixBlock) } : c)) }
        : b;
    }
    if (b.type === "greeting") {
      if (namesIn(b.fallback, set).length === 0) return b;
      const to = neutralGreeting({ text: b.text, fallback: String(b.fallback ?? "") }, set, neutral);
      changed.push({ where: "Anrede", from: String(b.fallback ?? ""), to });
      return { ...b, fallback: to };
    }
    return deep(BLOCK_LABELS[String(b.type)] ?? "Baustein", b);
  };
  const next = blocks.map(fixBlock);
  if (changed.length === 0) return { doc, changed };
  return { doc: /** @type {D} */ ({ ...doc, blocks: next }), changed };
}

/**
 * The first names of the shop's own people in the imprint lines
 * („Geschäftsführer: Sabine Brunner, Lucas Brunner“ → sabine, lucas) — names
 * the release check knows even when no customer carries them.
 * @param {ReadonlyArray<string>} lines  e.g. MAIL_COMPANY_LINES (mail-template-render.mjs)
 * @returns {string[]}  lower case
 */
export function peopleFirstNames(lines) {
  /** @type {string[]} */
  const out = [];
  for (const line of lines) {
    const m = /(?:Geschäftsführer(?:in)?|Inhaber(?:in)?|Vorstand)\s*:\s*(.+)$/iu.exec(String(line));
    if (!m) continue;
    for (const person of m[1].split(/,|\bund\b|&/u)) {
      const words = person.trim().split(/\s+/u).filter((w) => !/^(dr|prof|dipl|ing)\.?$/iu.test(w));
      const first = (words[0] ?? "").replace(/[^\p{L}'’-]/gu, "").toLowerCase();
      if (first.length >= 2 && !out.includes(first)) out.push(first);
    }
  }
  return out;
}

/**
 * The release check's findings: each fallback with a name in it, once per
 * text — „Anrede „Hallo Lucas,““ with the names; `reads` the line it stands
 * in (the fallback itself when the line is not known).
 * @param {ReadonlyArray<FirstNameFallback>} fallbacks
 * @param {ReadonlyArray<string>} names  the fallback words a customer is called (lower case)
 * @returns {Array<{ where: string, fallback: string, reads: string, names: string[] }>}
 */
export function fallbackNameProblems(fallbacks, names) {
  const set = new Set(names.map((n) => n.toLowerCase()));
  /** @type {Array<{ where: string, fallback: string, reads: string, names: string[] }>} */
  const out = [];
  for (const f of fallbacks) {
    const found = namesIn(f.fallback, set);
    if (found.length === 0) continue;
    if (out.some((o) => o.where === f.where && o.fallback === f.fallback)) continue;
    out.push({ where: f.where, fallback: f.fallback, reads: f.reads || f.fallback, names: found });
  }
  return out;
}

/**
 * What someone without a known first name reads, each distinct line once
 * („Anrede: „Hallo,““, „Betreff: „Hey, die Black Week ist da““, „Betreff:
 * (nichts)“) — for the release checks' info.
 * @param {ReadonlyArray<FirstNameFallback>} fallbacks
 * @returns {string[]}
 */
export function namelessReadings(fallbacks) {
  /** @type {string[]} */
  const out = [];
  for (const f of fallbacks) {
    const shown = (f.reads ?? f.fallback).trim();
    const line = `${f.where}: ${shown ? `„${shown}“` : "(nichts)"}`;
    if (!out.includes(line)) out.push(line);
  }
  return out;
}
