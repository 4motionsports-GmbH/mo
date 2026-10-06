// Structured-output schemas of the Verbesserung's strategist passes
// (improvement-decision.mjs owns the vocabularies, normalisers and prompts).
// Zod without min/max keywords — Anthropic structured output rejects them; the
// normalisers clamp instead. Kept apart from the decision core so the admin
// client bundle never pulls in zod.

import { z } from "zod";
import { LINK_TARGETS, adminLinkFor } from "./business-snapshot-core.mjs";
import { LEVELS, MAX_DIRECTIVE_CHARS, MAX_SUGGESTIONS_PER_LANE, PASS_LANES } from "./improvement-core.mjs";
import { REVIEW_RECOMMENDATIONS } from "./improvement-decision.mjs";

const LINK_HELP = LINK_TARGETS.filter((k) => k !== "none")
  .map((k) => `${k} = ${adminLinkFor(k)?.label}`)
  .join("; ");

const level = (what) => z.enum(/** @type {[string, ...string[]]} */ ([...LEVELS])).describe(what);

export const effectReviewSchema = z.object({
  summary: z.string().describe("Gesamtbild in 3–5 Sätzen: was wirkt, was nicht, was offen ist — ohne Kausalität zu behaupten."),
  items: z
    .array(
      z.object({
        ref: z.string().describe("Die Referenz der gemessenen Änderung, z. B. D3 oder S12."),
        assessment: z.string().describe("1–2 Sätze: was die Messung zeigt und was nicht (Stichprobe, Störfaktoren, Messänderung, Ziel)."),
        recommendation: z
          .enum(/** @type {[string, ...string[]]} */ ([...REVIEW_RECOMMENDATIONS]))
          .describe("beibehalten, anpassen, zuruecknehmen oder beobachten."),
        nextStep: z.string().describe("Der konkrete nächste Schritt (ein Satz)."),
      })
    )
    .describe("Eine Einschätzung je gemessener Änderung."),
});

/**
 * The schema of one suggestion pass — `lane` restricted to the pass's lanes.
 * @param {"vorschlaege_chat" | "vorschlaege_betrieb"} pass
 */
export function suggestionsSchema(pass) {
  const lanes = /** @type {[string, ...string[]]} */ ([...PASS_LANES[pass]]);
  return z.object({
    headline: z.string().describe("Nur im zweiten Durchgang: die wichtigste Erkenntnis des Zeitraums in einem Satz, mit Zahl; sonst leer."),
    summary: z.string().describe("Nur im zweiten Durchgang: die Lage in 3–5 Sätzen; sonst leer."),
    suggestions: z
      .array(
        z.object({
          title: z.string().describe("Der Vorschlag als Imperativ, höchstens ~12 Wörter."),
          lane: z.enum(lanes).describe("Wer handelt (Bereich)."),
          why: z.string().describe("Warum — 1–3 Sätze mit den belegenden Zahlen (Basis n, Vorperiode)."),
          action: z.string().describe("Was genau zu tun ist — die konkreten ersten Schritte."),
          directive: z
            .string()
            .nullable()
            .describe(`Nur Bereich chat: fertiger Anweisungstext an Mo (≤ ${MAX_DIRECTIVE_CHARS} Zeichen); sonst null.`),
          evidence: z
            .array(
              z.object({
                metricKey: z.string().describe("Schlüssel der Kennzahl aus den Daten, z. B. journey.chatToOrder — oder leer."),
                text: z.string().describe("Der Beleg mit Zahl, Basis und Vorperiode."),
              })
            )
            .describe("1–4 Belege."),
          expectedImpact: z.string().describe("Erwartete Wirkung, möglichst beziffert, mit Annahme."),
          successMetric: z.object({
            key: z.string().describe("EIN Schlüssel aus den Daten, an dem der nächste Lauf den Erfolg misst."),
            target: z.number().nullable().describe("Zielwert in der Einheit der Kennzahl (Quote als Anteil 0–1) oder null."),
            direction: z.enum(["up", "down"]).describe("Soll die Kennzahl steigen (up) oder fallen (down)?"),
            horizonDays: z.number().describe("Nach wie vielen Tagen messbar (7–90)."),
          }),
          impact: level("Wirkung auf Umsatz, Kundenbasis oder Qualität."),
          effort: level("Aufwand der Umsetzung."),
          confidence: level("Wie belastbar die Datenlage ist (kleine Stichproben = niedrig)."),
          risk: level("Risiko (Umsatz, Recht, Reputation, Technik)."),
          riskNote: z.string().describe("Das Risiko in einem Satz, oder leer."),
          link: z
            .enum(/** @type {[string, ...string[]]} */ ([...LINK_TARGETS]))
            .describe(`Admin-Bildschirm, in dem gehandelt wird (sonst none): ${LINK_HELP}.`),
          refersTo: z.string().nullable().describe("D<id> oder S<id>, wenn der Vorschlag eine Anweisung oder einen Backlog-Eintrag konkretisiert; sonst null."),
        })
      )
      .describe(`Höchstens ${MAX_SUGGESTIONS_PER_LANE} Vorschläge, wichtigste zuerst.`),
  });
}
