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
  EMAIL_FONT_FAMILY,
} from "./email-template";
import { reportError } from "./observability";
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
    const { text } = await generateText({
      model: anthropic(SUMMARY_MODEL),
      system:
        "Du fasst ein Fitness-Beratungsgespräch für eine E-Mail an den Kunden " +
        "freundlich, klar und auf Deutsch zusammen. Schreibe in der Du-Form, 3–6 " +
        "kurze Sätze. Nenne den ermittelten Bedarf und die wichtigsten Empfehlungen. " +
        "Keine erfundenen Produkte, keine Preise erfinden, kein Marketing, keine Rabatte.",
      prompt: `Hier ist das Gesprächsprotokoll:\n\n${transcript}\n\nSchreibe die Zusammenfassung.`,
    });
    const trimmed = text?.trim();
    return trimmed || transcript;
  } catch (err) {
    reportError(err, { route: "lib/summary-email", phase: "ai_summary" });
    return transcript;
  }
}

function renderProductList(products: Product[]): { text: string; html: string } {
  if (products.length === 0) return { text: "", html: "" };
  const text =
    "\nBesprochene Produkte:\n" +
    products.map((p) => `- ${p.name}`).join("\n");
  const html =
    `<h3 style="font-family: ${EMAIL_FONT_FAMILY}; color: #000000; font-size: 14px; line-height: 20px; font-weight: 400; text-transform: none; border-bottom-width: 2px; border-bottom-color: #e5e5e5; border-bottom-style: solid; padding-bottom: 5px; Margin: 20px 0 10px;" align="left">Besprochene Produkte</h3>` +
    `<ul style="Margin: 0; padding-left: 18px;">` +
    products
      .map(
        (p) =>
          `<li style="${EMAIL_TEXT_STYLE} Margin: 4px 0;"><a href="${escapeAttr(p.shopifyUrl)}" target="_blank" style="color: #000000; text-decoration: underline !important; word-wrap: break-word;">${escapeHtml(p.name)}</a></li>`
      )
      .join("") +
    `</ul>`;
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

  // The "Besprochene Produkte" list stays the full DISCUSSED set — it
  // documents the consultation. The CART is narrower: only what the user
  // chose (falling back to discussed when no choice was made).
  const productIds = conversation?.recommendedProductIds ?? [];
  const products = productIds.length ? await getProductsByIds(productIds) : [];

  // Prefilled cart for the CHOSEN products — NO discount (transactional).
  // excludeSoldOut: the sold-out rule takes precedence over selection — a
  // sold-out product never enters a checkout link, same as the in-chat button.
  const cartProductIds = chooseCartProductIds(conversation);
  const cart = cartProductIds.length
    ? await buildPrefilledCartUrlForIds(cartProductIds, { excludeSoldOut: true })
    : { url: null, lines: [], resolvedProductIds: [], unresolvedProductIds: [] };

  const summary = await buildSummaryText(turns);
  const productList = renderProductList(products);

  // --- text part ---
  const textLines = [
    "Hallo,",
    "",
    "vielen Dank für deine Beratung bei motion sports. Hier ist deine Zusammenfassung:",
    "",
    summary,
  ];
  if (productList.text) textLines.push(productList.text);
  if (cart.url) {
    textLines.push("", `Deinen vorausgefüllten Warenkorb findest du hier:\n${cart.url}`);
  }
  textLines.push(
    "",
    "Bei Fragen kannst du jederzeit auf diese E-Mail antworten.",
    "",
    "Viele Grüße",
    "Dein motion sports Team"
  );
  const text = textLines.join("\n");

  // --- html part — rendered through the shared branded template ---
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
                                  ${productList.html}`,
    ctas: cart.url ? [{ label: "Warenkorb öffnen", url: cart.url }] : [],
    footnoteHtml: `
                  <p style="${EMAIL_TEXT_STYLE} padding-top: 10px;" align="center">Bei Fragen kannst du jederzeit auf diese E-Mail antworten.</p>
                  <p style="${EMAIL_TEXT_STYLE} padding-top: 10px; padding-bottom: 10px;" align="center">Viele Gr&#252;&#223;e<br>Dein motion sports Team</p>`,
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
