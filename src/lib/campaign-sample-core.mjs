// „Prüfen & testen“ in the campaign editor (docs/CAMPAIGNS.md §2.2) — the pure
// rules: which audience members serve as sample recipients, and what the
// campaign will cost and take before it goes live. I/O lives in
// campaign-sample.ts and /api/admin/campaigns/sample.

/** How many sample mails the editor offers. */
export const SAMPLE_COUNT = 3;

/** Review pace assumed when the campaign has no Tagesziel (mails per day). */
export const DEFAULT_REVIEW_PER_DAY = 100;

const DAY_MS = 86_400_000;

/** @param {{ ordersCount?: number }} m */
function ordersBucket(m) {
  const n = Number(m.ordersCount ?? 0);
  return n <= 0 ? "none" : n === 1 ? "one" : "repeat";
}

/**
 * Up to `n` members that differ as much as possible: language, Mo contact,
 * lifecycle segment and order count. Greedy — each pick takes the member that
 * adds the most attribute values not yet covered; ties keep the input order
 * (the matcher sorts by newest activity, so the samples stay current).
 * Members without an e-mail are skipped; the result never repeats a person.
 *
 * @template {{ customerId: number, email?: string | null, language?: string, hasMoContact?: boolean, lifecycleSegment?: string | null, ordersCount?: number }} M
 * @param {M[]} members
 * @param {number} [n]
 * @returns {M[]}
 */
export function pickSampleRecipients(members, n = SAMPLE_COUNT) {
  const pool = (Array.isArray(members) ? members : []).filter(
    (m, i, all) => m && m.email && all.findIndex((o) => o && o.customerId === m.customerId) === i
  );
  const want = Math.max(0, Math.min(Math.floor(n), pool.length));
  /** @type {Array<Set<string>>} */
  const seen = [new Set(), new Set(), new Set(), new Set()];
  const traits = (/** @type {M} */ m) => [
    m.language === "en" ? "en" : "de",
    m.hasMoContact ? "mo" : "no-mo",
    m.lifecycleSegment ?? "unbekannt",
    ordersBucket(m),
  ];
  /** @type {M[]} */
  const picked = [];
  const used = new Set();
  while (picked.length < want) {
    let best = -1;
    let bestScore = -1;
    for (let i = 0; i < pool.length; i++) {
      if (used.has(i)) continue;
      const t = traits(pool[i]);
      // Language and Mo contact weigh double: they change the mail the most.
      const score = t.reduce((s, v, k) => s + (seen[k].has(v) ? 0 : k < 2 ? 2 : 1), 0);
      if (score > bestScore) {
        best = i;
        bestScore = score;
      }
    }
    if (best < 0) break;
    used.add(best);
    picked.push(pool[best]);
    traits(pool[best]).forEach((v, k) => seen[k].add(v));
  }
  return picked;
}

/** @param {unknown} v */
function finiteOrNull(v) {
  const n = typeof v === "number" ? v : v == null || v === "" ? NaN : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** @param {unknown} v */
function timeOrNull(v) {
  if (!v) return null;
  const t = new Date(String(v)).getTime();
  return Number.isFinite(t) ? t : null;
}

/**
 * What a campaign will cost and take, from the live audience count and the
 * recorded averages (estimateCampaignCosts). Pure; every figure is an
 * estimate the editor shows before the campaign goes live.
 *
 * - KI-Texte: one draft per recipient × the average draft cost.
 * - KI-Titelbilder: none for „Kein“/„Standard“, half the recipients for A/B,
 *   everyone for „alle“ × the average hero pipeline cost.
 * - Prüfzeit: recipients ÷ Tagesziel (or DEFAULT_REVIEW_PER_DAY) — days of
 *   review on the desk, compared with the days left in the campaign window.
 * - Vorbereitung: with „Automatisch vorbereiten“, the nights the nightly run
 *   needs (its per-campaign count, capped by the shared budget).
 *
 * Costs are null when nothing of that kind was recorded yet (no average).
 *
 * @param {{
 *   recipients: number,
 *   heroMode?: string | null,
 *   draftEur?: number | null,
 *   heroEur?: number | null,
 *   dailyTarget?: number | null,
 *   autoPreparePerDay?: number | null,
 *   autoPrepareBudget?: number | null,
 *   startsAt?: string | null,
 *   endsAt?: string | null,
 *   now?: Date,
 * }} input
 */
export function campaignPlanEstimate(input) {
  const recipients = Math.max(0, Math.floor(finiteOrNull(input.recipients) ?? 0));
  const heroMode = input.heroMode ?? "none";
  const heroImages =
    heroMode === "ai_all" ? recipients : heroMode === "ai_ab" ? Math.ceil(recipients / 2) : 0;

  const draftEur = finiteOrNull(input.draftEur);
  const heroEur = finiteOrNull(input.heroEur);
  const draftCostEur = recipients === 0 ? 0 : draftEur == null ? null : recipients * draftEur;
  const heroCostEur = heroImages === 0 ? 0 : heroEur == null ? null : heroImages * heroEur;
  const totalCostEur = draftCostEur == null || heroCostEur == null ? null : draftCostEur + heroCostEur;

  const target = finiteOrNull(input.dailyTarget);
  const reviewPerDay = target != null && target >= 1 ? Math.floor(target) : DEFAULT_REVIEW_PER_DAY;
  const reviewPerDayAssumed = !(target != null && target >= 1);
  const reviewDays = recipients === 0 ? 0 : Math.ceil(recipients / reviewPerDay);

  const perNight = Math.max(0, Math.floor(finiteOrNull(input.autoPreparePerDay) ?? 0));
  const budget = finiteOrNull(input.autoPrepareBudget);
  const nightly = budget == null ? perNight : Math.min(perNight, Math.max(0, Math.floor(budget)));
  const prepareNights = nightly > 0 && recipients > 0 ? Math.ceil(recipients / nightly) : null;

  // The window that is left: from the later of now and the start to the end.
  const now = (input.now ?? new Date()).getTime();
  const start = timeOrNull(input.startsAt);
  const end = timeOrNull(input.endsAt);
  const from = start != null && start > now ? start : now;
  const windowDays = end == null ? null : Math.max(0, Math.floor((end - from) / DAY_MS));

  /** @type {string[]} */
  const warnings = [];
  if (recipients === 0) warnings.push("empty_audience");
  if (end != null && end <= now) warnings.push("ended");
  else if (windowDays != null && recipients > 0 && reviewDays > windowDays) warnings.push("review_too_slow");
  if (windowDays != null && prepareNights != null && prepareNights > windowDays && end != null && end > now) {
    warnings.push("prepare_too_slow");
  }
  if ((draftCostEur == null && recipients > 0) || (heroCostEur == null && heroImages > 0)) {
    warnings.push("no_cost_data");
  }

  return {
    recipients,
    heroImages,
    draftCostEur,
    heroCostEur,
    totalCostEur,
    reviewPerDay,
    reviewPerDayAssumed,
    reviewDays,
    nightly,
    prepareNights,
    windowDays,
    warnings,
  };
}

/** The campaign fields a sample depends on (text and rendering). */
export const SAMPLE_CONFIG_FIELDS = /** @type {const} */ ([
  "name",
  "kind",
  "brief",
  "endsAt",
  "discountPercent",
  "discountScope",
  "discountValidUntil",
  "designKey",
  "textMode",
  "moPromo",
  "ctaKind",
  "ctaUrl",
]);

/**
 * A short, stable fingerprint of the sample-relevant campaign settings
 * (FNV-1a over the normalised fields). A sample carries the fingerprint of
 * the settings it was generated with; „An Testpostfach senden“ is refused
 * when the SAVED campaign no longer has the same one — the test mail must be
 * what the editor showed, under the settings the real mails will use.
 *
 * @param {Record<string, unknown>} config
 * @returns {string}
 */
export function sampleConfigFingerprint(config) {
  const c = config && typeof config === "object" ? config : {};
  const norm = SAMPLE_CONFIG_FIELDS.map((k) => {
    const v = c[k];
    if (v == null || v === "") return null;
    if (k === "endsAt" || k === "discountValidUntil") {
      const t = new Date(String(v)).getTime();
      return Number.isFinite(t) ? t : null;
    }
    if (k === "discountPercent") return Number(v) || 0;
    if (k === "moPromo") return v === true;
    return typeof v === "string" ? v.trim() : v;
  });
  const text = JSON.stringify(norm);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}
