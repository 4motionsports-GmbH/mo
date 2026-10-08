// The welcome-voucher test of the consent ask after a sign-in (OPTIN_REWARD
// T6): variants with a reward hint (b, c) against the control a, read as an
// intention-to-treat comparison over every signed-in session the ask may be
// offered to (server event consent_ask_eligible, carrying the variant the
// server assigned) — not over sessions that SAW an ask, which would bias the
// value-moment variant c (it asks only after a product recommendation).
// Pure, tested. The A/B arithmetic is page-context.mjs's (Wald 95 % interval,
// sample size, progress), reused unchanged.

import { compareArms, experimentProgress } from "./page-context.mjs";
import { SIGNIN_VARIANTS, SIGNIN_VARIANT_ID_RE } from "./consent-variants.mjs";

/**
 * @typedef {{
 *   start: string,
 *   variants: string[],
 *   control: string,
 *   locale: "de" | "en" | null,
 *   primary: "confirmedPerEligible",
 *   targetPerArm: number,
 * }} ConsentRewardExperiment
 */

/**
 * Pre-registered test — null until the commit that flips CONSENT_SIGNIN_VARIANTS
 * sets it, e.g. `{ start: "YYYY-MM-DD", variants: ["a", "b"], control: "a",
 * locale: "de", primary: "confirmedPerEligible", targetPerArm: <n from
 * requiredSampleSize> }`. Never change it after the start: a new test is a new
 * start date.
 * @type {ConsentRewardExperiment | null}
 */
export const CONSENT_REWARD_EXPERIMENT = null;

/** The one primary outcome: confirmed opt-ins per eligible session. */
export const CONSENT_EXPERIMENT_PRIMARY = "confirmedPerEligible";

/** @param {unknown} v */
function isPlainObject(v) {
  return v != null && typeof v === "object" && !Array.isArray(v);
}

/** @param {unknown} v */
function nonEmpty(v) {
  return typeof v === "string" && v.trim() !== "";
}

/**
 * What a served sign-in copy shows, for the KPI events (ids and booleans only):
 * the variant, whether a reward hint renders (an object with badge and terms,
 * lawyer-approved — the widget's servedReward rule) and whether the ask moves
 * to the value moment (valueMoment.lead, lawyer-approved). The copy carries
 * neither key before T3 (copy v6), so both are false today.
 * @param {unknown} copy
 * @returns {{ variant: string | null, reward: boolean, valueMoment: boolean, mode: "popup" | "value_moment" }}
 */
export function servedCopyFacts(copy) {
  const c = isPlainObject(copy) ? /** @type {Record<string, any>} */ (copy) : {};
  const approved = c.lawyerApproved === true;
  const variant = typeof c.variant === "string" && SIGNIN_VARIANT_ID_RE.test(c.variant) ? c.variant : null;
  const reward = approved && isPlainObject(c.reward) && nonEmpty(c.reward.badge) && nonEmpty(c.reward.terms);
  const valueMoment = approved && isPlainObject(c.valueMoment) && nonEmpty(c.valueMoment.lead);
  return { variant, reward, valueMoment, mode: valueMoment ? "value_moment" : "popup" };
}

/**
 * Does a variant define a reward hint (in either locale)? T3 puts `reward` on
 * the variant objects in consent-variants.mjs; until then no variant has one.
 * @param {unknown} id
 */
export function variantDefinesReward(id) {
  if (typeof id !== "string" || !SIGNIN_VARIANT_ID_RE.test(id)) return false;
  return [...SIGNIN_VARIANTS.de, ...SIGNIN_VARIANTS.en].some(
    (v) => v.id === id && isPlainObject(/** @type {Record<string, unknown>} */ (v).reward)
  );
}

/**
 * A pre-registration that can be read: a start day, at least two distinct
 * variants including the control, a known primary and a positive target.
 * @param {unknown} e
 * @returns {e is ConsentRewardExperiment}
 */
export function isValidConsentExperiment(e) {
  if (!isPlainObject(e)) return false;
  const x = /** @type {Record<string, any>} */ (e);
  if (typeof x.start !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(x.start)) return false;
  if (!Array.isArray(x.variants) || x.variants.length < 2) return false;
  if (!x.variants.every((v) => typeof v === "string" && SIGNIN_VARIANT_ID_RE.test(v))) return false;
  if (new Set(x.variants).size !== x.variants.length) return false;
  if (!x.variants.includes(x.control)) return false;
  if (!(x.locale === null || x.locale === "de" || x.locale === "en")) return false;
  if (x.primary !== CONSENT_EXPERIMENT_PRIMARY) return false;
  return Number.isInteger(x.targetPerArm) && x.targetPerArm > 0;
}

const ARM_FIELDS = Object.freeze(["eligible", "closed", "optedIn", "doiSent", "confirmed", "alreadySubscribed"]);

/** @returns {Record<string, number>} */
function emptyArm() {
  return Object.fromEntries(ARM_FIELDS.map((f) => [f, 0]));
}

/** @param {unknown} v */
function count(v) {
  return Math.max(0, Math.floor(Number(v) || 0));
}

/**
 * Fold the store's per-(arm, locale, mixed, afterStart, windowClosed) session
 * counts into the test's arms, the exclusions and one comparison per treatment
 * variant against the control. A session belongs to the comparison when its
 * FIRST assigned variant is a known test variant, it was never assigned
 * another one, its locale is the test's, it became eligible on or after the
 * start, and its confirmation window has closed (only then are its outcomes
 * final). Exclusions count each session once, in this order: unknown variant
 * (or one outside the test), mixed, other locale, before the start, window
 * still open. Without a pre-registered test nothing is compared; `armsSeen`
 * (known first variants in the period, any locale) tells the dashboard
 * whether more than one variant ran.
 *
 * @param {Array<Record<string, unknown>>} rows
 * @param {ConsentRewardExperiment | null} experiment
 * @param {(id: string) => boolean} isKnownVariant
 */
export function summariseConsentExperiment(rows, experiment, isKnownVariant) {
  const exp = isValidConsentExperiment(experiment) ? experiment : null;
  /** @type {Record<string, Record<string, number>>} */
  const arms = {};
  for (const v of exp?.variants ?? []) arms[v] = emptyArm();
  const excluded = { unknownVariant: 0, mixed: 0, otherLocale: 0, beforeStart: 0, windowOpen: 0 };
  const seen = new Set();
  let sessions = 0;
  for (const r of rows ?? []) {
    const n = count(r.sessions);
    if (n === 0) continue;
    sessions += n;
    const arm = typeof r.arm === "string" ? r.arm : "";
    const known = arm !== "" && SIGNIN_VARIANT_ID_RE.test(arm) && isKnownVariant(arm);
    if (known) seen.add(arm);
    if (!exp) continue;
    if (!known || !exp.variants.includes(arm)) {
      excluded.unknownVariant += n;
      continue;
    }
    if (r.mixed === true) {
      excluded.mixed += n;
      continue;
    }
    if (exp.locale && r.locale !== exp.locale) {
      excluded.otherLocale += n;
      continue;
    }
    if (r.afterStart !== true) {
      excluded.beforeStart += n;
      continue;
    }
    const a = arms[arm];
    a.eligible += n;
    if (r.windowClosed !== true) {
      excluded.windowOpen += n;
      continue;
    }
    a.closed += n;
    a.optedIn += count(r.optedIn);
    a.doiSent += count(r.doiSent);
    a.confirmed += count(r.confirmed);
    a.alreadySubscribed += count(r.alreadySubscribed);
  }

  const comparisons = exp
    ? exp.variants
        .filter((v) => v !== exp.control)
        .map((v) => {
          const t = arms[v];
          const c = arms[exp.control];
          return {
            variant: v,
            ...compareArms({ applied: { n: t.closed, k: t.confirmed }, holdout: { n: c.closed, k: c.confirmed } }),
            progress: experimentProgress(
              { applied: { n: t.closed }, holdout: { n: c.closed } },
              { applied: exp.targetPerArm, holdout: exp.targetPerArm }
            ),
          };
        })
    : [];
  const progress = exp
    ? {
        reached: comparisons.length > 0 && comparisons.every((c) => c.progress.reached),
        n: exp.variants.reduce((t, v) => t + arms[v].closed, 0),
        target: exp.targetPerArm * exp.variants.length,
      }
    : null;

  return {
    experiment: exp,
    sessions,
    armsSeen: [...seen].sort(),
    arms,
    excluded,
    comparisons,
    progress,
  };
}
