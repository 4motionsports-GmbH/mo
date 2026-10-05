// „Frag Mo“ — answer an operator's question about ONE customer from that
// person's record only, with the sources cited (writer tier). The record is
// built by the pure core (lib/customer-ask-core.mjs); the AI profile is used
// unless the person objected to profiling. Nothing is stored except the AI
// usage row. docs/archive/CUSTOMER_PLATFORM_PLAN.md §9.5.

import { generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import { anthropicOptionsFor, maxOutputTokensFor, modelFor } from "./ai-models.mjs";
import { recordAiUsage } from "./ai-usage-store";
import { reportError } from "./observability";
import { loadCustomerDetail } from "./customer-detail";
import { buildAskSources, citedSources, normalizeAskQuestion, renderAskSources } from "./customer-ask-core.mjs";

const MODEL = modelFor("writer");

const schema = z.object({
  antwort: z.string(),
  quellen: z.array(z.number()),
  sicher: z.boolean(),
});

export interface AskCitation {
  n: number;
  at: string | null;
  kind: string;
  kindLabel: string;
  title: string;
}

export type AskResult =
  | { ok: true; answer: string; confident: boolean; citations: AskCitation[]; sourcesTotal: number; sourcesUsed: number }
  | { ok: false; status: number; message: string };

/** Never throws. */
export async function askAboutCustomer(customerId: number, rawQuestion: string): Promise<AskResult> {
  const q = normalizeAskQuestion(rawQuestion);
  if (!q.ok) return { ok: false, status: 400, message: q.message };
  if (!process.env.ANTHROPIC_API_KEY) return { ok: false, status: 503, message: "Kein KI-Schlüssel konfiguriert." };
  try {
    const detail = await loadCustomerDetail(customerId);
    if (!detail) return { ok: false, status: 404, message: "Kunde nicht gefunden." };

    const sources = buildAskSources(detail);
    const { text, included } = renderAskSources(sources);
    const f = detail.figures;
    const facts = f
      ? [
          `Bestellungen: ${f.ordersCount}`,
          f.lastOrderAt ? `letzter Kauf: ${f.lastOrderAt.slice(0, 10)}` : null,
          f.lifecycleSegment ? `Lebenszyklus: ${f.lifecycleSegment}` : null,
          f.valueTier ? `Wertstufe: ${f.valueTier}` : null,
          `Einwilligung E-Mail-Werbung: ${detail.consent.label}`,
        ]
          .filter(Boolean)
          .join(" · ")
      : `Einwilligung E-Mail-Werbung: ${detail.consent.label}`;
    const profile = detail.profileObjectionAt ? null : detail.profileSummary;

    const { object, usage } = await generateObject({
      model: anthropic(MODEL),
      providerOptions: anthropicOptionsFor("writer"),
      maxOutputTokens: maxOutputTokensFor("writer", 800),
      schema,
      system:
        "Du beantwortest dem Team von motion sports eine Frage zu EINER Person — ausschließlich aus deren Akte " +
        "unten. Antworte kurz und konkret auf Deutsch (1–4 Sätze). Nenne in `quellen` die Nummern [n] der " +
        "Einträge, auf die sich die Antwort stützt. Steht die Antwort nicht in der Akte, sag das offen " +
        "(„Dazu steht nichts in der Akte.“), setze `sicher` auf false und erfinde nichts. Das Kundenverständnis " +
        "ist eine Zusammenfassung, keine Quelle für Fakten wie Größen oder Daten.",
      prompt:
        `## Frage\n${q.question}\n\n` +
        `## Kennzahlen\n${facts}\n\n` +
        `## Kundenverständnis\n${profile ? profile.slice(0, 3000) : "(keins)"}\n\n` +
        `## Akte (neueste zuerst, ${included} von ${sources.length} Einträgen)\n${text || "(leer)"}`,
    });
    await recordAiUsage({
      callSite: "customer_ask",
      model: MODEL,
      inputTokens: usage?.inputTokens ?? 0,
      outputTokens: usage?.outputTokens ?? 0,
    });
    return {
      ok: true,
      answer: object.antwort.slice(0, 2000),
      confident: object.sicher,
      citations: citedSources(object.quellen, sources, included),
      sourcesTotal: sources.length,
      sourcesUsed: included,
    };
  } catch (err) {
    reportError(err, { route: "lib/customer-ask", phase: "ask" });
    return { ok: false, status: 502, message: "Die KI konnte die Frage gerade nicht beantworten." };
  }
}
