// Compose a §7 Abs. 3 UWG "Bestandskunden" (existing-customer) email — the
// shared branded HTML shell + the MANDATORY objection notice and opt-out link.
// Used by the admin §7(3) test-send route.
//
// The "objection notice is always present" invariant + the plain-text assembly
// are unit-tested in bestandskunde-email-core.mjs; the German notice copy is the
// lawyer-review-pending placeholder in consent-copy.ts (bestandskundenOptOutNotice).

import { EMAIL_TEXT_STYLE, renderBrandedEmail } from "./email-template";
import { bestandskundenOptOutNotice } from "./consent-copy";
import {
  bestandskundeEmailSubject,
  bestandskundeEmailText,
} from "./bestandskunde-email-core.mjs";

export interface BuiltBestandskundeEmail {
  subject: string;
  html: string;
  text: string;
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
