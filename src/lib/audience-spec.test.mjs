import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AUDIENCE_MAX_EMAILS,
  AUDIENCE_PRESETS,
  normalizeAudienceSpec,
  audienceQueryParams,
  audiencePresetOf,
  audiencePresetSpec,
  describeAudienceSpec,
  audienceRestrictionCount,
  parseAudienceEmails,
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

test("„Nur diese Adressen“: normalised, de-duplicated, at most 50", () => {
  const spec = normalizeAudienceSpec({ emails: [" Anna@Example.DE ", "anna@example.de", "kaputt", 7, "b@example.de"] });
  assert.deepEqual(spec, { v: 1, emails: ["anna@example.de", "b@example.de"] });
  const many = Array.from({ length: 60 }, (_, i) => `t${i}@example.de`);
  assert.equal(normalizeAudienceSpec({ emails: many }).emails.length, AUDIENCE_MAX_EMAILS);
  assert.equal(normalizeAudienceSpec({ emails: [] }).emails, undefined);
  assert.deepEqual(audienceQueryParams(spec).emails, ["anna@example.de", "b@example.de"]);
  assert.equal(audienceQueryParams(normalizeAudienceSpec({})).emails, null);
});

test("the pasted list: lines, commas, semicolons, „Name <adresse>“", () => {
  const r = parseAudienceEmails("Anna@X.de, b@y.de\nb@y.de; foo@ ;  Max Muster <max@muster.de>\nanna.x.de\nDr.");
  assert.deepEqual(r.emails, ["anna@x.de", "b@y.de", "max@muster.de"]);
  assert.deepEqual(r.invalid, ["foo@", "anna.x.de"]);
  assert.equal(r.duplicates, 1);
  assert.equal(r.overLimit, 0);
  const over = parseAudienceEmails(Array.from({ length: 52 }, (_, i) => `t${i}@x.de`).join("\n"));
  assert.equal(over.emails.length, AUDIENCE_MAX_EMAILS);
  assert.equal(over.overLimit, 2);
  assert.deepEqual(parseAudienceEmails(""), { emails: [], invalid: [], duplicates: 0, overLimit: 0 });
});

test("„Hat Rundmail erhalten“ (optionally without a click)", () => {
  const spec = normalizeAudienceSpec({ receivedCampaign: { id: 12, notClicked: true } });
  assert.deepEqual(spec.receivedCampaign, { id: 12, notClicked: true });
  const p = audienceQueryParams(spec);
  assert.equal(p.receivedCampaignId, 12);
  assert.equal(p.receivedNotClicked, true);
  assert.deepEqual(normalizeAudienceSpec({ receivedCampaign: { id: 12, notClicked: "ja" } }).receivedCampaign, { id: 12 });
  assert.equal(audienceQueryParams(normalizeAudienceSpec({ receivedCampaign: { id: 12 } })).receivedNotClicked, false);
  for (const bad of [{ id: "12" }, { id: -1 }, { id: 1.5 }, [12], 12, null]) {
    assert.equal(normalizeAudienceSpec({ receivedCampaign: bad }).receivedCampaign, undefined, JSON.stringify(bad));
  }
  const none = audienceQueryParams(normalizeAudienceSpec({}));
  assert.equal(none.receivedCampaignId, null);
  assert.equal(none.receivedNotClicked, null);
});

test("the description names the test group and the received Rundmail", () => {
  const text = describeAudienceSpec(normalizeAudienceSpec({ emails: ["a@b.de", "c@d.de"], receivedCampaign: { id: 4, notClicked: true } }), {
    campaignName: (id) => (id === 4 ? "Black Friday" : `#${id}`),
  });
  assert.match(text, /^Alle Kunden mit Einwilligung für E-Mail-Werbung · /);
  assert.match(text, /hat „Black Friday“ erhalten, aber nicht geklickt/);
  assert.match(text, /nur diese 2 Adressen \(Testgruppe\)/);
  assert.match(describeAudienceSpec(normalizeAudienceSpec({ emails: ["a@b.de"] })), /nur diese 1 Adresse/);
});

test("presets: Alle mit Einwilligung, Nur Double-Opt-in, Testgruppe, Eigene Filter", () => {
  assert.equal(audiencePresetOf({ v: 1 }), "alle");
  assert.equal(audiencePresetOf(null), "alle");
  assert.equal(audiencePresetOf({ optInLevels: ["confirmed_opt_in"] }), "doi");
  assert.equal(audiencePresetOf({ optInLevels: ["confirmed_opt_in", "single_opt_in"] }), "eigene");
  assert.equal(audiencePresetOf({ emails: ["a@b.de"] }), "test");
  assert.equal(audiencePresetOf({ emails: ["a@b.de"], language: ["de"] }), "eigene");
  assert.equal(audiencePresetOf({ lifecycle: ["ausbauen"] }), "eigene");
  assert.deepEqual(audiencePresetSpec("alle"), { v: 1 });
  assert.deepEqual(audiencePresetSpec("doi"), { v: 1, optInLevels: ["confirmed_opt_in"] });
  assert.deepEqual(audiencePresetSpec("test", { emails: ["A@b.de"] }), { v: 1, emails: ["a@b.de"] });
  assert.deepEqual(audiencePresetSpec("eigene", { spec: { churn: ["hoch"], bogus: 1 } }), { v: 1, churn: ["hoch"] });
  assert.deepEqual(AUDIENCE_PRESETS, ["alle", "doi", "test", "eigene"]);
});
