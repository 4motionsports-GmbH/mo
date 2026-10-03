import { test } from "node:test";
import assert from "node:assert/strict";
import { signalsForCustomer, signalPriority, isoWeekKey, SIGNAL_KINDS, FACT_SIGNAL_KINDS } from "./customer-signals.mjs";

const NOW = new Date("2026-10-01T08:00:00Z");
const ago = (d) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

const base = {
  customerId: 7,
  consentState: "subscribed",
  blocked: false,
  ordersCount: 0,
  totalSpentCents: 0,
  lastOrderAt: null,
  lastOrderCents: null,
  medianIntervalDays: null,
  valueTier: null,
  conversationsCount: 0,
  lastChatAt: null,
  selectedHandles: [],
  discussedHandles: [],
  lastClickAt: null,
  lastMarketingAt: null,
  lastInboundAt: null,
  unansweredInboundCount: 0,
  ordersLast12m: 0,
  topPercentile: false,
  inOpenCampaign: false,
  recentBigOrderCents: null,
};

const kinds = (f) => signalsForCustomer({ ...base, ...f }, NOW).map((s) => s.kind);

test("blocked people get nothing", () => {
  assert.deepEqual(kinds({ blocked: true, unansweredInboundCount: 2, lastInboundAt: ago(3) }), []);
});

test("an unanswered mail is not a facts signal (lib/inbox-mail.ts opens it at once)", () => {
  assert.deepEqual(kinds({ unansweredInboundCount: 1, lastInboundAt: ago(2) }), []);
});

test("kaufabsicht needs a recent chat with chosen products and consent", () => {
  assert.deepEqual(kinds({ lastChatAt: ago(2), selectedHandles: ["rack"] }), ["kaufabsicht"]);
  assert.deepEqual(kinds({ lastChatAt: ago(2), selectedHandles: ["rack"], consentState: "not_subscribed" }), []);
  assert.deepEqual(kinds({ lastChatAt: ago(9), selectedHandles: ["rack"] }), []);
  // Ordered after the chat → no signal.
  assert.deepEqual(kinds({ lastChatAt: ago(3), selectedHandles: ["rack"], lastOrderAt: ago(1), ordersCount: 1 }), []);
});

test("zubehoer window: ≥150 € 7–30 days ago, no mail since, not queued", () => {
  const f = { ordersCount: 1, lastOrderAt: ago(12), lastOrderCents: 89900 };
  assert.deepEqual(kinds(f), ["zubehoer_fenster"]);
  assert.deepEqual(kinds({ ...f, lastOrderCents: 9900 }), []);
  assert.deepEqual(kinds({ ...f, lastMarketingAt: ago(5) }), []);
  assert.deepEqual(kinds({ ...f, inOpenCampaign: true }), []);
});

test("wiederkauf and abwanderung follow the personal rhythm", () => {
  assert.deepEqual(kinds({ ordersCount: 4, medianIntervalDays: 60, lastOrderAt: ago(90) }), ["wiederkauf_faellig"]);
  assert.deepEqual(kinds({ ordersCount: 4, medianIntervalDays: 60, lastOrderAt: ago(50) }), []);
  assert.deepEqual(
    kinds({ ordersCount: 2, valueTier: "grossgeraet", totalSpentCents: 250000, lastOrderAt: ago(400) }),
    ["abwanderung"]
  );
  assert.deepEqual(kinds({ ordersCount: 1, valueTier: "klein", lastOrderAt: ago(400) }), []);
});

test("top customers and active people without consent", () => {
  assert.deepEqual(kinds({ topPercentile: true, totalSpentCents: 900000, ordersCount: 6 }), ["top_kunde"]);
  assert.deepEqual(kinds({ consentState: "not_subscribed", ordersLast12m: 2, ordersCount: 2 }), ["einwilligung_fehlt"]);
  // An explicit opt-out is respected: no nudging towards consent.
  assert.deepEqual(kinds({ consentState: "unsubscribed", ordersLast12m: 3, ordersCount: 3 }), []);
});

test("priority: weight + value + freshness, bounded", () => {
  assert.equal(signalPriority("kaufabsicht", {}), 80);
  assert.equal(signalPriority("kaufabsicht", { valueTier: "grossgeraet", ageDays: 1 }), 93);
  assert.equal(signalPriority("datenauskunft", { valueTier: "grossgeraet", ageDays: 0 }), 100);
});

test("dedupe keys name the episode, not a calendar window", () => {
  const lastOrderAt = ago(90);
  const a = signalsForCustomer({ ...base, ordersCount: 4, medianIntervalDays: 60, lastOrderAt }, NOW)[0];
  // Three weeks later the same overdue order is the same item (a snooze holds).
  const b = signalsForCustomer(
    { ...base, ordersCount: 4, medianIntervalDays: 60, lastOrderAt },
    new Date(NOW.getTime() + 21 * 86_400_000)
  )[0];
  assert.equal(a.dedupeKey, b.dedupeKey);
  assert.equal(a.dedupeKey, `wiederkauf_faellig:7:${lastOrderAt.slice(0, 10)}`);
  assert.equal(isoWeekKey(new Date("2026-01-01T00:00:00Z")), "2026-W01");
});

test("every fact kind is described", () => {
  for (const k of FACT_SIGNAL_KINDS) assert.ok(SIGNAL_KINDS[k]?.label, k);
});

import { offerExpiringSignal, dissatisfiedSignal, isNotableRefund, bounceSignal, capSignals } from "./customer-signals.mjs";

test("event rules: expiring offer, refund, bounce", () => {
  const o = offerExpiringSignal(
    { customerId: 3, sendId: 99, campaignName: "Black Friday", endsAt: new Date(NOW.getTime() + 30 * 3_600_000).toISOString(), kind: "code" },
    NOW
  );
  assert.equal(o.kind, "angebot_laeuft_ab");
  assert.match(o.reason, /läuft in 30 Stunden ab/);
  assert.equal(o.dedupeKey, "angebot_laeuft_ab:3:send99");
  const d = dissatisfiedSignal({ customerId: 3, orderName: "#1002", cancelled: true, refundedCents: 0, at: ago(2) });
  assert.match(d.reason, /#1002 wurde storniert/);
  const at = ago(3);
  const p = dissatisfiedSignal({ customerId: 3, orderName: "#1003", cancelled: false, refundedCents: 5000, totalCents: 15000, at });
  assert.match(p.reason, /#1003 wurde teilweise erstattet/);
  assert.equal(p.dedupeKey, `unzufrieden:3:#1003:${at.slice(0, 10)}`);
  assert.match(
    dissatisfiedSignal({ customerId: 3, orderName: "#1004", cancelled: false, refundedCents: 9900, totalCents: 0, at }).reason,
    /vollständig erstattet/
  );
  assert.equal(bounceSignal({ customerId: 3, bouncedAt: ago(1) }).kind, "zustellproblem");
});

test("only a notable refund counts as dissatisfaction", () => {
  assert.equal(isNotableRefund({ refundedCents: 0, totalCents: 10000 }), false);
  assert.equal(isNotableRefund({ refundedCents: 490, totalCents: 29510 }), false); // 1.6 %: shipping / goodwill
  assert.equal(isNotableRefund({ refundedCents: 1000, totalCents: 9000 }), true); // exactly 10 %
  assert.equal(isNotableRefund({ refundedCents: 4999, totalCents: 0 }), true); // full refund
  assert.equal(isNotableRefund({ refundedCents: -5, totalCents: 100 }), false);
});

test("low-priority kinds are capped per run", () => {
  const many = Array.from({ length: 80 }, (_, i) => ({ kind: "einwilligung_fehlt", priority: i }));
  const kept = capSignals([...many, { kind: "kaufabsicht", priority: 80 }]);
  assert.equal(kept.filter((k) => k.kind === "einwilligung_fehlt").length, 50);
  assert.equal(kept.filter((k) => k.kind === "einwilligung_fehlt")[0].priority, 79);
  assert.equal(kept.filter((k) => k.kind === "kaufabsicht").length, 1);
});
