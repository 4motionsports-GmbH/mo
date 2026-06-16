// Compose a §7 Abs. 3 UWG "Bestandskunden" (existing-customer) email — the
// shared branded HTML shell + the MANDATORY objection notice and opt-out link.
// Used by the admin §7(3) test-send route.
//
// The "objection notice is always present" invariant + the plain-text assembly
// are unit-tested in bestandskunde-email-core.mjs; the German notice copy is the
// lawyer-review-pending placeholder in consent-copy.ts (bestandskundenOptOutNotice).

import { EMAIL_TEXT_STYLE, EMAIL_MUTED_TEXT_STYLE, renderBrandedEmail, escapeHtml, escapeAttr } from "./email-template";
import { bestandskundenOptOutNotice } from "./consent-copy";
import {
  bestandskundeEmailSubject,
  bestandskundeEmailText,
} from "./bestandskunde-email-core.mjs";
import type { Product } from "./types";

export interface BuiltBestandskundeEmail {
  subject: string;
  html: string;
  text: string;
}

// Amber framing (lawyer-approved): the new AI advisor may be mentioned as the
// HOOK, but the email's substance stays the similar products below — the send
// route refuses to send without at least one matched similar product.
const CHATBOT_INTRO_LINE =
  "Übrigens: Unser neuer KI-Berater Mo hilft dir jederzeit dabei, das passende Gerät zu finden — schau gern wieder vorbei.";

function formatPrice(n: number): string {
  return `${n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}

function productLink(p: Product): string {
  return p.shopifyCartUrl || p.shopifyUrl || "";
}

// Static, non-user-derived copy — safe to inline without escaping. The real
// marketing body ("own similar products") is reviewed by the lawyer before
// BESTANDSKUNDE_SENDS_APPROVED is flipped; this is a structurally-correct stand-in
// so the pipeline (notice + opt-out link + branding) can be tested end to end.
const INTRO = "Hallo,";
const MARKETING_LINE =
  "als bestehende:r Kund:in zeigen wir dir gelegentlich ausgewählte, ähnliche Produkte aus unserem Sortiment.";

/**
 * Build the §7(3) email. `optOutUrl` MUST be the GET
 * /api/unsubscribe/bestandskunde link for the recipient's address. `isTest`
 * marks the subject + body so an internal test send is unmistakable.
 */
export function buildBestandskundeTestEmail(opts: {
  optOutUrl: string;
  isTest?: boolean;
}): BuiltBestandskundeEmail {
  const notice = bestandskundenOptOutNotice(opts.optOutUrl);
  const testBanner = opts.isTest
    ? "Dies ist eine TESTNACHRICHT (interner Versand) — sie ging nicht an eine:n echte:n Kund:in."
    : null;

  const subject = bestandskundeEmailSubject({ isTest: opts.isTest });

  const text = bestandskundeEmailText({
    intro: [testBanner, INTRO].filter(Boolean).join("\n\n"),
    marketingLines: [MARKETING_LINE],
    optOutNoticeText: notice.text,
  });

  const bannerHtml = testBanner
    ? `<p style="${EMAIL_TEXT_STYLE} padding-bottom: 10px; color: #b91c1c;" align="left"><strong>${testBanner}</strong></p>`
    : "";

  const bodyHtml = `
                                  ${bannerHtml}
                                  <p style="${EMAIL_TEXT_STYLE}" align="left">${INTRO}</p>
                                  <p style="${EMAIL_TEXT_STYLE} padding-top: 10px; padding-bottom: 10px;" align="left">${MARKETING_LINE}</p>`;

  const html = renderBrandedEmail({
    subject,
    preheader: opts.isTest
      ? "Testnachricht — §7(3) Bestandskunden"
      : "Für dich als bestehende:r Kund:in",
    heading: "Für dich ausgewählt",
    bodyHtml,
    // The mandatory §7(3) objection notice + opt-out link, as small print.
    footnoteHtml: notice.html,
  });

  return { subject, html, text };
}

/**
 * Build a REAL §7(3) existing-customer email advertising the customer's OWN
 * SIMILAR products. `products` is the lawyer-bounded similar set (must be
 * non-empty — the send route refuses an empty set), `optOutUrl` the signed
 * §7(3) opt-out link, `includeChatbotIntro` the amber chatbot-launch hook.
 *
 * DETERMINISTIC by design: the content is the matched products + the mandatory
 * objection notice. NO AI prose, NO consent-derived profile, NO transcripts —
 * personalisation is purchase-history-only, so the §7(3) (LI) basis never
 * borrows the consent basis (LEGAL_READINESS_REPORT §8, F10/B4).
 */
export function buildBestandskundeEmail(opts: {
  products: Product[];
  optOutUrl: string;
  includeChatbotIntro?: boolean;
}): BuiltBestandskundeEmail {
  const notice = bestandskundenOptOutNotice(opts.optOutUrl);
  const subject = bestandskundeEmailSubject({ isTest: false });

  const marketingLines = [
    "als bestehende:r Kund:in zeigen wir dir ausgewählte, ähnliche Produkte aus unserem Sortiment:",
    ...opts.products.map((p) => {
      const link = productLink(p);
      const price = formatPrice(p.salePrice ?? p.price);
      return `• ${p.name} — ${price}${link ? `\n  ${link}` : ""}`;
    }),
  ];
  if (opts.includeChatbotIntro) marketingLines.push(CHATBOT_INTRO_LINE);

  const text = bestandskundeEmailText({
    intro: INTRO,
    marketingLines,
    optOutNoticeText: notice.text,
  });

  const cardsHtml = opts.products
    .map((p) => {
      const link = productLink(p);
      const price = formatPrice(p.salePrice ?? p.price);
      const name = link
        ? `<a href="${escapeAttr(link)}" style="color: #212121; text-decoration: underline !important;">${escapeHtml(p.name)}</a>`
        : escapeHtml(p.name);
      return `<p style="${EMAIL_TEXT_STYLE} padding-top: 8px;" align="left"><strong>${name}</strong> — ${escapeHtml(price)}<br><span style="${EMAIL_MUTED_TEXT_STYLE}">${escapeHtml(p.shortDescription ?? "")}</span></p>`;
    })
    .join("");

  const chatbotHtml = opts.includeChatbotIntro
    ? `<p style="${EMAIL_MUTED_TEXT_STYLE} padding-top: 10px;" align="left">${escapeHtml(CHATBOT_INTRO_LINE)}</p>`
    : "";

  const bodyHtml = `
                                  <p style="${EMAIL_TEXT_STYLE}" align="left">${INTRO}</p>
                                  <p style="${EMAIL_TEXT_STYLE} padding-top: 10px;" align="left">als bestehende:r Kund:in zeigen wir dir ausgew&#228;hlte, &#228;hnliche Produkte aus unserem Sortiment:</p>
                                  ${cardsHtml}
                                  ${chatbotHtml}`;

  const html = renderBrandedEmail({
    subject,
    preheader: "Für dich als bestehende:r Kund:in — ähnliche Produkte",
    heading: "Für dich ausgewählt",
    bodyHtml,
    footnoteHtml: notice.html,
  });

  return { subject, html, text };
}
