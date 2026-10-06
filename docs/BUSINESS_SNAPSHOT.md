# Business snapshot — the decision data of a period

One versioned, PII-free structure with everything a business decision needs
from the current backend, for a period **and the equally long period right
before it**. The Komplettanalyse ([`ADMIN_DASHBOARD.md`](./ADMIN_DASHBOARD.md)
§3.8) renders it, prints it and feeds it to the strategist model; the
Verbesserung ([`IMPROVEMENT_LOOP.md`](./IMPROVEMENT_LOOP.md)) can read it as its
baseline. Since 2026-10-06.

| File | Role |
| --- | --- |
| [`business-snapshot-core.mjs`](../src/lib/business-snapshot-core.mjs) | Pure, tested: `buildBusinessSnapshot(raw)`, the metric / delta / format helpers, caveats, admin links, `scrubPii`, `renderSnapshotForPrompt`, `summarizeMoOrderRows` |
| [`business-snapshot.ts`](../src/lib/business-snapshot.ts) | Data layer: `getBusinessSnapshot(range, opts)`, `collectBusinessSnapshotRaw`, `snapshotSwitches`; the TypeScript shape (`BusinessSnapshot`, `SnapshotMetric`, …) |
| [`business-snapshot.fixtures.mjs`](../src/lib/business-snapshot.fixtures.mjs) | A realistic raw input for tests (`SAMPLE_SNAPSHOT_RAW`) |

## How it is collected

`getBusinessSnapshot({ from, to }, { includeShopify })` never throws: without a
database every part is null and the snapshot carries the caveat „Fehlende
Daten“; a failing part is reported (`reportError`, route
`lib/business-snapshot`) and left null.

- **Same numbers as the KPI screen.** It calls the KPI getters read-only —
  `getCoreMetrics`, `getPageContextKpis`, `getLocaleSplit`, `getLoginGateFunnel`,
  `getAccountActivity`, `getConsentGateFunnel`, `getEmailCaptureFunnel`,
  `getOrderStatusKpis` (`kpi-store.ts`), `getMoAttributionKpis`,
  `getAiCostMetrics`, `getInboxKpis`, `getQaKpis`, `getFeedbackKpis`,
  `getBundleKpis`, `getConversationStats`, `getCustomerBaseKpis`,
  `getMoEffectKpis` (+ `computeMoEffect`) and `getReportKpis` — with the same
  UTC day window (`created_at >= from AND < to + 1`).
- **Own small queries** for what no getter answers per period (spelled out, the
  Neon tag is not composable): `mo_orders` of the period by marker source, by
  code family (MS5- / MK-) and by campaign (MK code → `campaign_sends`);
  campaign sends per campaign with tracked / clicked / chat started /
  unsubscribed / delivered / bounced / complained and letters
  (`physical_letters`); one-click e-mail ratings per mail kind (`feedback.rating`);
  the order ledger (`customer_orders`, not cancelled, net of refunds, first-time
  vs. returning buyers); new subscribers (`consent_events`, the backfill excluded).
- **Optional Shopify cross-check** (`includeShopify`, current period only): Mo
  codes checked at Shopify through the KPI screen's 10-minute cache
  (`loadKpiShopifyBlock`), bounded by `shopifyTimeoutMs` (45 s). The
  Komplettanalyse turns it on when Shopify is configured.
- **Previous period** = the same number of days ending the day before `from`
  (`previousPeriod`). Release notes and switches come from
  [`kpi-releases.mjs`](../src/lib/kpi-releases.mjs) and the flag readers.

## Shape (`SNAPSHOT_VERSION` 1)

```
{ version, generatedAt, period: {from,to,days,label}, previous: {…},
  sections: [ { key, title, scope, link, metrics[], tables[], notes[], previousNotes[] } ],
  funnels:  [ { key, title, link, steps: [ {label, value, previous} ] } ],
  caveats:  [ { level: "info"|"warning", title, detail, sections? } ],
  switches: [ { key, label, env, value } ],
  releases: [ { date, key, title } ] }
metric = { key, label, unit, value, previous, base?, good: "up"|"down"|"none", hint? }
```

- **Units:** `count`, `eur`, `rate` (0–1), `ratio` (a plain multiple, e.g. clicks
  per chat), `hours`, `score` (1–5). Render with `formatMetricValue`.
- **Change:** `metricDelta` / `formatMetricDelta` — rates move in percentage
  points („+3,4 Pp.“), everything else relative („+12 %“, „neu“ from 0);
  `good` decides the colour (a falling cost is favourable).
- **`previous` is null** for figures of „Stand heute“ (lifetime: `customers.*`,
  `moEffect.*`, `knowledge.open`, `knowledge.scanBacklog`) and for the Shopify
  cross-check (current period only).
- **`base`** is the denominator of a rate. A rate with `base` < 30
  (`MIN_RATE_BASE`) is a small sample (`isSmallSample`) and is named in the
  caveat „Kleine Stichproben“.
- **Stable keys.** Never rename a metric key — other code and stored reports
  reference it; add a new key instead. Bump `SNAPSHOT_VERSION` only for a
  breaking change of the shape.
- **Reading:** `snapshotMetric(s, key)`, `snapshotSection(s, key)`,
  `flattenSnapshot(s)` (key → metric with its section), `HEADLINE_METRICS`.

## Fields

Sections in this order; every metric has the previous period unless marked
„heute“. „Link“ is the admin screen where one acts (`adminLinkFor(key, range)` —
KPI links carry the period and the section anchor).

| Section (link) | Metrics | Tables |
| --- | --- | --- |
| `revenue` Umsatz über Mo (`kpi_umsatz`) | `revenue.total` (realised Mo-attributed revenue, all tiers), `revenue.orders`, `revenue.aov`, `revenue.direct`, `revenue.assisted`, `revenue.influenced`, `revenue.ms5`, `revenue.mk` (paid orders with an MS5- / MK- code), `revenue.unrealised` (marked, not paid), `revenue.unresolved` (marked, no consultation — `mo_order_marker_unresolved`), `revenue.codesShopify` (heute; Shopify cross-check) | `revenue.tiers` (orders, revenue per tier), `revenue.sources` (per marker source: widget, summary_email, marketing_email, bundle, discount_code) |
| `chat` Beratung im Chat (`kpi_beratung`) | `chat.reach`, `chat.opened`, `chat.wrote` (sessions), `chat.engagement` (opened → wrote), `chat.chats`, `chat.avgMessages`, `chat.productClicks`, `chat.clicksPerChat`, `chat.cartClicks`, `chat.cartPerChat`, `chat.abandoned`, `chat.recommended` (conversations with a product selection), `chat.pageContext`, `chat.pageContextResolved` (A3), `chat.englishShare` | — |
| `signin` Anmeldung & Wiedererkennung (`kpi_anmeldung`) | `signin.popupShown`, `signin.popupClicked`, `signin.popupLinked`, `signin.popupRate`, `signin.linkedSignin`, `signin.linkedShop` (App Proxy), `signin.recognised`, `signin.redeemRate`, `signin.refused`, `signin.shopifySignins`, `account.exports`, `account.erasures`, `account.contactForms` | — |
| `consent` Einwilligung & E-Mail (`kpi_einwilligung`) | `consent.popupShown`, `consent.popupAccepted`, `consent.popupRate`, `consent.popupOptIns` (sessions, all sign-in ways), `consent.newSubscribers`, `capture.asked`, `capture.submitted`, `capture.submitRate`, `capture.optedIn`, `capture.doiSent`, `capture.confirmed`, `capture.doiRate` | `consent.byWay` (Anmelden / Shop-Login / ohne), `consent.byVariant` (current period; data from the widget of 06.10.2026) |
| `campaigns` Kampagnen & Briefe (`kampagnen`) | `campaigns.sent`, `campaigns.clicked` (button or set), `campaigns.clickRate` (of tracked sends), `campaigns.chatStarted`, `campaigns.orders`, `campaigns.revenue` (paid orders in the period with an MK code of the campaign), `campaigns.unsubscribed`, `campaigns.unsubscribeRate`, `campaigns.bounced`, `campaigns.complained`, `campaigns.rating`, `letters.sent`, `letters.cost`, `campaigns.redeemedShopify` (heute) | `campaigns.byCampaign` (sent, click rate, chats, orders, revenue, unsubscribed, letters — also campaigns with revenue but no send in the period) |
| `customers` Kund:innen & Wiederkauf (`kunden`) | `ledger.orders`, `ledger.revenue`, `ledger.buyers`, `ledger.newBuyers`, `ledger.returningBuyers`, `ledger.repeatShare`, `ledger.moShare` (Mo revenue ÷ ledger revenue; null above 100 % — ledger incomplete), heute: `customers.total`, `customers.shopify`, `customers.withMo`, `customers.subscribed`, `customers.subscribedShare`, `customers.churnHigh`, `moEffect.repurchaseMo`, `moEffect.repurchaseComparable`, `moEffect.aovMo`, `moEffect.aovComparable`, `moEffect.wonByMo`, `moEffect.wonByMoRevenue` | `customers.segments`, `customers.valueTiers`, `customers.subscriberSources`, `moEffect.byTier` |
| `inbox` Eingang (`eingang`) | `inbox.created`, `inbox.acted`, `inbox.actedShare`, `inbox.dismissed`, `inbox.suggestions`, `inbox.ordersAfterActed`, `inbox.revenueAfterActed` (14-day outcome of operator decisions) | `inbox.byKind` |
| `quality` Qualität, Wissen & Feedback (`gespraeche`) | `quality.coverage`, `quality.handledWell`, `quality.unmetNeed`, `quality.droppedOff` (of analysed conversations), `quality.noReply`, `knowledge.gaps`, `knowledge.published`, `knowledge.hoursToAnswer`, heute: `knowledge.open`, `knowledge.scanBacklog`; `feedback.total`, `feedback.rating` (all mail kinds), `orderStatus.lookups`, `orderStatus.answered` | `quality.distribution`, `quality.categories` (top 8), `feedback.ratings` |
| `costs` KI-Kosten & Rendite (`kpi_kosten`) | `costs.total`, `costs.chat`, `costs.admin`, `costs.perConsultation`, `costs.cacheHitRate`, `costs.cacheSaved`, `costs.roi` (Mo revenue per 1 € AI cost) | `costs.byCallSite` (top 12) |

**Funnels** (`funnels`): `chat` (Widget gesehen → geöffnet → geschrieben,
sessions), `signin` (popup → „Anmelden“ → Shopify → im Chat), `consent` (popup →
accepted → server opt-in), `capture` (offered → form → marketing box → DOI,
events), `campaign` (sent → clicked → chat → ordered). Funnels without any data
are left out.

**Switches** (`switches`, values only, **Stand heute — not historical**):
`shopifyConfigured`, `customerSync`, `consentWriteback`, `campaignSendsApproved`,
`campaignRelease`, `physicalMailApproved`, `appProxySignin`,
`attributionSessionAnchor`, `pageContext`, `pageContextHoldoutPct`,
`chatOrderStatus`, `emailConfigured`, `anthropicConfigured` — with their env name.

## Caveats

`caveats` are deterministic, from the data — the strategist gets them and the
report shows them under „Risiken & Datenqualität“:

- every **release** between the start of the previous period and the end of the
  period (`releasesInRange`);
- the **section notes** of `releaseNotesFor` (sections `attribution`,
  `anmelde-popup`, `konto`, `consent`, `capture`, `campaign` →
  `SECTION_RELEASE_NOTES`) for the period (warning) and for the previous period
  („Vorperiode nur eingeschränkt vergleichbar“);
- **missing data** (a getter returned null), **small samples**, **analysis
  coverage** below 50 %, an **incomplete ledger** (Mo revenue above the ledger's);
- **switches that change a number's meaning**: customer sync off, attribution
  window from minting, page context without a control group; the Shopify
  cross-check as a sample;
- the standing rules: **opens are not measured** (no tracking pixel), customer
  base and Mo effect are **Stand heute** and a **correlation**, only **marked
  orders** count for Mo (a lower bound).

## Privacy

Counts, sums, rates and operator-defined names only (campaign names, call
sites, segment keys) — never a person, an e-mail address, an order number or
message text. The free texts the Komplettanalyse adds to the strategist prompt
(insights, customer knowledge, persona themes) pass `scrubPii` (e-mail, phone,
links, IBAN, order and customer numbers masked); per-customer profiles never
enter the prompt.

## Reuse (Verbesserung and others)

```ts
import { getBusinessSnapshot } from "@/lib/business-snapshot";
import { flattenSnapshot, renderSnapshotForPrompt, metricDelta } from "@/lib/business-snapshot-core.mjs";

const snapshot = await getBusinessSnapshot({ from, to });           // pure DB
const baseline = flattenSnapshot(snapshot);                        // key → metric
const text = renderSnapshotForPrompt(snapshot, { maxChars: 20_000 }); // model input
```

A completed Komplettanalyse stores its snapshot in `sections.snapshot` (v2): a
later run compares `flattenSnapshot(report.sections.snapshot)` with a fresh
snapshot by key (`COMPARISON_KEYS` and `buildReportComparison` in
[`analytics-report-synthesis-core.mjs`](../src/lib/analytics-report-synthesis-core.mjs)
show how; counts per day when the periods differ). The recommendations of a v2
report name the snapshot key in their success metric (e.g. `signin.popupRate`
from 12 % to 18 % in 4 weeks), so a Wirkungs-Check can look it up.
