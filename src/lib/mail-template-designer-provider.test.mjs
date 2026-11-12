// The KI-Gestalter through the REAL Anthropic provider (@ai-sdk/anthropic) with
// an intercepted fetch: what goes over the wire for the tier `designer` and
// the operator's settings (mail-template-designer-settings.mjs, wired as in
// mail-template-assist.ts) — model, token cap, adaptive thinking, effort,
// refusal fallback, prompt caching, the tools, the house style and the
// working rules — and that a thinking block is handed back on the next step
// of the tool loop with the earlier messages unchanged (the API refuses a tool
// result after thinking without it; Fable 5.2 refuses any edit of the history
// before a replayed thinking block). The answers are scripted Server-Sent
// Events in the Messages API format.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createAnthropic } from "@ai-sdk/anthropic";
import { FABLE_MODEL, anthropicOptionsFor, anthropicOptionsWithEffort, maxOutputTokensFor, modelFor } from "./ai-models.mjs";
import {
  DEFAULT_DESIGNER_SETTINGS,
  DESIGNER_QUALITY,
  designerHouseStyleSection,
  designerMaxOutputTokens,
  designerRunRules,
} from "./mail-template-designer-settings.mjs";
import {
  DESIGNER_LIMITS,
  checkDesignSubmission,
  designerProviderOptions,
  designerSystemPrompt,
  designerUserContent,
  runDesigner,
} from "./mail-template-designer.mjs";

const NOW = new Date("2026-11-11T10:00:00Z");

/** One SSE answer of the Messages API. */
function sse(blocks, stopReason, usage = { input_tokens: 1200, output_tokens: 300 }, model = "claude-opus-5-5") {
  const ev = (type, data) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
  let out = ev("message_start", {
    message: { id: "msg_1", type: "message", role: "assistant", model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: usage.input_tokens, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } },
  });
  blocks.forEach((b, index) => {
    if (b.type === "thinking") {
      out += ev("content_block_start", { index, content_block: { type: "thinking", thinking: "", signature: "" } });
      out += ev("content_block_delta", { index, delta: { type: "thinking_delta", thinking: b.thinking } });
      out += ev("content_block_delta", { index, delta: { type: "signature_delta", signature: b.signature } });
    } else if (b.type === "tool_use") {
      out += ev("content_block_start", { index, content_block: { type: "tool_use", id: b.id, name: b.name, input: {} } });
      out += ev("content_block_delta", { index, delta: { type: "input_json_delta", partial_json: JSON.stringify(b.input) } });
    } else {
      out += ev("content_block_start", { index, content_block: { type: "text", text: "" } });
      out += ev("content_block_delta", { index, delta: { type: "text_delta", text: b.text } });
    }
    out += ev("content_block_stop", { index });
  });
  out += ev("message_delta", { delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: usage.output_tokens } });
  out += ev("message_stop", {});
  return out;
}

/** A provider whose fetch answers with the scripted SSE bodies in order and records every request. */
function scripted(bodies) {
  const requests = [];
  const provider = createAnthropic({
    apiKey: "test-key",
    fetch: async (url, init) => {
      requests.push({ url: String(url), headers: init?.headers, body: JSON.parse(String(init?.body ?? "{}")) });
      const body = bodies[requests.length - 1];
      if (!body) return new Response(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "no more answers" } }), { status: 400 });
      return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
    },
  });
  return { provider, requests };
}

const DESIGN = {
  doc: {
    style: { accentColor: "#111111" },
    blocks: [
      { type: "logo" },
      { type: "heading", text: "Winter-Training" },
      { type: "text", text: "Zeit für dein Home-Gym." },
      { type: "button", label: "Jetzt entdecken", href: "https://www.motionsports.de/" },
      { type: "footer" },
    ],
  },
  notes: "Fertig.",
  subject: "Winter-Training zu Hause",
  preheader: "Alles für dein Home-Gym",
};

/** runDesigner wired like mail-template-assist.ts for the given settings (default: the stored defaults). */
function runWith(provider, over = {}, settings = DEFAULT_DESIGNER_SETTINGS) {
  return runDesigner({
    model: provider(settings.model),
    system: designerSystemPrompt({ use: "bulk", houseStyle: settings.houseStyle }),
    userContent: designerUserContent({
      instruction: "Winter-Mail, schlicht",
      use: "bulk",
      today: NOW,
      attachments: [{ index: 1, name: "vorbild.png", kind: "image", width: 600, height: 900, parts: [{ data: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), mediaType: "image/png" }] }],
      rules: designerRunRules(settings),
    }),
    providerOptions: designerProviderOptions(anthropicOptionsWithEffort("designer", settings.effort)),
    maxOutputTokens: designerMaxOutputTokens(settings.effort, DESIGNER_LIMITS.answerTokens),
    searchProducts: async () => ({ products: [] }),
    listCollections: async () => ({ collections: [] }),
    checkSubmission: (input, round) =>
      checkDesignSubmission(input, {
        use: "bulk",
        now: NOW,
        operatorText: "Winter-Mail, schlicht",
        currentDoc: null,
        attachments: [{ index: 1, kind: "image", name: "vorbild.png" }],
        resolveRefs: () => [],
        isKnownShopUrl: async () => false,
        isCatalogImage: () => false,
        ownOrigin: null,
        ...round,
      }),
    maxRetries: 0,
    ...over,
  });
}

test("the request of the tier designer: model, cap, adaptive thinking, effort, caching, tools, picture", async () => {
  const { provider, requests } = scripted([sse([{ type: "tool_use", id: "toolu_1", name: "submit_design", input: DESIGN }], "tool_use")]);
  const res = await runWith(provider);
  assert.equal(res.ok, true, res.message);
  assert.equal(requests.length, 1);
  const body = requests[0].body;
  // the default settings send exactly what the tier did before there were settings
  assert.equal(body.model, modelFor("designer"));
  assert.deepEqual(anthropicOptionsWithEffort("designer", DEFAULT_DESIGNER_SETTINGS.effort), anthropicOptionsFor("designer"));
  assert.equal(body.stream, true);
  assert.equal(body.max_tokens, maxOutputTokensFor("designer", DESIGNER_LIMITS.answerTokens));
  assert.deepEqual(body.thinking, { type: "adaptive" });
  assert.deepEqual(body.output_config, { effort: "high" }, "effort high is sent");
  assert.equal(body.fallbacks, "default", "the server-side refusal fallback");
  assert.equal(body.temperature, undefined, "no temperature next to thinking");
  // prompt caching: a breakpoint on the system prompt and top-level automatic caching
  assert.ok(Array.isArray(body.system) && body.system.some((s) => s.cache_control?.type === "ephemeral"), "system breakpoint");
  assert.deepEqual(body.cache_control, { type: "ephemeral" });
  // the same three tools on every step, tool choice left to the model
  assert.deepEqual(body.tools.map((t) => t.name).sort(), ["list_collections", "search_products", "submit_design"]);
  assert.ok(!body.tool_choice || body.tool_choice.type === "auto");
  // the attachment arrives as a picture behind its label
  const user = body.messages[0];
  assert.equal(user.role, "user");
  assert.ok(user.content.some((c) => c.type === "image" && c.source?.type === "base64" && c.source.media_type === "image/png"));
  assert.ok(user.content.some((c) => c.type === "text" && c.text.includes("Anhang 1 („vorbild.png“, Bild 600×900 px)")));
  // the accepted design comes back normalised, with subject and preview line
  assert.equal(res.doc.blocks.at(-1).type, "footer");
  assert.equal(res.subject, "Winter-Training zu Hause");
});

test("a thinking block is handed back with the tool result on the next step", async () => {
  const { provider, requests } = scripted([
    sse(
      [
        { type: "thinking", thinking: "Erst Produkte suchen.", signature: "sig-123" },
        { type: "tool_use", id: "toolu_1", name: "search_products", input: { query: "Hantelbank" } },
      ],
      "tool_use"
    ),
    sse([{ type: "tool_use", id: "toolu_2", name: "submit_design", input: DESIGN }], "tool_use"),
  ]);
  const res = await runWith(provider);
  assert.equal(res.ok, true, res.message);
  assert.equal(requests.length, 2);
  const [first, second] = requests.map((r) => r.body);
  // the same system prompt and tools on both steps (cache and thinking stay valid)
  assert.deepEqual(second.system, first.system);
  assert.deepEqual(second.tools, first.tools);
  const assistant = second.messages.find((m) => m.role === "assistant");
  assert.ok(assistant, "the first answer is replayed");
  const thinking = assistant.content.find((c) => c.type === "thinking");
  assert.equal(thinking?.signature, "sig-123");
  assert.equal(thinking?.thinking, "Erst Produkte suchen.");
  assert.ok(assistant.content.some((c) => c.type === "tool_use" && c.id === "toolu_1"));
  const result = second.messages.at(-1).content.find((c) => c.type === "tool_result");
  assert.equal(result?.tool_use_id, "toolu_1");
  // usage of both steps is summed
  assert.equal(res.usage.inputTokens, 2400);
});

/** A header of a recorded request (plain object or Headers). */
function header(headers, name) {
  if (!headers) return "";
  if (typeof headers.get === "function") return headers.get(name) ?? "";
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name);
  return key ? String(headers[key]) : "";
}

test("the „Maximal“ level at Denktiefe „Sehr hoch“: Fable 5.2 over the wire, the effort in output_config, the refusal fallback, an append-only loop", async () => {
  const maximal = DESIGNER_QUALITY.find((q) => q.id === "maximal");
  assert.equal(maximal.model, FABLE_MODEL);
  const settings = { ...DEFAULT_DESIGNER_SETTINGS, model: maximal.model, effort: "xhigh", freedom: "genau", proactive: false, houseStyle: "Hausfarben Schwarz und #e30613." };
  const { provider, requests } = scripted([
    sse(
      [
        // Fable 5.2 never returns its reasoning — the block arrives empty, with its signature
        { type: "thinking", thinking: "", signature: "sig-fable-1" },
        { type: "tool_use", id: "toolu_1", name: "search_products", input: { query: "Hantelbank" } },
      ],
      "tool_use",
      undefined,
      FABLE_MODEL
    ),
    sse([{ type: "tool_use", id: "toolu_2", name: "submit_design", input: DESIGN }], "tool_use", undefined, FABLE_MODEL),
  ]);
  const res = await runWith(provider, {}, settings);
  assert.equal(res.ok, true, res.message);
  assert.equal(res.usageComplete, true);
  assert.equal(requests.length, 2);
  const [first, second] = requests.map((r) => r.body);

  for (const body of [first, second]) {
    assert.equal(body.model, "claude-fable-5-2");
    // thinking is always on for Fable 5.2: adaptive, never disabled or a budget
    assert.deepEqual(body.thinking, { type: "adaptive" });
    // the effort goes where the SDK puts it for the Messages API
    assert.deepEqual(body.output_config, { effort: "xhigh" });
    assert.equal(body.effort, undefined);
    // thinking counts toward max_tokens: the answer budget plus the thinking room of xhigh
    assert.equal(body.max_tokens, designerMaxOutputTokens("xhigh", DESIGNER_LIMITS.answerTokens));
    assert.equal(body.max_tokens, 96_000);
    // the server-side refusal fallback and its beta
    assert.equal(body.fallbacks, "default");
    // tool choice left to the model (Fable 5.2 rejects a forced one), no sampling parameters
    assert.ok(!body.tool_choice || body.tool_choice.type === "auto");
    assert.equal(body.temperature, undefined);
    assert.deepEqual(body.cache_control, { type: "ephemeral" });
  }
  for (const r of requests) assert.match(header(r.headers, "anthropic-beta"), /\bserver-side-fallback-2026-07-01\b/);

  // the house style closes the system prompt; the working rules stand right before the instruction
  const systemText = first.system.map((s) => s.text).join("");
  assert.ok(systemText.endsWith(designerHouseStyleSection(settings)), "the house style is the last section");
  const userTexts = first.messages[0].content.filter((c) => c.type === "text").map((c) => c.text);
  assert.equal(userTexts.at(-2), `## Arbeitsregeln des Teams\n${designerRunRules(settings)}`);
  assert.match(userTexts.at(-2), /GENAU NACH AUFTRAG/);
  assert.match(userTexts.at(-1), /^## Anweisung der Person/);

  // append-only: the same system prompt and tools, the first request's messages unchanged as the prefix,
  // then the answer with its (empty) thinking block and the tool result
  assert.deepEqual(second.system, first.system);
  assert.deepEqual(second.tools, first.tools);
  assert.deepEqual(second.messages.slice(0, first.messages.length), first.messages);
  const [assistant, toolResult] = second.messages.slice(first.messages.length);
  assert.equal(assistant.role, "assistant");
  assert.deepEqual(
    assistant.content.find((c) => c.type === "thinking"),
    { type: "thinking", thinking: "", signature: "sig-fable-1" },
    "the thinking block goes back unchanged"
  );
  assert.ok(assistant.content.some((c) => c.type === "tool_use" && c.id === "toolu_1"));
  assert.equal(toolResult.role, "user");
  assert.equal(toolResult.content.find((c) => c.type === "tool_result")?.tool_use_id, "toolu_1");
  assert.equal(second.messages.length, first.messages.length + 2);
});
