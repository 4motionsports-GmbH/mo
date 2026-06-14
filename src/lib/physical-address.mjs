// PHYSICAL-MAIL address eligibility — the spike's PRODUCT BLOCKER, made into a
// pure, testable decision (docs/EMAIL_SUBSYSTEM_SPIKE.md §4).
//
// We do NOT reliably hold full postal addresses. Only a future consented-capture
// / purchase-derived flow writes customers.postal_address; the tier-3 account
// snapshot stays minimised to city/country. So physical mail is scoped to
// recipients whose FULL address we hold LAWFULLY — and we NEVER guess or
// part-fill an address. A customer with no complete lawful address cannot be
// posted to, and "Brief senden" is DISABLED with a clear reason.
//
// Pure (no I/O) so the rule with legal/operational consequences is unit-tested.

/** The address fields that MUST all be present for a postable letter. A missing
 *  field is a hard stop — we refuse rather than part-fill. (line_2 + company are
 *  genuinely optional and intentionally excluded.) */
export const REQUIRED_ADDRESS_FIELDS = [
  "name",
  "address_line_1",
  "postal_code",
  "city",
  "country",
];

/** ISO-3166 alpha-2 — a 2-letter country code, the form Pingen/DP expect. */
function isIsoCountry(value) {
  return typeof value === "string" && /^[A-Za-z]{2}$/.test(value.trim());
}

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Validate a stored postal address into a complete, normalised recipient — or
 * report exactly which required fields are missing. NEVER part-fills: any
 * missing/blank required field ⇒ { ok: false }.
 *
 * @param {Record<string, unknown> | null | undefined} address
 * @returns {{ ok: true, address: {
 *             name: string, company: string | null,
 *             addressLine1: string, addressLine2: string | null,
 *             postalCode: string, city: string, country: string } }
 *          | { ok: false, missing: string[] }}
 */
export function validateFullAddress(address) {
  if (!address || typeof address !== "object") {
    return { ok: false, missing: [...REQUIRED_ADDRESS_FIELDS] };
  }
  const a = /** @type {Record<string, unknown>} */ (address);
  const missing = [];
  for (const field of REQUIRED_ADDRESS_FIELDS) {
    if (!clean(a[field])) missing.push(field);
  }
  // A present-but-malformed country is as unusable as a missing one.
  if (!missing.includes("country") && !isIsoCountry(a.country)) {
    missing.push("country");
  }
  if (missing.length > 0) return { ok: false, missing };

  return {
    ok: true,
    address: {
      name: clean(a.name),
      company: clean(a.company) || null,
      addressLine1: clean(a.address_line_1),
      addressLine2: clean(a.address_line_2) || null,
      postalCode: clean(a.postal_code),
      city: clean(a.city),
      country: clean(a.country).toUpperCase(),
    },
  };
}

/**
 * Decide whether physical mail may be sent to a recipient, and WHY NOT when it
 * can't — the single source of truth behind both the disabled "Brief senden"
 * button and the server-side refusal in lib/physical-mail.
 *
 * Order of checks is deliberate so the UI shows the MOST actionable reason:
 *   1. no lawful full address       → the product blocker (most common today)
 *   2. address present but incomplete→ never part-fill; say what's missing
 *   3. Pingen not configured        → ops/env
 *   4. flag not approved            → legal/DPA sign-off (PHYSICAL_MAIL_SENDS_APPROVED)
 * When every check passes, `address` is the normalised recipient to post to.
 *
 * @param {{ flagApproved: boolean, pingenConfigured: boolean,
 *           address: Record<string, unknown> | null | undefined }} input
 * @returns {{ eligible: boolean, reasonCode: string | null,
 *             reason: string | null,
 *             address: ReturnType<typeof validateFullAddress> extends { ok: true }
 *               ? object : object | null }}
 */
export function decidePhysicalEligibility(input) {
  const { flagApproved, pingenConfigured, address } = input;

  const validated = validateFullAddress(address);
  if (!validated.ok) {
    // Distinguish "nothing held" from "held but incomplete" so the reason is honest.
    const nothingHeld =
      validated.missing.length === REQUIRED_ADDRESS_FIELDS.length;
    return nothingHeld
      ? {
          eligible: false,
          reasonCode: "no_address",
          reason:
            "Keine vollständige Postadresse mit Rechtsgrundlage hinterlegt — " +
            "Brief kann nicht versendet werden (Adresse wird nie geraten).",
          address: null,
        }
      : {
          eligible: false,
          reasonCode: "incomplete_address",
          reason:
            "Postadresse unvollständig (fehlt: " +
            validated.missing.join(", ") +
            ") — wird nicht teilweise ergänzt.",
          address: null,
        };
  }

  if (!pingenConfigured) {
    return {
      eligible: false,
      reasonCode: "pingen_not_configured",
      reason:
        "Pingen ist nicht konfiguriert (PINGEN_CLIENT_ID / PINGEN_CLIENT_SECRET / " +
        "PINGEN_ORGANISATION_ID).",
      address: validated.address,
    };
  }

  if (!flagApproved) {
    return {
      eligible: false,
      reasonCode: "flag_off",
      reason:
        "Physischer Versand ist noch nicht freigeschaltet — wartet auf den " +
        "AV-Vertrag (Pingen/CH) und die Freigabe (PHYSICAL_MAIL_SENDS_APPROVED).",
      address: validated.address,
    };
  }

  return { eligible: true, reasonCode: null, reason: null, address: validated.address };
}
