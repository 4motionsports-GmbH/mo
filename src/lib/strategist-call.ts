// One structured-output call on the `strategist` tier (lib/ai-models.mjs —
// Opus 5.5, adaptive thinking, effort high, refusal fallback), made safe for
// a serverless step:
//
//   · structured output through `output_config.format` (generateObject /
//     streamObject with a zod schema) — Opus 5.5 rejects a forced tool choice,
//     and @ai-sdk/anthropic ≥ 3.0.125 uses the native format for it;
//   · streamed, so the HTTP response starts at once and a long thinking phase
//     never runs into a response-headers timeout;
//   · bounded: maxOutputTokens = the answer budget plus the tier's thinking
//     headroom (thinking counts toward max_tokens), an AbortSignal timeout
//     below the route's maxDuration, at most one SDK retry;
//   · the effort can be lowered for a retry after a timeout (the caller owns
//     the ladder — analytics-report-synthesis-core STRATEGIST_EFFORTS);
//   · usage recorded in ai_usage under the caller's call site.
//
// Never throws: the result says why it failed (no key, timeout, truncated,
// refused/invalid output, model error). Used by the Komplettanalyse; the
// Verbesserung can use it the same way.

import { NoObjectGeneratedError, streamObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import type { z } from "zod";
import { anthropicOptionsFor, maxOutputTokensFor, modelFor } from "./ai-models.mjs";
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

function isAbort(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const name = (err as { name?: string }).name ?? "";
  if (name === "AbortError" || name === "TimeoutError") return true;
  const cause = (err as { cause?: unknown }).cause;
  return cause ? isAbort(cause) : false;
}

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
  const abortSignal = AbortSignal.timeout(timeoutMs);
  let streamError: unknown = null;

  try {
    const result = streamObject({
      model: anthropic(STRATEGIST_MODEL),
      schema,
      system,
      prompt,
      providerOptions,
      maxOutputTokens: maxOutputTokensFor("strategist", answerTokens),
      maxRetries: 1,
      abortSignal,
      onError: ({ error }) => {
        streamError = error;
      },
    });
    const [object, usage, finishReason] = await Promise.all([result.object, result.usage, result.finishReason]);
    const inputTokens = usage?.inputTokens ?? 0;
    const outputTokens = usage?.outputTokens ?? 0;
    await recordAiUsage({ callSite, model: STRATEGIST_MODEL, inputTokens, outputTokens });
    if (finishReason === "length") {
      reportError(new Error(`${label}: strategist output hit maxOutputTokens`), { route: "lib/strategist-call", phase: label });
    }
    return { ok: true, object, model: STRATEGIST_MODEL, effort, inputTokens, outputTokens, finishReason: String(finishReason), ms: Date.now() - started };
  } catch (err) {
    const ms = Date.now() - started;
    const cause = streamError ?? err;
    if (abortSignal.aborted || isAbort(cause)) {
      return {
        ok: false,
        reason: "timeout",
        message: `Zeitlimit nach ${Math.round(ms / 1000)} s erreicht (effort ${effort}).`,
        ...base,
        ms,
      };
    }
    reportError(cause, { route: "lib/strategist-call", phase: label });
    const message = cause instanceof Error ? cause.message : String(cause);
    // A response that ended without a valid object still cost tokens — record them.
    const failed = NoObjectGeneratedError.isInstance(cause) ? cause : NoObjectGeneratedError.isInstance(err) ? err : null;
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
}
