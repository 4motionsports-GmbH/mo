// I/O wrappers for the one-time sign-in grants (customer-link-grant.mjs,
// migration 0073): null-safe, never throw, report errors. A database problem
// fails CLOSED — no grant, no link, the session stays signed out.

import { getSql, type Sql } from "./db";
import { reportError } from "./observability";
import {
  createLinkGrant,
  purgeExpiredLinkGrants,
  redeemLinkGrant,
  unlinkAppProxySession,
  unlinkSignedInSessions,
} from "./customer-link-grant.mjs";

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
  | { ok: true; customerId: number; kind: string }
  | { ok: false; reason: "invalid" | "session_mismatch" | "unavailable" }
> {
  if (!sql) return { ok: false, reason: "unavailable" };
  try {
    const r = await redeemLinkGrant(sql, input);
    return r.ok ? { ok: true, customerId: r.customerId, kind: String(r.kind) } : { ok: false, reason: r.reason };
  } catch (err) {
    reportError(err, { route: "lib/session-link-grants", phase: "redeem" });
    return { ok: false, reason: "unavailable" };
  }
}

/** Logout / revoked token: end every signed-in link of the customer (and the session's). */
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
