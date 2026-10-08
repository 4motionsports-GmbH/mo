#!/usr/bin/env node
// Read-only check of today's welcome code (OPTIN_REWARD_2026-10-08 T1): which
// Shopify discount is the 5 % welcome code, with which settings, how often it
// was redeemed, and — for ONE test address — whether Mo's DOI confirmation
// wrote the Shopify consent in time to fire the welcome automation (test cases
// 8 and 8b of the brief's T9 matrix).
//
//   npm run check:welcome                                      # sections A–C
//   npm run check:welcome -- --email test@example.com          # + D–G for that one address
//   npm run check:welcome -- --email … --inbox 2026-10-09T10:14:00+02:00
//                                         # + where the welcome mail's arrival fits
//   options: --days <n>       window for redemptions and Shopify customer events (default 60)
//            --all            also expired discounts (default: active + scheduled)
//            --show-codes     print codes unmasked (never paste that output anywhere)
//            --max-codes <n>  codes read per candidate for its redemption count (default 250)
//            --no-shopify     Mo's database only · --no-db  Shopify only
//
// Sections: A the app's scopes · B candidate discounts (pass 1 a light scan of
// every code discount, pass 2 the full settings of the candidates only) · C
// redemptions from Mo's order ledger (customer_orders.discount_codes) + Shopify
// tags in Mo's mirror that look like a welcome/mail-app tag · D Mo for the
// address (consent, captures, outbox, sent mails, orders, opt-in KPIs) · E
// Shopify for the address (defaultEmailAddress, the deprecated
// emailMarketingConsent as fallback, customer events, orders, codes) · F one
// merged timeline (Europe/Berlin, --inbox as a „Postfach“ row) · G assessment.
//
// Read-only by construction: every GraphQL document is checked to be a query
// (isReadOnlyGraphql) before it is sent, every SQL text to be one SELECT
// (isSelectOnlySql), and it runs inside a READ ONLY transaction. Shopify:
// discountNodes / discountNode / codeDiscountNodeByCode (read_discounts, held
// through write_discounts), customerByIdentifier / customer (read_customers),
// the customer's orders (read_orders). THROTTLED / 429 / 502–504 are waited out
// (up to 6 retries).
//
// Privacy: prints no e-mail address but the masked one it was given (addresses
// in titles, summaries and event messages are masked too); a discount
// restricted to specific customers shows a count and no Shopify summary; the
// ledger part is aggregates without identities; codes are masked unless
// --show-codes. --email prints that one person's Shopify event texts (may hold
// their name) and order numbers: use test addresses.
//
// What no API shows (do it in the Shopify admin, see the footer): the Shopify
// Messaging / Flow automation itself, its conditions, its activity report and
// run history, the welcome mail's content, the installed apps, Mailchimp.

import { neon, neonConfig } from "@neondatabase/serverless";
import { num, plural } from "../src/lib/admin-format.mjs";
import { consentStrings } from "../src/lib/consent-copy-core.mjs";
import {
  SENDER_TAG_PATTERN,
  assessWelcomeTrigger,
  berlin,
  buildTimeline,
  cleanText,
  codeGroupLabel,
  codeKind,
  codeUsageGroups,
  describeDiscountNode,
  isMoOwnDiscount,
  isReadOnlyGraphql,
  isSelectOnlySql,
  maskCode,
  maskEmail,
  parseInboxTime,
  shopifyConsentOf,
  throttleDelayMs,
  welcomeCandidateReasons,
} from "../src/lib/welcome-code-check.mjs";

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------
const USAGE = `Willkommenscode-Check (nur lesend)

  npm run check:welcome
  npm run check:welcome -- --email test@example.com [--inbox 2026-10-09T10:14:00+02:00]

  --email <adresse>   Mo + Shopify für genau diese Adresse (Abschnitte D–G)
  --inbox <Zeit>      wann die Willkommensmail im Postfach ankam (ohne Zone = Berliner Zeit,
                      z. B. 2026-10-09T10:14 oder „09.10.2026 10:14“)
  --days <n>          Zeitraum für Einlösungen und Shopify-Ereignisse (Standard 60)
  --all               auch abgelaufene Rabatte (Standard: aktiv + geplant)
  --show-codes        Codes ungekürzt zeigen (Ausgabe dann nirgends einfügen)
  --max-codes <n>     Codes je Kandidat für die Einlösungszählung (Standard 250)
  --no-shopify        nur Mos Datenbank · --no-db  nur Shopify`;

const VALUE_FLAGS = new Set(["--email", "--inbox", "--days", "--max-codes"]);
const BOOL_FLAGS = new Set(["--all", "--show-codes", "--no-shopify", "--no-db", "--help", "-h"]);

function parseArgs(argv) {
  const out = { values: {}, flags: new Set() };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (VALUE_FLAGS.has(a)) {
      const v = argv[i + 1];
      if (v == null || v.startsWith("--")) fail(`${a}: Wert fehlt.`);
      out.values[a] = v;
      i += 1;
    } else if (BOOL_FLAGS.has(a)) out.flags.add(a);
    else fail(`Unbekannte Option: ${a}`);
  }
  return out;
}

function fail(message) {
  console.error(`${message}\n\n${USAGE}`);
  process.exit(1);
}

const { values, flags } = parseArgs(process.argv.slice(2));
if (flags.has("--help") || flags.has("-h")) {
  console.log(USAGE);
  process.exit(0);
}
const intArg = (name, dflt, max) => {
  if (values[name] == null) return dflt;
  const n = Number.parseInt(values[name], 10);
  if (!Number.isFinite(n) || n < 1) fail(`${name}: positive ganze Zahl erwartet.`);
  return Math.min(n, max);
};
const email = values["--email"] ? values["--email"].trim().toLowerCase() : null;
const inboxAt = values["--inbox"] != null ? parseInboxTime(values["--inbox"]) : null;
const days = intArg("--days", 60, 3650);
const maxCodes = intArg("--max-codes", 250, 5000);
const showCodes = flags.has("--show-codes");
if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail("--email: keine gültige Adresse.");
if (values["--inbox"] != null && !inboxAt) fail("--inbox: keine lesbare Zeit (z. B. 2026-10-09T10:14 oder „09.10.2026 10:14“, ohne Zone = Berliner Zeit).");
if (inboxAt && !email) fail("--inbox gilt nur zusammen mit --email.");

const head = (t) => console.log(`\n=== ${t} ===`);
/** "fetch failed (ECONNREFUSED)" — the cause tells a network from a TLS problem. */
const errText = (err) => `${err?.message ?? err}${err?.cause ? ` (${err.cause.code ?? err.cause.message})` : ""}`;
const table = (rows) => (rows.length ? console.table(rows) : console.log("  (keine Zeilen)"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Shopify (queries only)
// ---------------------------------------------------------------------------
const SHOPIFY_ENV = ["SHOPIFY_STORE_DOMAIN", "SHOPIFY_CLIENT_ID", "SHOPIFY_CLIENT_SECRET", "SHOPIFY_API_VERSION"];
const missingShopify = SHOPIFY_ENV.filter((k) => !process.env[k]?.trim());
const shopifyOn = !flags.has("--no-shopify") && missingShopify.length === 0;
const domain = (process.env.SHOPIFY_STORE_DOMAIN ?? "").trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
const apiVersion = (process.env.SHOPIFY_API_VERSION ?? "").trim();
const MAX_RETRIES = 6;
/** Pass 2 reads the full settings of at most this many candidates (newest first). */
const MAX_DETAIL = 25;
let accessToken = null;

/** Client-credentials token, the same flow as src/lib/shopify.ts and verify:shopify. */
async function shopifyToken() {
  const res = await fetch(`https://${domain}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: process.env.SHOPIFY_CLIENT_ID.trim(),
      client_secret: process.env.SHOPIFY_CLIENT_SECRET.trim(),
    }),
  });
  if (!res.ok) throw new Error(`Token: HTTP ${res.status}`);
  const json = await res.json().catch(() => null);
  if (!json?.access_token) throw new Error("Token: kein access_token in der Antwort");
  return json.access_token;
}

/** One Admin GraphQL query. Refuses anything but a query; waits out throttling. */
async function gql(query, variables = {}) {
  if (!isReadOnlyGraphql(query)) throw new Error("Nur-Lese-Skript: nur GraphQL-Abfragen, keine Mutation.");
  accessToken ??= await shopifyToken();
  for (let attempt = 0; ; attempt += 1) {
    const res = await fetch(`https://${domain}/admin/api/${apiVersion}/graphql.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": accessToken },
      body: JSON.stringify({ query, variables }),
    });
    const json = await res.json().catch(() => null);
    const wait = throttleDelayMs({ status: res.status, json, retryAfter: res.headers.get("retry-after") });
    if (wait != null && attempt < MAX_RETRIES) {
      console.error(`  (Shopify drosselt — warte ${num(wait / 1000, 1)} s, Versuch ${attempt + 2} von ${MAX_RETRIES + 1})`);
      await sleep(wait);
      continue;
    }
    if (!res.ok) throw new Error(`GraphQL HTTP ${res.status}`);
    if (json?.errors?.length) throw new Error(json.errors.map((e) => e.message).join("; "));
    return json?.data ?? null;
  }
}

const EVENT_FIELDS = "createdAt action appTitle attributeToApp attributeToUser message";
const SCAN_FIELDS = "title status tags context { __typename } codesCount { count } codes(first: 2) { nodes { code createdBy { title } } }";
const VALUE_FIELDS = `value {
        __typename
        ... on DiscountPercentage { percentage }
        ... on DiscountAmount { amount { amount currencyCode } appliesOnEachItem }
      }`;
const DETAIL_FIELDS = `
  title status createdAt startsAt endsAt tags discountClasses
  usageLimit appliesOncePerCustomer asyncUsageCount
  codesCount { count }
  codes(first: 5) { nodes { code asyncUsageCount createdBy { title } } }
  combinesWith { orderDiscounts productDiscounts shippingDiscounts }
  context {
    __typename
    ... on DiscountBuyerSelectionAll { all }
    ... on DiscountCustomers { customers { id } }
    ... on DiscountCustomerSegments { segments { name } }
  }
  totalSales { amount currencyCode }`;
const GETS = `
  customerGets {
    ${VALUE_FIELDS}
    items {
      __typename
      ... on AllDiscountItems { allItems }
      ... on DiscountCollections { collections(first: 5) { nodes { title } pageInfo { hasNextPage } } }
      ... on DiscountProducts { products(first: 5) { nodes { id } pageInfo { hasNextPage } } }
    }
  }`;
const MINIMUM = `
  minimumRequirement {
    __typename
    ... on DiscountMinimumSubtotal { greaterThanOrEqualToSubtotal { amount currencyCode } }
    ... on DiscountMinimumQuantity { greaterThanOrEqualToQuantity }
  }`;

/** Pass 1: every code discount, light fields only (≈ 50 nodes per page). */
const SCAN_QUERY = `
  query WelcomeScan($cursor: String, $filter: String!) {
    discountNodes(first: 50, after: $cursor, query: $filter, sortKey: CREATED_AT, reverse: true) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        events(first: 2, sortKey: CREATED_AT) { nodes { ${EVENT_FIELDS} } }
        discount {
          __typename
          ... on DiscountCodeBasic { ${SCAN_FIELDS} customerGets { ${VALUE_FIELDS} } }
          ... on DiscountCodeFreeShipping { ${SCAN_FIELDS} }
          ... on DiscountCodeBxgy { ${SCAN_FIELDS} }
          ... on DiscountCodeApp { ${SCAN_FIELDS} }
        }
      }
    }
  }`;
/** Pass 2: the full settings, for candidates only. */
const DETAIL_QUERY = `
  query WelcomeDiscount($id: ID!) {
    discountNode(id: $id) {
      id
      events(first: 5, sortKey: CREATED_AT) { nodes { ${EVENT_FIELDS} } }
      discount {
        __typename
        ... on DiscountCodeBasic { ${DETAIL_FIELDS} summary ${GETS} ${MINIMUM} }
        ... on DiscountCodeFreeShipping { ${DETAIL_FIELDS} summary ${MINIMUM} }
        ... on DiscountCodeBxgy { ${DETAIL_FIELDS} summary }
        ... on DiscountCodeApp { ${DETAIL_FIELDS} appDiscountType { title app { title } } }
      }
    }
  }`;
const CODES_PAGE = "codes(first: 250, after: $cursor) { nodes { code } pageInfo { hasNextPage endCursor } }";
const CODES_QUERY = `
  query WelcomeCodes($id: ID!, $cursor: String) {
    discountNode(id: $id) {
      discount {
        __typename
        ... on DiscountCodeBasic { ${CODES_PAGE} }
        ... on DiscountCodeFreeShipping { ${CODES_PAGE} }
        ... on DiscountCodeBxgy { ${CODES_PAGE} }
        ... on DiscountCodeApp { ${CODES_PAGE} }
      }
    }
  }`;
/** Exact lookup by address — returns that one customer only. */
const CUSTOMER_BY_EMAIL_QUERY = `
  query WelcomeCustomerByEmail($email: String!) {
    customerByIdentifier(identifier: { emailAddress: $email }) { id defaultEmailAddress { emailAddress } }
  }`;
/** Fallback search (the same `email:"…"` search the outbox uses); only an exact match counts. */
const CUSTOMER_SEARCH_QUERY = `
  query WelcomeCustomerSearch($q: String!) {
    customers(first: 5, query: $q) { nodes { id defaultEmailAddress { emailAddress } } }
  }`;
const CUSTOMER_QUERY = `
  query WelcomeCustomer($id: ID!, $events: String!) {
    customer(id: $id) {
      id createdAt tags numberOfOrders
      defaultEmailAddress { emailAddress marketingState marketingOptInLevel marketingUpdatedAt }
      emailMarketingConsent { marketingState marketingOptInLevel consentUpdatedAt }
      events(first: 50, sortKey: CREATED_AT, reverse: true, query: $events) { nodes { ${EVENT_FIELDS} } }
      orders(first: 10, sortKey: CREATED_AT, reverse: true) { nodes { name createdAt cancelledAt discountCodes } }
    }
  }`;
const CODE_LOOKUP_QUERY = `
  query WelcomeCodeLookup($code: String!) {
    codeDiscountNodeByCode(code: $code) {
      id
      codeDiscount {
        __typename
        ... on DiscountCodeBasic { title createdAt }
        ... on DiscountCodeFreeShipping { title createdAt }
        ... on DiscountCodeBxgy { title createdAt }
        ... on DiscountCodeApp { title createdAt }
      }
    }
  }`;

/** Every code of one discount (paged), up to --max-codes. */
async function allCodes(id) {
  const out = [];
  let cursor = null;
  while (out.length < maxCodes) {
    const data = await gql(CODES_QUERY, { id, cursor });
    const conn = data?.discountNode?.discount?.codes;
    out.push(...(conn?.nodes ?? []).map((n) => String(n.code).toUpperCase()));
    if (!conn?.pageInfo?.hasNextPage) return { codes: out.slice(0, maxCodes), complete: out.length <= maxCodes };
    cursor = conn.pageInfo.endCursor;
  }
  return { codes: out.slice(0, maxCodes), complete: false };
}

/** The Shopify customer with exactly this address, or null. */
async function findShopifyCustomerId(address) {
  try {
    const hit = (await gql(CUSTOMER_BY_EMAIL_QUERY, { email: address }))?.customerByIdentifier ?? null;
    if (hit && String(hit.defaultEmailAddress?.emailAddress ?? "").toLowerCase() === address) return hit.id;
  } catch (err) {
    console.error(`  (customerByIdentifier: ${errText(err)} — weiter mit der Suche)`);
  }
  const nodes = (await gql(CUSTOMER_SEARCH_QUERY, { q: `email:"${address.replace(/"/g, "")}"` }))?.customers?.nodes ?? [];
  return nodes.find((n) => String(n.defaultEmailAddress?.emailAddress ?? "").toLowerCase() === address)?.id ?? null;
}

// ---------------------------------------------------------------------------
// Mo's database (one SELECT per call, inside a READ ONLY transaction)
// ---------------------------------------------------------------------------
const dbUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;
const dbOn = !flags.has("--no-db") && Boolean(dbUrl);
if (dbOn && process.env.NEON_FETCH_ENDPOINT) neonConfig.fetchEndpoint = process.env.NEON_FETCH_ENDPOINT;
const sql = dbOn ? neon(dbUrl) : null;

async function q(text, params = []) {
  if (!isSelectOnlySql(text)) throw new Error("Nur-Lese-Skript: nur eine SELECT-Abfrage.");
  const [rows] = await sql.transaction((tx) => [tx.query(text, params)], { readOnly: true });
  return rows;
}

// ---------------------------------------------------------------------------
console.log(`Willkommenscode-Check · Zeitraum ${days} Tage · ${email ? `Adresse ${maskEmail(email)}` : "ohne Adresse"}`);
console.log(
  `Shopify: ${shopifyOn ? `${domain} (API ${apiVersion})` : flags.has("--no-shopify") ? "aus (--no-shopify)" : `aus (fehlt: ${missingShopify.join(", ")})`}` +
    ` · Mo-DB: ${dbOn ? "an" : flags.has("--no-db") ? "aus (--no-db)" : "aus (DATABASE_URL fehlt)"}` +
    ` · nur lesend${showCodes ? " · Codes UNGEKÜRZT" : ""}`
);
if (!shopifyOn && !dbOn) {
  console.error("\nWeder Shopify noch Mos Datenbank ist an — SHOPIFY_* und/oder DATABASE_URL in .env setzen (ohne --no-shopify / --no-db).");
  process.exit(1);
}

const candidates = [];
if (shopifyOn) {
  head("A · Zugriffsrechte der App");
  try {
    const data = await gql("{ currentAppInstallation { accessScopes { handle } } }");
    const granted = new Set((data?.currentAppInstallation?.accessScopes ?? []).map((s) => s.handle));
    const has = (s) => granted.has(s) || granted.has(s.replace(/^read_/, "write_"));
    table(
      [
        ["read_discounts", "Rabatte lesen (in write_discounts enthalten) — B, C, E"],
        ["read_customers", "Kunde, Einwilligung, Tags, Kunden-Ereignisse — E"],
        ["read_orders", "Bestellungen mit Rabattcodes — E"],
        ["read_marketing_events", "Marketing-Aktivitäten — nicht nötig"],
      ].map(([scope, use]) => ({ Recht: scope, vorhanden: has(scope) ? "ja" : "nein", wofür: use }))
    );
    console.log("  read_marketing_events NICHT beantragen: es zeigt nur Titel/Status der App-eigenen Aktivitäten, nie Auslöser, Bedingungen oder Rabatt.");
  } catch (err) {
    console.log(`  Fehler: ${errText(err)}`);
  }

  head("B · Rabattcodes, die der Willkommenscode sein können");
  try {
    const filter = flags.has("--all") ? "method:code" : "method:code AND status:active,scheduled";
    let cursor = null;
    let scanned = 0;
    let mo = 0;
    const ids = [];
    const others = [];
    do {
      const conn = (await gql(SCAN_QUERY, { cursor, filter }))?.discountNodes;
      for (const node of conn?.nodes ?? []) {
        scanned += 1;
        const desc = describeDiscountNode(node, { showCodes });
        if (isMoOwnDiscount(desc)) mo += 1;
        else if (welcomeCandidateReasons(desc).length) ids.push(node.id);
        else others.push(desc);
      }
      cursor = conn?.pageInfo?.hasNextPage ? conn.pageInfo.endCursor : null;
    } while (cursor);
    for (const id of ids.slice(0, MAX_DETAIL)) {
      const node = (await gql(DETAIL_QUERY, { id }))?.discountNode;
      if (!node) continue;
      const desc = describeDiscountNode(node, { showCodes });
      candidates.push({ desc, reasons: welcomeCandidateReasons(desc) });
    }
    console.log(`  Filter „${filter}“${flags.has("--all") ? "" : " (--all: auch abgelaufene)"}.`);
    console.log(`  ${num(scanned)} Code-Rabatte gelesen, davon ${num(mo)} Mo-eigene (MS5-/MK-), ${num(ids.length)} Kandidaten:`);
    if (ids.length > MAX_DETAIL) console.log(`  Nur die neuesten ${MAX_DETAIL} Kandidaten im Detail (viele Einzelrabatte je Empfänger? → App in Einstellungen → Apps suchen).`);
    if (scanned === 0 && !flags.has("--all")) console.log("  Keine Treffer — mit --all wiederholen (prüft auch den Suchfilter).");
    for (const { desc, reasons } of candidates) {
      console.log(`\n  ▸ ${desc.title || "(ohne Titel)"} — ${desc.status} · ${desc.type} · Hinweise: ${reasons.join("; ")}`);
      console.log(
        `    Wert: ${desc.value ?? desc.appType ?? "?"} auf ${desc.items ?? "?"} · ${desc.minimum ?? "Mindestwert: —"} · ${desc.combines ?? "?"}`
      );
      console.log(
        `    Wer: ${desc.buyers ?? "?"} · einmal je Kunde: ${desc.oncePerCustomer ? "ja" : "nein"} · Gesamtlimit: ${desc.usageLimit ?? "keins"} · genutzt: ${desc.used ?? "?"}`
      );
      const sample = desc.codes.map((c) => `${c.shown}${c.createdBy ? ` [App ${c.createdBy}]` : ""}${c.used != null ? ` ×${c.used}` : ""}`).join(", ");
      console.log(`    Codes: ${num(desc.codesCount)} (${codeKind(desc)}) — ${sample || "—"}`);
      console.log(`    Angelegt ${berlin(desc.createdAt)} · gültig ${berlin(desc.startsAt)} bis ${berlin(desc.endsAt)} · Umsatz ${desc.totalSales ?? "?"}`);
      if (desc.tags.length) console.log(`    Tags: ${desc.tags.join(", ")}`);
      if (desc.summary) console.log(`    Shopify-Zusammenfassung: ${desc.summary}`);
      for (const e of desc.events) {
        console.log(`    Ereignis ${berlin(e.at)}: ${e.action ?? ""}${e.app ? ` (App ${e.app})` : e.byStaff ? " (Mitarbeiter)" : ""} ${e.message ?? ""}`);
      }
    }
    if (others.length) {
      console.log(`\n  Weitere Code-Rabatte ohne Hinweis (${others.length}${others.length > 20 ? ", die neuesten 20" : ""}):`);
      for (const d of others.slice(0, 20)) {
        console.log(`    · ${d.title || "(ohne Titel)"} — ${d.status} · ${d.value ?? d.type} · ${num(d.codesCount)} Code(s), z. B. ${d.codes[0]?.shown ?? "—"}`);
      }
    }
  } catch (err) {
    console.log(`  Fehler: ${errText(err)}`);
  }
}

if (dbOn) {
  head(`C · Einlösungen in Mos Bestell-Ledger (customer_orders, ${days} Tage, ohne Stornos)`);
  try {
    const rows = await q(
      `SELECT upper(c) AS code, count(*)::int AS orders, count(DISTINCT customer_id)::int AS customers,
              min(processed_at) AS first, max(processed_at) AS last
         FROM customer_orders, unnest(discount_codes) AS c
        WHERE processed_at >= now() - make_interval(days => $1::int) AND cancelled_at IS NULL
        GROUP BY 1`,
      [days]
    );
    const groups = codeUsageGroups(rows);
    console.log("  Ein Code mit ≥ 3 Bestellungen steht für sich (gemeinsamer Code), seltenere sind nach Präfix gebündelt.");
    table(
      groups.slice(0, 25).map((g) => ({
        Code: codeGroupLabel(g, showCodes),
        Codes: g.codes,
        Bestellungen: g.orders,
        Kunden: g.customers,
        erste: berlin(g.first),
        letzte: berlin(g.last),
        Mo: g.mo ? "ja" : "",
      }))
    );
    if (groups.length > 25) console.log(`  … ${groups.length - 25} weitere Gruppen`);
    for (const { desc } of candidates) {
      const { codes, complete } = await allCodes(desc.id);
      if (codes.length === 0) continue;
      const [r] = await q(
        `SELECT count(*)::int AS orders, count(DISTINCT customer_id)::int AS customers,
                min(processed_at) AS first, max(processed_at) AS last
           FROM customer_orders
          WHERE cancelled_at IS NULL
            AND EXISTS (SELECT 1 FROM unnest(discount_codes) AS c WHERE upper(c) = ANY($1::text[]))`,
        [codes]
      );
      const used = r.orders > 0
        ? `${plural(r.orders, "Bestellung", "Bestellungen")} von ${plural(r.customers, "Kunde", "Kunden")} seit Beginn des Ledgers (${berlin(r.first)} – ${berlin(r.last)})`
        : "keine Bestellung im Ledger";
      console.log(`  ▸ ${desc.title || "(ohne Titel)"}: ${used}${complete ? "" : ` — nur die ersten ${num(codes.length)} Codes geprüft (--max-codes)`}`);
    }
    console.log("  Nicht im Ledger: Gastbestellungen ohne Shopify-Kunden und Bestellungen gelöschter Kunden.");

    const tags = await q(
      `SELECT t AS tag, count(*)::int AS customers
         FROM customers, unnest(shopify_tags) AS t
        WHERE t ~* $1
        GROUP BY 1
        ORDER BY 2 DESC, 1
        LIMIT 15`,
      [SENDER_TAG_PATTERN]
    );
    console.log("\n  Shopify-Tags im Kundenspiegel, die nach Willkommen/Newsletter oder einer Mail-App aussehen:");
    table(tags.map((t) => ({ Tag: cleanText(t.tag, 60), Kunden: t.customers })));
  } catch (err) {
    console.log(`  Fehler: ${errText(err)}`);
  }
}

if (email) {
  const timeline = [];
  let moConfirmedAt = null;
  let outbox = [];
  let shopifyConsent = null;

  if (dbOn) {
    head(`D · Mo für ${maskEmail(email)}`);
    try {
      const [cust] = await q(
        `SELECT id, email_consent_state, email_consent_level, email_consent_at, email_consent_source,
                email_consent_synced_at, shopify_customer_id, shopify_tags, welcome_issued_at
           FROM customers WHERE email = $1`,
        [email]
      );
      const captures = await q(
        `SELECT id, created_at, session_id, marketing_consent, marketing_doi_status, doi_sent_at, doi_confirmed_at,
                unsubscribed_at, consent_copy_version, locale
           FROM email_captures WHERE email = $1 ORDER BY created_at, id`,
        [email]
      );
      const [supp] = await q(`SELECT added_at, reason FROM suppression_list WHERE email = $1`, [email]);
      if (!cust) console.log("  Kein Kundensatz in Mo.");
      else {
        console.log(
          `  Kunde #${cust.id} · Einwilligung ${cust.email_consent_state ?? "—"}/${cust.email_consent_level ?? "—"} seit ${berlin(cust.email_consent_at)}` +
            ` (Quelle ${cust.email_consent_source ?? "—"}) · Shopify-Id ${cust.shopify_customer_id ?? "—"} · mit Shopify abgeglichen ${berlin(cust.email_consent_synced_at)}`
        );
        console.log(
          `  Shopify-Tags im Spiegel: ${(cust.shopify_tags ?? []).map((t) => cleanText(t, 60)).join(", ") || "—"}` +
            `${cust.welcome_issued_at ? ` · alter Mo-Willkommenscode ${berlin(cust.welcome_issued_at)}` : ""}`
        );
      }
      if (supp) console.log(`  Sperrliste seit ${berlin(supp.added_at)} (${supp.reason ?? "—"})`);
      console.log(`  ${captures.length} Erfassung(en) dieser Adresse.`);
      for (const c of captures) {
        const sid = c.session_id ? `${String(c.session_id).slice(0, 8)}…` : "ohne Sitzung";
        timeline.push({
          at: c.created_at,
          side: "Mo",
          what: `Erfassung #${c.id} (${sid}, Werbung ${c.marketing_consent ? "ja" : "nein"}, DOI ${c.marketing_doi_status ?? "—"}, Text ${c.consent_copy_version ?? "?"}, ${c.locale ?? "?"})`,
        });
        if (c.doi_sent_at) timeline.push({ at: c.doi_sent_at, side: "Mo", what: `DOI-Mail-Zeitpunkt (Erfassung #${c.id}; ein erneutes Senden überschreibt ihn)` });
        if (c.doi_confirmed_at) timeline.push({ at: c.doi_confirmed_at, side: "Mo", what: `DOI bestätigt (Erfassung #${c.id})` });
        if (c.unsubscribed_at) timeline.push({ at: c.unsubscribed_at, side: "Mo", what: `abgemeldet (Erfassung #${c.id})` });
        if (c.doi_confirmed_at && (!moConfirmedAt || new Date(c.doi_confirmed_at) > new Date(moConfirmedAt))) moConfirmedAt = c.doi_confirmed_at;
      }
      const subjects = new Set([consentStrings("de").doiSubject, consentStrings("en").doiSubject]);
      if (cust) {
        const events = await q(
          `SELECT occurred_at, source, state, level, origin_ref FROM consent_events
            WHERE customer_id = $1 ORDER BY occurred_at, id`,
          [cust.id]
        );
        for (const e of events) {
          timeline.push({ at: e.occurred_at, side: "Mo", what: `Einwilligungsverlauf: ${e.state}${e.level ? `/${e.level}` : ""} (Quelle ${e.source}, ${e.origin_ref ?? "—"})` });
        }
        const rows = await q(
          `SELECT id, kind, status, attempts, created_at, done_at, payload->>'state' AS state,
                  payload->>'at' AS at, left(last_error, 160) AS last_error
             FROM shopify_outbox WHERE customer_id = $1 ORDER BY id`,
          [cust.id]
        );
        outbox = rows.map((o) => ({ kind: o.kind, status: o.status, payloadAt: o.at, payloadState: o.state, doneAt: o.done_at }));
        for (const o of rows) {
          timeline.push({ at: o.created_at, side: "Mo", what: `Outbox #${o.id} ${o.kind} ${o.state ?? ""} angelegt (consentUpdatedAt ${berlin(o.at)})` });
          if (o.done_at) timeline.push({ at: o.done_at, side: "Mo→Shopify", what: `Outbox #${o.id} ${o.status} nach ${o.attempts} Versuch(en)` });
          else timeline.push({ at: o.created_at, side: "Mo→Shopify", what: `Outbox #${o.id} Status ${o.status}${o.last_error ? `: ${cleanText(o.last_error)}` : ""}` });
        }
        const mails = await q(
          `SELECT occurred_at, subject FROM email_messages
            WHERE direction = 'sent' AND (customer_id = $1 OR lower(to_address) = $2)
            ORDER BY occurred_at`,
          [cust.id, email]
        );
        for (const m of mails) {
          timeline.push({ at: m.occurred_at, side: "Mo", what: `Mail gesendet: ${subjects.has(m.subject) ? "DOI-Bestätigungsmail" : cleanText(m.subject, 80)}` });
        }
        const orders = await q(
          `SELECT order_name, processed_at, discount_codes, cancelled_at FROM customer_orders
            WHERE customer_id = $1 ORDER BY processed_at DESC LIMIT 20`,
          [cust.id]
        );
        for (const o of orders) {
          const codes = (o.discount_codes ?? []).map((c) => maskCode(c, showCodes)).join(", ") || "—";
          timeline.push({ at: o.processed_at, side: "Mo-Ledger", what: `Bestellung ${o.order_name ?? "?"}${o.cancelled_at ? " (storniert)" : ""} · Codes: ${codes}` });
        }
      } else {
        const mails = await q(
          `SELECT occurred_at, subject FROM email_messages
            WHERE direction = 'sent' AND lower(to_address) = $1
            ORDER BY occurred_at`,
          [email]
        );
        for (const m of mails) {
          timeline.push({ at: m.occurred_at, side: "Mo", what: `Mail gesendet: ${subjects.has(m.subject) ? "DOI-Bestätigungsmail" : cleanText(m.subject, 80)}` });
        }
      }
      const sessions = [...new Set(captures.map((c) => c.session_id).filter(Boolean))];
      if (sessions.length) {
        const kpi = await q(
          `SELECT event, data, created_at FROM kpi_events
            WHERE session_id = ANY($1::text[]) AND (event LIKE 'email_capture_%' OR event LIKE 'consent_gate_%')
            ORDER BY created_at, id`,
          [sessions]
        );
        const keys = ["placement", "variant", "source", "outcome", "doiSent", "doiCooldown", "doiResend", "shopifyConsent"];
        for (const k of kpi) {
          const d = k.data ?? {};
          const bits = keys.filter((x) => d[x] != null).map((x) => `${x}=${typeof d[x] === "object" ? JSON.stringify(d[x]) : d[x]}`);
          timeline.push({ at: k.created_at, side: "Mo-KPI", what: `${k.event}${bits.length ? ` (${bits.join(", ")})` : ""}` });
        }
      }
    } catch (err) {
      console.log(`  Fehler: ${errText(err)}`);
    }
  }

  if (shopifyOn) {
    head(`E · Shopify für ${maskEmail(email)}`);
    try {
      const id = await findShopifyCustomerId(email);
      if (!id) console.log("  Kein Shopify-Kunde mit genau dieser Adresse.");
      else {
        const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
        const c = (await gql(CUSTOMER_QUERY, { id, events: `created_at:>=${since}` }))?.customer;
        if (!c) throw new Error("Kunde nicht lesbar");
        shopifyConsent = shopifyConsentOf(c);
        const dea = c.defaultEmailAddress ?? {};
        const emc = c.emailMarketingConsent ?? {};
        console.log(`  ${c.id} · angelegt ${berlin(c.createdAt)} · Bestellungen ${num(c.numberOfOrders)} · Tags: ${(c.tags ?? []).map((t) => cleanText(t, 60)).join(", ") || "—"}`);
        console.log(
          `  E-Mail-Marketing: ${shopifyConsent?.marketingState ?? "—"} / ${shopifyConsent?.optInLevel ?? "—"} (aus ${shopifyConsent?.from ?? "—"})` +
            ` · marketingUpdatedAt ${berlin(dea.marketingUpdatedAt)} · consentUpdatedAt (veraltet) ${berlin(emc.consentUpdatedAt)}`
        );
        timeline.push({ at: c.createdAt, side: "Shopify", what: "Kunde angelegt" });
        if (shopifyConsent?.consentUpdatedAt) {
          timeline.push({ at: shopifyConsent.consentUpdatedAt, side: "Shopify", what: `Einwilligung jetzt ${shopifyConsent.marketingState}/${shopifyConsent.optInLevel ?? "—"} (zuletzt geändert)` });
        }
        const events = c.events?.nodes ?? [];
        for (const e of events) {
          timeline.push({ at: e.createdAt, side: "Shopify", what: `Ereignis ${e.action}${e.appTitle ? ` [${e.appTitle}]` : ""}: ${cleanText(e.message, 140) ?? ""}` });
        }
        console.log(`  ${events.length} Kunden-Ereignis(se) seit ${since} (Versand-Ereignisse von Shopify Messaging fehlen dort oft → Aktivitätsbericht).`);
        const used = new Set();
        for (const o of c.orders?.nodes ?? []) {
          for (const code of o.discountCodes ?? []) used.add(String(code));
          const codes = (o.discountCodes ?? []).map((x) => maskCode(x, showCodes)).join(", ") || "—";
          timeline.push({ at: o.createdAt, side: "Shopify", what: `Bestellung ${o.name}${o.cancelledAt ? " (storniert)" : ""} · Codes: ${codes}` });
        }
        for (const code of used) {
          const d = (await gql(CODE_LOOKUP_QUERY, { code }))?.codeDiscountNodeByCode?.codeDiscount;
          console.log(`  Code ${maskCode(code, showCodes)} gehört zu: ${d ? `${cleanText(d.title, 80)} (angelegt ${berlin(d.createdAt)})` : "— (gelöscht oder unbekannt)"}`);
        }
      }
    } catch (err) {
      console.log(`  Fehler: ${errText(err)}`);
    }
  }

  if (inboxAt) timeline.push({ at: inboxAt, side: "Postfach", what: "Willkommensmail angekommen (--inbox)" });
  head("F · Zeitachse (Europe/Berlin)");
  table(buildTimeline(timeline).map((e) => ({ Zeit: berlin(e.at), Seite: e.side, Was: e.what })));
  head("G · Einordnung (Testfall 8 / 8b)");
  for (const line of assessWelcomeTrigger({ moConfirmedAt, outbox, shopify: shopifyConsent, inboxAt, moChecked: dbOn })) console.log(`  • ${line}`);
  console.log("  • Nur die zeitliche Passung — ob die Automation wirklich ausgelöst hat, zeigt ihr Aktivitätsbericht.");
}

head("Nur im Shopify-Admin sichtbar — bitte dort prüfen");
console.log(
  [
    "  • Apps → Shopify Messaging → Automationen (seit 24.03.2026 dort; „Marketing → Automationen“ zeigt evtl. nur noch",
    "    Auswertungen): Willkommens-Automation — Auslöser, Bedingungen (z. B. „nicht an der Kasse abonniert“, Tags),",
    "    Rabatt im Mail-Baustein (Wert, gemeinsamer oder Einzelcode, Limits, Mindestwert, Kollektionen, Ablauf),",
    "    Aktivitätsbericht (Empfänger, Zeitpunkte).",
    "  • Shopify Flow: Workflows mit dem Auslöser „Customer subscribed to email marketing“ und ihr Ausführungsverlauf.",
    "  • Einstellungen → Apps (installierte Apps, z. B. eine Mailchimp-Synchronisierung) und ein evtl. Mailchimp-Konto.",
    "  • Inhalt und Absender der Willkommensmail; Ankunftszeit aus dem Postfach → --inbox.",
  ].join("\n")
);
