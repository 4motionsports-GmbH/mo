import test from "node:test";
import assert from "node:assert/strict";

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
  summarizeMoOrderRows,
} from "./business-snapshot-core.mjs";
import { SAMPLE_SNAPSHOT_RAW, SAMPLE_PERIOD, SAMPLE_PREVIOUS } from "./business-snapshot.fixtures.mjs";

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
    href: "/admin?tab=kpi&kpiRange=custom&kpiFrom=2026-08-10&kpiTo=2026-09-08#kpi-umsatz-webhook",
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
  assert.equal(total.value, 9120.4 + 1890 + 4210.5);
  assert.equal(total.previous, 6230 + 980 + 2910);
  assert.equal(snapshotMetric(s, "revenue.orders").value, 22);
  assert.equal(snapshotMetric(s, "revenue.unresolved").value, 3);
  assert.equal(snapshotMetric(s, "revenue.unresolved").good, "down");

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
  assert.equal(snapshotMetric(s, "costs.roi").value, Math.round((15220.9 / 21.4) * 10000) / 10000);
  assert.equal(snapshotMetric(s, "orderStatus.answered").value, Math.round((8 / 11) * 10000) / 10000);
  assert.equal(snapshotMetric(s, "orderStatus.answered").previous, null);

  // Tables: sources sorted by revenue, campaigns matched across periods.
  const sources = snapshotSection(s, "revenue").tables.find((t) => t.key === "revenue.sources");
  assert.equal(sources.rows[0].key, "widget");
  assert.equal(sources.rows[0].previous.revenue, 3890);
  const byCampaign = snapshotSection(s, "campaigns").tables[0];
  const einzel = byCampaign.rows.find((r) => r.label === "Einzelansprache");
  assert.equal(einzel.values.sent, 6);
  assert.equal(einzel.previous.sent, 4);
  const sommer = byCampaign.rows.find((r) => r.label === "Sommer-Ausdauer");
  assert.equal(sommer.values.sent, 0, "a campaign of the previous period only shows 0 now");

  // Funnels narrow from step to step.
  const chat = s.funnels.find((f) => f.key === "chat");
  assert.deepEqual(chat.steps.map((x) => x.value), [1840, 212, 101]);
  const campaign = s.funnels.find((f) => f.key === "campaign");
  assert.deepEqual(campaign.steps.map((x) => x.value), [30, 10, 4, 4]);
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

test("renderSnapshotForPrompt lists keys, values, previous values and caveats — and no personal data", () => {
  const s = buildBusinessSnapshot(SAMPLE_SNAPSHOT_RAW);
  const text = renderSnapshotForPrompt(s);
  assert.match(text, /Zeitraum: 10\.08\.2026 – 08\.09\.2026 \(30 Tage\)/);
  assert.match(text, /\[revenue\.total\]: 15\.221\s€ \(Vorperiode 10\.120\s€, \+50 %\)/);
  assert.match(text, /\[chat\.engagement\]: 47,6 % \(Vorperiode 41,1 %, \+6,5 Pp\.; n = 212\)/);
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

test("summarizeMoOrderRows: realised money by source, code family and campaign", () => {
  const rows = [
    { attribution_source: "widget", financial_status: "paid", total_price: "100.50", discount_codes: [] },
    { attribution_source: "discount_code", financial_status: "PAID", total_price: 80, discount_codes: ["mk-abc"] },
    { attribution_source: "discount_code", financial_status: "PARTIALLY_REFUNDED", total_price: 40, discount_codes: ["MS5-XYZ"] },
    { attribution_source: "bundle", financial_status: "PENDING", total_price: 999, discount_codes: ["MK-DEF"] },
    { attribution_source: "widget", financial_status: "PAID", total_price: 20, discount_codes: ["MK-ZZZ"] },
  ];
  const out = summarizeMoOrderRows(rows, { "MK-ABC": 7 });
  assert.deepEqual(out.bySource.find((r) => r.source === "widget"), { source: "widget", orders: 2, revenue: 120.5 });
  assert.deepEqual(out.bySource.find((r) => r.source === "discount_code"), { source: "discount_code", orders: 2, revenue: 120 });
  assert.equal(out.bySource.find((r) => r.source === "bundle"), undefined, "unpaid rows are skipped");
  assert.deepEqual(out.codeOrders, { ms5: { orders: 1, revenue: 40 }, mk: { orders: 2, revenue: 100 } });
  assert.deepEqual(out.byCampaign, { 7: { orders: 1, revenue: 80 }, none: { orders: 1, revenue: 20 } });
  assert.deepEqual(summarizeMoOrderRows(null).bySource, []);
});
