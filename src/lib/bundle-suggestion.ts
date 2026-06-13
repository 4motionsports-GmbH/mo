// AI bundle SUGGESTION (S11) — proposes ONE personalized bundle for a customer.
//
// Given everything the personalized-email path already has (the "current
// understanding" profile, the full conversation history, and the purchase
// history), the model proposes 2–5 catalog products that COMPLEMENT what the
// customer already owns — never duplicating it — each with a one-sentence German
// rationale. Hard guarantees live in the pure core (bundle-suggestion-core.mjs):
// the model is only ever shown IN-STOCK, priceable, NOT-owned products (so a
// sold-out item — which S10 refuses at compose time — is never even offered),
// and its output is sanitized back against that candidate set so a hallucinated
// or owned id can't survive.
//
// Provider/model conventions match the marketing-draft path (Anthropic via
// @ai-sdk/anthropic + the Vercel AI SDK, structured output via generateObject)
// and token usage is recorded per S6 cost tracking (call site bundle_suggestions).

import { generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import type { TranscriptMessage } from "./conversation-store";
import type { Product } from "./types";
import { reportError } from "./observability";
import { recordAiUsage } from "./ai-usage-store";
import {
  selectBundleCandidates,
  sanitizeBundleSuggestion,
  BUNDLE_MIN_PRODUCTS,
  BUNDLE_MAX_PRODUCTS,
} from "./bundle-suggestion-core.mjs";

// Same model the marketing draft uses — one voice/quality bar across the
// dashboard's AI features.
const SUGGEST_MODEL = "claude-sonnet-4-5-20250929";

// Bound the prompt: enough candidates for a good pick without an unwieldy list.
const MAX_CANDIDATES_IN_PROMPT = 60;
const MAX_SESSIONS_IN_PROMPT = 8;
const MAX_TRANSCRIPT_CHARS_PER_SESSION = 3000;

const suggestionSchema = z.object({
  title: z
    .string()
    .describe(
      "Kurzer, einladender deutscher Titel für das Set (z. B. 'Dein persönliches Kraft-Set'). Max ~40 Zeichen."
    ),
  products: z
    .array(
      z.object({
        productId: z
          .string()
          .describe("Die EXAKTE id eines Produkts aus der vorgegebenen Kandidatenliste."),
        rationale: z
          .string()
          .describe("Ein einziger, konkreter deutscher Satz, warum dieses Produkt ins Set passt."),
      })
    )
    .describe(
      `${BUNDLE_MIN_PRODUCTS}–${BUNDLE_MAX_PRODUCTS} Produkte, die sich ergänzen und auf das ` +
        `bisher Gekaufte aufbauen (nie Gekauftes wiederholen).`
    ),
});

/** One linked conversation the suggestion reads. Structurally satisfied by
 * CustomerSession (lib/customer-store) and CustomerDraftSession. */
export interface BundleSuggestionSession {
  createdAt: string | null;
  personaLabel: string | null;
  transcript: TranscriptMessage[];
}

export interface BundleSuggestionInput {
  /** The full synced catalog (the candidate pool before filtering). */
  catalog: Product[];
  /** Handles (== catalog ids) the customer already OWNS — excluded as candidates. */
  ownedHandles: string[];
  /** The cached "current understanding" profile summary, if generated. */
  profileSummary: string | null;
  /** Owned items for the prompt (so the model builds on them, never repeats them). */
  ownedItems: Array<{ title: string | null; quantity: number }>;
  /** False when no purchase history was loaded (owned = UNKNOWN, not "none"). */
  purchasesKnown: boolean;
  /** ALL linked conversations, chronological (oldest first). */
  sessions: BundleSuggestionSession[];
}

/** One proposed component, resolved back to its catalog product for the UI. */
export interface SuggestedComponent {
  productId: string;
  title: string;
  imageUrl: string | null;
  unitPrice: number;
  currency: string;
  inStock: boolean;
  rationale: string;
}

export type BundleSuggestionResult =
  | {
      ok: true;
      title: string;
      components: SuggestedComponent[];
      /** True component sum of the proposal (the default bundle price). */
      componentsSum: number;
    }
  | { ok: false; reason: "no_candidates" | "empty" | "ai_unavailable"; message: string };

function readableTranscript(messages: TranscriptMessage[]): string {
  return messages
    .filter(
      (m) =>
        m.toolName === null && (m.role === "user" || m.role === "assistant") && m.content.trim()
    )
    .map((m) => `${m.role === "user" ? "Kunde" : "Berater"}: ${m.content.trim()}`)
    .join("\n");
}

function effectivePrice(p: Product): number {
  return typeof p.salePrice === "number" && p.salePrice > 0 ? p.salePrice : p.price;
}

function firstImageUrl(p: Product): string | null {
  return p.images?.find((u) => typeof u === "string" && u.startsWith("https://")) ?? null;
}

function ownedItemsBlock(input: BundleSuggestionInput): string {
  if (!input.purchasesKnown) {
    return "(Kaufhistorie nicht geladen — bisher Gekauftes ist UNBEKANNT.)";
  }
  if (input.ownedItems.length === 0) {
    return "(Shopify abgefragt: bisher keine Bestellungen unter dieser E-Mail.)";
  }
  return input.ownedItems
    .map((i) => `- ${i.quantity}× ${i.title ?? "Unbekannter Artikel"}`)
    .join("\n");
}

function candidateLine(p: Product): string {
  const price = effectivePrice(p).toLocaleString("de-DE", { style: "currency", currency: "EUR" });
  const desc = (p.shortDescription ?? "").trim().slice(0, 140);
  return `- id=${p.id} · ${p.name} · ${p.category} · ${price}${desc ? ` · ${desc}` : ""}`;
}

/**
 * Propose ONE personalized bundle. Pure validation lives in the core; this layer
 * builds the prompt, calls the model (structured output), records token usage,
 * and resolves the sanitized picks back to catalog products for the UI. Never
 * throws — returns a typed refusal on any failure so the admin sees why.
 */
export async function suggestBundle(
  input: BundleSuggestionInput
): Promise<BundleSuggestionResult> {
  // 1. Candidate pool: in-stock, priceable, NOT owned (sold-out never offered).
  const candidates = selectBundleCandidates(input.catalog, input.ownedHandles) as Product[];
  if (candidates.length === 0) {
    return {
      ok: false,
      reason: "no_candidates",
      message: "Keine passenden, lieferbaren Produkte zum Bündeln (alles ausverkauft oder bereits gekauft).",
    };
  }
  const candidateById = new Map(candidates.map((p) => [p.id, p]));

  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      ok: false,
      reason: "ai_unavailable",
      message: "KI nicht konfiguriert (ANTHROPIC_API_KEY) — Produkte bitte manuell hinzufügen.",
    };
  }

  // 2. Build the bounded prompt context.
  const promptCandidates = candidates.slice(0, MAX_CANDIDATES_IN_PROMPT);
  const sessions = input.sessions.slice(-MAX_SESSIONS_IN_PROMPT);
  const sessionBlocks = sessions
    .map((s, i) => {
      const t = readableTranscript(s.transcript).slice(0, MAX_TRANSCRIPT_CHARS_PER_SESSION);
      const date = s.createdAt ? new Date(s.createdAt).toLocaleDateString("de-DE") : "Datum unbekannt";
      return `### Gespräch ${i + 1} — ${date}\n${t || "(kein lesbares Transkript)"}`;
    })
    .join("\n\n");

  try {
    const { object, usage } = await generateObject({
      model: anthropic(SUGGEST_MODEL),
      schema: suggestionSchema,
      system:
        "Du bist Mo, ein erfahrener Berater bei motion sports (Fitness- und " +
        "Kraftsportgeräte). Du stellst EIN persönliches Produkt-Set für einen " +
        "Stammkunden zusammen.\n\n" +
        "Regeln:\n" +
        `- Wähle ${BUNDLE_MIN_PRODUCTS}–${BUNDLE_MAX_PRODUCTS} Produkte AUSSCHLIESSLICH ` +
        "aus der vorgegebenen Kandidatenliste; verwende exakt deren id-Werte.\n" +
        "- Die Produkte sollen sich gegenseitig ergänzen und sinnvoll zum Bedarf " +
        "des Kunden passen — ein stimmiges Set, kein willkürlicher Mix.\n" +
        "- Baue auf BEREITS Gekauftem auf, wiederhole es aber NIE (Gekauftes ist " +
        "nicht in der Kandidatenliste).\n" +
        "- Erfinde keine Produkte und keine ids. Jede Begründung ist EIN konkreter Satz.",
      prompt:
        `## Aktuelles Kundenverständnis\n${input.profileSummary?.trim() || "(kein Profil generiert)"}\n\n` +
        `## Bereits gekauft (darauf aufbauen, NICHT wiederholen)\n${ownedItemsBlock(input)}\n\n` +
        `## Kandidaten (NUR aus dieser Liste wählen, exakte id verwenden)\n${promptCandidates
          .map(candidateLine)
          .join("\n")}\n\n` +
        `## Bisherige Gespräche (chronologisch)\n${sessionBlocks || "(keine Gespräche verknüpft)"}\n\n` +
        `Stelle jetzt EIN Set aus ${BUNDLE_MIN_PRODUCTS}–${BUNDLE_MAX_PRODUCTS} Produkten zusammen.`,
    });

    // Cost KPI (dashboard/admin side).
    await recordAiUsage({
      callSite: "bundle_suggestions",
      model: SUGGEST_MODEL,
      inputTokens: usage?.inputTokens ?? 0,
      outputTokens: usage?.outputTokens ?? 0,
    });

    // 3. Sanitize the model's picks back against the candidate set (drops any
    //    hallucinated / owned / sold-out id), then resolve to catalog products.
    const picks = sanitizeBundleSuggestion(object.products, candidateById.keys(), {
      max: BUNDLE_MAX_PRODUCTS,
    }) as Array<{ productId: string; rationale: string }>;
    const components: SuggestedComponent[] = [];
    for (const pick of picks) {
      const p = candidateById.get(pick.productId);
      if (!p) continue;
      components.push({
        productId: p.id,
        title: p.name,
        imageUrl: firstImageUrl(p),
        unitPrice: effectivePrice(p),
        currency: p.currency ?? "EUR",
        inStock: p.inStock !== false,
        rationale: pick.rationale,
      });
    }

    if (components.length === 0) {
      return {
        ok: false,
        reason: "empty",
        message: "Die KI hat keine gültigen Produkte vorgeschlagen — bitte manuell zusammenstellen.",
      };
    }

    const componentsSum = components.reduce((sum, c) => sum + c.unitPrice, 0);
    const title = object.title?.trim() || "Dein persönliches Set";
    return { ok: true, title, components, componentsSum };
  } catch (err) {
    reportError(err, { route: "lib/bundle-suggestion", phase: "suggest" });
    return {
      ok: false,
      reason: "ai_unavailable",
      message: "Vorschlag fehlgeschlagen — Produkte bitte manuell hinzufügen.",
    };
  }
}
