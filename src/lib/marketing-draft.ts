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
import { anthropicOptionsFor, modelFor } from "./ai-models.mjs";
import { z } from "zod";
import type { TranscriptMessage } from "./conversation-store";
import {
  LEGACY_EMAIL_TEXT_MODE,
  textModeBodyRule,
  textModeHighlightRule,
} from "./email-text-mode.mjs";
import { reportError } from "./observability";
import { recordAiUsage } from "./ai-usage-store";
import { formatStoreDate } from "./store-datetime.mjs";
import {
  alignHighlightNames,
  draftPromptPlan,
  highlightNamesSection,
  noDiscountHint,
  setOfferSection,
} from "./draft-offer.mjs";
import type { OfferKind } from "./offer-mode.mjs";

// Writer tier (lib/ai-models.mjs) — one voice across the backend.
const DRAFT_MODEL = modelFor("writer");

/** Operator-selected prose length for the generated email — see
 * email-text-mode.mjs for the semantics of each mode. */
export type EmailTextMode = "detailed" | "compact" | "minimal";

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

/** The per-product personalised description schema, shared by the EMAIL drafts
 * (the printed letter has no product table, so it keeps the plain schema). The
 * render path matches entries to products by name — the model must copy the
 * given product names EXACTLY. The description length follows the selected
 * text mode (detailed: 1–3 sentences … minimal: caption-like fragment). A set
 * mail describes the set's products (named like the set block lists them), an
 * item mail the recommended ones. */
function productHighlightsField(textMode: EmailTextMode, kind: OfferKind = "items") {
  return z
    .array(
      z.object({
        name: z
          .string()
          .describe("EXAKT der vorgegebene Produktname (unverändert kopiert)."),
        description: z
          .string()
          .describe(
            `${textModeHighlightRule(textMode)}, warum GENAU DIESES Produkt zu ` +
              "GENAU DIESEM Kunden passt — persönlich aus dem Kundenwissen " +
              "(Gespräche, Profil, Käufe) begründet, in derselben Sprache und " +
              "Du-Form wie die E-Mail. Wenig Kundenwissen → allgemeiner, aber " +
              "trotzdem persönlich formuliert (z. B. an bisherige Käufe " +
              "anknüpfend). Keine Preise, keine Links, keine erfundenen Fakten."
          ),
      })
    )
    .describe(
      kind === "set"
        ? "Für JEDES Produkt des Sets genau EIN Eintrag mit einer persönlichen " +
            "Kurzbeschreibung — name EXAKT wie in der Set-Liste, ohne die Anzahl."
        : "Für JEDES empfohlene Produkt genau EIN Eintrag mit einer persönlichen " +
            "Kurzbeschreibung."
    );
}

function draftWithHighlightsSchema(textMode: EmailTextMode, kind: OfferKind = "items") {
  return draftSchema.extend({
    productHighlights: productHighlightsField(textMode, kind),
  });
}

/** One personalised per-product description, stored on the draft row and
 * rendered in the product-rows layout (email-products.renderEmailProductRows). */
export interface ProductHighlight {
  name: string;
  description: string;
}

export interface MarketingDraft {
  subject: string;
  body: string;
  /** Per-product personalised descriptions. Empty for fallback drafts — the
   * renderer then falls back to the catalog shortDescription. */
  productHighlights: ProductHighlight[];
}

/** Trim + drop unusable entries; never trust model output blindly. */
function sanitizeHighlights(
  raw: Array<{ name?: unknown; description?: unknown }> | undefined | null
): ProductHighlight[] {
  if (!Array.isArray(raw)) return [];
  const out: ProductHighlight[] = [];
  for (const h of raw) {
    const name = typeof h?.name === "string" ? h.name.trim() : "";
    const description = typeof h?.description === "string" ? h.description.trim() : "";
    if (name && description) out.push({ name, description });
  }
  return out;
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
   * What the code applies to (discount-scope.mjs; campaign channel only —
   * marketing codes always apply to the whole order). Omitted = "all". "set"
   * is history (offer-mode.mjs: a set mail carries no code) — the type keeps
   * it only because stored drafts may still read back so.
   */
  discountScope?: "all" | "recommendations" | "set" | null;
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

/**
 * The set a SET mail offers (offer-mode.mjs: a mail is a set offer OR single
 * items). The prose introduces it; the deterministic offer block (pictures,
 * contents, price, the genuine „statt“ reference, CTA — bundle-email.ts) is
 * appended at send time, so the model never states a price itself.
 */
export interface DraftSetOffer {
  title: string;
  /** The set's components as snapshotted: display title + count. */
  components: Array<{ title: string; quantity: number }>;
  /** True when the set price is below the component sum (a real saving). */
  hasSaving: boolean;
}

export interface GenerateDraftInput extends DraftDiscountInput {
  personaLabel: string | null;
  products: Array<{ name: string }>;
  transcript: TranscriptMessage[];
  /** Prose length for the generated text. Omitted = 'detailed' (the classic
   * long-form behaviour, so callers without a mode picker stay unchanged). */
  textMode?: EmailTextMode;
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
  return { subject, body: lines.join("\n"), productHighlights: [] };
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
  const textMode = input.textMode ?? LEGACY_EMAIL_TEXT_MODE;

  try {
    const { object, usage } = await generateObject({
      model: anthropic(DRAFT_MODEL),
      providerOptions: anthropicOptionsFor("writer"),
      schema: draftWithHighlightsSchema(textMode),
      system:
        "Du bist Mo, ein persönlicher, sympathischer Berater bei motion sports " +
        "(Fitness- und Kraftsportgeräte). Du schreibst eine warme, " +
        "persönliche Marketing-E-Mail auf Deutsch in der Du-Form an einen Kunden, " +
        "mit dem du im Chat gesprochen hast. Beziehe dich konkret auf das Gespräch " +
        "und empfiehl die besprochenen Produkte. Sei ehrlich, kein Marktschreier, " +
        "keine erfundenen Produkte, keine erfundenen Preise. Wenn dir ein " +
        "persönliches Rabattangebot vorgegeben wird, webe es klar, warm und " +
        "einladend in den Text ein (mit dem exakten Code) — als persönliches " +
        "Angebot für genau diesen Kunden, nicht als Massen-Promo. Unterschreibe mit " +
        "'Mo, dein persönlicher Berater bei motion sports'. Baue KEINEN " +
        "Warenkorb-Link und KEINEN Abmeldelink ein — die werden separat angehängt.\n\n" +
        `Die empfohlenen Produkte erscheinen unterhalb deines Textes AUTOMATISCH ` +
        `als Bildkacheln mit Produktfoto, Name und Preis.\n${textModeBodyRule(textMode)}`,
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
    return { subject, body, productHighlights: sanitizeHighlights(object.productHighlights) };
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
   * What this mail offers (offer-mode.mjs), derived by the caller from whether
   * an active set is attached: "set" = the attached set IS the offer (no
   * product recommendations, no code — the route passes depth 0); "items" =
   * the recommendations, optionally with a code.
   */
  offerKind: OfferKind;
  /**
   * The set of a set mail (offerKind "set"). The actual offer block (products,
   * price, "statt", CTA) is appended deterministically at send time — the
   * prose introduces the set. Null = no set attached.
   */
  attachedBundle?: DraftSetOffer | null;
  /** Prose length for the generated text (operator-selected in the admin UI).
   * Omitted = 'detailed' (the classic long-form behaviour). */
  textMode?: EmailTextMode;
}

/** The prompt variant of a per-customer draft (draft-offer.mjs): a set mail
 * presents the set and drops the products + code; an item mail is unchanged. */
function customerDraftPlan(input: GenerateCustomerDraftInput) {
  return draftPromptPlan({
    offerKind: input.offerKind,
    setComponents: input.attachedBundle?.components ?? [],
    recommendationNames: input.products.map((p) => p.name),
    discountCode: input.discountCode,
    discountPercent: input.discountPercent,
  });
}

function draftSessionBlock(s: CustomerDraftSession, index: number, total: number): string {
  const transcript = readableTranscript(s.transcript);
  const clipped =
    transcript.length > MAX_TRANSCRIPT_CHARS_PER_SESSION
      ? transcript.slice(0, MAX_TRANSCRIPT_CHARS_PER_SESSION) + "\n[… gekürzt]"
      : transcript;
  const date = formatStoreDate(s.createdAt, "de-DE", "Datum unbekannt");
  return (
    `### Gespräch ${index + 1} von ${total} — ${date}` +
    `${s.personaLabel ? ` · Persona: ${s.personaLabel}` : ""}\n` +
    (clipped || "(kein lesbares Transkript)")
  );
}

function ownedItemsBlock(input: {
  purchasesKnown: boolean;
  ownedItems: Array<{ title: string | null; quantity: number }>;
}): string {
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
  const plan = customerDraftPlan(input);
  const first = input.products[0]?.name;
  const subject =
    plan.kind === "set"
      ? "Dein persönliches Set von motion sports"
      : first
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
  if (plan.kind === "set") {
    // A set mail: the set is the offer — its contents, no product list, no code.
    lines.push(
      "",
      several
        ? "Passend zu unseren Gesprächen habe ich dir ein persönliches Set zusammengestellt:"
        : "Passend zu unserem Gespräch habe ich dir ein persönliches Set zusammengestellt:",
      ...plan.setLines.map((l) => `- ${l}`),
      "",
      "Alle Details und deinen Set-Preis findest du gleich unten."
    );
  } else {
    if (input.products.length > 0) {
      lines.push(
        "",
        several
          ? "Basierend auf unseren Gesprächen passt aus meiner Sicht besonders gut:"
          : "Basierend auf unserem Gespräch passt aus meiner Sicht besonders gut:",
        productLine(input.products)
      );
    }
    const discountParagraph = fallbackDiscountParagraph({
      ...input,
      discountCode: plan.discountCode,
      discountPercent: plan.discountPercent,
    });
    if (discountParagraph) lines.push("", discountParagraph);
  }
  lines.push(
    "",
    "Melde dich jederzeit, wenn du Fragen hast — ich helfe dir gern persönlich weiter.",
    "",
    "Herzliche Grüße",
    "Mo, dein persönlicher Berater bei motion sports"
  );
  return { subject, body: lines.join("\n"), productHighlights: [] };
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

  const textMode = input.textMode ?? LEGACY_EMAIL_TEXT_MODE;
  // Set XOR items (offer-mode.mjs): which blocks and rules this mail gets.
  const plan = customerDraftPlan(input);
  const isSet = plan.kind === "set";
  const offerInput: DraftDiscountInput = {
    ...input,
    discountCode: plan.discountCode,
    discountPercent: plan.discountPercent,
  };

  try {
    const { object, usage } = await generateObject({
      model: anthropic(DRAFT_MODEL),
      providerOptions: anthropicOptionsFor("writer"),
      schema: draftWithHighlightsSchema(textMode, plan.kind),
      system:
        "Du bist Mo, ein persönlicher, sympathischer Berater bei motion sports " +
        "(Fitness- und Kraftsportgeräte). Du schreibst eine warme, " +
        "persönliche Marketing-E-Mail auf Deutsch in der Du-Form an einen " +
        "Stammkunden, den du aus einem oder mehreren Chat-Gesprächen kennst. " +
        "Du bekommst ALLES, was wir über diesen Kunden wissen: alle bisherigen " +
        "Gespräche, die bisherige E-Mail-Korrespondenz, ein verdichtetes " +
        "Kundenverständnis und die Kaufhistorie.\n\n" +
        "Regeln:\n" +
        (isSet
          ? "- Diese Mail handelt von EINEM persönlichen Set: Stelle es als DAS " +
            "Angebot vor (nicht als Zusatz) und begründe aus dem Kundenwissen, " +
            "warum genau diese Zusammenstellung passt. Unterhalb deines Textes " +
            "erscheint AUTOMATISCH der Angebotsblock des Sets mit Bildern, " +
            "Inhalt, Set-Preis und Button.\n"
          : "- Die empfohlenen Produkte erscheinen unterhalb deines Textes " +
            "AUTOMATISCH als Bildkacheln mit Produktfoto, Name und Preis.\n") +
        `- ${textModeBodyRule(textMode)}\n` +
        "- Beziehe dich konkret auf die Gespräche UND, falls vorhanden, auf die " +
        "bisherige E-Mail-Korrespondenz (z. B. auf eine offene Frage aus einer " +
        "Antwort); bei Widersprüchen zwischen älteren und neueren Aussagen gilt " +
        "die neuere.\n" +
        "- Produkte, die der Kunde laut Kaufhistorie BEREITS BESITZT, empfiehlst " +
        "du NICHT noch einmal. Knüpfe stattdessen daran an: empfiehl Ergänzendes " +
        "oder den sinnvollen nächsten Schritt, und freu dich ehrlich über den Kauf, " +
        "wenn es passt.\n" +
        (isSet
          ? "- Empfiehl KEINE weiteren Produkte neben dem Set — sei ehrlich, kein " +
            "Marktschreier, keine erfundenen Produkte, keine erfundenen Preise.\n"
          : "- Empfiehl NUR die vorgegebenen Produkte — sei ehrlich, kein Marktschreier, " +
            "keine erfundenen Produkte, keine erfundenen Preise.\n") +
        "- Hinweise vom motion-sports-Team (wenn vorhanden) arbeitest du natürlich " +
        "in den Text ein — als deine eigenen Worte, nie als zitierte Anweisung.\n" +
        (isSet
          ? "- Es gibt KEINEN Rabattcode und keinen Prozent-Rabatt: Der Set-Preis ist " +
            "das Angebot. Nenne selbst KEINEN Preis, KEINE Ersparnis und KEINE " +
            "Prozentzahl und baue KEINEN Link ein — Preis, Vergleich und Button " +
            "stehen im Angebotsblock.\n"
          : "- Wenn dir ein persönliches Rabattangebot vorgegeben wird, webe es klar, " +
            "warm und einladend in den Text ein (mit dem exakten Code) — als " +
            "persönliches Angebot für genau diesen Kunden, nicht als Massen-Promo.\n") +
        "- Unterschreibe mit 'Mo, dein persönlicher Berater bei motion sports'. " +
        "Baue KEINEN Warenkorb-Link und KEINEN Abmeldelink ein — die werden " +
        "separat angehängt.",
      prompt:
        `## Aktuelles Kundenverständnis (verdichtet)\n` +
        `${input.profileSummary?.trim() || "(noch kein Profil generiert)"}\n\n` +
        `## Bereits gekauft (NICHT erneut empfehlen)\n${ownedItemsBlock(input)}\n\n` +
        (isSet
          ? setOfferSection({
              title: input.attachedBundle?.title ?? "Dein persönliches Set",
              lines: plan.setLines,
              hasSaving: input.attachedBundle?.hasSaving === true,
            })
          : `## Produkte, die diese E-Mail empfehlen soll\n${productLine(input.products)}\n\n`) +
        `${isSet ? noDiscountHint("set") : discountHint(offerInput)}\n\n` +
        highlightNamesSection(plan.highlightNames, plan.kind) +
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
    return {
      subject,
      body,
      productHighlights: alignHighlightNames(
        sanitizeHighlights(object.productHighlights),
        plan.highlightNames
      ),
    };
  } catch (err) {
    reportError(err, { route: "lib/marketing-draft", phase: "generateCustomer" });
    return fallbackCustomerDraft(input);
  }
}

// ---------------------------------------------------------------------------
// Per-CUSTOMER PHYSICAL LETTER draft — a SEPARATE generation from the email
// (docs/archive/EMAIL_SUBSYSTEM_SPIKE.md §4). A printed letter has NO clickable cart
// button, NO tracked link and NO email-unsubscribe footer, so the prose is
// written for paper: a proper salutation (by name when we have it), warm
// advisory body grounded in the conversations/correspondence, a gentle pointer
// to the online shop named in plain text, and a handwritten-style sign-off. The
// discount/cart machinery of the email path deliberately does NOT apply here.
// ---------------------------------------------------------------------------

export interface GenerateCustomerLetterInput {
  /** Recipient name from the postal address, for the salutation ("Hallo …"). */
  recipientName?: string | null;
  /** ALL linked conversations, chronological (oldest first). */
  sessions: CustomerDraftSession[];
  /** The cached "current understanding" profile summary, if generated. */
  profileSummary: string | null;
  /** Pre-rendered email correspondence (body text only), or null. */
  correspondence?: string | null;
  /** What the customer already OWNS — never re-recommended. */
  ownedItems: Array<{ title: string | null; quantity: number }>;
  /** False when no purchase history was loaded (owned items UNKNOWN, not "none"). */
  purchasesKnown: boolean;
  /** The products the letter recommends (owned items already excluded). */
  products: Array<{ name: string }>;
  /** Operator guidance, woven in naturally (NOT customer data). */
  adminInstructions: string | null;
  /** The online shop named in plain text (no clickable link on paper). */
  shopUrl?: string | null;
}

function salutation(name: string | null | undefined): string {
  const n = (name ?? "").trim();
  // Use the first token as a friendly first-name salutation when present.
  const first = n ? n.split(/\s+/)[0] : "";
  return first ? `Hallo ${first},` : "Hallo,";
}

/** Clean templated fallback letter when the model is unavailable. */
function fallbackLetterDraft(input: GenerateCustomerLetterInput): MarketingDraft {
  const first = input.products[0]?.name;
  const subject = first
    ? `Deine persönliche Empfehlung: ${first}`
    : "Deine persönliche Empfehlung von motion sports";
  const lines: string[] = [
    salutation(input.recipientName),
    "",
    "hier ist Mo von motion sports. Schön, dass wir uns zu deinem Trainingsvorhaben " +
      "austauschen konnten — ich melde mich heute ganz bewusst per Post bei dir.",
  ];
  if (input.products.length > 0) {
    lines.push(
      "",
      "Aus unseren Gesprächen passt aus meiner Sicht besonders gut:",
      productLine(input.products)
    );
  }
  if (input.shopUrl) {
    lines.push(
      "",
      `Mehr dazu findest du jederzeit in unserem Shop unter ${input.shopUrl}.`
    );
  }
  lines.push(
    "",
    "Melde dich gern, wenn ich dich persönlich beraten kann.",
    "",
    "Herzliche Grüße",
    "Mo, dein persönlicher Berater bei motion sports"
  );
  return { subject, body: lines.join("\n"), productHighlights: [] };
}

/**
 * Generate the per-customer PHYSICAL LETTER draft from the same customer context
 * as the email draft, but written for print. Never throws — on any error returns
 * the templated fallback so the workflow continues (the operator reviews/edits
 * every letter before sending anyway).
 */
export async function generateCustomerLetterDraft(
  input: GenerateCustomerLetterInput
): Promise<MarketingDraft> {
  if (!process.env.ANTHROPIC_API_KEY) return fallbackLetterDraft(input);

  const kept = input.sessions.slice(-MAX_SESSIONS_IN_DRAFT_PROMPT);
  const sessionBlocks = kept.map((s, i) => draftSessionBlock(s, i, kept.length)).join("\n\n");
  const correspondence = input.correspondence?.trim() || "";
  const instructions = input.adminInstructions?.trim() || null;
  const adminBlock = instructions
    ? `## Hinweise vom motion-sports-Team (NICHT vom Kunden)\n` +
      `Arbeite die folgenden Punkte natürlich in den Brief ein. Zitiere sie nicht ` +
      `wörtlich und erwähne nicht, dass es interne Hinweise sind:\n${instructions}\n\n`
    : "";
  const shopLine = input.shopUrl
    ? `Du darfst freundlich auf unseren Online-Shop „${input.shopUrl}" als Anlaufstelle ` +
      `verweisen (als reinen Text, es ist ein gedruckter Brief — kein anklickbarer Link).`
    : `Erwähne KEINE konkrete URL.`;

  try {
    const { object, usage } = await generateObject({
      model: anthropic(DRAFT_MODEL),
      providerOptions: anthropicOptionsFor("writer"),
      schema: draftSchema,
      system:
        "Du bist Mo, ein persönlicher, sympathischer Berater bei motion sports " +
        "(Fitness- und Kraftsportgeräte). Du schreibst einen kurzen, warmen, " +
        "persönlichen BRIEF auf PAPIER (kein E-Mail) auf Deutsch in der Du-Form an " +
        "einen Kunden, den du aus Chat-Gesprächen kennst.\n\n" +
        "Regeln für den Brief:\n" +
        "- Beginne mit einer passenden Anrede (z. B. „Hallo <Vorname>,“ wenn ein " +
        "Name vorgegeben ist, sonst „Hallo,“).\n" +
        "- Beziehe dich konkret auf die Gespräche und, falls vorhanden, die bisherige " +
        "E-Mail-Korrespondenz; bei Widersprüchen gilt das Neuere.\n" +
        "- Produkte, die der Kunde laut Kaufhistorie BEREITS BESITZT, empfiehlst du " +
        "NICHT erneut — knüpfe daran an (sinnvolle Ergänzung / nächster Schritt).\n" +
        "- Empfiehl NUR die vorgegebenen Produkte; sei ehrlich, kein Marktschreier, " +
        "keine erfundenen Produkte oder Preise.\n" +
        "- Es ist ein gedruckter Brief: KEINE anklickbaren Buttons, KEINE URL-Links " +
        "als Knöpfe, KEIN Warenkorb-Button, KEIN Abmeldelink, KEIN Rabattcode-Block. " +
        "Wenn ein Shop genannt werden soll, nenne ihn als reinen Text.\n" +
        "- Hinweise vom Team (falls vorhanden) arbeitest du natürlich ein — als deine " +
        "eigenen Worte, nie als zitierte Anweisung.\n" +
        "- Schließe mit einer herzlichen Grußformel und der Unterschrift " +
        "'Mo, dein persönlicher Berater bei motion sports'.\n" +
        "Der Betreff ist eine kurze Briefbetreffzeile (z. B. „Deine persönliche Empfehlung“).",
      prompt:
        `## Empfänger\n${input.recipientName?.trim() || "(Name unbekannt)"}\n\n` +
        `## Aktuelles Kundenverständnis (verdichtet)\n` +
        `${input.profileSummary?.trim() || "(noch kein Profil generiert)"}\n\n` +
        `## Bereits gekauft (NICHT erneut empfehlen)\n${ownedItemsBlock(input)}\n\n` +
        `## Produkte, die dieser Brief empfehlen soll\n${productLine(input.products)}\n\n` +
        `## Shop-Hinweis\n${shopLine}\n\n` +
        adminBlock +
        `## Bisherige Gespräche (chronologisch, älteste zuerst)\n\n` +
        `${sessionBlocks || "(keine Gespräche verknüpft)"}\n\n` +
        `## Bisherige E-Mail-Korrespondenz (chronologisch, älteste zuerst)\n\n` +
        `${correspondence || "(keine E-Mail-Korrespondenz)"}\n\n` +
        `Schreibe jetzt den personalisierten Brief (Betreff + Brieftext).`,
    });
    await recordAiUsage({
      callSite: "marketing_draft",
      model: DRAFT_MODEL,
      inputTokens: usage?.inputTokens ?? 0,
      outputTokens: usage?.outputTokens ?? 0,
    });
    const subject = object.subject?.trim();
    const body = object.body?.trim();
    if (!subject || !body) return fallbackLetterDraft(input);
    return { subject, body, productHighlights: [] };
  } catch (err) {
    reportError(err, { route: "lib/marketing-draft", phase: "generateLetter" });
    return fallbackLetterDraft(input);
  }
}
