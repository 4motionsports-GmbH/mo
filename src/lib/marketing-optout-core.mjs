// Manual control over a person's marketing opt-out (the local block list).
//
// Every way an address gets blocked writes `suppression_list.reason`:
//   unsubscribe — the "Abmelden" link in one of our mails
//   manual      — the operator in the dashboard ("Abmelden", e.g. on request)
//   bounce      — Resend reported a hard bounce (address undeliverable)
//   complaint   — the recipient marked a mail as spam
//   erasure     — complete deletion (the person no longer exists here)
//
// Lifting a block ("Abmeldung aufheben") is only allowed where it can be an
// operator's call: an unsubscribe that was a mistake, or a manual opt-out the
// person has taken back. Bounces, spam complaints and erasures stay — sending
// there again hurts deliverability or ignores the person's explicit choice.

/** @type {Record<string, { label: string, liftable: boolean, why: string | null }>} */
export const OPT_OUT_REASONS = {
  unsubscribe: { label: "Abmeldelink in einer E-Mail", liftable: true, why: null },
  manual: { label: "Manuell im Dashboard abgemeldet", liftable: true, why: null },
  bounce: {
    label: "Unzustellbar (harter Bounce)",
    liftable: false,
    why: "Die Adresse ist unzustellbar — eine erneute Sendung schadet der Zustellbarkeit aller Mails.",
  },
  complaint: {
    label: "Als Spam gemeldet",
    liftable: false,
    why: "Die Person hat eine Mail als Spam gemeldet — diese Sperre wird nicht aufgehoben.",
  },
  erasure: {
    label: "Daten gelöscht",
    liftable: false,
    why: "Die Person hat ihre Daten löschen lassen — die Sperre bleibt dauerhaft.",
  },
};

/** German label for a block reason (unknown / legacy NULL → "Abgemeldet"). */
export function optOutReasonLabel(reason) {
  return (reason && OPT_OUT_REASONS[reason]?.label) || "Abgemeldet";
}

/**
 * May the operator lift this block? Unknown or legacy (NULL) reasons came
 * from the unsubscribe path, so they are liftable like `unsubscribe`.
 * @returns {{ allowed: boolean, why: string | null }}
 */
export function liftDecision(reason) {
  const meta = reason ? OPT_OUT_REASONS[reason] : null;
  if (!meta) return { allowed: true, why: null };
  return { allowed: meta.liftable, why: meta.why };
}

/**
 * The opt-out state of one address from its two records: the block-list row
 * (reason + added_at) and the chat consent capture (unsubscribed_at).
 * @param {{ reason: string | null, addedAt: string | null } | null} suppression
 * @param {string | null} captureUnsubscribedAt
 */
export function optOutState(suppression, captureUnsubscribedAt) {
  const blocked = Boolean(suppression) || Boolean(captureUnsubscribedAt);
  if (!blocked) {
    return { blocked: false, reason: null, label: null, since: null, canLift: false, liftBlockedWhy: null };
  }
  const reason = suppression ? suppression.reason ?? null : "unsubscribe";
  const decision = liftDecision(reason);
  return {
    blocked: true,
    reason,
    label: optOutReasonLabel(reason),
    since: (suppression && suppression.addedAt) || captureUnsubscribedAt || null,
    canLift: decision.allowed,
    liftBlockedWhy: decision.why,
  };
}
