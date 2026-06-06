// AI-drafted personalised marketing email.
//
// Writes a warm, personal German email AS IF from a personal consultant at
// motion sports (signed "Mo"), referencing what the customer discussed in the
// chat and recommending the products that came up. The discount code + prefilled
// cart are NOT part of the editable prose — they are appended deterministically
// at send time (see marketing-email.ts) so the admin can never edit away the
// cart, the discount, or the legally-required unsubscribe footer. The prose may
// mention the code naturally (we pass it in) but the working link is the button.
//
// Provider: Anthropic via @ai-sdk/anthropic + the Vercel AI SDK, matching the
// existing summary-email path. Defensive: any model error / missing API key
// falls back to a clean templated German email so a draft is never blocked.

import { generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import type { TranscriptMessage } from "./conversation-store";
import { reportError } from "./observability";

// Same model the transactional summary uses — one voice across the backend.
const DRAFT_MODEL = "claude-sonnet-4-5-20250929";

const draftSchema = z.object({
  subject: z.string().describe("Kurze, persönliche Betreffzeile auf Deutsch (max ~60 Zeichen)."),
  body: z
    .string()
    .describe(
      "Der E-Mail-Text auf Deutsch, in der Du-Form, warm und persönlich, " +
        "unterschrieben mit 'Mo, dein persönlicher Berater bei motion sports'. " +
        "Wenn ein persönliches Rabattangebot vorgegeben ist, wird es klar im Text " +
        "erwähnt (inkl. des exakten Codes), aber OHNE Warenkorb-Link und OHNE " +
        "Abmeldelink (die werden separat angehängt)."
    ),
});

export interface MarketingDraft {
  subject: string;
  body: string;
}

export interface GenerateDraftInput {
  personaLabel: string | null;
  products: Array<{ name: string }>;
  transcript: TranscriptMessage[];
  /**
   * The code string to weave into the body. At draft time this is the clearly-
   * marked PLACEHOLDER (MO-XXXX); at send time the placeholder is swapped 1:1
   * for the real unique code. Null when no discount was selected.
   */
  discountCode: string | null;
  /** Selected discount depth as a whole-number percent. 0 = no offer. */
  discountPercent: number;
  /**
   * Human-readable German expiry date (e.g. "05.07.2026") the model should name
   * in the offer. Null when no discount was selected.
   */
  discountExpiresLabel: string | null;
}

function readableTranscript(messages: TranscriptMessage[]): string {
  return messages
    .filter(
      (m) =>
        m.toolName === null && (m.role === "user" || m.role === "assistant") && m.content.trim()
    )
    .map((m) => `${m.role === "user" ? "Kunde" : "Berater"}: ${m.content.trim()}`)
    .join("\n\n");
}

function productLine(products: Array<{ name: string }>): string {
  if (products.length === 0) return "(keine konkreten Produkte besprochen)";
  return products.map((p) => `- ${p.name}`).join("\n");
}

/** Clean templated fallback used when the model is unavailable. */
function fallbackDraft(input: GenerateDraftInput): MarketingDraft {
  const first = input.products[0]?.name;
  const subject = first
    ? `Deine Empfehlung von motion sports: ${first}`
    : "Deine persönliche Empfehlung von motion sports";

  const lines: string[] = [
    "Hallo,",
    "",
    "hier ist Mo von motion sports. Schön, dass wir uns im Chat zu deinem " +
      "Trainingsvorhaben austauschen konnten.",
  ];
  if (input.products.length > 0) {
    lines.push(
      "",
      "Basierend auf unserem Gespräch passt aus meiner Sicht besonders gut:",
      productLine(input.products)
    );
  }
  if (input.discountCode && input.discountPercent > 0) {
    lines.push(
      "",
      `Und weil wir persönlich gesprochen haben, habe ich extra für dich einen ` +
        `eigenen Rabattcode angelegt: Mit ${input.discountCode} bekommst du ` +
        `${input.discountPercent}% auf deine Auswahl. Der Code gehört nur dir, ` +
        `ist einmalig einlösbar` +
        (input.discountExpiresLabel ? ` und gültig bis ${input.discountExpiresLabel}` : "") +
        `. Den vorausgefüllten Warenkorb-Button findest du gleich unten — ` +
        `ein Klick, und der Code ist schon hinterlegt.`
    );
  }
  lines.push(
    "",
    "Melde dich jederzeit, wenn du Fragen hast — ich helfe dir gern persönlich weiter.",
    "",
    "Herzliche Grüße",
    "Mo, dein persönlicher Berater bei motion sports"
  );
  return { subject, body: lines.join("\n") };
}

/**
 * Generate the personalised draft. Never throws — on any error returns the
 * templated fallback so the workflow continues.
 */
export async function generateMarketingDraft(input: GenerateDraftInput): Promise<MarketingDraft> {
  if (!process.env.ANTHROPIC_API_KEY) return fallbackDraft(input);

  const transcript = readableTranscript(input.transcript);
  const hasDiscount = Boolean(input.discountCode) && input.discountPercent > 0;
  const expiryClause = input.discountExpiresLabel
    ? `Der Code ist gültig bis ${input.discountExpiresLabel} — nenne dieses Ablaufdatum konkret.`
    : "Der Code läuft nach kurzer Zeit ab — weise freundlich darauf hin, dass er nicht ewig gilt.";
  const discountHint = hasDiscount
    ? `WICHTIG — dieser Kunde bekommt ein persönliches Angebot, das du klar, warm ` +
      `und einladend in den Text einweben MUSST (nahe der Handlungsaufforderung, ` +
      `nicht aufdringlich, kein Marktschreier):\n` +
      `- ${input.discountPercent}% Rabatt auf die besprochene Auswahl.\n` +
      `- Der Code ist EINMALIG und EXTRA für DIESEN Kunden erstellt — kein ` +
      `allgemeiner Gutschein, keine Massenaktion. Mach unmissverständlich klar, ` +
      `dass es SEIN/IHR persönlicher Code ist.\n` +
      `- Der Code lautet exakt ${input.discountCode}. Verwende GENAU diese ` +
      `Zeichenfolge unverändert im Text.\n` +
      `- Der Code ist nur EIN EINZIGES MAL einlösbar (single-use).\n` +
      `- ${expiryClause}\n` +
      `- Direkt unter dem Text gibt es einen Button „Warenkorb öffnen“, in dem der ` +
      `Code bereits hinterlegt ist. Verweise einladend auf diesen vorausgefüllten ` +
      `Warenkorb (ein Klick), baue aber KEINEN Link/keine URL selbst ein.\n` +
      `Der Kunde soll am Ende sicher wissen: ein persönlicher ${input.discountPercent}%-Code, ` +
      `nur für ihn/sie, einmalig, mit Ablaufdatum, und der Warenkorb-Button ist startklar.`
    : "Es gibt diesmal KEIN Rabattangebot — erwähne also weder einen Rabatt noch " +
      "einen Code und versprich keinen Preisnachlass.";

  try {
    const { object } = await generateObject({
      model: anthropic(DRAFT_MODEL),
      schema: draftSchema,
      system:
        "Du bist Mo, ein persönlicher, sympathischer Berater bei motion sports " +
        "(Fitness- und Kraftsportgeräte). Du schreibst eine kurze, warme, " +
        "persönliche Marketing-E-Mail auf Deutsch in der Du-Form an einen Kunden, " +
        "mit dem du im Chat gesprochen hast. Beziehe dich konkret auf das Gespräch " +
        "und empfiehl die besprochenen Produkte. Sei ehrlich, kein Marktschreier, " +
        "keine erfundenen Produkte, keine erfundenen Preise. Wenn dir ein " +
        "persönliches Rabattangebot vorgegeben wird, webe es klar, warm und " +
        "einladend in den Text ein (mit dem exakten Code) — als persönliches " +
        "Angebot für genau diesen Kunden, nicht als Massen-Promo. Unterschreibe mit " +
        "'Mo, dein persönlicher Berater bei motion sports'. Baue KEINEN " +
        "Warenkorb-Link und KEINEN Abmeldelink ein — die werden separat angehängt.",
      prompt:
        `Persona des Kunden: ${input.personaLabel ?? "unbekannt"}\n\n` +
        `Besprochene Produkte:\n${productLine(input.products)}\n\n` +
        `${discountHint}\n\n` +
        `Gesprächsprotokoll:\n${transcript || "(kein Protokoll verfügbar)"}\n\n` +
        `Schreibe die personalisierte E-Mail (Betreff + Text).`,
    });
    const subject = object.subject?.trim();
    const body = object.body?.trim();
    if (!subject || !body) return fallbackDraft(input);
    return { subject, body };
  } catch (err) {
    reportError(err, { route: "lib/marketing-draft", phase: "generate" });
    return fallbackDraft(input);
  }
}
