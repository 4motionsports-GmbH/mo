// Signed-in "Zusammenfassung herunterladen" → PDF (10E-1, replacing the 10B-1
// HTML download). It renders the SAME content + structure the transactional
// summary EMAIL produces — AI prose → "Deine Auswahl" (chosen products) → "Zur
// Kasse" → divider → "Vielleicht auch interessant" (alternatives) → sign-off — so
// the email and the download stay one logical document, just two render targets.
// The structured inputs come straight from buildSummaryDocument (lib/summary-email),
// which is the single place that layout is assembled, so the two cannot drift.
//
// Dependency-free (shared lib/pdf-core, same as the physical-letter PDF): no
// headless browser / PDF dependency on Vercel. Pure + INJECTED inputs → unit-tested.

import {
  PAGE_W,
  PAGE_H,
  MARGIN_X,
  ACCENT_RGB,
  MUTED_RGB,
  wrapText,
  textOp,
  ruleOp,
  brandHeaderOps,
  footerOp,
  assemblePdf,
} from "./pdf-core.mjs";

const CONTENT_TOP_Y = PAGE_H - 120; // below the letterhead
const CONTENT_BOTTOM_Y = 64; // above the footer
const CONTENT_RIGHT_X = PAGE_W - MARGIN_X;
const BODY_FONT = 11;
const BODY_LEADING = 15;
// Helvetica 11pt over a ~481pt frame ⇒ ~88 chars.
const BODY_MAX_CHARS = 88;

/**
 * A tiny top-to-bottom flow layout with pagination. Caller pushes blocks; we wrap
 * text, advance `y`, and start a new page whenever the next line would cross the
 * bottom margin. Each finished page gets the brand footer; page 1 gets the
 * letterhead.
 */
function makeFlow() {
  const pages = [];
  let content = brandHeaderOps();
  let y = CONTENT_TOP_Y;

  const newPage = () => {
    pages.push(content);
    content = "";
    y = PAGE_H - 70; // continuation pages: full height, no letterhead
  };

  /** Emit one already-short line at the current y in font/size/colour. */
  const line = (text, { font = "F1", size = BODY_FONT, leading = BODY_LEADING, color } = {}) => {
    if (y < CONTENT_BOTTOM_Y) newPage();
    if (text !== "") content += textOp(font, MARGIN_X, y, size, text, color);
    y -= leading;
  };

  /** Emit wrapped paragraph text (honours explicit newlines). */
  const paragraph = (text, opts = {}) => {
    for (const l of wrapText(text, opts.maxChars ?? BODY_MAX_CHARS)) line(l, opts);
  };

  /** A blank vertical gap of `n` leadings. */
  const gap = (n = 1) => {
    y -= BODY_LEADING * n;
  };

  /** A full-width horizontal rule (the "Vielleicht auch interessant" divider).
   *  Reserves room for the divider AND the heading + first item that always
   *  follow it, so the rule never lands orphaned at the foot of a page. */
  const divider = () => {
    if (y < CONTENT_BOTTOM_Y + 50) newPage();
    y -= 6;
    content += ruleOp(MARGIN_X, CONTENT_RIGHT_X, y, 1, "0.8 0.8 0.8");
    y -= 12;
  };

  const finish = () => {
    pages.push(content);
    return assemblePdf(pages.map((p) => p + footerOp()));
  };

  return { line, paragraph, gap, divider, finish };
}

// Locale-switched PDF body labels. German is byte-identical to before; English
// mirrors the summary email's wording. (The shared pdf-core brand footer is
// locale-agnostic chrome.)
const PDF_COPY = {
  de: {
    heading: "Deine Zusammenfassung",
    intro: "Hallo, vielen Dank für deine Beratung bei motion sports. Hier ist deine Zusammenfassung:",
    emptySummary: "In diesem Gespräch wurde noch kein Beratungsverlauf festgehalten.",
    chosen: "Deine Auswahl:",
    checkout: "Zur Kasse:",
    alternatives: "Vielleicht auch interessant:",
    signOffQuestion: "Bei Fragen kannst du jederzeit auf diese E-Mail antworten.",
    signOff1: "Viele Grüße",
    signOff2: "Dein motion sports Team",
  },
  en: {
    heading: "Your summary",
    intro: "Hello, thank you for your consultation at motion sports. Here is your summary:",
    emptySummary: "No consultation history has been recorded in this conversation yet.",
    chosen: "Your selection:",
    checkout: "To checkout:",
    alternatives: "You might also like:",
    signOffQuestion: "If you have any questions, you can reply to this email at any time.",
    signOff1: "Best regards",
    signOff2: "Your motion sports team",
  },
};

/**
 * Render the summary PDF.
 * @param {{
 *   locale?: "de" | "en",
 *   heading?: string,
 *   intro?: string,
 *   summary: string,
 *   chosen?: Array<{ name: string, priceLabel: string }>,
 *   cartUrl?: string|null,
 *   alternatives?: Array<{ name: string, priceLabel: string, url?: string|null }>,
 * }} input
 * @returns {Buffer}
 */
export function buildSummaryPdf(input) {
  const t = input.locale === "en" ? PDF_COPY.en : PDF_COPY.de;
  const {
    heading = t.heading,
    intro = t.intro,
    summary,
    chosen = [],
    cartUrl = null,
    alternatives = [],
  } = input;

  const flow = makeFlow();

  // Heading + intro.
  flow.line(heading, { font: "F2", size: 18, leading: 24, color: ACCENT_RGB });
  flow.paragraph(intro, { color: MUTED_RGB });
  flow.gap();

  // AI summary prose (the same text the email puts in the grey panel).
  flow.paragraph(summary || t.emptySummary);

  // Chosen products.
  if (chosen.length) {
    flow.gap();
    flow.line(t.chosen, { font: "F2", size: 12, leading: 18 });
    for (const p of chosen) flow.line(`•  ${p.name} – ${p.priceLabel}`);
  }

  // Checkout permalink.
  if (cartUrl) {
    flow.gap();
    flow.line(t.checkout, { font: "F2", size: 12, leading: 18 });
    flow.paragraph(cartUrl, { color: ACCENT_RGB, maxChars: BODY_MAX_CHARS });
  }

  // Alternatives, below a divider.
  if (alternatives.length) {
    flow.gap();
    flow.divider();
    flow.line(t.alternatives, { font: "F2", size: 12, leading: 18 });
    for (const p of alternatives) {
      flow.line(`•  ${p.name} – ${p.priceLabel}`);
      if (p.url) flow.line(p.url, { size: 9, leading: 13, color: ACCENT_RGB });
    }
  }

  // Sign-off (matches the email).
  flow.gap();
  flow.paragraph(t.signOffQuestion);
  flow.gap();
  flow.line(t.signOff1, { color: MUTED_RGB });
  flow.line(t.signOff2, { color: MUTED_RGB });

  return flow.finish();
}
