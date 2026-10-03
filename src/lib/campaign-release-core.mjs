// „Freigeben" — approve a reviewed campaign mail now, send it later (pure, no
// I/O; migration 0072, lib/campaign-release.ts). A person still reviews every
// single mail; the release job only delivers what was approved, through the one
// send path (approveAndSendCampaign), so every legal gate runs again at send
// time. These rules decide what an approval means and when it no longer holds.

import { REVIEW_PLACEHOLDER_CODE } from "./campaign-review-checks.mjs";

/** The latest a mail may be scheduled ahead (days). */
export const MAX_RELEASE_AHEAD_DAYS = 30;

/**
 * What was approved: the draft's version, the effective language and the
 * campaign fields that change what the mail looks like (design, hero, CTA, Mo
 * promo, code validity). Any of them changing after the approval holds the mail
 * for a new review; pausing and resuming a campaign does not.
 * @param {{ draftUpdatedAt: string | null, language: string | null,
 *   campaign: { designKey?: string | null, heroMode?: string | null, ctaKind?: string | null,
 *     ctaUrl?: string | null, moPromo?: boolean | null, discountValidUntil?: string | null } }} v
 */
export function approvalFingerprint(v) {
  const c = v.campaign ?? {};
  return JSON.stringify([
    v.draftUpdatedAt ?? "",
    v.language ?? "",
    c.designKey ?? "",
    c.heroMode ?? "",
    c.ctaKind ?? "",
    c.ctaUrl ?? "",
    c.moPromo === true,
    c.discountValidUntil ?? "",
  ]);
}

/**
 * The review-desk blockers the send path does not enforce by itself, checked
 * at approval and again at release. (The legal gates and the discount checks
 * run in campaignSendPreflight / approveAndSendCampaign.)
 * @param {{ body: string | null, discountPercent: number | null, bundleExpiresAt?: string | null, now?: Date | number }} d
 * @returns {Array<{ key: string, message: string }>}
 */
export function releaseBlockers(d) {
  const out = [];
  const body = String(d.body ?? "");
  const discount = Number(d.discountPercent) || 0;
  if (discount <= 0 && body.includes(REVIEW_PLACEHOLDER_CODE)) {
    out.push({
      key: "placeholder_without_discount",
      message: `Der Text enthält ${REVIEW_PLACEHOLDER_CODE}, aber es ist kein Rabatt gesetzt.`,
    });
  }
  const now = d.now == null ? Date.now() : new Date(d.now).getTime();
  const expires = d.bundleExpiresAt ? new Date(d.bundleExpiresAt).getTime() : NaN;
  if (Number.isFinite(expires) && expires <= now) {
    out.push({
      key: "bundle_expired",
      message: "Das Set-Angebot im Text ist abgelaufen — der Set-Block fiele weg, der Text erwähnt ihn aber.",
    });
  }
  return out;
}

/**
 * The release time a request asks for: none/invalid → now; never in the past;
 * never more than MAX_RELEASE_AHEAD_DAYS ahead (null then = refused).
 * @param {unknown} input ISO string or null
 * @param {Date | number} [now]
 * @returns {string | null}
 */
export function parseReleaseAt(input, now = Date.now()) {
  const nowMs = new Date(now).getTime();
  if (input == null || input === "") return new Date(nowMs).toISOString();
  const t = new Date(String(input)).getTime();
  if (!Number.isFinite(t)) return new Date(nowMs).toISOString();
  if (t > nowMs + MAX_RELEASE_AHEAD_DAYS * 86_400_000) return null;
  return new Date(Math.max(t, nowMs)).toISOString();
}

/**
 * Berlin wall time → UTC instant (handles summer/winter time).
 * @param {number} y @param {number} m 1-12 @param {number} d @param {number} h @param {number} min
 */
export function berlinToUtc(y, m, d, h, min = 0) {
  // Start from the naive UTC instant and correct by Berlin's offset at that
  // moment; a second pass settles the instant right after a DST switch.
  let guess = Date.UTC(y, m - 1, d, h, min);
  for (let i = 0; i < 2; i++) guess = Date.UTC(y, m - 1, d, h, min) - berlinOffsetMs(guess);
  return new Date(guess);
}

/** Berlin's UTC offset at an instant, in ms. @param {number} instant */
function berlinOffsetMs(instant) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Berlin",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(instant))
      .map((p) => [p.type, p.value])
  );
  const wall = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
  return wall - Math.floor(instant / 60_000) * 60_000;
}

/** Berlin calendar date of an instant. @param {number} instant */
function berlinDate(instant) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(new Date(instant))
      .map((x) => [x.type, x.value])
  );
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day) };
}

/**
 * The send-time choices the desk offers: next run (now), today 18:00 (while it
 * is still ahead), tomorrow 09:00, tomorrow 18:00. Berlin time.
 * @param {Date | number} [now]
 * @returns {Array<{ key: string, label: string, releaseAt: string | null }>} releaseAt null = now
 */
export function releaseTimeOptions(now = Date.now()) {
  const nowMs = new Date(now).getTime();
  const today = berlinDate(nowMs);
  const tomorrow = berlinDate(berlinToUtc(today.y, today.m, today.d, 12).getTime() + 86_400_000);
  const out = [{ key: "now", label: "Mit dem nächsten Lauf (≤ 10 Min.)", releaseAt: null }];
  const today18 = berlinToUtc(today.y, today.m, today.d, 18);
  if (today18.getTime() > nowMs + 15 * 60_000) out.push({ key: "today18", label: "Heute 18:00", releaseAt: today18.toISOString() });
  out.push({ key: "tomorrow9", label: "Morgen 09:00", releaseAt: berlinToUtc(tomorrow.y, tomorrow.m, tomorrow.d, 9).toISOString() });
  out.push({ key: "tomorrow18", label: "Morgen 18:00", releaseAt: berlinToUtc(tomorrow.y, tomorrow.m, tomorrow.d, 18).toISOString() });
  return out;
}
