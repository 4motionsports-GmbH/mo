// I/O wrappers for the one-time sign-in grants (customer-link-grant.mjs,
// migration 0073): null-safe, never throw, report errors. A database problem
// fails CLOSED — no grant, no link, the session stays signed out.

import { getSql, type Sql } from "./db";
import { reportError } from "./observability";
import {
  createLinkGrant,
  downgradeCustomerAccountLink,
  purgeExpiredLinkGrants,
  redeemLinkGrant,
  unlinkAppProxySession,
  unlinkSessionSignedIn,
  unlinkSignedInSessions,
} from "./customer-link-grant.mjs";
import { resolveSignedInLink } from "./customer-session-link.mjs";

/** Mint a one-time code for the session that started a verified sign-in. */
export async function mintSessionLinkGrant(
  input: { sessionId: string | null; customerId: number; kind: "customer_account" | "app_proxy" },
  sql: Sql | null = getSql()
): Promise<string | null> {
  if (!sql) return null;
  try {
    return await createLinkGrant(sql, input);
  } catch (err) {
    reportError(err, { route: "lib/session-link-grants", phase: "mint" });
    return null;
  }
}

/** Redeem a code for the presenting session (POST /api/auth/link). */
export async function redeemSessionLinkGrant(
  input: { code: unknown; sessionId: string | null },
  sql: Sql | null = getSql()
): Promise<
  | { ok: true; customerId: number; kind: string; renewed: boolean; priorKind: string | null }
  | { ok: false; reason: "invalid" | "session_mismatch" | "unavailable"; kind: string | null }
> {
  if (!sql) return { ok: false, reason: "unavailable", kind: null };
  try {
    const r = await redeemLinkGrant(sql, input);
    return r.ok
      ? { ok: true, customerId: r.customerId, kind: String(r.kind), renewed: r.renewed, priorKind: r.priorKind }
      : { ok: false, reason: r.reason, kind: r.kind };
  } catch (err) {
    reportError(err, { route: "lib/session-link-grants", phase: "redeem" });
    return { ok: false, reason: "unavailable", kind: null };
  }
}

/** The session's current signed-in link (any proof), or null. Never throws. */
export async function currentSignedInLink(
  sessionId: string | null,
  sql: Sql | null = getSql()
): Promise<{ customerId: number; shopifyCustomerId: string; linkKind: string } | null> {
  if (!sql || !sessionId) return null;
  try {
    return await resolveSignedInLink(sql, sessionId);
  } catch (err) {
    reportError(err, { route: "lib/session-link-grants", phase: "currentLink" });
    return null;
  }
}

/** Handover: end only this session's signed-in link. */
export async function endSessionSignedInLink(
  sessionId: string | null,
  sql: Sql | null = getSql()
): Promise<void> {
  if (!sql || !sessionId) return;
  try {
    await unlinkSessionSignedIn(sql, sessionId);
  } catch (err) {
    reportError(err, { route: "lib/session-link-grants", phase: "handover" });
  }
}

/** A dead Customer Account link re-proven by the shop becomes an App Proxy link. */
export async function downgradeDeadCustomerAccountLink(
  sessionId: string | null,
  customerId: number,
  sql: Sql | null = getSql()
): Promise<boolean> {
  if (!sql || !sessionId) return false;
  try {
    return await downgradeCustomerAccountLink(sql, sessionId, customerId);
  } catch (err) {
    reportError(err, { route: "lib/session-link-grants", phase: "downgrade" });
    return false;
  }
}

/** Logout / revoked token: end every signed-in link of the customer (Customer Account and App Proxy) and the session's. */
export async function signOutSessionLinks(
  input: { customerId: number; sessionId?: string | null },
  sql: Sql | null = getSql()
): Promise<number> {
  if (!sql) return 0;
  try {
    return await unlinkSignedInSessions(sql, input);
  } catch (err) {
    reportError(err, { route: "lib/session-link-grants", phase: "signOut" });
    return 0;
  }
}

/** The shop reports this session's browser as logged out: drop its App Proxy link. */
export async function endAppProxySessionLink(
  sessionId: string | null,
  sql: Sql | null = getSql()
): Promise<void> {
  if (!sql || !sessionId) return;
  try {
    await unlinkAppProxySession(sql, sessionId);
  } catch (err) {
    reportError(err, { route: "lib/session-link-grants", phase: "endAppProxy" });
  }
}

/** Retention: grants a day past expiry. */
export async function purgeSessionLinkGrants(sql: Sql | null = getSql()): Promise<number> {
  if (!sql) return 0;
  try {
    return await purgeExpiredLinkGrants(sql);
  } catch (err) {
    reportError(err, { route: "lib/session-link-grants", phase: "purge" });
    return 0;
  }
}
