// Admin PII-access audit trail (migration 0028, LEGAL_READINESS_REPORT §8 OQ-15).
//
// recordAdminAccess() writes one row per sensitive admin action so there is a
// record of which customer's data an operator pulled. Best-effort and fail-soft:
// no DB, a write failure, or a missing cookie never blocks the admin action it
// is auditing (the action's own guard is the real gate; this only observes).
//
// "Who": the admin login is a single shared password, so we cannot store a named
// user. We store a SHA-256 fingerprint of the signed session cookie (never the
// cookie value) so distinct operators are distinguishable, plus the client IP.

import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { getSql } from "./db";
import { ADMIN_COOKIE_NAME } from "./admin-auth";
import { clientIp } from "./rate-limit";
import { reportError } from "./observability";

export interface AdminAccessEntry {
  /** Dotted action key, e.g. 'customer.profile.generate'. */
  action: string;
  /** Which customer's data was accessed (internal id), when applicable. */
  targetCustomerId?: number | null;
  /** Small, non-sensitive context (ids/counts) — never PII bodies. */
  detail?: Record<string, unknown>;
}

/** SHA-256 fingerprint (hex, truncated) of the admin session cookie, or null. */
async function sessionFingerprint(): Promise<string | null> {
  try {
    const token = (await cookies()).get(ADMIN_COOKIE_NAME)?.value;
    if (!token) return null;
    return createHash("sha256").update(token).digest("hex").slice(0, 16);
  } catch {
    return null;
  }
}

/**
 * Record one admin PII-access event. Never throws; no DB → no-op. Call AFTER the
 * action's own auth/guard has passed, with the resolved target customer id.
 */
export async function recordAdminAccess(
  entry: AdminAccessEntry,
  req: Request
): Promise<void> {
  const sql = getSql();
  if (!sql) return;
  try {
    const fp = await sessionFingerprint();
    const ip = clientIp(req);
    await sql`
      INSERT INTO admin_access_log (action, target_customer_id, detail, ip, session_fp)
      VALUES (
        ${entry.action},
        ${entry.targetCustomerId ?? null},
        ${JSON.stringify(entry.detail ?? {})}::jsonb,
        ${ip},
        ${fp}
      )
    `;
  } catch (err) {
    reportError(err, { route: "lib/admin-access-log", phase: "recordAdminAccess" });
  }
}
