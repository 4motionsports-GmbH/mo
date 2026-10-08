// One structured-output call on the `strategist` tier (lib/ai-models.mjs —
// Opus 5.5, adaptive thinking, effort high, refusal fallback), made safe for
// a serverless step:
//
//   · structured output through `output_config.format` (generateObject /
//     streamObject with a zod schema) — Opus 5.5 rejects a forced tool choice,
//     and @ai-sdk/anthropic ≥ 3.0.125 uses the native format for it;
//   · streamed, so the HTTP response starts at once and a long thinking phase
//     never runs into a response-headers timeout — and the stream is READ to
//     its end (object-stream.mjs): ai@6 settles `object`/`usage` only while the
//     stream is consumed; awaiting them alone hung every answer until the
//     platform killed the step (the 504 of 2026-10-08);
//   · bounded: maxOutputTokens = the answer budget plus the tier's thinking
//     headroom (thinking counts toward max_tokens), an abort at `timeoutMs`
//     (the caller derives it from its step deadline — callTimeoutWithinStep)
//     plus a watchdog shortly after, at most one SDK retry;
//   · the effort can be lowered for a retry after a timeout (the caller owns
//     the ladder — analytics-report-synthesis-core STRATEGIST_EFFORTS);
//   · usage recorded in ai_usage under the caller's call site.
//
// Never throws: the result says why it failed (no key, timeout, truncated,
// refused/invalid output, model error). Used by the Komplettanalyse and the
// Verbesserung.

import { NoObjectGeneratedError, streamObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import type { z } from "zod";
import { anthropicOptionsFor, maxOutputTokensFor, modelFor } from "./ai-models.mjs";
import { settleObjectStream } from "./object-stream.mjs";
import { recordAiUsage, type AiCallSite } from "./ai-usage-store";
import { reportError } from "./observability";

export const STRATEGIST_MODEL = modelFor("strategist");

export type StrategistEffort = "low" | "medium" | "high";

export type StrategistResult<T> =
  | {
      ok: true;
      object: T;
      model: string;
      effort: StrategistEffort;
      inputTokens: number;
      outputTokens: number;
      finishReason: string;
      ms: number;
    }
  | {
      ok: false;
      reason: "unconfigured" | "timeout" | "truncated" | "invalid" | "model_error";
      message: string;
      model: string;
      effort: StrategistEffort;
      inputTokens: number;
      outputTokens: number;
      ms: number;
    };

/**
 * Run one strategist pass. `answerTokens` is the budget of the answer alone;
 * the tier's thinking headroom is added on top.
 */
export async function runStrategistObject<T>({
  schema,
  system,
  prompt,
  answerTokens,
  callSite,
  effort = "high",
  timeoutMs,
  label,
}: {
  schema: z.ZodType<T>;
  system: string;
  prompt: string;
  answerTokens: number;
  callSite: AiCallSite;
  effort?: StrategistEffort;
  timeoutMs: number;
  /** For error reports, e.g. "analytics-decisions". */
  label: string;
}): Promise<StrategistResult<T>> {
  const started = Date.now();
  const base = { model: STRATEGIST_MODEL, effort, inputTokens: 0, outputTokens: 0 };
  if (!process.env.ANTHROPIC_API_KEY) {
    return { ok: false, reason: "unconfigured", message: "ANTHROPIC_API_KEY ist nicht gesetzt.", ...base, ms: 0 };
  }

  const options = anthropicOptionsFor("strategist");
  const providerOptions = { ...options, anthropic: { ...(options.anthropic ?? {}), effort } };

  const out = await settleObjectStream(
    ({ abortSignal, onError }) =>
      streamObject({
        model: anthropic(STRATEGIST_MODEL),
        schema,
        system,
        prompt,
        providerOptions,
        maxOutputTokens: maxOutputTokensFor("strategist", answerTokens),
        maxRetries: 1,
        abortSignal,
        onError,
      }),
    { timeoutMs }
  );
  const ms = Date.now() - started;

  if (out.status === "ok") {
    const usage = out.usage as { inputTokens?: number; outputTokens?: number } | undefined;
    const inputTokens = usage?.inputTokens ?? 0;
    const outputTokens = usage?.outputTokens ?? 0;
    await recordAiUsage({ callSite, model: STRATEGIST_MODEL, inputTokens, outputTokens });
    if (out.finishReason === "length") {
      reportError(new Error(`${label}: strategist output hit maxOutputTokens`), { route: "lib/strategist-call", phase: label });
    }
    return { ok: true, object: out.object as T, model: STRATEGIST_MODEL, effort, inputTokens, outputTokens, finishReason: String(out.finishReason), ms };
  }

  if (out.status === "timeout") {
    // An aborted stream reports no usage; the tokens Anthropic billed up to
    // the abort are not known here.
    return {
      ok: false,
      reason: "timeout",
      message: `Zeitlimit nach ${Math.round(ms / 1000)} s erreicht (effort ${effort}).`,
      ...base,
      ms,
    };
  }

  const cause = out.error;
  reportError(cause, { route: "lib/strategist-call", phase: label });
  const message = cause instanceof Error ? cause.message : String(cause);
  // A response that ended without a valid object still cost tokens — record them.
  const failed = NoObjectGeneratedError.isInstance(cause) ? cause : null;
  const inputTokens = failed?.usage?.inputTokens ?? 0;
  const outputTokens = failed?.usage?.outputTokens ?? 0;
  if (inputTokens > 0 || outputTokens > 0) {
    await recordAiUsage({ callSite, model: STRATEGIST_MODEL, inputTokens, outputTokens });
  }
  const truncated = failed?.finishReason === "length" || /max_tokens|maxOutputTokens/i.test(message);
  return {
    ok: false,
    reason: truncated ? "truncated" : failed ? "invalid" : "model_error",
    message: message.slice(0, 300),
    ...base,
    inputTokens,
    outputTokens,
    ms,
  };
}
