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
    bundle: null,
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

// A set mail for the tests: a set attached, no code, prose without one.
const SET_MAIL = {
  discountPercent: 0,
  body: "Hallo Lea, dein persönliches Set für dein Training.",
  bundle: { expiresAt: new Date(NOW.getTime() + 6 * DAY_MS).toISOString() },
};

test("a set mail without a code is clean", () => {
  const checks = reviewChecks(readyItem(SET_MAIL), ctx());
  assert.deepEqual(keys(checks), ["hero_present"]);
});

test("a set mail with a code blocks (set XOR items), fixed by removing the discount", () => {
  const checks = reviewChecks(readyItem({ ...SET_MAIL, discountPercent: 10, body: readyItem().body }), ctx());
  const c = checks.find((x) => x.key === "offer_conflict");
  assert.ok(c);
  assert.equal(c.level, "blocked");
  assert.equal(c.fix, "remove_discount");
  assert.equal(reviewVerdict(checks), "blocked");
});

test("the retired scope \"set\" blocks while a code is set", () => {
  const noSet = reviewChecks(readyItem({ discountScope: "set", bundle: null }), ctx());
  assert.ok(keys(noSet).includes("discount_scope_no_set"));
  assert.equal(noSet.find((x) => x.key === "discount_scope_no_set").fix, null);
  assert.equal(reviewVerdict(noSet), "blocked");
  // With a set attached the conflict check speaks instead.
  const withSet = reviewChecks(readyItem({ discountScope: "set", bundle: SET_MAIL.bundle }), ctx());
  assert.ok(!keys(withSet).includes("discount_scope_no_set"));
  assert.ok(keys(withSet).includes("offer_conflict"));
});

test("a scoped discount without its target blocks (send-path rule)", () => {

  const noRecs = reviewChecks(readyItem({ discountScope: "recommendations", recommendations: [] }), ctx());
  assert.ok(keys(noRecs).includes("discount_scope_no_recommendations"));
  const soldOut = reviewChecks(
    readyItem({ discountScope: "recommendations", recommendations: [{ id: "a", name: "A", url: "https://shop/a", available: false }] }),
    ctx()
  );
  assert.ok(keys(soldOut).includes("discount_scope_no_recommendations"));
  const fine = reviewChecks(readyItem({ discountScope: "recommendations" }), ctx());
  assert.ok(!keys(fine).includes("discount_scope_no_recommendations"));
  // Without a discount the scope is irrelevant.
  const noDiscount = reviewChecks(
    readyItem({ discountPercent: 0, discountScope: "set", bundle: null, body: "Hallo Lea, ohne Code." }),
    ctx()
  );
  assert.ok(!keys(noDiscount).some((k) => k.startsWith("discount_scope")));
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

test("low confidence and unavailable products are hints in an item mail", () => {
  const item = readyItem({
    lowConfidence: true,
    recommendations: [
      { id: "a", name: "A", url: "https://shop/a", available: false },
      { id: "b", name: "B", url: null, available: true },
      { id: "c", name: "C", url: "https://shop/c", available: null },
      { id: "d", name: "D", url: "https://shop/d", available: true },
    ],
  });
  const checks = reviewChecks(item, ctx());
  assert.deepEqual(keys(checks), ["low_confidence", "product_unavailable", "hero_present"]);
  // sold out, no link, and no longer in the catalog all count
  assert.equal(checks[1].detail, "A, B, C");
  assert.equal(reviewVerdict(checks), "hints");
});

test("a set mail ignores the recommendation hints; expiring and expired sets are hints", () => {
  const item = readyItem({
    ...SET_MAIL,
    lowConfidence: true,
    recommendations: [{ id: "a", name: "A", url: "https://shop/a", available: false }],
    bundle: { expiresAt: new Date(NOW.getTime() + 1 * DAY_MS).toISOString() },
  });
  const checks = reviewChecks(item, ctx());
  assert.deepEqual(keys(checks), ["bundle_expiring", "hero_present"]);
  assert.equal(reviewVerdict(checks), "hints");

  const expired = reviewChecks(
    readyItem({ ...SET_MAIL, bundle: { expiresAt: new Date(NOW.getTime() - DAY_MS).toISOString() } }),
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

test("hero: the campaign's hero mode decides who needs one", () => {
  // ai_all: every card, odd ids too.
  const all = reviewChecks(readyItem({ contactId: 13, heroUrl: null }), ctx({ heroMode: "ai_all" }));
  assert.ok(keys(all).includes("hero_missing"));
  assert.equal(all.find((c) => c.key === "hero_missing").title, "Ohne KI-Hero");
  // default / none: no hero hints at all.
  for (const heroMode of ["default", "none"]) {
    const none = reviewChecks(readyItem({ heroUrl: null }), ctx({ heroMode }));
    assert.ok(!keys(none).includes("hero_missing"), heroMode);
  }
});

test("the send window only applies to campaigns that use it", () => {
  const aktion = reviewChecks(readyItem({ segment: "frisch" }), ctx({ sendWindowApplies: false }));
  assert.ok(!keys(aktion).includes("segment_not_sendable"));
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

test("contact frequency: a hint at/over the threshold with the numbers in meta", () => {
  const settings = { maxMails: 3, windowDays: 30 };
  const below = reviewChecks(readyItem({ recentMailCount: 2 }), ctx({ contactFrequency: settings }));
  assert.equal(below.find((c) => c.key === "contact_frequency"), undefined);
  const at = reviewChecks(readyItem({ recentMailCount: 3 }), ctx({ contactFrequency: settings }));
  const hint = at.find((c) => c.key === "contact_frequency");
  assert.equal(hint?.level, "hint");
  assert.equal(hint?.title, "Schon 3 Werbe-Mails in 30 Tagen");
  assert.match(hint?.detail ?? "", /Nur ein Hinweis/);
  assert.equal(hint?.fix, null);
  assert.deepEqual(hint?.meta, { count: 3, maxMails: 3, windowDays: 30 });
  // A warning, never a block.
  assert.equal(reviewVerdict(at), "hints");
});

test("contact frequency: no hint when off, unknown, without settings or for a Testkontakt", () => {
  const item = readyItem({ recentMailCount: 9 });
  assert.equal(reviewChecks(item, ctx()).find((c) => c.key === "contact_frequency"), undefined);
  for (const contactFrequency of [{ maxMails: 0, windowDays: 30 }, { maxMails: 3, windowDays: 0 }, null]) {
    const checks = reviewChecks(item, ctx({ contactFrequency }));
    assert.equal(checks.find((c) => c.key === "contact_frequency"), undefined, JSON.stringify(contactFrequency));
  }
  const unknown = reviewChecks(readyItem({ recentMailCount: null }), ctx({ contactFrequency: { maxMails: 1, windowDays: 30 } }));
  assert.equal(unknown.find((c) => c.key === "contact_frequency"), undefined);
  const test = reviewChecks(readyItem({ recentMailCount: 9, isTest: true }), ctx({ contactFrequency: { maxMails: 1, windowDays: 30 } }));
  assert.equal(test.find((c) => c.key === "contact_frequency"), undefined);
});
