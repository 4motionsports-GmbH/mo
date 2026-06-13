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
import { loadConversationForSummary, type TranscriptMessage } from "./conversation-store";
import { getProductsByIds } from "./product-catalog";
import { buildPrefilledCartUrlForIds, chooseCartProductIds } from "./cart";
import { sendEmail, type SendEmailResult } from "./email";
import { SUMMARY_EMAIL_SUBJECT } from "./consent-copy";
import {
  renderBrandedEmail,
  escapeAttr,
  escapeHtml,
  EMAIL_TEXT_STYLE,
  EMAIL_MUTED_TEXT_STYLE,
  EMAIL_FONT_FAMILY,
} from "./email-template";
import { partitionSummaryProducts } from "./summary-products.mjs";
import { reportError } from "./observability";
import { recordAiUsage } from "./ai-usage-store";
import type { Product } from "./types";

const SUMMARY_MODEL = "claude-sonnet-4-5-20250929";

/** Keep only the human-readable turns (drop tool-call bookkeeping rows). */
function readableTurns(messages: TranscriptMessage[]): TranscriptMessage[] {
  return messages.filter(
    (m) => m.toolName === null && (m.role === "user" || m.role === "assistant") && m.content.trim()
  );
}

function formatTranscript(turns: TranscriptMessage[]): string {
  return turns
    .map((m) => `${m.role === "user" ? "Du" : "Berater"}: ${m.content.trim()}`)
    .join("\n\n");
}

/**
 * Produce a tidy German summary. Tries the Anthropic API for a polished prose
 * summary; on any error (or no API key) falls back to the plain transcript so
 * the email is never blocked on the model.
 */
async function buildSummaryText(turns: TranscriptMessage[]): Promise<string> {
  const transcript = formatTranscript(turns);
  if (!transcript) {
    return "In diesem Gespräch wurde noch kein Beratungsverlauf festgehalten.";
  }
  if (!process.env.ANTHROPIC_API_KEY) return transcript;

  try {
    const { text, usage } = await generateText({
      model: anthropic(SUMMARY_MODEL),
      system:
        "Du fasst ein Fitness-Beratungsgespräch für eine E-Mail an den Kunden " +
        "freundlich, klar und auf Deutsch zusammen. Schreibe in der Du-Form, 3–6 " +
        "kurze Sätze. Nenne den ermittelten Bedarf und die wichtigsten Empfehlungen. " +
        "Keine erfundenen Produkte, keine Preise erfinden, kein Marketing, keine Rabatte.",
      prompt: `Hier ist das Gesprächsprotokoll:\n\n${transcript}\n\nSchreibe die Zusammenfassung.`,
    });
    // Cost KPI (dashboard/admin side; transactional, no conversation link).
    await recordAiUsage({
      callSite: "summary_email",
      model: SUMMARY_MODEL,
      inputTokens: usage?.inputTokens ?? 0,
      outputTokens: usage?.outputTokens ?? 0,
    });
    const trimmed = text?.trim();
    return trimmed || transcript;
  } catch (err) {
    reportError(err, { route: "lib/summary-email", phase: "ai_summary" });
    return transcript;
  }
}

// German EUR formatting ("1.234,00 €"), shared by both product sections.
const PRICE_FORMAT = new Intl.NumberFormat("de-DE", {
  style: "currency",
  currency: "EUR",
});

/** Effective price: the sale price when one is set, otherwise the list price. */
function formatPrice(p: Product): string {
  const value =
    typeof p.salePrice === "number" && p.salePrice > 0 ? p.salePrice : p.price;
  return PRICE_FORMAT.format(value);
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

// Outlook-safe horizontal divider: a single-cell table whose top border is the
// rule (a bare <hr> renders inconsistently across clients).
const DIVIDER_HTML = `
                <table cellspacing="0" cellpadding="0" border="0" width="100%" style="min-width: 100%; direction: ltr;" role="presentation">
                  <tr>
                    <td style="mso-line-height-rule: exactly; border-top-width: 2px; border-top-color: #e5e5e5; border-top-style: solid; font-size: 0px; line-height: 0px; height: 0px;">&#160;</td>
                  </tr>
                </table>`;

/**
 * The CHOSEN products — the exact set the "Zur Kasse" cart permalink contains
 * (sold-out/unresolved items already excluded upstream). Rendered as an
 * image + name + price list, table-based for Outlook with fixed image dims.
 */
function renderChosenProducts(products: Product[]): { text: string; html: string } {
  if (products.length === 0) return { text: "", html: "" };

  const text =
    "\nDeine Auswahl:\n" +
    products.map((p) => `- ${p.name} – ${formatPrice(p)}`).join("\n");

  const rows = products
    .map((p) => {
      const img = firstImageUrl(p);
      const imageCell = img
        ? `<td width="96" valign="top" style="mso-line-height-rule: exactly; padding: 8px 12px 8px 0;"><img src="${escapeAttr(
            img
          )}" alt="${escapeAttr(
            p.name
          )}" width="80" height="80" border="0" style="width: 80px; height: 80px; display: block; border: none; outline: none; object-fit: cover;"></td>`
        : "";
      return `
                <tr>${imageCell}
                  <td valign="middle" style="mso-line-height-rule: exactly; padding: 8px 0;">
                    <p style="${EMAIL_TEXT_STYLE} text-align: left; font-weight: 700;" align="left">${escapeHtml(
                      p.name
                    )}</p>
                    <p style="${EMAIL_TEXT_STYLE} text-align: left; padding-top: 2px;" align="left">${escapeHtml(
                      formatPrice(p)
                    )}</p>
                  </td>
                </tr>`;
    })
    .join("");

  const html = `
                <table cellspacing="0" cellpadding="0" border="0" width="100%" style="min-width: 100%; direction: ltr; Margin-top: 10px;" role="presentation">${rows}
                </table>`;
  return { text, html };
}

/**
 * The OTHER discussed products ("Vielleicht auch interessant:") — everything
 * discussed minus the chosen set. Rendered smaller, each row linking to the
 * product page (NOT the cart).
 */
function renderAlternatives(products: Product[]): { text: string; html: string } {
  if (products.length === 0) return { text: "", html: "" };

  const text =
    "\nVielleicht auch interessant:\n" +
    products
      .map((p) => `- ${p.name} – ${formatPrice(p)}: ${p.shopifyUrl}`)
      .join("\n");

  const rows = products
    .map((p) => {
      const img = firstImageUrl(p);
      const imageCell = img
        ? `<td width="68" valign="top" style="mso-line-height-rule: exactly; padding: 6px 12px 6px 0;"><a href="${escapeAttr(
            p.shopifyUrl
          )}" target="_blank" style="text-decoration: none !important;"><img src="${escapeAttr(
            img
          )}" alt="${escapeAttr(
            p.name
          )}" width="56" height="56" border="0" style="width: 56px; height: 56px; display: block; border: none; outline: none; object-fit: cover;"></a></td>`
        : "";
      return `
                <tr>${imageCell}
                  <td valign="middle" style="mso-line-height-rule: exactly; padding: 6px 0;">
                    <p style="${EMAIL_MUTED_TEXT_STYLE} text-align: left;" align="left"><a href="${escapeAttr(
                      p.shopifyUrl
                    )}" target="_blank" style="color: #000000; text-decoration: underline !important; font-weight: 700; word-wrap: break-word;">${escapeHtml(
                      p.name
                    )}</a></p>
                    <p style="${EMAIL_MUTED_TEXT_STYLE} text-align: left; padding-top: 2px;" align="left">${escapeHtml(
                      formatPrice(p)
                    )}</p>
                  </td>
                </tr>`;
    })
    .join("");

  const html = `
                <h3 style="font-family: ${EMAIL_FONT_FAMILY}; color: #000000; font-size: 14px; line-height: 20px; font-weight: 700; text-transform: none; text-align: left; Margin: 0 0 6px;" align="left">Vielleicht auch interessant:</h3>
                <table cellspacing="0" cellpadding="0" border="0" width="100%" style="min-width: 100%; direction: ltr;" role="presentation">${rows}
                </table>`;
  return { text, html };
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
  const { summary, chosenProducts, alternatives, cartUrl } = params;
  const chosen = renderChosenProducts(chosenProducts);
  const alternativesPart = renderAlternatives(alternatives);

  // --- text part — same top-to-bottom order as the HTML ---
  const textLines = [
    "Hallo,",
    "",
    "vielen Dank für deine Beratung bei motion sports. Hier ist deine Zusammenfassung:",
    "",
    summary,
  ];
  if (chosen.text) textLines.push(chosen.text);
  if (cartUrl) {
    textLines.push("", `Zur Kasse:\n${cartUrl}`);
  }
  if (alternativesPart.text) textLines.push(alternativesPart.text);
  textLines.push(
    "",
    "Bei Fragen kannst du jederzeit auf diese E-Mail antworten.",
    "",
    "Viele Grüße",
    "Dein motion sports Team"
  );
  const text = textLines.join("\n");

  // Closing sign-off, always last. When there are alternatives they (with the
  // divider) render BEFORE it, inside the same below-CTA slot.
  const signOffHtml = `
                  <p style="${EMAIL_TEXT_STYLE} padding-top: 10px;" align="center">Bei Fragen kannst du jederzeit auf diese E-Mail antworten.</p>
                  <p style="${EMAIL_TEXT_STYLE} padding-top: 10px; padding-bottom: 10px;" align="center">Viele Gr&#252;&#223;e<br>Dein motion sports Team</p>`;
  const alternativesBlock = alternativesPart.html
    ? `
                <table cellspacing="0" cellpadding="0" border="0" width="100%" style="min-width: 100%; direction: ltr;" role="presentation">
                  <tr>
                    <td align="left" style="mso-line-height-rule: exactly; text-align: left; padding-top: 10px;">${DIVIDER_HTML}${alternativesPart.html}
                    </td>
                  </tr>
                </table>`
    : "";

  const html = renderBrandedEmail({
    subject: SUMMARY_EMAIL_SUBJECT,
    preheader:
      "Vielen Dank für deine Beratung bei motion sports — hier sind deine Zusammenfassung und dein Warenkorb.",
    heading: "Deine Zusammenfassung",
    bodyHtml: `
                                  <p style="${EMAIL_TEXT_STYLE}" align="left">Hallo,</p>
                                  <p style="${EMAIL_TEXT_STYLE} padding-top: 10px; padding-bottom: 10px;" align="left">vielen Dank f&#252;r deine Beratung bei <strong>motion sports</strong>. Hier ist deine Zusammenfassung:</p>
                                  <table cellspacing="0" cellpadding="0" border="0" width="100%" style="min-width: 100%; direction: ltr;" role="presentation">
                                    <tr>
                                      <th style="mso-line-height-rule: exactly; padding: 16px 20px;" align="left" bgcolor="#f6f6f6" valign="top">
                                        <p style="${EMAIL_TEXT_STYLE} white-space: pre-wrap;" align="left">${escapeHtml(summary)}</p>
                                      </th>
                                    </tr>
                                  </table>
                                  ${chosen.html}`,
    ctas: cartUrl ? [{ label: "Zur Kasse", url: cartUrl }] : [],
    footnoteHtml: `${alternativesBlock}${signOffHtml}`,
  });

  return { text, html };
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
}): Promise<SummaryEmailResult> {
  const { sessionId, email } = params;

  const conversation = sessionId ? await loadConversationForSummary(sessionId) : null;
  const turns = conversation ? readableTurns(conversation.messages) : [];

  // Prefilled cart for the CHOSEN products — NO discount (transactional).
  // excludeSoldOut: the sold-out rule takes precedence over selection — a
  // sold-out product never enters a checkout link, same as the in-chat button.
  const cartProductIds = chooseCartProductIds(conversation);
  const cart = cartProductIds.length
    ? await buildPrefilledCartUrlForIds(cartProductIds, { excludeSoldOut: true })
    : { url: null, lines: [], resolvedProductIds: [], unresolvedProductIds: [] };

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

  const summary = await buildSummaryText(turns);

  const { text, html } = buildSummaryEmailContent({
    summary,
    chosenProducts,
    alternatives,
    cartUrl: cart.url,
  });

  const result = await sendEmail({
    to: email,
    subject: SUMMARY_EMAIL_SUBJECT,
    text,
    html,
    kind: "summary",
  });

  return {
    sent: result.ok,
    result,
    hadConversation: Boolean(conversation),
    cartUrl: cart.url,
  };
}
