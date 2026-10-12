// Operator settings edited in Einstellungen (admin_settings, migration 0078)
// and the one fact the contact-frequency warning needs: how many marketing
// mails a person received in the last N days.
//
// Rules and texts live in the pure, tested contact-frequency.mjs; this file is
// the I/O half. Fail-soft throughout: without a database, before migration
// 0078 or on a read error the defaults apply; a failed count means "unknown"
// (null), which never warns. The warning is never a send gate — the legal
// gates of the send paths are untouched by anything here.

import { getSql, type Sql } from "./db";
import { normalizeEmail } from "./email-capture-store";
import { getContactById } from "./campaign-store";
import { getSendById, loadEligibleCapture } from "./marketing-store";
import { reportError } from "./observability";
import {
  CONTACT_FREQUENCY_KEY,
  DEFAULT_CONTACT_FREQUENCY,
  contactFrequencyEnabled,
  contactFrequencyWarning,
  parseContactFrequency,
  type ContactFrequencySettings,
  type ContactFrequencyWarning,
} from "./contact-frequency.mjs";

export type { ContactFrequencySettings, ContactFrequencyWarning };

/** SQLSTATE 42P01 (undefined_table) on the error or one level down — the
 * code shipped before migration 0078 ran. */
function isMissingTable(err: unknown): boolean {
  const e = err as { code?: unknown; cause?: { code?: unknown } } | null;
  return e?.code === "42P01" || e?.cause?.code === "42P01";
}

/**
 * The contact-frequency setting ({ maxMails, windowDays }). Defaults without a
 * database, without a stored row, before migration 0078 (no error report —
 * expected until the maintainer runs it) and on any read error.
 */
export async function getContactFrequencySettings(
  sql: Sql | null = getSql()
): Promise<ContactFrequencySettings> {
  if (!sql) return { ...DEFAULT_CONTACT_FREQUENCY };
  try {
    const rows = (await sql`
      SELECT value FROM admin_settings WHERE key = ${CONTACT_FREQUENCY_KEY}
    `) as Array<{ value: unknown }>;
    return parseContactFrequency(rows[0]?.value);
  } catch (err) {
    if (!isMissingTable(err)) {
      reportError(err, { route: "lib/admin-settings-store", phase: "getContactFrequencySettings" });
    }
    return { ...DEFAULT_CONTACT_FREQUENCY };
  }
}

export type SaveSettingsResult =
  | { ok: true; settings: ContactFrequencySettings }
  | { ok: false; reason: "no_db" | "missing_table" | "failed" };

/**
 * Store the contact-frequency setting (UPSERT). The caller validated it
 * (validateContactFrequencyInput); the stored value is parsed back so what the
 * page shows is what every reader will use.
 */
export async function setContactFrequencySettings(
  settings: ContactFrequencySettings,
  sql: Sql | null = getSql()
): Promise<SaveSettingsResult> {
  if (!sql) return { ok: false, reason: "no_db" };
  const value = JSON.stringify({ maxMails: settings.maxMails, windowDays: settings.windowDays });
  try {
    const rows = (await sql`
      INSERT INTO admin_settings (key, value, updated_at)
      VALUES (${CONTACT_FREQUENCY_KEY}, ${value}::jsonb, now())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
      RETURNING value
    `) as Array<{ value: unknown }>;
    return { ok: true, settings: parseContactFrequency(rows[0]?.value ?? value) };
  } catch (err) {
    if (isMissingTable(err)) return { ok: false, reason: "missing_table" };
    reportError(err, { route: "lib/admin-settings-store", phase: "setContactFrequencySettings" });
    return { ok: false, reason: "failed" };
  }
}

/**
 * Marketing mails per recipient in the last `windowDays` days — ONE query for
 * a whole queue. `emails[i]` and `customerIds[i]` describe recipient i (the
 * customer id may be null); the result is aligned with the input.
 *
 * Counted: campaign_sends with is_test = false (every campaign, Einzelansprache
 * and the copy path included) and marketing_sends with status 'sent', matched
 * by the e-mail OR the customer id (an address change keeps the history).
 * Never counted: DOI, chat summary, correspondence, test sends, letters — this
 * never reads email_messages.
 *
 * Null (= unknown, no warning) without a database, for a window ≤ 0 and on
 * error.
 */
export async function countRecentMarketingMails(
  emails: string[],
  customerIds: Array<number | null>,
  windowDays: number,
  sql: Sql | null = getSql()
): Promise<number[] | null> {
  if (!sql) return null;
  const days = Math.floor(Number(windowDays));
  if (!Number.isFinite(days) || days <= 0) return null;
  if (emails.length === 0) return [];
  const e = emails.map((x) => (typeof x === "string" ? normalizeEmail(x) : ""));
  const c = emails.map((_, i) => {
    const id = Number(customerIds[i]);
    return Number.isInteger(id) && id > 0 ? id : null;
  });
  try {
    const rows = (await sql`
      SELECT r.idx::int AS idx,
             (SELECT count(*)::int
                FROM campaign_sends cs
               WHERE cs.is_test = false
                 AND cs.sent_at >= now() - make_interval(days => ${days}::int)
                 AND (cs.email = r.email
                      OR (r.customer_id IS NOT NULL AND cs.customer_id = r.customer_id)))
           + (SELECT count(*)::int
                FROM marketing_sends ms
                JOIN email_captures ec ON ec.id = ms.email_capture_id
               WHERE ms.status = 'sent'
                 AND ms.sent_at >= now() - make_interval(days => ${days}::int)
                 AND (ec.email = r.email
                      OR (r.customer_id IS NOT NULL AND ms.customer_id = r.customer_id))) AS n
        FROM unnest(${e}::text[], ${c}::bigint[]) WITH ORDINALITY AS r(email, customer_id, idx)
    `) as Array<{ idx: number; n: number }>;
    const out = new Array<number>(e.length).fill(0);
    for (const row of rows) {
      const i = Number(row.idx) - 1;
      if (i >= 0 && i < out.length) out[i] = Number(row.n) || 0;
    }
    return out;
  } catch (err) {
    reportError(err, { route: "lib/admin-settings-store", phase: "countRecentMarketingMails" });
    return null;
  }
}

/** One recipient — countRecentMarketingMails for a single address/customer. */
export async function countRecentMarketingMailsFor(
  email: string | null,
  customerId: number | null,
  windowDays: number,
  sql: Sql | null = getSql()
): Promise<number | null> {
  try {
    const counts = await countRecentMarketingMails([email ?? ""], [customerId], windowDays, sql);
    return counts ? (counts[0] ?? 0) : null;
  } catch (err) {
    reportError(err, { route: "lib/admin-settings-store", phase: "countRecentMarketingMailsFor" });
    return null;
  }
}

/**
 * The send routes' backstop: the warning for one real recipient right now
 * (settings + a fresh count), or null — off, below the threshold, or anything
 * failed (fail-soft: a broken count never stops a send). The caller skips
 * test contacts.
 */
export async function contactFrequencyWarningFor(
  email: string | null,
  customerId: number | null,
  sql: Sql | null = getSql()
): Promise<ContactFrequencyWarning | null> {
  try {
    const settings = await getContactFrequencySettings(sql);
    if (!contactFrequencyEnabled(settings)) return null;
    const count = await countRecentMarketingMailsFor(email, customerId, settings.windowDays, sql);
    return contactFrequencyWarning({ count, settings });
  } catch (err) {
    reportError(err, { route: "lib/admin-settings-store", phase: "contactFrequencyWarningFor" });
    return null;
  }
}

/**
 * The warning for a campaign recipient (POST /api/admin/campaign/send and
 * /approve). Never for a Testkontakt, an unknown or an already-sent contact
 * (the send path answers those itself).
 */
export async function contactFrequencyWarningForCampaignContact(
  contactId: number,
  sql: Sql | null = getSql()
): Promise<ContactFrequencyWarning | null> {
  try {
    const contact = await getContactById(contactId, sql);
    if (!contact || contact.isTest || contact.status === "sent") return null;
    return await contactFrequencyWarningFor(contact.email, contact.customerId, sql);
  } catch (err) {
    reportError(err, { route: "lib/admin-settings-store", phase: "contactFrequencyWarningForCampaignContact" });
    return null;
  }
}

/**
 * The warning for a legacy marketing draft (POST /api/admin/marketing/send).
 * Null for an unknown or already-sent row and for an address that is not
 * marketing-eligible (approveAndSend refuses those itself).
 */
export async function contactFrequencyWarningForMarketingSend(
  sendId: number,
  sql: Sql | null = getSql()
): Promise<ContactFrequencyWarning | null> {
  try {
    const send = await getSendById(sendId, sql);
    if (!send || send.status === "sent") return null;
    const capture = await loadEligibleCapture(send.emailCaptureId, sql);
    if (!capture) return null;
    return await contactFrequencyWarningFor(capture.email, send.customerId, sql);
  } catch (err) {
    reportError(err, { route: "lib/admin-settings-store", phase: "contactFrequencyWarningForMarketingSend" });
    return null;
  }
}
