// Shared signed-in (tier-3) identity helpers — the SINGLE definition of the
// display-name derivation and the at-sign-in marketing opt-in actionability rule,
// used by BOTH detection paths (/api/auth/me for chatbot-OAuth, /api/auth/storefront
// for shop-native via App Proxy). Keeping them here means the consent contract —
// "when do we surface the at-sign-in opt-in" — cannot drift between the two routes.

import { getCustomerById, type CustomerMarketingStatus } from "./customer-store";
import { reportError } from "./observability";

// A tier-3 row created with no verified Shopify email claim is keyed by this
// synthetic placeholder — it can't receive a DOI / marketing mail, so the
// at-sign-in opt-in is NOT actionable for it (mirrors marketing-opt-in's refusal).
export const SYNTHETIC_EMAIL_PREFIX = "shopify:";

/** True when `email` is a real, mailable address (not the synthetic placeholder). */
export function hasRealEmail(email: string | null | undefined): boolean {
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
 * AND has a real (mailable) verified email. Any DOI decision already on record
 * (pending / confirmed / unsubscribed) — or a synthetic placeholder email — makes
 * it non-actionable. Best-effort + fail-closed: a read failure degrades to
 * "not actionable" (never invite an opt-in we can't substantiate) and is logged.
 */
export async function resolveMarketingOptInState(
  customerId: number,
  route: string
): Promise<MarketingOptInState> {
  try {
    const customer = await getCustomerById(customerId);
    if (!customer) return { status: "none", optInActionable: false };
    return {
      status: customer.marketingStatus,
      optInActionable: hasRealEmail(customer.email) && customer.marketingStatus === "none",
    };
  } catch (err) {
    reportError(err, { route, phase: "marketingState" });
    return { status: "none", optInActionable: false };
  }
}
