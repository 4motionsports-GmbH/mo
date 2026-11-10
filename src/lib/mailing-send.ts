// Rundmail (bulk mail) — test send, checks, release and the batch runner.
// docs/CAMPAIGNS.md §9. The pure rules: mailing-core.mjs + mailing-checks.mjs
// (tested); the SQL guarantees: mailing-store.ts.
//
// The path of a Rundmail:
//   1. Draft — the operator edits the content (a block document), sends test
//      mails to their own address, runs the checks.
//   2. Release („Senden“ / „Planen“) — every check again on the server, the
//      content of the TESTED version is frozen (rendered once with
//      per-recipient placeholders), the campaign starts at the chosen time.
//   3. Run — the cron (every minute) and the open admin page drive
//      runMailingStep: the audience is matched fresh at the first batch, then
//      fixed; batches of recipients are claimed atomically, every legal gate
//      runs PER RECIPIENT with the person read fresh (campaign-gates.mjs — the
//      same function as the per-card send), and each batch goes to Resend as
//      ONE batch request with an idempotency key. A retry after a timeout
//      re-sends the identical batch under the same key, so Resend never
//      delivers it twice; an outcome that can no longer be known is marked
//      „unklar“ and never resent.
//   4. Done — no recipient left: the campaign ends. Pause / cancel at any time.
//
// Every send is a campaign_sends row (KPIs, delivery webhooks, unsubscribe
// attribution, erasure, retention and the frequency cap work unchanged); the
// shipped content is stored ONCE (campaign_mailings.frozen_*), not per row.

import { createHash } from "node:crypto";
import { getBaseUrl } from "./base-url";
import { buildErasureUrl, buildUnsubscribeToken } from "./email-capture-store";
import { outboundHeaders, sendEmail, sendEmailBatch, type BatchEmailInput } from "./email";
import { reportError } from "./observability";
import { withLocaleParam } from "./locale";
import { matchAudience } from "./audience-store";
import { getCampaign, refreshCampaignAudience, campaignAcceptsWork, type Campaign } from "./campaigns-store";
import { isCampaignSendsApproved, isSingleOptInAllowed, marketingMinSendIntervalDays } from "./campaign-flags.mjs";
import { evaluateCampaignSendGates, GATE_REASONS, optInLevelFromConsent } from "./campaign-gates.mjs";
import { resolveCampaignSender } from "./sender-store";
import { normalizeAudienceSpec } from "./audience-spec.mjs";
import { unknownMergeFields, validateMailTemplateDoc, normalizeMailTemplateDoc, templateDesignKey } from "./mail-template-doc.mjs";
import { docProductAvailability } from "./mail-template-design";
import {
  MAILING_BATCH_DEFAULT,
  MAILING_RATES,
  batchSizeFor,
  batchSpacingMs,
  isSendableAddress,
  leftoverPlaceholders,
  mailingIdempotencyKey,
  parseTestAddresses,
  personalizeFrozen,
  resendErrorMessage,
} from "./mailing-core.mjs";
import { mailingChecks, type MailingCheck } from "./mailing-checks.mjs";
import { renderMailingFrozen, renderMailingPreview, renderMailingTest } from "./mailing-render";
import {
  acquireMailingLease,
  claimMailingBatch,
  finishMailingIfDone,
  freezeAndStartMailing,
  getMailing,
  getMailingFrozenBodies,
  listDueMailings,
  listOpenBatches,
  loadBatchRecipients,
  markBatchUnclear,
  markMailingMaterialized,
  noteBatchAttempt,
  recordMailingTest,
  releaseBatch,
  releaseMailingLease,
  releaseOrphanClaims,
  setMailingPaused,
  setMailingRunState,
  settleBatch,
  type BatchSettlement,
  type Mailing,
  type MailingBatch,
  type MailingFrozenBodies,
} from "./mailing-store";

/** Stop starting a new batch this close to the run's deadline. */
const RUN_SAFETY_MS = 8_000;
/**
 * Attempts of a batch with an unclear outcome (network error, Resend 5xx)
 * before it is marked „unklar“. The idempotency key makes every retry safe,
 * so the runner keeps trying through a Resend outage: 20 s, 40 s, 80 s, …
 * capped at 5 minutes — about two hours in all. While such a batch is open
 * no new batch is claimed: an outage pauses the mailing by itself.
 */
const MAX_UNCLEAR_ATTEMPTS = 30;
const UNCLEAR_RETRY_MS = 20_000;
const UNCLEAR_RETRY_MAX_MS = 5 * 60_000;

/** Wait before attempt `attempts + 1` of an unclear batch. */
function unclearRetryDelay(attempts: number): number {
  return Math.min(UNCLEAR_RETRY_MAX_MS, UNCLEAR_RETRY_MS * 2 ** Math.max(0, attempts - 1));
}
/** Resend keeps an idempotency key 24 h — never retry an older batch. */
const IDEMPOTENCY_WINDOW_MS = 23 * 60 * 60 * 1000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function batchSizeSetting(): number {
  const n = Number.parseInt(process.env.MAILING_BATCH_SIZE ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : MAILING_BATCH_DEFAULT;
}

function unsubscribeUrlFor(email: string, language: "de" | "en"): string | null {
  const token = buildUnsubscribeToken(email);
  if (!token) return null;
  return `${getBaseUrl()}/api/unsubscribe?token=${encodeURIComponent(token)}${language === "en" ? "&locale=en" : ""}`;
}

// ── audience figures for the checks ──────────────────────────────────────────

/** Matches with the consent, and of those with a provable double opt-in. */
export async function mailingAudienceCounts(campaign: Campaign): Promise<{ total: number; confirmed: number } | null> {
  const spec = normalizeAudienceSpec(campaign.audience) as Record<string, unknown>;
  const all = await matchAudience(spec, { limit: 1 });
  if (!all.ok) return null;
  const levels = Array.isArray(spec.optInLevels) ? (spec.optInLevels as string[]) : null;
  if (levels && !levels.includes("confirmed_opt_in")) return { total: all.total, confirmed: 0 };
  const confirmed = await matchAudience({ ...spec, optInLevels: ["confirmed_opt_in"] }, { limit: 1 });
  return { total: all.total, confirmed: confirmed.ok ? confirmed.total : 0 };
}

// ── checks ───────────────────────────────────────────────────────────────────

export interface MailingEvaluation {
  ok: boolean;
  errors: MailingCheck[];
  warnings: MailingCheck[];
  infos: MailingCheck[];
  audience: { total: number; confirmed: number } | null;
}

/** Every check on the CURRENT content (the release runs this again). */
export async function evaluateMailing(campaign: Campaign, mailing: Mailing): Promise<MailingEvaluation> {
  const doc = normalizeMailTemplateDoc(mailing.doc);
  const [audience, preview, products] = await Promise.all([
    mailingAudienceCounts(campaign),
    renderMailingPreview(
      { doc, subject: mailing.subject, preheader: mailing.preheader, language: mailing.language },
      "Alex"
    ),
    docProductAvailability(doc),
  ]);
  const sender = resolveCampaignSender(campaign.sender);
  const usesFirstName =
    /\{\{\s*vorname/i.test(mailing.subject) ||
    doc.blocks.some((b) => b.type === "greeting" || /\{\{\s*vorname/i.test(JSON.stringify(b)));
  const result = mailingChecks({
    subject: mailing.subject,
    preheader: mailing.preheader,
    html: preview.html,
    docIssues: validateMailTemplateDoc(doc, "bulk"),
    sender: sender.ok ? { ok: true, from: sender.from } : { ok: false, message: sender.message },
    sendsApproved: isCampaignSendsApproved(),
    allowSingleOptIn: isSingleOptInAllowed(),
    audience,
    contentVersion: mailing.contentVersion,
    testVersion: mailing.testVersion,
    usesFirstName,
    ratePerMinute: MAILING_RATES[mailing.rate],
    unknownSubjectFields: unknownMergeFields(mailing.subject),
    products,
  });
  return { ...result, audience };
}

// ── test send ────────────────────────────────────────────────────────────────

export type MailingTestResult =
  | { ok: true; sentTo: string[]; version: number }
  | { ok: false; message: string; status: number };

/**
 * Send the CURRENT content to up to five of the operator's own addresses —
 * the same render as the release (from the same sender, with the bulk and
 * unsubscribe headers), links untracked. Stamps the tested version: only a
 * tested version can be released. Test mails are not recorded as sends.
 */
export async function sendMailingTest(
  campaignId: number,
  input: { addresses: unknown; firstName: unknown; expectedVersion: unknown }
): Promise<MailingTestResult> {
  try {
    const parsed = parseTestAddresses(input.addresses);
    if (!parsed.ok) return { ok: false, message: parsed.message, status: 400 };
    const campaign = await getCampaign(campaignId);
    const mailing = await getMailing(campaignId);
    if (!campaign || campaign.kind !== "rundmail" || !mailing) return { ok: false, message: "Rundmail nicht gefunden.", status: 404 };
    if (mailing.frozenAt) return { ok: false, message: "Die Rundmail ist schon freigegeben.", status: 409 };
    if (Number(input.expectedVersion) !== mailing.contentVersion) {
      return { ok: false, message: "Der Inhalt wurde inzwischen geändert — bitte zuerst speichern.", status: 409 };
    }
    if (!mailing.subject.trim()) return { ok: false, message: "Betreff fehlt.", status: 400 };
    const sender = resolveCampaignSender(campaign.sender);
    if (!sender.ok) return { ok: false, message: sender.message, status: 409 };
    const firstName = typeof input.firstName === "string" ? input.firstName.trim().slice(0, 30) || null : null;
    const sentTo: string[] = [];
    for (const address of parsed.addresses) {
      const unsubscribeUrl = unsubscribeUrlFor(address, mailing.language);
      if (!unsubscribeUrl) return { ok: false, message: "Kein Abmelde-Link möglich (UNSUBSCRIBE_SECRET fehlt).", status: 503 };
      const rendered = await renderMailingTest(
        { doc: mailing.doc, subject: mailing.subject, preheader: mailing.preheader, language: mailing.language },
        firstName,
        { unsubscribeUrl, erasureUrl: buildErasureUrl(address, mailing.language) }
      );
      const result = await sendEmail({
        to: address,
        subject: rendered.subject,
        text: rendered.text,
        html: rendered.html,
        from: sender.from,
        replyTo: sender.replyTo,
        listUnsubscribeUrl: unsubscribeUrl,
        bulk: true,
        tags: [
          { name: "campaign", value: String(campaignId) },
          { name: "kind", value: "rundmail_test" },
        ],
        kind: "rundmail_test",
      });
      if (!result.ok) {
        if (result.skipped) return { ok: false, message: "E-Mail-Versand ist nicht eingerichtet (RESEND_API_KEY).", status: 503 };
        const message =
          result.error && typeof result.error === "object" && "message" in result.error
            ? String((result.error as { message?: unknown }).message)
            : "Resend hat die Mail abgelehnt.";
        return { ok: false, message: `Testmail an ${address} fehlgeschlagen: ${message}`, status: 502 };
      }
      sentTo.push(address);
    }
    await recordMailingTest(campaignId, mailing.contentVersion, sentTo.length);
    return { ok: true, sentTo, version: mailing.contentVersion };
  } catch (err) {
    reportError(err, { route: "lib/mailing-send", phase: "test" });
    return { ok: false, message: "Die Testmail konnte nicht gesendet werden.", status: 500 };
  }
}

// ── release ──────────────────────────────────────────────────────────────────

export type MailingReleaseResult =
  | { ok: true; startsAt: string; evaluation: MailingEvaluation }
  | { ok: false; message: string; status: number; evaluation?: MailingEvaluation };

/**
 * Release a Rundmail: all checks again (any error refuses), the TESTED
 * version frozen, the campaign started at `startsAt` (now or a planned time,
 * at most 60 days ahead). The runner sends from then on.
 */
export async function releaseMailing(
  campaignId: number,
  input: { startsAt: unknown; expectedVersion: unknown }
): Promise<MailingReleaseResult> {
  try {
    const campaign = await getCampaign(campaignId);
    const mailing = await getMailing(campaignId);
    if (!campaign || campaign.kind !== "rundmail" || !mailing) return { ok: false, message: "Rundmail nicht gefunden.", status: 404 };
    if (campaign.status !== "entwurf" || mailing.frozenAt) {
      return { ok: false, message: "Die Rundmail ist schon freigegeben.", status: 409 };
    }
    if (Number(input.expectedVersion) !== mailing.contentVersion) {
      return { ok: false, message: "Der Inhalt wurde inzwischen geändert — bitte neu laden.", status: 409 };
    }
    const now = Date.now();
    let startsAt = new Date(now).toISOString();
    if (input.startsAt != null && input.startsAt !== "") {
      const t = Date.parse(String(input.startsAt));
      if (!Number.isFinite(t)) return { ok: false, message: "Ungültiger Zeitpunkt.", status: 400 };
      if (t > now + 60 * 86_400_000) return { ok: false, message: "Höchstens 60 Tage im Voraus planen.", status: 400 };
      if (campaign.endsAt && t >= Date.parse(campaign.endsAt)) {
        return { ok: false, message: "Der Versand-Start liegt nach dem Ende der Kampagne.", status: 400 };
      }
      startsAt = new Date(Math.max(t, now)).toISOString();
    }
    const evaluation = await evaluateMailing(campaign, mailing);
    if (!evaluation.ok) {
      return { ok: false, message: evaluation.errors[0]?.message ?? "Die Prüfung ist nicht bestanden.", status: 409, evaluation };
    }
    const sender = resolveCampaignSender(campaign.sender);
    if (!sender.ok) return { ok: false, message: sender.message, status: 409, evaluation };
    const frozen = await renderMailingFrozen(
      { doc: mailing.doc, subject: mailing.subject, preheader: mailing.preheader, language: mailing.language },
      campaign.slug
    );
    const bad = leftoverPlaceholders(frozen.html + frozen.text + frozen.subject).filter((p) => !/^\{\{mo:/.test(p));
    if (bad.length) return { ok: false, message: `Unbekannte Platzhalter: ${bad.join(", ")}`, status: 409, evaluation };
    const ok = await freezeAndStartMailing(
      campaignId,
      {
        version: mailing.contentVersion,
        subject: frozen.subject,
        html: frozen.html,
        text: frozen.text,
        hash: createHash("sha256").update(frozen.text, "utf8").digest("hex"),
        from: sender.from,
        replyTo: sender.replyTo ?? null,
        links: frozen.links,
        merges: frozen.merges,
      },
      startsAt
    );
    if (!ok) return { ok: false, message: "Die Freigabe ist nicht möglich (Inhalt geändert oder schon freigegeben) — bitte neu laden.", status: 409 };
    return { ok: true, startsAt, evaluation };
  } catch (err) {
    reportError(err, { route: "lib/mailing-send", phase: "release" });
    return { ok: false, message: "Die Rundmail konnte nicht freigegeben werden.", status: 500 };
  }
}

// ── the runner ───────────────────────────────────────────────────────────────

export interface MailingStepResult {
  mailings: number;
  batches: number;
  sent: number;
  notSent: number;
  messages: string[];
}

type BatchOutcome = { sent: number; notSent: number; stop: boolean; retryAfterMs?: number };

/** Stop a mailing with a reason the operator sees (paused, never ended). */
async function pauseWithError(campaignId: number, message: string): Promise<void> {
  await setMailingPaused(campaignId, true);
  await setMailingRunState(campaignId, { error: message, nextBatchAt: null });
}

/**
 * Send ONE batch: read every recipient fresh, run the gates per recipient,
 * personalise the frozen content, one Resend batch request with the batch's
 * idempotency key, settle. Never throws.
 */
async function sendBatch(
  campaign: Campaign,
  mailing: Mailing,
  bodies: MailingFrozenBodies,
  batch: MailingBatch
): Promise<BatchOutcome> {
  const campaignId = campaign.id;
  const language = mailing.language;
  const recipients = await loadBatchRecipients(campaignId, batch.contactIds);
  if (recipients === null) {
    await noteBatchAttempt(batch.id, "Datenbank nicht lesbar");
    return { sent: 0, notSent: 0, stop: true };
  }
  if (!isCampaignSendsApproved()) {
    await releaseBatch(batch, "CAMPAIGN_SENDS_APPROVED aus");
    await pauseWithError(campaignId, "Versand gestoppt: CAMPAIGN_SENDS_APPROVED ist aus.");
    return { sent: 0, notSent: 0, stop: true };
  }
  if (!mailing.frozenFrom || !mailing.frozenSubject) {
    await releaseBatch(batch, "Freigabe unvollständig");
    await pauseWithError(campaignId, "Die Freigabe ist unvollständig — bitte zurücknehmen und neu freigeben.");
    return { sent: 0, notSent: 0, stop: true };
  }
  const allowSingle = isSingleOptInAllowed();
  const minDays = marketingMinSendIntervalDays();
  const tokenOf = new Map(batch.contactIds.map((id, i) => [id, batch.tokens[i]]));
  const notSent: BatchSettlement["notSent"] = [];
  const eligible: Array<{ contactId: number; email: string; subject: string; token: string; payload: BatchEmailInput }> = [];
  const seen = new Set<string>();
  const base = getBaseUrl();

  for (const r of recipients) {
    if (!isSendableAddress(r.email)) {
      notSent.push({ contactId: r.contactId, status: "skipped", reason: "ungueltige_adresse" });
      continue;
    }
    if (r.alreadySentHere || seen.has(r.email)) {
      notSent.push({ contactId: r.contactId, status: "skipped", reason: "doppelt" });
      continue;
    }
    // The legal gates — the same function as every per-card campaign send.
    const gate = evaluateCampaignSendGates({
      sendsApproved: true,
      allowSingleOptIn: allowSingle,
      consentState: r.consentState,
      optInLevel: optInLevelFromConsent(r.consentLevel),
      suppressed: r.suppressed,
      lastSendAt: r.lastSendAt,
      minIntervalDays: minDays,
    });
    if (!gate.allowed) {
      const reason =
        gate.reason === GATE_REASONS.TOO_SOON
          ? "zu_haeufig"
          : gate.reason === GATE_REASONS.OPT_IN_LEVEL
            ? "kein_doi"
            : gate.reason === GATE_REASONS.SUPPRESSED
              ? "gesperrt"
              : "keine_einwilligung";
      notSent.push({ contactId: r.contactId, status: gate.reason === GATE_REASONS.TOO_SOON ? "skipped" : "suppressed", reason });
      continue;
    }
    const unsubscribeUrl = unsubscribeUrlFor(r.email, language);
    if (!unsubscribeUrl) {
      await releaseBatch(batch, "UNSUBSCRIBE_SECRET fehlt");
      await pauseWithError(campaignId, "Kein Abmelde-Link möglich (UNSUBSCRIBE_SECRET fehlt) — Versand pausiert.");
      return { sent: 0, notSent: 0, stop: true };
    }
    const token = tokenOf.get(r.contactId) ?? "";
    const values = {
      unsubscribeUrl,
      erasureUrl: buildErasureUrl(r.email, language),
      trackUrl: (n: number) => withLocaleParam(`${base}/api/r/${token}?l=${n}`, language),
      firstName: r.firstName,
      merges: mailing.merges.body,
      greetings: mailing.merges.greetings,
    };
    const html = personalizeFrozen(bodies.html, values, "html");
    const text = personalizeFrozen(bodies.text, values, "text");
    const subject = personalizeFrozen(mailing.frozenSubject, { ...values, merges: mailing.merges.subject }, "text");
    if (!token || leftoverPlaceholders(`${html}${text}${subject}`).length > 0) {
      reportError(new Error("rundmail: placeholder left after personalisation"), {
        route: "lib/mailing-send",
        phase: "personalize",
        campaignId,
      });
      notSent.push({ contactId: r.contactId, status: "skipped", reason: "versand_fehler" });
      continue;
    }
    seen.add(r.email);
    eligible.push({
      contactId: r.contactId,
      email: r.email,
      subject,
      token,
      payload: {
        from: mailing.frozenFrom,
        to: r.email,
        subject,
        text,
        html,
        ...(mailing.frozenReplyTo ? { replyTo: mailing.frozenReplyTo } : {}),
        headers: outboundHeaders({ listUnsubscribeUrl: unsubscribeUrl, bulk: true }),
        tags: [
          { name: "campaign", value: String(campaignId) },
          { name: "kind", value: "rundmail" },
        ],
      },
    });
  }

  const meta = {
    bodyHash: mailing.frozenHash ?? "",
    designKey: mailing.sourceTemplateId ? templateDesignKey(mailing.sourceTemplateId) : "rundmail",
    language,
  };
  if (eligible.length === 0) {
    const ok = await settleBatch(batch, { sent: [], notSent }, meta);
    return { sent: 0, notSent: notSent.length, stop: !ok };
  }

  const res = await sendEmailBatch(
    eligible.map((e) => e.payload),
    { idempotencyKey: mailingIdempotencyKey(campaignId, batch.id), kind: "rundmail" }
  );
  if (res.ok) {
    const refused = new Set(res.errors.map((e) => e.index));
    const sent: BatchSettlement["sent"] = [];
    eligible.forEach((e, i) => {
      if (refused.has(i)) notSent.push({ contactId: e.contactId, status: "skipped", reason: "versand_fehler" });
      else sent.push({ contactId: e.contactId, email: e.email, subject: e.subject, token: e.token, providerEmailId: res.ids[i] ?? null });
    });
    const ok = await settleBatch(batch, { sent, notSent }, meta);
    if (!ok) {
      // Resend accepted: the retry under the same key returns the same ids
      // without sending again, and settles then.
      await noteBatchAttempt(batch.id, "Gesendet, Buchung fehlgeschlagen — wird nachgeholt");
      return { sent: 0, notSent: 0, stop: true };
    }
    return { sent: sent.length, notSent: notSent.length, stop: false };
  }

  const message = resendErrorMessage(res.errorClass, res.message);
  switch (res.errorClass) {
    case "rate_limited":
      // Not processed by Resend — back to the queue, a new batch later.
      await releaseBatch(batch, message);
      return { sent: 0, notSent: 0, stop: true, retryAfterMs: res.retryAfterMs ?? 5_000 };
    case "transient":
      if (batch.attempts + 1 >= MAX_UNCLEAR_ATTEMPTS) {
        await markBatchUnclear(batch, message);
        await setMailingRunState(campaignId, { error: `${eligible.length} Mails mit unklarem Ergebnis — bitte in Resend prüfen.` });
        return { sent: 0, notSent: 0, stop: false };
      }
      await noteBatchAttempt(batch.id, message);
      await setMailingRunState(campaignId, { error: message });
      return { sent: 0, notSent: 0, stop: true, retryAfterMs: unclearRetryDelay(batch.attempts + 1) };
    case "conflict":
      await markBatchUnclear(batch, message);
      return { sent: 0, notSent: 0, stop: false };
    default:
      // quota / config / invalid / not configured: nothing was sent — pause.
      await releaseBatch(batch, message);
      await pauseWithError(campaignId, message);
      return { sent: 0, notSent: 0, stop: true };
  }
}

/**
 * One run over the due Rundmails (the cron every minute; the admin page while
 * it is open; both safe in parallel — a lease keeps one runner per mailing).
 * Never throws.
 */
export async function runMailingStep(opts: { deadlineMs: number; campaignId?: number | null }): Promise<MailingStepResult> {
  const out: MailingStepResult = { mailings: 0, batches: 0, sent: 0, notSent: 0, messages: [] };
  let ids: number[] = [];
  try {
    ids = await listDueMailings(opts.campaignId ?? null);
  } catch (err) {
    reportError(err, { route: "lib/mailing-send", phase: "listDue" });
    return out;
  }
  for (const campaignId of ids) {
    if (Date.now() > opts.deadlineMs - RUN_SAFETY_MS) break;
    const leaseSeconds = Math.ceil((opts.deadlineMs - Date.now()) / 1000) + 30;
    if (!(await acquireMailingLease(campaignId, leaseSeconds))) continue;
    out.mailings++;
    try {
      await runOneMailing(campaignId, opts.deadlineMs, out);
    } catch (err) {
      reportError(err, { route: "lib/mailing-send", phase: "runOne", campaignId });
      out.messages.push(`Rundmail ${campaignId}: unerwarteter Fehler`);
    } finally {
      await releaseMailingLease(campaignId);
    }
  }
  return out;
}

async function runOneMailing(campaignId: number, deadlineMs: number, out: MailingStepResult): Promise<void> {
  const campaign = await getCampaign(campaignId);
  let mailing = await getMailing(campaignId);
  if (!campaign || !mailing || !mailing.frozenAt || !campaignAcceptsWork(campaign)) return;
  if (!isCampaignSendsApproved()) {
    await pauseWithError(campaignId, "Versand gestoppt: CAMPAIGN_SENDS_APPROVED ist aus.");
    out.messages.push(`Rundmail ${campaignId}: CAMPAIGN_SENDS_APPROVED aus`);
    return;
  }
  const bodies = await getMailingFrozenBodies(campaignId);
  if (!bodies) {
    await pauseWithError(campaignId, "Der freigegebene Inhalt fehlt — bitte zurücknehmen und neu freigeben.");
    return;
  }

  // The audience is matched FRESH when the send starts (new subscribers in,
  // unsubscribed people out), then fixed for the rest of the run.
  if (!mailing.materializedAt) {
    const refresh = await refreshCampaignAudience(campaignId);
    if (!refresh.ok) {
      await setMailingRunState(campaignId, { error: refresh.note ?? "Die Zielgruppe konnte nicht ermittelt werden — nächster Versuch in einer Minute." });
      return;
    }
    await markMailingMaterialized(campaignId);
    mailing = (await getMailing(campaignId)) ?? mailing;
  }

  await releaseOrphanClaims(campaignId);

  // Batches a dead run left open: the same batch again, under the same key.
  for (const open of await listOpenBatches(campaignId)) {
    if (Date.now() > deadlineMs - RUN_SAFETY_MS) return;
    const created = open.createdAt ? Date.parse(open.createdAt) : Date.now();
    if (Date.now() - created > IDEMPOTENCY_WINDOW_MS) {
      await markBatchUnclear(open, "Älter als 23 Stunden — Ergebnis unklar, nicht erneut gesendet.");
      continue;
    }
    // A batch that just failed waits before the next attempt (the admin page
    // may run steps faster than the cron).
    if (open.attemptedAt && Date.now() - Date.parse(open.attemptedAt) < unclearRetryDelay(open.attempts)) return;
    const result = await sendBatch(campaign, mailing, bodies, open);
    out.batches++;
    out.sent += result.sent;
    out.notSent += result.notSent;
    if (result.stop) return;
    // Settled: the back-off of the failed attempt no longer applies.
    await setMailingRunState(campaignId, { nextBatchAt: null, error: null });
    mailing = { ...mailing, nextBatchAt: null };
  }

  const perMinute = MAILING_RATES[mailing.rate];
  const size = batchSizeFor(batchSizeSetting(), perMinute);
  const spacing = batchSpacingMs(size, perMinute);
  let nextAt = mailing.nextBatchAt ? Date.parse(mailing.nextBatchAt) : 0;

  for (;;) {
    const now = Date.now();
    if (now > deadlineMs - RUN_SAFETY_MS) return;
    if (nextAt > now) {
      if (nextAt > deadlineMs - RUN_SAFETY_MS) return;
      await sleep(nextAt - now);
    }
    // Paused or cancelled meanwhile (another tab, the operator)? Stop.
    const live = await getCampaign(campaignId);
    if (!live || !campaignAcceptsWork(live)) return;
    const batch = await claimMailingBatch(campaignId, size, mailing.engagedFirst);
    if (!batch) {
      if (await finishMailingIfDone(campaignId)) out.messages.push(`Rundmail ${campaignId}: fertig`);
      return;
    }
    const result = await sendBatch(live, mailing, bodies, batch);
    out.batches++;
    out.sent += result.sent;
    out.notSent += result.notSent;
    nextAt = Date.now() + (result.retryAfterMs ?? spacing);
    await setMailingRunState(campaignId, {
      nextBatchAt: new Date(nextAt).toISOString(),
      ...(result.sent > 0 && !result.stop ? { error: null } : {}),
    });
    if (result.stop) return;
  }
}
