import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeAudienceSpec,
  audienceQueryParams,
  describeAudienceSpec,
  audienceRestrictionCount,
} from "./audience-spec.mjs";

test("an empty spec is everyone with consent", () => {
  const spec = normalizeAudienceSpec(null);
  assert.deepEqual(spec, { v: 1 });
  assert.equal(audienceRestrictionCount(spec), 0);
  assert.equal(describeAudienceSpec(spec), "Alle Kunden mit Einwilligung für E-Mail-Werbung");
  const p = audienceQueryParams(spec);
  assert.equal(p.lifecycle, null);
  assert.equal(p.boughtAny, null);
  assert.equal(p.moContact, null);
});

test("unknown fields and values are dropped", () => {
  const spec = normalizeAudienceSpec({
    lifecycle: ["ausbauen", "nonsense", "ausbauen"],
    valueTier: ["riesig"],
    moContact: "maybe",
    boughtAny: ["Rack-Pro", "bad handle!", 7],
    country: ["de", "Deutschland"],
    persona: ["strength_focused", "DROP;"],
    excludeCampaignIds: [3, "4", -1, 3],
    hack: true,
  });
  assert.deepEqual(spec, {
    v: 1,
    lifecycle: ["ausbauen"],
    boughtAny: ["rack-pro"],
    country: ["DE"],
    persona: ["strength_focused"],
    excludeCampaignIds: [3],
  });
});

test("ranges are clamped and ordered", () => {
  const spec = normalizeAudienceSpec({ totalSpentEur: { min: 500, max: 150 }, lastOrderDays: { min: -3 } });
  assert.deepEqual(spec.totalSpentEur, { min: 150, max: 500 });
  assert.equal(spec.lastOrderDays, undefined);
});

test("query params turn days into cut-off instants and split the 'unknown' sentinels", () => {
  const now = new Date("2026-10-01T00:00:00.000Z");
  const spec = normalizeAudienceSpec({
    lifecycle: ["ausbauen", "unbekannt"],
    persona: ["unknown", "physio"],
    lastOrderDays: { min: 7, max: 730 },
    totalSpentEur: { min: 150 },
    excludeMailedWithinDays: 14,
  });
  const p = audienceQueryParams(spec, now);
  assert.deepEqual(p.lifecycle, ["ausbauen"]);
  assert.equal(p.lifecycleUnknown, true);
  assert.deepEqual(p.persona, ["physio"]);
  assert.equal(p.personaUnknown, true);
  assert.equal(p.lastOrderAfter, "2024-10-01T00:00:00.000Z");
  assert.equal(p.lastOrderBefore, "2026-09-24T00:00:00.000Z");
  assert.equal(p.spentMinCents, 15000);
  assert.equal(p.notMailedAfter, "2026-09-17T00:00:00.000Z");
});

test("the description reads like German, field by field", () => {
  const spec = normalizeAudienceSpec({
    lifecycle: ["ausbauen_frueh"],
    valueTier: ["komponente", "grossgeraet"],
    moContact: "no",
    excludeMailedWithinDays: 10,
    excludeCampaignIds: [1],
  });
  const text = describeAudienceSpec(spec, { campaignName: () => "Lebenszyklus" });
  assert.match(text, /Lebenszyklus: Ausbauen — früh/);
  assert.match(text, /Wertstufe: Komponenten, Großgeräte/);
  assert.match(text, /noch nie mit Mo gesprochen/);
  assert.match(text, /keine Werbe-Mail in den letzten 10 Tagen/);
  assert.match(text, /nicht in: Lebenszyklus/);
});
