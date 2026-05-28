import { streamText, stepCountIs, convertToModelMessages, type UIMessage } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { buildSystemPrompt } from "@/lib/system-prompt";
import { buildChatTools } from "@/lib/tools";
import { deriveArchetype } from "@/lib/persona";
import { retrieveForTurn } from "@/lib/retrieval";
import { EMPTY_PROFILE, type CustomerProfile, type PersonaArchetype, type UpdateCustomerProfileArgs } from "@/lib/types";
import { corsHeaders, guardRequest, preflightResponse } from "@/lib/security";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { errorResponse, reportError } from "@/lib/observability";

export const maxDuration = 60;

const MAX_MESSAGES_PER_CONVERSATION = 40;

function mergeProfile(prev: CustomerProfile, patch: UpdateCustomerProfileArgs): CustomerProfile {
  // Merge a profile patch onto the previous profile. Empty/undefined fields
  // in the patch leave the previous value intact.
  return {
    segment: patch.segment ?? prev.segment,
    experienceLevel: patch.experienceLevel ?? prev.experienceLevel,
    trainingFocus: patch.trainingFocus ?? prev.trainingFocus,
    spaceM2: patch.spaceM2 ?? prev.spaceM2,
    budgetEUR: patch.budgetEUR ?? prev.budgetEUR,
    trainingFrequency: patch.trainingFrequency ?? prev.trainingFrequency,
    housing: patch.housing ?? prev.housing,
    noiseSensitive: patch.noiseSensitive ?? prev.noiseSensitive,
    procurementNeeds: patch.procurementNeeds ?? prev.procurementNeeds,
    confidence: patch.confidence ?? prev.confidence,
  };
}

function extractProfile(messages: UIMessage[]): CustomerProfile {
  // Walk all messages in order, replay every update_customer_profile tool call
  // onto an empty profile to get the current view. This makes the profile a
  // pure function of message history — no separate session state needed.
  let profile: CustomerProfile = { ...EMPTY_PROFILE };
  for (const msg of messages) {
    if (msg.role !== "assistant") continue;
    for (const part of msg.parts ?? []) {
      const t = part.type;
      if (t !== "tool-update_customer_profile" && !t.startsWith("tool-update_customer_profile")) continue;
      const tp = part as { input?: UpdateCustomerProfileArgs };
      if (!tp.input) continue;
      profile = mergeProfile(profile, tp.input);
    }
  }
  return profile;
}

function getLatestUserText(messages: UIMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "user") continue;
    const texts = (m.parts ?? [])
      .filter((p) => p.type === "text")
      .map((p) => (p as { type: "text"; text: string }).text);
    if (texts.length) return texts.join(" ");
  }
  return "";
}

export async function OPTIONS(req: Request) {
  return preflightResponse(req);
}

export async function POST(req: Request) {
  const guard = guardRequest(req);
  if (!guard.ok) return guard.response;
  const cors = corsHeaders(guard.origin);

  let messageCount = 0;
  let archetype: PersonaArchetype | undefined;

  try {
    const rl = await checkRateLimit(req, "chat");
    if (!rl.ok) return rateLimitResponse(rl.retryAfter, cors);

    let body: { messages?: UIMessage[] };
    try {
      body = (await req.json()) as { messages?: UIMessage[] };
    } catch {
      return errorResponse("bad_request", "Invalid JSON body", 400, cors);
    }
    const messages = body.messages;

    if (!Array.isArray(messages)) {
      return errorResponse("bad_request", "messages must be an array", 400, cors);
    }
    messageCount = messages.length;
    if (messages.length > MAX_MESSAGES_PER_CONVERSATION) {
      return errorResponse(
        "payload_too_large",
        `Conversation too long (max ${MAX_MESSAGES_PER_CONVERSATION} messages). Please start a new chat.`,
        400,
        cors
      );
    }

    const profile = extractProfile(messages);
    archetype = deriveArchetype(profile);
    const latestUserText = getLatestUserText(messages);

    const hits = latestUserText
      ? await retrieveForTurn({ latestUserMessage: latestUserText, profile, limit: 8 })
      : [];
    const retrievedProducts = hits.map((h) => h.product);

    const result = streamText({
      model: anthropic("claude-sonnet-4-5-20250929"),
      system: buildSystemPrompt({ profile, archetype, retrievedProducts }),
      messages: await convertToModelMessages(messages),
      tools: buildChatTools(profile),
      stopWhen: stepCountIs(6),
      onError: ({ error }) => {
        reportError(error, {
          route: "api/chat",
          messageCount,
          archetype,
          phase: "stream",
        });
      },
    });

    // CORS on streaming responses: Next.js' Response is constructed from a
    // ReadableStream once we hand it off here, so the Access-Control-* headers
    // MUST be passed through `toUIMessageStreamResponse({ headers })` — they
    // are not inherited from any earlier response object and would not be
    // attached to chunks emitted after the initial flush otherwise. Browsers
    // enforce CORS on the *response* the stream is delivered through, not on
    // individual SSE chunks, but the headers still have to be on that
    // response. Hence we always merge `cors` into the stream response below.
    return result.toUIMessageStreamResponse({ headers: cors });
  } catch (err) {
    reportError(err, { route: "api/chat", messageCount, archetype });
    return errorResponse("internal_error", "Unexpected server error", 500, cors);
  }
}
