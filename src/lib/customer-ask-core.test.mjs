import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAskSources, citedSources, normalizeAskQuestion, renderAskSources } from "./customer-ask-core.mjs";

const detail = {
  orders: [
    {
      name: "#1001",
      processedAt: "2026-05-01T10:00:00Z",
      totalCents: 12990,
      financialStatus: "PAID",
      fulfillmentStatus: "FULFILLED",
      cancelledAt: null,
      discountCodes: ["MK-ABC"],
      lineItems: [{ title: "Trainingshose", variantTitle: "Größe M", quantity: 2, unitPrice: 64.95 }],
    },
  ],
  sessions: [
    {
      createdAt: "2026-06-02T09:00:00Z",
      messageCount: 2,
      transcript: [
        { role: "user", content: "Passt das Rack in 2,10 m?", toolName: null },
        { role: "tool", content: "{…}", toolName: "search" },
        { role: "assistant", content: "Ja, es ist 2,05 m hoch.", toolName: null },
      ],
    },
  ],
  correspondence: [{ direction: "received", subject: "Lieferung", snippet: "Wann kommt meine Bestellung?", occurredAt: "2026-05-03T08:00:00Z" }],
  campaigns: [{ campaignName: "Black Friday 2026", subject: "Dein Angebot", sentAt: "2026-04-01T08:00:00Z", clickedAt: null, unsubscribedAt: null }],
  consent: { history: [{ occurredAt: "2026-01-01T00:00:00Z", state: "subscribed", level: "confirmed_opt_in", sourceLabel: "Mo · Chat", note: null }] },
};

test("sources are numbered newest first and carry variants and chat turns", () => {
  const s = buildAskSources(detail);
  assert.deepEqual(
    s.map((x) => x.kind),
    ["chat", "mail_in", "order", "campaign", "consent"]
  );
  assert.equal(s[0].n, 1);
  assert.match(s[2].body, /2× Trainingshose \(Größe M\)/);
  assert.match(s[0].body, /Kunde: Passt das Rack/);
  assert.doesNotMatch(s[0].body, /search/);
});

test("rendering respects the budget but always includes the newest source", () => {
  const s = buildAskSources(detail);
  const all = renderAskSources(s);
  assert.equal(all.included, s.length);
  assert.match(all.text, /^\[1\] 2026-06-02 · Gespräch mit Mo/);
  const tiny = renderAskSources(s, 10);
  assert.equal(tiny.included, 1);
});

test("citations map back to sources; unknown or excluded numbers are dropped", () => {
  const s = buildAskSources(detail);
  const c = citedSources([3, 3, 99, "1", 0, 5], s, 4);
  assert.deepEqual(
    c.map((x) => x.n),
    [3, 1]
  );
  assert.equal(c[0].kindLabel, "Bestellung");
});

test("question validation", () => {
  assert.equal(normalizeAskQuestion("  ").ok, false);
  assert.equal(normalizeAskQuestion("x".repeat(501)).ok, false);
  assert.deepEqual(normalizeAskQuestion("  Welche  Größe? "), { ok: true, question: "Welche Größe?" });
});
