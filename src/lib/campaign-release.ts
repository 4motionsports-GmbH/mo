// „Freigeben" (I/O): approve a reviewed campaign mail now, send it later.
// A person reviews and approves every single mail on the desk; the release job
// (/api/cron/release-campaign-mails) delivers the approved ones when their time
// has come — through approveAndSendCampaign, the one delivery path, so every
// legal gate runs again at send time. A mail whose draft or campaign changed
// after the approval, or that a gate now refuses, is held: it returns to the
// review queue with the reason (never retried automatically). Rules:
// lib/campaign-release-core.mjs. Switch: CAMPAIGN_RELEASE_ENABLED (default off).

import { getSql, type Sql } from "./db";
import { reportError } from "./observability";
import { approveAndSendCampaign, campaignSendPreflight, type CampaignSendRefusal } from "./campaign-email";
import {
  approveContactForRelease,
  listDueApprovals,
  recoverStuckSending,
  revokeContactApproval,
} from "./campaign-store";
import { getLatestBundleStateForCampaignContact } from "./bundle-offers-store";
import { campaignReleaseConfig, isCampaignReleaseEnabled } from "./campaign-flags.mjs";
import { approvalFingerprint, parseReleaseAt, releaseBlockers } from "./campaign-release-core.mjs";

export type ApproveResult =
  | { ok: true; releaseAt: string }
  | { ok: false; reason: CampaignSendRefusal["reason"] | "release_disabled" | "test_contact" | "blocked" | "too_far" | "not_open"; message: string };

type Preflight = Awaited<ReturnType<typeof campaignSendPreflight>>;

/** The approval's checks on top of the send preflight; null = fine. */
async function heldReason(pre: Extract<Preflight, { ok: true }>, contactId: number): Promise<string | null> {
  const bundle = await getLatestBundleStateForCampaignContact(contactId);
  const blockers = releaseBlockers({
    body: pre.draft.body,
    discountPercent: pre.draft.discountPercent,
    // An expired set (by the expire job or by its date) blocks: its block would
    // silently drop while the text still offers it.
    bundleExpiresAt: !bundle ? null : bundle.status === "expired" ? new Date(0).toISOString() : bundle.expiresAt,
  });
  return blockers.length ? blockers.map((b) => b.message).join(" ") : null;
}

function fingerprintOf(pre: Extract<Preflight, { ok: true }>): string {
  return approvalFingerprint({
    draftUpdatedAt: pre.draft.updatedAt ?? null,
    language: pre.contact.language,
    campaign: pre.campaign,
  });
}

/**
 * Approve one reviewed mail for release at `releaseAtInput` (ISO; empty = with
 * the next run). Runs every gate the send would run, without sending. Never throws.
 */
export async function approveForRelease(contactId: number, releaseAtInput: unknown): Promise<ApproveResult> {
  try {
    if (!isCampaignReleaseEnabled()) {
      return { ok: false, reason: "release_disabled", message: "„Freigeben“ ist nicht eingeschaltet (CAMPAIGN_RELEASE_ENABLED)." };
    }
    const pre = await campaignSendPreflight(contactId);
    if (!pre.ok) return pre;
    if (pre.contact.isTest) {
      return { ok: false, reason: "test_contact", message: "Testkontakte werden direkt gesendet, nicht freigegeben." };
    }
    if (pre.contact.status !== "drafted") {
      return { ok: false, reason: "not_open", message: "Diese Mail ist nicht mehr offen." };
    }
    const held = await heldReason(pre, contactId);
    if (held) return { ok: false, reason: "blocked", message: held };
    const releaseAt = parseReleaseAt(releaseAtInput);
    if (!releaseAt) return { ok: false, reason: "too_far", message: "Höchstens 30 Tage im Voraus." };
    const approved = await approveContactForRelease(contactId, { releaseAt, fingerprint: fingerprintOf(pre) });
    if (!approved) return { ok: false, reason: "not_open", message: "Diese Mail ist nicht mehr offen." };
    return { ok: true, releaseAt };
  } catch (err) {
    reportError(err, { route: "lib/campaign-release", phase: "approveForRelease" });
    return { ok: false, reason: "send_failed", message: "Die Freigabe konnte nicht gespeichert werden." };
  }
}

export interface ReleaseRunResult {
  skipped?: "disabled";
  recovered: { sent: number; returned: number };
  due: number;
  sent: number;
  held: number;
  stoppedEarly: boolean;
}

/**
 * The release job: recover rows a timeout left in 'sending', then send the due
 * approved mails one at a time (at most maxPerRun, spacingMs apart, within the
 * deadline). Anything that changed or is refused is held for a person.
 */
export async function releaseDueCampaignMails(
  opts: { deadlineMs: number },
  sql: Sql | null = getSql()
): Promise<ReleaseRunResult> {
  const out: ReleaseRunResult = { recovered: { sent: 0, returned: 0 }, due: 0, sent: 0, held: 0, stoppedEarly: false };
  if (!isCampaignReleaseEnabled()) return { ...out, skipped: "disabled" };
  const { maxPerRun, spacingMs } = campaignReleaseConfig();
  out.recovered = await recoverStuckSending(15, sql);
  const due = await listDueApprovals(maxPerRun, sql);
  out.due = due.length;
  for (let i = 0; i < due.length; i++) {
    if (Date.now() + spacingMs > opts.deadlineMs) {
      out.stoppedEarly = true;
      break;
    }
    const { contactId, fingerprint } = due[i];
    const hold = async (reason: string) => {
      await revokeContactApproval(contactId, reason, sql);
      out.held++;
    };
    try {
      const pre = await campaignSendPreflight(contactId);
      if (!pre.ok) {
        await hold(pre.message);
        continue;
      }
      if (fingerprintOf(pre) !== fingerprint) {
        await hold("Nach der Freigabe geändert — bitte erneut prüfen.");
        continue;
      }
      const held = await heldReason(pre, contactId);
      if (held) {
        await hold(held);
        continue;
      }
      const result = await approveAndSendCampaign(contactId);
      if (result.ok) out.sent++;
      else await hold(result.message);
    } catch (err) {
      reportError(err, { route: "lib/campaign-release", phase: "releaseDueCampaignMails" });
      await hold("Freigabe nicht gesendet (Fehler) — bitte prüfen.");
    }
    if (i < due.length - 1) await new Promise((r) => setTimeout(r, spacingMs));
  }
  return out;
}
