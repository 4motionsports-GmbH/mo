// Q&A translation pass — ONE cheap Haiku call that turns the operator's
// German {Frage, Antwort} into the English pair for the bilingual custom.qa
// metafield (docs/QA_KNOWLEDGE.md, i18n section). Runs at PUBLISH time, only
// when the entry has no cached/operator-provided English yet, so the team
// never writes anything twice. Mirrors qa-draft.ts: same provider wiring,
// defensive JSON parsing, never throws.

import { generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { recordAiUsage } from "./ai-usage-store";

/** Cheap Haiku-class model — a short translation, not the consultation model. */
export const QA_TRANSLATE_MODEL = "claude-haiku-4-5";

export type QaTranslationResult =
  | { ok: true; questionEn: string; answerEn: string }
  | { ok: false; reason: "unconfigured" | "model_error"; message: string };

const SYSTEM_PROMPT =
  "You translate German customer Q&A entries for motion sports (a German " +
  "fitness-equipment shop) into natural, customer-facing English for the " +
  "storefront. Keep product names, model numbers, units and measurements " +
  "EXACTLY as written (e.g. 'MPX-780', '2.195 mm' stays '2,195 mm' in " +
  "English digit-grouping only if unambiguous — when unsure, keep the " +
  "original notation). Do not add, drop or soften information.\n\n" +
  "Respond with EXACTLY ONE JSON object, no code fences, no other text:\n" +
  '{ "question_en": "...", "answer_en": "..." }';

function parseTranslation(text: string): { questionEn: string; answerEn: string } | null {
  let body = text.trim();
  body = body.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  let obj: { question_en?: unknown; answer_en?: unknown };
  try {
    obj = JSON.parse(body.slice(start, end + 1)) as typeof obj;
  } catch {
    return null;
  }
  const questionEn =
    typeof obj.question_en === "string" ? obj.question_en.trim().slice(0, 500) : "";
  const answerEn =
    typeof obj.answer_en === "string" ? obj.answer_en.trim().slice(0, 4000) : "";
  if (!questionEn || !answerEn) return null;
  return { questionEn, answerEn };
}

/**
 * Translate one German Q&A pair to English. Never throws; the publish route
 * treats a failure as "publish German-only" (the storefront falls back to
 * German) rather than blocking the publish.
 */
export async function generateQaTranslation(input: {
  question: string;
  answer: string;
}): Promise<QaTranslationResult> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return {
      ok: false,
      reason: "unconfigured",
      message: "ANTHROPIC_API_KEY ist nicht gesetzt — Übersetzung nicht möglich.",
    };
  }
  try {
    const result = await generateText({
      model: anthropic(QA_TRANSLATE_MODEL),
      maxOutputTokens: 1200,
      system: SYSTEM_PROMPT,
      prompt:
        `Frage (Deutsch): ${input.question}\n\n` +
        `Antwort (Deutsch): ${input.answer}\n\n` +
        "Translate now and return ONLY the JSON object.",
    });

    await recordAiUsage({
      callSite: "qa_translate",
      model: QA_TRANSLATE_MODEL,
      inputTokens: result.usage?.inputTokens ?? 0,
      outputTokens: result.usage?.outputTokens ?? 0,
    });

    const parsed = parseTranslation(result.text ?? "");
    if (!parsed) {
      return {
        ok: false,
        reason: "model_error",
        message: "Das Modell lieferte keine verwertbare Übersetzung.",
      };
    }
    return { ok: true, ...parsed };
  } catch (err) {
    return {
      ok: false,
      reason: "model_error",
      message: `Modellfehler: ${(err as Error).message ?? "unbekannt"}`,
    };
  }
}
