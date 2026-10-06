import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  SNAPSHOT_VERSION,
  MIN_RATE_BASE,
  previousPeriod,
  describePeriod,
  metric,
  metricDelta,
  formatMetricValue,
  formatMetricDelta,
  isSmallSample,
  safeRate,
  ADMIN_LINKS,
  adminLinkFor,
  LINK_TARGETS,
  scrubPii,
  buildBusinessSnapshot,
  snapshotSection,
  snapshotMetric,
  flattenSnapshot,
  renderSnapshotForPrompt,
  describeSwitches,
  HEADLINE_METRICS,
  SNAPSHOT_RAW_FIELDS,
  snapshotRevenue,
  campaignCodesIn,
  campaignRevenueByCode,
  withCampaignRevenue,
} from "./business-snapshot-core.mjs";
import {
  mergeCodeRedemptions,
  previousPeriod as revenuePreviousPeriod,
  revenuePerAiEuro,
  summariseRevenue,
} from "./mo-revenue.mjs";
import { journeyFunnel } from "./kpi-journey.mjs";
import { hasFieldPath, recordFieldReads } from "./field-reads.mjs";
import {
  SAMPLE_SNAPSHOT_RAW,
  SAMPLE_PERIOD,
  SAMPLE_PREVIOUS,
  SAMPLE_MO_REVENUE,
  SAMPLE_SHOPIFY,
} from "./business-snapshot.fixtures.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

test("previousPeriod is the equally long window right before", () => {
  assert.deepEqual(previousPeriod({ from: "2026-08-10", to: "2026-09-08" }), {
    from: "2026-07-11",
    to: "2026-08-09",
    days: 30,
    label: "11.07.2026 – 09.08.2026",
  });
  // A single day → the day before.
  const one = previousPeriod({ from: "2026-10-06", to: "2026-10-06" });
  assert.equal(one.from, "2026-10-05");
  assert.equal(one.to, "2026-10-05");
  assert.equal(one.label, "05.10.2026");
  // Across a year boundary.
  const y = previousPeriod({ from: "2026-01-01", to: "2026-01-07" });
  assert.equal(y.from, "2025-12-25");
  assert.equal(y.to, "2025-12-31");
  assert.equal(describePeriod({ from: "2026-01-01", to: "2026-01-07" }).days, 7);
  // The same window the KPI screen compares with (mo-revenue previousPeriod).
  for (const range of [
    { from: "2026-08-10", to: "2026-09-08" },
    { from: "2026-10-06", to: "2026-10-06" },
    { from: "2026-01-01", to: "2026-01-07" },
    { from: "2026-02-01", to: "2026-03-31" },
  ]) {
    const { from, to, days } = previousPeriod(range);
    assert.deepEqual({ from, to, days }, revenuePreviousPeriod(range), JSON.stringify(range));
  }
});

test("metricDelta: relative for amounts, percentage points for rates, null without a previous value", () => {
  const amount = metric("x.eur", "Umsatz", "eur", 150, 100);
  assert.equal(metricDelta(amount).rel, 0.5);
  assert.equal(metricDelta(amount).favourable, true);
  assert.equal(formatMetricDelta(amount), "+50 %");

  const down = metric("x.cost", "Kosten", "eur", 80, 100, { good: "down" });
  assert.equal(metricDelta(down).favourable, true, "falling costs are favourable");

  const rate = metric("x.rate", "Quote", "rate", 0.25, 0.2, { base: 100 });
  assert.equal(Math.round(metricDelta(rate).points * 10) / 10, 5);
  assert.equal(formatMetricDelta(rate), "+5 Pp.");

  const fresh = metric("x.n", "Neu", "count", 4, 0);
  assert.equal(metricDelta(fresh).isNew, true);
  assert.equal(formatMetricDelta(fresh), "neu");

  assert.equal(metricDelta(metric("x.n", "Ohne", "count", 4, null)), null);
  assert.equal(formatMetricDelta(metric("x.n", "Ohne", "count", 4, null)), "");

  const neutral = metric("x.n", "Neutral", "count", 5, 3, { good: "none" });
  assert.equal(metricDelta(neutral).favourable, null);
});

test("formatMetricValue renders every unit in German", () => {
  assert.equal(formatMetricValue("count", 1234), "1.234");
  assert.equal(formatMetricValue("rate", 0.123), "12,3 %");
  assert.equal(formatMetricValue("ratio", 0.604), "0,6");
  assert.equal(formatMetricValue("score", 4.2), "4,2 / 5");
  assert.equal(formatMetricValue("hours", 30.5), "30,5 Std.");
  assert.match(formatMetricValue("eur", 9120.4), /9\.120\s€/);
  assert.match(formatMetricValue("eur", 0.041), /0,04\s€/);
  assert.equal(formatMetricValue("count", null), "—");
});

test("isSmallSample flags rates below the minimum base only", () => {
  assert.equal(isSmallSample(metric("a", "A", "rate", 0.5, null, { base: MIN_RATE_BASE - 1 })), true);
  assert.equal(isSmallSample(metric("a", "A", "rate", 0.5, null, { base: MIN_RATE_BASE })), false);
  assert.equal(isSmallSample(metric("a", "A", "count", 3, null, { base: 3 })), false);
  assert.equal(safeRate(1, 0), null);
  assert.equal(safeRate(null, 3), null);
});

test("adminLinkFor builds deep links; KPI links carry the period and the section anchor", () => {
  assert.deepEqual(adminLinkFor("kpi_umsatz", { from: "2026-08-10", to: "2026-09-08" }), {
    href: "/admin?tab=kpi&kpiRange=custom&kpiFrom=2026-08-10&kpiTo=2026-09-08#kpi-umsatz",
    label: "KPIs · Umsatz",
  });
  assert.equal(adminLinkFor("kunden_abwanderung").href, "/admin?tab=kunden&kview=abwanderung");
  assert.equal(adminLinkFor("kampagne_neu").href, "/admin?tab=kampagne&edit=new");
  assert.equal(adminLinkFor("eingang").href, "/admin");
  assert.equal(adminLinkFor("none"), null);
  assert.equal(adminLinkFor("bogus"), null);
  assert.ok(LINK_TARGETS.includes("none"));
  for (const key of LINK_TARGETS.filter((k) => k !== "none")) {
    assert.ok(adminLinkFor(key, SAMPLE_PERIOD)?.href.startsWith("/admin"), key);
  }
});

test("every KPI link anchor is a section of the KPI screen", () => {
  // <KpiSection id="…"> renders id="kpi-…" (kpi/KpiSection.tsx).
  const dir = join(__dirname, "../app/admin/kpi/sections");
  const ids = new Set();
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".tsx"))) {
    const src = readFileSync(join(dir, f), "utf8");
    for (const m of src.matchAll(/<KpiSection\s[^>]*?\bid="([^"]+)"/gs)) ids.add(m[1]);
  }
  assert.ok(ids.size > 10, "found the KPI sections");
  for (const [key, def] of Object.entries(ADMIN_LINKS)) {
    if (def.anchor) assert.ok(ids.has(def.anchor), `${key} → #kpi-${def.anchor}`);
  }
});

test("scrubPii masks contact data and identifiers but keeps the prose", () => {
  const raw =
    "Kundin anna.mueller@example.de (Tel. +49 170 1234567, 030 12345678) fragt nach Bestellung #10234 " +
    "und Kundennummer 88812345; IBAN DE89 3704 0044 0532 0130 00; Link https://shop.example/?ref=abc. " +
    "Sie möchte ein leises Laufband für 2 Personen.";
  const clean = scrubPii(raw);
  assert.ok(!clean.includes("anna.mueller"));
  assert.ok(!clean.includes("1234567"));
  assert.ok(!clean.includes("12345678"));
  assert.ok(!clean.includes("10234"));
  assert.ok(!clean.includes("88812345"));
  assert.ok(!clean.includes("DE89"));
  assert.ok(!clean.includes("https://"));
  assert.ok(clean.includes("leises Laufband für 2 Personen"));
  assert.equal(scrubPii(null), "");
});

test("buildBusinessSnapshot shapes the raw data into versioned sections with previous values", () => {
  const s = buildBusinessSnapshot(SAMPLE_SNAPSHOT_RAW);
  assert.equal(s.version, SNAPSHOT_VERSION);
  assert.deepEqual(s.period, SAMPLE_PERIOD);
  assert.deepEqual(s.previous, SAMPLE_PREVIOUS);
  assert.deepEqual(
    s.sections.map((x) => x.key),
    ["revenue", "chat", "signin", "consent", "campaigns", "customers", "inbox", "quality", "costs"]
  );

  const total = snapshotMetric(s, "revenue.total");
  assert.equal(total.value, 15220.9, "ledger 14.920,90 € + 300 € from the Shopify code lookup");
  assert.equal(total.previous, 10120);
  assert.match(total.hint, /Shopify-Code-Abgleich/);
  assert.equal(snapshotMetric(s, "revenue.orders").value, 22);
  assert.equal(snapshotMetric(s, "revenue.direct").value, 9120.4);
  assert.equal(snapshotMetric(s, "revenue.assisted").value, 1890);
  assert.equal(snapshotMetric(s, "revenue.influenced").value, 4210.5);
  assert.equal(snapshotMetric(s, "revenue.withMoCode").value, 1980.4);
  assert.equal(snapshotMetric(s, "revenue.unrealised").value, 2);
  assert.equal(snapshotMetric(s, "revenue.codeComplement").value, 300);
  assert.equal(snapshotMetric(s, "revenue.unresolved").value, 3);
  assert.equal(snapshotMetric(s, "revenue.unresolved").good, "down");
  assert.equal(snapshotMetric(s, "journey.chatToOrder").value, Math.round((8 / 88) * 10000) / 10000);
  assert.equal(snapshotMetric(s, "journey.chatToOrder").base, 88);
  assert.equal(snapshotMetric(s, "bundles.revenue").value, 5120);

  assert.equal(snapshotMetric(s, "chat.engagement").value, Math.round((101 / 212) * 10000) / 10000);
  assert.equal(snapshotMetric(s, "chat.engagement").base, 212);
  assert.equal(snapshotMetric(s, "signin.popupRate").value, Math.round((17 / 140) * 10000) / 10000);
  assert.equal(snapshotMetric(s, "consent.popupShown").value, 30);
  assert.equal(snapshotMetric(s, "campaigns.sent").value, 30);
  assert.equal(snapshotMetric(s, "campaigns.sent").previous, 19);
  assert.equal(snapshotMetric(s, "campaigns.revenue").value, 1340.4);
  assert.equal(snapshotMetric(s, "letters.cost").value, 4.24);
  assert.equal(snapshotMetric(s, "ledger.repeatShare").value, Math.round((43 / 104) * 10000) / 10000);
  // Mo's share of the shop revenue: 15.220,90 € of 98.400 €.
  assert.equal(snapshotMetric(s, "ledger.moShare").value, Math.round((15220.9 / 98400) * 10000) / 10000);
  // Lifetime figures carry no previous value.
  assert.equal(snapshotMetric(s, "customers.total").previous, null);
  assert.equal(snapshotMetric(s, "customers.subscribed").value, 212);
  assert.equal(snapshotMetric(s, "costs.roi").value, 711.26);
  assert.equal(snapshotMetric(s, "orderStatus.answered").value, Math.round((8 / 11) * 10000) / 10000);
  assert.equal(snapshotMetric(s, "orderStatus.answered").previous, null);

  // Tables: tiers in display order, channels as on the KPI screen, campaigns matched across periods.
  const revenue = snapshotSection(s, "revenue");
  assert.deepEqual(
    revenue.tables.find((t) => t.key === "revenue.tiers").rows.map((r) => r.key),
    ["assisted", "influenced", "direct"]
  );
  const channels = revenue.tables.find((t) => t.key === "revenue.channels");
  assert.deepEqual(
    channels.rows.map((r) => r.key),
    ["beraten_gekauft", "beraten_anderes", "zusammenfassung", "set", "kampagne", "marketing"],
    "„Sonstiger Mo-Weg“ only when it holds an order"
  );
  const set = channels.rows.find((r) => r.key === "set");
  assert.deepEqual(set.values, { orders: 4, revenue: 5120, share: 5120 / 15220.9, aov: 1280 });
  assert.equal(set.previous.revenue, 3268.65);
  const byCampaign = snapshotSection(s, "campaigns").tables[0];
  const einzel = byCampaign.rows.find((r) => r.label === "Einzelansprache");
  assert.equal(einzel.values.sent, 6);
  assert.equal(einzel.previous.sent, 4);
  assert.deepEqual([einzel.values.orders, einzel.values.revenue, einzel.previous.revenue], [1, 300, 200]);
  const herbst = byCampaign.rows.find((r) => r.label === "Herbst-Kraftraum");
  assert.deepEqual([herbst.values.orders, herbst.values.revenue], [3, 1040.4], "incl. the code found at Shopify");
  const sommer = byCampaign.rows.find((r) => r.label === "Sommer-Ausdauer");
  assert.equal(sommer.values.sent, 0, "a campaign of the previous period only shows 0 now");
  assert.equal(sommer.previous.revenue, 610);

  // Funnels narrow from step to step; the journey comes first.
  assert.equal(s.funnels[0].key, "journey");
  assert.deepEqual(s.funnels[0].steps.map((x) => x.value), [88, 61, 30, 9, 5]);
  assert.deepEqual(s.funnels[0].steps.map((x) => x.previous), [66, 40, 20, 5, 3]);
  const chat = s.funnels.find((f) => f.key === "chat");
  assert.deepEqual(chat.steps.map((x) => x.value), [1840, 212, 101]);
  const campaign = s.funnels.find((f) => f.key === "campaign");
  assert.deepEqual(campaign.steps.map((x) => x.value), [30, 10, 4, 4]);
});

test("„Umsatz durch Mo“ is the KPI screen's fold — same tiers, channels, dedupe and ROI", () => {
  // What kpi/revenue-view buildRevenueView computes from the same inputs.
  const { extra, alreadyCounted } = mergeCodeRedemptions({
    ledgerCodes: SAMPLE_MO_REVENUE.ledgerCodes,
    ledgerOrderNames: SAMPLE_MO_REVENUE.ledgerOrderNames,
    redemptions: SAMPLE_SHOPIFY.revenue.redemptions,
  });
  const summary = summariseRevenue([...SAMPLE_MO_REVENUE.orders, ...extra]);
  const previous = summariseRevenue(SAMPLE_MO_REVENUE.previousOrders);
  assert.equal(extra.length, 1, "MK-HERBST-01 and ms5-a7q2 are already in the ledger");
  assert.equal(alreadyCounted, 2);

  const rev = snapshotRevenue(SAMPLE_MO_REVENUE, SAMPLE_SHOPIFY.revenue);
  assert.deepEqual(rev.summary, summary);
  assert.deepEqual(rev.previous, previous);
  assert.deepEqual(rev.complement, { shopifyConfigured: true, orders: 1, revenue: 300, alreadyCounted: 2, unknown: 0, sampled: false });

  const s = buildBusinessSnapshot(SAMPLE_SNAPSHOT_RAW);
  const m = (k) => snapshotMetric(s, k);
  assert.equal(m("revenue.total").value, summary.revenue);
  assert.equal(m("revenue.total").previous, previous.revenue);
  assert.equal(m("revenue.orders").value, summary.orders);
  assert.equal(m("revenue.aov").value, summary.aov);
  for (const t of ["assisted", "influenced", "direct"]) {
    assert.equal(m(`revenue.${t}`).value, summary.byTier[t].revenue, t);
    assert.equal(m(`revenue.${t}`).previous, previous.byTier[t].revenue, t);
  }
  const channels = snapshotSection(s, "revenue").tables.find((t) => t.key === "revenue.channels");
  for (const ch of summary.byChannel.filter((c) => c.orders > 0)) {
    const row = channels.rows.find((r) => r.key === ch.key);
    assert.deepEqual([row.values.orders, row.values.revenue], [ch.orders, ch.revenue], ch.key);
  }
  // The channel rows add up to the total: one channel per order.
  assert.equal(Math.round(channels.rows.reduce((a, r) => a + r.values.revenue, 0) * 100) / 100, summary.revenue);
  const kampagne = summary.byChannel.find((c) => c.key === "kampagne");
  assert.equal(m("campaigns.revenue").value, kampagne.revenue);
  assert.equal(m("campaigns.orders").value, kampagne.orders);
  assert.equal(m("costs.roi").value, revenuePerAiEuro(summary.revenue, 21.4));
  assert.equal(m("costs.roi").previous, revenuePerAiEuro(previous.revenue, 16.8));

  // The journey metrics are kpi-journey's.
  const f = journeyFunnel(SAMPLE_SNAPSHOT_RAW.cur.journey);
  assert.equal(m("journey.chats").value, f.stages[0].value);
  assert.equal(m("journey.orderedAny").value, f.orderedAny);
  assert.equal(m("journey.revenuePerChat").value, f.revenuePerChat);
});

test("without the Shopify lookup: the ledger alone, and a caveat saying so", () => {
  const raw = { ...SAMPLE_SNAPSHOT_RAW, shopify: null };
  const s = buildBusinessSnapshot(raw);
  assert.equal(snapshotMetric(s, "revenue.total").value, 14920.9);
  assert.equal(snapshotMetric(s, "revenue.total").hint, undefined);
  assert.equal(snapshotMetric(s, "revenue.codeComplement"), null);
  assert.equal(snapshotMetric(s, "campaigns.revenue").value, 1040.4);
  const titles = s.caveats.map((c) => c.title);
  assert.match(s.caveats.find((c) => c.title === "Umsatz ohne Shopify-Code-Abgleich").detail, /Zeitüberschreitung/);
  assert.ok(!titles.includes("Umsatz: Shopify-Code-Abgleich nur im aktuellen Zeitraum"));
  const off = buildBusinessSnapshot({ ...raw, switches: { ...raw.switches, shopifyConfigured: false } });
  assert.match(off.caveats.find((c) => c.title === "Umsatz ohne Shopify-Code-Abgleich").detail, /nicht konfiguriert/);
  // With the lookup the comparison caveat gives the like-for-like change.
  const cav = buildBusinessSnapshot(SAMPLE_SNAPSHOT_RAW).caveats.find((c) => c.title === "Umsatz: Shopify-Code-Abgleich nur im aktuellen Zeitraum");
  assert.match(cav.detail, /Ohne sie 14\.920,90\s€ gegenüber 10\.120,00\s€ in der Vorperiode \(\+47 %\)/);
  // No revenue data at all → named as missing.
  assert.ok(buildBusinessSnapshot({ ...SAMPLE_SNAPSHOT_RAW, moRevenue: null }).caveats.some((c) => /Umsatz durch Mo/.test(c.detail) && c.title === "Fehlende Daten"));
});

test("campaign revenue: MK codes mapped to campaigns add up to the channel „Kampagne“", () => {
  const orders = [
    { total: 100, currency: "EUR", financialStatus: "PAID", tier: "direct", source: "discount_code", discountCodes: ["mk-a1"] },
    { total: 50.5, currency: "EUR", financialStatus: "PARTIALLY_REFUNDED", tier: "direct", source: "bundle", discountCodes: ["MK-B2"] },
    { total: 70, currency: "EUR", financialStatus: "PAID", tier: "direct", source: "discount_code", discountCodes: ["MK-ZZ"] },
    { total: 999, currency: "EUR", financialStatus: "PENDING", tier: "direct", source: "discount_code", discountCodes: ["MK-A1"] },
    { total: 80, currency: "CHF", financialStatus: "PAID", tier: "direct", source: "discount_code", discountCodes: ["MK-A1"] },
    { total: 40, currency: "EUR", financialStatus: "PAID", tier: "direct", source: "discount_code", discountCodes: ["MS5-X"] },
    { total: 30, currency: "EUR", financialStatus: "PAID", tier: "assisted", source: "widget", discountCodes: ["MK-A1"], overlap: true },
  ];
  const summary = summariseRevenue(orders);
  const byCampaign = campaignRevenueByCode(orders, summary.currency, { "MK-A1": 7, "MK-B2": 7 });
  assert.deepEqual(byCampaign, { 7: { orders: 2, revenue: 150.5 }, none: { orders: 1, revenue: 70 } });
  const channel = summary.byChannel.find((c) => c.key === "kampagne");
  const sum = Object.values(byCampaign).reduce((a, v) => a + v.revenue, 0);
  assert.equal(sum, channel.revenue, "unpaid, other currency, MS5 and the assisted order stay out — as in summariseRevenue");

  assert.deepEqual(campaignCodesIn(orders, [{ code: "mk-c3" }, { code: "MS5-Y" }]).sort(), ["MK-A1", "MK-B2", "MK-C3", "MK-ZZ"]);

  const rows = withCampaignRevenue(
    [{ campaignId: 7, name: "Sieben", kind: "segment", sent: 10, tracked: 10, clicked: 2, chatStarted: 1, unsubscribed: 0, bounced: 0, complained: 0, letters: 0 }],
    { 7: { orders: 2, revenue: 150.5 }, 9: { orders: 1, revenue: 20 }, none: { orders: 1, revenue: 70 } },
    [{ code: "MK-Q", campaignId: 9, name: "Neun", kind: "segment" }]
  );
  assert.deepEqual(
    rows.map((r) => [r.name, r.sent, r.moOrders, r.moRevenue]),
    [
      ["Sieben", 10, 2, 150.5],
      ["Neun", 0, 1, 20],
      ["Ohne Kampagne", 0, 1, 70],
    ]
  );
  assert.equal(withCampaignRevenue(null, {}, []), null);
});

test("field contract: the builder reads only declared getter fields, and the fixture has every one", () => {
  const { proxy, paths } = recordFieldReads(SAMPLE_SNAPSHOT_RAW);
  buildBusinessSnapshot(proxy);
  const declared = {};
  for (const [part, list] of Object.entries(SNAPSHOT_RAW_FIELDS)) {
    const all = new Set();
    // A leaf declares its parents too ("a.b[].c" → "a", "a.b", "a.b[]").
    for (const leaf of list) {
      const segs = leaf.replace(/\[\]/g, ".[]").split(".").filter(Boolean);
      for (let i = 1; i <= segs.length; i++) all.add(segs.slice(0, i).join(".").replace(/\.\[\]/g, "[]"));
    }
    declared[part] = all;
  }
  const PARTS = { cur: "period", prev: "period", lifetime: "lifetime", moRevenue: "moRevenue", shopify: "shopify", campaignCodes: "campaignCodes" };
  let checked = 0;
  for (const p of paths) {
    const head = p.match(/^[^.[]+/)[0];
    const part = PARTS[head];
    if (!part) continue; // period, switches, releases … are built by the data layer itself
    const rest = p.slice(head.length).replace(/^\./, "");
    if (!rest) continue;
    checked++;
    assert.ok(declared[part].has(rest), `the builder reads ${p} — add it to SNAPSHOT_RAW_FIELDS.${part}`);
    assert.ok(hasFieldPath(SAMPLE_SNAPSHOT_RAW, p), `the fixture lacks ${p}`);
  }
  assert.ok(checked > 150, `recorded ${checked} getter field reads`);
  // Every declared field exists in the fixture (the period ones in the current period).
  const ROOT = { period: "cur", lifetime: "lifetime", moRevenue: "moRevenue", shopify: "shopify", campaignCodes: "campaignCodes" };
  for (const [part, list] of Object.entries(SNAPSHOT_RAW_FIELDS)) {
    for (const leaf of list) {
      const path = leaf.startsWith("[]") ? `${ROOT[part]}${leaf}` : `${ROOT[part]}.${leaf}`;
      assert.ok(hasFieldPath(SAMPLE_SNAPSHOT_RAW, path), `the fixture lacks ${path}`);
    }
  }
  // The recorder itself: unknown reads are caught.
  const probe = recordFieldReads({ a: { b: [{ c: 1 }] } });
  void probe.proxy.a.b.map((x) => x.c + (x.d ?? 0));
  assert.deepEqual([...probe.paths].sort(), ["a", "a.b", "a.b[].c", "a.b[].d"]);
  assert.equal(hasFieldPath({ a: { b: [{ c: 1 }] } }, "a.b[].d"), false);
});

test("caveats: releases, previous-period notes, small samples, switches and the standing rules", () => {
  const s = buildBusinessSnapshot(SAMPLE_SNAPSHOT_RAW);
  const titles = s.caveats.map((c) => c.title);
  assert.ok(titles.includes("20.08.2026 · Beispiel-Release"));
  assert.ok(titles.includes("Anmeldung & Wiedererkennung: Vorperiode nur eingeschränkt vergleichbar"));
  const small = s.caveats.find((c) => c.title === "Kleine Stichproben");
  assert.ok(small, "the consent popup (30 shown) is fine, the DOI rate (12 sent) is not");
  assert.match(small.detail, /DOI-Quote \(Formular\) \(n = 12\)/);
  assert.ok(titles.includes("Zuordnungsfenster ab Erstellung der Markierung"));
  assert.ok(titles.includes("Seitenkontext ohne Kontrollgruppe"));
  assert.ok(titles.includes("Öffnungen werden nicht gemessen"));
  assert.ok(!titles.includes("Fehlende Daten"));
  assert.ok(!titles.includes("Geringe Analyse-Abdeckung"), "74 of 96 analysed");
  assert.deepEqual(snapshotSection(s, "signin").previousNotes, ["Erst ab dem 04.08.2026 aussagekräftig: Beispiel."]);
});

test("an empty raw input yields a total snapshot with null values and a missing-data caveat", () => {
  const s = buildBusinessSnapshot({ period: SAMPLE_PERIOD });
  assert.deepEqual(s.previous, SAMPLE_PREVIOUS, "the previous period is derived when absent");
  assert.equal(snapshotMetric(s, "revenue.total").value, null);
  assert.equal(snapshotMetric(s, "chat.engagement").value, null);
  assert.ok(s.caveats.some((c) => c.title === "Fehlende Daten"));
  assert.deepEqual(s.funnels, []);
  assert.doesNotThrow(() => buildBusinessSnapshot(null));
});

test("flattenSnapshot gives every metric once, keyed and with its section", () => {
  const s = buildBusinessSnapshot(SAMPLE_SNAPSHOT_RAW);
  const flat = flattenSnapshot(s);
  const count = s.sections.reduce((n, x) => n + x.metrics.length, 0);
  assert.equal(Object.keys(flat).length, count, "metric keys are unique");
  assert.equal(flat["costs.total"].section, "costs");
  for (const key of HEADLINE_METRICS) assert.ok(flat[key], `headline metric ${key} exists`);
});

test("every period rate carries the sample size of both periods (base and previousBase)", () => {
  const s = buildBusinessSnapshot(SAMPLE_SNAPSHOT_RAW);
  const flat = flattenSnapshot(s);
  assert.equal(flat["chat.engagement"].base, 212);
  assert.equal(flat["chat.engagement"].previousBase, 180);
  assert.equal(flat["journey.chatToOrder"].previousBase, 66);
  assert.equal(flat["signin.popupRate"].previousBase, 120);
  // Every rate with a previous value knows its previous sample size; the
  // cache hit rate is token-based (no case count) and lifetime rates have no
  // previous period.
  for (const m of Object.values(flat)) {
    if (m.unit !== "rate" || m.previous === null || m.key === "costs.cacheHitRate") continue;
    assert.ok(typeof m.previousBase === "number", `${m.key} has a previousBase`);
  }
  assert.equal(metric("x.r", "R", "rate", 0.5, 0.4, { base: 10 }).previousBase, undefined, "optional");
});

test("renderSnapshotForPrompt lists keys, values, previous values and caveats — and no personal data", () => {
  const s = buildBusinessSnapshot(SAMPLE_SNAPSHOT_RAW);
  const text = renderSnapshotForPrompt(s);
  assert.match(text, /Zeitraum: 10\.08\.2026 – 08\.09\.2026 \(30 Tage\)/);
  assert.match(text, /\[revenue\.total\]: 15\.221\s€ \(Vorperiode 10\.120\s€, \+50 %; inkl\. 1 Bestellung/);
  assert.match(text, /\[chat\.engagement\]: 47,6 % \(Vorperiode 41,1 %, \+6,5 Pp\.; n = 212, VP n = 180\)/);
  assert.match(text, /Tabelle „Kampagnen im Vergleich“/);
  assert.match(text, /## Funnels/);
  assert.match(text, /## Datenqualität/);
  assert.ok(!/@/.test(text), "no e-mail addresses");
  const short = renderSnapshotForPrompt(s, { maxChars: 500 });
  assert.ok(short.length < 600);
  assert.match(short, /gekürzt/);
  assert.equal(renderSnapshotForPrompt(null), "(keine Geschäftsdaten)");
});

test("describeSwitches keeps the known switches in a fixed order with their env names", () => {
  const rows = describeSwitches({ pageContextHoldoutPct: 10, customerSync: true, bogus: true });
  assert.deepEqual(rows, [
    { key: "customerSync", label: "Shopify-Kundenabgleich", env: "SHOPIFY_CUSTOMER_SYNC_ENABLED", value: true },
    { key: "pageContextHoldoutPct", label: "Kontrollgruppe Seitenkontext (%)", env: "CHAT_PAGE_CONTEXT_HOLDOUT_PCT", value: 10 },
  ]);
});

test("Mo's share of the shop revenue is unknown — not above 100 % — when the ledger is incomplete", () => {
  const raw = structuredClone(SAMPLE_SNAPSHOT_RAW);
  raw.cur.ledger = { ...raw.cur.ledger, revenueCents: 1_000_000 }; // 10.000 € < 15.221 € Mo revenue
  const s = buildBusinessSnapshot(raw);
  assert.equal(snapshotMetric(s, "ledger.moShare").value, null);
  const cav = s.caveats.find((c) => c.title === "Bestell-Ledger unvollständig");
  assert.ok(cav);
  assert.match(cav.detail, /152 %/);
  assert.ok(!buildBusinessSnapshot(SAMPLE_SNAPSHOT_RAW).caveats.some((c) => c.title === "Bestell-Ledger unvollständig"));
});
