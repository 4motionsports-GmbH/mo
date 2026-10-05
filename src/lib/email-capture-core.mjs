// The marketing double-opt-in decision of one e-mail capture upsert
// (email-capture-store.ts → upsertEmailCapture). Pure: the store reads the
// existing row and the suppression list, this decides what to write.

/**
 * @typedef {"none" | "pending" | "confirmed"} DoiStatus
 * @typedef {{ status: DoiStatus, token: string | null, sentAt: string | null }} ExistingDoi
 */

/**
 * Rules:
 *   - already `confirmed` → stays confirmed with its token and send time
 *     (re-submitting never resets it; only an explicit unsubscribe revokes it);
 *   - marketing ticked, address already subscribed elsewhere (the one consent)
 *     → no new token, no DOI mail; a `pending` DOI keeps token and send time;
 *   - marketing ticked, not suppressed → `pending`, a new token, sent now;
 *   - marketing NOT ticked now (e.g. only the summary) but a DOI is still
 *     `pending` and the address is not suppressed → the pending DOI stays as
 *     it is (token, send time, marketing flag), so the link already in the
 *     inbox keeps working until it expires;
 *   - otherwise (not ticked or suppressed) → `none`, no token.
 *
 * @param {{
 *   marketingConsent: boolean,
 *   alreadySubscribed?: boolean,
 *   suppressed: boolean,
 *   existing: ExistingDoi | null | undefined,
 *   newToken: () => string,
 *   now: string,
 * }} input
 * @returns {{ status: DoiStatus, doiToken: string | null, doiSentAt: string | null,
 *             doiEmailRequired: boolean, marketingConsentColumn: boolean }}
 */
export function decideCaptureDoi(input) {
  const ex = input.existing ?? null;
  const confirmed = ex?.status === "confirmed";
  const pending = ex?.status === "pending";
  const keep = (status) => ({
    status,
    doiToken: ex?.token ?? null,
    doiSentAt: ex?.sentAt ?? null,
    doiEmailRequired: false,
  });

  if (confirmed) {
    return { ...keep("confirmed"), marketingConsentColumn: true };
  }
  if (input.marketingConsent && !input.suppressed && input.alreadySubscribed) {
    if (pending) return { ...keep("pending"), marketingConsentColumn: true };
    return { status: "none", doiToken: null, doiSentAt: null, doiEmailRequired: false, marketingConsentColumn: true };
  }
  if (input.marketingConsent && !input.suppressed) {
    return {
      status: "pending",
      doiToken: input.newToken(),
      doiSentAt: input.now,
      doiEmailRequired: true,
      marketingConsentColumn: true,
    };
  }
  if (pending && !input.suppressed) {
    return { ...keep("pending"), marketingConsentColumn: true };
  }
  return {
    status: "none",
    doiToken: null,
    doiSentAt: null,
    doiEmailRequired: false,
    marketingConsentColumn: Boolean(input.marketingConsent),
  };
}
