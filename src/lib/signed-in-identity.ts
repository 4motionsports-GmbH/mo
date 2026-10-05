// Shared signed-in (tier-3) identity helpers — the SINGLE definition of the
// display-name derivation and the at-sign-in marketing opt-in actionability rule,
// used by BOTH detection paths (/api/auth/me for chatbot-OAuth, /api/auth/storefront
// for shop-native via App Proxy). Keeping them here means the consent contract —
// "when do we surface the at-sign-in opt-in" — cannot drift between the two routes.

import { getCustomerById, type CustomerMarketingStatus } from "./customer-store";
import { reportError } from "./observability";
import { getSql } from "./db";
import { isConsentAskQuiet } from "./consent-ask-policy.mjs";
import { KPI_CONSENT_GATE_DECLINED, KPI_CONSENT_GATE_SHOWN } from "./kpi-events";

// A tier-3 row created with no verified Shopify email claim is keyed by this
// synthetic placeholder — it can't receive a DOI / marketing mail, so the
// at-sign-in opt-in is NOT actionable for it (mirrors marketing-opt-in's refusal).
export const SYNTHETIC_EMAIL_PREFIX = "shopify:";

/** True when `email` is a real, mailable address (not the synthetic placeholder). */
function hasRealEmail(email: string | null | undefined): boolean {
  return !!email && email.includes("@") && !email.startsWith(SYNTHETIC_EMAIL_PREFIX);
}

/** Best available display name (displayName → first+last → null). Structurally
 *  typed so it works for both the Customer-Account and Admin-API identity shapes. */
export function displayNameOf(identity: {
  displayName: string | null;
  firstName: string | null;
  lastName: string | null;
}): string | null {
  if (identity.displayName?.trim()) return identity.displayName.trim();
  const joined = [identity.firstName, identity.lastName]
    .map((s) => (s ?? "").trim())
    .filter(Boolean)
    .join(" ");
  return joined || null;
}

export interface MarketingOptInState {
  status: CustomerMarketingStatus;
  /** true ⇔ surface the at-sign-in opt-in card (real email + no DOI decision yet). */
  optInActionable: boolean;
}

/**
 * The at-sign-in marketing opt-in state for a signed-in customer (CA-4): surface
 * the opt-in card ONLY for a customer who has NOT recorded a marketing decision
 * AND has a real (mailable) verified email. The status is the ONE consent
 * (Shopify or Mo): a customer subscribed in Shopify reads "confirmed" and is
 * never asked again. Any DOI decision already on record
 * (pending / confirmed / unsubscribed) — or a synthetic placeholder email — makes
 * it non-actionable, and so does a decline of the popup in any of the
 * customer's sessions in the last 30 days or the popup shown in 3 sessions
 * (anti-nag). Best-effort + fail-closed: a read failure degrades to
 * "not actionable" (never invite an opt-in we can't substantiate) and is logged.
 */
export async function resolveMarketingOptInState(
  customerId: number,
  route: string
): Promise<MarketingOptInState> {
  try {
    const customer = await getCustomerById(customerId);
    if (!customer) return { status: "none", optInActionable: false };
    const actionable = hasRealEmail(customer.email) && customer.marketingStatus === "none";
    return {
      status: customer.marketingStatus,
      optInActionable: actionable && !(await consentAskQuiet(customerId)),
    };
  } catch (err) {
    reportError(err, { route, phase: "marketingState" });
    return { status: "none", optInActionable: false };
  }
}

/**
 * Per-customer anti-nag (P0.3 Phase 2, consent-ask-policy.mjs): across ALL the
 * customer's linked sessions in the last 30 days, a decline of the consent
 * popup — or the popup shown in 3 sessions — stops the ask. The widget only
 * remembers per device / tab. Throws to the caller, which fails closed.
 */
async function consentAskQuiet(customerId: number): Promise<boolean> {
  const sql = getSql();
  if (!sql) return true;
  const rows = (await sql`
    SELECT count(DISTINCT k.session_id) FILTER (WHERE k.event = ${KPI_CONSENT_GATE_DECLINED})::int AS declined_sessions,
           count(DISTINCT k.session_id) FILTER (WHERE k.event = ${KPI_CONSENT_GATE_SHOWN})::int    AS shown_sessions
      FROM customer_session_links l
      JOIN kpi_events k ON k.session_id = l.session_id
     WHERE l.customer_id = ${customerId}
       AND k.event IN (${KPI_CONSENT_GATE_SHOWN}, ${KPI_CONSENT_GATE_DECLINED})
       AND k.data->>'surface' = 'signin'
       AND k.created_at >= now() - interval '30 days'
  `) as Array<{ declined_sessions: number; shown_sessions: number }>;
  return isConsentAskQuiet({
    declinedSessions: rows[0]?.declined_sessions ?? 0,
    shownSessions: rows[0]?.shown_sessions ?? 0,
  });
}
