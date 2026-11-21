// Premium-Karte — the print pipeline (spec §10, docs/GIFT_VOUCHERS.md).
//
// A print job (gift_voucher_print_jobs, one per voucher) moves along
//   review → queued → submitting → submitted → printing → sent
// (or failed / cancelled; `done` when it was printed in-house). This module:
//   · submitGiftVoucherPrintJob / submitDueGiftVoucherPrintJobs — hand a queued
//     job to print.one behind the gate (printone-core decideGiftVoucherPrintSubmission):
//     LEGAL GATE GIFT_VOUCHER_PRINT_SENDS_APPROVED (fail-closed), print.one
//     configured, provider printone, a public https PUBLIC_BASE_URL, job queued,
//     voucher issued (not deactivated), address valid. A blocked job stays
//     queued and its `error` tells the admin queue why;
//   · pollGiftVoucherPrintJobs + applyPrintOneOrderUpdate (the webhook) — follow
//     print.one's status MONOTONICALLY (canAdvancePrintJobStatus: a late, old or
//     repeated update changes nothing) and IDEMPOTENTLY;
//   · cancel, release (review → queued), done (printed in-house), the cleanup
//     of the print files, and the files for the in-house printer.
//
// One card, never two:
//   1. ownership — a queued job becomes 'submitting' through a conditional
//      update, so only one caller goes on; a job left 'submitting' by a dead
//      process is taken over by the sweep after PRINT_SUBMIT_STALE_MS;
//   2. the files — rendered once per job (renderGiftVoucherPrintSpreads, P1),
//      stored under a fresh asset token BEFORE the token is recorded (a recorded
//      token always has both files) and never rendered again while it exists,
//      so the URLs, and with them the request body, stay the same;
//   3. the request — Idempotency-Key gift-voucher-print-<jobId>-<created ms>
//      (giftVoucherPrintIdempotencyKey: unique across databases) and a body built
//      only from the job row: a repeat within print.one's 24 h returns the first
//      order instead of printing a second card;
//   4. the lookup — before any repeat (attempts > 0, or a recovered
//      'submitting' job) Mo searches print.one's newest orders for its asset
//      token and adopts what it finds, so an attempt whose answer was lost is
//      not printed twice even after 24 h.
// (A second card would not double the value — it carries the same code — but
// it costs money and confuses the recipient.)
//
// Retries: print.one's own refusal (HTTP 4xx, kind `invalid`) fails the job;
// everything else is retried on the voucher plan and then every 12 hours
// (planPrintJobRetryMinutes) — a job is never failed for a temporary problem.
//
// The print files hold the gift-card code: rendered in memory, stored in the
// private Blob store, served to print.one only by /api/gift-vouchers/print-asset
// under a 192-bit token while the job is open, deleted once it is finished
// (cleanupGiftVoucherPrintAssets). Nothing here logs a code, a name, an
// address or print.one's message texts; reportError gets ids and kinds.
//
// Never throws: every export answers a typed result (or counts).

import sharp from "sharp";
import { canAdvancePrintJobStatus, newOpaqueToken, planGiftVoucherRetry, validatePostalAddress } from "./gift-voucher-core.mjs";
import {
  configuredGiftVoucherPrintProvider,
  giftVoucherPrintCountries,
  isGiftVoucherPrintSendsApproved,
  printOneApiKey,
  printOneBillingId,
  printOneCardCostCents,
  printOneFinish,
  printOneTemplateId,
  printOneWebhookSecret,
} from "./gift-voucher-flags.mjs";
import {
  PRINTONE_SQ14_SPREAD,
  PRINT_SUBMIT_STALE_MS,
  buildPrintOneOrderBody,
  canCleanPrintJobAssets,
  decideGiftVoucherPrintSubmission,
  describePrintOneOrderFailure,
  giftVoucherPrintAssetPathname,
  giftVoucherPrintAssetUrl,
  giftVoucherPrintGlobalBlock,
  giftVoucherPrintIdempotencyKey,
  planPrintJobRetryMinutes,
  publicHttpsBaseUrl,
} from "./printone-core.mjs";
import {
  cancelPrintOneOrder,
  createPrintOneOrder,
  findPrintOneOrderByAssetToken,
  getPrintOneOrder,
  isPrintOneConfigured,
  type PrintOneFailure,
  type PrintOneOrder,
} from "./printone";
import { deleteGiftVoucherBlobs, getGiftVoucherBlob, isGiftVoucherBlobConfigured, putGiftVoucherBlob } from "./gift-voucher-blob";
import { giftVoucherRenderInputFromVoucher, loadGiftVoucherPhoto, renderGiftVoucherPrintSpreads } from "./gift-voucher-render";
import {
  claimDueGiftVoucherPrintJobs,
  clearGiftVoucherPrintJobAssets,
  getGiftVoucher,
  getGiftVoucherCode,
  getGiftVoucherPrintJob,
  getGiftVoucherPrintJobByProviderOrderId,
  listGiftVoucherPrintJobsToPoll,
  listGiftVoucherPrintJobsWithAssetsToClean,
  markGiftVoucherPrintJobPolled,
  markGiftVoucherPrintJobSubmitted,
  scheduleGiftVoucherPrintJobRetry,
  setGiftVoucherAttention,
  setGiftVoucherPrintJobAssets,
  updateGiftVoucherPrintJobStatus,
  type GiftVoucher,
  type GiftVoucherPrintJob,
  type GiftVoucherPrintProvider,
  type GiftVoucherPrintStatus,
} from "./gift-voucher-store";
import { reportError } from "./observability";

const ROUTE = "lib/gift-voucher-print";
/** A job blocked by its own data (address, voucher not issued) is looked at again after this. */
const BLOCKED_RETRY_MINUTES = 60;
/** A job at print.one is read again when unchanged for this long … */
const POLL_MIN_AGE_MINUTES = 60;
/** … or this long when the webhook is set up (polling is then only the safety net). */
const POLL_MIN_AGE_WITH_WEBHOOK_MINUTES = 180;
/**
 * Time one submission usually needs at most (render, two uploads, lookup, POST);
 * the sweep starts none closer to its deadline. Should a slow one still be cut
 * off by the function limit, the job stays 'submitting' and the sweep takes it
 * over after PRINT_SUBMIT_STALE_MS (lookup first — no second card).
 */
const SUBMIT_BUDGET_MS = 20_000;
const MAX_BATCH = 50;

/** Lookup failures that only mean "the lookup cannot be used" — the POST (with its Idempotency-Key) goes ahead. */
const LOOKUP_UNUSABLE = new Set<PrintOneFailure["kind"]>(["invalid", "not_found", "conflict"]);

export type GiftVoucherPrintSubmitResult =
  | { ok: true; status: GiftVoucherPrintStatus }
  | { ok: false; code: "gate_off" | "not_configured" | "manual" | "not_ready" | "review" | "failed" | "not_found"; message: string };

type Tally = "submitted" | "failed" | "skipped";
interface Outcome {
  result: GiftVoucherPrintSubmitResult;
  tally: Tally;
}

const NOT_FOUND = "Druckauftrag nicht gefunden.";

function minutesFromNow(minutes: number): Date {
  return new Date(Date.now() + minutes * 60_000);
}

function isFresh(iso: string | null, maxAgeMs: number): boolean {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) && Date.now() - t < maxAgeMs;
}

function clampLimit(limit: number, fallback: number): number {
  return typeof limit === "number" && Number.isSafeInteger(limit) && limit > 0 ? Math.min(limit, MAX_BATCH) : fallback;
}

function globalGateInput() {
  return {
    gateApproved: isGiftVoucherPrintSendsApproved(),
    printOneConfigured: isPrintOneConfigured(),
    configuredProvider: configuredGiftVoucherPrintProvider(),
    baseUrl: publicHttpsBaseUrl(process.env.PUBLIC_BASE_URL),
  };
}

/** GIFT_VOUCHER_PRINT_PROVIDER, falling back to the manual print queue while print.one is not configured. */
export function giftVoucherPrintProvider(): GiftVoucherPrintProvider {
  return configuredGiftVoucherPrintProvider() === "printone" && isPrintOneConfigured() ? "printone" : "manual";
}

/**
 * Why print.one submissions are held back right now (gate, configuration,
 * provider, PUBLIC_BASE_URL) — null when they may run. For the admin print
 * queue and the setup check.
 */
export function giftVoucherPrintGateBlock(): { code: "gate_off" | "not_configured" | "manual"; message: string } | null {
  return giftVoucherPrintGlobalBlock(globalGateInput());
}

// ── the print files ──────────────────────────────────────────────────────────

/** A JPEG of exactly the SQ14 spread size, not CMYK — what the template expects. */
async function isPrintSpread(bytes: unknown): Promise<boolean> {
  if (!Buffer.isBuffer(bytes) || bytes.length < 1000) return false;
  try {
    const meta = await sharp(bytes).metadata();
    return (
      meta.format === "jpeg" &&
      meta.width === PRINTONE_SQ14_SPREAD.widthPx &&
      meta.height === PRINTONE_SQ14_SPREAD.heightPx &&
      meta.space !== "cmyk"
    );
  } catch {
    return false;
  }
}

/** Render both spreads of a voucher (the code is decrypted only for this, in memory). */
async function renderSpreads(
  voucher: GiftVoucher
): Promise<{ ok: true; outside: Buffer; inside: Buffer } | { ok: false; message: string }> {
  const code = await getGiftVoucherCode(voucher.id);
  if (!code) return { ok: false, message: "Der Gutscheincode ist nicht lesbar (TOKEN_ENC_KEY prüfen)." };
  const photo = voucher.designKey === "photo" && voucher.photoPathname ? await loadGiftVoucherPhoto(voucher.photoPathname) : null;
  let spreads: { outside: Buffer; inside: Buffer };
  try {
    spreads = await renderGiftVoucherPrintSpreads(giftVoucherRenderInputFromVoucher(voucher, code, photo));
  } catch (err) {
    reportError(err, { route: ROUTE, phase: "render", voucherId: voucher.id });
    return { ok: false, message: "Die Druckdateien konnten nicht erzeugt werden." };
  }
  const [outsideOk, insideOk] = await Promise.all([isPrintSpread(spreads?.outside), isPrintSpread(spreads?.inside)]);
  if (!outsideOk || !insideOk) {
    reportError(new Error("print spreads have the wrong format"), { route: ROUTE, phase: "render", voucherId: voucher.id });
    return {
      ok: false,
      message: `Die Druckdateien haben nicht das erwartete Format (JPEG ${PRINTONE_SQ14_SPREAD.widthPx} × ${PRINTONE_SQ14_SPREAD.heightPx} px).`,
    };
  }
  return { ok: true, outside: spreads.outside, inside: spreads.inside };
}

/**
 * The job's asset token, with both files in the private Blob store. Renders and
 * uploads only when the job has no token yet; the token is recorded only after
 * both uploads succeeded, and only once per job (setGiftVoucherPrintJobAssets).
 */
async function ensurePrintAssets(
  job: GiftVoucherPrintJob,
  voucher: GiftVoucher
): Promise<{ ok: true; token: string } | { ok: false; message: string }> {
  if (job.assetToken && job.assetOutsidePathname && job.assetInsidePathname) return { ok: true, token: job.assetToken };
  if (!isGiftVoucherBlobConfigured()) {
    return { ok: false, message: "BLOB_READ_WRITE_TOKEN fehlt — die Druckdateien können nicht gespeichert werden." };
  }
  const spreads = await renderSpreads(voucher);
  if (!spreads.ok) return spreads;
  const token = newOpaqueToken(24);
  const outside = giftVoucherPrintAssetPathname(token, "outside");
  const inside = giftVoucherPrintAssetPathname(token, "inside");
  if (!outside || !inside) return { ok: false, message: "Interner Fehler beim Benennen der Druckdateien." };
  const [outsideStored, insideStored] = await Promise.all([
    putGiftVoucherBlob(outside, spreads.outside, "image/jpeg"),
    putGiftVoucherBlob(inside, spreads.inside, "image/jpeg"),
  ]);
  if (!outsideStored || !insideStored) {
    await deleteGiftVoucherBlobs([outside, inside]);
    return { ok: false, message: "Die Druckdateien konnten nicht gespeichert werden (Vercel Blob)." };
  }
  if (await setGiftVoucherPrintJobAssets(job.id, { token, outside, inside })) return { ok: true, token };
  // Someone else recorded files first (or the update failed): theirs win, ours go.
  await deleteGiftVoucherBlobs([outside, inside]);
  const again = await getGiftVoucherPrintJob(job.id);
  if (again?.assetToken && again.assetOutsidePathname && again.assetInsidePathname) return { ok: true, token: again.assetToken };
  return { ok: false, message: "Die Druckdateien konnten nicht am Druckauftrag vermerkt werden." };
}

// ── applying print.one's view of an order ────────────────────────────────────

type ApplyOutcome = { outcome: "updated" | "unchanged" | "error"; status: GiftVoucherPrintStatus };

/**
 * Move a job to the status print.one reports — only forward
 * (canAdvancePrintJobStatus), so repeats and late arrivals change nothing. A
 * new provider status without a status change is still recorded. "error" =
 * the move was allowed but did not happen (database problem).
 */
async function applyOrderToJob(job: GiftVoucherPrintJob, order: PrintOneOrder, eventAt: string | null): Promise<ApplyOutcome> {
  const target = order.jobStatus;
  if (!target || target === job.status || !canAdvancePrintJobStatus(job.status, target)) {
    if (order.status && order.status !== job.providerStatus) {
      await updateGiftVoucherPrintJobStatus(job.id, job.status, { providerStatus: order.status });
    }
    return { outcome: "unchanged", status: job.status };
  }
  const changed = await updateGiftVoucherPrintJobStatus(job.id, target, {
    providerStatus: order.status,
    ...(target === "failed" ? { error: describePrintOneOrderFailure(order) } : {}),
    ...(target === "sent" ? { sentAt: eventAt ?? order.updatedAt ?? null } : {}),
  });
  if (changed) return { outcome: "updated", status: target };
  const now = await getGiftVoucherPrintJob(job.id);
  if (now && (now.status === target || !canAdvancePrintJobStatus(now.status, target))) {
    return { outcome: "unchanged", status: now.status };
  }
  return { outcome: "error", status: now?.status ?? job.status };
}

/**
 * A print.one order update (webhook) → the job with that order id. Monotonic and
 * idempotent; "unknown_order" for an order Mo did not record (not ours, or its
 * id is not stored yet — the poll catches up); "error" only when the store
 * failed (the route answers 500 so print.one may deliver again).
 */
export async function applyPrintOneOrderUpdate(input: {
  order: PrintOneOrder;
  eventAt: string | null;
}): Promise<{ outcome: "updated" | "unchanged" | "unknown_order" | "error"; status: GiftVoucherPrintStatus | null }> {
  try {
    const job = await getGiftVoucherPrintJobByProviderOrderId(input.order.id);
    if (!job || job.provider !== "printone") return { outcome: "unknown_order", status: null };
    return await applyOrderToJob(job, input.order, input.eventAt);
  } catch (err) {
    reportError(err, { route: ROUTE, phase: "applyUpdate" });
    return { outcome: "error", status: null };
  }
}

// ── submission ───────────────────────────────────────────────────────────────

/** Try again later on the print plan (never fails the job — see the header). */
async function retryLater(job: GiftVoucherPrintJob, message: string): Promise<Outcome> {
  const wait = planPrintJobRetryMinutes(job.attempts + 1, planGiftVoucherRetry);
  await scheduleGiftVoucherPrintJobRetry(job.id, { error: message, nextAttemptAt: minutesFromNow(wait) });
  return {
    result: { ok: false, code: "failed", message: `${message} Der nächste Versuch läuft automatisch.` },
    tally: "failed",
  };
}

/**
 * Was an earlier attempt of this job possibly accepted by print.one without Mo
 * learning the order id (an answer lost)? Then look for it. ok + null = no such
 * order (or nothing to look for); ok: false = print.one could not be asked.
 */
async function findUnrecordedOrder(
  job: GiftVoucherPrintJob
): Promise<{ ok: true; order: PrintOneOrder | null } | { ok: false; message: string }> {
  // Only a job that already had its files and was (possibly) sent: 'submitting'
  // right now / left over, or queued again after a failed attempt.
  const mayExist =
    job.provider === "printone" &&
    !job.providerOrderId &&
    (job.status === "submitting" || (job.status === "queued" && job.attempts > 0));
  if (!mayExist || !job.assetToken || !printOneApiKey()) return { ok: true, order: null };
  const found = await findPrintOneOrderByAssetToken({ token: job.assetToken, createdAfter: job.createdAt });
  if (found.ok) return found;
  if (LOOKUP_UNUSABLE.has(found.kind)) return { ok: true, order: null };
  return { ok: false, message: found.message };
}

/**
 * print.one has (or just created) the order: record its id, then apply the
 * status it already reports (it may already be printing — or failed at once).
 */
async function adoptOrder(job: GiftVoucherPrintJob, order: PrintOneOrder): Promise<Outcome> {
  const costCents = order.isBillable === false ? 0 : printOneCardCostCents();
  let current: GiftVoucherPrintJob = { ...job, status: "submitted", providerOrderId: order.id };
  const marked = await markGiftVoucherPrintJobSubmitted(job.id, { providerOrderId: order.id, providerStatus: order.status, costCents });
  if (!marked) {
    const now = await getGiftVoucherPrintJob(job.id);
    if (!now || now.providerOrderId !== order.id) {
      if (now?.status === "cancelled") {
        // Cancelled while the order was being created: cancel it at print.one too.
        const cancelled = await cancelPrintOneOrder(order.id);
        reportError(new Error("print job cancelled during submission"), {
          route: ROUTE,
          phase: "adopt",
          jobId: job.id,
          cancelledAtProvider: cancelled.ok,
        });
        return {
          result: {
            ok: false,
            code: "failed",
            message: cancelled.ok
              ? "Der Druckauftrag wurde während der Übermittlung storniert — auch bei print.one storniert."
              : `Der Druckauftrag wurde während der Übermittlung storniert — bitte den print.one-Auftrag ${order.id} im Portal stornieren.`,
          },
          tally: "failed",
        };
      }
      // The id could not be stored: the job stays 'submitting', the sweep takes
      // it over after a few minutes and finds this order by its asset token.
      reportError(new Error("print.one order id could not be recorded"), { route: ROUTE, phase: "adopt", jobId: job.id });
      return {
        result: {
          ok: false,
          code: "failed",
          message: "Die Auftragsnummer von print.one konnte nicht gespeichert werden — der nächste Lauf gleicht sie ab.",
        },
        tally: "failed",
      };
    }
    current = now;
  }
  const applied = await applyOrderToJob(current, order, null);
  if (applied.status === "failed") {
    return { result: { ok: false, code: "failed", message: describePrintOneOrderFailure(order) }, tally: "failed" };
  }
  return { result: { ok: true, status: applied.status }, tally: "submitted" };
}

/**
 * One job through the gate and, when it passes, to print.one. `claimed`: the
 * sweep holds the claim lease (and may take over a lost 'submitting' job);
 * blocked jobs it pushes back so they do not hog the queue.
 */
async function processPrintJob(initial: GiftVoucherPrintJob, opts: { claimed: boolean }): Promise<Outcome> {
  let job = initial;
  const recovering = opts.claimed && job.status === "submitting";
  const voucher = await getGiftVoucher(job.voucherId);
  const decision = decideGiftVoucherPrintSubmission({
    job: { provider: job.provider, status: job.status },
    voucher: voucher ? { status: voucher.status } : null,
    ...globalGateInput(),
    address: job.address,
    countries: giftVoucherPrintCountries(),
    recovering,
  });
  if (decision.action === "already") return { result: { ok: true, status: decision.status }, tally: "skipped" };
  if (decision.action === "block") {
    if (opts.claimed && decision.scope === "voucher_ended") {
      await stopJobOfEndedVoucher(job, voucher);
    } else if (opts.claimed && decision.scope === "job") {
      await scheduleGiftVoucherPrintJobRetry(job.id, { error: decision.message, nextAttemptAt: minutesFromNow(BLOCKED_RETRY_MINUTES) });
    }
    return { result: { ok: false, code: decision.code, message: decision.message }, tally: "skipped" };
  }
  if (!voucher) return { result: { ok: false, code: "not_found", message: NOT_FOUND }, tally: "skipped" };

  // Ownership: queued → submitting succeeds for exactly one caller.
  if (job.status === "queued") {
    const took = await updateGiftVoucherPrintJobStatus(job.id, "submitting");
    if (!took) {
      const now = await getGiftVoucherPrintJob(job.id);
      if (now && (now.status === "submitted" || now.status === "printing" || now.status === "sent")) {
        return { result: { ok: true, status: now.status }, tally: "skipped" };
      }
      return {
        result: { ok: false, code: "not_ready", message: "Der Druckauftrag wird gerade an anderer Stelle bearbeitet." },
        tally: "skipped",
      };
    }
    job = { ...job, status: "submitting" };
  }

  const assets = await ensurePrintAssets(job, voucher);
  if (!assets.ok) return retryLater(job, assets.message);
  job = { ...job, assetToken: assets.token };

  const baseUrl = publicHttpsBaseUrl(process.env.PUBLIC_BASE_URL);
  const built = buildPrintOneOrderBody({
    templateId: printOneTemplateId(),
    finish: printOneFinish(),
    billingId: printOneBillingId(),
    address: job.address,
    outsideUrl: giftVoucherPrintAssetUrl(baseUrl, assets.token, "outside"),
    insideUrl: giftVoucherPrintAssetUrl(baseUrl, assets.token, "inside"),
  });
  if (!built.ok) return retryLater(job, `Der Auftrag für print.one ließ sich nicht zusammenstellen (${built.reason}).`);

  // A repeat: first make sure print.one does not have it already.
  if (job.attempts > 0 || recovering) {
    const found = await findUnrecordedOrder(job);
    if (!found.ok) return retryLater(job, found.message);
    if (found.order) return adoptOrder(job, found.order);
  }

  const key = giftVoucherPrintIdempotencyKey(job.id, job.createdAt);
  if (!key) return retryLater(job, "Interner Fehler: kein Idempotency-Key.");
  const created = await createPrintOneOrder(built.body, key);
  if (created.ok) return adoptOrder(job, created.order);
  if (created.kind === "invalid") {
    await updateGiftVoucherPrintJobStatus(job.id, "failed", { error: created.message });
    return { result: { ok: false, code: "failed", message: created.message }, tally: "failed" };
  }
  if (created.kind === "conflict") {
    // The key is known at print.one: the order of an earlier attempt exists (or a
    // request with this key is still running) — find it, else back off on the plan.
    const found = await findUnrecordedOrder(job);
    if (found.ok && found.order) return adoptOrder(job, found.order);
    return retryLater(job, created.message);
  }
  return retryLater(job, created.message);
}

/**
 * Hand one print job to print.one now (after issuing, or „Jetzt drucken“ in the
 * admin). A job already at print.one answers ok with its status.
 */
export async function submitGiftVoucherPrintJob(
  jobId: number
): Promise<
  | { ok: true; status: GiftVoucherPrintStatus }
  | { ok: false; code: "gate_off" | "not_configured" | "manual" | "not_ready" | "review" | "failed" | "not_found"; message: string }
> {
  try {
    if (!Number.isSafeInteger(jobId) || jobId <= 0) return { ok: false, code: "not_found", message: NOT_FOUND };
    const job = await getGiftVoucherPrintJob(jobId);
    if (!job) return { ok: false, code: "not_found", message: NOT_FOUND };
    return (await processPrintJob(job, { claimed: false })).result;
  } catch (err) {
    reportError(err, { route: ROUTE, phase: "submit", jobId });
    return { ok: false, code: "failed", message: "Der Druckauftrag konnte nicht übermittelt werden." };
  }
}

/**
 * The sweep: submit due print.one jobs one by one (claim lease per job) until
 * `limit` or shortly before `deadlineMs` (epoch ms). Nothing is claimed while a
 * global gate is closed.
 */
export async function submitDueGiftVoucherPrintJobs(opts: {
  limit: number;
  deadlineMs?: number;
}): Promise<{ submitted: number; failed: number; skipped: number }> {
  const counts = { submitted: 0, failed: 0, skipped: 0 };
  try {
    if (giftVoucherPrintGlobalBlock(globalGateInput())) return counts;
    const limit = clampLimit(opts.limit, 10);
    for (let i = 0; i < limit; i++) {
      if (typeof opts.deadlineMs === "number" && Date.now() + SUBMIT_BUDGET_MS > opts.deadlineMs) break;
      const [job] = await claimDueGiftVoucherPrintJobs({ limit: 1, provider: "printone" });
      if (!job) break;
      if (job.status === "submitting" && isFresh(job.updatedAt, PRINT_SUBMIT_STALE_MS)) {
        counts.skipped++; // in flight elsewhere — the claim lease keeps it out of this run
        continue;
      }
      const outcome = await processPrintJob(job, { claimed: true });
      counts[outcome.tally]++;
    }
  } catch (err) {
    reportError(err, { route: ROUTE, phase: "submitDue" });
  }
  return counts;
}

// ── polling ──────────────────────────────────────────────────────────────────

/**
 * Read the status of jobs at print.one that have not changed for a while (the
 * safety net next to the webhook). Stops at the first transport or key problem.
 */
export async function pollGiftVoucherPrintJobs(opts: { limit: number }): Promise<{ updated: number }> {
  let updated = 0;
  try {
    if (!printOneApiKey()) return { updated };
    const minAgeMinutes = printOneWebhookSecret() ? POLL_MIN_AGE_WITH_WEBHOOK_MINUTES : POLL_MIN_AGE_MINUTES;
    const jobs = await listGiftVoucherPrintJobsToPoll({ limit: clampLimit(opts.limit, 20), minAgeMinutes });
    for (const job of jobs) {
      if (!job.providerOrderId) continue;
      const res = await getPrintOneOrder(job.providerOrderId);
      if (!res.ok) {
        if (res.kind === "not_found") {
          await markGiftVoucherPrintJobPolled(job.id); // e.g. a TEST order read with a LIVE key — ask again later
          continue;
        }
        break;
      }
      const applied = await applyOrderToJob(job, res.order, null);
      if (applied.outcome === "updated") updated++;
      else await markGiftVoucherPrintJobPolled(job.id);
    }
  } catch (err) {
    reportError(err, { route: ROUTE, phase: "poll" });
  }
  return { updated };
}

// ── cancel, release, done ────────────────────────────────────────────────────

/** Cancel the order at print.one, then the job. */
async function cancelAtPrintOne(
  job: GiftVoucherPrintJob,
  orderId: string
): Promise<{ ok: true } | { ok: false; code: "too_late" | "failed" | "not_found"; message: string }> {
  if (!printOneApiKey()) {
    return { ok: false, code: "failed", message: `print.one ist nicht eingerichtet — bitte den Auftrag ${orderId} im print.one-Portal stornieren.` };
  }
  const res = await cancelPrintOneOrder(orderId);
  if (!res.ok) {
    if (res.kind === "not_cancellable") return { ok: false, code: "too_late", message: res.message };
    if (res.kind === "not_found") {
      return { ok: false, code: "failed", message: `print.one kennt den Auftrag ${orderId} nicht — bitte im print.one-Portal prüfen.` };
    }
    return { ok: false, code: "failed", message: res.message };
  }
  if (await updateGiftVoucherPrintJobStatus(job.id, "cancelled", { providerStatus: res.order?.status ?? "order_cancelled" })) {
    return { ok: true };
  }
  const now = await getGiftVoucherPrintJob(job.id);
  if (now?.status === "cancelled") return { ok: true };
  reportError(new Error("print job cancelled at print.one but not in the store"), { route: ROUTE, phase: "cancel", jobId: job.id });
  return { ok: false, code: "failed", message: "Bei print.one storniert, aber der Druckauftrag ließ sich nicht aktualisieren." };
}

type CancelResult = { ok: true } | { ok: false; code: "too_late" | "failed" | "not_found"; message: string };

/**
 * Cancel one job. `owned`: the caller holds the job (the sweep's claim), so a
 * 'submitting' job may be cancelled too; otherwise it is in flight elsewhere.
 * A job not (known to be) at print.one is first checked for an order an
 * unanswered attempt may have created.
 */
async function cancelJob(job: GiftVoucherPrintJob, opts: { owned: boolean; depth?: number }): Promise<CancelResult> {
  switch (job.status) {
    case "cancelled":
    case "failed": // print.one does not print it — nothing left to stop
      return { ok: true };
    case "sent":
      return { ok: false, code: "too_late", message: "Die Karte ist schon verschickt." };
    case "done":
      return { ok: false, code: "too_late", message: "Die Karte wurde schon von Hand gedruckt und verschickt." };
    case "submitting":
      if (!opts.owned) {
        return {
          ok: false,
          code: "failed",
          message: "Der Druckauftrag wird gerade an print.one übermittelt — bitte in ein paar Minuten noch einmal stornieren.",
        };
      }
      break;
    case "submitted":
    case "printing":
      if (job.providerOrderId) return cancelAtPrintOne(job, job.providerOrderId);
      break; // no order id (should not happen) — handled like a job not at print.one
    default:
      break;
  }
  const found = await findUnrecordedOrder(job);
  if (!found.ok) {
    return { ok: false, code: "failed", message: `Konnte nicht prüfen, ob print.one den Auftrag schon hat: ${found.message}` };
  }
  if (found.order && found.order.jobStatus !== "cancelled" && found.order.jobStatus !== "failed") {
    await markGiftVoucherPrintJobSubmitted(job.id, {
      providerOrderId: found.order.id,
      providerStatus: found.order.status,
      costCents: found.order.isBillable === false ? 0 : printOneCardCostCents(),
    });
    return cancelAtPrintOne(job, found.order.id);
  }
  if (await updateGiftVoucherPrintJobStatus(job.id, "cancelled")) return { ok: true };
  const now = await getGiftVoucherPrintJob(job.id);
  if (now?.status === "cancelled") return { ok: true };
  const depth = opts.depth ?? 0;
  if (now && now.status !== job.status && depth < 3) return cancelJob(now, { ...opts, depth: depth + 1 }); // it moved meanwhile
  return { ok: false, code: "failed", message: "Der Druckauftrag konnte nicht storniert werden — bitte erneut versuchen." };
}

/**
 * Stop a print job: not at print.one yet → cancelled here; at print.one →
 * cancelled there first (`too_late` once it is in production or sent).
 */
export async function cancelGiftVoucherPrintJob(
  jobId: number
): Promise<{ ok: true } | { ok: false; code: "too_late" | "failed" | "not_found"; message: string }> {
  try {
    const job = Number.isSafeInteger(jobId) && jobId > 0 ? await getGiftVoucherPrintJob(jobId) : null;
    if (!job) return { ok: false, code: "not_found", message: NOT_FOUND };
    return await cancelJob(job, { owned: false });
  } catch (err) {
    reportError(err, { route: ROUTE, phase: "cancel", jobId });
    return { ok: false, code: "failed", message: "Der Druckauftrag konnte nicht storniert werden." };
  }
}

/**
 * The sweep found a job whose voucher was deactivated, cancelled or rejected
 * (the issuing flow normally cancels it already): cancel it. When print.one
 * already prints it, flag the voucher („Druckauftrag ließ sich nicht mehr
 * stornieren“) unless it carries another flag; when print.one cannot be asked
 * now, look again later.
 */
async function stopJobOfEndedVoucher(job: GiftVoucherPrintJob, voucher: GiftVoucher | null): Promise<void> {
  const res = await cancelJob(job, { owned: true });
  if (res.ok) return;
  if (res.code === "too_late") {
    if (voucher && !voucher.attention) await setGiftVoucherAttention(voucher.id, "print_cancel_too_late");
    return;
  }
  await scheduleGiftVoucherPrintJobRetry(job.id, { error: res.message, nextAttemptAt: minutesFromNow(BLOCKED_RETRY_MINUTES) });
}

/** „Freigeben“: review → queued (the sweep or „Jetzt drucken“ submits it). Needs a valid address. */
export async function releaseGiftVoucherPrintJob(jobId: number): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
  try {
    const job = Number.isSafeInteger(jobId) && jobId > 0 ? await getGiftVoucherPrintJob(jobId) : null;
    if (!job) return { ok: false, code: "not_found", message: NOT_FOUND };
    if (job.status === "queued") return { ok: true };
    if (job.status !== "review") {
      return { ok: false, code: "invalid_status", message: "Der Druckauftrag ist nicht im Status „Zu prüfen“." };
    }
    const address = validatePostalAddress(job.address, { countries: giftVoucherPrintCountries(), locale: "de" });
    if (!address.ok) {
      return { ok: false, code: "address", message: `Die Empfängeradresse fehlt oder ist ungültig: ${address.message}` };
    }
    if (await updateGiftVoucherPrintJobStatus(job.id, "queued")) return { ok: true };
    const now = await getGiftVoucherPrintJob(job.id);
    if (now?.status === "queued") return { ok: true };
    return { ok: false, code: "failed", message: "Der Druckauftrag konnte nicht freigegeben werden." };
  } catch (err) {
    reportError(err, { route: ROUTE, phase: "release", jobId });
    return { ok: false, code: "failed", message: "Der Druckauftrag konnte nicht freigegeben werden." };
  }
}

/**
 * „Als versendet markieren“: printed and posted in-house → done (from review,
 * queued or failed). Refused when print.one already has the order.
 */
export async function markGiftVoucherPrintJobDone(jobId: number): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
  try {
    const job = Number.isSafeInteger(jobId) && jobId > 0 ? await getGiftVoucherPrintJob(jobId) : null;
    if (!job) return { ok: false, code: "not_found", message: NOT_FOUND };
    if (job.status === "done") return { ok: true };
    if (!canAdvancePrintJobStatus(job.status, "done")) {
      return {
        ok: false,
        code: "invalid_status",
        message:
          job.status === "submitting" || job.status === "submitted" || job.status === "printing" || job.status === "sent"
            ? "print.one druckt diese Karte — sie kann nicht zusätzlich von Hand erledigt werden."
            : "Nur wartende, zu prüfende oder fehlgeschlagene Druckaufträge können als erledigt markiert werden.",
      };
    }
    const found = await findUnrecordedOrder(job);
    if (!found.ok) {
      return { ok: false, code: "failed", message: `Konnte nicht prüfen, ob print.one den Auftrag schon hat: ${found.message}` };
    }
    if (found.order && found.order.jobStatus !== "cancelled" && found.order.jobStatus !== "failed") {
      await adoptOrder({ ...job, status: "submitting" }, found.order);
      return {
        ok: false,
        code: "at_provider",
        message: `print.one hat diesen Auftrag schon (${found.order.id}) — die Karte wird dort gedruckt. Bei Bedarf dort stornieren.`,
      };
    }
    if (await updateGiftVoucherPrintJobStatus(job.id, "done")) return { ok: true };
    const now = await getGiftVoucherPrintJob(job.id);
    if (now?.status === "done") return { ok: true };
    return { ok: false, code: "failed", message: "Der Druckauftrag konnte nicht als erledigt markiert werden." };
  } catch (err) {
    reportError(err, { route: ROUTE, phase: "done", jobId });
    return { ok: false, code: "failed", message: "Der Druckauftrag konnte nicht als erledigt markiert werden." };
  }
}

// ── print files: cleanup and the in-house download ───────────────────────────

/**
 * Delete the print files of FINISHED jobs (sent, done, cancelled, failed) from
 * Blob, then forget their token — the public asset URL stops working. An open
 * job keeps its files however old it is (canCleanPrintJobAssets: the token
 * finds an order whose answer was lost). `deleted` = files removed.
 */
export async function cleanupGiftVoucherPrintAssets(opts: { limit: number }): Promise<{ deleted: number }> {
  let deleted = 0;
  try {
    if (!isGiftVoucherBlobConfigured()) return { deleted };
    const jobs = await listGiftVoucherPrintJobsWithAssetsToClean({ limit: clampLimit(opts.limit, 20) });
    for (const job of jobs) {
      if (!canCleanPrintJobAssets(job)) continue;
      const paths = [job.assetOutsidePathname, job.assetInsidePathname].filter((p): p is string => typeof p === "string" && p.length > 0);
      const removed = paths.length > 0 ? await deleteGiftVoucherBlobs(paths) : 0;
      if (removed === paths.length && (await clearGiftVoucherPrintJobAssets(job.id))) deleted += removed;
    }
  } catch (err) {
    reportError(err, { route: ROUTE, phase: "cleanup" });
  }
  return { deleted };
}

/**
 * The two print spreads of a job for printing in-house (admin download): the
 * stored files when they still exist (exactly what print.one got), else freshly
 * rendered. Null unless the voucher is issued and its code readable.
 */
export async function giftVoucherPrintFiles(jobId: number): Promise<{ outside: Buffer; inside: Buffer } | null> {
  try {
    const job = Number.isSafeInteger(jobId) && jobId > 0 ? await getGiftVoucherPrintJob(jobId) : null;
    if (!job) return null;
    const voucher = await getGiftVoucher(job.voucherId);
    if (!voucher || voucher.status !== "issued") return null;
    if (job.assetOutsidePathname && job.assetInsidePathname) {
      const [outside, inside] = await Promise.all([
        getGiftVoucherBlob(job.assetOutsidePathname),
        getGiftVoucherBlob(job.assetInsidePathname),
      ]);
      if (outside && inside) return { outside: outside.bytes, inside: inside.bytes };
    }
    const spreads = await renderSpreads(voucher);
    return spreads.ok ? { outside: spreads.outside, inside: spreads.inside } : null;
  } catch (err) {
    reportError(err, { route: ROUTE, phase: "printFiles", jobId });
    return null;
  }
}
