// The KI-Gestalter through the REAL Anthropic provider (@ai-sdk/anthropic) with
// an intercepted fetch: what goes over the wire for the tier `designer` —
// model, token cap, adaptive thinking, effort, prompt caching, the tools —
// and that a thinking block is handed back on the next step of the tool loop
// (the API refuses a tool result after thinking without it). The answers are
// scripted Server-Sent Events in the Messages API format.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createAnthropic } from "@ai-sdk/anthropic";
import { anthropicOptionsFor, maxOutputTokensFor, modelFor } from "./ai-models.mjs";
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
function sse(blocks, stopReason, usage = { input_tokens: 1200, output_tokens: 300 }) {
  const ev = (type, data) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
  let out = ev("message_start", {
    message: { id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: usage.input_tokens, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } },
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

function runWith(provider, over = {}) {
  const tier = "designer";
  return runDesigner({
    model: provider(modelFor(tier)),
    system: designerSystemPrompt({ use: "bulk" }),
    userContent: designerUserContent({
      instruction: "Winter-Mail, schlicht",
      use: "bulk",
      today: NOW,
      attachments: [{ index: 1, name: "vorbild.png", kind: "image", width: 600, height: 900, parts: [{ data: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), mediaType: "image/png" }] }],
    }),
    providerOptions: designerProviderOptions(anthropicOptionsFor(tier)),
    maxOutputTokens: maxOutputTokensFor(tier, DESIGNER_LIMITS.answerTokens),
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
  assert.equal(body.model, modelFor("designer"));
  assert.equal(body.stream, true);
  assert.equal(body.max_tokens, maxOutputTokensFor("designer", DESIGNER_LIMITS.answerTokens));
  assert.deepEqual(body.thinking, { type: "adaptive" });
  assert.equal(JSON.stringify(body).includes('"effort":"high"'), true, "effort high is sent");
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
