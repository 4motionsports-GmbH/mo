import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canTransition,
  transitionLabel,
  slugifyCampaignName,
  validateCampaignInput,
  campaignPhase,
  isCampaignLive,
  campaignDiscountExpiry,
  planAutoPrepare,
} from "./campaign-def.mjs";

test("status transitions follow the lifecycle; Einzelansprache never changes", () => {
  assert.equal(canTransition("entwurf", "aktiv", "aktion"), true);
  assert.equal(canTransition("aktiv", "pausiert", "laufend"), true);
  assert.equal(canTransition("pausiert", "aktiv", "laufend"), true);
  assert.equal(canTransition("aktiv", "entwurf", "aktion"), false);
  assert.equal(canTransition("archiviert", "aktiv", "aktion"), false);
  assert.equal(canTransition("aktiv", "pausiert", "einzel"), false);
  assert.equal(transitionLabel("entwurf", "aktiv"), "Starten");
  assert.equal(transitionLabel("pausiert", "aktiv"), "Fortsetzen");
});

test("slugs are URL-safe and transliterate umlauts", () => {
  assert.equal(slugifyCampaignName("Black Friday 2026"), "black-friday-2026");
  assert.equal(slugifyCampaignName("Frühjahrs-Größen!"), "fruehjahrs-groessen");
  assert.equal(slugifyCampaignName("  "), "kampagne");
});

test("create validation reports German errors per field", () => {
  const bad = validateCampaignInput({ name: "BF", kind: "einzel", discountPercent: 80 }, { create: true });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.name);
  assert.ok(bad.errors.kind);
  assert.ok(bad.errors.discountPercent);

  const good = validateCampaignInput(
    {
      name: "Black Friday",
      kind: "aktion",
      startsAt: "2026-11-27T00:00:00+01:00",
      endsAt: "2026-12-01T00:00:00+01:00",
      discountPercent: 15,
      audience: { lifecycle: ["zurueckholen"] },
      ctaKind: "shop",
      ctaUrl: "https://motion-sports.de/collections/black-friday",
    },
    { create: true }
  );
  assert.equal(good.ok, true, JSON.stringify(good.errors));
  assert.equal(good.value.startsAt, "2026-11-26T23:00:00.000Z");
  assert.deepEqual(good.value.audience, { v: 1, lifecycle: ["zurueckholen"] });
});

test("an end before the start and a shop CTA without link are refused", () => {
  const r = validateCampaignInput({ startsAt: "2026-11-27", endsAt: "2026-11-20", ctaKind: "shop", ctaUrl: "" });
  assert.ok(r.errors.endsAt);
  assert.ok(r.errors.ctaUrl);
  assert.ok(validateCampaignInput({ ctaUrl: "http://insecure.example" }).errors.ctaUrl);
});

test("patch validation only looks at the fields present", () => {
  const r = validateCampaignInput({ priority: 20 });
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, { priority: 20 });
});

test("phase: geplant, läuft, abgelaufen", () => {
  const now = new Date("2026-11-20T12:00:00Z");
  const c = { status: "aktiv", startsAt: "2026-11-27T00:00:00Z", endsAt: "2026-12-01T00:00:00Z" };
  assert.equal(campaignPhase(c, now), "geplant");
  assert.equal(campaignPhase(c, new Date("2026-11-28T00:00:00Z")), "laeuft");
  assert.equal(isCampaignLive(c, new Date("2026-12-02T00:00:00Z")), false);
  assert.equal(campaignPhase({ status: "pausiert" }, now), "pausiert");
});

test("an Aktion's codes end with the Aktion; otherwise the default validity", () => {
  const now = new Date("2026-11-27T10:00:00Z");
  assert.equal(
    campaignDiscountExpiry({ discountValidUntil: "2026-11-30T22:59:00Z" }, 14, now),
    "2026-11-30T22:59:00.000Z"
  );
  assert.equal(campaignDiscountExpiry({ discountValidUntil: null }, 14, now), "2026-12-11T10:00:00.000Z");
  // An end in the past never produces an expired code.
  assert.equal(campaignDiscountExpiry({ discountValidUntil: "2026-11-01T00:00:00Z" }, 7, now), "2026-12-04T10:00:00.000Z");
});

test("auto-prepare plan: live campaigns by priority within the global budget", () => {
  const now = new Date("2026-11-28T00:00:00Z");
  const plan = planAutoPrepare(
    [
      { id: 1, kind: "laufend", status: "aktiv", priority: 10, autoPreparePerDay: 20 },
      { id: 2, kind: "aktion", status: "aktiv", priority: 50, autoPreparePerDay: 30, startsAt: "2026-11-27T00:00:00Z" },
      { id: 3, kind: "aktion", status: "pausiert", priority: 90, autoPreparePerDay: 30 },
      { id: 4, kind: "einzel", status: "aktiv", priority: 100, autoPreparePerDay: 5 },
    ],
    40,
    now
  );
  assert.deepEqual(plan, [
    { campaignId: 2, count: 30 },
    { campaignId: 1, count: 10 },
  ]);
});

test("validateCampaignInput: a chat button needs the Mo block", () => {
  const bad = validateCampaignInput({ name: "BF", kind: "aktion", ctaKind: "mo_chat", moPromo: false }, { create: true });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.moPromo);
  const shop = validateCampaignInput(
    { name: "BF", kind: "aktion", ctaKind: "shop", ctaUrl: "https://motionsports.de/collections/bf", moPromo: false },
    { create: true }
  );
  assert.equal(shop.errors.moPromo, undefined);
  // A create without ctaKind gets the chat button (the column default).
  assert.ok(validateCampaignInput({ name: "BF", kind: "aktion", moPromo: false }, { create: true }).errors.moPromo);
  // A patch reads the other field from the stored campaign.
  const current = { ctaKind: "mo_chat", moPromo: true };
  assert.ok(validateCampaignInput({ moPromo: false }, { current }).errors.moPromo);
  assert.ok(validateCampaignInput({ ctaKind: "mo_chat" }, { current: { ctaKind: "shop", moPromo: false } }).errors.moPromo);
  assert.equal(validateCampaignInput({ moPromo: false }, { current: { ctaKind: "shop", moPromo: true } }).ok, true);
  assert.equal(validateCampaignInput({ name: "Neu" }, { current: { ctaKind: "mo_chat", moPromo: false } }).ok, true);
});
