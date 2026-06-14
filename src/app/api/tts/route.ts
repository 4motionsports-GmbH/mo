import OpenAI from "openai";
import { corsHeaders, guardRequest, preflightResponse } from "@/lib/security";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { errorResponse, reportError } from "@/lib/observability";
import { recordAiUsage } from "@/lib/ai-usage-store";
import { getConversationIdBySession } from "@/lib/conversation-store";
import { MAX_TTS_CHARS, prepareTtsText } from "@/lib/tts-text.mjs";

// Node runtime (Next.js default — we do not set `runtime = "edge"`): the OpenAI
// SDK and the best-effort Neon usage write need Node. Synthesis of a single
// (≤2000-char) message is fast, but allow headroom for the upstream call.
export const maxDuration = 60;

// Model + voice are env-overridable so prices/voices can move without a deploy.
//
// MODEL: gpt-4o-mini-tts — OpenAI's current cost-efficient TTS model
// (multilingual, steerable via `instructions`, ~$15.9 / 1M characters as of
// 2026-06; see lib/ai-pricing.mjs).
//
// VOICE: alloy — a neutral, gender-neutral voice that the multilingual
// gpt-4o-mini-tts pronounces cleanly in German. We steer accent/tone toward
// natural Hochdeutsch with `instructions` below. Warmer alternatives (nova,
// coral, shimmer) are available by setting TTS_VOICE.
const TTS_MODEL = process.env.TTS_MODEL?.trim() || "gpt-4o-mini-tts";
const TTS_VOICE = process.env.TTS_VOICE?.trim() || "alloy";
const TTS_INSTRUCTIONS =
  process.env.TTS_INSTRUCTIONS?.trim() ||
  "Sprich natürliches, klares Hochdeutsch in einem freundlichen, hilfsbereiten Ton.";

// `instructions` is only honoured by the steerable gpt-4o(-mini)-tts models;
// the older tts-1 / tts-1-hd models reject it. Gate on the model family so
// overriding TTS_MODEL to a legacy model can't 400 the whole request.
const SUPPORTS_INSTRUCTIONS = TTS_MODEL.startsWith("gpt-4o");

// SPEAKING RATE (configurable). A slightly faster voice improves perceived
// responsiveness in streaming mode (the audio "keeps up" with the streamed
// text), so the rate is env-overridable. The two TTS model families take the
// rate differently:
//   * legacy tts-1 / tts-1-hd accept the numeric `speed` param (0.25–4.0);
//   * the steerable gpt-4o(-mini)-tts models REJECT `speed` and are instead
//     steered via `instructions` — so we fold a tempo hint into the prompt.
// Default 1.0 leaves the full-message fallback path byte-for-byte unchanged.
const TTS_SPEED = (() => {
  const raw = Number.parseFloat(process.env.TTS_SPEED ?? "");
  if (!Number.isFinite(raw)) return 1.0;
  return Math.min(4.0, Math.max(0.25, raw));
})();
const SUPPORTS_SPEED = !SUPPORTS_INSTRUCTIONS;

// Build the steering instructions for gpt-4o models, folding in a tempo hint
// when TTS_SPEED departs from the default. (No-op for legacy models — they get
// the numeric `speed` param instead.)
function buildInstructions(): string {
  let instr = TTS_INSTRUCTIONS;
  if (TTS_SPEED >= 1.05) instr += " Sprich in einem zügigen, aber gut verständlichen Tempo.";
  else if (TTS_SPEED <= 0.95) instr += " Sprich in einem ruhigen, langsameren Tempo.";
  return instr;
}

// OUTPUT FORMAT: MP3 (Content-Type audio/mpeg). Chosen for the broadest mobile
// playback. Opus would be smaller / lower-latency, but iOS Safari does NOT
// decode Opus in an Ogg/WebM container via <audio>, which is exactly the
// fallback we're trying to avoid forcing on mobile users. MP3 plays everywhere
// (iOS Safari, Android Chrome, desktop) with zero container caveats.
const RESPONSE_FORMAT = "mp3" as const;
const CONTENT_TYPE = "audio/mpeg";

// Headers the widget reads cross-origin: whether we truncated the input and how
// many characters we actually synthesized. Must be CORS-exposed (see corsHeaders).
const TRUNCATED_HEADER = "X-MS-TTS-Truncated";
const CHARS_HEADER = "X-MS-TTS-Chars";
// Echoes the caller's chunk index in streaming mode so the widget can correlate
// each (independently-completing) audio response back to its place in the
// sentence queue without relying on response arrival order. Absent / "-1" for
// non-streaming single-shot calls. CORS-exposed.
const SEQ_HEADER = "X-MS-TTS-Seq";
const EXPOSE_HEADERS = [TRUNCATED_HEADER, CHARS_HEADER, SEQ_HEADER];

let openaiClient: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!openaiClient) openaiClient = new OpenAI();
  return openaiClient;
}

export async function OPTIONS(req: Request) {
  return preflightResponse(req);
}

export async function POST(req: Request) {
  // Auth/protection identical to the other secret-guarded widget routes
  // (/api/chat, /api/contact): origin allowlist + x-ms-chat-key shared secret.
  const guard = guardRequest(req);
  if (!guard.ok) return guard.response;
  const cors = corsHeaders(guard.origin, "POST, OPTIONS", EXPOSE_HEADERS);
  const sessionId = req.headers.get("x-ms-session");

  try {
    let body: { text?: unknown; stream?: unknown; seq?: unknown };
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return errorResponse("bad_request", "Invalid JSON body", 400, cors);
    }

    // STREAMING MODE (item 3): the widget detects sentence boundaries in the
    // streamed chat text and fires this endpoint once per sentence, queuing the
    // returned MP3 clips so audio starts ~1s after the FIRST sentence instead of
    // after the whole answer. Same auth/origin/synthesis/usage as the
    // single-shot path — only the rate-limit bucket differs (sentence-level
    // granularity = more requests per played answer; see lib/rate-limit.ts).
    // Any falsy/absent `stream` keeps the existing single-shot full-message
    // behaviour the browser-speechSynthesis fallback also relies on.
    const streaming = body.stream === true || body.stream === "true" || body.stream === 1;
    // Optional caller chunk index, echoed back so the widget can order async
    // responses. Bounded to a sane non-negative integer; anything else → -1.
    const seq = Number.isFinite(body.seq) && (body.seq as number) >= 0
      ? Math.floor(body.seq as number)
      : -1;

    // Rate-limit on the bucket matching the mode, keyed by x-ms-session (IP
    // fallback): single-shot 20/5min, streaming 120/5min.
    const rl = await checkRateLimit(req, streaming ? "tts-stream" : "tts");
    if (!rl.ok) return rateLimitResponse(rl.retryAfter, cors);

    if (typeof body.text !== "string") {
      return errorResponse("bad_request", "Field 'text' (string) is required", 400, cors);
    }

    // Strip Markdown so nothing is read aloud as punctuation, then enforce the
    // server-side character cap by truncating at a sentence boundary. An empty
    // body (or one that is only Markdown punctuation) is rejected.
    const { text, truncated, empty } = prepareTtsText(body.text, MAX_TTS_CHARS);
    if (empty) {
      return errorResponse("bad_request", "Text is empty after cleaning", 400, cors);
    }

    if (!process.env.OPENAI_API_KEY) {
      // No key configured → signal the documented upstream fallback code so the
      // widget drops to the browser's speechSynthesis instead of failing hard.
      return errorResponse(
        "upstream_unavailable",
        "Text-to-speech is unavailable",
        502,
        cors
      );
    }

    let upstream: Response;
    try {
      upstream = await getOpenAI().audio.speech.create({
        model: TTS_MODEL,
        voice: TTS_VOICE,
        input: text,
        response_format: RESPONSE_FORMAT,
        // Speaking rate (configurable, default 1.0): the steerable gpt-4o
        // models take it as a prompt hint folded into `instructions`; the
        // legacy tts-1 family takes the numeric `speed` param (and rejects
        // `instructions`). Gate each so neither can 400 the other's model.
        ...(SUPPORTS_INSTRUCTIONS ? { instructions: buildInstructions() } : {}),
        ...(SUPPORTS_SPEED ? { speed: TTS_SPEED } : {}),
      });
    } catch (err) {
      // Upstream synthesis failed. Return the documented `upstream_unavailable`
      // code (502) the widget falls back on (browser speechSynthesis), not a
      // generic 500 — this is an expected, recoverable condition.
      reportError(err, { route: "api/tts", phase: "synthesize", model: TTS_MODEL });
      return errorResponse(
        "upstream_unavailable",
        "Text-to-speech is temporarily unavailable",
        502,
        cors
      );
    }

    // Record usage for the cost KPI (S6): characters synthesized, attributed to
    // the conversation. Best-effort and fire-and-forget — it must never delay or
    // break the audio response. NB: for call_site 'tts' the input_tokens column
    // carries CHARACTERS (TTS is billed per character), with estimated=true to
    // flag the unit difference. See lib/ai-usage-store.ts.
    void (async () => {
      try {
        const conversationId = await getConversationIdBySession(sessionId);
        await recordAiUsage({
          callSite: "tts",
          model: TTS_MODEL,
          inputTokens: text.length,
          outputTokens: 0,
          estimated: true,
          conversationId,
        });
      } catch {
        // recordAiUsage already swallows; this guards the lookup too.
      }
    })();

    const headers: Record<string, string> = {
      ...cors,
      "Content-Type": CONTENT_TYPE,
      // Cache OFF: audio is per-session and synthesized on demand.
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      "X-Accel-Buffering": "no",
      [TRUNCATED_HEADER]: truncated ? "true" : "false",
      [CHARS_HEADER]: String(text.length),
      // Echo the caller's chunk index so the widget can slot each async audio
      // response into its playback queue regardless of arrival order.
      [SEQ_HEADER]: String(seq),
    };

    // Stream the audio straight through when the SDK exposes a body stream;
    // otherwise buffer (defensive — the speech endpoint returns a streamable
    // body in practice).
    if (upstream.body) {
      return new Response(upstream.body, { status: 200, headers });
    }
    const buffer = Buffer.from(await upstream.arrayBuffer());
    return new Response(buffer, { status: 200, headers });
  } catch (err) {
    reportError(err, { route: "api/tts" });
    return errorResponse("internal_error", "Unexpected server error", 500, cors);
  }
}
