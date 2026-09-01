#!/usr/bin/env node
// Repurchase-behaviour analysis — measures the numbers the planned campaign
// lifecycle segmentation is supposed to be built on, BEFORE any of it is built.
//
// It answers four questions from real order history:
//
//   1. REPEAT RATE per value tier — of customers whose first order was a
//      Kleinteil / Komponente / Großgerät, how many ever came back? This is the
//      ceiling on the whole feature: better email timing cannot create repeat
//      customers that do not exist.
//   2. INTERVAL between consecutive orders per value tier — the median/p75 that
//      the "Ausbauen / Weiterentwickeln / Zurückholen" cut points should follow
//      instead of round guesses.
//   3. ACCESSORY FOLLOW-UP RATE — when a customer returns, how often do they buy
//      a merchant-curated accessory (Product.compatibleWith) of something they
//      already own? This is the direct test of the "Ausbauen" idea, and of
//      whether it beats today's recommender, which scores embedding SIMILARITY
//      against owned products and therefore surfaces substitutes, not
//      complements.
//   4. ACCESSORY RATE BY WINDOW — how that rate decays with time since the
//      purchase, which is what turns the month boundaries into a measurement.
//
// READ-SAFE: only `orders` queries. Nothing is created, modified or deleted.
//
// PRIVACY: customer identifiers are used in memory only, to group orders. No
// email, name or address is ever requested, printed or written. The optional
// --json output contains AGGREGATES ONLY — no per-customer rows.
//
// Run:  npm run analyze:repurchase
//       npm run analyze:repurchase -- --since 2023-01-01 --json out.json
//
// Flags:
//   --since <YYYY-MM-DD>  only orders created on/after this date (default: all)
//   --max-orders <n>      stop after ~n orders (rounded up to the page
//                         boundary) — use for a quick sample run
//   --page-size <n>       orders per GraphQL page (default 15; lower it if the
//                         shop's cost bucket is small)
//   --json <path>         also write the aggregates as JSON
//   --occasion-gap <days> orders from one customer closer together than this
//                         count as ONE purchase occasion (default 7). One
//                         checkout routinely lands as several Shopify order
//                         records; without this the median "repurchase
//                         interval" collapses to 0 days.
//
// The statistics live in src/lib/repurchase-analysis.mjs (pure + unit-tested);
// this file only does I/O and formatting.

import process from "node:process";
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import {
  DEFAULT_OCCASION_GAP_DAYS,
  VALUE_TIERS,
  accessoryFollowUpRate,
  accessoryRateByWindow,
  buildRepurchaseIntervals,
  repeatRateByTier,
  summarizeIntervals,
  toPurchaseOccasions,
} from "../src/lib/repurchase-analysis.mjs";
import { planThrottleRetry } from "../src/lib/shopify-throttle.mjs";

const require = createRequire(import.meta.url);

// ── CLI ──────────────────────────────────────────────────────────────────────
function flag(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const since = flag("since");
const maxOrders = Number(flag("max-orders", "0")) || Infinity;
const pageSize = Math.max(1, Math.min(50, Number(flag("page-size", "15")) || 15));
const jsonPath = flag("json");
const occasionGap = (() => {
  const raw = flag("occasion-gap");
  if (raw === null) return DEFAULT_OCCASION_GAP_DAYS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    console.error(`FEHLER: --occasion-gap erwartet eine Zahl >= 0 (bekommen: "${raw}").`);
    process.exit(1);
  }
  return n;
})();

if (since && !/^\d{4}-\d{2}-\d{2}$/.test(since)) {
  console.error(`FEHLER: --since erwartet YYYY-MM-DD (bekommen: "${since}").`);
  process.exit(1);
}

// ── Auth (client-credentials, same grant as verify-shopify-auth.mjs) ─────────
const REQUIRED = [
  "SHOPIFY_STORE_DOMAIN",
  "SHOPIFY_CLIENT_ID",
  "SHOPIFY_CLIENT_SECRET",
  "SHOPIFY_API_VERSION",
];
const missing = REQUIRED.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(
    `\nFEHLER: Fehlende Umgebungsvariablen: ${missing.join(", ")}.` +
      `\nIn .env setzen und mit "npm run analyze:repurchase" starten.`
  );
  process.exit(1);
}
const storeDomain = process.env.SHOPIFY_STORE_DOMAIN.trim()
  .replace(/^https?:\/\//, "")
  .replace(/\/+$/, "");
const apiVersion = process.env.SHOPIFY_API_VERSION.trim();

async function accessToken() {
  const res = await fetch(`https://${storeDomain}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: process.env.SHOPIFY_CLIENT_ID.trim(),
      client_secret: process.env.SHOPIFY_CLIENT_SECRET.trim(),
    }).toString(),
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(
      `\nFEHLER: Token-Endpoint antwortete HTTP ${res.status}.\n${text}` +
        `\n\nPrüfe SHOPIFY_CLIENT_ID/SECRET und dass die App auf diesem Store installiert ist.`
    );
    process.exit(1);
  }
  const token = JSON.parse(text).access_token;
  if (!token) {
    console.error(`\nFEHLER: Keine access_token im Token-Response.\n${text}`);
    process.exit(1);
  }
  return token;
}

// ── GraphQL ──────────────────────────────────────────────────────────────────
const ORDERS_QUERY = /* GraphQL */ `
  query RepurchaseOrders($cursor: String, $query: String, $pageSize: Int!) {
    orders(first: $pageSize, after: $cursor, query: $query, sortKey: CREATED_AT) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        createdAt
        displayFinancialStatus
        customer { id }
        lineItems(first: 30) {
          nodes {
            quantity
            discountedUnitPriceSet { shopMoney { amount } }
            originalUnitPriceSet { shopMoney { amount } }
            product { handle }
          }
        }
      }
    }
  }
`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function graphql(token, variables) {
  for (let attempt = 0; ; attempt++) {
    let res;
    let json;
    try {
      res = await fetch(`https://${storeDomain}/admin/api/${apiVersion}/graphql.json`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": token,
        },
        body: JSON.stringify({ query: ORDERS_QUERY, variables }),
      });
      json = await res.json();
    } catch (err) {
      if (attempt >= 3) throw err;
      await sleep(1000 * 2 ** attempt);
      continue;
    }

    const plan = planThrottleRetry({ json, httpStatus: res.status, attempt });
    if (plan.retry) {
      process.stderr.write(`  … gedrosselt, warte ${Math.round(plan.waitMs)} ms\n`);
      await sleep(plan.waitMs);
      continue;
    }

    if (!res.ok || json?.errors?.length) {
      const msg = json?.errors?.map((e) => e.message).join("; ") ?? `HTTP ${res.status}`;
      if (/access denied|protected customer data|not approved/i.test(msg)) {
        console.error(
          `\nFEHLER: Shopify verweigert den Zugriff: ${msg}\n\n` +
            `Diese Analyse braucht read_orders UND die Freigabe für "Protected Customer Data"\n` +
            `(Kundenzuordnung der Bestellungen). Beides im Dev-Dashboard der App beantragen.`
        );
        process.exit(1);
      }
      throw new Error(`Shopify GraphQL: ${msg}`);
    }

    // Pace against the leaky bucket so a long run never trips the limiter.
    const status = json?.extensions?.cost?.throttleStatus;
    const requested = json?.extensions?.cost?.requestedQueryCost ?? 0;
    if (status && status.currentlyAvailable < requested * 2 && status.restoreRate > 0) {
      const need = requested * 2 - status.currentlyAvailable;
      await sleep(Math.min(10_000, (need / status.restoreRate) * 1000));
    }
    return json.data;
  }
}

// ── Fetch ────────────────────────────────────────────────────────────────────
// Only orders where money actually changed hands and was not fully reversed —
// the same definition src/lib/shopify-orders.ts uses for a completed purchase.
const COMPLETED = new Set(["PAID", "PARTIALLY_REFUNDED"]);
const money = (set) => {
  const v = Number(set?.shopMoney?.amount);
  return Number.isFinite(v) ? v : null;
};

async function fetchOrders(token) {
  const byCustomer = new Map();
  let cursor = null;
  let seen = 0;
  let kept = 0;
  let skippedNoCustomer = 0;
  let skippedStatus = 0;

  for (;;) {
    const data = await graphql(token, {
      cursor,
      pageSize,
      query: since ? `created_at:>=${since}` : null,
    });
    const conn = data?.orders;
    if (!conn) break;

    for (const node of conn.nodes ?? []) {
      seen += 1;
      if (!COMPLETED.has(String(node.displayFinancialStatus ?? "").toUpperCase())) {
        skippedStatus += 1;
        continue;
      }
      const customerId = node.customer?.id;
      if (!customerId) {
        // Guest checkouts cannot be linked into a purchase sequence.
        skippedNoCustomer += 1;
        continue;
      }
      const lineItems = (node.lineItems?.nodes ?? []).map((li) => ({
        handle: li.product?.handle ?? null,
        quantity: Number(li.quantity) || 1,
        unitPriceEur: money(li.discountedUnitPriceSet) ?? money(li.originalUnitPriceSet),
      }));
      if (!byCustomer.has(customerId)) byCustomer.set(customerId, []);
      byCustomer.get(customerId).push({ id: node.id, createdAt: node.createdAt, lineItems });
      kept += 1;
    }

    // Overwrite in place on a terminal; in a pipe or log, emit one line per
    // page instead of smearing carriage returns across the output.
    if (process.stderr.isTTY) {
      process.stderr.write(`\r  Bestellungen gelesen: ${seen} (verwertbar: ${kept})   `);
    } else {
      process.stderr.write(`  Bestellungen gelesen: ${seen} (verwertbar: ${kept})\n`);
    }
    if (seen >= maxOrders || !conn.pageInfo?.hasNextPage) break;
    cursor = conn.pageInfo.endCursor;
  }
  if (process.stderr.isTTY) process.stderr.write("\n");

  return {
    customers: [...byCustomer.entries()].map(([key, orders]) => ({ key, orders })),
    stats: { seen, kept, skippedNoCustomer, skippedStatus },
  };
}

// ── Formatting ───────────────────────────────────────────────────────────────
const pad = (s, n) => String(s).padEnd(n);
const padL = (s, n) => String(s).padStart(n);
const d1 = (v) => (v === null || v === undefined ? "—" : v.toFixed(1));
const pct = (v) => (v === null || v === undefined ? "—" : `${(v * 100).toFixed(1)} %`);
const months = (days) => (days === null ? "—" : `${(days / 30.44).toFixed(1)} Mon.`);

function heading(text) {
  console.log(`\n${text}\n${"─".repeat(text.length)}`);
}

// ── Main ─────────────────────────────────────────────────────────────────────
const token = await accessToken();
console.log(
  `[analyze-repurchase] Store ${storeDomain} · API ${apiVersion}` +
    `${since ? ` · ab ${since}` : " · gesamter Zeitraum"}` +
    `${maxOrders !== Infinity ? ` · max. ${maxOrders} Bestellungen` : ""}`
);

const { customers: rawCustomers, stats } = await fetchOrders(token);

// One checkout routinely lands as several Shopify order records. Collapse those
// into purchase occasions before ANY statistic is computed — otherwise a split
// checkout inflates the repeat rate and floors the interval.
const customers = toPurchaseOccasions(rawCustomers, occasionGap);
const rawOrderCount = rawCustomers.reduce((n, c) => n + c.orders.length, 0);
const occasionCount = customers.reduce((n, c) => n + c.orders.length, 0);

// The accessory graph, straight from the synced catalogue.
const catalogRaw = require("../src/data/product-catalog.json");
const catalog = Array.isArray(catalogRaw) ? catalogRaw : catalogRaw.products ?? [];
const accessoryMap = new Map(
  catalog.filter((p) => p.compatibleWith?.length).map((p) => [p.id, p.compatibleWith])
);

heading("Datengrundlage");
console.log(`  Bestellungen gelesen              ${stats.seen}`);
console.log(`  … davon abgeschlossen & zuordenbar ${stats.kept}`);
console.log(`  … verworfen (Status)              ${stats.skippedStatus}`);
console.log(`  … verworfen (Gast-Checkout)       ${stats.skippedNoCustomer}`);
console.log(`  Kunden mit ≥1 Bestellung          ${customers.length}`);
console.log(`  Katalogprodukte / mit Zubehör     ${catalog.length} / ${accessoryMap.size}`);
console.log(
  `\n  Kaufgelegenheiten (Abstand < ${occasionGap} Tage = eine Gelegenheit)` +
    `\n  ${rawOrderCount} Bestellungen → ${occasionCount} Gelegenheiten ` +
    `(${rawOrderCount - occasionCount} zusammengefasst, ` +
    `${rawOrderCount > 0 ? (((rawOrderCount - occasionCount) / rawOrderCount) * 100).toFixed(1) : "0.0"} %)` +
    `\n  Gesplittete Checkouts zaehlen sonst als Wiederkauf. --occasion-gap 0 schaltet das ab.`
);

const repeat = repeatRateByTier(customers);
heading("1 · Wiederkaufsrate nach Wert der ERSTEN Bestellung");
console.log(`  ${pad("Stufe", 16)}${padL("Kunden", 9)}${padL("Wiederk.", 10)}${padL("Rate", 10)}`);
for (const r of repeat) {
  console.log(`  ${pad(r.label, 16)}${padL(r.customers, 9)}${padL(r.repeaters, 10)}${padL(pct(r.rate), 10)}`);
}

const intervals = buildRepurchaseIntervals(customers);
const summary = summarizeIntervals(intervals);
heading("2 · Abstand zwischen aufeinanderfolgenden Bestellungen (Tage)");
console.log(
  `  ${pad("Stufe", 16)}${padL("n", 7)}${padL("p25", 9)}${padL("Median", 9)}${padL("p75", 9)}${padL("p90", 9)}${padL("Median", 12)}`
);
for (const r of summary) {
  console.log(
    `  ${pad(r.label, 16)}${padL(r.n, 7)}${padL(d1(r.p25), 9)}${padL(d1(r.median), 9)}` +
      `${padL(d1(r.p75), 9)}${padL(d1(r.p90), 9)}${padL(months(r.median), 12)}`
  );
}

const accessory = accessoryFollowUpRate(customers, accessoryMap, {
  catalogSize: Math.max(1, catalog.length),
});
heading("3 · Zubehör-Folgekauf: kauft der Rückkehrer Zubehör zum Besitz?");
console.log(
  `  ${pad("Stufe", 16)}${padL("Übergänge", 11)}${padL("Treffer", 9)}${padL("Rate", 10)}${padL("Zufall", 10)}${padL("Lift", 9)}`
);
for (const r of accessory) {
  console.log(
    `  ${pad(r.label, 16)}${padL(r.transitions, 11)}${padL(r.hits, 9)}${padL(pct(r.rate), 10)}` +
      `${padL(pct(r.expectedRate), 10)}${padL(r.lift === null ? "—" : `${r.lift.toFixed(1)}×`, 9)}`
  );
}
console.log(
  `\n  "Zufall" = erwartete Rate, wenn die Folgebestellung zufällig aus dem Katalog käme.\n` +
    `  Lift deutlich > 1 heißt: Zubehör-Empfehlungen treffen echtes Kaufverhalten.`
);

const byWindow = accessoryRateByWindow(customers, accessoryMap, {
  catalogSize: Math.max(1, catalog.length),
});
heading("4 · Zubehör-Rate nach Abstand zum Vorkauf (Timing-Test)");
console.log(`  ${pad("Fenster", 18)}${padL("Übergänge", 11)}${padL("Rate", 10)}${padL("Lift", 9)}`);
for (const r of byWindow) {
  const label = r.toDays === Infinity ? `> ${r.fromDays} Tage` : `${r.fromDays}–${r.toDays} Tage`;
  console.log(
    `  ${pad(label, 18)}${padL(r.transitions, 11)}${padL(pct(r.rate), 10)}` +
      `${padL(r.lift === null ? "—" : `${r.lift.toFixed(1)}×`, 9)}`
  );
}

// Per tier — this is what sets the "Ausbauen"-Fenster separately per Wertstufe.
heading("4b · Dieselbe Rate je Wertstufe (setzt das Fenster je Stufe)");
console.log(
  `  ${pad("Fenster", 18)}` + VALUE_TIERS.map((t) => padL(t.label, 22)).join("")
);
for (const r of byWindow) {
  const label = r.toDays === Infinity ? `> ${r.fromDays} Tage` : `${r.fromDays}–${r.toDays} Tage`;
  const cells = VALUE_TIERS.map((t) => {
    const cell = r.byTier.find((b) => b.key === t.key);
    if (!cell || cell.transitions === 0) return padL("—", 22);
    return padL(`${pct(cell.rate)} (n=${cell.transitions})`, 22);
  });
  console.log(`  ${pad(label, 18)}${cells.join("")}`);
}
console.log(`\n  Kleine n (< ~100) sind Rauschen — nicht ueberinterpretieren.`);

heading("Wie das die Schnittpunkte setzt");
console.log(
  `  • Wiederkaufsrate (1) ist die Obergrenze des ganzen Features.\n` +
    `  • Median/p75 je Stufe (2) ersetzen die geschätzten 3/6/12-Monats-Grenzen.\n` +
    `  • Lift in (3) entscheidet, ob "Ausbauen" die heutige Ähnlichkeits-Empfehlung schlägt.\n` +
    `  • Der Abfall in (4) markiert das Ende des Zubehör-Fensters je Stufe.`
);

if (jsonPath) {
  // Aggregates only — deliberately no per-customer rows.
  writeFileSync(
    jsonPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        params: {
          since: since ?? null,
          maxOrders: maxOrders === Infinity ? null : maxOrders,
          occasionGapDays: occasionGap,
        },
        dataset: {
          ...stats,
          customers: customers.length,
          catalog: catalog.length,
          rawOrders: rawOrderCount,
          occasions: occasionCount,
        },
        valueTiers: VALUE_TIERS.map((t) => ({ key: t.key, label: t.label, maxEur: t.maxEur })),
        repeatRate: repeat,
        intervals: summary,
        accessoryFollowUp: accessory,
        accessoryByWindow: byWindow,
      },
      null,
      2
    ) + "\n",
    "utf8"
  );
  console.log(`\n  Aggregate geschrieben nach ${jsonPath} (keine Kundendaten).`);
}
