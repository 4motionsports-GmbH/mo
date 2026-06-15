import {
  streamText,
  convertToModelMessages,
  type UIMessage,
  type ModelMessage,
} from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import {
  browsingPivotNote,
  buildSystemPrompt,
  productPivotNote,
  type ProductContext,
} from "@/lib/system-prompt";
import { resolveBrowsingContext, type BrowsingContext } from "@/lib/browsing-context";
import { resolveChatMemory } from "@/lib/customer-memory";
import { buildChatTools, MAX_EMAIL_OFFERS_PER_CONVERSATION } from "@/lib/tools";
import { shouldForceEmailOfferStep } from "@/lib/email-offer-trigger.mjs";
import { deriveArchetype } from "@/lib/persona";
import { retrieveForTurn } from "@/lib/retrieval";
import { getProductById, getProductsByIds } from "@/lib/product-catalog";
import { EMPTY_PROFILE, type CustomerProfile, type PersonaArchetype, type UpdateCustomerProfileArgs } from "@/lib/types";
import { corsHeaders, guardRequest, preflightResponse } from "@/lib/security";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { errorResponse, reportError } from "@/lib/observability";
import { persistTurn, ensureConversationStarted, type ToolInvocation } from "@/lib/conversation-store";
import {
  KPI_EMAIL_CAPTURE_ASK_SHOWN,
  hasDeclinedEmailCapture,
  recordKpiEvent,
} from "@/lib/kpi-events";

// This route runs on the Node.js runtime (the Next.js default — we do not set
// `runtime = "edge"`). Node + Vercel Fluid Compute streams the SSE body
// token-by-token just as well as Edge for this route, and Node is required by
// our stack here (Sentry, the Neon driver, post-stream persistence). It also
// means `maxDuration` below actually applies — that knob governs Node/Fluid
// functions, not Edge.
//
// Longer/complex consultations were terminating early at the old 60s cap. With
// Fluid Compute (now the default — see the catalog-sync cron already at 300s),
// the Hobby/Free tier reliably allows up to 300s, so we raise to the ceiling.
// FREE-TIER LIMIT — raise to 800 once on Vercel Pro.
export const maxDuration = 300;

const MAX_MESSAGES_PER_CONVERSATION = 40;

// The chat model id — referenced both in the streamText call and when recording
// token usage for the cost KPI, so the two can never drift apart.
const CHAT_MODEL = "claude-sonnet-4-6";

// Step budget of the agentic loop (was `stopWhen: stepCountIs(6)`). The
// custom stop condition below grants ONE extra step beyond this only when the
// deterministic email-offer step is still pending (add_to_cart landed on the
// very last budgeted step), so the offer guarantee can't be starved by the
// step cap.
const MAX_STEPS_PER_TURN = 6;

// Tool names called so far in THIS turn's steps — input to the deterministic
// email-offer trigger (see prepareStep / stopWhen in POST below). Typed
// structurally so it works with the route's concrete StepResult generic.
function turnToolNames(
  steps: ReadonlyArray<{ toolCalls?: ReadonlyArray<{ toolName: string }> }>
): string[] {
  return steps.flatMap((s) => (s.toolCalls ?? []).map((tc) => tc.toolName));
}

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

function countEmailSummaryOffers(messages: UIMessage[]): number {
  // Count prior offer_email_summary tool calls the same way extractProfile
  // replays profile patches: straight from the message history, so the two-ask
  // cap is a pure function of the conversation rather than separate state.
  let count = 0;
  for (const msg of messages) {
    if (msg.role !== "assistant") continue;
    for (const part of msg.parts ?? []) {
      if (part.type.startsWith("tool-offer_email_summary")) count++;
    }
  }
  return count;
}

// Optional context the widget attaches when the chat was opened from a
// specific product page (`type: "product"`) and/or with a small recently-
// viewed browsing trail (`recentlyViewed`, also valid standalone as
// `type: "browsing"`). Shape is intentionally loose here — it crosses a
// public network boundary, so we validate it in `resolveProductContext` /
// `resolveBrowsingContext`. PRIVACY: the trail only ever arrives as part of
// a chat request the user initiated — conversation input, not tracking; it
// seeds the live conversation and is never stored as a profile.
interface ChatRequestContext {
  type?: string;
  productId?: unknown;
  productTitle?: unknown;
  recentlyViewed?: unknown;
}

// Optional re-identification the widget attaches ONLY after a successful
// /api/capture-email in THIS chat session (kept in widget memory, never read
// back from localStorage on a fresh open). Loose shape — public boundary; the
// real gate is server-side in `resolveCustomerMemory`, which also verifies the
// capture actually came from this session id. A forged/garbage value resolves
// to no memory, never to an error.
interface ChatRequestCustomer {
  email?: unknown;
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

// Append a lightweight pivot note to the latest user turn (in-conversation),
// keeping prior history intact and preserving Anthropic's role alternation.
function appendPivotNote(messages: ModelMessage[], note: string): void {
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

    let body: {
      messages?: UIMessage[];
      context?: ChatRequestContext;
      customer?: ChatRequestCustomer;
      // Per-THREAD key (migration 0018): a stable, client-generated value that
      // identifies WHICH conversation under this (stable) session_id this turn
      // belongs to. "Neue Beratung" = a fresh key; resuming a past thread sends
      // the `conversationKey` returned by /api/account/conversations. Absent →
      // defaults to the session id server-side (legacy one-thread-per-session).
      conversationKey?: unknown;
    };
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return errorResponse("bad_request", "Invalid JSON body", 400, cors);
    }
    const messages = body.messages;
    // Bound the client-supplied thread key (it lands in a unique-indexed column).
    const conversationKey =
      typeof body.conversationKey === "string" && body.conversationKey.trim()
        ? body.conversationKey.trim().slice(0, 200)
        : null;

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

    // Customer memory — PRIVACY GATE (two paths, both fail-closed):
    //   * SIGNED-IN (tier 3): the authenticated session itself is the
    //     re-identification (a live access token is required); the greeting uses
    //     the session's own identity, and history-personalisation is gated on the
    //     same personalisation consent as tier 2.
    //   * EMAIL-identified (tier 2): resolved only from an email the user
    //     provided IN THIS session (the widget attaches it after a successful
    //     capture here) AND verified by the server to have been captured from
    //     this session id — NEVER from the localStorage session id alone, so a
    //     shared/family/public browser can't surface someone else's history.
    // Anonymous sessions resolve to no memory.
    const claimedEmail =
      typeof body.customer?.email === "string" ? body.customer.email.trim() : "";

    // Email-summary ask cap (value-triggered capture): how often the offer was
    // already made in this conversation, and whether the email is already in.
    // `claimedEmail` is only ever attached by the widget after a successful
    // capture in THIS session, so its presence means "captured" for gating
    // purposes (a forged claim merely suppresses the offer — harmless). Once
    // the cap is hit or the email captured, the tool is withheld entirely so
    // a third ask is impossible regardless of what the model does.
    const emailOffersMade = countEmailSummaryOffers(messages);
    const emailCaptured = Boolean(claimedEmail);
    const allowEmailSummaryOffer =
      !emailCaptured && emailOffersMade < MAX_EMAIL_OFFERS_PER_CONVERSATION;

    // The latest user message of this turn — seeds the eager conversation row's
    // cached title + is persisted up-front (durability), see below.
    const latestUserMessage = (() => {
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === "user") return messages[i];
      }
      return null;
    })();

    const [hits, customerMemory, emailOfferDeclined] = await Promise.all([
      latestUserText
        ? retrieveForTurn({ latestUserMessage: latestUserText, profile, limit: 8 })
        : Promise.resolve([]),
      resolveChatMemory({ sessionId, email: claimedEmail || null }),
      // Whether the user dismissed a capture card in this session (a UI click
      // the message history never shows — only the widget's KPI event records
      // it). Gates the deterministic email-offer trigger below: after an
      // explicit decline the backend never FORCES another ask. Only consulted
      // while an offer is still possible at all.
      allowEmailSummaryOffer
        ? hasDeclinedEmailCapture(sessionId)
        : Promise.resolve(true),
      // EAGER CREATE (concurrent with retrieval, best-effort, result unused): a
      // started conversation is durably created + customer-linked NOW, before the
      // stream — so a "Neue Beratung" thread appears in the signed-in history
      // immediately and survives a reload even if the answer never lands. Only
      // when a user turn exists (a bare greeting open mints no listed thread, like
      // ChatGPT). The onFinish persistTurn fills in the assistant turn on the same
      // row. See lib/conversation-create + docs/CUSTOMER_ACCOUNT.md §7.6.
      latestUserMessage
        ? ensureConversationStarted({
            sessionId,
            conversationKey,
            personaLabel: archetype ?? "unknown",
            messageCount: messages.length,
            userText: latestUserText,
            userMessageId:
              typeof latestUserMessage.id === "string" ? latestUserMessage.id : null,
          })
        : Promise.resolve(null),
    ]);
    // Optional product context (chat opened "about" a product) and/or
    // browsing context (small recently-viewed trail brought along by the
    // user). Both validated against the catalog; unknown/absent ids leave
    // everything unchanged.
    const productContext = await resolveProductContext(body.context);
    const browsingContext =
      body.context?.type === "product" || body.context?.type === "browsing"
        ? await resolveBrowsingContext(body.context.recentlyViewed, {
            excludeProductId: productContext?.id,
          })
        : undefined;

    // Ground the context products in the pre-retrieved block so a contextual
    // first message ("Ist das gut für Zuhause?" sent from a product page) gets
    // a specific answer about THAT product — specs and the sold-out flag are
    // visible without a tool roundtrip. Context products lead; semantic hits
    // follow, deduped.
    const contextProductIds = [
      ...(productContext ? [productContext.id] : []),
      ...(browsingContext?.products.map((p) => p.id) ?? []),
    ];
    const contextProducts =
      contextProductIds.length > 0 ? await getProductsByIds(contextProductIds) : [];
    const retrievedProducts = [
      ...contextProducts,
      ...hits.map((h) => h.product).filter((p) => !contextProductIds.includes(p.id)),
    ];
    const modelMessages = await convertToModelMessages(messages);

    let greetingContext: ProductContext | undefined;
    let greetingBrowsingContext: BrowsingContext | undefined;
    if (messages.length === 0 && (productContext || browsingContext)) {
      // Fresh open: seed the greeting as a system-level note and add a
      // minimal, server-internal trigger turn so the model actually emits
      // the opener. The trigger is never streamed back nor stored by the
      // widget (it sent an empty conversation), so no fake user message
      // lands in the rendered history — the greeting is just an extra seed.
      // When both contexts are present, the product-page greeting wins and
      // the browsing trail becomes background info (see system-prompt.ts).
      greetingContext = productContext;
      greetingBrowsingContext = browsingContext;
      modelMessages.push({
        role: "user",
        content: productContext
          ? `[System: Chat auf der Produktseite von "${productContext.name}" geöffnet — begrüße den Nutzer.]`
          : `[System: Chat geöffnet, nachdem sich der Nutzer im Shop umgesehen hat — begrüße den Nutzer.]`,
      });
    } else if (messages.length > 0) {
      // Existing conversation (including a starter prompt sent as the first
      // message): pivot via lightweight in-conversation notes appended to the
      // latest user turn, leaving prior history intact — never wiped.
      if (productContext) appendPivotNote(modelMessages, productPivotNote(productContext));
      if (browsingContext) appendPivotNote(modelMessages, browsingPivotNote(browsingContext));
    }

    // The full tool set is always built (stable type for the forced-offer
    // prepareStep below); offer_email_summary is withheld from the model via
    // `activeTools` once the ask cap is reached or the email was captured —
    // an inactive tool is filtered out before the provider call, so "never a
    // third ask" stays a server-side guarantee, not a prompt instruction.
    const tools = buildChatTools(profile);
    const defaultActiveTools = (
      allowEmailSummaryOffer
        ? Object.keys(tools)
        : Object.keys(tools).filter((name) => name !== "offer_email_summary")
    ) as Array<keyof typeof tools>;

    const result = streamText({
      model: anthropic(CHAT_MODEL),
      system: buildSystemPrompt({
        profile,
        archetype,
        retrievedProducts,
        productContext: greetingContext,
        browsingContext: greetingBrowsingContext,
        customerMemory: customerMemory ?? undefined,
        emailOffer: {
          offersMade: emailOffersMade,
          emailCaptured,
        },
      }),
      messages: modelMessages,
      tools,
      activeTools: defaultActiveTools,
      // DETERMINISTIC EMAIL-OFFER TRIGGER (highest-intent moment): when this
      // turn has produced an add_to_cart (direct-checkout) call and the model
      // did not offer the email summary on its own, force the next step's
      // toolChoice to offer_email_summary — exactly one extra model step, so
      // the invitation text stays AI-written (the tool's `message` input) and
      // in-context. Prompt wording alone proved unreliable here: the
      // persona's anti-pushiness rules made the model consistently skip the
      // soft ask at checkout. shouldForceEmailOfferStep keeps every existing
      // rule intact: never once the email is captured, never past the two-ask
      // cap (the forced ask COUNTS as one of the two — it streams as a normal
      // tool call, so countEmailSummaryOffers and the ask-shown KPI below
      // pick it up like any other offer), and never after the user declined a
      // capture card (widget-reported KPI event). When it fires, the tool is
      // guaranteed present in the tool set: the trigger's gates are a strict
      // subset of allowEmailSummaryOffer.
      prepareStep: ({ steps }) => {
        const force = shouldForceEmailOfferStep({
          emailCaptured,
          offersMade: emailOffersMade,
          declined: emailOfferDeclined,
          toolNamesCalled: turnToolNames(steps),
        });
        if (!force) return undefined;
        return {
          toolChoice: { type: "tool", toolName: "offer_email_summary" },
          activeTools: ["offer_email_summary"],
        };
      },
      stopWhen: ({ steps }) => {
        if (steps.length < MAX_STEPS_PER_TURN) return false;
        // Budget reached: allow one extra step only for a pending forced
        // email offer (add_to_cart landed on the last budgeted step).
        const offerPending = shouldForceEmailOfferStep({
          emailCaptured,
          offersMade: emailOffersMade,
          declined: emailOfferDeclined,
          toolNamesCalled: turnToolNames(steps),
        });
        return !offerPending || steps.length > MAX_STEPS_PER_TURN;
      },
      onError: ({ error }) => {
        reportError(error, {
          route: "api/chat",
          messageCount,
          archetype,
          phase: "stream",
        });
      },
      onFinish: async ({ text, steps, response, totalUsage }) => {
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
            conversationKey,
            history: messages,
            personaLabel: archetype ?? "unknown",
            assistantText: text ?? "",
            assistantToolCalls: toolCalls,
            assistantMessageId: response.id,
            // `totalUsage` aggregates input/output tokens across all agentic
            // steps this turn (ai@6 LanguageModelUsage; fields may be undefined,
            // so coalesce to 0). Recorded for the cost-per-consultation KPI.
            usage: {
              model: CHAT_MODEL,
              inputTokens: totalUsage?.inputTokens ?? 0,
              outputTokens: totalUsage?.outputTokens ?? 0,
            },
          });

          // Funnel telemetry: one pseudonymous event per email-summary offer
          // made in this turn, carrying the value moment that triggered it and
          // which ask (1st or 2nd) it was. recordKpiEvent never throws.
          let askNumber = emailOffersMade;
          for (const tc of toolCalls) {
            if (tc.toolName !== "offer_email_summary") continue;
            askNumber += 1;
            const input = tc.input as { trigger?: unknown } | undefined;
            await recordKpiEvent({
              sessionId,
              event: KPI_EMAIL_CAPTURE_ASK_SHOWN,
              data: {
                trigger:
                  typeof input?.trigger === "string" ? input.trigger : "unspecified",
                askNumber,
              },
            });
          }
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
    //
    // STREAMING SMOOTHNESS: we do NOT buffer on our side — `streamText` +
    // `toUIMessageStreamResponse()` pipe each UI-message chunk straight to the
    // client as the model emits it (the `onFinish` persistence above runs
    // AFTER generation and never delays token delivery). The only place a token
    // could get held back is an upstream reverse proxy / CDN buffering the SSE
    // body before forwarding. We disable that with explicit headers so chunks
    // flush as they arrive:
    //   - X-Accel-Buffering: no   → tells nginx-style proxies (incl. Vercel's
    //                               edge layer) not to buffer the response.
    //   - Cache-Control: no-cache, no-transform → no caching, and crucially
    //     `no-transform` stops any proxy from re-chunking/compressing the body
    //     (compression forces buffering of the whole stream).
    // NB: this removes OUR buffering only. Perceived smoothness is still bound
    // by the model's own token rate and the current Vercel hosting tier — we
    // can stop holding tokens back, but we cannot make the model emit faster.
    return result.toUIMessageStreamResponse({
      headers: {
        ...cors,
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (err) {
    reportError(err, { route: "api/chat", messageCount, archetype });
    return errorResponse("internal_error", "Unexpected server error", 500, cors);
  }
}
