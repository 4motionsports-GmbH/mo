// Letters as a campaign channel (0074, docs/CAMPAIGNS.md §8) — the work steps
// the desk's „Briefe“ view drives in small batches (useStepLoop):
//
//   fillCampaignLetterAddresses  shipping address of each recipient's latest
//                                completed order (postal-address-fill.ts)
//   draftCampaignLetters         AI drafts for pending letters
//   sendCampaignLetterStep       approved letters → every gate, read fresh
//                                (campaign-letter-core.decideCampaignLetterSend)
//                                → physical-mail.submitLetter → Pingen
//
// Every letter was released one by one by a person (approve); a send step
// only posts released letters, never drafts or approves.

import { getCampaign, campaignAcceptsWork, type Campaign } from "./campaigns-store";
import {
  attachPhysicalLetter,
  claimApprovedLetters,
  excludeCampaignLetter,
  getCampaignLetter,
  getCampaignLetterCounts,
  letterCostCents,
  listCampaignLetters,
  listLetterCustomersNeedingAddress,
  listLettersNeedingDraft,
  markCampaignLetterRefused,
  markCampaignLetterSent,
  recoverStuckLetters,
  type CampaignLetterCounts,
  type CampaignLetterStatus,
} from "./campaign-letters-store";
import { draftCampaignLetter } from "./campaign-letter-draft";
import { fillPostalAddressesFromOrders, type AddressFillResult } from "./postal-address-fill";
import {
  decideCampaignLetterSend,
  letterAddressNightly,
  letterMinIntervalDays,
  letterReviewChecks,
  letterRunEstimate,
} from "./campaign-letter-core.mjs";
import { submitLetter } from "./physical-mail";
import type { RecipientAddress } from "./physical-letters-store";
import { isPingenConfigured, isPingenStaging } from "./pingen";
import { isPhysicalMailSendsApproved } from "./pingen-flag.mjs";
import { reportError } from "./observability";

/** Address fill: up to `batch` recipients per step. */
export async function fillCampaignLetterAddresses(
  campaignId: number,
  batch: number
): Promise<AddressFillResult & { remaining: number }> {
  const ids = await listLetterCustomersNeedingAddress(campaignId, batch);
  const result = await fillPostalAddressesFromOrders(ids);
  // Stop when nothing was left to check, the fill could not run, or Shopify
  // failed the whole batch (those stay unchecked and are retried next time).
  const stuck = ids.length === 0 || !result.ok || (result.checked > 0 && result.failed === result.checked);
  const counts = await getCampaignLetterCounts(campaignId);
  return { ...result, remaining: stuck ? 0 : counts.addressFetchable };
}

/** Drafts: up to `batch` pending letters per step (sequential — one AI call each). */
export async function draftCampaignLetters(
  campaignId: number,
  batch: number
): Promise<{ drafted: number; failed: number; remaining: number }> {
  const ids = await listLettersNeedingDraft(campaignId, batch);
  let drafted = 0;
  let failed = 0;
  for (const id of ids) {
    if (await draftCampaignLetter(id)) drafted++;
    else failed++;
  }
  const counts = await getCampaignLetterCounts(campaignId);
  return { drafted, failed, remaining: failed > 0 && drafted === 0 ? 0 : counts.pending };
}

export interface LetterSendStepResult {
  ok: boolean;
  sent: number;
  refused: Array<{ id: number; reason: string; message: string }>;
  remaining: number;
}

/**
 * Post up to `batch` released letters of one campaign. Each is claimed
 * atomically, its person read fresh and every gate re-checked; a refusal goes
 * back to review with the reason (an objection or a consent given since
 * removes it from the queue). Never throws.
 */
export async function sendCampaignLetterStep(campaignId: number, batch: number): Promise<LetterSendStepResult> {
  const out: LetterSendStepResult = { ok: true, sent: 0, refused: [], remaining: 0 };
  try {
    const campaign = await getCampaign(campaignId);
    if (!campaign) return { ...out, ok: false };
    await recoverStuckLetters(15);
    const claimed = await claimApprovedLetters(campaignId, batch);
    let spentCents = (await getCampaignLetterCounts(campaignId)).spentCents;
    const costCents = letterCostCents();
    for (const id of claimed) {
      const letter = await getCampaignLetter(id);
      if (!letter) continue;
      const gate = decideCampaignLetterSend({
        flagApproved: isPhysicalMailSendsApproved(),
        pingenConfigured: isPingenConfigured(),
        campaignLive: campaignAcceptsWork(campaign),
        mode: campaign.letterMode,
        consentSubscribed: letter.consentSubscribed,
        postalObjectionAt: letter.postalObjectionAt,
        address: letter.postalAddress,
        addressSource: letter.postalAddressSource,
        addressInvalidAt: letter.postalAddressInvalidAt,
        subject: letter.subject,
        body: letter.body,
        lastLetterAt: letter.lastLetterAt,
        minIntervalDays: letterMinIntervalDays(),
        budgetCents: campaign.letterBudgetCents,
        spentCents,
        costCents,
      });
      if (!gate.ok) {
        out.refused.push({ id, reason: gate.reason, message: gate.message });
        if (gate.reason === "objection") await excludeCampaignLetter(id, "widerspruch");
        else if (gate.reason === "consent_now") await excludeCampaignLetter(id, "einwilligung");
        else await markCampaignLetterRefused(id, { error: gate.message, backTo: "drafted" });
        continue;
      }
      const result = await submitLetter({
        customerId: letter.customerId,
        recipient: gate.address as unknown as RecipientAddress,
        subject: letter.subject,
        body: letter.body ?? "",
        campaignId,
        onCreated: (physicalLetterId) => attachPhysicalLetter(id, physicalLetterId),
      });
      if (result.ok) {
        await markCampaignLetterSent(id, { physicalLetterId: result.letterId, pageCount: result.pageCount });
        out.sent++;
        spentCents += costCents;
      } else {
        out.refused.push({ id, reason: result.reason, message: result.message });
        await markCampaignLetterRefused(id, { error: result.message, backTo: "failed", physicalLetterId: result.letterId });
      }
    }
    out.remaining = (await getCampaignLetterCounts(campaignId)).approved;
    return out;
  } catch (err) {
    reportError(err, { route: "lib/campaign-letters", phase: "sendStep" });
    return { ...out, ok: false };
  }
}

// ---------------------------------------------------------------------------
// Desk data
// ---------------------------------------------------------------------------


export interface LetterDeskItem {
  id: number;
  customerId: number;
  status: CampaignLetterStatus;
  name: string;
  email: string;
  language: "de" | "en";
  /** One line: name, street, postcode city, country — null without a purchase address. */
  addressLine: string | null;
  addressSource: string | null;
  subject: string | null;
  body: string | null;
  edited: boolean;
  error: string | null;
  excludedReason: string | null;
  /** The posted letter's progress (physical_letters.status). */
  letterStatus: string | null;
  approvedAt: string | null;
  sentAt: string | null;
  pageCount: number | null;
  costCents: number | null;
  checks: { blocked: Array<{ key: string; title: string }>; hints: Array<{ key: string; title: string }> };
}

export interface LetterDeskData {
  items: LetterDeskItem[];
  counts: CampaignLetterCounts;
  costCents: number;
  budgetCents: number | null;
  /** Letters the remaining budget still pays for at the assumed postage (null = no budget). */
  affordable: number | null;
  flagApproved: boolean;
  pingenConfigured: boolean;
  /** The campaign runs now (status, window) — letters go out only then. */
  campaignLive: boolean;
  /** The campaign's letter mode is not „Keine Briefe“ — otherwise the view only shows what exists. */
  lettersOn: boolean;
  staging: boolean;
}

function addressLine(a: Record<string, unknown> | null): string | null {
  if (!a) return null;
  const s = (k: string) => (typeof a[k] === "string" ? String(a[k]).trim() : "");
  const parts = [s("name"), s("company"), s("address_line_1"), s("address_line_2"), `${s("postal_code")} ${s("city")}`.trim(), s("country")];
  const line = parts.filter(Boolean).join(", ");
  return line || null;
}

/** Everything the desk's „Briefe“ view shows. */
export async function letterDeskData(campaign: Campaign): Promise<LetterDeskData> {
  const [rows, counts] = await Promise.all([listCampaignLetters(campaign.id), getCampaignLetterCounts(campaign.id)]);
  const flagApproved = isPhysicalMailSendsApproved();
  const pingenConfigured = isPingenConfigured();
  const costCents = letterCostCents();
  const minIntervalDays = letterMinIntervalDays();
  const campaignLive = campaignAcceptsWork(campaign);
  const items = rows.map((l): LetterDeskItem => {
    const open = ["pending", "drafted", "approved", "failed"].includes(l.status);
    // Per letter only what concerns THIS letter; the campaign-wide gates
    // (flag, Pingen, campaign running, budget) are shown once above the list.
    const checks = open
      ? letterReviewChecks({
          flagApproved: true,
          pingenConfigured: true,
          campaignLive: true,
          mode: campaign.letterMode,
          consentSubscribed: l.consentSubscribed,
          postalObjectionAt: l.postalObjectionAt,
          address: l.postalAddress,
          addressSource: l.postalAddressSource,
          addressInvalidAt: l.postalAddressInvalidAt,
          subject: l.subject ?? (l.status === "pending" ? "-" : ""),
          body: l.body ?? (l.status === "pending" ? "-" : ""),
          lastLetterAt: l.lastLetterAt,
          minIntervalDays,
          budgetCents: null,
          firstName: l.firstName,
          lastName: l.lastName,
          language: l.language,
        })
      : { blocked: [], hints: [] };
    return {
      id: l.id,
      customerId: l.customerId,
      status: l.status,
      name: [l.firstName, l.lastName].filter(Boolean).join(" ") || l.email,
      email: l.email,
      language: l.language,
      addressLine: l.postalAddressSource === "purchase" ? addressLine(l.postalAddress) : null,
      addressSource: l.postalAddressSource,
      subject: l.subject,
      body: l.body,
      edited: l.edited,
      error: l.error,
      excludedReason: l.excludedReason,
      letterStatus: l.letterStatus,
      approvedAt: l.approvedAt,
      sentAt: l.sentAt,
      pageCount: l.pageCount,
      costCents: l.costCents,
      checks,
    };
  });
  const estimate = letterRunEstimate({
    count: counts.approved,
    costCents,
    budgetCents: campaign.letterBudgetCents,
    spentCents: counts.spentCents,
  });
  return {
    items,
    counts,
    costCents,
    budgetCents: campaign.letterBudgetCents,
    affordable: estimate.budgetLeftCents == null ? null : Math.floor(estimate.budgetLeftCents / estimate.costCents),
    flagApproved,
    pingenConfigured,
    campaignLive,
    lettersOn: campaign.letterMode !== "aus",
    staging: isPingenStaging(),
  };
}

/**
 * Nightly (campaign-audiences cron): purchase addresses for open letter
 * recipients of active campaigns, up to CAMPAIGN_LETTER_ADDRESS_NIGHTLY in
 * total, so the desk's „Adressen holen“ is mostly done by the morning.
 * Nothing while the letter channel is off. Never throws.
 */
export async function nightlyLetterAddresses(
  campaigns: Array<Pick<Campaign, "id" | "status" | "kind" | "letterMode">>,
  deadlineMs: number
): Promise<{ filled: number; checked: number }> {
  const out = { filled: 0, checked: 0 };
  let budget = letterAddressNightly();
  if (budget === 0 || !isPhysicalMailSendsApproved()) return out;
  for (const c of campaigns) {
    if (budget <= 0 || Date.now() > deadlineMs) break;
    if (c.kind === "einzel" || c.status !== "aktiv" || c.letterMode === "aus") continue;
    while (budget > 0 && Date.now() < deadlineMs) {
      const r = await fillCampaignLetterAddresses(c.id, Math.min(50, budget));
      out.filled += r.filled;
      out.checked += r.checked;
      budget -= Math.max(1, r.checked);
      if (r.checked === 0 || !r.ok || r.failed === r.checked) break;
    }
  }
  return out;
}
