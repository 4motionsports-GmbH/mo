// Transactional summary email — the service the user requests when they tick
// the transactional consent box. Renders a readable German summary of the
// conversation plus a prefilled-cart permalink for the products the user
// CHOSE (falling back to all discussed products when no choice was made —
// see chooseCartProductIds in lib/cart).
//
// IMPORTANT: NO discount code here. A discount is marketing-only; this is a
// transactional service email under Art. 6(1)(b), sent immediately on request.
//
// Defensive: a missing conversation, an AI-summary failure, or an empty cart
// all degrade gracefully — we still send the best email we can, and any send
// failure is logged + surfaced by sendEmail().

import { generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import {
  loadConversationForSummary,
  type TranscriptMessage,
  type ConversationSummaryData,
} from "./conversation-store";
import { getProductsByIds } from "./product-catalog";
import { buildPrefilledCartUrlForIds, chooseCartProductIds } from "./cart";
import { mintAttributionToken } from "./mo-orders-store";
import { withCartAttribution } from "./order-attribution.mjs";
import { sendEmail, senderAddress, type SendEmailResult } from "./email";
import { outboundThreading } from "./email-inbound";
import { recordSentMessage } from "./email-messages-store";
import { summaryEmailSubject } from "./consent-copy";
import type { Locale } from "./locale";
import {
  renderBrandedEmail,
  renderSectionBand,
  renderSectionRow,
  emailTextStyle,
  emailLinkStyle,
} from "./email-template";
import { withEmailTheme } from "./email-theme-context";
import { getCachedThemeForKind } from "./email-theme-store";
import { partitionSummaryProducts } from "./summary-products.mjs";
import { renderEmailProseHtml, productNameLookup } from "./email-prose.mjs";
import { renderEmailProductGrid, productGridItem } from "./email-products";
import { reportError } from "./observability";
import { recordAiUsage, type AiCallSite } from "./ai-usage-store";
import type { Product } from "./types";

const SUMMARY_MODEL = "claude-sonnet-4-6";

/** Keep only the human-readable turns (drop tool-call bookkeeping rows). */
function readableTurns(messages: TranscriptMessage[]): TranscriptMessage[] {
  return messages.filter(
    (m) => m.toolName === null && (m.role === "user" || m.role === "assistant") && m.content.trim()
  );
}

function formatTranscript(turns: TranscriptMessage[], locale: Locale): string {
  const you = locale === "en" ? "You" : "Du";
  const advisor = locale === "en" ? "Advisor" : "Berater";
  return turns
    .map((m) => `${m.role === "user" ? you : advisor}: ${m.content.trim()}`)
    .join("\n\n");
}

/**
 * Produce a tidy German summary. Tries the Anthropic API for a polished prose
 * summary; on any error (or no API key) falls back to the plain transcript so
 * the summary is never blocked on the model.
 *
 * `usage` attributes the model call's token usage to the right S6 cost metric:
 * the mailed summary (`summary_email`, no conversation link — transactional) or
 * the on-demand signed-in download (`summary_download`, linked to its
 * conversation so it cascade-deletes). The model call only happens when a real
 * transcript and an API key are present; otherwise nothing is recorded.
 */
async function buildSummaryText(
  turns: TranscriptMessage[],
  usage: { callSite: AiCallSite; conversationId?: number | null },
  locale: Locale
): Promise<string> {
  const transcript = formatTranscript(turns, locale);
  if (!transcript) {
    return locale === "en"
      ? "No consultation history has been recorded in this conversation yet."
      : "In diesem Gespräch wurde noch kein Beratungsverlauf festgehalten.";
  }
  if (!process.env.ANTHROPIC_API_KEY) return transcript;

  const system =
    locale === "en"
      ? "You summarise a fitness consultation for an email to the customer in a " +
        "friendly, clear way and in English. Write in a direct, personal tone, 3–6 " +
        "short sentences. Name the identified need and the most important recommendations. " +
        "No invented products, no invented prices, no marketing, no discounts."
      : "Du fasst ein Fitness-Beratungsgespräch für eine E-Mail an den Kunden " +
        "freundlich, klar und auf Deutsch zusammen. Schreibe in der Du-Form, 3–6 " +
        "kurze Sätze. Nenne den ermittelten Bedarf und die wichtigsten Empfehlungen. " +
        "Keine erfundenen Produkte, keine Preise erfinden, kein Marketing, keine Rabatte.";
  const prompt =
    locale === "en"
      ? `Here is the conversation transcript:\n\n${transcript}\n\nWrite the summary.`
      : `Hier ist das Gesprächsprotokoll:\n\n${transcript}\n\nSchreibe die Zusammenfassung.`;

  try {
    const { text, usage: modelUsage } = await generateText({
      model: anthropic(SUMMARY_MODEL),
      system,
      prompt,
    });
    // Cost KPI (S6): same generator, attributed to the requesting surface.
    await recordAiUsage({
      callSite: usage.callSite,
      model: SUMMARY_MODEL,
      inputTokens: modelUsage?.inputTokens ?? 0,
      outputTokens: modelUsage?.outputTokens ?? 0,
      conversationId: usage.conversationId ?? null,
    });
    const trimmed = text?.trim();
    return trimmed || transcript;
  } catch (err) {
    reportError(err, { route: "lib/summary-email", phase: "ai_summary" });
    return transcript;
  }
}

// EUR formatting per locale: German "1.234,00 €" vs English (en-GB) "€1,234.00".
const PRICE_FORMAT: Record<Locale, Intl.NumberFormat> = {
  de: new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }),
  en: new Intl.NumberFormat("en-GB", { style: "currency", currency: "EUR" }),
};

/** Effective price: the sale price when one is set, otherwise the list price. */
function formatPrice(p: Product, locale: Locale): string {
  const value =
    typeof p.salePrice === "number" && p.salePrice > 0 ? p.salePrice : p.price;
  return PRICE_FORMAT[locale].format(value);
}


/**
 * First usable catalog image (absolute https only — mail clients won't load a
 * relative or http image). Returns null so the row can render without an image
 * cell rather than emit a broken <img>.
 */
function firstImageUrl(p: Product): string | null {
  const img = p.images?.find(
    (u) => typeof u === "string" && u.startsWith("https://")
  );
  return img ?? null;
}

/**
 * A newsletter-style product section: the signature black separator band with
 * the section title, then the two-column product grid (big images, name links,
 * red strikethrough compare-at prices). Returns full-width card rows.
 */
function renderProductSection(
  title: string,
  products: Product[],
  locale: Locale
): string {
  if (products.length === 0) return "";
  return (
    renderSectionBand(title) +
    renderSectionRow(
      renderEmailProductGrid(products.map((p) => productGridItem(p, locale))),
      { padding: "30px 60px 10px", align: "center" }
    )
  );
}

/** Plain-text part of the CHOSEN products (the cart permalink's exact set). */
function chosenProductsText(products: Product[], locale: Locale): string {
  if (products.length === 0) return "";
  const heading = locale === "en" ? "Your selection:" : "Deine Auswahl:";
  return (
    `\n${heading}\n` +
    products.map((p) => `- ${p.name} – ${formatPrice(p, locale)}`).join("\n")
  );
}

/** Plain-text part of the alternatives (linking to the product pages). */
function alternativesText(products: Product[], locale: Locale): string {
  if (products.length === 0) return "";
  const heading = locale === "en" ? "You might also like:" : "Vielleicht auch interessant:";
  return (
    `\n${heading}\n` +
    products
      .map((p) => `- ${p.name} – ${formatPrice(p, locale)}: ${p.shopifyUrl}`)
      .join("\n")
  );
}

export interface SummaryEmailContentParams {
  /** AI-written (or fallback) summary prose. */
  summary: string;
  /** Exactly the products the cart permalink contains (cart order). */
  chosenProducts: Product[];
  /** Discussed products NOT in the chosen set (partitionSummaryProducts). */
  alternatives: Product[];
  /** The "Zur Kasse" permalink, or null when no cart could be built. */
  cartUrl: string | null;
  /** Email language. Default German — byte-identical to today. */
  locale?: Locale;
}

/**
 * Assemble the text + HTML parts of the summary email from already-resolved
 * inputs. Pure (no I/O) so it can be unit-tested and previewed without a
 * conversation, the catalog, or the AI summarizer.
 *
 * Layout, top to bottom: summary text → chosen products → "Zur Kasse" button →
 * horizontal divider → "Vielleicht auch interessant:" alternatives → sign-off.
 * The button is the shared template's CTA; everything below it rides the
 * template's footnote slot (its only below-CTA hook), divider-first so it
 * precedes the alternatives — and the divider is omitted together with them.
 */
export function buildSummaryEmailContent(params: SummaryEmailContentParams): {
  text: string;
  html: string;
} {
  const { summary, chosenProducts, alternatives, cartUrl, locale = "de" } = params;
  const en = locale === "en";
  const chosenText = chosenProductsText(chosenProducts, locale);
  const alternativesTextPart = alternativesText(alternatives, locale);
  // Any URL the summary prose mentions renders as clickable text (product
  // name when it's a known product URL) — never a raw pasted URL.
  const summaryHtml = renderEmailProseHtml(summary, {
    labelForUrl: productNameLookup([...chosenProducts, ...alternatives]),
    linkStyle: emailLinkStyle(),
  });

  // --- text part — same top-to-bottom order as the HTML ---
  const textLines = en
    ? [
        "Hello,",
        "",
        "thank you for your consultation at motion sports. Here is your summary:",
        "",
        summary,
      ]
    : [
        "Hallo,",
        "",
        "vielen Dank für deine Beratung bei motion sports. Hier ist deine Zusammenfassung:",
        "",
        summary,
      ];
  if (chosenText) textLines.push(chosenText);
  if (cartUrl) {
    textLines.push("", `${en ? "To checkout" : "Zur Kasse"}:\n${cartUrl}`);
  }
  if (alternativesTextPart) textLines.push(alternativesTextPart);
  textLines.push(
    "",
    en
      ? "If you have any questions, you can reply to this email at any time."
      : "Bei Fragen kannst du jederzeit auf diese E-Mail antworten.",
    "",
    en ? "Best regards" : "Viele Grüße",
    en ? "Your motion sports team" : "Dein motion sports Team"
  );
  const text = textLines.join("\n");

  // Intro + AI summary in the padded body; the product sections render as
  // full-width newsletter sections (black band + two-column grid) around the
  // "Zur Kasse" pill; the sign-off closes the card before the footer.
  const bodyHtml = en
    ? `
                    <p style="${emailTextStyle()}" align="left">Hello,</p>
                    <p style="${emailTextStyle()} padding-top: 10px; padding-bottom: 10px;" align="left">thank you for your consultation at <strong>motion sports</strong>. Here is your summary:</p>
                    <table cellspacing="0" cellpadding="0" border="0" width="100%" style="min-width: 100%; direction: ltr;" role="presentation">
                      <tr>
                        <th style="mso-line-height-rule: exactly; padding: 16px 20px;" align="left" bgcolor="#eeeeee" valign="top">
                          <p style="${emailTextStyle()} white-space: pre-wrap;" align="left">${summaryHtml}</p>
                        </th>
                      </tr>
                    </table>`
    : `
                    <p style="${emailTextStyle()}" align="left">Hallo,</p>
                    <p style="${emailTextStyle()} padding-top: 10px; padding-bottom: 10px;" align="left">vielen Dank f&#252;r deine Beratung bei <strong>motion sports</strong>. Hier ist deine Zusammenfassung:</p>
                    <table cellspacing="0" cellpadding="0" border="0" width="100%" style="min-width: 100%; direction: ltr;" role="presentation">
                      <tr>
                        <th style="mso-line-height-rule: exactly; padding: 16px 20px;" align="left" bgcolor="#eeeeee" valign="top">
                          <p style="${emailTextStyle()} white-space: pre-wrap;" align="left">${summaryHtml}</p>
                        </th>
                      </tr>
                    </table>`;

  const signOffRow = renderSectionRow(
    en
      ? `
                    <p style="${emailTextStyle()}" align="center">If you have any questions, you can reply to this email at any time.</p>
                    <p style="${emailTextStyle()} padding-top: 10px;" align="center">Best regards<br>Your motion sports team</p>`
      : `
                    <p style="${emailTextStyle()}" align="center">Bei Fragen kannst du jederzeit auf diese E-Mail antworten.</p>
                    <p style="${emailTextStyle()} padding-top: 10px;" align="center">Viele Gr&#252;&#223;e<br>Dein motion sports Team</p>`,
    { padding: "20px 60px 10px", align: "center" }
  );

  const html = renderBrandedEmail({
    subject: summaryEmailSubject(locale),
    preheader: en
      ? "Thank you for your consultation at motion sports — here are your summary and your cart."
      : "Vielen Dank für deine Beratung bei motion sports — hier sind deine Zusammenfassung und dein Warenkorb.",
    heading: en ? "Your summary" : "Deine Zusammenfassung",
    // The consultation was with Mo — the brand orb makes that recognizable.
    moAvatar: true,
    bodyHtml,
    preCtaRowsHtml: renderProductSection(
      en ? "Your selection" : "Deine Auswahl",
      chosenProducts,
      locale
    ),
    ctas: cartUrl ? [{ label: en ? "To checkout" : "Zur Kasse", url: cartUrl }] : [],
    postCtaRowsHtml:
      renderProductSection(
        en ? "You might also like" : "Vielleicht auch interessant",
        alternatives,
        locale
      ) + signOffRow,
    locale,
  });

  return { text, html };
}

/** One product line for the PDF download (same content as the email rows). */
export interface SummaryProductLine {
  name: string;
  priceLabel: string;
  /** Product page link — set for alternatives, null for the chosen (cart) set. */
  url: string | null;
}

export interface SummaryDocument {
  /** Plain-text part (same top-to-bottom order as the HTML). */
  text: string;
  /** The full branded HTML document (renderBrandedEmail shell). */
  html: string;
  /** The "Zur Kasse" permalink, or null when no cart could be built. */
  cartUrl: string | null;
  /** AI-written (or fallback) summary prose — the grey-panel text. */
  summary: string;
  /** The CHOSEN products (cart order) — for the PDF "Deine Auswahl" section. */
  chosen: SummaryProductLine[];
  /** The alternatives — for the PDF "Vielleicht auch interessant" section. */
  alternatives: SummaryProductLine[];
}

/**
 * Build the summary document (text + branded HTML + cart link) from an
 * already-loaded conversation — the SINGLE place the S5 structure (AI text →
 * chosen products → "Zur Kasse" → divider → "Vielleicht auch interessant:") is
 * assembled. The mailed summary and the signed-in "Zusammenfassung
 * herunterladen" download both go through here, so the email and the download
 * can never drift apart — they ARE the same renderer.
 *
 * `usage` attributes any model call (S6 cost metric) to the requesting surface.
 * Pass `null` for a missing/empty conversation to still get a graceful document.
 */
export async function buildSummaryDocument(params: {
  conversation: ConversationSummaryData | null;
  usage: { callSite: AiCallSite; conversationId?: number | null };
  /** Output language. Default German — byte-identical to today. */
  locale?: Locale;
  /** Optional order-attribution token stamped onto the cart link as
   * `attributes[_mo]` (docs/ORDER_ATTRIBUTION.md). The mailed summary passes
   * one; the signed-in PDF/download path passes none (unstamped link). */
  attributionToken?: string | null;
}): Promise<SummaryDocument> {
  const { conversation, usage, locale = "de", attributionToken = null } = params;
  const turns = conversation ? readableTurns(conversation.messages) : [];

  // Prefilled cart for the CHOSEN products — NO discount (transactional).
  // excludeSoldOut: the sold-out rule takes precedence over selection — a
  // sold-out product never enters a checkout link, same as the in-chat button.
  const cartProductIds = chooseCartProductIds(conversation);
  const cart = cartProductIds.length
    ? await buildPrefilledCartUrlForIds(cartProductIds, { excludeSoldOut: true })
    : {
        url: null,
        lines: [],
        resolvedProductIds: [],
        unresolvedProductIds: [],
        soldOutProductIds: [],
      };
  // Stamp AFTER building: the marker is a query param, the cart lines are not
  // affected. A null token leaves the URL untouched.
  const cartUrl = withCartAttribution(cart.url, attributionToken);

  // The CHOSEN section renders exactly what the cart permalink contains
  // (cart.resolvedProductIds, in URL order) — the cart builder already dropped
  // sold-out/unresolvable items, so we just look their products back up.
  const cartProductById = new Map<string, Product>();
  for (const line of cart.lines) {
    if (line.product) cartProductById.set(line.productId, line.product);
  }
  const chosenProducts = cart.resolvedProductIds
    .map((id) => cartProductById.get(id))
    .filter((p): p is Product => p !== undefined);

  // The ALTERNATIVES are everything DISCUSSED minus that chosen set — the
  // partition guarantees chosen ∩ alternatives = ∅ and omits itself when empty
  // (which is the case whenever the cart fell back to all discussed products).
  const discussedIds = conversation?.recommendedProductIds ?? [];
  const discussedProducts = discussedIds.length
    ? await getProductsByIds(discussedIds)
    : [];
  const { alternatives } = partitionSummaryProducts(
    cart.resolvedProductIds,
    discussedProducts
  );

  const summary = await buildSummaryText(turns, usage, locale);

  // Render inside the operator-assigned design template (admin Einstellungen);
  // null → the built-in default design. Fail-soft: never blocks the summary.
  const theme = await getCachedThemeForKind("summary");
  const { text, html } = withEmailTheme(theme, () =>
    buildSummaryEmailContent({
      summary,
      chosenProducts,
      alternatives,
      cartUrl,
      locale,
    })
  );

  // Structured pieces for the PDF download — derived from the SAME chosen /
  // alternatives / summary the email rendered, so the two render targets can't
  // drift. The chosen set links to the cart (no per-row url); alternatives link
  // to their product page (same as the email's "Vielleicht auch interessant").
  const toLine = (p: Product, withUrl: boolean): SummaryProductLine => ({
    name: p.name,
    priceLabel: formatPrice(p, locale),
    url: withUrl ? p.shopifyUrl : null,
  });

  return {
    text,
    html,
    cartUrl,
    summary,
    chosen: chosenProducts.map((p) => toLine(p, false)),
    alternatives: alternatives.map((p) => toLine(p, true)),
  };
}

export interface SummaryEmailResult {
  sent: boolean;
  result: SendEmailResult;
  hadConversation: boolean;
  cartUrl: string | null;
}

/**
 * Build and send the transactional summary email to `email` for the given
 * session. Never throws; returns a result the route can surface.
 */
export async function sendSummaryEmail(params: {
  sessionId: string | null;
  email: string;
  /** Output language. Default German — byte-identical to today. */
  locale?: Locale;
}): Promise<SummaryEmailResult> {
  const { sessionId, email, locale = "de" } = params;

  const conversation = sessionId ? await loadConversationForSummary(sessionId) : null;

  // ORDER ATTRIBUTION: stamp the mailed "Zur Kasse" link with the session's
  // opaque token so a later checkout through it is attributable even without a
  // discount code (docs/ORDER_ATTRIBUTION.md). Minting failure → unstamped
  // link; the summary must never block on attribution.
  const attributionToken = await mintAttributionToken(sessionId, "summary_email");

  // The transactional email is fire-on-request — no conversation link on the
  // usage row (cost stays on the dashboard/admin side, like before).
  const { text, html, cartUrl } = await buildSummaryDocument({
    conversation,
    usage: { callSite: "summary_email" },
    locale,
    attributionToken,
  });

  const subject = summaryEmailSubject(locale);
  // Our own Message-ID + an inbound Reply-To so a "just reply to this email"
  // answer threads back into the unified mail log (mirror-write below).
  const threading = outboundThreading();
  const result = await sendEmail({
    to: email,
    subject,
    text,
    html,
    kind: "summary",
    messageId: threading.messageId,
    replyTo: threading.replyTo,
  });

  // MIRROR-WRITE (additive, fail-soft): log the transactional summary in the
  // unified mail log. No marketing_send_id (this isn't a campaign); the customer
  // is resolved from the recipient address when one exists.
  if (result.ok) {
    await recordSentMessage({
      toAddress: email,
      fromAddress: senderAddress() ?? "",
      subject,
      bodyText: text,
      bodyHtml: html,
      messageId: threading.messageId,
    });
  }

  return {
    sent: result.ok,
    result,
    hadConversation: Boolean(conversation),
    cartUrl,
  };
}
