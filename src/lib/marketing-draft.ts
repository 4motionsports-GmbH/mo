// AI-drafted personalised marketing email.
//
// Writes a warm, personal German email AS IF from a personal consultant at
// motion sports (signed "MOIA"), referencing what the customer discussed in the
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
        "unterschrieben mit 'MOIA, dein persönlicher Berater bei motion sports'. " +
        "OHNE Warenkorb-Link und OHNE Abmeldelink (werden separat angehängt)."
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
  /** The unique discount code, if one was minted. Mentioned in the prose. */
  discountCode: string | null;
  /** Discount percentage as an integer (e.g. 5). */
  discountPercent: number;
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
    "hier ist MOIA von motion sports. Schön, dass wir uns im Chat zu deinem " +
      "Trainingsvorhaben austauschen konnten.",
  ];
  if (input.products.length > 0) {
    lines.push(
      "",
      "Basierend auf unserem Gespräch passt aus meiner Sicht besonders gut:",
      productLine(input.products)
    );
  }
  if (input.discountCode) {
    lines.push(
      "",
      `Als kleines Dankeschön habe ich dir einen persönlichen Code hinterlegt: ` +
        `${input.discountCode} bringt dir ${input.discountPercent}% Rabatt.`
    );
  }
  lines.push(
    "",
    "Melde dich jederzeit, wenn du Fragen hast — ich helfe dir gern persönlich weiter.",
    "",
    "Herzliche Grüße",
    "MOIA, dein persönlicher Berater bei motion sports"
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
  const discountHint = input.discountCode
    ? `Es gibt einen persönlichen, einmaligen Rabattcode: ${input.discountCode} ` +
      `(${input.discountPercent}% Rabatt). Erwähne ihn beiläufig und einladend, ` +
      `aber baue KEINEN Link ein.`
    : "Es gibt diesmal keinen Rabattcode — erwähne also keinen.";

  try {
    const { object } = await generateObject({
      model: anthropic(DRAFT_MODEL),
      schema: draftSchema,
      system:
        "Du bist MOIA, ein persönlicher, sympathischer Berater bei motion sports " +
        "(Fitness- und Kraftsportgeräte). Du schreibst eine kurze, warme, " +
        "persönliche Marketing-E-Mail auf Deutsch in der Du-Form an einen Kunden, " +
        "mit dem du im Chat gesprochen hast. Beziehe dich konkret auf das Gespräch " +
        "und empfiehl die besprochenen Produkte. Sei ehrlich, kein Marktschreier, " +
        "keine erfundenen Produkte, keine erfundenen Preise. Unterschreibe mit " +
        "'MOIA, dein persönlicher Berater bei motion sports'. Baue KEINEN " +
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
