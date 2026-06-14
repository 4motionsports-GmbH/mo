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
import { recordAiUsage } from "./ai-usage-store";

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

/** The personal-offer parameters, shared by the per-session and per-customer
 * drafts so the discount behaviour (placeholder code, stated validity period +
 * concrete expiry date) can never drift apart between the two paths. */
export interface DraftDiscountInput {
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
  /**
   * How many days the code stays valid (normally 7) so the prose can state the
   * period ("7 Tage gültig") alongside the concrete date. Null when no
   * discount was selected.
   */
  discountValidityDays: number | null;
}

export interface GenerateDraftInput extends DraftDiscountInput {
  personaLabel: string | null;
  products: Array<{ name: string }>;
  transcript: TranscriptMessage[];
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

/** The templated discount paragraph for the fallback drafts, or null when no
 * discount was selected. Shared by both fallbacks. */
function fallbackDiscountParagraph(input: DraftDiscountInput): string | null {
  if (!input.discountCode || input.discountPercent <= 0) return null;
  const validity = input.discountValidityDays
    ? `${input.discountValidityDays} Tage gültig` +
      (input.discountExpiresLabel ? ` — bis ${input.discountExpiresLabel}` : "")
    : input.discountExpiresLabel
      ? `gültig bis ${input.discountExpiresLabel}`
      : `nur für kurze Zeit gültig`;
  return (
    `Und weil wir persönlich gesprochen haben, habe ich extra für dich einen ` +
    `eigenen Rabattcode angelegt: Mit ${input.discountCode} bekommst du ` +
    `${input.discountPercent}% auf deine Auswahl. Der Code gehört nur dir, ` +
    `ist einmalig einlösbar und ${validity}. ` +
    `Den vorausgefüllten Warenkorb-Button findest du gleich unten — ` +
    `ein Klick, und der Code ist schon hinterlegt.`
  );
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
  const discountParagraph = fallbackDiscountParagraph(input);
  if (discountParagraph) lines.push("", discountParagraph);
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
 * The prompt section describing the personal offer (or its absence). The expiry
 * must be unmissable in the prose: validity period AND concrete end date,
 * naturally placed next to the call-to-action. Shared by both draft paths.
 */
function discountHint(input: DraftDiscountInput): string {
  const hasDiscount = Boolean(input.discountCode) && input.discountPercent > 0;
  if (!hasDiscount) {
    return (
      "Es gibt diesmal KEIN Rabattangebot — erwähne also weder einen Rabatt noch " +
      "einen Code und versprich keinen Preisnachlass."
    );
  }
  const validityPhrase = input.discountValidityDays
    ? `${input.discountValidityDays} Tage`
    : "kurze Zeit";
  const expiryClause = input.discountExpiresLabel
    ? `Der Code ist ab heute nur ${validityPhrase} gültig — bis ${input.discountExpiresLabel}. ` +
      `Sage BEIDES klar im Text, nah an der Handlungsaufforderung (dem Hinweis ` +
      `auf den Warenkorb-Button): die Gültigkeitsdauer UND das konkrete ` +
      `Ablaufdatum, z. B. „gültig bis ${input.discountExpiresLabel}“. Natürlich ` +
      `formuliert, kein künstlicher Druck.`
    : "Der Code läuft nach kurzer Zeit ab — weise freundlich darauf hin, dass er nicht ewig gilt.";
  return (
    `WICHTIG — dieser Kunde bekommt ein persönliches Angebot, das du klar, warm ` +
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
  );
}

/**
 * Generate the personalised draft. Never throws — on any error returns the
 * templated fallback so the workflow continues.
 */
export async function generateMarketingDraft(input: GenerateDraftInput): Promise<MarketingDraft> {
  if (!process.env.ANTHROPIC_API_KEY) return fallbackDraft(input);

  const transcript = readableTranscript(input.transcript);

  try {
    const { object, usage } = await generateObject({
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
        `${discountHint(input)}\n\n` +
        `Gesprächsprotokoll:\n${transcript || "(kein Protokoll verfügbar)"}\n\n` +
        `Schreibe die personalisierte E-Mail (Betreff + Text).`,
    });
    // Cost KPI (dashboard/admin side).
    await recordAiUsage({
      callSite: "marketing_draft",
      model: DRAFT_MODEL,
      inputTokens: usage?.inputTokens ?? 0,
      outputTokens: usage?.outputTokens ?? 0,
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

// ---------------------------------------------------------------------------
// Per-CUSTOMER draft — the full-context upgrade (all conversations + profile +
// purchase history + admin special instructions).
// ---------------------------------------------------------------------------

// Bound the prompt like customer-profile does: newest sessions carry the
// freshest signal, so when trimming, the OLDEST transcripts are dropped first.
const MAX_SESSIONS_IN_DRAFT_PROMPT = 10;
const MAX_TRANSCRIPT_CHARS_PER_SESSION = 5000;

/** One linked conversation, as the customer draft needs it. Structurally
 * satisfied by CustomerSession (lib/customer-store). */
export interface CustomerDraftSession {
  createdAt: string | null;
  personaLabel: string | null;
  transcript: TranscriptMessage[];
}

export interface GenerateCustomerDraftInput extends DraftDiscountInput {
  /** ALL linked conversations, chronological (oldest first). */
  sessions: CustomerDraftSession[];
  /** The cached "current understanding" profile summary, if generated. */
  profileSummary: string | null;
  /**
   * The customer's email correspondence, pre-rendered as ONE readable block
   * (oldest-first, both directions) by loadCustomerCorrespondence — body TEXT
   * ONLY, already capped (last N messages / last 12 months). Lets the draft
   * reference a real reply ("du hattest nach der Lieferzeit gefragt…"). Empty /
   * absent = no correspondence.
   */
  correspondence?: string | null;
  /**
   * What the customer already OWNS (from the Shopify purchase history) — the
   * email must never re-recommend these; it builds on them instead. Empty
   * array = history checked, nothing bought; see purchasesKnown for "unknown".
   */
  ownedItems: Array<{ title: string | null; quantity: number }>;
  /** False when no purchase history was loaded — owned items are then UNKNOWN,
   *  not "none", and the email must not claim the customer owns nothing. */
  purchasesKnown: boolean;
  /** The products the email recommends (owned items already excluded — see
   *  chooseCustomerProductIds in lib/cart). Also the cart-link product set. */
  products: Array<{ name: string }>;
  /**
   * Free-text special instructions from the ADMIN (e.g. "mention the new
   * rowing machine line"). Operator guidance, NOT customer data — passed to
   * the model in its own clearly-labelled section. Null/empty = none.
   */
  adminInstructions: string | null;
  /**
   * A created bundle attached to this send, so the draft references it
   * NATURALLY. The actual offer block (products, price, "statt", CTA) is
   * appended deterministically at send time — the prose just mentions the set.
   * Null = no bundle attached.
   */
  attachedBundle?: {
    title: string;
    componentNames: string[];
    /** True when the bundle price is below the component sum (a real saving). */
    hasSaving: boolean;
  } | null;
}

/** The prompt section describing an attached bundle (or null when none). The
 * model should reference the set warmly, near the call-to-action, WITHOUT
 * inventing a price or a link (the offer block is appended at send time). */
function bundleHint(bundle: GenerateCustomerDraftInput["attachedBundle"]): string {
  if (!bundle || bundle.componentNames.length === 0) return "";
  const items = bundle.componentNames.map((n) => `  - ${n}`).join("\n");
  return (
    `## Angehängtes Set-Angebot (im Text natürlich erwähnen)\n` +
    `Für diesen Kunden ist ein persönliches Produkt-Set „${bundle.title}“ ` +
    `vorbereitet, das unten in der E-Mail als eigenes Angebot mit Bild, Preis ` +
    `und Button erscheint. Erwähne dieses Set einladend im Text (nahe der ` +
    `Handlungsaufforderung), als hättest du es persönlich zusammengestellt.` +
    (bundle.hasSaving
      ? ` Es ist günstiger als die Einzelprodukte zusammen — weise freundlich auf den Vorteil hin.`
      : ``) +
    ` Nenne KEINEN Preis und baue KEINEN Link ein (beides wird automatisch ` +
    `angehängt). Das Set enthält:\n${items}\n\n`
  );
}

function draftSessionBlock(s: CustomerDraftSession, index: number, total: number): string {
  const transcript = readableTranscript(s.transcript);
  const clipped =
    transcript.length > MAX_TRANSCRIPT_CHARS_PER_SESSION
      ? transcript.slice(0, MAX_TRANSCRIPT_CHARS_PER_SESSION) + "\n[… gekürzt]"
      : transcript;
  const date = s.createdAt ? new Date(s.createdAt).toLocaleDateString("de-DE") : "Datum unbekannt";
  return (
    `### Gespräch ${index + 1} von ${total} — ${date}` +
    `${s.personaLabel ? ` · Persona: ${s.personaLabel}` : ""}\n` +
    (clipped || "(kein lesbares Transkript)")
  );
}

function ownedItemsBlock(input: GenerateCustomerDraftInput): string {
  if (!input.purchasesKnown) {
    return (
      "(Kaufhistorie nicht geladen — Käufe sind UNBEKANNT, nicht 'keine'. " +
      "Behaupte nichts über bisherige Käufe.)"
    );
  }
  if (input.ownedItems.length === 0) {
    return "(Shopify abgefragt: bisher keine Bestellungen unter dieser E-Mail)";
  }
  return input.ownedItems
    .map((i) => `- ${i.quantity}× ${i.title ?? "Unbekannter Artikel"}`)
    .join("\n");
}

/** Templated fallback for the per-customer draft. Admin instructions cannot be
 * honoured by a template — the admin reviews/edits every draft before sending,
 * and the instructions stay visible next to the editor. */
function fallbackCustomerDraft(input: GenerateCustomerDraftInput): MarketingDraft {
  const first = input.products[0]?.name;
  const subject = first
    ? `Deine Empfehlung von motion sports: ${first}`
    : "Deine persönliche Empfehlung von motion sports";

  const several = input.sessions.length > 1;
  const lines: string[] = [
    "Hallo,",
    "",
    several
      ? "hier ist Mo von motion sports. Schön, dass wir uns schon mehrfach im " +
        "Chat zu deinem Trainingsvorhaben austauschen konnten."
      : "hier ist Mo von motion sports. Schön, dass wir uns im Chat zu deinem " +
        "Trainingsvorhaben austauschen konnten.",
  ];
  if (input.products.length > 0) {
    lines.push(
      "",
      several
        ? "Basierend auf unseren Gesprächen passt aus meiner Sicht besonders gut:"
        : "Basierend auf unserem Gespräch passt aus meiner Sicht besonders gut:",
      productLine(input.products)
    );
  }
  const discountParagraph = fallbackDiscountParagraph(input);
  if (discountParagraph) lines.push("", discountParagraph);
  if (input.attachedBundle && input.attachedBundle.componentNames.length > 0) {
    lines.push(
      "",
      `Ich habe dir außerdem ein persönliches Set zusammengestellt: ` +
        `${input.attachedBundle.title}. Die Details und dein Angebot findest du gleich unten.`
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
 * Generate the per-customer personalised draft from EVERYTHING we know about
 * one person: every linked conversation, the "current understanding" profile,
 * the purchase history (owned items are never re-recommended), and — clearly
 * separated from the customer data — the admin's special instructions. Never
 * throws — on any error returns the templated fallback so the workflow
 * continues (the admin reviews and edits every draft before sending anyway).
 */
export async function generateCustomerMarketingDraft(
  input: GenerateCustomerDraftInput
): Promise<MarketingDraft> {
  if (!process.env.ANTHROPIC_API_KEY) return fallbackCustomerDraft(input);

  const kept = input.sessions.slice(-MAX_SESSIONS_IN_DRAFT_PROMPT);
  const sessionBlocks = kept.map((s, i) => draftSessionBlock(s, i, kept.length)).join("\n\n");
  const correspondence = input.correspondence?.trim() || "";
  const instructions = input.adminInstructions?.trim() || null;

  // The admin's guidance gets its own labelled section, clearly separated from
  // the customer data, so the model treats it as operator directives — woven
  // into the prose, never quoted as instructions.
  const adminBlock = instructions
    ? `## Hinweise vom motion-sports-Team (NICHT vom Kunden)\n` +
      `Arbeite die folgenden Punkte natürlich in die E-Mail ein. Zitiere sie ` +
      `nicht wörtlich und erwähne nicht, dass es interne Hinweise sind:\n` +
      `${instructions}\n\n`
    : "";

  try {
    const { object, usage } = await generateObject({
      model: anthropic(DRAFT_MODEL),
      schema: draftSchema,
      system:
        "Du bist Mo, ein persönlicher, sympathischer Berater bei motion sports " +
        "(Fitness- und Kraftsportgeräte). Du schreibst eine kurze, warme, " +
        "persönliche Marketing-E-Mail auf Deutsch in der Du-Form an einen " +
        "Stammkunden, den du aus einem oder mehreren Chat-Gesprächen kennst. " +
        "Du bekommst ALLES, was wir über diesen Kunden wissen: alle bisherigen " +
        "Gespräche, die bisherige E-Mail-Korrespondenz, ein verdichtetes " +
        "Kundenverständnis und die Kaufhistorie.\n\n" +
        "Regeln:\n" +
        "- Beziehe dich konkret auf die Gespräche UND, falls vorhanden, auf die " +
        "bisherige E-Mail-Korrespondenz (z. B. auf eine offene Frage aus einer " +
        "Antwort); bei Widersprüchen zwischen älteren und neueren Aussagen gilt " +
        "die neuere.\n" +
        "- Produkte, die der Kunde laut Kaufhistorie BEREITS BESITZT, empfiehlst " +
        "du NICHT noch einmal. Knüpfe stattdessen daran an: empfiehl Ergänzendes " +
        "oder den sinnvollen nächsten Schritt, und freu dich ehrlich über den Kauf, " +
        "wenn es passt.\n" +
        "- Empfiehl NUR die vorgegebenen Produkte — sei ehrlich, kein Marktschreier, " +
        "keine erfundenen Produkte, keine erfundenen Preise.\n" +
        "- Hinweise vom motion-sports-Team (wenn vorhanden) arbeitest du natürlich " +
        "in den Text ein — als deine eigenen Worte, nie als zitierte Anweisung.\n" +
        "- Wenn dir ein persönliches Rabattangebot vorgegeben wird, webe es klar, " +
        "warm und einladend in den Text ein (mit dem exakten Code) — als " +
        "persönliches Angebot für genau diesen Kunden, nicht als Massen-Promo.\n" +
        "- Wenn ein persönliches Set-Angebot angehängt ist, erwähne es natürlich " +
        "im Text (es erscheint unten als eigenes Angebot mit Bild, Preis und " +
        "Button) — nenne aber selbst KEINEN Preis und KEINEN Link.\n" +
        "- Unterschreibe mit 'Mo, dein persönlicher Berater bei motion sports'. " +
        "Baue KEINEN Warenkorb-Link und KEINEN Abmeldelink ein — die werden " +
        "separat angehängt.",
      prompt:
        `## Aktuelles Kundenverständnis (verdichtet)\n` +
        `${input.profileSummary?.trim() || "(noch kein Profil generiert)"}\n\n` +
        `## Bereits gekauft (NICHT erneut empfehlen)\n${ownedItemsBlock(input)}\n\n` +
        `## Produkte, die diese E-Mail empfehlen soll\n${productLine(input.products)}\n\n` +
        `${discountHint(input)}\n\n` +
        bundleHint(input.attachedBundle) +
        adminBlock +
        `## Bisherige Gespräche (chronologisch, älteste zuerst)\n\n` +
        `${sessionBlocks || "(keine Gespräche verknüpft)"}\n\n` +
        `## Bisherige E-Mail-Korrespondenz (chronologisch, älteste zuerst)\n\n` +
        `${correspondence || "(keine E-Mail-Korrespondenz)"}\n\n` +
        `Schreibe jetzt die personalisierte E-Mail (Betreff + Text).`,
    });
    // Cost KPI (dashboard/admin side).
    await recordAiUsage({
      callSite: "marketing_draft",
      model: DRAFT_MODEL,
      inputTokens: usage?.inputTokens ?? 0,
      outputTokens: usage?.outputTokens ?? 0,
    });
    const subject = object.subject?.trim();
    const body = object.body?.trim();
    if (!subject || !body) return fallbackCustomerDraft(input);
    return { subject, body };
  } catch (err) {
    reportError(err, { route: "lib/marketing-draft", phase: "generateCustomer" });
    return fallbackCustomerDraft(input);
  }
}
