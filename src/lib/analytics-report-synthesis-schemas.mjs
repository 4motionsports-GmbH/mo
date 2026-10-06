// The structured-output schemas of the two strategist passes of the
// Komplettanalyse (analytics-report-synthesis-core.mjs owns the vocabularies,
// normalisers and prompts). Zod, without min/max keywords — Anthropic
// structured output rejects them; the normalisers clamp instead. Kept apart
// from the core so the admin client bundle (which renders the report) never
// pulls in zod.

import { z } from "zod";
import { LINK_TARGETS, adminLinkFor } from "./business-snapshot-core.mjs";
import { DIRECTIONS, EFFORTS, LEVELS, OWNERS } from "./analytics-report-synthesis-core.mjs";

const LINK_HELP = LINK_TARGETS.filter((k) => k !== "none")
  .map((k) => `${k} = ${adminLinkFor(k)?.label}`)
  .join("; ");

// ── Schemas (structured output) ───────────────────────────────────────────────

const owner = () => z.enum(OWNERS).describe("Wer handelt: operator, developer, frontend oder lawyer.");
const level = (what) => z.enum(LEVELS).describe(what);
const link = () =>
  z.enum(LINK_TARGETS).describe(`Admin-Bildschirm, in dem gehandelt wird (sonst none): ${LINK_HELP}.`);

export const decisionsSchema = z.object({
  headline: z.string().describe("Ein Satz: die wichtigste Erkenntnis des Zeitraums, mit Zahl."),
  summary: z
    .string()
    .describe("Executive Summary in 3–5 Sätzen: Lage, Umsatz durch Mo, größter Hebel, größtes Risiko — mit Zahlen und Vergleich zur Vorperiode."),
  decisions: z
    .array(
      z.object({
        title: z.string().describe("Die Entscheidung als Imperativ, max. ~12 Wörter."),
        rationale: z.string().describe("Warum jetzt — 1–3 Sätze mit den belegenden Zahlen aus den Daten."),
        owner: owner(),
        impact: level("Erwartete Wirkung auf Umsatz oder Kundenbasis."),
        confidence: level("Wie belastbar die Datenlage ist (kleine Stichproben = niedrig)."),
        metric: z.string().describe("Woran man in 2–4 Wochen sieht, ob es wirkt (Kennzahl + Zielrichtung)."),
        link: link(),
      })
    )
    .describe("Die 3–5 Entscheidungen, die jetzt zu treffen sind, wichtigste zuerst."),
  revenue: z.object({
    summary: z.string().describe("Wie der Umsatz durch Mo zustande kam (2–4 Sätze, Zahlen, Vorperiode)."),
    drivers: z
      .array(z.object({ title: z.string(), detail: z.string().describe("1–2 Sätze mit Zahlen.") }))
      .describe("Die 2–5 Treiber bzw. Bremsen des Umsatzes durch Mo."),
  }),
  bottlenecks: z
    .array(
      z.object({
        stage: z.string().describe("Funnel-Stufe, z. B. „Popup → im Chat angemeldet“."),
        finding: z.string().describe("Was dort verloren geht und warum vermutlich (1–2 Sätze)."),
        evidence: z.string().describe("Die Zahlen: Wert, Basis n, Vorperiode."),
        impact: level("Wie viel Umsatz oder Kundenbasis hier verloren geht."),
        link: link(),
      })
    )
    .describe("Die 2–5 größten Engpässe im Funnel, größter zuerst."),
  changes: z.object({
    summary: z.string().describe("Was sich seit dem letzten gespeicherten Bericht verändert hat (2–3 Sätze); ohne Vorbericht: gegenüber der Vorperiode."),
    items: z
      .array(
        z.object({
          title: z.string(),
          detail: z.string().describe("1–2 Sätze, mit Zahlen; ob frühere Empfehlungen sichtbar wirken."),
          direction: z.enum(DIRECTIONS).describe("besser, schlechter, gleich oder unklar (z. B. Messänderung)."),
        })
      )
      .describe("Die 3–6 wichtigsten Veränderungen."),
  }),
  segments: z
    .array(
      z.object({
        segment: z.string().describe("Segment oder Persona, z. B. „Zurückholen“ oder „Großgeräte-Käufer“."),
        insight: z.string().describe("Was die Daten über diese Gruppe sagen (1–2 Sätze)."),
        action: z.string().describe("Was daraus folgt (1 Satz)."),
        link: link(),
      })
    )
    .describe("2–5 Erkenntnisse zu Kundengruppen, Lebenszyklus und Personas."),
  campaigns: z.object({
    summary: z.string().describe("Kampagnen-Leistung im Zeitraum (2–3 Sätze); ohne Versand: was fehlt."),
    items: z
      .array(z.object({ campaign: z.string(), insight: z.string(), action: z.string() }))
      .describe("Je Kampagne (höchstens 5) Erkenntnis und Folgerung."),
  }),
});

export const planSchema = z.object({
  recommendations: z
    .array(
      z.object({
        title: z.string().describe("Die Maßnahme als Imperativ, max. ~12 Wörter."),
        why: z.string().describe("Begründung mit den belegenden Zahlen (1–3 Sätze)."),
        action: z.string().describe("Konkrete erste Schritte (1–3 Sätze)."),
        expectedImpact: z.string().describe("Erwartete Wirkung, möglichst beziffert (z. B. „+2–4 Bestellungen/Monat“), mit Annahme."),
        impact: level("Wirkung."),
        effort: z.enum(EFFORTS).describe("Aufwand: klein, mittel oder gross."),
        confidence: level("Konfidenz."),
        owner: owner(),
        successMetric: z.string().describe("Erfolgsmessung: Kennzahl (mit Schlüssel, z. B. signin.popupRate), Zielwert, Zeitraum."),
        link: link(),
      })
    )
    .describe("5–10 Maßnahmen, nach Priorität sortiert (Wirkung × Konfidenz ÷ Aufwand)."),
  experiments: z
    .array(
      z.object({
        title: z.string(),
        hypothesis: z.string().describe("Wenn …, dann …, weil …"),
        design: z.string().describe("Aufbau: Varianten bzw. Kontrollgruppe, Zielgruppe, Umsetzung."),
        metric: z.string().describe("Primäre Kennzahl (mit Schlüssel)."),
        duration: z.string().describe("Laufzeit und benötigte Fallzahl je Gruppe, realistisch für das aktuelle Volumen."),
        successCriterion: z.string().describe("Ab wann gilt es als Erfolg bzw. Misserfolg."),
        owner: owner(),
      })
    )
    .describe("2–4 Experimente, die eine offene Frage klären."),
  risks: z
    .array(
      z.object({
        title: z.string(),
        detail: z.string(),
        severity: level("Schwere."),
        mitigation: z.string().describe("Gegenmaßnahme."),
        owner: owner(),
      })
    )
    .describe("2–6 Risiken (Umsatz, Recht/Einwilligung, Technik, Reputation)."),
  dataQuality: z
    .array(z.object({ title: z.string(), detail: z.string() }))
    .describe("Messlücken und Vorbehalte, die die Empfehlungen einschränken (zusätzlich zu den gelieferten Hinweisen)."),
});

