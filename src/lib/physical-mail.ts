// Send-through-system for PHYSICAL letters — the Pingen analogue of
// lib/marketing-email.approveAndSend. ONE auditable path that concentrates every
// gate so no caller can bypass them (docs/EMAIL_SUBSYSTEM_SPIKE.md §4):
//
//   1. FLAG — PHYSICAL_MAIL_SENDS_APPROVED must be on (Pingen is a NEW processor
//      → CH → Deutsche Post; needs its own DPA). OFF ⇒ nothing is posted.
//   2. ADDRESS — the recipient must have a COMPLETE, LAWFULLY-held postal address
//      (lib/physical-address). No address / incomplete ⇒ refuse; never part-fill.
//   3. CONTENT — the SAME personalised content as the email draft (the marketing
//      _sends row's subject + body) is rendered to a letter PDF with the address
//      block where Pingen reads it (address_position 'left').
//   4. SUBMIT — Pingen uploadAndCreate (auto_send) with an Idempotency-Key seeded
//      by the physical_letters row id, so a retry never prints twice.
//
// The "Brief senden" button mirrors the email-draft flow: it acts on an existing
// per-customer marketing draft (personalised content + bundles + operator
// instructions already baked into draftedText) → letter PDF → Pingen → status.

import { getSendById } from "./marketing-store";
import { getCustomerById } from "./customer-store";
import { decidePhysicalEligibility } from "./physical-address.mjs";
import {
  createPhysicalLetter,
  markPhysicalLetterFailed,
  markPhysicalLetterSubmitted,
  type RecipientAddress,
} from "./physical-letters-store";
import { buildLetterPdf } from "./letter-pdf.mjs";
import { isPingenConfigured, uploadAndCreate } from "./pingen";
import { isPhysicalMailSendsApproved } from "./pingen-flag.mjs";
import type { Customer } from "./customer-store";
import { reportError } from "./observability";

/** The shape physical-address.decidePhysicalEligibility returns (typed here so
 *  the .mjs stays plain). */
export interface PhysicalEligibility {
  eligible: boolean;
  reasonCode: string | null;
  reason: string | null;
  address: RecipientAddress | null;
}

/**
 * Compute physical-mail eligibility for a customer — the single source of truth
 * behind both the disabled "Brief senden" button (page.tsx) and the server
 * refusal below. Reads the lawful address store + the flag + Pingen config.
 */
export function physicalEligibilityForCustomer(
  customer: Pick<Customer, "id" | "postalAddress">
): PhysicalEligibility {
  return decidePhysicalEligibility({
    flagApproved: isPhysicalMailSendsApproved(),
    pingenConfigured: isPingenConfigured(),
    address: customer.postalAddress ?? null,
  }) as PhysicalEligibility;
}

export type SendPhysicalLetterResult =
  | { ok: true; letterId: number; providerLetterId: string; status: string }
  | {
      ok: false;
      reason:
        | "not_found"
        | "flag_off"
        | "no_address"
        | "incomplete_address"
        | "pingen_not_configured"
        | "submit_failed"
        | "store_failed";
      message: string;
    };

/**
 * Submit a physical letter for an existing marketing draft (the "Brief senden"
 * action). Reuses the draft's personalised content as the letter body. Never
 * throws — returns a typed refusal/result.
 */
export async function sendPhysicalLetterForSend(sendId: number): Promise<SendPhysicalLetterResult> {
  try {
    const send = await getSendById(sendId);
    if (!send) return { ok: false, reason: "not_found", message: "Entwurf nicht gefunden." };
    if (send.customerId == null) {
      return { ok: false, reason: "not_found", message: "Entwurf ist keinem Kunden zugeordnet." };
    }
    const customer = await getCustomerById(send.customerId);
    if (!customer) return { ok: false, reason: "not_found", message: "Kunde nicht gefunden." };

    // GATES 1+2 (+ config) in one decision — the same one the UI used to enable
    // the button, re-checked server-side (defense in depth, fail-closed).
    const eligibility = physicalEligibilityForCustomer(customer);
    if (!eligibility.eligible || !eligibility.address) {
      const reason = (eligibility.reasonCode ?? "no_address") as
        | "flag_off"
        | "no_address"
        | "incomplete_address"
        | "pingen_not_configured";
      return { ok: false, reason, message: eligibility.reason ?? "Nicht versandfähig." };
    }
    const recipient = eligibility.address;

    // GATE 3 — render the SAME personalised content as the email draft to a PDF
    // with the address block where Pingen reads it.
    const pdf = buildLetterPdf({
      recipient,
      subject: send.subject,
      body: send.draftedText ?? "",
    });

    // Create the audit row FIRST so its id seeds a stable Idempotency-Key.
    const letterId = await createPhysicalLetter({
      customerId: customer.id,
      marketingSendId: sendId,
      recipient,
    });
    if (letterId == null) {
      return { ok: false, reason: "store_failed", message: "Brief konnte nicht angelegt werden (DB)." };
    }

    // GATE 4 — Pingen uploadAndCreate (auto_send). Idempotency-Key keyed by the row.
    const result = await uploadAndCreate({
      pdf,
      fileOriginalName: `brief-${letterId}.pdf`,
      idempotencyKey: `physical-letter-${letterId}`,
      autoSend: true,
      options: { addressPosition: "left", deliveryProduct: "fast", printSpectrum: "grayscale" },
    });

    if (!result.ok) {
      await markPhysicalLetterFailed(letterId, result.message);
      return { ok: false, reason: "submit_failed", message: `Pingen: ${result.message}` };
    }

    await markPhysicalLetterSubmitted(
      letterId,
      result.letter.id,
      result.letter.status,
      result.letter.costCents
    );

    return {
      ok: true,
      letterId,
      providerLetterId: result.letter.id,
      status: result.letter.status,
    };
  } catch (err) {
    reportError(err, { route: "lib/physical-mail", phase: "sendPhysicalLetterForSend" });
    return { ok: false, reason: "submit_failed", message: "Unerwarteter Fehler beim Versand." };
  }
}
