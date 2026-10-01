// AI help in the Kampagnen wizard (writer tier): turn a plain-German audience
// description into a validated audience spec, and draft a campaign briefing.
// The model only PROPOSES — every spec goes through normalizeAudienceSpec and
// the operator sees the German description and the live count before saving.
// docs/CAMPAIGNS.md §2.2.

import { generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import { anthropicOptionsFor, modelFor } from "./ai-models.mjs";
import { normalizeAudienceSpec, AUDIENCE_SPEC_FIELDS } from "./audience-spec.mjs";
import { ARCHETYPE_META } from "./persona";
import { recordAiUsage } from "./ai-usage-store";
import { reportError } from "./observability";

const MODEL = modelFor("writer");

const rangeSchema = z.object({ min: z.number().nullable(), max: z.number().nullable() }).nullable();

const specSchema = z.object({
  optInLevels: z.array(z.string()).nullable(),
  lifecycle: z.array(z.string()).nullable(),
  valueTier: z.array(z.string()).nullable(),
  churn: z.array(z.string()).nullable(),
  lastOrderDays: rangeSchema,
  ordersCount: rangeSchema,
  totalSpentEur: rangeSchema,
  boughtAny: z.array(z.string()).nullable(),
  boughtNone: z.array(z.string()).nullable(),
  categories: z.array(z.string()).nullable(),
  persona: z.array(z.string()).nullable(),
  moContact: z.enum(["yes", "no"]).nullable(),
  language: z.array(z.string()).nullable(),
  country: z.array(z.string()).nullable(),
  clickedWithinDays: z.number().nullable(),
  excludeMailedWithinDays: z.number().nullable(),
  explanation: z.string(),
});

function dropNulls(o: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (v == null) continue;
    if (typeof v === "object" && !Array.isArray(v)) {
      const inner = dropNulls(v as Record<string, unknown>);
      if (Object.keys(inner).length > 0) out[k] = inner;
    } else out[k] = v;
  }
  return out;
}

export type AudienceSuggestion =
  | { ok: true; spec: ReturnType<typeof normalizeAudienceSpec>; explanation: string }
  | { ok: false; message: string };

/** "Zielgruppe beschreiben": German text → audience spec. Never throws. */
export async function suggestAudienceSpec(
  description: string,
  context: { categories: string[] }
): Promise<AudienceSuggestion> {
  const text = description.trim().slice(0, 1000);
  if (text.length < 5) return { ok: false, message: "Bitte die Zielgruppe in ein paar Worten beschreiben." };
  if (!process.env.ANTHROPIC_API_KEY) return { ok: false, message: "Kein KI-Schlüssel konfiguriert." };
  try {
    const personas = Object.values(ARCHETYPE_META).map((m) => `${m.id} (${m.label})`);
    const { object, usage } = await generateObject({
      model: anthropic(MODEL),
      providerOptions: anthropicOptionsFor("writer"),
      schema: specSchema,
      system:
        "Du übersetzt die Beschreibung einer Kampagnen-Zielgruppe eines Fitnessgeräte-Shops " +
        "in Filterfelder. Setze nur Felder, die die Beschreibung wirklich verlangt; alles " +
        "andere ist null. Erfinde keine Produkt-Handles. Die Einwilligung in E-Mail-Werbung " +
        "wird immer automatisch verlangt — dafür brauchst du kein Feld.\n\n" +
        `Erlaubte Werte:\n- optInLevels: ${AUDIENCE_SPEC_FIELDS.optInLevels.join(", ")}\n` +
        `- lifecycle (Tage seit letztem Kauf: frisch <7, ausbauen_frueh 7–30, ausbauen 31–90, ` +
        `weiterentwickeln 91–365, zurueckholen 366–730, ruhen >730, unbekannt = kein Kauf): ` +
        `${AUDIENCE_SPEC_FIELDS.lifecycle.join(", ")}\n` +
        `- valueTier (teuerster Einzelartikel, der je gekauft wurde: klein <150 €, komponente 150–1499 €, grossgeraet ≥1500 €): ` +
        `${AUDIENCE_SPEC_FIELDS.valueTier.join(", ")}\n` +
        `- churn: ${AUDIENCE_SPEC_FIELDS.churn.join(", ")}\n` +
        `- language: ${AUDIENCE_SPEC_FIELDS.language.join(", ")}\n` +
        `- persona: ${personas.join(", ")}, unknown\n` +
        `- categories: ${context.categories.slice(0, 60).join(", ") || "(keine bekannt)"}\n` +
        "- moContact: yes = hat mit dem Chat-Berater Mo gesprochen, no = nie\n" +
        "- lastOrderDays / ordersCount / totalSpentEur: {min, max}, Zahlen\n" +
        "- country: ISO-Ländercodes (DE, AT, CH, …)\n" +
        "explanation: ein deutscher Satz, wie du die Beschreibung gelesen hast.",
      prompt: `Beschreibung der Zielgruppe:\n${text}`,
    });
    await recordAiUsage({
      callSite: "campaign_assist",
      model: MODEL,
      inputTokens: usage?.inputTokens ?? 0,
      outputTokens: usage?.outputTokens ?? 0,
    });
    const { explanation, ...rest } = object;
    return { ok: true, spec: normalizeAudienceSpec(dropNulls(rest)), explanation };
  } catch (err) {
    reportError(err, { route: "lib/campaign-assist", phase: "suggestAudienceSpec" });
    return { ok: false, message: "Die KI konnte die Beschreibung gerade nicht übersetzen." };
  }
}

/** A briefing draft from the name, kind and a few notes. Never throws. */
export async function suggestCampaignBrief(input: {
  name: string;
  kind: "laufend" | "aktion";
  notes: string;
  endsLabel: string | null;
  discountPercent: number;
}): Promise<{ ok: true; brief: string } | { ok: false; message: string }> {
  if (!process.env.ANTHROPIC_API_KEY) return { ok: false, message: "Kein KI-Schlüssel konfiguriert." };
  try {
    const { object, usage } = await generateObject({
      model: anthropic(MODEL),
      providerOptions: anthropicOptionsFor("writer"),
      schema: z.object({ brief: z.string() }),
      system:
        "Du schreibst das Briefing für eine E-Mail-Kampagne eines Fitnessgeräte-Shops " +
        "(motion sports). Das Briefing liest später der KI-Texter, der jede Mail einzeln " +
        "personalisiert. Gliedere in: Anlass, Ziel, Ton, Muss rein, Bitte nicht. " +
        "Kurz, konkret, deutsch, höchstens 900 Zeichen. Keine erfundenen Rabatte oder Fristen — " +
        "nur die vorgegebenen.",
      prompt:
        `Kampagne: ${input.name} (${input.kind === "aktion" ? "Aktion" : "laufend"})\n` +
        (input.endsLabel ? `Endet: ${input.endsLabel}\n` : "") +
        (input.discountPercent > 0 ? `Rabatt: ${input.discountPercent} %\n` : "Kein Rabatt\n") +
        `Notizen des Teams: ${input.notes.trim().slice(0, 1500) || "(keine)"}`,
    });
    await recordAiUsage({
      callSite: "campaign_assist",
      model: MODEL,
      inputTokens: usage?.inputTokens ?? 0,
      outputTokens: usage?.outputTokens ?? 0,
    });
    return { ok: true, brief: object.brief.trim().slice(0, 4000) };
  } catch (err) {
    reportError(err, { route: "lib/campaign-assist", phase: "suggestCampaignBrief" });
    return { ok: false, message: "Die KI konnte gerade kein Briefing vorschlagen." };
  }
}
