// AI-drafted personalised CAMPAIGN email (Kampagnen-Modul, R12) — the sibling
// of marketing-draft.ts for the Shopify-subscriber audience.
//
// These customers never used Mo: there is NO conversation data. Personalisation
// is purely Shopify profile (name, language) + order history + catalog
// recommendations. The draft prose contains:
//   1. a personal greeting by first name (graceful fallback),
//   2. a natural, warm reference to the purchase history — a category or ONE
//      specific item, never an itemised dump,
//   3. short, natural mentions of the 2–3 recommended products (markdown links
//      on the names) — the products themselves render BELOW the prose as the
//      newsletter picture grid (campaign-email.ts), so the prose stays a
//      personal introduction, not a catalog block,
//   4. optionally the personal discount offer, woven around the clearly-marked
//      PLACEHOLDER code (MO-XXXX) + projected expiry — the real MK- code is
//      minted only at send time (campaign-email.ts), exactly like the existing
//      marketing flow.
// The Mo-promo block (deep link) and the unsubscribe/Impressum footer are NOT
// part of the prose — they are appended deterministically at render time
// (campaign-draft-core.moPromoBlockText / campaign-email.ts) so an edit can
// never remove them.
//
// Provider: Anthropic via @ai-sdk/anthropic + the Vercel AI SDK, same model as
// the existing drafts — one voice across the backend. Defensive: any model
// error / missing API key falls back to a clean templated email so a batch
// prepare run is never blocked.

import { generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import {
  LEGACY_EMAIL_TEXT_MODE,
  textModeBodyRule,
  textModeHighlightRule,
} from "./email-text-mode.mjs";
import { reportError } from "./observability";
import { recordAiUsage } from "./ai-usage-store";
import type { DraftDiscountInput, EmailTextMode, MarketingDraft } from "./marketing-draft";
import type { CampaignPurchaseSummary } from "./campaign-store";
import { formatStoreDate } from "./store-datetime.mjs";

// Same model the existing marketing drafts use.
const DRAFT_MODEL = "claude-sonnet-4-6";

/** The draft schema, parameterised by the selected text mode — the per-product
 * description length follows the mode (detailed: 1–3 sentences … minimal:
 * caption-like fragment), exactly like marketing-draft's variant. */
function draftSchema(textMode: EmailTextMode) {
  return z.object({
    subject: z
      .string()
      .describe("Kurze, persönliche Betreffzeile in der Zielsprache (max ~60 Zeichen)."),
    body: z
      .string()
      .describe(
        "Der E-Mail-Text in der Zielsprache (Deutsch: Du-Form), warm und persönlich, " +
          "unterschrieben mit 'Mo, dein persönlicher Berater bei motion sports' " +
          "(Englisch: 'Mo, your personal advisor at motion sports'). OHNE Abmeldelink, " +
          "OHNE Chatbot-Hinweis (beides wird separat angehängt)."
      ),
    // Per-product personalised descriptions for the product-rows layout — same
    // contract as marketing-draft's productHighlights (matched by EXACT name).
    productHighlights: z
      .array(
        z.object({
          name: z
            .string()
            .describe("EXAKT der vorgegebene Produktname (unverändert kopiert)."),
          description: z
            .string()
            .describe(
              `${textModeHighlightRule(textMode)} in der ZIELSPRACHE der E-Mail, ` +
                "warum genau dieses Produkt zu dieser Person passt — persönlich " +
                "aus der Kaufhistorie begründet; ohne Chat-Wissen allgemeiner, " +
                "aber trotzdem persönlich formuliert. Keine Preise, keine Links, " +
                "keine erfundenen Fakten."
            ),
        })
      )
      .describe(
        "Für JEDES empfohlene Produkt (und jedes Set-Produkt, falls ein Set " +
          "angehängt ist) genau EIN Eintrag mit einer persönlichen Kurzbeschreibung."
      ),
  });
}

/** Trim + drop unusable entries; never trust model output blindly. */
function sanitizeHighlights(
  raw: Array<{ name?: unknown; description?: unknown }> | undefined | null
): Array<{ name: string; description: string }> {
  if (!Array.isArray(raw)) return [];
  const out: Array<{ name: string; description: string }> = [];
  for (const h of raw) {
    const name = typeof h?.name === "string" ? h.name.trim() : "";
    const description = typeof h?.description === "string" ? h.description.trim() : "";
    if (name && description) out.push({ name, description });
  }
  return out;
}

export interface CampaignRecommendationInput {
  name: string;
  /** Absolute storefront product URL — the model links exactly this. */
  url: string;
  category: string | null;
}

export interface GenerateCampaignDraftInput extends DraftDiscountInput {
  language: "de" | "en";
  firstName: string | null;
  /** Compact order snapshot (titles/dates/totals) the prose references. */
  purchaseSummary: CampaignPurchaseSummary | null;
  /**
   * Titles of the purchased products the operator selected as the basis
   * (review-card purchase selection) — the prose's purchase reference sticks
   * to THESE. Null = no narrowing (any purchase may be referenced).
   */
  focusPurchaseTitles?: string[] | null;
  /** The 2–3 products the email recommends (owned items already excluded). */
  recommendations: CampaignRecommendationInput[];
  /** True when the recommendations are representative fallbacks. */
  lowConfidence: boolean;
  /**
   * An attached bundle offer, so the prose references the set NATURALLY. The
   * actual offer block (products, price, "statt", CTA — see bundle-email.ts)
   * is appended deterministically at send time; the prose just mentions the
   * set, exactly like the marketing draft's bundleHint. Null = none.
   */
  attachedBundle?: {
    title: string;
    componentNames: string[];
    /** True when the bundle price is below the component sum (a real saving). */
    hasSaving: boolean;
  } | null;
  /** Prose length for the generated text (operator-selected in the admin UI).
   * Omitted = 'detailed' (the classic long-form behaviour). */
  textMode?: EmailTextMode;
}

function purchaseBlock(summary: CampaignPurchaseSummary | null, language: "de" | "en"): string {
  if (!summary || summary.orders.length === 0) {
    return language === "en"
      ? "(no order details available — refer to them as a valued customer, do not invent purchases)"
      : "(keine Bestelldetails verfügbar — sprich die Person als geschätzte:n Kund:in an, erfinde KEINE Käufe)";
  }
  return summary.orders
    .map((o) => {
      const date = formatStoreDate(o.createdAt, language === "en" ? "en-GB" : "de-DE", "?");
      const items = o.items
        .map((i) => `${i.quantity}× ${i.title ?? "?"}`)
        .join(", ");
      return `- ${date} (${o.name}): ${items}`;
    })
    .join("\n");
}

function recommendationsBlock(recs: CampaignRecommendationInput[]): string {
  if (recs.length === 0) return "(keine)";
  return recs
    .map((r) => `- ${r.name}${r.category ? ` (${r.category})` : ""} — ${r.url}`)
    .join("\n");
}

/** Discount paragraph for the templated fallbacks (no cart button on this
 * channel — the code + deadline are stated plainly). */
function fallbackDiscountParagraph(
  input: DraftDiscountInput,
  language: "de" | "en"
): string | null {
  if (!input.discountCode || input.discountPercent <= 0) return null;
  if (language === "en") {
    const validity = input.discountExpiresLabel
      ? ` It is valid until ${input.discountExpiresLabel}.`
      : "";
    return (
      `As a small thank-you I've set up a personal discount code just for you: ` +
      `with ${input.discountCode} you get ${input.discountPercent}% off your ` +
      `order. The code is yours alone and can be used once.${validity}`
    );
  }
  const validity = input.discountExpiresLabel
    ? ` Er ist bis ${input.discountExpiresLabel} gültig.`
    : "";
  return (
    `Als kleines Dankeschön habe ich einen persönlichen Rabattcode für dich ` +
    `angelegt: Mit ${input.discountCode} bekommst du ${input.discountPercent}% ` +
    `auf deine Bestellung. Der Code gehört nur dir und ist einmalig einlösbar.${validity}`
  );
}

/** The prompt section describing an attached bundle (or empty when none) — the
 * campaign variant of marketing-draft's bundleHint: reference the set warmly,
 * near the recommendations, WITHOUT inventing a price or a link (the offer
 * block is appended at send time). */
function bundleHint(
  bundle: GenerateCampaignDraftInput["attachedBundle"],
  language: "de" | "en"
): string {
  if (!bundle || bundle.componentNames.length === 0) return "";
  const items = bundle.componentNames.map((n) => `  - ${n}`).join("\n");
  if (language === "en") {
    return (
      `## Attached set offer (mention naturally in the text)\n` +
      `A personal product set "${bundle.title}" has been prepared for this ` +
      `customer; it appears below the text as its own offer with image, price ` +
      `and button. Mention the set invitingly, as if you put it together ` +
      `personally.` +
      (bundle.hasSaving
        ? ` It costs less than the individual products combined — point out the advantage kindly.`
        : ``) +
      ` Do NOT state a price and do NOT include a link (both are appended ` +
      `automatically). The set contains:\n${items}\n\n`
    );
  }
  return (
    `## Angehängtes Set-Angebot (im Text natürlich erwähnen)\n` +
    `Für diese:n Kund:in ist ein persönliches Produkt-Set „${bundle.title}“ ` +
    `vorbereitet, das unten in der E-Mail als eigenes Angebot mit Bild, Preis ` +
    `und Button erscheint. Erwähne dieses Set einladend im Text, als hättest ` +
    `du es persönlich zusammengestellt.` +
    (bundle.hasSaving
      ? ` Es ist günstiger als die Einzelprodukte zusammen — weise freundlich auf den Vorteil hin.`
      : ``) +
    ` Nenne KEINEN Preis und baue KEINEN Link ein (beides wird automatisch ` +
    `angehängt). Das Set enthält:\n${items}\n\n`
  );
}

/** Clean templated fallback used when the model is unavailable. */
function fallbackCampaignDraft(input: GenerateCampaignDraftInput): MarketingDraft {
  const en = input.language === "en";
  const first = input.firstName?.trim();
  const greeting = en
    ? first
      ? `Hello ${first},`
      : "Hello,"
    : first
      ? `Hallo ${first},`
      : "Hallo,";
  const subject = en
    ? "Your personal recommendation from motion sports"
    : "Deine persönliche Empfehlung von motion sports";

  const lines: string[] = [
    greeting,
    "",
    en
      ? "thank you for being a motion sports customer — I hope your equipment is serving you well."
      : "schön, dass du bei motion sports einkaufst — ich hoffe, deine Ausstattung macht dir weiter Freude.",
  ];
  if (input.recommendations.length > 0) {
    lines.push(
      "",
      en
        ? "Building on what you already have, these could be a great fit:"
        : "Passend zu dem, was du schon hast, könnten diese Produkte gut passen:",
      // Markdown links — the renderer turns them into clickable product names.
      ...input.recommendations.map((r) => `- [${r.name}](${r.url})`)
    );
  }
  const discountParagraph = fallbackDiscountParagraph(input, input.language);
  if (discountParagraph) lines.push("", discountParagraph);
  if (input.attachedBundle && input.attachedBundle.componentNames.length > 0) {
    lines.push(
      "",
      en
        ? `I've also put together a personal set for you: ${input.attachedBundle.title}. You'll find the details and your offer right below.`
        : `Ich habe dir außerdem ein persönliches Set zusammengestellt: ${input.attachedBundle.title}. Die Details und dein Angebot findest du gleich unten.`
    );
  }
  lines.push(
    "",
    en
      ? "If you have any questions, just reply — I'm happy to help."
      : "Wenn du Fragen hast, melde dich jederzeit — ich helfe dir gern weiter.",
    "",
    en ? "Best regards" : "Herzliche Grüße",
    en
      ? "Mo, your personal advisor at motion sports"
      : "Mo, dein persönlicher Berater bei motion sports"
  );
  return { subject, body: lines.join("\n"), productHighlights: [] };
}

/** The prompt section describing the personal offer (or its absence) — the
 * campaign variant of marketing-draft's discountHint: same placeholder/expiry
 * rules, but NO cart button exists on this channel. */
function discountHint(input: DraftDiscountInput, language: "de" | "en"): string {
  const hasDiscount = Boolean(input.discountCode) && input.discountPercent > 0;
  if (!hasDiscount) {
    return language === "en"
      ? "There is NO discount offer this time — do not mention any discount, code, or price reduction."
      : "Es gibt diesmal KEIN Rabattangebot — erwähne also weder einen Rabatt noch einen Code und versprich keinen Preisnachlass.";
  }
  const validityPhrase = input.discountValidityDays
    ? `${input.discountValidityDays} ${language === "en" ? "days" : "Tage"}`
    : language === "en"
      ? "a short time"
      : "kurze Zeit";
  if (language === "en") {
    return (
      `IMPORTANT — this customer receives a personal offer you MUST weave into ` +
      `the text clearly and warmly (no hype, no artificial pressure):\n` +
      `- ${input.discountPercent}% off their order.\n` +
      `- The code was created ONCE, for THIS customer only — make clear it is ` +
      `their personal code, not a mass promotion.\n` +
      `- The code is exactly ${input.discountCode}. Use EXACTLY this string, unchanged.\n` +
      `- It can be redeemed only ONCE (single-use), entered at checkout.\n` +
      `- It is valid for ${validityPhrase}` +
      (input.discountExpiresLabel
        ? ` — until ${input.discountExpiresLabel}. State BOTH the validity period and the concrete end date, naturally, without pressure.`
        : `. Mention kindly that it does not last forever.`)
    );
  }
  return (
    `WICHTIG — dieser Kunde bekommt ein persönliches Angebot, das du klar, warm ` +
    `und einladend in den Text einweben MUSST (kein Marktschreier, kein ` +
    `künstlicher Druck):\n` +
    `- ${input.discountPercent}% Rabatt auf die Bestellung.\n` +
    `- Der Code ist EINMALIG und EXTRA für DIESEN Kunden erstellt — kein ` +
    `allgemeiner Gutschein, keine Massenaktion.\n` +
    `- Der Code lautet exakt ${input.discountCode}. Verwende GENAU diese ` +
    `Zeichenfolge unverändert im Text.\n` +
    `- Der Code ist nur EIN EINZIGES MAL einlösbar (single-use) und wird im ` +
    `Checkout eingegeben.\n` +
    `- Er ist ${validityPhrase} gültig` +
    (input.discountExpiresLabel
      ? ` — bis ${input.discountExpiresLabel}. Sage BEIDES klar im Text: die Gültigkeitsdauer UND das konkrete Ablaufdatum, natürlich formuliert, ohne Druck.`
      : `. Weise freundlich darauf hin, dass er nicht ewig gilt.`)
  );
}

/**
 * Generate the personalised campaign draft. Never throws — on any error
 * returns the templated fallback so the batch prepare continues (the admin
 * reviews and edits every draft before sending anyway).
 */
export async function generateCampaignDraft(
  input: GenerateCampaignDraftInput
): Promise<MarketingDraft> {
  if (!process.env.ANTHROPIC_API_KEY) return fallbackCampaignDraft(input);

  const en = input.language === "en";
  const languageRule = en
    ? "Write the email in natural, warm ENGLISH."
    : "Schreibe die E-Mail auf DEUTSCH in der Du-Form.";
  const textMode = input.textMode ?? LEGACY_EMAIL_TEXT_MODE;

  try {
    const { object, usage } = await generateObject({
      model: anthropic(DRAFT_MODEL),
      schema: draftSchema(textMode),
      system:
        "Du bist Mo, ein persönlicher, sympathischer Berater bei motion sports " +
        "(Fitness- und Kraftsportgeräte). Du schreibst eine warme, " +
        "persönliche Marketing-E-Mail an eine:n Bestandskund:in des Shops. " +
        "Diese Person kennt dich NOCH NICHT aus einem Chat — es gibt KEIN " +
        "Gespräch, auf das du dich beziehen kannst. Personalisiere " +
        "ausschließlich über die Kaufhistorie und die vorgegebenen " +
        "Produktempfehlungen.\n\n" +
        "Regeln:\n" +
        `- ${languageRule}\n` +
        "- Beginne mit einer persönlichen Anrede mit Vornamen, wenn einer " +
        "vorgegeben ist; sonst eine freundliche Anrede ohne Namen.\n" +
        "- Beziehe dich natürlich und warm auf die Kaufhistorie: nenne die " +
        "Produktkategorie oder EIN konkretes Produkt (z. B. „wie läuft's mit " +
        "deinem Laufband?“) — NIEMALS eine aufgezählte Liste aller Käufe, kein " +
        "Daten-Vorlesen.\n" +
        "- WICHTIG zum Layout: Die empfohlenen Produkte erscheinen unterhalb " +
        "deines Textes AUTOMATISCH als Bildkacheln mit Produktfoto, Name, Preis " +
        "und Link. Dein Text ist die persönliche Einleitung dazu — KEIN " +
        "Produktkatalog.\n" +
        `- ${textModeBodyRule(textMode, input.language)}\n` +
        "- Schreibe reinen Fließtext OHNE Überschriften, OHNE Aufzählungsblöcke " +
        "pro Produkt und OHNE Fettdruck-Zeilen wie „**Kategorie:**“ — keine " +
        "Markdown-Formatierung außer Produkt-Links.\n" +
        "- Wenn du ein Produkt im Text nennst, verlinke es als Markdown-Link " +
        "mit dem Produktnamen als Linktext und seiner EXAKTEN Produkt-URL: " +
        "[Produktname](URL). Schreibe NIE eine nackte URL in den Text und " +
        "verwende NIEMALS HTML (kein <a href=…>). Keine erfundenen Produkte, " +
        "keine erfundenen Preise.\n" +
        "- Sei ehrlich, kein Marktschreier: keine künstliche Dringlichkeit, " +
        "keine Countdown-Rhetorik.\n" +
        "- Wenn ein persönliches Rabattangebot vorgegeben ist, webe es klar und " +
        "einladend ein (mit dem exakten Code).\n" +
        "- Wenn ein persönliches Set-Angebot angehängt ist, erwähne es natürlich " +
        "im Text (es erscheint unten als eigenes Angebot mit Bild, Preis und " +
        "Button) — nenne aber selbst KEINEN Preis und KEINEN Link dafür.\n" +
        "- Baue KEINEN Abmeldelink und KEINEN Hinweis auf den neuen Chat-" +
        "Berater ein — beides wird separat angehängt.\n" +
        "- Unterschreibe mit " +
        (en
          ? "'Mo, your personal advisor at motion sports'."
          : "'Mo, dein persönlicher Berater bei motion sports'."),
      prompt:
        `## Kund:in\n` +
        `Vorname: ${input.firstName?.trim() || "(unbekannt)"}\n` +
        `Sprache der E-Mail: ${en ? "Englisch" : "Deutsch"}\n\n` +
        `## Kaufhistorie (nur als Kontext — NICHT aufzählen)\n` +
        `${purchaseBlock(input.purchaseSummary, input.language)}\n\n` +
        (input.focusPurchaseTitles && input.focusPurchaseTitles.length > 0
          ? en
            ? `Focus: when referring to the purchase history, refer ONLY to ` +
              `the following purchase(s) — do not mention the other ones: ` +
              `${input.focusPurchaseTitles.join(", ")}\n\n`
            : `Fokus: Beziehe dich bei der Kaufhistorie AUSSCHLIESSLICH auf ` +
              `folgende(n) Kauf/Käufe — erwähne die übrigen Käufe nicht: ` +
              `${input.focusPurchaseTitles.join(", ")}\n\n`
          : "") +
        (input.lowConfidence
          ? `Hinweis: Die Käufe konnten keinem aktuellen Katalogprodukt zugeordnet ` +
            `werden — bleibe bei der Kaufhistorie deshalb ALLGEMEIN (kein konkretes ` +
            `Produkt nennen) und führe die Empfehlungen als Inspiration ein.\n\n`
          : "") +
        `## Produkte, die diese E-Mail empfehlen soll (mit exakter URL)\n` +
        `${recommendationsBlock(input.recommendations)}\n\n` +
        `${discountHint(input, input.language)}\n\n` +
        bundleHint(input.attachedBundle, input.language) +
        `Schreibe jetzt die personalisierte E-Mail (Betreff + Text).`,
    });
    // Cost KPI (dashboard/admin side).
    await recordAiUsage({
      callSite: "campaign_draft",
      model: DRAFT_MODEL,
      inputTokens: usage?.inputTokens ?? 0,
      outputTokens: usage?.outputTokens ?? 0,
    });
    const subject = object.subject?.trim();
    const body = object.body?.trim();
    if (!subject || !body) return fallbackCampaignDraft(input);
    return { subject, body, productHighlights: sanitizeHighlights(object.productHighlights) };
  } catch (err) {
    reportError(err, { route: "lib/campaign-draft", phase: "generate" });
    return fallbackCampaignDraft(input);
  }
}
