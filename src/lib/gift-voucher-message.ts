// Geschenkgutscheine — „Mit Mo formulieren“ (spec §8.4): three short card texts
// for the voucher page, written by the bulk tier (Haiku 4.5, ~0.3 ct a call).
//
// No personal data reaches the model: the prompt is built from the occasion
// and the tone (two fixed lists) and the locale only. The model writes the
// literal placeholders {{fuer}} (recipient) and {{von}} (giver); the page fills
// them in (or drops the greeting line when no name is given). The answer is
// cleaned in code (gift-voucher-storefront.mjs cleanGiftVoucherSuggestions:
// placeholders, printable characters, ≤ 300 characters, ≤ 6 lines) — the
// output schema carries no min/max keywords (docs/AI_MODELS.md). The page
// labels every text „KI-Vorschlag“.

import { generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import { anthropicOptionsFor, maxOutputTokensFor, modelFor } from "./ai-models.mjs";
import { recordAiUsage } from "./ai-usage-store";
import { reportError } from "./observability";
import {
  cleanGiftVoucherSuggestions,
  giftVoucherApiText,
  giftVoucherSuggestionPrompt,
} from "./gift-voucher-storefront.mjs";

const ROUTE = "lib/gift-voucher-message";
const TIER = "bulk";
const MODEL = modelFor(TIER);
/** Three texts of ≤ 300 characters plus the JSON around them. */
const ANSWER_TOKENS = 1_000;
/** The storefront waits for the answer: stop the model call after 20 s (route maxDuration 30). */
const TIMEOUT_MS = 20_000;

// Plain required fields only (structured-output limits, docs/AI_MODELS.md).
const SUGGESTIONS_SCHEMA = z.object({ vorschlaege: z.array(z.string()) });

export interface GiftVoucherSuggestionRequest {
  occasion: string;
  tone: string;
  locale: "de" | "en";
}

export type GiftVoucherSuggestionResult =
  | { ok: true; suggestions: string[] }
  | { ok: false; status: 502 | 503; message: string };

/** Three (at least one) cleaned card texts with {{fuer}} / {{von}}. Never throws. */
export async function suggestGiftVoucherMessages(input: GiftVoucherSuggestionRequest): Promise<GiftVoucherSuggestionResult> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { ok: false, status: 503, message: giftVoucherApiText("ai_off", input.locale) };
  }
  const failed = { ok: false as const, status: 502 as const, message: giftVoucherApiText("ai_failed", input.locale) };
  try {
    const { system, prompt } = giftVoucherSuggestionPrompt(input);
    const { object, usage } = await generateObject({
      model: anthropic(MODEL),
      providerOptions: anthropicOptionsFor(TIER),
      schema: SUGGESTIONS_SCHEMA,
      system,
      prompt,
      maxOutputTokens: maxOutputTokensFor(TIER, ANSWER_TOKENS),
      maxRetries: 1,
      abortSignal: AbortSignal.timeout(TIMEOUT_MS),
    });
    await recordAiUsage({
      callSite: "gift_voucher_message",
      model: MODEL,
      inputTokens: usage?.inputTokens ?? 0,
      outputTokens: usage?.outputTokens ?? 0,
    });
    const suggestions = cleanGiftVoucherSuggestions(object.vorschlaege);
    if (suggestions.length === 0) {
      // Counts only — never the texts.
      reportError(new Error("No usable gift voucher suggestion after clean-up"), {
        route: ROUTE,
        phase: "clean",
        received: Array.isArray(object.vorschlaege) ? object.vorschlaege.length : 0,
      });
      return failed;
    }
    return { ok: true, suggestions };
  } catch (err) {
    reportError(err, { route: ROUTE, phase: "generate", occasion: input.occasion, tone: input.tone });
    return failed;
  }
}
