// Pure view helpers for the Kunden profile card („Aktuelles Kundenverständnis“,
// kunden/tabs/ProfilTab.tsx). No I/O, no React — tested with node:test.
//
//   * parseProfileSections — splits the readable profile text (profile_summary)
//     into its labelled parts (Bedarf & Ziele · Niveau & Kontext · Vorlieben &
//     Budget-Signale · Besitzt bereits · Offene Punkte / nächste Schritte, the
//     outline customer-profile.ts asks the model for). Robust to bold, heading,
//     list and plain labels, English labels, extra paragraphs and labels in the
//     middle of a line. Never loses content: text before the first label is the
//     intro, text after a label belongs to that label, and a text without any
//     known label (older free-text profiles) comes back unsplit for the plain
//     rendering.
//   * nextStepKind — which icon a „Nächste Schritte“ item gets.
//   * profileFreshness / lastProfileActivityAt — is the stored profile behind
//     the person's activity, or simply old?

/**
 * @typedef {"needs" | "level" | "preferences" | "owned" | "next" | "other"} ProfileSectionKey
 * @typedef {{ key: ProfileSectionKey, label: string, sourceLabel: string, body: string }} ProfileSection
 * @typedef {{ structured: boolean, intro: string, sections: ProfileSection[] }} ParsedProfile
 */

/** The five parts of the profile text, in the order the model writes them.
 *  `label` is what the admin shows (German, whatever language the text used). */
export const PROFILE_SECTION_DEFS = [
  {
    key: "needs",
    label: "Bedarf & Ziele",
    match: /^(bedarf|bedürfnis|beduerfnis|ziele?(?![a-z])|trainingsziel|needs?(?![a-z])|goals?(?![a-z]))/,
  },
  {
    key: "level",
    label: "Niveau & Kontext",
    match: /^(niveau|trainingsniveau|kontext|erfahrung|level(?![a-z])|context(?![a-z])|experience)/,
  },
  {
    key: "preferences",
    label: "Vorlieben & Budget-Signale",
    match: /^(vorliebe|präferenz|praeferenz|budget|preferences?(?![a-z]))/,
  },
  {
    key: "owned",
    label: "Besitzt bereits",
    match: /^(besitzt|besitz(?![a-z])|bereits gekauft|gekauft|käufe|kaeufe|ausstattung|already own|owns?(?![a-z])|owned|purchases?(?![a-z])|equipment)/,
  },
  {
    key: "next",
    label: "Offene Punkte & nächste Schritte",
    match: /^(offene|nächste|naechste|next(?![a-z])|open (points|questions|items)|to-?dos?(?![a-z])|empfehlung|recommend)/,
  },
];

/** A leading title that only repeats the card title („Aktuelles Verständnis“). */
const GENERIC_TITLE =
  /^((aktuelles|aktuelle) )?(kunden)?(verständnis|verstaendnis|profil|einschätzung)$|^(current |customer )+(understanding|profile)$/;

const LIST_PREFIX = /^\s*(?:[-*+•]|\d+[.)])\s+/;
const HEADING = /^\s*#{1,6}\s+(.+?)\s*#*\s*$/;
const BOLD_START = /^(\*\*|__)(.+?)\1\s*(:)?\s*(.*)$/;
const PLAIN_LABEL = /^([^:]{2,60}):\s*(.*)$/;

/** Formatted labels (bold / heading) may be a little longer than plain ones. */
const MAX_LABEL_WORDS_FORMATTED = 10;
const MAX_LABEL_WORDS_PLAIN = 6;

function wordCount(s) {
  return (s.match(/[\p{L}\p{N}]+/gu) ?? []).length;
}

/** Lower-cased label without markdown, trailing colon or extra spaces. */
function normalizeLabel(raw) {
  return raw
    .replace(/[*_`#]/g, "")
    .replace(/[:：]\s*$/, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Display form of a label as written (markdown and trailing colon removed). */
function cleanLabel(raw) {
  return raw
    .replace(/[*_`]/g, "")
    .replace(/[:：]\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function knownDef(label) {
  const n = normalizeLabel(label);
  return PROFILE_SECTION_DEFS.find((d) => d.match.test(n)) ?? null;
}

/**
 * Is this line a section label? Returns the label as written, the text after it
 * on the same line, whether it was formatted (bold / heading) and the known
 * section it names (null = an unknown label).
 * @param {string} line
 * @returns {{ sourceLabel: string, rest: string, formatted: boolean, def: (typeof PROFILE_SECTION_DEFS)[number] | null } | null}
 */
function detectLabel(line) {
  if (!line.trim()) return null;
  let s = line.replace(LIST_PREFIX, "");
  const h = HEADING.exec(s);
  if (h) s = h[1];

  const b = BOLD_START.exec(s);
  if (b) {
    const inner = b[2];
    const colon = /[:：]\s*$/.test(inner) || b[3] === ":";
    const rest = b[4].trim();
    const sourceLabel = cleanLabel(inner);
    // "**Wichtig** ist ihr …" is emphasis in a sentence, not a label.
    if ((!rest || colon) && sourceLabel && wordCount(sourceLabel) <= MAX_LABEL_WORDS_FORMATTED) {
      return { sourceLabel, rest, formatted: true, def: knownDef(sourceLabel) };
    }
    if (!h) return null;
  }

  if (h) {
    // "## Bedarf & Ziele: Kraft" carries its text on the heading line.
    const p = PLAIN_LABEL.exec(s);
    if (p && knownDef(p[1]) && wordCount(p[1]) <= MAX_LABEL_WORDS_FORMATTED) {
      return { sourceLabel: cleanLabel(p[1]), rest: p[2].trim(), formatted: true, def: knownDef(p[1]) };
    }
    const sourceLabel = cleanLabel(s);
    if (!sourceLabel || wordCount(sourceLabel) > MAX_LABEL_WORDS_FORMATTED) return null;
    return { sourceLabel, rest: "", formatted: true, def: knownDef(sourceLabel) };
  }

  // Plain text: only a KNOWN label counts ("Bedarf & Ziele: …" or the label
  // alone on its line), so ordinary sentences with a colon stay text.
  const p = PLAIN_LABEL.exec(s);
  if (p) {
    const sourceLabel = cleanLabel(p[1]);
    const def = knownDef(sourceLabel);
    if (!def || wordCount(sourceLabel) > MAX_LABEL_WORDS_PLAIN || /[.!?]/.test(sourceLabel)) return null;
    return { sourceLabel, rest: p[2].trim(), formatted: false, def };
  }
  const bare = cleanLabel(s);
  const def = knownDef(bare);
  if (def && wordCount(bare) <= MAX_LABEL_WORDS_PLAIN && !/[.!?,;]/.test(bare)) {
    return { sourceLabel: bare, rest: "", formatted: false, def };
  }
  return null;
}

/** "… Ziel. **Niveau & Kontext:** …" — move a known bold label that sits in
 *  the middle of a line onto its own line. */
function splitInlineLabels(text) {
  return text
    .split("\n")
    .map((line) => {
      // A list marker or heading hash in front of a label is not "text before it".
      const lead = /^\s*(?:(?:[-*+•]|\d+[.)])\s+|#{1,6}\s+)?/.exec(line)?.[0] ?? "";
      const rest = line
        .slice(lead.length)
        .replace(/(\S)[ \t]+((\*\*|__)([^*_\n]{2,60}?)(?::\3|\3:))/g, (m, prev, label, _d, inner) =>
          knownDef(inner) ? `${prev}\n${label}` : m
        );
      return lead + rest;
    })
    .join("\n");
}

/** Trim blank lines at both ends, keep inner paragraph breaks. */
function joinBody(lines) {
  return lines.join("\n").replace(/^\s*\n/, "").trim();
}

/**
 * Split the profile text into its labelled sections.
 *
 * `structured` is true when at least one of the five known labels was found;
 * then `intro` holds the text before the first label (often empty) and
 * `sections` the labelled parts in their original order (unknown bold/heading
 * labels become `other` sections). Without a known label `structured` is false,
 * `sections` is empty and `intro` is the whole text — render it as it is.
 * A leading title that only repeats the card title („Aktuelles Verständnis“)
 * is dropped; nothing else is.
 *
 * @param {string | null | undefined} summary
 * @returns {ParsedProfile}
 */
export function parseProfileSections(summary) {
  const text = typeof summary === "string" ? summary.replace(/\r\n?/g, "\n").trim() : "";
  if (!text) return { structured: false, intro: "", sections: [] };

  const lines = splitInlineLabels(text).split("\n");

  // Drop a leading generic title ("**Aktuelles Verständnis**", "## Kundenprofil").
  const firstIdx = lines.findIndex((l) => l.trim());
  if (firstIdx >= 0) {
    const first = detectLabel(lines[firstIdx]);
    if (first && first.formatted && !first.rest && GENERIC_TITLE.test(normalizeLabel(first.sourceLabel))) {
      lines.splice(firstIdx, 1);
    }
  }

  /** @type {Array<{ def: (typeof PROFILE_SECTION_DEFS)[number] | null, sourceLabel: string, raw: string, lines: string[] }>} */
  const blocks = [];
  /** @type {string[]} */
  const intro = [];
  /** @type {(typeof blocks)[number] | null} */
  let current = null;
  const append = (/** @type {string} */ line) => (current ? current.lines.push(line) : intro.push(line));

  for (const line of lines) {
    const lab = detectLabel(line);
    if (!lab || (!lab.def && !lab.formatted)) {
      append(line);
      continue;
    }
    current = { def: lab.def, sourceLabel: lab.sourceLabel, raw: line, lines: lab.rest ? [lab.rest] : [] };
    blocks.push(current);
  }

  if (!blocks.some((b) => b.def)) {
    return { structured: false, intro: joinBody(lines), sections: [] };
  }

  /** @type {ProfileSection[]} */
  const sections = [];
  for (const b of blocks) {
    const body = joinBody(b.lines);
    if (!b.def && !body) {
      // An unknown label with nothing under it is just a line of text.
      if (sections.length) {
        const prev = sections[sections.length - 1];
        prev.body = prev.body ? `${prev.body}\n\n${b.raw.trim()}` : b.raw.trim();
      } else {
        intro.push(b.raw);
      }
      continue;
    }
    if (b.def && !body) continue; // a known label alone carries no content
    sections.push({
      key: /** @type {ProfileSectionKey} */ (b.def ? b.def.key : "other"),
      label: b.def ? b.def.label : b.sourceLabel,
      sourceLabel: b.sourceLabel,
      body,
    });
  }
  return { structured: true, intro: joinBody(intro), sections };
}

/**
 * The parsed sections per theme for the card: the bodies of each known section
 * (a label used twice is joined, in order — nothing is dropped) and the unknown
 * labelled sections in their original order.
 * @param {ProfileSection[]} sections
 * @returns {{ bodies: Record<Exclude<ProfileSectionKey, "other">, string | null>, others: ProfileSection[] }}
 */
export function groupProfileSections(sections) {
  /** @type {Record<Exclude<ProfileSectionKey, "other">, string | null>} */
  const bodies = { needs: null, level: null, preferences: null, owned: null, next: null };
  /** @type {ProfileSection[]} */
  const others = [];
  for (const s of sections ?? []) {
    if (s.key === "other") {
      others.push(s);
      continue;
    }
    bodies[s.key] = bodies[s.key] ? `${bodies[s.key]}\n\n${s.body}` : s.body;
  }
  return { bodies, others };
}

/**
 * @typedef {"clarify" | "contact" | "offer" | "timing" | "step"} NextStepKind
 */

const STEP_KINDS = /** @type {Array<[NextStepKind, RegExp]>} */ ([
  [
    "clarify",
    /(klären|klaeren|beantwort|nachfragen|erfragen|rückfrage|rueckfrage|herausfinden|prüfen|pruefen|clarify|answer|ask about|find out|confirm)/i,
  ],
  [
    "contact",
    /(e-?mail|newsletter|kampagne|anschreiben|kontaktieren|nachfassen|erinnern|brief|anrufen|einladen|campaign|follow[- ]up|contact|remind|call )/i,
  ],
  [
    "offer",
    /(anbieten|angebot|empfehl|vorschlag|vorschlagen|zeigen|ergänz|ergaenz|bundle|set-angebot|rabatt|gutschein|offer|recommend|suggest|upsell|show )/i,
  ],
  [
    "timing",
    /(später|spaeter|saison|frühjahr|fruehjahr|herbst|winter|sommer|black friday|termin|in \d+ (tagen|wochen|monaten)|later|next season|in \d+ (days|weeks|months))/i,
  ],
]);

/**
 * The icon family of one „Nächste Schritte“ item: a question to settle, a
 * contact (mail, campaign, letter), an offer, a moment in time, or a plain step.
 * @param {unknown} text
 * @returns {NextStepKind}
 */
export function nextStepKind(text) {
  const s = typeof text === "string" ? text : "";
  for (const [kind, re] of STEP_KINDS) if (re.test(s)) return kind;
  return "step";
}

/** Profiles older than this read as „älter als 3 Monate“ even without new activity. */
export const PROFILE_OLD_DAYS = 90;

const DAY_MS = 86_400_000;
/** Activity within a minute of the profile is the run's own input, not news. */
const ACTIVITY_GRACE_MS = 60_000;

/**
 * How current is the stored profile?
 *   unknown — no (valid) Stand
 *   behind  — activity (order, chat, mail, campaign mail) newer than the Stand
 *   old     — older than PROFILE_OLD_DAYS
 *   fresh   — otherwise
 * @param {{ updatedAt: string | null | undefined, lastActivityAt?: string | null, now?: number }} input
 * @returns {{ state: "unknown" | "fresh" | "behind" | "old", ageDays: number | null }}
 */
export function profileFreshness({ updatedAt, lastActivityAt = null, now = Date.now() }) {
  const u = updatedAt ? Date.parse(updatedAt) : NaN;
  if (!Number.isFinite(u)) return { state: "unknown", ageDays: null };
  const ageDays = Math.max(0, Math.floor((now - u) / DAY_MS));
  const a = lastActivityAt ? Date.parse(lastActivityAt) : NaN;
  if (Number.isFinite(a) && a > u + ACTIVITY_GRACE_MS) return { state: "behind", ageDays };
  if (ageDays >= PROFILE_OLD_DAYS) return { state: "old", ageDays };
  return { state: "fresh", ageDays };
}

/** Timeline kinds the nightly upkeep treats as new activity (customer-store
 *  listCustomersForProfileUpkeep: chat, mail, campaign send, order). */
const ACTIVITY_KINDS = new Set(["order", "chat", "campaign", "mail_in", "mail_out"]);

/**
 * The newest activity that should be in the profile, from the customer
 * timeline (customer-timeline.mjs). Consent changes do not count.
 * @param {Array<{ at: string | null, kind: string }> | null | undefined} timeline
 * @returns {string | null}
 */
export function lastProfileActivityAt(timeline) {
  let best = null;
  let bestMs = -Infinity;
  for (const e of timeline ?? []) {
    if (!e || !ACTIVITY_KINDS.has(e.kind) || !e.at) continue;
    const ms = Date.parse(e.at);
    if (Number.isFinite(ms) && ms > bestMs) {
      bestMs = ms;
      best = e.at;
    }
  }
  return best;
}
