// One-time welcome discount — issued when a customer completes the marketing
// double-opt-in confirmation for the FIRST time (GET /api/confirm-marketing).
//
// LEGAL FRAMING (lawyer-confirm, see docs/WELCOME_DISCOUNT.md): the code is a
// welcome GIFT for completing the freely-chosen DOI confirmation ("yes, I want
// this"), NOT consideration for ticking the marketing checkbox — this keeps
// the marketing consent "freely given" (Art. 7(4) GDPR). Tying issuance to the
// DOI click also means unconfirmed or fake addresses are never rewarded.
//
// Guarantees, in order:
//   1. SUPPRESSION — a suppressed/unsubscribed address never gets a code or an
//      email (isSuppressed + canSendMarketing, both fail-closed).
//   2. OPT-OUT — the delivery email is commercial, so a working signed
//      unsubscribe link is mandatory; without one we refuse BEFORE claiming.
//   3. ONCE-EVER — claimWelcomeIssuance() atomically stamps
//      customers.welcome_issued_at (… WHERE welcome_issued_at IS NULL), so the
//      same email can never be issued twice, across sessions and signups. The
//      customer entity is the source of truth.
//   4. MINT — the same Shopify path as marketing codes
//      (createUniqueDiscountCode: usageLimit 1, appliesOncePerCustomer), with
//      the "WELCOME-" prefix and its own expiry. A failed mint releases the
//      claim so a transient Shopify error doesn't burn the one chance.
//   5. RECORD before SEND — the code is persisted on the customer row first;
//      if the email then fails, the issued code is still visible on the admin
//      dashboard (and the failure is reported) instead of being lost.
//
// Everything is best-effort and never throws: a failure here must not break
// the DOI confirmation page the user is looking at.

import {
  canSendMarketing,
  isSuppressed,
  buildUnsubscribeToken,
  normalizeEmail,
} from "./email-capture-store";
import {
  claimWelcomeIssuance,
  recordWelcomeCode,
  revertWelcomeIssuance,
  getCustomerByEmail,
  linkCustomerOnEmailCapture,
} from "./customer-store";
import {
  createUniqueDiscountCode,
  formatGermanExpiryDate,
} from "./shopify-discounts";
import { sendEmail } from "./email";
import { WELCOME_EMAIL_SUBJECT, welcomeEmailBody, unsubscribeFooter } from "./consent-copy";
import { getBaseUrl } from "./base-url";
import { reportError } from "./observability";

/** Prefix marking welcome codes — distinct from the marketing "MS5-" codes. */
export const WELCOME_CODE_PREFIX = "WELCOME";

/**
 * Whole-number percent the welcome code is worth (env-overridable, default 5).
 * Clamped to a sane 1–50 so a typo in the env can't mint a 100%-off code.
 */
export function welcomeDiscountPercent(): number {
  const raw = process.env.WELCOME_DISCOUNT_PERCENT;
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n >= 1 && n <= 50 ? n : 5;
}

/** Days the welcome code stays valid (env-overridable, default 30 — a welcome
 * gift gets more runway than the 7-day marketing codes). */
export function welcomeExpiryDays(): number {
  const raw = process.env.WELCOME_DISCOUNT_EXPIRY_DAYS;
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 30;
}

export type WelcomeIssueResult =
  | { issued: true; code: string; emailSent: boolean }
  | {
      issued: false;
      reason:
        | "suppressed"
        | "not_eligible"
        | "no_unsubscribe"
        | "already_issued"
        | "no_customer"
        | "mint_failed"
        | "error";
    };

/**
 * Issue the one-time welcome code for a customer who JUST completed their
 * first DOI confirmation, and deliver it by email. Call only on a fresh
 * (non-alreadyConfirmed) confirmation; every guarantee above is enforced here
 * regardless. Never throws.
 */
export async function issueWelcomeCodeOnDoiConfirmation(
  email: string
): Promise<WelcomeIssueResult> {
  try {
    const e = normalizeEmail(email);
    if (!e) return { issued: false, reason: "error" };

    // GATE 1 — never issue to a suppressed address (fail-closed), and the
    // address must be marketing-eligible (DOI confirmed — it just was — and
    // not unsubscribed). Defense in depth, same bar as marketing sends.
    if (await isSuppressed(e)) return { issued: false, reason: "suppressed" };
    if (!(await canSendMarketing(e))) return { issued: false, reason: "not_eligible" };

    // GATE 2 — the delivery email is commercial: no unsubscribe link, no send,
    // and therefore no code either (checked BEFORE the claim so eligibility
    // isn't consumed by a config problem).
    const unsubToken = buildUnsubscribeToken(e);
    if (!unsubToken) {
      reportError(new Error("welcome code skipped: no unsubscribe secret configured"), {
        route: "lib/welcome-discount",
        phase: "unsubscribe_gate",
      });
      return { issued: false, reason: "no_unsubscribe" };
    }
    const unsubscribeUrl = `${getBaseUrl()}/api/unsubscribe?token=${encodeURIComponent(unsubToken)}`;

    // GATE 3 — the once-ever claim. The customer row normally exists (created
    // at email capture); if it's missing (e.g. the best-effort linking failed
    // back then), find-or-create it now so the guarantee still has its anchor.
    let customerId = await claimWelcomeIssuance(e);
    if (customerId == null) {
      const existing = await getCustomerByEmail(e);
      if (existing) {
        // Row exists but the claim didn't go through → already issued/claimed.
        return { issued: false, reason: "already_issued" };
      }
      await linkCustomerOnEmailCapture({ email: e, sessionId: null });
      customerId = await claimWelcomeIssuance(e);
      if (customerId == null) return { issued: false, reason: "no_customer" };
    }

    // GATE 4 — mint via the shared Shopify path (single-use: usageLimit 1 +
    // appliesOncePerCustomer), own prefix and expiry. On failure, release the
    // claim so the customer's one chance survives a transient Shopify error.
    const percent = welcomeDiscountPercent();
    const minted = await createUniqueDiscountCode({
      percentage: percent / 100,
      title: `Willkommensrabatt (${percent}%) — Neukunden-Begrüßung`,
      codePrefix: WELCOME_CODE_PREFIX,
      expiryDays: welcomeExpiryDays(),
    });
    if (!minted) {
      await revertWelcomeIssuance(customerId);
      return { issued: false, reason: "mint_failed" };
    }

    // RECORD before SEND — the customer row is the source of truth; if the
    // email below fails, the dashboard still shows the live code.
    await recordWelcomeCode(customerId, minted);

    // DELIVERY — the first email after confirmation, through the unified
    // branded template, with the terms (single-use, concrete expiry date)
    // stated in the text. The redeem link is Shopify's discount share URL,
    // which applies the code automatically.
    const { text, html } = welcomeEmailBody({
      code: minted.code,
      percent,
      expiresLabel: formatGermanExpiryDate(minted.expiresAt),
      redeemUrl: `https://www.motionsports.de/discount/${encodeURIComponent(minted.code)}`,
      unsubscribe: unsubscribeFooter(unsubscribeUrl),
    });
    const sent = await sendEmail({
      to: e,
      subject: WELCOME_EMAIL_SUBJECT,
      text,
      html,
      kind: "welcome",
    });
    // A real send failure is already reported by lib/email; the issued code
    // stays recorded (it is live in Shopify) and visible on the dashboard.
    return { issued: true, code: minted.code, emailSent: sent.ok };
  } catch (err) {
    reportError(err, { route: "lib/welcome-discount", phase: "issue" });
    return { issued: false, reason: "error" };
  }
}
