import {
  streamText,
  stepCountIs,
  convertToModelMessages,
  type UIMessage,
  type ModelMessage,
} from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { buildSystemPrompt, productPivotNote, type ProductContext } from "@/lib/system-prompt";
import { buildChatTools } from "@/lib/tools";
import { deriveArchetype } from "@/lib/persona";
import { retrieveForTurn } from "@/lib/retrieval";
import { getProductById } from "@/lib/product-catalog";
import { EMPTY_PROFILE, type CustomerProfile, type PersonaArchetype, type UpdateCustomerProfileArgs } from "@/lib/types";
import { corsHeaders, guardRequest, preflightResponse } from "@/lib/security";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { errorResponse, reportError } from "@/lib/observability";
import { persistTurn, type ToolInvocation } from "@/lib/conversation-store";

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

// Optional product context the widget attaches when the chat was opened from a
// specific product page. Shape is intentionally loose here — it crosses a
// public network boundary, so we validate it in `resolveProductContext`.
interface ChatRequestContext {
  type?: string;
  productId?: unknown;
  productTitle?: unknown;
}

async function resolveProductContext(
  context: ChatRequestContext | undefined
): Promise<ProductContext | undefined> {
  if (!context || context.type !== "product") return undefined;
  const id = typeof context.productId === "string" ? context.productId.trim() : "";
  if (!id) return undefined;
  // Validate against the live catalog. Unknown ids are ignored gracefully so a
  // stale storefront link can never inject a bogus product into the prompt.
  const product = await getProductById(id);
  if (!product) return undefined;
  // Trust the catalog's canonical name over the client-supplied title.
  return { id: product.id, name: product.name };
}

// Append the lightweight pivot note to the latest user turn (in-conversation),
// keeping prior history intact and preserving Anthropic's role alternation.
function appendPivotNote(messages: ModelMessage[], ctx: ProductContext): void {
  const note = productPivotNote(ctx);
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "user") continue;
    if (typeof m.content === "string") {
      m.content = m.content ? `${m.content}\n\n${note}` : note;
    } else {
      m.content = [...m.content, { type: "text", text: note }];
    }
    return;
  }
  // No user turn found (unexpected) — fall back to a standalone note turn.
  messages.push({ role: "user", content: note });
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
  const sessionId = req.headers.get("x-ms-session");

  try {
    const rl = await checkRateLimit(req, "chat");
    if (!rl.ok) return rateLimitResponse(rl.retryAfter, cors);

    let body: { messages?: UIMessage[]; context?: ChatRequestContext };
    try {
      body = (await req.json()) as { messages?: UIMessage[]; context?: ChatRequestContext };
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

    // Optional product context (chat opened "about" a product). Validated
    // against the catalog; unknown/absent ids leave everything unchanged.
    const productContext = await resolveProductContext(body.context);
    const modelMessages = await convertToModelMessages(messages);

    let greetingContext: ProductContext | undefined;
    if (productContext) {
      if (messages.length === 0) {
        // Fresh open: seed the greeting as a system-level note and add a
        // minimal, server-internal trigger turn so the model actually emits
        // the opener. The trigger is never streamed back nor stored by the
        // widget (it sent an empty conversation), so no fake user message
        // lands in the rendered history — the greeting is just an extra seed.
        greetingContext = productContext;
        modelMessages.push({
          role: "user",
          content: `[System: Chat auf der Produktseite von "${productContext.name}" geöffnet — begrüße den Nutzer.]`,
        });
      } else {
        // Existing conversation: pivot via a lightweight in-conversation note
        // appended to the latest user turn, leaving prior history intact.
        appendPivotNote(modelMessages, productContext);
      }
    }

    const result = streamText({
      model: anthropic("claude-sonnet-4-5-20250929"),
      system: buildSystemPrompt({ profile, archetype, retrievedProducts, productContext: greetingContext }),
      messages: modelMessages,
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
      onFinish: async ({ text, steps, response }) => {
        // Persist the completed turn AFTER generation, so this never delays
        // token delivery. persistTurn is fully self-contained (best-effort,
        // logs and swallows on failure) — but guard here too so a thrown
        // error can't escape the stream pipeline and break the response.
        try {
          const toolCalls: ToolInvocation[] = steps.flatMap((s) =>
            (s.toolCalls ?? []).map((tc) => ({
              toolName: tc.toolName,
              input: (tc as { input?: unknown }).input,
            }))
          );
          await persistTurn({
            sessionId,
            history: messages,
            personaLabel: archetype ?? "unknown",
            assistantText: text ?? "",
            assistantToolCalls: toolCalls,
            assistantMessageId: response.id,
          });
        } catch (err) {
          reportError(err, { route: "api/chat", phase: "persist", messageCount });
        }
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
