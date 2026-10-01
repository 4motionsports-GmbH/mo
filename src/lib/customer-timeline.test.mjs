import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCustomerTimeline } from "./customer-timeline.mjs";

test("merges every source newest first", () => {
  const t = buildCustomerTimeline({
    orders: [
      {
        processedAt: "2026-05-01T10:00:00Z",
        name: "#1001",
        totalCents: 129900,
        currency: "EUR",
        cancelledAt: null,
        lineItems: [{ title: "Power Rack", quantity: 1 }],
      },
    ],
    sessions: [{ createdAt: "2026-04-20T10:00:00Z", messageCount: 12, personaDisplay: "Home-Athlet" }],
    campaigns: [{ sentAt: "2026-06-01T08:00:00Z", campaignName: "Lebenszyklus", subject: "Dein Rack", clickedAt: "2026-06-01T09:00:00Z" }],
    consentEvents: [{ occurredAt: "2026-04-20T10:05:00Z", state: "pending", sourceLabel: "Mo · Chat", note: null }],
    messages: [
      { occurredAt: "2026-06-01T08:00:01Z", direction: "sent", subject: "Dein Rack", marketingSendId: null },
      { occurredAt: "2026-06-02T08:00:00Z", direction: "received", subject: "Re: Dein Rack", marketingSendId: null },
    ],
  });
  assert.deepEqual(
    t.map((e) => e.kind),
    ["mail_in", "campaign", "order", "consent", "chat"]
  );
  assert.equal(t[2].title, "Bestellung #1001 · 1.299,00\u00a0€");
  assert.equal(t[2].detail, "Power Rack");
  assert.equal(t[1].detail, "angeklickt");
});

test("caps the list and skips undated entries", () => {
  const sessions = Array.from({ length: 10 }, (_, i) => ({
    createdAt: i === 0 ? null : `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
    messageCount: 1,
    personaDisplay: null,
  }));
  const t = buildCustomerTimeline({ sessions }, 5);
  assert.equal(t.length, 5);
  assert.equal(t[0].at, "2026-01-10T00:00:00Z");
});
