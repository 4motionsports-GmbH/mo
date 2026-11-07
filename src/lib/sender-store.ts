// Sender identities („Absender“) — the I/O half: the operator's list in
// admin_settings (key 'email_senders', migration 0078's generic table), the
// allowed domains from the environment, and the one resolver every marketing
// send path uses. Rules and German texts: sender-identities.mjs (tested).
//
// Fail-soft like every store: without a database or on a read error the list
// is empty (only the default sender is offered); the send-time check never
// fails open — an identity whose domain is not allowed refuses the send.

import { getSql, type Sql } from "./db";
import { reportError } from "./observability";
import { senderAddress } from "./email";
import { inboundEmailAddress } from "./email-inbound";
import { mailboxAddress } from "./email-sender.mjs";
import {
  DEFAULT_SENDER_ID,
  SENDER_IDENTITIES_KEY,
  allowedSenderDomains,
  parseSenderIdentities,
  resolveSender,
  type SenderIdentity,
} from "./sender-identities.mjs";

export type { SenderIdentity };

/** The domains an identity may use (CONTACT_FROM_EMAIL's + EMAIL_SENDER_DOMAINS). */
export function senderDomains(): string[] {
  return allowedSenderDomains(process.env.CONTACT_FROM_EMAIL, process.env.EMAIL_SENDER_DOMAINS);
}

/** The default identity as the UI shows it (not stored). */
export function defaultSenderInfo(): { id: string; from: string | null; address: string | null; repliesTo: string | null } {
  const from = senderAddress() ?? null;
  return {
    id: DEFAULT_SENDER_ID,
    from,
    address: from ? mailboxAddress(from) || null : null,
    repliesTo: inboundEmailAddress() ?? null,
  };
}

function isMissingTable(err: unknown): boolean {
  const e = err as { code?: unknown; cause?: { code?: unknown } } | null;
  return e?.code === "42P01" || e?.cause?.code === "42P01";
}

/** The operator's extra identities (validated against today's domains). Never throws. */
export async function listSenderIdentities(sql: Sql | null = getSql()): Promise<SenderIdentity[]> {
  if (!sql) return [];
  try {
    const rows = (await sql`
      SELECT value FROM admin_settings WHERE key = ${SENDER_IDENTITIES_KEY}
    `) as Array<{ value: unknown }>;
    return parseSenderIdentities(rows[0]?.value, { allowedDomains: senderDomains() });
  } catch (err) {
    if (!isMissingTable(err)) reportError(err, { route: "lib/sender-store", phase: "list" });
    return [];
  }
}

export type SaveSendersResult =
  | { ok: true; senders: SenderIdentity[] }
  | { ok: false; reason: "no_db" | "missing_table" | "failed" };

/** Store the list (already validated with validateSenderIdentitiesInput). */
export async function saveSenderIdentities(
  senders: SenderIdentity[],
  sql: Sql | null = getSql()
): Promise<SaveSendersResult> {
  if (!sql) return { ok: false, reason: "no_db" };
  const value = JSON.stringify({ v: 1, senders });
  try {
    const rows = (await sql`
      INSERT INTO admin_settings (key, value, updated_at)
      VALUES (${SENDER_IDENTITIES_KEY}, ${value}::jsonb, now())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
      RETURNING value
    `) as Array<{ value: unknown }>;
    return { ok: true, senders: parseSenderIdentities(rows[0]?.value ?? value, { allowedDomains: senderDomains() }) };
  } catch (err) {
    if (isMissingTable(err)) return { ok: false, reason: "missing_table" };
    reportError(err, { route: "lib/sender-store", phase: "save" });
    return { ok: false, reason: "failed" };
  }
}

/**
 * What a campaign mail goes out with: From + Reply-To of the campaign's
 * identity (null → the default sender, replies to Mo). Refuses (ok: false,
 * German message) an identity whose domain is not allowed any more.
 */
export function resolveCampaignSender(identity: SenderIdentity | null) {
  return resolveSender({
    identity,
    defaultFrom: senderAddress(),
    inboundAddress: inboundEmailAddress(),
    allowedDomains: senderDomains(),
  });
}
