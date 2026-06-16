// POST /api/admin/bestandskunden/send  { customerId, includeChatbotIntro? }
//
// The PRODUCTION §7 Abs. 3 UWG existing-customer send path. Sends ONE
// existing-customer email advertising the customer's OWN SIMILAR products to
// what they purchased — the lawyer-approved (green/amber) boundary, ENFORCED:
//
//   GATE 1  BESTANDSKUNDE_SENDS_APPROVED on (the master switch — still default
//           OFF until the at-collection objection notice is live store-side, so
//           this route is inert until then).
//   GATE 2  canSendBestandskundenMail: §7(3)-eligible (a completed purchase) AND
//           not objected (separate Bestandskunden opt-out). Never reads/implies
//           DOI marketing consent — a DIFFERENT lawful basis.
//   GATE 3  "OWN SIMILAR PRODUCTS" (condition 2): the email may advertise ONLY
//           in-stock products in a category the customer has purchased, never
//           what they already own (lib/bestandskunden-similarity). If nothing
//           similar matches, we REFUSE to send (422) — no generic blast.
//
// DETERMINISTIC + PURCHASE-HISTORY-ONLY: the content is the matched products +
// the mandatory objection notice. NO AI prose, NO consent-derived profile, NO
// transcripts — the §7(3) (legitimate-interest) basis never borrows the consent
// basis. The amber "new chatbot" line is only a hook on top of real products.
//
// Auth + CSRF: guardAdminPost (the proxy already gates /api/admin/*).
// See docs/CONSENT_FLOW.md and docs/LEGAL_READINESS_REPORT.md §8 (OQ-06).

import { guardAdminPost, adminJson, adminJsonError } from "@/lib/admin-api";
import { getCustomerById } from "@/lib/customer-store";
import {
  buildBestandskundeOptOutToken,
  canSendBestandskundenMail,
} from "@/lib/bestandskunden-store";
import { isBestandskundenSendsApproved } from "@/lib/bestandskunden.mjs";
import {
  deriveOwnedHandles,
  deriveOwnedCategories,
  selectSimilarProducts,
} from "@/lib/bestandskunden-similarity.mjs";
import { buildBestandskundeEmail } from "@/lib/bestandskunde-email";
import { loadProductCatalog } from "@/lib/catalog-store";
import { getBaseUrl } from "@/lib/base-url";
import { sendEmail, senderAddress } from "@/lib/email";
import { outboundThreading } from "@/lib/email-inbound";
import { recordSentMessage } from "@/lib/email-messages-store";
import { recordAdminAccess } from "@/lib/admin-access-log";
import { reportError } from "@/lib/observability";
import type { Product } from "@/lib/types";

export const maxDuration = 30;

const MAX_SIMILAR_PRODUCTS = 3;

export async function POST(req: Request) {
  const blocked = await guardAdminPost(req);
  if (blocked) return blocked;

  let customerId: number;
  let includeChatbotIntro: boolean;
  try {
    const body = (await req.json()) as { customerId?: unknown; includeChatbotIntro?: unknown };
    customerId = Number(body.customerId);
    includeChatbotIntro = body.includeChatbotIntro === true;
    if (!Number.isInteger(customerId) || customerId <= 0) {
      return adminJsonError("bad_request", "customerId required", 400);
    }
  } catch {
    return adminJsonError("bad_request", "Invalid JSON body", 400);
  }

  try {
    // GATE 1 — master switch (still OFF by default; the at-collection notice must
    // be live store-side before this is flipped — see the route header).
    if (!isBestandskundenSendsApproved()) {
      return adminJsonError(
        "forbidden",
        "BESTANDSKUNDE_SENDS_APPROVED is off — §7(3) sends are disabled.",
        403
      );
    }

    const customer = await getCustomerById(customerId);
    if (!customer?.email) {
      return adminJsonError("not_found", "Customer not found", 404);
    }

    // GATE 2 — the §7(3) chokepoint (eligibility + not-objected; basis-separate).
    if (!(await canSendBestandskundenMail(customer.email))) {
      return adminJsonError(
        "forbidden",
        "Customer is not §7(3)-eligible (no completed purchase cached) or has objected.",
        403
      );
    }

    // GATE 3 — the "own similar products" boundary, enforced from PURCHASE history.
    const catalog = await loadProductCatalog();
    const ownedHandles = deriveOwnedHandles(customer.purchaseSummary);
    const ownedCategories = deriveOwnedCategories(customer.purchaseSummary, catalog);
    const products = selectSimilarProducts(catalog, {
      ownedCategories,
      ownedHandles,
      limit: MAX_SIMILAR_PRODUCTS,
    }) as Product[];
    if (products.length === 0) {
      return adminJsonError(
        "unprocessable_entity",
        "Keine eigenen ähnlichen Produkte zu den Käufen dieser Kund:in — §7(3)-Versand wird nicht durchgeführt.",
        422
      );
    }

    const token = buildBestandskundeOptOutToken(customer.email);
    if (!token) {
      return adminJsonError(
        "internal_error",
        "Opt-out signing not configured (UNSUBSCRIBE_SECRET / CHAT_SHARED_SECRET).",
        500
      );
    }
    const optOutUrl = `${getBaseUrl(req)}/api/unsubscribe/bestandskunde?token=${encodeURIComponent(token)}`;

    const email = buildBestandskundeEmail({ products, optOutUrl, includeChatbotIntro });
    const threading = outboundThreading();
    const result = await sendEmail({
      kind: "bestandskunde",
      to: customer.email,
      subject: email.subject,
      html: email.html,
      text: email.text,
      messageId: threading.messageId,
      replyTo: threading.replyTo,
    });

    if (result.ok) {
      // Mirror-write to the unified mail log (correspondence-grade record of what
      // we sent), and audit the admin action.
      await recordSentMessage({
        toAddress: customer.email,
        fromAddress: senderAddress() ?? "",
        subject: email.subject,
        bodyText: email.text,
        bodyHtml: email.html,
        messageId: threading.messageId,
        customerId,
      });
      await recordAdminAccess(
        {
          action: "bestandskunde.send",
          targetCustomerId: customerId,
          detail: { productCount: products.length, includeChatbotIntro },
        },
        req
      );
      return adminJson({ ok: true, sentTo: customer.email, productCount: products.length });
    }
    if (result.skipped) {
      return adminJson({ ok: false, skipped: true, reason: "email_not_configured" });
    }
    return adminJsonError("upstream_unavailable", "Send failed", 502);
  } catch (err) {
    reportError(err, { route: "api/admin/bestandskunden/send" });
    return adminJsonError("internal_error", "Unexpected server error", 500);
  }
}
