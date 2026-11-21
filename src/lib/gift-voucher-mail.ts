// Geschenkgutscheine — the voucher e-mail (spec §9 „Mail“; docs/GIFT_VOUCHERS.md).
//
// A shop voucher goes to the buyer, a voucher an operator issued with
// delivery „E-Mail“ to the recipient; admin vouchers delivered as PDF or card
// get no mail. The mail carries the code, the PDF (attachment) and a download
// link (`/api/gift-vouchers/download?t=<token>` — only the token's hash is
// stored; every new mail rotates it, so an older link stops working).
// Transactional (Art. 6(1)(b) GDPR): no marketing, no discount, no promo
// block. What the mail says and what a failure means are pure
// (gift-voucher-mail-core.mjs, tested); this file does the I/O.
//
// Idempotency: the Resend key is gift-voucher-mail-<id>-<mail_attempts>.
// mail_attempts counts up with every concluded try (sent, failed, an error
// with a retry), so a resend gets a fresh key while a REPEAT of the same try
// — a worker died after Resend took the mail, before the state was written —
// is refused by Resend (409) and recorded as sent instead of mailed twice.
//
// The mail log (email_messages, which also feeds the AI customer profile and
// the admin's correspondence view) gets the REDACTED copy: the code masked
// to its last four characters, no download link.
//
// Never throws: every outcome is a typed result; the mail state on the
// voucher row (mail_status, mail_attempts, mail_next_attempt_at, last_error)
// tells the cron sweep and the admin what happens next.

import { isEmailConfigured, sendEmail, senderAddress } from "./email";
import { outboundThreading } from "./email-inbound";
import { recordSentMessage } from "./email-messages-store";
import {
  emailLinkStyle,
  emailMutedTextStyle,
  emailTextStyle,
  renderBrandedEmail,
  renderSectionRow,
} from "./email-template";
import { withEmailDesign } from "./email-design-context";
import { getCachedEmailDesignForKind } from "./email-design-store";
import { getBaseUrl } from "./base-url";
import { reportError } from "./observability";
import { hashOpaqueToken, newOpaqueToken, planGiftVoucherRetry } from "./gift-voucher-core.mjs";
import { giftVoucherPageUrl, giftVoucherTermsUrl } from "./gift-voucher-flags.mjs";
import {
  getGiftVoucher,
  getGiftVoucherCode,
  getGiftVoucherPrintJobForVoucher,
  setGiftVoucherDownloadTokenHash,
  setGiftVoucherMailState,
  type GiftVoucher,
} from "./gift-voucher-store";
import { giftVoucherRenderInputFromVoucher, loadGiftVoucherPhoto, renderGiftVoucherPdf } from "./gift-voucher-render";
import {
  GIFT_VOUCHER_MAIL_KIND,
  buildGiftVoucherMail,
  giftVoucherDownloadUrl,
  giftVoucherMailIdempotencyKey,
  giftVoucherMailTarget,
  giftVoucherPdfFilename,
  planGiftVoucherMailFailure,
  redactGiftVoucherMailParams,
  type GiftVoucherMailContent,
  type GiftVoucherMailParams,
} from "./gift-voucher-mail-core.mjs";
import { revokeReasonOf } from "./gift-voucher-issue-core.mjs";

export type GiftVoucherMailOutcome = "sent" | "skipped" | "failed";

const ROUTE = "lib/gift-voucher-mail";

/**
 * Tries with a failed PDF render before the mail goes out without the
 * attachment — the code in the mail and the download link are the delivery;
 * a paid voucher must not wait for the renderer forever.
 */
const RENDER_TRIES_BEFORE_PLAIN_MAIL = 2;

/**
 * Send (or resend) the mail of a voucher. `downloadToken` is the plain token
 * of the download link when the caller just created it (only its hash is
 * stored); without it a new link is created and the old one stops working.
 * Only an issued voucher is mailed. Never throws.
 */
export async function sendGiftVoucherMail(id: number, opts: { downloadToken?: string | null } = {}): Promise<GiftVoucherMailOutcome> {
  try {
    return await send(id, opts.downloadToken ?? null);
  } catch (err) {
    reportError(err, { route: ROUTE, phase: "send" });
    return "failed";
  }
}

async function send(id: number, issuedToken: string | null): Promise<GiftVoucherMailOutcome> {
  const v = await getGiftVoucher(id);
  if (!v || v.status !== "issued") return "skipped";

  const target = giftVoucherMailTarget(v);
  if (!target.ok) {
    // Nothing to mail (admin PDF / card, or no usable address): settle the state.
    if (v.mailStatus === "pending") await setGiftVoucherMailState(id, { status: target.mailStatus, countAttempt: false });
    return "skipped";
  }

  // A voucher being revoked (order cancelled / refunded) or waiting for a
  // deactivation never gets its code mailed.
  if (revokeReasonOf(v.attention) || v.attention === "deactivate_failed") {
    await setGiftVoucherMailState(id, {
      status: "skipped",
      error: "Nicht gesendet: Die Bestellung wurde storniert oder erstattet, der Gutschein wird gesperrt.",
      countAttempt: false,
    });
    return "skipped";
  }

  if (!isEmailConfigured()) return applyFailure(v, planGiftVoucherMailFailure({ skipped: true, attempts: v.mailAttempts }));

  const code = await getGiftVoucherCode(id);
  if (!code) return retryLater(v, "Der Gutscheincode ist nicht lesbar (TOKEN_ENC_KEY prüfen) — E-Mail nicht gesendet.");

  // The PDF. A failed render is retried a couple of times; then the mail
  // goes without it (code + download link).
  const pdf = await renderPdf(v, code);
  if (!pdf && v.mailAttempts < RENDER_TRIES_BEFORE_PLAIN_MAIL) {
    return retryLater(v, "Das PDF ließ sich nicht erzeugen — Mo versucht es gleich noch einmal.");
  }

  // The download link: the issuer's fresh token, else a new one (rotation).
  let token = issuedToken;
  if (!token) {
    const fresh = newOpaqueToken(24);
    token = (await setGiftVoucherDownloadTokenHash(id, hashOpaqueToken(fresh))) ? fresh : null;
  }

  // The Premium-Karte note (the card is on its way unless its job was given up).
  let print: GiftVoucherMailParams["print"] = null;
  if (v.delivery === "print") {
    const job = await getGiftVoucherPrintJobForVoucher(id);
    if (!job || (job.status !== "cancelled" && job.status !== "failed")) {
      print = { name: job?.address?.name ?? null, postalCode: job?.address?.postalCode ?? null, city: job?.address?.city ?? null };
    }
  }

  const params: GiftVoucherMailParams = {
    audience: target.audience,
    locale: v.locale,
    amountCents: v.amountCents,
    number: v.number,
    code,
    expiresOn: v.expiresOn,
    recipientName: v.recipientName,
    senderName: v.senderName,
    orderName: v.shopifyOrderName,
    downloadUrl: token ? giftVoucherDownloadUrl(getBaseUrl(), token) : null,
    hasAttachment: pdf !== null,
    print,
    pageUrl: giftVoucherPageUrl(),
    termsUrl: giftVoucherTermsUrl(),
  };

  // Rendered inside the design selected for this mail kind — "gift_voucher"
  // is no selectable kind, so it is the classic design (never "summary":
  // that hero says „Deine persönliche Beratung“).
  const design = await getCachedEmailDesignForKind(GIFT_VOUCHER_MAIL_KIND);
  const { mail, logged } = withEmailDesign(design, () => {
    const styles = { text: emailTextStyle(), muted: emailMutedTextStyle(), link: emailLinkStyle() };
    const real = buildGiftVoucherMail(params, styles);
    const redacted = buildGiftVoucherMail(redactGiftVoucherMailParams(params), styles);
    return { mail: { ...real, html: shell(real, v.locale) }, logged: { ...redacted, html: shell(redacted, v.locale) } };
  });

  const threading = outboundThreading();
  const result = await sendEmail({
    to: target.to,
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
    kind: GIFT_VOUCHER_MAIL_KIND,
    messageId: threading.messageId,
    replyTo: threading.replyTo,
    tags: [{ name: "kind", value: GIFT_VOUCHER_MAIL_KIND }],
    attachments: pdf ? [{ filename: giftVoucherPdfFilename(v.number), content: pdf, contentType: "application/pdf" }] : undefined,
    idempotencyKey: giftVoucherMailIdempotencyKey(v.id, v.mailAttempts),
  });

  if (result.ok) {
    await setGiftVoucherMailState(id, { status: "sent", error: pdf ? undefined : "E-Mail ohne PDF-Anhang gesendet (Rendering fehlgeschlagen)." });
    // MIRROR-WRITE (fail-soft): the redacted copy only.
    await recordSentMessage({
      toAddress: target.to,
      fromAddress: senderAddress() ?? "",
      subject: logged.subject,
      bodyText: logged.text,
      bodyHtml: logged.html,
      messageId: threading.messageId,
      customerId: target.audience === "buyer" ? v.customerId : null,
    });
    return "sent";
  }
  return applyFailure(
    v,
    planGiftVoucherMailFailure({ skipped: result.skipped, error: result.skipped ? null : result.error, attempts: v.mailAttempts })
  );
}

/** The branded shell around the mail's pieces (no promo, no unsubscribe: transactional). */
function shell(c: GiftVoucherMailContent, locale: "de" | "en"): string {
  return renderBrandedEmail({
    subject: c.subject,
    preheader: c.preheader,
    heading: c.heading,
    bodyHtml: c.bodyHtml,
    ctas: c.cta ? [c.cta] : [],
    footnoteHtml: c.footnoteHtml,
    postCtaRowsHtml: renderSectionRow(c.signOffHtml, { padding: "20px 60px 10px", align: "center" }),
    locale,
  });
}

/**
 * The PDF of a voucher, or null (render failed, or the photo of a photo
 * voucher could not be read — reported, never thrown; the caller retries,
 * then mails code and link without the attachment).
 */
async function renderPdf(v: GiftVoucher, code: string): Promise<Buffer | null> {
  try {
    const photo = v.photoPathname ? await loadGiftVoucherPhoto(v.photoPathname) : null;
    // Never the „Klassisch“ look in place of the customer's photo.
    if (v.designKey === "photo" && v.photoPathname && !photo) {
      reportError(new Error("gift voucher photo unavailable"), { route: ROUTE, phase: "photo", voucherId: v.id });
      return null;
    }
    const pdf = await renderGiftVoucherPdf(giftVoucherRenderInputFromVoucher(v, code, photo));
    return pdf && pdf.length > 0 ? pdf : null;
  } catch (err) {
    reportError(err, { route: ROUTE, phase: "render" });
    return null;
  }
}

/** A failure before the send (code unreadable, PDF failed): try again by the plan. */
async function retryLater(v: GiftVoucher, error: string): Promise<GiftVoucherMailOutcome> {
  const minutes = planGiftVoucherRetry(v.mailAttempts + 1);
  await setGiftVoucherMailState(
    v.id,
    minutes == null
      ? { status: "failed", error }
      : { status: "pending", error, nextAttemptAt: new Date(Date.now() + minutes * 60_000) }
  );
  return "failed";
}

async function applyFailure(v: GiftVoucher, plan: ReturnType<typeof planGiftVoucherMailFailure>): Promise<GiftVoucherMailOutcome> {
  await setGiftVoucherMailState(v.id, {
    status: plan.status,
    error: plan.error,
    nextAttemptAt: plan.nextAttemptAt,
    countAttempt: plan.countAttempt,
  });
  return plan.outcome;
}
