// "Current understanding" customer profile — the central, per-person record
// every AI component reads (chat memory, Kampagne + marketing drafts, letters,
// bundle suggestion, hero prompt, summary mail, Komplettanalyse).
//
// Takes EVERYTHING we know about one customer (all linked conversation
// transcripts with their persona labels, the Shopify purchase history, email
// correspondence and the Kampagne relationship) and regenerates ONE coherent
// profile: a readable German summary PLUS structured fields (persona, goals,
// owned equipment, interests, level, budget signal, next steps — see
// customer-profile-core.mjs). Deliberately a fresh regeneration each time —
// sources contradict each other (people change their minds between visits), so
// we never merge them mechanically; the model resolves contradictions in favour
// of the newer statement.
//
// Two depths (0061): a VOLLPROFIL (deep tier) for people with a Mo chat or
// correspondence, a KAUFPROFIL (writer tier, purchases + campaign reactions
// only) for Shopify customers who never talked to us. Who gets one at all is
// CUSTOMER_AI_PROFILE_SCOPE (`consented` | `all`); an Art. 21 objection always
// wins (platform-flags.mayBuildAiProfile).
//
// Who triggers it: the nightly customer-refresh cron keeps profiles current for
// every customer with new activity (lib/customer-refresh.ts runProfileUpkeep),
// the Kunden "Kundenverständnis generieren" button forces one, and the
// Komplettanalyse regenerates the profiles of its active customers. All three
// go through regenerateCustomerProfile below — one path, one stored result.
//
// Provider: Anthropic via @ai-sdk/anthropic, deep tier (lib/ai-models.mjs). NO
// silent fallback: a missing key / model error returns a reason instead of
// caching a fabricated profile.
//
// Data minimisation: the email ADDRESS is never sent to the model; the
// correspondence is folded in as body text only (last N messages / 12 months,
// email-messages-store); the Kampagne block carries dates, subjects and flags,
// no mail bodies.

import { generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import { anthropicOptionsFor, maxOutputTokensFor, modelFor } from "./ai-models.mjs";
import { usdCostForUsage } from "./ai-pricing.mjs";
import {
  getCustomerById,
  listCustomersForProfileUpkeep,
  loadCustomerSessions,
  markCustomerProfileChecked,
  saveCustomerProfile,
  type CustomerProfileData,
  type CustomerSession,
} from "./customer-store";
import { loadCustomerCorrespondence } from "./email-messages-store";
import { loadCampaignHistoryForCustomer } from "./campaign-store";
import { refreshCustomerData } from "./customer-refresh";
import { loadPurchaseHistory } from "./customer-orders-store";
import { aiProfileScope, mayBuildAiProfile } from "./platform-flags.mjs";
import type { OrderHistory } from "./shopify-orders";
import { ARCHETYPE_META } from "./persona";
import type { PersonaArchetype } from "./types";
import { recordAiUsage } from "./ai-usage-store";
import { formatStoreDate } from "./store-datetime.mjs";
import {
  normalizeProfileData,
  profileForPrompt,
  PROFILE_BUDGETS,
  PROFILE_LEVELS,
  PROFILE_PERSONAS,
} from "./customer-profile-core.mjs";
import { reportError } from "./observability";

// Deep tier (lib/ai-models.mjs): identity-level judgement over dense input.
const PROFILE_MODEL = modelFor("deep");
// Writer tier for the purchase-only profile — short input, one perspective.
const LIGHT_PROFILE_MODEL = modelFor("writer");

// Keep the prompt bounded: a customer with many long sessions must not turn
// into an unbounded mega-prompt. Newest sessions matter most, so when
// trimming, older transcripts are dropped first.
const MAX_SESSIONS_IN_PROMPT = 12;
const MAX_TRANSCRIPT_CHARS_PER_SESSION = 6000;

export interface ProfileUsage {
  inputTokens: number;
  outputTokens: number;
  /** Rough cost of this regeneration in USD (input+output at list price). */
  approxCostUsd: number;
}

export interface GenerateProfileInput {
  sessions: CustomerSession[];
  purchases: OrderHistory | null;
  /**
   * Tier-3 only: a DATA-MINIMISED location context (city/country) from the
   * signed-in Shopify account, so the profile can note delivery-relevant
   * context. Never the full street address. Absent for tiers 1–2.
   */
  accountContext?: { city: string | null; countryCode: string | null } | null;
  /**
   * The customer's email correspondence, pre-rendered as ONE readable block
   * (oldest-first, both directions) by loadCustomerCorrespondence — body TEXT
   * ONLY, already capped. Empty string / absent = none.
   */
  correspondence?: string | null;
  /** The Kampagne relationship (loadCampaignHistoryForCustomer). Empty = none. */
  campaignHistory?: string | null;
  /** kauf = purchase profile on the writer tier; voll (default) = deep tier. */
  depth?: "kauf" | "voll";
}

export type GenerateProfileResult =
  | { ok: true; summary: string; data: CustomerProfileData; usage: ProfileUsage }
  | { ok: false; reason: "unconfigured" | "no_data" | "model_error"; message: string };

function personaDisplay(label: string | null): string {
  if (!label) return "unbekannt";
  const meta = ARCHETYPE_META[label as PersonaArchetype];
  return meta ? meta.label : label;
}

function fmtDate(iso: string | null): string {
  return formatStoreDate(iso, "de-DE", "unbekanntes Datum");
}

function sessionBlock(s: CustomerSession, index: number, total: number): string {
  const transcript = s.transcript
    .map((m) => `${m.role === "user" ? "Kunde" : "Berater"}: ${m.content.trim()}`)
    .join("\n");
  const clipped =
    transcript.length > MAX_TRANSCRIPT_CHARS_PER_SESSION
      ? transcript.slice(0, MAX_TRANSCRIPT_CHARS_PER_SESSION) + "\n[… gekürzt]"
      : transcript;
  return (
    `### Session ${index + 1} von ${total} — ${fmtDate(s.createdAt)} · ` +
    `Persona: ${personaDisplay(s.personaLabel)}\n` +
    (clipped || "(kein lesbares Transkript)")
  );
}

function purchasesBlock(purchases: OrderHistory | null): string {
  if (!purchases) {
    return "(keine Kaufhistorie geladen — Käufe sind UNBEKANNT, nicht 'keine')";
  }
  if (purchases.orders.length === 0) {
    return "(Shopify abgefragt: keine Bestellungen unter dieser E-Mail gefunden)";
  }
  return purchases.orders
    .map((o) => {
      const items = o.items
        .map((i) => `${i.quantity}× ${i.title ?? i.handle ?? "Unbekannter Artikel"}`)
        .join(", ");
      const total = o.totalAmount ? ` — ${o.totalAmount} ${o.currencyCode ?? ""}`.trimEnd() : "";
      return `- ${o.name} (${fmtDate(o.createdAt)}): ${items || "(keine Positionen)"}${total}`;
    })
    .join("\n");
}

function accountContextBlock(
  ctx: { city: string | null; countryCode: string | null } | null | undefined
): string {
  if (!ctx) return "(kein Konto-Kontext — Kunde nicht angemeldet oder keine Adresse)";
  const loc = [ctx.city, ctx.countryCode].filter(Boolean).join(", ");
  return loc
    ? `Angemeldeter Kunde. Standort (Stadt/Land, nur für Versand-/Verfügbarkeitskontext): ${loc}`
    : "Angemeldeter Kunde (keine Adressangaben).";
}

const PERSONA_GUIDE = PROFILE_PERSONAS.filter((p) => p !== "unknown")
  .map((p) => `${p} = ${ARCHETYPE_META[p as PersonaArchetype]?.label ?? p}`)
  .join("; ");

// No .min()/.max() on anything: Anthropic structured output rejects those
// keywords (see email-hero-qa.mjs); normalizeProfileData enforces the bounds.
const profileSchema = z.object({
  summary: z
    .string()
    .describe(
      "Das Kundenverständnis als kurzer deutscher Text (max. ~250 Wörter), gegliedert in: " +
        "Bedarf & Ziele · Niveau & Kontext · Vorlieben & Budget-Signale · Besitzt bereits (Käufe) · " +
        "Offene Punkte / nächste sinnvolle Schritte."
    ),
  persona: z
    .enum(PROFILE_PERSONAS as [string, ...string[]])
    .describe(`Die am besten passende Persona: ${PERSONA_GUIDE}; unknown, wenn unklar.`),
  goals: z.array(z.string()).describe("Trainingsziele und Bedarfe, je ein kurzer Stichpunkt (höchstens 8)."),
  owned: z.array(z.string()).describe("Geräte/Produkte, die die Person BESITZT (aus Käufen oder eigener Aussage), je ein Stichpunkt."),
  interests: z.array(z.string()).describe("Produkte, Kategorien oder Themen, für die sich die Person interessiert, aber noch nicht besitzt."),
  level: z.enum(PROFILE_LEVELS as [string, ...string[]]).describe("Trainingsniveau; unbekannt, wenn nicht erkennbar."),
  budget: z.enum(PROFILE_BUDGETS as [string, ...string[]]).describe("Budget-Signal aus Käufen/Aussagen; unbekannt, wenn nicht erkennbar."),
  nextSteps: z.array(z.string()).describe("Sinnvolle nächste Schritte bzw. Ergänzungen, je ein Stichpunkt."),
});

/**
 * Generate the profile from its inputs. Never throws — returns a discriminated
 * result with the real reason (no key, nothing to summarise, model failure).
 */
export async function generateCustomerProfile(
  input: GenerateProfileInput
): Promise<GenerateProfileResult> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      ok: false,
      reason: "unconfigured",
      message: "ANTHROPIC_API_KEY ist nicht gesetzt — Profil kann nicht generiert werden.",
    };
  }

  const sessions = input.sessions.filter((s) => s.transcript.length > 0);
  const correspondence = input.correspondence?.trim() || "";
  const campaignHistory = input.campaignHistory?.trim() || "";
  if (
    sessions.length === 0 &&
    !input.purchases?.orders?.length &&
    !correspondence &&
    !campaignHistory
  ) {
    return {
      ok: false,
      reason: "no_data",
      message: "Keine Gespräche, Käufe, Korrespondenz oder Kampagnen-Historie — nichts zu verdichten.",
    };
  }

  // Newest sessions carry the freshest signal; drop the oldest beyond the cap.
  const kept = sessions.slice(-MAX_SESSIONS_IN_PROMPT);
  const blocks = kept.map((s, i) => sessionBlock(s, i, kept.length)).join("\n\n");
  const light = input.depth === "kauf";
  const model = light ? LIGHT_PROFILE_MODEL : PROFILE_MODEL;
  const tier = light ? "writer" : "deep";

  try {
    const { object, usage } = await generateObject({
      model: anthropic(model),
      providerOptions: anthropicOptionsFor(tier),
      maxOutputTokens: maxOutputTokensFor(tier, light ? 1200 : 2000),
      schema: profileSchema,
      system:
        "Du bist Analyst bei motion sports (Fitness- und Kraftsportgeräte). Du " +
        "verdichtest alles, was wir über EINEN Kunden wissen — Chat-Sessions, " +
        "E-Mail-Korrespondenz, Kaufhistorie und Newsletter-Beziehung — zu einem " +
        "aktuellen Kundenverständnis. Es ist die zentrale Grundlage für den " +
        "Chat-Berater, Marketing-Mails, Produktempfehlungen und das Team.\n\n" +
        "Regeln:\n" +
        "- Deutsch, prägnant, faktenbasiert — keine Floskeln, nichts erfinden.\n" +
        "- EIN kohärentes Gesamtbild, KEINE Aneinanderreihung der Quellen. Bei " +
        "Widersprüchen gilt die neuere Aussage; erwähne den Sinneswandel nur, wenn " +
        "er beratungsrelevant ist.\n" +
        "- Unterscheide klar zwischen GEKAUFT (Kaufhistorie), GEWÜNSCHT (geäußert) " +
        "und UNBEKANNT. Gibt es nur Käufe und keine Gespräche, leite Ziele und " +
        "Interessen vorsichtig aus den Käufen ab und kennzeichne sie als abgeleitet.\n" +
        "- Die strukturierten Felder spiegeln den Text; lieber leer lassen als raten.",
      prompt:
        `## Chat-Sessions (chronologisch, älteste zuerst)\n\n` +
        `${blocks || "(keine Gespräche verknüpft)"}\n\n` +
        `## Korrespondenz (E-Mail)\n\n` +
        `${correspondence || "(keine E-Mail-Korrespondenz)"}\n\n` +
        `## Kaufhistorie (Shopify)\n\n${purchasesBlock(input.purchases)}\n\n` +
        `## Newsletter / Kampagnen\n\n${campaignHistory || "(kein Newsletter-Kontakt)"}\n\n` +
        `## Konto-Kontext (Shopify)\n\n${accountContextBlock(input.accountContext)}\n\n` +
        `Erstelle jetzt das aktuelle Kundenverständnis.`,
    });

    const summary = object.summary?.trim();
    if (!summary) {
      return { ok: false, reason: "model_error", message: "Das Modell lieferte keinen Text." };
    }
    const data = normalizeProfileData(object) as CustomerProfileData;

    const inputTokens = usage?.inputTokens ?? 0;
    const outputTokens = usage?.outputTokens ?? 0;
    await recordAiUsage({
      callSite: "customer_profile",
      model,
      inputTokens,
      outputTokens,
    });
    return {
      ok: true,
      summary,
      data,
      usage: {
        inputTokens,
        outputTokens,
        // Priced from the same table as the cost KPI (lib/ai-pricing.mjs).
        approxCostUsd: usdCostForUsage({ model, inputTokens, outputTokens }),
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: "model_error", message };
  }
}

export type RegenerateProfileResult =
  | (Extract<GenerateProfileResult, { ok: true }> & { saved: boolean; sessionCount: number })
  | Extract<GenerateProfileResult, { ok: false }>
  | { ok: false; reason: "not_found" | "not_allowed"; message: string };

/**
 * THE one path that (re)builds and stores a customer's profile — used by the
 * Kunden button, the Komplettanalyse and the nightly upkeep. Loads every
 * source, fetches the Shopify purchase history first when it was never loaded
 * (Kampagne customers start without one), generates, and stores text +
 * structured fields. A run with nothing to summarise or a model failure still
 * stamps profile_checked_at, so the upkeep waits for new activity instead of
 * retrying every night. Never throws.
 */
export async function regenerateCustomerProfile(
  customerId: number
): Promise<RegenerateProfileResult> {
  try {
    let customer = await getCustomerById(customerId);
    if (!customer) return { ok: false, reason: "not_found", message: "Kunde nicht gefunden." };
    if (
      !mayBuildAiProfile({
        consentState: customer.emailConsentState,
        profileObjectionAt: customer.profileObjectionAt,
        scope: aiProfileScope(),
      })
    ) {
      return {
        ok: false,
        reason: "not_allowed",
        message: customer.profileObjectionAt
          ? "Widerspruch gegen Profilbildung — es wird kein KI-Profil erstellt."
          : "Ohne Einwilligung wird kein KI-Profil erstellt (CUSTOMER_AI_PROFILE_SCOPE=consented).",
      };
    }

    // Purchases: the order ledger for mirrored people, else the per-e-mail
    // Shopify read (fetched first when it was never loaded).
    if (!customer.shopifySyncedAt && !customer.purchaseSummary) {
      const refreshed = await refreshCustomerData(customer);
      if (refreshed.ok) customer = (await getCustomerById(customerId)) ?? customer;
    }

    const [sessions, correspondence, campaignHistory, purchases] = await Promise.all([
      loadCustomerSessions(customerId),
      loadCustomerCorrespondence(customerId),
      loadCampaignHistoryForCustomer(customerId),
      loadPurchaseHistory(customer),
    ]);
    const depth: "kauf" | "voll" =
      sessions.some((s) => s.transcript.length > 0) || correspondence.trim() ? "voll" : "kauf";

    const result = await generateCustomerProfile({
      sessions,
      purchases,
      accountContext: customer.shopifyAccountSummary?.addressContext ?? null,
      correspondence,
      campaignHistory,
      depth,
    });
    if (!result.ok) {
      // "unconfigured" is an environment problem, not a verdict on the
      // customer — leave them due so the next run with a key picks them up.
      if (result.reason !== "unconfigured") await markCustomerProfileChecked(customerId);
      return result;
    }
    const saved = await saveCustomerProfile(customerId, { summary: result.summary, data: result.data, depth });
    return { ...result, saved, sessionCount: sessions.length };
  } catch (err) {
    reportError(err, { route: "lib/customer-profile", phase: "regenerate" });
    return {
      ok: false,
      reason: "model_error",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

export interface ProfileUpkeepResult {
  considered: number;
  generated: number;
  noData: number;
  failed: number;
  /** Customers still waiting after this run (for the backfill's progress). */
  remaining: number;
  stoppedByDeadline: boolean;
}

/**
 * The nightly profile upkeep (called by /api/cron/refresh-customers): pick up
 * to `batch` customers whose profile is missing or older than their latest
 * activity and regenerate them, `concurrency` at a time, starting no new one
 * after `deadlineMs` (epoch ms) so the cron stays inside maxDuration. A batch
 * of 0 disables the upkeep. Never throws.
 */
export async function runProfileUpkeep(opts: {
  batch: number;
  deadlineMs: number;
  concurrency?: number;
  /** kauf = the purchase-only profiles (CUSTOMER_PROFILE_LIGHT_BATCH). */
  depth?: "voll" | "kauf";
}): Promise<ProfileUpkeepResult> {
  const empty = { considered: 0, generated: 0, noData: 0, failed: 0, remaining: 0, stoppedByDeadline: false };
  if (opts.batch <= 0 || !process.env.ANTHROPIC_API_KEY) return empty;
  const { ids, remaining } = await listCustomersForProfileUpkeep(opts.batch, {
    depth: opts.depth ?? "voll",
    scope: aiProfileScope(),
  });
  const queue = [...ids];
  const out = { ...empty, considered: ids.length };
  const worker = async () => {
    while (queue.length > 0) {
      if (Date.now() >= opts.deadlineMs) {
        out.stoppedByDeadline = true;
        return;
      }
      const id = queue.shift() as number;
      const res = await regenerateCustomerProfile(id);
      if (res.ok) out.generated++;
      else if (res.reason === "no_data") out.noData++;
      else out.failed++;
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, opts.concurrency ?? 3) }, worker));
  const done = out.generated + out.noData + out.failed;
  return { ...out, remaining: Math.max(0, remaining - done) };
}

/** The customer's profile as ONE prompt block (summary + structured fields +
 *  persona label) for every generator with a "Kundenverständnis" slot —
 *  marketing/letter drafts, bundle suggestion, hero prompt. */
export function customerProfileForPrompt(
  customer: { profileSummary: string | null; profileData: CustomerProfileData | null; personaLabel: string | null } | null | undefined
): string | null {
  if (!customer) return null;
  const persona = customer.personaLabel as PersonaArchetype | null;
  const label = persona && ARCHETYPE_META[persona] ? ARCHETYPE_META[persona].label : null;
  return profileForPrompt(customer.profileSummary, customer.profileData, label);
}
