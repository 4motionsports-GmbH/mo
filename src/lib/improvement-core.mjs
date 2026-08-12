// Pure helpers for the closed improvement loop ("Verbesserung" tab). No I/O, no
// DB, no model — imported by the data layer (improvement-store.ts), the engine
// (improvement-generate.ts), the directives store (directives-store.ts) AND the
// node:test suite, so it stays a plain .mjs (like analytics-report-core.mjs /
// conversation-analysis-core.mjs / qa-core.mjs).
//
// It owns: the run phase state-machine, the lane/category/status vocabularies,
// the KPI baseline + delta maths (the yardstick of the Wirkungs-Check), the
// defensive parser for the engine's JSON output, the suggestion fingerprint
// (cross-run dedup), the directive bounds, and the prompt builders for both
// engine passes.

// ── Models ────────────────────────────────────────────────────────────────────
// Both engine passes read a lot (report narrative + Mo's full self-snapshot)
// and write structured, high-judgement output — Sonnet, like the customer
// synthesis; Haiku is too weak for "criticize the system prompt", Opus too
// expensive for a repeatable loop.

export const EFFECT_MODEL = "claude-sonnet-4-6";
export const SUGGEST_MODEL = "claude-sonnet-4-6";

// ── Phase state-machine ───────────────────────────────────────────────────────
// Stepped like the Komplettanalyse: ONE bounded model call per /step request.
//   wirkung     — assess previously implemented/accepted suggestions against
//                 the measured KPI movement (skipped when there is no history)
//   vorschlaege — produce this run's suggestions (the big pass)

export const RUN_PHASES = ["wirkung", "vorschlaege", "done"];

export const RUN_PHASE_LABELS = {
  wirkung: "Wirkungs-Check der bisherigen Maßnahmen",
  vorschlaege: "Verbesserungsvorschläge erarbeiten",
  done: "Fertig",
};

/** The phase that follows `current`, or 'done' at the end. */
export function nextRunPhase(current) {
  const i = RUN_PHASES.indexOf(current);
  if (i === -1) return "done";
  return RUN_PHASES[i + 1] ?? "done";
}

// ── Vocabularies ──────────────────────────────────────────────────────────────

export const LANES = ["shop", "mo"];

export const LANE_LABELS = {
  shop: "Online-Shop",
  mo: "Mo selbst",
};

/** Validated per-lane category keys + German display labels. */
export const SHOP_CATEGORIES = {
  sortiment: "Sortiment & Verfügbarkeit",
  produktdaten: "Produktdaten & Inhalte",
  preis_angebot: "Preis & Angebote",
  ux_storefront: "Storefront & UX",
  marketing: "Marketing & Kampagnen",
  prozess: "Prozesse & Service",
};

export const MO_CATEGORIES = {
  anweisung: "Verhaltens-Anweisung (sofort aktivierbar)",
  prompt_kern: "Kern-Prompt (Code-Änderung)",
  wissen: "Wissenslücke",
  tools: "Tool-Verhalten",
  persona: "Personas & Zielgruppen",
  faehigkeit: "Neue Fähigkeit",
};

export function categoriesForLane(lane) {
  return lane === "mo" ? MO_CATEGORIES : SHOP_CATEGORIES;
}

export const SUGGESTION_STATUSES = ["open", "accepted", "implemented", "dismissed"];

export const SUGGESTION_STATUS_LABELS = {
  open: "Offen",
  accepted: "Angenommen",
  implemented: "Umgesetzt",
  dismissed: "Verworfen",
};

export const IMPACT_LEVELS = ["hoch", "mittel", "niedrig"];

// ── Bounds ────────────────────────────────────────────────────────────────────

export const MAX_SUGGESTIONS_PER_RUN = 12;
export const MAX_TITLE_CHARS = 140;
export const MAX_RATIONALE_CHARS = 1200;
export const MAX_PROPOSAL_CHARS = 1600;
export const MAX_EVIDENCE_ITEMS = 6;
export const MAX_EVIDENCE_CHARS = 200;
export const MAX_EXPECTED_EFFECT_CHARS = 240;

// The live directive layer must stay a bounded prompt section: at most this
// many ACTIVE directives, each at most this long. Enforced in the store,
// re-stated in the admin UI.
export const MAX_ACTIVE_DIRECTIVES = 20;
export const MAX_DIRECTIVE_CHARS = 600;

// ── Fingerprint (cross-run dedup) ─────────────────────────────────────────────
// Same normalisation as qa-core's questionFingerprint: a suggestion that the
// engine re-derives with a slightly different title must not clutter the
// backlog twice. Dedup happens in code before insert (no unique index — a
// dismissed idea may legitimately return with new evidence).

export function suggestionFingerprint(title) {
  return String(title ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "ss")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

// ── KPI baseline + delta ──────────────────────────────────────────────────────
// A run stores comparable RATES (shares of the window's conversations), not
// absolutes — windows differ in length and traffic, so only rates are honestly
// comparable across runs. Distribution shares are keyed by their German label
// (the shape the report sections already carry).

function share(part, total) {
  const p = Number(part) || 0;
  const t = Number(total) || 0;
  if (t <= 0) return null;
  return Math.round((p / t) * 1000) / 10; // one decimal, in percent
}

/**
 * Compute the comparable baseline from a report's `sections` payload.
 * Returns a flat, JSON-safe object; null rates mean "not measurable" (e.g. an
 * empty window) and are skipped by the delta.
 */
export function computeKpiBaseline(sections) {
  const k = sections?.kpis ?? {};
  const conversations = Number(k.conversations) || 0;
  const qualityShares = {};
  for (const row of Array.isArray(sections?.qualities) ? sections.qualities : []) {
    if (row && typeof row.label === "string") {
      qualityShares[row.label] = share(row.count, conversations);
    }
  }
  const categoryShares = {};
  for (const row of Array.isArray(sections?.categories) ? sections.categories : []) {
    if (row && typeof row.label === "string") {
      categoryShares[row.label] = share(row.count, conversations);
    }
  }
  return {
    conversations,
    analyzedShare: share(k.analyzed, conversations),
    emailCapturedShare: share(k.emailCaptured, conversations),
    cartUsedShare: share(k.cartUsed, conversations),
    checkoutOfferedShare: share(k.checkoutOffered, conversations),
    withErrorShare: share(k.withError, conversations),
    qualityShares,
    categoryShares,
  };
}

const RATE_LABELS = {
  emailCapturedShare: "E-Mail-Capture-Quote",
  cartUsedShare: "Warenkorb-Klick-Quote",
  checkoutOfferedShare: "Checkout-Angebots-Quote",
  withErrorShare: "Quote ohne Bot-Antwort",
  analyzedShare: "Analyse-Abdeckung",
};

/**
 * Movement between two baselines as a flat row list:
 *   { key, label, prev, cur, delta }  — rates in %, delta in percentage points.
 * Rows where either side is unmeasurable are dropped. Quality shares are
 * included per label ("Qualität: Gut gelöst" …); categories are deliberately
 * NOT — category mix shifts with season/traffic and reads as noise, while the
 * quality distribution is the actual outcome measure.
 */
export function computeBaselineDelta(prev, cur) {
  if (!prev || !cur) return null;
  const rows = [];
  for (const [key, label] of Object.entries(RATE_LABELS)) {
    const a = prev[key];
    const b = cur[key];
    if (typeof a !== "number" || typeof b !== "number") continue;
    rows.push({ key, label, prev: a, cur: b, delta: Math.round((b - a) * 10) / 10 });
  }
  const prevQ = prev.qualityShares ?? {};
  const curQ = cur.qualityShares ?? {};
  for (const label of Object.keys(curQ)) {
    const a = prevQ[label];
    const b = curQ[label];
    if (typeof a !== "number" || typeof b !== "number") continue;
    rows.push({
      key: `quality:${label}`,
      label: `Qualität: ${label}`,
      prev: a,
      cur: b,
      delta: Math.round((b - a) * 10) / 10,
    });
  }
  return {
    prevConversations: Number(prev.conversations) || 0,
    curConversations: Number(cur.conversations) || 0,
    rows,
  };
}

/** Render a delta as a compact German Markdown table (prompt + UI fallback). */
export function renderDeltaMd(delta) {
  if (!delta || !Array.isArray(delta.rows) || delta.rows.length === 0) {
    return "_Keine vergleichbaren Kennzahlen zwischen den Zeiträumen._";
  }
  const fmt = (n) => `${n.toLocaleString("de-DE", { maximumFractionDigits: 1 })} %`;
  const sign = (n) =>
    `${n > 0 ? "+" : ""}${n.toLocaleString("de-DE", { maximumFractionDigits: 1 })} pp`;
  const lines = [
    `| Kennzahl | vorher | jetzt | Δ |`,
    `| --- | --- | --- | --- |`,
    ...delta.rows.map((r) => `| ${r.label} | ${fmt(r.prev)} | ${fmt(r.cur)} | ${sign(r.delta)} |`),
  ];
  return lines.join("\n");
}

// ── Defensive parser for the engine's JSON output ─────────────────────────────

function clampText(v, max) {
  if (typeof v !== "string") return "";
  const t = v.trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function stripCodeFences(text) {
  const t = String(text ?? "").trim();
  const fenced = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fenced ? fenced[1] : t;
}

/**
 * Parse + validate the suggestions pass output. Expected shape:
 *   { "vorschlaege": [ { lane, category, title, rationale, proposal,
 *                        directive?, expected_effect?, impact?, effort?,
 *                        evidence? } ] }
 * Never throws. Invalid items are dropped; a malformed payload returns
 * { ok: false } so the caller can fail the run with a clear message. The
 * returned items are clamped, validated against the lane vocabularies and
 * capped at MAX_SUGGESTIONS_PER_RUN.
 */
export function parseSuggestionsResponse(text) {
  let payload;
  try {
    payload = JSON.parse(stripCodeFences(text));
  } catch {
    // Fallback: first {...} block in the text (models occasionally add prose).
    const m = String(text ?? "").match(/\{[\s\S]*\}/);
    if (!m) return { ok: false, reason: "no_json" };
    try {
      payload = JSON.parse(m[0]);
    } catch {
      return { ok: false, reason: "invalid_json" };
    }
  }
  const raw = Array.isArray(payload?.vorschlaege) ? payload.vorschlaege : null;
  if (!raw) return { ok: false, reason: "missing_vorschlaege" };

  const out = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const lane = LANES.includes(item.lane) ? item.lane : null;
    if (!lane) continue;
    const categories = categoriesForLane(lane);
    const category = Object.prototype.hasOwnProperty.call(categories, item.category)
      ? item.category
      : Object.keys(categories)[0];
    const title = clampText(item.title, MAX_TITLE_CHARS);
    const rationale = clampText(item.rationale, MAX_RATIONALE_CHARS);
    const proposal = clampText(item.proposal, MAX_PROPOSAL_CHARS);
    if (!title || !rationale || !proposal) continue;
    const directive =
      lane === "mo" ? clampText(item.directive, MAX_DIRECTIVE_CHARS) || null : null;
    const evidence = (Array.isArray(item.evidence) ? item.evidence : [])
      .filter((e) => typeof e === "string" && e.trim())
      .slice(0, MAX_EVIDENCE_ITEMS)
      .map((e) => clampText(e, MAX_EVIDENCE_CHARS));
    out.push({
      lane,
      category,
      title,
      fingerprint: suggestionFingerprint(title),
      rationale,
      proposal,
      directive,
      expectedEffect: clampText(item.expected_effect, MAX_EXPECTED_EFFECT_CHARS) || null,
      impact: IMPACT_LEVELS.includes(item.impact) ? item.impact : "mittel",
      effort: IMPACT_LEVELS.includes(item.effort) ? item.effort : "mittel",
      evidence,
    });
    if (out.length >= MAX_SUGGESTIONS_PER_RUN) break;
  }
  if (out.length === 0) return { ok: false, reason: "no_valid_items" };
  return { ok: true, suggestions: out };
}

/**
 * Drop new suggestions whose fingerprint matches any existing non-dismissed
 * suggestion (the engine also SEES the prior list, this is the hard guard).
 */
export function dedupeSuggestions(parsed, existingFingerprints) {
  const seen = new Set(existingFingerprints ?? []);
  const kept = [];
  for (const s of parsed) {
    if (!s.fingerprint || seen.has(s.fingerprint)) continue;
    seen.add(s.fingerprint);
    kept.push(s);
  }
  return kept;
}

// ── Prompt builders ───────────────────────────────────────────────────────────
// Kept here (like conversation-analysis-core's buildRollupPrompt) so the exact
// engine inputs are unit-testable without a model call.

/** Compact German one-liner list of prior suggestions for either pass. */
export function renderPriorSuggestions(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return "(keine)";
  return rows
    .map((s) => {
      const bits = [
        `[${s.lane === "mo" ? "Mo" : "Shop"}]`,
        s.title,
        `Status: ${SUGGESTION_STATUS_LABELS[s.status] ?? s.status}`,
      ];
      if (s.expectedEffect) bits.push(`Erwartete Wirkung: ${s.expectedEffect}`);
      if (s.statusNote) bits.push(`Notiz: ${s.statusNote}`);
      return `- ${bits.join(" · ")}`;
    })
    .join("\n");
}

/**
 * User prompt of the Wirkungs-Check pass: measured movement + what was done.
 */
export function buildEffectPrompt({ deltaMd, priorSuggestions, reportExtract }) {
  return (
    `## Gemessene Veränderung seit dem letzten Lauf\n${deltaMd}\n\n` +
    `## Damals beschlossene Maßnahmen (angenommen oder bereits umgesetzt)\n` +
    `${renderPriorSuggestions(priorSuggestions)}\n\n` +
    `## Auszug aus dem aktuellen Analysebericht\n${reportExtract}\n\n` +
    `Erstelle jetzt den Wirkungs-Check.`
  );
}

/**
 * User prompt of the suggestions pass: the full evidence package.
 */
export function buildSuggestPrompt({
  reportTitle,
  rangeFrom,
  rangeTo,
  reportMd,
  selfSnapshot,
  priorSuggestions,
  deltaMd,
  effectCheckMd,
}) {
  const parts = [
    `## Analysebericht „${reportTitle}“ (${rangeFrom} bis ${rangeTo})\n${reportMd}`,
    `## Mos aktuelle Konfiguration (Selbstbild)\n${selfSnapshot}`,
    `## Bisherige Vorschläge (NICHT wiederholen — auch verworfene nicht)\n${renderPriorSuggestions(priorSuggestions)}`,
  ];
  if (deltaMd) parts.push(`## Kennzahlen-Veränderung seit dem letzten Lauf\n${deltaMd}`);
  if (effectCheckMd) parts.push(`## Wirkungs-Check dieses Laufs\n${effectCheckMd}`);
  parts.push(`Erstelle jetzt die Verbesserungsvorschläge als JSON.`);
  return parts.join("\n\n");
}

/**
 * Compact Markdown extract of a report's sections for the engine passes —
 * KPIs + distributions as data lines, then the two narrative sections. Bounded:
 * narratives are clamped so the prompt cannot explode with a huge report.
 */
export function renderReportExtract(sections, { maxNarrativeChars = 6000 } = {}) {
  const k = sections?.kpis ?? {};
  const lines = [
    `- Gespräche im Zeitraum: ${Number(k.conversations) || 0} (analysiert: ${Number(k.analyzed) || 0})`,
    `- Tiers: anonym ${k.tiers?.anonymous ?? 0} · nur E-Mail ${k.tiers?.emailOnly ?? 0} · angemeldet ${k.tiers?.signedIn ?? 0}`,
    `- E-Mail erfasst: ${Number(k.emailCaptured) || 0} · Warenkorb geklickt: ${Number(k.cartUsed) || 0} · Checkout angeboten: ${Number(k.checkoutOffered) || 0} · ohne Bot-Antwort: ${Number(k.withError) || 0}`,
  ];
  const dist = (rows) =>
    (Array.isArray(rows) ? rows : [])
      .map((r) => `${r.label}: ${r.count}`)
      .join(" · ") || "(keine)";
  lines.push(`- Kategorien: ${dist(sections?.categories)}`);
  lines.push(`- Qualität: ${dist(sections?.qualities)}`);
  for (const p of Array.isArray(sections?.personas) ? sections.personas : []) {
    const fav = (p.favoriteProducts ?? [])
      .map((f) => f.name)
      .slice(0, 3)
      .join(", ");
    lines.push(
      `- Persona ${p.personaDisplay}: ${p.chatCount} Gespräch(e)${fav ? ` · häufig empfohlen: ${fav}` : ""}`
    );
  }
  const out = [`### Kennzahlen\n${lines.join("\n")}`];
  if (sections?.insightsMd) {
    out.push(`### Aggregierte Insights\n${clampText(sections.insightsMd, maxNarrativeChars)}`);
  }
  const personaQ = (Array.isArray(sections?.personas) ? sections.personas : [])
    .filter((p) => p.topQuestionsMd)
    .map((p) => `**${p.personaDisplay}**\n${p.topQuestionsMd}`)
    .join("\n\n");
  if (personaQ) out.push(`### Top-Fragen je Persona\n${clampText(personaQ, maxNarrativeChars)}`);
  if (sections?.customerKnowledgeMd) {
    out.push(
      `### Aggregiertes Kundenwissen\n${clampText(sections.customerKnowledgeMd, maxNarrativeChars)}`
    );
  }
  if (Array.isArray(sections?.notes) && sections.notes.length > 0) {
    out.push(`### Hinweise\n${sections.notes.map((n) => `- ${n}`).join("\n")}`);
  }
  return out.join("\n\n");
}
