// Mo's consent surfaces → the one consent (I/O glue).
//
// The capture form, the chat consent gate, the sign-in card, the DOI confirm
// link, the unsubscribe link and the admin opt-out all keep their own Art. 7
// evidence (email_captures) and their lawyer-approved copy, and additionally
// report their act to the shared consent (lib/consent-store.ts), which mirrors
// it to Shopify through the outbox. docs/CUSTOMER_PLATFORM_PLAN.md §7.4.
//
//   opt-in tap (pending)      → recordMoOptIn       → state pending (local only)
//   DOI link clicked          → recordDoiConfirmed  → subscribed / confirmed_opt_in
//                                                     → Shopify consent (or a new
//                                                       Shopify customer)
//   unsubscribe / admin / complaint → recordMoWithdrawal → unsubscribed → Shopify

import { getSql } from "./db";
import { reportError } from "./observability";
import { applyConsentAct, customerIdForEmail, getCustomerConsent, isSubscribed } from "./consent-store";
import { runOutboxInline } from "./shopify-outbox";
import type { ConsentSource } from "./consent-core.mjs";
import { signInProofNote } from "./signed-in-proof.mjs";

export type MoConsentSurface = "mo_capture_form" | "mo_chat_gate" | "mo_signin";

/**
 * Is this address already subscribed in the one consent (Shopify or Mo)?
 * Then a Mo surface records the tap but sends no DOI mail — the person is
 * subscribed already. Fail-safe: unknown → false (the normal DOI runs).
 */
export async function isEmailAlreadySubscribed(email: string): Promise<boolean> {
  try {
    const id = await customerIdForEmail(email);
    if (!id) return false;
    return isSubscribed(await getCustomerConsent(id));
  } catch (err) {
    reportError(err, { route: "lib/consent-flows", phase: "isEmailAlreadySubscribed" });
    return false;
  }
}

/** An opt-in tap on a Mo surface whose DOI mail went out (state pending).
 * `signInProof` (the opt-in after a sign-in): which sign-in stood behind it —
 * recorded as the consent_events note (Art. 7(1) evidence, P0.3). */
export async function recordMoOptIn(input: {
  email: string;
  surface: MoConsentSurface;
  captureId: number;
  doiPending: boolean;
  signInProof?: "token" | "shop" | null;
}): Promise<void> {
  if (!input.doiPending) return;
  const customerId = await customerIdForEmail(input.email);
  if (!customerId) return;
  await applyConsentAct({
    customerId,
    incoming: { state: "pending", at: new Date().toISOString(), source: input.surface },
    originRef: `email_capture:${input.captureId}`,
    note: signInProofNote(input.signInProof ?? null),
  });
}

/** The surface the person's latest pending opt-in came from (history), else "mo". */
async function pendingSurface(customerId: number): Promise<ConsentSource> {
  const sql = getSql();
  if (!sql) return "mo";
  try {
    const rows = (await sql`
      SELECT source FROM consent_events
       WHERE customer_id = ${customerId} AND state = 'pending'
       ORDER BY occurred_at DESC, id DESC LIMIT 1
    `) as Array<{ source: string }>;
    const s = rows[0]?.source;
    return s === "mo_capture_form" || s === "mo_chat_gate" || s === "mo_signin" ? s : "mo";
  } catch {
    return "mo";
  }
}

/**
 * The DOI link was clicked: the person is subscribed with a provable double
 * opt-in. Pushed to Shopify at once (best-effort inline; the outbox cron
 * retries) — a Mo-only subscriber becomes a Shopify customer with the consent.
 */
export async function recordDoiConfirmed(input: { email: string; captureId?: number | null }): Promise<void> {
  const customerId = await customerIdForEmail(input.email);
  if (!customerId) return;
  const res = await applyConsentAct({
    customerId,
    incoming: {
      state: "subscribed",
      level: "confirmed_opt_in",
      at: new Date().toISOString(),
      source: await pendingSurface(customerId),
    },
    originRef: input.captureId ? `email_capture:${input.captureId}` : "doi",
  });
  if (res) await runOutboxInline(res.outboxIds);
}

/**
 * A withdrawal: the unsubscribe link (reason unsubscribe), the admin opt-out
 * (manual) or a spam complaint (complaint). Pushed to Shopify at once.
 */
export async function recordMoWithdrawal(input: {
  email: string;
  reason: "unsubscribe" | "manual" | "complaint";
  note?: string | null;
}): Promise<void> {
  const customerId = await customerIdForEmail(input.email);
  if (!customerId) return;
  const res = await applyConsentAct({
    customerId,
    incoming: {
      state: "unsubscribed",
      at: new Date().toISOString(),
      source: input.reason === "manual" ? "admin" : "mo",
      reason: input.reason,
    },
    originRef: input.reason,
    note: input.note ?? null,
  });
  if (res) await runOutboxInline(res.outboxIds);
}

/**
 * "Abmeldung aufheben" (a mistaken opt-out, F-21): restore the consent the
 * person had before the withdrawal — level from the history — and push it to
 * Shopify. Without an earlier subscription in the history nothing is restored.
 */
export async function restoreConsentAfterLift(input: { email: string }): Promise<boolean> {
  const sql = getSql();
  const customerId = await customerIdForEmail(input.email);
  if (!sql || !customerId) return false;
  try {
    const rows = (await sql`
      SELECT level FROM consent_events
       WHERE customer_id = ${customerId} AND state = 'subscribed'
       ORDER BY occurred_at DESC, id DESC LIMIT 1
    `) as Array<{ level: string | null }>;
    if (!rows[0]) return false;
    const level = rows[0].level === "confirmed_opt_in" || rows[0].level === "single_opt_in" ? rows[0].level : "unknown";
    const res = await applyConsentAct({
      customerId,
      incoming: { state: "subscribed", level, at: new Date().toISOString(), source: "admin" },
      originRef: "admin",
      note: "Abmeldung aufgehoben (Versehen)",
    });
    if (res) await runOutboxInline(res.outboxIds);
    return Boolean(res?.changed);
  } catch (err) {
    reportError(err, { route: "lib/consent-flows", phase: "restoreConsentAfterLift" });
    return false;
  }
}
