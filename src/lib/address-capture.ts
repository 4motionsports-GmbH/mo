// Background auto-capture of lawful postal addresses (physical mail, §4).
//
// So the operator never has to press "Käufe aktualisieren" per customer just to
// get an address: on each Kunden-tab load we pull missing addresses from Shopify
// in the BACKGROUND (Next `after()`), bounded + throttled. Each pass handles a
// small batch of customers that have no stored address and haven't been checked
// recently; over a few visits everyone with a usable address is filled in, and
// customers with genuinely no address aren't re-queried every load.
//
// ⚠️ GDPR — DATA MINIMISATION + LAWFUL ACQUISITION (LEGAL_READINESS_REPORT §8
// OQ-01). A full postal address is collected here ONLY when BOTH hold:
//   1. PHYSICAL_MAIL_SENDS_APPROVED is on — the address serves no purpose unless
//      the physical-mail channel is actually live, so we don't collect it for a
//      dormant feature; and
//   2. the address is PURCHASE-derived (the shipping address of a completed
//      order — obtained "in connection with the sale", a real basis). The saved
//      Shopify account default address (source 'consented_capture') is NOT
//      auto-stored here, because no consent for postal use was actually verified
//      — that path is reserved for a future, explicitly-consented capture flow.
// READ from Shopify only; writes only customers.postal_address (+ the checked-at
// throttle). Best-effort and fail-soft — never throws into the page render.

import {
  listCustomersMissingAddress,
  markPostalAddressChecked,
  saveCustomerPostalAddress,
} from "./customer-store";
import { fetchLawfulAddressByEmail } from "./shopify-orders";
import { isShopifyConfigured } from "./shopify";
import { isPhysicalMailSendsApproved } from "./pingen-flag.mjs";
import { reportError } from "./observability";

export interface AutoCaptureResult {
  checked: number;
  captured: number;
}

/**
 * Capture missing postal addresses for up to `limit` customers (sequential, to
 * stay well within Shopify's rate limits — this runs in the background, so
 * latency doesn't matter). Returns how many were checked / actually captured.
 */
export async function autoCaptureMissingAddresses(
  { limit = 12, throttleDays = 7 }: { limit?: number; throttleDays?: number } = {}
): Promise<AutoCaptureResult> {
  if (!isShopifyConfigured()) return { checked: 0, captured: 0 };
  // Don't collect addresses for a channel that isn't live (data minimisation).
  if (!isPhysicalMailSendsApproved()) return { checked: 0, captured: 0 };
  try {
    const staleBefore = new Date(Date.now() - throttleDays * 86_400_000).toISOString();
    const candidates = await listCustomersMissingAddress(limit, staleBefore);
    let captured = 0;
    for (const c of candidates) {
      try {
        const lawful = await fetchLawfulAddressByEmail(c.email);
        // PURCHASE-derived only: a completed order's shipping address is a lawful,
        // sale-derived basis. Never auto-store the account default ('consented_
        // capture') here — that needs a verified consent we don't have.
        if (lawful && lawful.source === "purchase") {
          await saveCustomerPostalAddress(c.id, lawful.address, lawful.source);
          captured++;
        }
      } catch (err) {
        // One customer failing must not stop the batch.
        reportError(err, { route: "lib/address-capture", phase: "one" });
      }
      // Stamp the attempt either way so a no-address customer isn't re-queried
      // every load (only after the throttle window).
      await markPostalAddressChecked(c.id);
    }
    return { checked: candidates.length, captured };
  } catch (err) {
    reportError(err, { route: "lib/address-capture", phase: "batch" });
    return { checked: 0, captured: 0 };
  }
}
