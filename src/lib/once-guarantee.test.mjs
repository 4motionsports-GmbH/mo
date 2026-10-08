import { test } from "node:test";
import assert from "node:assert/strict";
import {
  OUTBOX_GRACE_MS,
  SHOPIFY_TRIGGER_WINDOW_MS,
  WELCOME_TAG_GRACE_MS,
  c29Verdict,
  consentWebhookVerdict,
  welcomeVerdict,
} from "./once-guarantee.mjs";

test("C.29: Shopify pending without a Shopify event is flagged, worse with a Mo DOI mail", () => {
  const pending = { state: "pending", level: null, at: null };
  assert.equal(c29Verdict({ moState: "not_subscribed", hasShopifyEvent: false, moDoiMail: false, shopify: pending }).key, "pending_lost");
  const twice = c29Verdict({ moState: "pending", hasShopifyEvent: false, moDoiMail: true, shopify: pending });
  assert.deepEqual([twice.key, twice.flag], ["double_doi", true]);
  // Mo recorded the shop's pending (webhook or opt-in precheck): fine.
  assert.equal(c29Verdict({ moState: "pending", hasShopifyEvent: true, moDoiMail: false, shopify: pending }).flag, false);
  assert.equal(
    c29Verdict({ moState: "not_subscribed", hasShopifyEvent: false, moDoiMail: false, shopify: { state: "subscribed", level: "confirmed_opt_in", at: null } }).key,
    "subscribed_lost"
  );
});

test("C.29: matching or explainable states are not flagged; unreadable Shopify is unknown", () => {
  const ok = (moState, state) => c29Verdict({ moState, hasShopifyEvent: false, moDoiMail: true, shopify: { state } });
  assert.equal(ok("subscribed", "subscribed").key, "ok");
  // Mo's own DOI is pending; Shopify only learns about it on the confirmation.
  assert.equal(ok("pending", "not_subscribed").key, "ok");
  const differs = ok("unsubscribed", "not_subscribed");
  assert.deepEqual([differs.key, differs.flag], ["differs", false]);
  assert.match(differs.label, /Shopify not_subscribed, Mo unsubscribed/);
  assert.equal(c29Verdict({ moState: "subscribed", hasShopifyEvent: false, moDoiMail: false, shopify: null }).key, "unknown");
  assert.equal(c29Verdict({ moState: "subscribed", hasShopifyEvent: false, moDoiMail: false, shopify: null }).flag, false);
});

test("welcome (a): late push, missing tag after the grace, waiting, tagged", () => {
  const conf = "2026-10-08T10:00:00Z";
  const now = Date.parse("2026-10-08T14:00:00Z");
  const sub = { state: "subscribed" };
  const v = (pushedAt, tags, extra = {}) => welcomeVerdict({ confirmedAt: conf, pushedAt, tags, tag: "w", shopify: sub, now, ...extra });
  assert.equal(v("2026-10-09T11:00:00Z", []).key, "late_push");
  assert.equal(v("2026-10-09T11:00:00Z", []).flag, true);
  assert.equal(v("2026-10-08T10:00:05Z", []).key, "no_tag");
  assert.equal(v("2026-10-08T13:30:00Z", []).key, "waiting");
  assert.equal(v("2026-10-08T13:30:00Z", []).flag, false);
  assert.equal(v("2026-10-08T10:00:05Z", ["x", "w"]).key, "tagged");
  // Dates from the driver arrive as Date objects.
  assert.equal(v(new Date("2026-10-08T10:00:05Z"), ["w"], { confirmedAt: new Date(conf) }).key, "tagged");
  // Without a live read the mirror's tags count; null tags = no tag.
  assert.equal(v("2026-10-08T10:00:05Z", null, { shopify: null }).key, "no_tag");
  assert.equal(v("2026-10-08T10:00:05Z", ["w"], { shopify: null }).key, "tagged");
});

test("welcome (a): not written to Shopify, with a short grace; not subscribed in Shopify", () => {
  const conf = "2026-10-08T10:00:00Z";
  const confMs = Date.parse(conf);
  const base = { confirmedAt: conf, pushedAt: null, tags: [], tag: "w", shopify: null };
  assert.equal(welcomeVerdict({ ...base, now: confMs + OUTBOX_GRACE_MS + 1 }).key, "not_pushed");
  assert.equal(welcomeVerdict({ ...base, now: confMs + OUTBOX_GRACE_MS + 1 }).flag, true);
  assert.equal(welcomeVerdict({ ...base, now: confMs + 60_000 }).key, "waiting");
  assert.equal(welcomeVerdict({ ...base, confirmedAt: null, now: confMs }).key, "not_pushed");
  const notSub = welcomeVerdict({ ...base, pushedAt: conf, shopify: { state: "pending" }, now: confMs });
  assert.deepEqual([notSub.key, notSub.flag], ["not_subscribed", true]);
});

test("welcome (a): the windows are 24 h, 2 h and 15 min", () => {
  assert.equal(SHOPIFY_TRIGGER_WINDOW_MS, 24 * 3600 * 1000);
  assert.equal(WELCOME_TAG_GRACE_MS, 2 * 3600 * 1000);
  assert.equal(OUTBOX_GRACE_MS, 15 * 60 * 1000);
  const conf = Date.parse("2026-10-08T10:00:00Z");
  const at = (d) => new Date(conf + d).toISOString();
  const v = (pushOffset) =>
    welcomeVerdict({ confirmedAt: at(0), pushedAt: at(pushOffset), tags: ["w"], tag: "w", shopify: null, now: conf + 2 * SHOPIFY_TRIGGER_WINDOW_MS }).key;
  assert.equal(v(SHOPIFY_TRIGGER_WINDOW_MS), "tagged");
  assert.equal(v(SHOPIFY_TRIGGER_WINDOW_MS + 1), "late_push");
});

test("consent webhook outcomes: the dropped consent is flagged, the C.29 fix is named", () => {
  assert.deepEqual(
    [consentWebhookVerdict("ignored:unknown-customer").key, consentWebhookVerdict("ignored:unknown-customer").flag],
    ["lost", true]
  );
  assert.equal(consentWebhookVerdict("consent:applied:imported").key, "imported");
  assert.equal(consentWebhookVerdict("consent:applied:imported-payload(timeout)").key, "imported");
  assert.equal(consentWebhookVerdict("raced").key, "raced");
  assert.equal(consentWebhookVerdict("ignored:sync-off").key, "sync_off");
  assert.equal(consentWebhookVerdict(null).key, "open");
  for (const o of ["consent:applied", "updated", "inserted", "ignored:redacted", "ok"]) {
    assert.deepEqual([consentWebhookVerdict(o).key, consentWebhookVerdict(o).flag], ["other", false], o);
  }
});
