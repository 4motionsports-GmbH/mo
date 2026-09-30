// Pure helpers for the structured customer profile (migration 0059). No I/O —
// imported by the generator (customer-profile.ts), the consumers that put the
// profile into a prompt (chat memory, Kampagne/marketing drafts, summary mail,
// bundle suggestion), the Kampagne recommendation picker AND the node:test
// suite, so it stays a plain .mjs.
//
// The profile has two halves on the customer row:
//   * profile_summary — the readable "current understanding" (unchanged), and
//   * profile_data    — the structured fields below, normalised here so every
//                       reader can trust the shape whatever the model returned.

/** The persona archetype keys (lib/types.ts PersonaArchetype). */
export const PROFILE_PERSONAS = [
  "pragmatic_beginner",
  "ambitious_home_athlete",
  "strength_focused",
  "cardio_focused",
  "studio_operator",
  "physio",
  "public_sector",
  "unknown",
];

export const PROFILE_LEVELS = ["einsteiger", "fortgeschritten", "profi", "unbekannt"];
export const PROFILE_BUDGETS = ["niedrig", "mittel", "hoch", "unbekannt"];

/** Upper bounds per list — the schema can't carry maxItems (Anthropic
 * structured output rejects it), so the normaliser enforces them. */
const MAX_ITEMS = 8;
const MAX_ITEM_CHARS = 160;

function cleanList(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const v of raw) {
    if (typeof v !== "string") continue;
    const t = v.replace(/\s+/g, " ").trim().slice(0, MAX_ITEM_CHARS);
    if (t && !out.includes(t)) out.push(t);
    if (out.length >= MAX_ITEMS) break;
  }
  return out;
}

function oneOf(value, allowed, fallback) {
  const v = typeof value === "string" ? value.trim().toLowerCase() : "";
  return allowed.includes(v) ? v : fallback;
}

/**
 * Normalise the structured profile (model output or a stored jsonb value) into
 * a fixed shape. Unknown persona/level/budget values become "unknown"/
 * "unbekannt"; lists are trimmed, de-duplicated and capped. Never throws.
 *
 * @param {unknown} raw
 * @returns {{ persona: string, goals: string[], owned: string[], interests: string[],
 *   level: string, budget: string, nextSteps: string[] }}
 */
export function normalizeProfileData(raw) {
  const r = raw && typeof raw === "object" ? /** @type {Record<string, unknown>} */ (raw) : {};
  return {
    persona: oneOf(r.persona, PROFILE_PERSONAS, "unknown"),
    goals: cleanList(r.goals),
    owned: cleanList(r.owned),
    interests: cleanList(r.interests),
    level: oneOf(r.level, PROFILE_LEVELS, "unbekannt"),
    budget: oneOf(r.budget, PROFILE_BUDGETS, "unbekannt"),
    nextSteps: cleanList(r.nextSteps),
  };
}

/** True when the structured profile carries anything beyond defaults. */
export function hasProfileSignal(data) {
  const d = normalizeProfileData(data);
  return (
    d.persona !== "unknown" ||
    d.level !== "unbekannt" ||
    d.budget !== "unbekannt" ||
    d.goals.length > 0 ||
    d.owned.length > 0 ||
    d.interests.length > 0 ||
    d.nextSteps.length > 0
  );
}

/**
 * The structured profile as compact prompt lines, for every generator that
 * writes to or about the customer. Empty string when there is no signal, so a
 * prompt without a profile stays byte-identical.
 *
 * @param {unknown} data
 * @param {string | null} personaLabel display label for the persona (German admin label), optional
 * @param {"de" | "en"} [locale]
 */
export function profileFactsBlock(data, personaLabel = null, locale = "de") {
  if (!data || !hasProfileSignal(data)) return "";
  const d = normalizeProfileData(data);
  const en = locale === "en";
  const lines = [];
  if (d.persona !== "unknown") {
    lines.push(`- ${en ? "Persona" : "Persona"}: ${personaLabel || d.persona}`);
  }
  if (d.level !== "unbekannt") lines.push(`- ${en ? "Level" : "Niveau"}: ${d.level}`);
  if (d.budget !== "unbekannt") lines.push(`- ${en ? "Budget signal" : "Budget-Signal"}: ${d.budget}`);
  if (d.goals.length) lines.push(`- ${en ? "Goals" : "Ziele"}: ${d.goals.join("; ")}`);
  if (d.owned.length) lines.push(`- ${en ? "Owns" : "Besitzt"}: ${d.owned.join("; ")}`);
  if (d.interests.length) lines.push(`- ${en ? "Interests" : "Interessen"}: ${d.interests.join("; ")}`);
  if (d.nextSteps.length) {
    lines.push(`- ${en ? "Sensible next steps" : "Sinnvolle nächste Schritte"}: ${d.nextSteps.join("; ")}`);
  }
  return lines.join("\n");
}

/**
 * The short text the Kampagne picker embeds to steer recommendations by what
 * the person wants (goals + interests + next steps). Null when there is
 * nothing to steer by — the picker then works exactly as before.
 */
export function profileSteeringQuery(data) {
  if (!data) return null;
  const d = normalizeProfileData(data);
  const parts = [...d.goals, ...d.interests, ...d.nextSteps];
  if (parts.length === 0) return null;
  return parts.join(". ").slice(0, 600);
}

/**
 * Blend the purchase-similarity score with the profile score for one
 * candidate product. Without a profile score the purchase score is returned
 * unchanged; without purchase signal the profile score alone decides. Both
 * inputs are cosine similarities (−1…1, in practice 0…1).
 *
 * @param {number | null} purchaseScore max cosine against owned products, null = no owned vectors
 * @param {number | null} profileScore cosine against the profile query, null = no profile query
 */
export function blendRecommendationScore(purchaseScore, profileScore) {
  const hasPurchase = typeof purchaseScore === "number" && Number.isFinite(purchaseScore);
  const hasProfile = typeof profileScore === "number" && Number.isFinite(profileScore);
  if (hasPurchase && hasProfile) return 0.6 * purchaseScore + 0.4 * profileScore;
  if (hasPurchase) return purchaseScore;
  if (hasProfile) return profileScore;
  return 0;
}

/**
 * Upkeep decision: does this customer's profile need (re)generation? True when
 * it was never checked, or when there has been activity (chat, mail, order,
 * Kampagne send) since the last check. Mirrors the SQL candidate query in
 * customer-store.listCustomersForProfileUpkeep — kept here so the rule is tested.
 *
 * @param {{ checkedAt: string | null, lastActivityAt: string | null }} input
 */
export function profileNeedsUpkeep({ checkedAt, lastActivityAt }) {
  if (!checkedAt) return true;
  if (!lastActivityAt) return false;
  const c = Date.parse(checkedAt);
  const a = Date.parse(lastActivityAt);
  if (!Number.isFinite(c)) return true;
  return Number.isFinite(a) && a > c;
}

/**
 * The full profile for a prompt: the readable summary followed by the
 * structured fields. Every generator that already has a "Kundenverständnis"
 * slot passes this instead of the bare summary, so they all read the same
 * thing. Null when there is neither.
 *
 * @param {string | null | undefined} summary
 * @param {unknown} data
 * @param {string | null} [personaLabel]
 */
export function profileForPrompt(summary, data, personaLabel = null) {
  const text = typeof summary === "string" ? summary.trim() : "";
  const facts = profileFactsBlock(data, personaLabel, "de");
  if (!text && !facts) return null;
  if (!facts) return text;
  return text ? `${text}\n\nAuf einen Blick:\n${facts}` : `Auf einen Blick:\n${facts}`;
}
