// The AI draft of one campaign LETTER (0074, docs/CAMPAIGNS.md §8) — written
// for paper, in German, from the same inputs as a campaign mail: the
// campaign's occasion and briefing, the ledger purchases, the lifecycle
// segment, recommended product NAMES and the AI profile (unless the person
// objected to profiling). The model never sees an address — only the first
// name. No discount code on paper (phase 1), no links, no buttons; the
// objection notice and the company footer are deterministic in the PDF
// (letter-pdf.mjs), never in this text. A person reviews and releases every
// letter. Writer tier, ai_usage call site `campaign_letter`.

import { generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import { anthropicOptionsFor, modelFor } from "./ai-models.mjs";
import { recordAiUsage } from "./ai-usage-store";
import { reportError } from "./observability";
import { formatAdmin, ADMIN_DATE } from "./admin-datetime.mjs";
import { campaignSection, profileSection, purchaseBlock, segmentIntroRule } from "./campaign-draft";
import { loadCampaignPersonalization } from "./campaign-recommendations";
import { loadPurchaseHistory } from "./customer-orders-store";
import { getCustomerById } from "./customer-store";
import { getCampaign } from "./campaigns-store";
import { getCampaignLetter, saveCampaignLetterText } from "./campaign-letters-store";
import { ARCHETYPE_META } from "./persona";
import type { PersonaArchetype } from "./types";
import type { CampaignPurchaseSummary } from "./campaign-store";

const MODEL = modelFor("writer");

const letterSchema = z.object({
  subject: z.string().describe("Kurze Betreffzeile des Briefs auf Deutsch (max. ~60 Zeichen)."),
  body: z
    .string()
    .describe(
      "Der Brieftext auf Deutsch in der Du-Form: Anrede, 2–4 kurze Absätze, Grußformel und die Unterschrift " +
        "'Mo, dein persönlicher Berater bei motion sports'. KEINE Links, KEINE Buttons, KEIN Rabattcode, " +
        "KEIN Abmelde- oder Widerspruchshinweis (der steht fest im Fuß des Briefs)."
    ),
});

export interface CampaignLetterDraftInput {
  firstName: string | null;
  campaign: { name: string; kind: "laufend" | "aktion" | "einzel"; brief: string | null; endsLabel: string | null };
  adminNote: string | null;
  purchaseSummary: CampaignPurchaseSummary | null;
  segment: { key: string | null; days: number | null } | null;
  recommendationStrategy: string | null;
  productNames: string[];
  customerProfile: { summary: string; data: unknown; personaDisplay: string | null } | null;
  shopUrl: string | null;
}

function salutation(firstName: string | null): string {
  const n = (firstName ?? "").trim().split(/\s+/)[0];
  return n ? `Hallo ${n},` : "Hallo,";
}

function fallbackLetter(input: CampaignLetterDraftInput): { subject: string; body: string } {
  const lines = [
    salutation(input.firstName),
    "",
    `hier ist Mo von motion sports. Ich schreibe dir heute ganz bewusst per Post${
      input.campaign.kind === "aktion" ? ` — zu unserer Aktion „${input.campaign.name}“` : ""
    }.`,
  ];
  if (input.productNames.length > 0) {
    lines.push("", `Passend zu deinen bisherigen Käufen könnte dich besonders interessieren: ${input.productNames.join(", ")}.`);
  }
  if (input.shopUrl) lines.push("", `Alles dazu findest du in unserem Shop unter ${input.shopUrl}.`);
  lines.push("", "Herzliche Grüße", "Mo, dein persönlicher Berater bei motion sports");
  return { subject: input.campaign.kind === "aktion" ? input.campaign.name : "Post von motion sports", body: lines.join("\n") };
}

/** Never throws — the templated fallback keeps the run going (a person reviews every letter). */
export async function generateCampaignLetterDraft(
  input: CampaignLetterDraftInput
): Promise<{ subject: string; body: string }> {
  if (!process.env.ANTHROPIC_API_KEY) return fallbackLetter(input);
  const shopLine = input.shopUrl
    ? `Du darfst auf unseren Online-Shop „${input.shopUrl}“ verweisen — als reinen Text, es ist ein gedruckter Brief.`
    : "Nenne KEINE konkrete URL.";
  try {
    const { object, usage } = await generateObject({
      model: anthropic(MODEL),
      providerOptions: anthropicOptionsFor("writer"),
      schema: letterSchema,
      system:
        "Du bist Mo, ein persönlicher, sympathischer Berater bei motion sports (Fitness- und Kraftsportgeräte). " +
        "Du schreibst einen kurzen, warmen Werbebrief auf PAPIER an eine:n Bestandskund:in, auf Deutsch in der Du-Form.\n\n" +
        "Regeln:\n" +
        "- Anrede „Hallo <Vorname>,“ wenn ein Vorname vorgegeben ist, sonst „Hallo,“.\n" +
        "- Knüpfe an die bisherigen Käufe an (sinnvolle Ergänzung, nächster Schritt) — Gekauftes nicht erneut empfehlen.\n" +
        "- Empfiehl höchstens die vorgegebenen Produkte, nur mit Namen; keine Preise, keine erfundenen Produkte.\n" +
        "- Es ist ein gedruckter Brief: KEINE Links als Knöpfe, KEIN Warenkorb, KEIN Rabattcode, KEINE Prozentangaben, " +
        "KEIN Abmelde- oder Widerspruchshinweis (der steht fest im Fuß).\n" +
        "- Keine Dringlichkeit erfinden; ein echtes Enddatum der Aktion darfst du sachlich nennen.\n" +
        "- Sag nie, woher du etwas weißt, und zitiere keine Gespräche.\n" +
        "- Höchstens etwa 1.500 Zeichen, damit der Brief auf eine Seite passt.\n" +
        "- Schließe mit „Herzliche Grüße“ und der Unterschrift 'Mo, dein persönlicher Berater bei motion sports'.",
      prompt:
        `## Vorname\n${input.firstName?.trim() || "(unbekannt)"}\n\n` +
        campaignSection(input.campaign, input.adminNote) +
        profileSection(input.customerProfile as never) +
        `## Bisherige Käufe\n${purchaseBlock(input.purchaseSummary, "de")}\n\n` +
        `## Zeitlicher Bezug\n${segmentIntroRule(input.segment?.key, input.segment?.days, input.recommendationStrategy)}\n\n` +
        `## Produkte, die der Brief empfehlen darf\n${
          input.productNames.length > 0 ? input.productNames.map((n) => `- ${n}`).join("\n") : "(keine — dann ohne konkrete Empfehlung)"
        }\n\n` +
        `## Shop\n${shopLine}\n\n` +
        "Schreibe jetzt Betreff und Brieftext.",
    });
    await recordAiUsage({
      callSite: "campaign_letter",
      model: MODEL,
      inputTokens: usage?.inputTokens ?? 0,
      outputTokens: usage?.outputTokens ?? 0,
    });
    const subject = object.subject?.trim();
    const body = object.body?.trim();
    return subject && body ? { subject, body } : fallbackLetter(input);
  } catch (err) {
    reportError(err, { route: "lib/campaign-letter-draft", phase: "generate" });
    return fallbackLetter(input);
  }
}

/** The shop named on paper (CAMPAIGN_LETTER_SHOP_URL, else the first allowed origin's host). */
function shopUrlForLetters(): string | null {
  const explicit = process.env.CAMPAIGN_LETTER_SHOP_URL?.trim();
  if (explicit) return explicit;
  const origin = (process.env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).find(Boolean);
  try {
    return origin ? new URL(origin).host : "www.motionsports.de";
  } catch {
    return "www.motionsports.de";
  }
}

/**
 * Write and store the draft of one letter (pending or redraft). Returns false
 * when the letter is gone, already sent, or its person objected. Never throws.
 */
export async function draftCampaignLetter(letterId: number): Promise<boolean> {
  try {
    const letter = await getCampaignLetter(letterId);
    if (!letter || !["pending", "drafted", "failed"].includes(letter.status)) return false;
    if (letter.postalObjectionAt) return false;
    const [customer, campaign] = await Promise.all([getCustomerById(letter.customerId), getCampaign(letter.campaignId)]);
    if (!customer || !campaign) return false;
    const profile = customer.profileObjectionAt ? null : customer;
    const preloaded = await loadPurchaseHistory(customer);
    const { purchaseSummary, recommendations, segment } = await loadCampaignPersonalization(
      customer.email,
      null,
      null,
      profile?.profileData ?? null,
      preloaded ?? undefined
    );
    const draft = await generateCampaignLetterDraft({
      firstName: customer.firstName,
      campaign: {
        name: campaign.name,
        kind: campaign.kind,
        brief: campaign.brief,
        endsLabel: campaign.endsAt ? formatAdmin(campaign.endsAt, ADMIN_DATE) : null,
      },
      adminNote: letter.adminNote,
      purchaseSummary,
      segment: { key: segment.key, days: segment.days },
      recommendationStrategy: recommendations.strategy,
      productNames: recommendations.products.map((p) => p.name).slice(0, 3),
      customerProfile: profile?.profileSummary
        ? {
            summary: profile.profileSummary,
            data: profile.profileData,
            personaDisplay:
              (profile.personaLabel && ARCHETYPE_META[profile.personaLabel as PersonaArchetype]?.label) || null,
          }
        : null,
      shopUrl: shopUrlForLetters(),
    });
    return saveCampaignLetterText(letterId, { ...draft, edited: false });
  } catch (err) {
    reportError(err, { route: "lib/campaign-letter-draft", phase: "draft" });
    return false;
  }
}
