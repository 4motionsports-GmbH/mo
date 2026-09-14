import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CONFIRMED_OPT_IN,
  abGroupOf,
  reviewChecks,
  reviewVerdict,
  REVIEW_PLACEHOLDER_CODE,
  STALE_DRAFT_DAYS,
  SUBJECT_MAX_CHARS,
} from "./campaign-review-checks.mjs";

const NOW = new Date("2026-09-13T10:00:00Z");
const DAY_MS = 86_400_000;

// A card where every check passes — tests below break one rule at a time.
function readyItem(overrides = {}) {
  return {
    contactId: 12,
    optInLevel: "CONFIRMED_OPT_IN",
    subject: "Lea, drei Ergänzungen für dein Training",
    body: "Hallo Lea, mit dem Code MO-XXXX bekommst du 10 % auf deine Bestellung.",
    discountPercent: 10,
    lowConfidence: false,
    recommendations: [
      { id: "a", name: "A", url: "https://shop/a", available: true },
      { id: "b", name: "B", url: "https://shop/b", available: true },
    ],
    bundle: { expiresAt: new Date(NOW.getTime() + 6 * DAY_MS).toISOString() },
    segment: "ausbauen_frueh",
    heroUrl: "https://blob/hero.jpg",
    draftUpdatedAt: new Date(NOW.getTime() - 2 * DAY_MS).toISOString(),
    lastSendAt: null,
    edited: false,
    sendError: null,
    ...overrides,
  };
}

const ctx = (overrides = {}) => ({
  sendsApproved: true,
  allowSingleOptIn: false,
  heroDesignActive: true,
  minSendIntervalDays: 14,
  now: NOW,
  ...overrides,
});

const keys = (checks) => checks.map((c) => c.key);

test("a clean card is ready and carries only the hero info", () => {
  const checks = reviewChecks(readyItem(), ctx());
  assert.deepEqual(keys(checks), ["hero_present"]);
  assert.equal(reviewVerdict(checks), "ready");
});

test("A/B arm: even ids are A, odd ids are B", () => {
  assert.equal(abGroupOf(12), "A");
  assert.equal(abGroupOf(13), "B");
  assert.equal(abGroupOf("14"), "A");
  assert.equal(abGroupOf("x"), "B");
});

test("master flag off blocks every card", () => {
  const checks = reviewChecks(readyItem(), ctx({ sendsApproved: false }));
  assert.equal(checks[0].key, "sends_locked");
  assert.equal(reviewVerdict(checks), "blocked");
});

test("a server refusal from a failed send is the first, blocked check", () => {
  const checks = reviewChecks(readyItem({ sendError: "Zu früh (429)." }), ctx());
  assert.equal(checks[0].key, "send_refused");
  assert.equal(checks[0].detail, "Zu früh (429).");
  assert.equal(reviewVerdict(checks), "blocked");
});

test("no provable DOI blocks unless single opt-in is allowed", () => {
  const blocked = reviewChecks(readyItem({ optInLevel: "SINGLE_OPT_IN" }), ctx());
  assert.ok(keys(blocked).includes("opt_in"));
  assert.equal(blocked.find((c) => c.key === "opt_in").fix, "skip");
  const allowed = reviewChecks(
    readyItem({ optInLevel: "UNKNOWN" }),
    ctx({ allowSingleOptIn: true })
  );
  assert.ok(!keys(allowed).includes("opt_in"));
});

test("frequency cap: a recent cross-channel send blocks with the release date in meta", () => {
  const lastSendAt = new Date(NOW.getTime() - 3 * DAY_MS).toISOString();
  const checks = reviewChecks(readyItem({ lastSendAt }), ctx({ minSendIntervalDays: 14 }));
  const cap = checks.find((c) => c.key === "frequency_cap");
  assert.ok(cap);
  assert.equal(cap.level, "blocked");
  assert.equal(cap.meta.untilIso, new Date(NOW.getTime() + 11 * DAY_MS).toISOString());
  // Cap disabled → no check even with a recent send.
  const off = reviewChecks(readyItem({ lastSendAt }), ctx({ minSendIntervalDays: 0 }));
  assert.ok(!keys(off).includes("frequency_cap"));
  // Old enough → fine.
  const old = reviewChecks(
    readyItem({ lastSendAt: new Date(NOW.getTime() - 20 * DAY_MS).toISOString() }),
    ctx()
  );
  assert.ok(!keys(old).includes("frequency_cap"));
});

test("prose stating a different percentage than the set discount blocks (send-path rule)", () => {
  const checks = reviewChecks(
    readyItem({ discountPercent: 10, body: "Mit MO-XXXX bekommst du 5 % Rabatt." }),
    ctx()
  );
  const c = checks.find((x) => x.key === "discount_mismatch");
  assert.ok(c);
  assert.equal(c.fix, "regenerate");
  assert.match(c.detail, /5 %/);
  assert.match(c.detail, /10 %/);
});

test("placeholder in the text while no discount is set blocks", () => {
  const checks = reviewChecks(
    readyItem({ discountPercent: 0, body: `Dein Code ${REVIEW_PLACEHOLDER_CODE} gilt 7 Tage.` }),
    ctx()
  );
  assert.ok(keys(checks).includes("placeholder_without_discount"));
  // Without the placeholder a 0 % draft is fine.
  const fine = reviewChecks(readyItem({ discountPercent: 0, body: "Hallo Lea, schau mal." }), ctx());
  assert.ok(!keys(fine).includes("placeholder_without_discount"));
});

test("low confidence, unavailable products, expiring and expired sets are hints", () => {
  const item = readyItem({
    lowConfidence: true,
    recommendations: [
      { id: "a", name: "A", url: "https://shop/a", available: false },
      { id: "b", name: "B", url: null, available: true },
    ],
    bundle: { expiresAt: new Date(NOW.getTime() + 1 * DAY_MS).toISOString() },
  });
  const checks = reviewChecks(item, ctx());
  assert.deepEqual(keys(checks), [
    "low_confidence",
    "product_unavailable",
    "bundle_expiring",
    "hero_present",
  ]);
  assert.equal(checks[1].detail, "A, B");
  assert.equal(reviewVerdict(checks), "hints");

  const expired = reviewChecks(
    readyItem({ bundle: { expiresAt: new Date(NOW.getTime() - DAY_MS).toISOString() } }),
    ctx()
  );
  assert.ok(keys(expired).includes("bundle_expired"));
});

test("hero: the A group without a hero is a hint, only while the design has a hero", () => {
  const missing = reviewChecks(readyItem({ heroUrl: null }), ctx());
  assert.ok(keys(missing).includes("hero_missing"));
  assert.equal(missing.find((c) => c.key === "hero_missing").fix, "generate_hero");
  const bGroup = reviewChecks(readyItem({ contactId: 13, heroUrl: null }), ctx());
  assert.ok(!keys(bGroup).includes("hero_missing"));
  const noHeroDesign = reviewChecks(readyItem({ heroUrl: null }), ctx({ heroDesignActive: false }));
  assert.deepEqual(keys(noHeroDesign), []);
});

test("stale drafts, non-sendable segments and long subjects are hints", () => {
  const checks = reviewChecks(
    readyItem({
      draftUpdatedAt: new Date(NOW.getTime() - (STALE_DRAFT_DAYS + 3) * DAY_MS).toISOString(),
      segment: "frisch",
      subject: "x".repeat(SUBJECT_MAX_CHARS + 1),
    }),
    ctx()
  );
  const k = keys(checks);
  assert.ok(k.includes("stale_draft"));
  assert.ok(k.includes("segment_not_sendable"));
  assert.ok(k.includes("subject_long"));
  assert.match(checks.find((c) => c.key === "stale_draft").title, /17 Tage/);
});

test("edits are an info; blocked checks always sort before hints and infos", () => {
  const checks = reviewChecks(
    readyItem({ edited: true, lowConfidence: true, optInLevel: "UNKNOWN" }),
    ctx()
  );
  assert.deepEqual(keys(checks), ["opt_in", "low_confidence", "hero_present", "edited"]);
  assert.equal(reviewVerdict(checks), "blocked");
  assert.equal(reviewVerdict([]), "ready");
});

test("test contacts skip the cadence cap and carry the Testkontakt info", () => {
  const now = new Date("2026-09-14T10:00:00Z");
  const item = {
    contactId: 2,
    optInLevel: CONFIRMED_OPT_IN,
    subject: "Test",
    body: "Hallo",
    lastSendAt: "2026-09-14T09:00:00Z",
    isTest: true,
  };
  const checks = reviewChecks(item, { sendsApproved: true, minSendIntervalDays: 14, now });
  assert.equal(checks.find((c) => c.key === "frequency_cap"), undefined);
  assert.equal(checks.find((c) => c.key === "test_contact")?.level, "info");
  assert.equal(reviewVerdict(checks), "ready");
  // The same facts on a real contact are blocked.
  const real = reviewChecks({ ...item, isTest: false }, { sendsApproved: true, minSendIntervalDays: 14, now });
  assert.equal(real.find((c) => c.key === "frequency_cap")?.level, "blocked");
});

test("a suppressed address blocks a real contact and only informs a test contact", () => {
  const base = { contactId: 3, optInLevel: CONFIRMED_OPT_IN, subject: "S", body: "B", suppressed: true };
  const real = reviewChecks(base, { sendsApproved: true, now: NOW });
  assert.equal(real.find((c) => c.key === "suppressed")?.level, "blocked");
  assert.equal(reviewVerdict(real), "blocked");
  const test = reviewChecks({ ...base, isTest: true }, { sendsApproved: true, now: NOW });
  assert.equal(test.find((c) => c.key === "suppressed"), undefined);
  assert.equal(test.find((c) => c.key === "test_suppressed")?.level, "info");
  assert.equal(reviewVerdict(test), "ready");
});
