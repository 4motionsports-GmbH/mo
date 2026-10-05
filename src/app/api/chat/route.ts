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
  greetingTriggerText,
  pageCategoryPivotNote,
  pagePivotNote,
  productPivotNote,
  type ProductContext,
} from "@/lib/system-prompt";
import {
  contextSource,
  countOtherCards,
  countProductCards,
  isPageContextHeldOut,
  pageContextKind,
  planPageContext,
} from "@/lib/page-context.mjs";
import { pageContextHoldoutPct } from "@/lib/page-context";
import { isChatPageContextEnabled } from "@/lib/platform-flags.mjs";
import { resolveLocale } from "@/lib/locale";
import { resolveBrowsingContext, type BrowsingContext } from "@/lib/browsing-context";
import { resolveChatIdentity } from "@/lib/customer-memory";
import { buildChatTools, MAX_EMAIL_OFFERS_PER_CONVERSATION } from "@/lib/tools";
import { shouldForceEmailOfferStep } from "@/lib/email-offer-trigger.mjs";
import { anthropicOptionsFor, modelFor } from "@/lib/ai-models.mjs";
import { sanitizeToolParts } from "@/lib/chat-message-sanitize.mjs";
import { deriveArchetype } from "@/lib/persona";
import { retrieveForTurn } from "@/lib/retrieval";
import { getCachedGeneralQa } from "@/lib/qa-store";
import { getCachedActiveDirectives } from "@/lib/directives-store";
import { getProductById, getProductsByIds, loadProductCatalog } from "@/lib/product-catalog";
import {
  recommendedCardIdsInOrder,
  guardRecommendedCardIds,
} from "@/lib/recommended-products.mjs";
import { EMPTY_PROFILE, type CustomerProfile, type PersonaArchetype, type UpdateCustomerProfileArgs } from "@/lib/types";
import { corsHeaders, guardRequest, preflightResponse } from "@/lib/security";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { errorResponse, reportError } from "@/lib/observability";
import { persistTurn, ensureConversationStarted, type ToolInvocation } from "@/lib/conversation-store";
import { recordCampaignChatStarted } from "@/lib/campaign-store";
import { isOrderStatusEnabledFor } from "@/lib/order-status";
import {
  KPI_EMAIL_CAPTURE_ASK_SHOWN,
  KPI_PAGE_CONTEXT_ANSWERED,
  KPI_PAGE_CONTEXT_APPLIED,
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
// token usage for the cost KPI, so the two can never drift apart. The chat tier
// (lib/ai-models.mjs) runs Sonnet 5.5 with `between_tools` thinking: no
// up-front reasoning pass, so the first token arrives as fast as before.
const CHAT_MODEL = modelFor("chat");

// Operator note appended for the email-offer step (see prepareStep below). The
// chat model rejects a forced tool_choice, so the step narrows the tools to
// offer_email_summary and says so in a mid-conversation system message — the
// offer text itself stays AI-written, in the conversation's language.
const EMAIL_OFFER_STEP_NOTE =
  "The customer has just added a product to the cart. Now call offer_email_summary exactly once, " +
  "with a short, friendly invitation in the language of the conversation. Do not answer with plain text.";

// Thinking blocks are bound to the request prefix they were produced under;
// the email-offer step changes the tool list, so it and the steps after it
// replay the turn without them (with `between_tools` they are only the model's
// progress notes between tool calls — no answer text is lost).
function withoutReasoning(messages: ModelMessage[]): ModelMessage[] {
  return messages.map((m) =>
    m.role === "assistant" && Array.isArray(m.content)
      ? { ...m, content: m.content.filter((part) => part.type !== "reasoning") }
      : m
  );
}

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
  /** "page" (facts of the open page on a typed turn), "cta", "nudge"; absent = today's behaviour (A3). */
  source?: unknown;
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
      // Storefront-selected language ("de" default, "en" on /en). Drives Mo's
      // output language + the model-facing instructions/tools. Default German.
      locale?: unknown;
      // The `mo_c` token of the campaign mail link that opened the chat
      // (optional, additive). Recorded once per send as a session-less KPI
      // event („Chat-Start“) — never tied to this pseudonymous session.
      campaignToken?: unknown;
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
    // Storefront-selected language (body.locale → ?locale= → x-ms-locale header
    // → German). Threaded into the prompt, the tools, the pivot notes and the
    // greeting trigger so an /en chat is English end to end.
    const locale = resolveLocale(req, body.locale);

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

    const campaignToken = typeof body.campaignToken === "string" ? body.campaignToken.slice(0, 128) : null;
    const [hits, identity, emailOfferDeclined, generalQa, directives] = await Promise.all([
      latestUserText
        ? retrieveForTurn({ latestUserMessage: latestUserText, profile, limit: 8 })
        : Promise.resolve([]),
      resolveChatIdentity({ sessionId, email: claimedEmail || null }),
      // Whether the user dismissed a capture card in this session (a UI click
      // the message history never shows — only the widget's KPI event records
      // it). Gates the deterministic email-offer trigger below: after an
      // explicit decline the backend never FORCES another ask. Only consulted
      // while an offer is still possible at all.
      allowEmailSummaryOffer
        ? hasDeclinedEmailCapture(sessionId)
        : Promise.resolve(true),
      // Published GENERAL Q&A pairs for the knowledge-base prompt block (the
      // "Wissen" feature) — in-memory cached (5 min TTL), so this is free on
      // most turns and never breaks the chat (errors → []).
      getCachedGeneralQa(),
      // Active team directives (the "Verbesserung" loop's live instruction
      // layer) — same TTL-cache + never-throws contract as the Q&A block; an
      // empty list leaves the prompt byte-identical.
      getCachedActiveDirectives(),
      // EAGER CREATE (concurrent with retrieval, best-effort, result unused): a
      // started conversation is durably created + customer-linked NOW, before the
      // stream — so a "Neue Beratung" thread appears in the signed-in history
      // immediately and survives a reload even if the answer never lands. Only
      // when a user turn exists (a bare greeting open mints no listed thread, like
      // ChatGPT). The onFinish persistTurn fills in the assistant turn on the same
      // row. See lib/conversation-create + docs/frontend/ACCOUNT_CONTRACT.md §7.6.
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
      // Campaign attribution („Chat-Start“, best-effort, never blocks the chat).
      campaignToken ? recordCampaignChatStarted(campaignToken) : Promise.resolve(false),
    ]);

    const customerMemory = identity.memory;
    // CA §6.0 on the server: the widget never shows the capture card to a
    // signed-in customer, so the backend never offers it (no dead ask, no
    // forced step). Fail-open: a failed sign-in lookup keeps the offer.
    const signedIn = identity.signedIn;
    const emailOfferAvailable = allowEmailSummaryOffer && !signedIn;
    // Optional product context (chat opened "about" a product) and/or
    // browsing context (small recently-viewed trail brought along by the
    // user). Both validated against the catalog; unknown/absent ids leave
    // everything unchanged.
    // A3: `source: "page"` = the facts of the open page on a TYPED turn (the
    // product, or one category; never the trail). Used only behind
    // CHAT_PAGE_CONTEXT_ENABLED and outside the control group; resolved in
    // every arm so the measurement compares like with like. Any other source
    // (CTA, nudge, older widgets without one) takes today's path.
    const ctxSource = contextSource(body.context?.source);
    const pageKind = ctxSource === "page" ? pageContextKind(body.context) : null;
    const hasUserMessage = messages.some((m) => m.role === "user");
    const pageCtxEnabled = isChatPageContextEnabled();
    const pageCtxPct = pageContextHoldoutPct();
    const pageCtxHeldOut =
      pageCtxEnabled && pageKind === "product" && hasUserMessage && isPageContextHeldOut(sessionId, pageCtxPct);
    let resolvedProduct: ProductContext | undefined;
    let resolvedBrowsing: BrowsingContext | undefined;
    if (ctxSource !== "page") {
      resolvedProduct = await resolveProductContext(body.context);
      resolvedBrowsing =
        body.context?.type === "product" || body.context?.type === "browsing"
          ? await resolveBrowsingContext(body.context.recentlyViewed, {
              excludeProductId: resolvedProduct?.id,
            })
          : undefined;
    } else if (hasUserMessage && pageKind === "product") {
      resolvedProduct = await resolveProductContext(body.context);
    } else if (hasUserMessage && pageKind === "collection") {
      resolvedBrowsing = await resolveBrowsingContext(body.context?.recentlyViewed);
    }
    const pagePlan = planPageContext({
      source: ctxSource,
      kind: pageKind,
      hasUserMessage,
      enabled: pageCtxEnabled,
      heldOut: pageCtxHeldOut,
      pct: pageCtxPct,
      productResolved: Boolean(resolvedProduct),
      categoryResolved: Boolean(resolvedBrowsing?.categories.length),
    });
    const productContext = pagePlan.ground ? resolvedProduct : undefined;
    const browsingContext = pagePlan.ground ? resolvedBrowsing : undefined;

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
    // Strip tool-part debris a client resend can carry (aborted streams,
    // failed-validation inputs) BEFORE conversion — replayed as-is it makes
    // the provider call itself fail with AI_APICallError
    // "tool_use.input: Input should be an object". Only broken tool parts are
    // dropped, never messages, so the model sees exactly the history the
    // widget rendered minus calls that never completed.
    const modelMessages = await convertToModelMessages(sanitizeToolParts(messages));

    let greetingContext: ProductContext | undefined;
    let greetingBrowsingContext: BrowsingContext | undefined;
    if (modelMessages.length === 0) {
      // Fresh open (messages: []): seed the greeting as a system-level note
      // and add a minimal, server-internal trigger turn so the model actually
      // emits the opener. The trigger is never streamed back nor stored by
      // the widget (it sent an empty conversation), so no fake user message
      // lands in the rendered history — the greeting is just an extra seed.
      // When both contexts are present, the product-page greeting wins and
      // the browsing trail becomes background info (see system-prompt.ts).
      //
      // The trigger is seeded even WITHOUT any resolved context: the API
      // contract promises that an invalid/stale context is ignored
      // gracefully, so a fresh open whose productId no longer exists must
      // still stream a (generic) greeting rather than hand streamText an
      // empty prompt (Sentry: AI_InvalidPromptError "messages must not be
      // empty"). Keyed off modelMessages so a non-empty request can never
      // gain a trigger turn — every user message survives conversion.
      greetingContext = productContext;
      greetingBrowsingContext = browsingContext;
      modelMessages.push({
        role: "user",
        content: greetingTriggerText(locale, {
          productName: productContext?.name,
        }),
      });
    } else {
      // Existing conversation (including a typed first message): pivot via
      // lightweight in-conversation notes appended to the latest user turn,
      // leaving prior history intact — never wiped. A page context (A3) gets
      // the softer page note; held-out / switched-off / unresolved: none.
      if (pagePlan.noteStyle === "page") {
        if (productContext) appendPivotNote(modelMessages, pagePivotNote(productContext, locale));
        else if (browsingContext?.categories[0])
          appendPivotNote(modelMessages, pageCategoryPivotNote(browsingContext.categories[0], locale));
      } else if (pagePlan.noteStyle === "default") {
        if (productContext) appendPivotNote(modelMessages, productPivotNote(productContext, locale));
        if (browsingContext) appendPivotNote(modelMessages, browsingPivotNote(browsingContext, locale));
      }
    }

    // A3 assignment, at request time (intention-to-treat): which arm this
    // page-context turn is in. Not awaited before streaming; never throws.
    const pageCtxAssignment =
      pagePlan.event && sessionId
        ? recordKpiEvent({ sessionId, event: KPI_PAGE_CONTEXT_APPLIED, data: { ...pagePlan.event, locale } })
        : null;

    // The full tool set is always built (stable type for the forced-offer
    // prepareStep below); offer_email_summary is withheld from the model via
    // `activeTools` once the ask cap is reached or the email was captured —
    // an inactive tool is filtered out before the provider call, so "never a
    // third ask" stays a server-side guarantee, not a prompt instruction.
    // get_order_status is withheld the same way while CHAT_ORDER_STATUS_ENABLED
    // is off (default) — the tool list and the prompt are then exactly as
    // before the feature. Once on, it is NOT withheld per session: an anonymous
    // visitor asking about an order gets "sign_in_required" from the tool
    // itself, and the cached tools prefix stays one per deployment. The one
    // per-session case: while the switch is off, a session signed in as one of
    // CHAT_ORDER_STATUS_TEST_CUSTOMERS (the live check) gets tool and prompt —
    // a second cached prefix for those sessions only (docs/PROMPT_CACHING.md).
    const orderStatusEnabled = await isOrderStatusEnabledFor(sessionId);
    const tools = buildChatTools(profile, locale, { sessionId, orderStatusEnabled });
    const defaultActiveTools = Object.keys(tools).filter(
      (name) =>
        (emailOfferAvailable || name !== "offer_email_summary") &&
        (orderStatusEnabled || name !== "get_order_status")
    ) as Array<keyof typeof tools>;

    // PROMPT CACHING (see docs/PROMPT_CACHING.md). Anthropic bills cached
    // prefix reads at ~0.1× the input price (writes at 1.25×). Every agentic
    // step of this turn re-sends the full prompt, so with up to
    // MAX_STEPS_PER_TURN steps the same tools+system+history prefix is billed
    // repeatedly — the two breakpoints below make steps 2..n (and the tools
    // block even across turns/users) cache reads instead. The prompt BYTES are
    // unchanged; only cache_control markers are added, so answers are
    // unaffected. A third marker sits on the last always-active tool (see
    // lib/tools.ts).
    const cacheEphemeral = {
      anthropic: { cacheControl: { type: "ephemeral" as const } },
    };
    // Breakpoint 2 (messages tier): marks the conversation history INCLUDING
    // this turn's user message. Step 1 writes the prefix; every follow-up step
    // in this turn (tool loop) reads it. The provider applies the marker to the
    // message's last content part — set AFTER the greeting/pivot mutations
    // above so it lands on the final content.
    const lastModelMessage = modelMessages[modelMessages.length - 1];
    if (lastModelMessage) lastModelMessage.providerOptions = cacheEphemeral;

    // Set once the email-offer step (prepareStep below) has run in this turn.
    let emailOfferStepRan = false;

    const result = streamText({
      model: anthropic(CHAT_MODEL),
      providerOptions: anthropicOptionsFor("chat"),
      // Our system messages are server-authored (the prompt + the email-offer
      // step note), never user input.
      allowSystemInMessages: true,
      // The system prompt travels as a leading system MESSAGE (not the
      // `system` option) solely so it can carry breakpoint 1 (system tier,
      // covers tools+system): the AI SDK's `system` string cannot hold
      // providerOptions. The provider renders both forms identically.
      messages: [
        {
          role: "system",
          content: buildSystemPrompt({
            profile,
            archetype,
            retrievedProducts,
            productContext: greetingContext,
            browsingContext: greetingBrowsingContext,
            customerMemory: customerMemory ?? undefined,
            emailOffer: {
              offersMade: emailOffersMade,
              emailCaptured,
              signedIn,
              // The PDF download icon exists only in a thread with a key.
              summaryDownload: signedIn && conversationKey !== null,
            },
            generalQa,
            directives,
            locale,
            orderStatus: orderStatusEnabled,
          }),
          providerOptions: cacheEphemeral,
        },
        ...modelMessages,
      ],
      tools,
      activeTools: defaultActiveTools,
      // EMAIL-OFFER TRIGGER (highest-intent moment): when this turn has
      // produced an add_to_cart (direct-checkout) call and the model did not
      // offer the email summary on its own, the next step offers ONLY
      // offer_email_summary and an operator note tells the model to call it —
      // exactly one extra model step, so the invitation text stays AI-written
      // (the tool's `message` input) and in-context. (The chat model rejects a
      // forced tool_choice; with a single available tool and the note it calls
      // it just the same. If it answers in text instead, the loop ends there —
      // no ask is recorded and nothing repeats.) The system-prompt wording
      // alone proved unreliable here: the persona's anti-pushiness rules made
      // the model consistently skip the soft ask at checkout.
      // shouldForceEmailOfferStep keeps every existing rule intact: never once
      // the email is captured, never past the two-ask cap (the forced ask COUNTS as one of the two — it streams as a normal
      // tool call, so countEmailSummaryOffers and the ask-shown KPI below
      // pick it up like any other offer), and never after the user declined a
      // capture card (widget-reported KPI event). When it fires, the tool is
      // guaranteed present in the tool set: the trigger's gates (incl.
      // signedIn) are a strict subset of emailOfferAvailable.
      prepareStep: ({ steps, messages: stepMessages }) => {
        // After the email-offer step the tool list is back to normal — again a
        // different prefix than the offer step's, so replay without thinking.
        if (emailOfferStepRan) return { messages: withoutReasoning(stepMessages) };
        const force = shouldForceEmailOfferStep({
          emailCaptured,
          offersMade: emailOffersMade,
          declined: emailOfferDeclined,
          toolNamesCalled: turnToolNames(steps),
          signedIn,
        });
        if (!force) return undefined;
        emailOfferStepRan = true;
        return {
          activeTools: ["offer_email_summary"],
          messages: [
            ...withoutReasoning(stepMessages),
            { role: "system", content: EMAIL_OFFER_STEP_NOTE },
          ],
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
          signedIn,
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
      onFinish: async ({ steps, response, totalUsage }) => {
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

          // The FULL assistant text of this turn — every step's prose joined in
          // order, NOT just the last step's. In ai@6 the onFinish `text` (and
          // the last StepResult's `text`) is ONLY the text generated in the
          // FINAL step. An agentic turn streams the assistant's prose across
          // several steps (e.g. "Ich schaue mal nach …" → search_products →
          // "Hier sind drei passende Geräte:" → show_product → "Welches
          // interessiert dich?"). The widget renders all of it as one assistant
          // message, but persisting only `text` stored just the last fragment —
          // so every tool-using turn looked like the bot's message went missing
          // in the conversation inspector + the customer's own history. Re-join
          // the per-step text so the stored transcript matches what was shown.
          const assistantText = steps
            .map((s) => (s.text ?? "").trim())
            .filter((t) => t.length > 0)
            .join("\n\n");

          await persistTurn({
            sessionId,
            conversationKey,
            history: messages,
            personaLabel: archetype ?? "unknown",
            // Storefront-selected chat language → KPI language split (0041).
            locale,
            assistantText,
            assistantToolCalls: toolCalls,
            assistantMessageId: response.id,
            // `totalUsage` aggregates input/output tokens across all agentic
            // steps this turn (ai@6 LanguageModelUsage; fields may be undefined,
            // so coalesce to 0). Recorded for the cost-per-consultation KPI.
            // NB: in ai@6 `inputTokens` is the TOTAL including cached tokens;
            // the cache read/write splits are recorded alongside so the cost
            // KPI can price them at their real (0.1× / 1.25×) rates — see
            // lib/ai-pricing.mjs.
            usage: {
              model: CHAT_MODEL,
              inputTokens: totalUsage?.inputTokens ?? 0,
              outputTokens: totalUsage?.outputTokens ?? 0,
              cacheReadTokens: totalUsage?.inputTokenDetails?.cacheReadTokens ?? 0,
              cacheWriteTokens: totalUsage?.inputTokenDetails?.cacheWriteTokens ?? 0,
            },
          });

          // A3 outcome of a page-context turn: card counts only, never an id.
          if (pageCtxAssignment && pagePlan.event) {
            await pageCtxAssignment;
            await recordKpiEvent({
              sessionId,
              event: KPI_PAGE_CONTEXT_ANSWERED,
              data: {
                kind: pagePlan.event.kind,
                productCards: countProductCards(toolCalls),
                otherCards: countOtherCards(toolCalls, resolvedProduct?.id),
              },
            });
          }

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

          // Card-selection guard (observability). The visible product cards are
          // exactly Mo's explicit show_product recommendations in order (see
          // lib/recommended-products + docs/frontend/API_CONTRACT.md §2, the
          // card-selection contract). The widget already
          // renders nothing for an unknown id, and /api/products withholds the
          // checkout link for a sold-out one — but if the model recommended an
          // id that is unknown or sold-out, that is a prompt regression we want
          // to SEE rather than silently ship a wrong/sold-out card. Own try so a
          // catalog hiccup never touches persistence above.
          try {
            const recommended = recommendedCardIdsInOrder(toolCalls);
            if (recommended.length > 0) {
              const catalog = await loadProductCatalog();
              const byId = new Map(catalog.map((p) => [p.id, p]));
              const { droppedUnknown, droppedSoldOut } = guardRecommendedCardIds(
                recommended,
                byId
              );
              if (droppedUnknown.length > 0 || droppedSoldOut.length > 0) {
                reportError(new Error("recommendation_card_guard_dropped"), {
                  route: "api/chat",
                  phase: "card-guard",
                  recommended,
                  droppedUnknown,
                  droppedSoldOut,
                });
              }
            }
          } catch (guardErr) {
            reportError(guardErr, { route: "api/chat", phase: "card-guard", messageCount });
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
      // The widget contract carries text + tool parts only. Keeping reasoning
      // parts out of the stream also keeps them out of the history the widget
      // sends back, so no thinking block is ever replayed across turns (the
      // system prompt changes per turn, which would invalidate them).
      sendReasoning: false,
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
