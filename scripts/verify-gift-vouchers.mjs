#!/usr/bin/env node
// Verify the Shopify side of the Geschenkgutscheine (docs/GIFT_VOUCHERS.md).
//
// READ-ONLY by default — nothing is created, changed or deleted, and NO secret is ever
// printed (client secret, access token, gift-card code):
//   1. env       SHOPIFY_* present (values never shown); the voucher handles and flags;
//                whether TOKEN_ENC_KEY / BLOB_READ_WRITE_TOKEN / RESEND_API_KEY are set.
//   2. token     the client-credentials grant, as lib/shopify.ts does it.
//   3. shop      name, plan, currency (Shopify issues gift cards in the shop currency).
//   4. scopes    currentAppInstallation.accessScopes — write_gift_cards (required; also
//                grants read_gift_cards), read_gift_card_transactions and
//                write_merchant_managed_fulfillment_orders (optional).
//   5. products  both handles via productByIdentifier: found, NOT a Shopify gift-card
//                product, variants with prices, taxable and requiresShipping flags.
//   6. config    giftCardConfiguration (issue / purchase limit, default expiry) — this
//                read also proves the gift-card API answers this app at all.
//
// --create-test-card WRITES: issues a 1,00 € card with a random Mo-style code and the note
// "Mo verify — sofort gesperrt", checks that Shopify kept the code, finds the card again by
// its code (what Mo does after a lost answer), DEACTIVATES it right away (irreversible) and
// prints the result shape. The code is only ever shown as •••• •••• •••• XXXX.
//
// The GraphQL documents and parsers are the ones lib/shopify-gift-cards.ts uses
// (src/lib/shopify-gift-cards-core.mjs); scripts cannot import TypeScript, so the token
// grant and the fetch are repeated here (as in verify-shopify-auth.mjs).
//
// Run: npm run verify:gift-vouchers                       (read-only)
//      npm run verify:gift-vouchers -- --create-test-card (+ test card, deactivated at once)

import process from "node:process";
import { randomBytes } from "node:crypto";
import { giftVoucherProductHandles } from "../src/lib/gift-voucher-flags.mjs";
import {
  ACCESS_SCOPES_QUERY,
  GIFT_CARD_BY_ID_QUERY,
  GIFT_CARD_CONFIGURATION_QUERY,
  GIFT_CARD_CREATE_MUTATION,
  GIFT_CARD_DEACTIVATE_MUTATION,
  GIFT_CARDS_BY_CODE_QUERY,
  GIFT_VOUCHER_OPTIONAL_SCOPES,
  GIFT_VOUCHER_PRODUCTS_QUERY,
  GIFT_VOUCHER_SHOPIFY_API_VERSION,
  classifyGiftCardUserErrors,
  describeAdminGraphqlError,
  describeGiftVoucherProductIssues,
  evaluateGiftVoucherScopes,
  giftCardDeactivateErrorMessage,
  giftCardMutationFailure,
  giftCardSearchQuery,
  maskGiftCardCode,
  normalizeGiftCardCode,
  normalizeProductHandle,
  parseGiftCardConfiguration,
  parseGiftCardNode,
  parseGiftVoucherProduct,
  pickGiftCardByCode,
} from "../src/lib/shopify-gift-cards-core.mjs";

const OPTION_CREATE = "--create-test-card";
const argv = process.argv.slice(2);
if (argv.includes("--help") || argv.includes("-h")) {
  console.log(
    "Usage: npm run verify:gift-vouchers [-- --create-test-card]\n" +
      "  read-only checks of the Shopify setup for Geschenkgutscheine;\n" +
      `  ${OPTION_CREATE}: also issue a 1,00 € test card and deactivate it immediately.`
  );
  process.exit(0);
}
const unknownArgs = argv.filter((a) => a !== OPTION_CREATE);
if (unknownArgs.length) {
  console.error(`Unbekannte Option(en): ${unknownArgs.join(" ")} — erlaubt ist nur ${OPTION_CREATE}.`);
  process.exit(2);
}
const CREATE_TEST_CARD = argv.includes(OPTION_CREATE);

const TRUTHY = new Set(["1", "true", "yes", "on"]);
const flag = (name) => TRUTHY.has((process.env[name] ?? "").trim().toLowerCase());
const isSet = (name) => Boolean((process.env[name] ?? "").trim());

let errors = 0;
let warnings = 0;
const ok = (msg) => console.log(`  ✓ ${msg}`);
const warn = (msg) => {
  warnings++;
  console.log(`  ! ${msg}`);
};
const fail = (msg, hint) => {
  errors++;
  console.error(`  ✗ ${msg}${hint ? `\n      → ${hint}` : ""}`);
};
const info = (msg) => console.log(`    ${msg}`);
const section = (title) => console.log(`\n${title}`);

/** 123456 → "1.234,56 €" (null → "?"). */
function euro(cents) {
  if (typeof cents !== "number") return "?";
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const whole = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${sign}${whole},${String(abs % 100).padStart(2, "0")} €`;
}

/** Euro env var as whole euros (the documented defaults when unset or junk). */
function euroEnv(name, fallback) {
  const n = Number.parseInt((process.env[name] ?? "").trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// ── 1. Environment ───────────────────────────────────────────────────────────

const REQUIRED = ["SHOPIFY_STORE_DOMAIN", "SHOPIFY_CLIENT_ID", "SHOPIFY_CLIENT_SECRET", "SHOPIFY_API_VERSION"];
const missingEnv = REQUIRED.filter((k) => !isSet(k));
if (missingEnv.length) {
  console.error(
    `\nFAILURE: Missing env vars: ${missingEnv.join(", ")}.` +
      "\nIn .env eintragen (siehe .env.example). Run with: npm run verify:gift-vouchers"
  );
  process.exit(1);
}
const storeDomain = process.env.SHOPIFY_STORE_DOMAIN.trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
if (!/\.myshopify\.com$/.test(storeDomain)) {
  console.error(
    `\nFAILURE: SHOPIFY_STORE_DOMAIN muss die *.myshopify.com-Domain sein (ist "${storeDomain}").` +
      "\nThe client-credentials grant only accepts the myshopify.com host."
  );
  process.exit(1);
}
const apiVersion = process.env.SHOPIFY_API_VERSION.trim();
const handles = giftVoucherProductHandles();
const voucherHandle = normalizeProductHandle(handles.voucher);
const printHandle = normalizeProductHandle(handles.print);

console.log(
  `\nGeschenkgutscheine — Shopify-Prüfung (${CREATE_TEST_CARD ? "MIT Testkarte: legt eine 1,00-€-Karte an und sperrt sie sofort" : "read-only"})`
);
section("1) Umgebung");
info(`Shop:     ${storeDomain} · Admin API ${apiVersion}`);
info(`Produkte: Gutschein „${voucherHandle}“ · Druck „${printHandle}“ (GIFT_VOUCHER_*_HANDLE)`);
info(`GIFT_VOUCHERS_ENABLED=${flag("GIFT_VOUCHERS_ENABLED") ? "an" : "aus (Verkauf und automatisches Ausstellen AUS)"}`);
info(`GIFT_VOUCHER_FULFILL_ORDERS=${flag("GIFT_VOUCHER_FULFILL_ORDERS") ? "an" : "aus"}`);
if (apiVersion < GIFT_VOUCHER_SHOPIFY_API_VERSION) {
  warn(`SHOPIFY_API_VERSION ${apiVersion} ist älter als ${GIFT_VOUCHER_SHOPIFY_API_VERSION} — die Abfragen sind gegen ${GIFT_VOUCHER_SHOPIFY_API_VERSION} geschrieben.`);
} else {
  ok(`SHOPIFY_* gesetzt (Werte werden nicht angezeigt)`);
}
for (const [name, why] of [
  ["TOKEN_ENC_KEY", "ohne ihn kann Mo keinen Gutscheincode verschlüsselt speichern — Ausstellen wartet"],
  ["BLOB_READ_WRITE_TOKEN", "eigene Fotos und Druckdateien brauchen den Blob-Speicher"],
  ["RESEND_API_KEY", "ohne ihn geht keine Gutschein-Mail an den Käufer"],
]) {
  if (isSet(name)) ok(`${name} gesetzt`);
  else warn(`${name} fehlt — ${why}.`);
}

// ── Transport ────────────────────────────────────────────────────────────────

const gqlUrl = `https://${storeDomain}/admin/api/${apiVersion}/graphql.json`;
let accessToken = "";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * One Admin GraphQL request. Returns { data } or { error } where `error` is the same
 * description lib/shopify-gift-cards.ts produces (safe German message). A THROTTLED answer
 * is retried (Shopify rejects it before running it, so that is safe for mutations too).
 */
async function gql(query, variables = {}, { secret = null } = {}) {
  for (let attempt = 0; ; attempt++) {
    let res;
    let text = "";
    try {
      res = await fetch(gqlUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": accessToken },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(20_000),
      });
      text = await res.text();
    } catch (err) {
      return { error: describeAdminGraphqlError(err, { detail: !secret, secret }) };
    }
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    const throttled =
      res.status === 429 || (Array.isArray(json?.errors) && json.errors.some((e) => e?.extensions?.code === "THROTTLED"));
    if (throttled && attempt < 3) {
      await sleep(2000 * (attempt + 1));
      continue;
    }
    // Same message shapes as adminGraphql, so the shared classifier reads them.
    if (!res.ok) {
      const err = new Error(`Shopify GraphQL ${res.status} ${res.statusText}: ${text.slice(0, 500)}`);
      return { error: describeAdminGraphqlError(err, { detail: !secret, secret }) };
    }
    if (Array.isArray(json?.errors) && json.errors.length) {
      const err = new Error(`Shopify GraphQL errors: ${JSON.stringify(json.errors)}`);
      return { error: describeAdminGraphqlError(err, { detail: !secret, secret }) };
    }
    if (!json?.data) return { error: describeAdminGraphqlError(new Error("Shopify GraphQL returned no data")) };
    return { data: json.data };
  }
}

const SCOPE_HINT =
  'Scope in shopify.app.toml unter [access_scopes] ergänzen → "shopify app deploy" → im Shopify-Admin die neuen ' +
  "Berechtigungen bestätigen (App neu installieren: Client-Credentials-Tokens tragen nur Scopes vom Installationszeitpunkt). " +
  "Danach `npm run shopify:webhooks -- --url https://mo.motionsports.de` prüfen. Laut Shopify kann der Gift-Card-Scope " +
  "eine Freigabe durch den Shopify-Support brauchen.";

async function main() {
  // ── 2. Token ───────────────────────────────────────────────────────────────
  section("2) Zugriffstoken (client credentials)");
  try {
    const res = await fetch(`https://${storeDomain}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: process.env.SHOPIFY_CLIENT_ID.trim(),
        client_secret: process.env.SHOPIFY_CLIENT_SECRET.trim(),
      }).toString(),
      signal: AbortSignal.timeout(20_000),
    });
    const text = await res.text();
    if (!res.ok) {
      const hint =
        res.status === 401
          ? "SHOPIFY_CLIENT_ID/SECRET falsch oder die App ist nicht im Shop installiert."
          : res.status === 400
            ? "Ungültiger Grant — Client-Credentials gehen nur für Apps der eigenen Organisation im eigenen Shop."
            : "Antwort von Shopify prüfen (verify:shopify zeigt mehr).";
      fail(`Token-Anfrage abgelehnt (HTTP ${res.status})`, hint);
      return;
    }
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
    if (!parsed?.access_token) {
      fail("Token-Antwort ohne access_token");
      return;
    }
    accessToken = parsed.access_token;
    ok(`Token erhalten${parsed.expires_in ? ` (gültig ${Math.round(parsed.expires_in / 3600)} h)` : ""}`);
  } catch (err) {
    fail("Token-Anfrage gescheitert (Netzwerk)", String(err?.message ?? err));
    return;
  }

  // ── 3. Shop ────────────────────────────────────────────────────────────────
  section("3) Shop");
  const shop = await gql(`query GiftVoucherVerifyShop { shop { name currencyCode plan { publicDisplayName shopifyPlus } } }`);
  if (shop.error) {
    warn(`Shop nicht lesbar: ${shop.error.message}`);
  } else {
    const s = shop.data.shop;
    ok(`${s?.name ?? "?"} · Tarif ${s?.plan?.publicDisplayName ?? "?"}${s?.plan?.shopifyPlus ? " (Plus)" : ""} · Währung ${s?.currencyCode ?? "?"}`);
    if (s?.currencyCode && s.currencyCode !== "EUR") {
      warn(`Shop-Währung ist ${s.currencyCode} — Mo stellt nur EUR-Gutscheine aus (andere Bestellungen landen in „Zu prüfen“).`);
    }
  }

  // ── 4. Scopes ──────────────────────────────────────────────────────────────
  section("4) Berechtigungen (Scopes)");
  let canWrite = false;
  const scopes = await gql(ACCESS_SCOPES_QUERY);
  if (scopes.error) {
    fail(`Scopes nicht lesbar: ${scopes.error.message}`);
  } else {
    const result = evaluateGiftVoucherScopes(scopes.data.currentAppInstallation?.accessScopes);
    if (result.missing.length) {
      fail(`Pflicht-Scope fehlt: ${result.missing.join(", ")} — ohne ihn kann Mo keine Gutscheinkarte ausstellen.`, SCOPE_HINT);
    } else {
      canWrite = true;
      ok("write_gift_cards (Karten ausstellen, lesen, sperren)");
    }
    for (const scope of GIFT_VOUCHER_OPTIONAL_SCOPES) {
      if (!result.optionalMissing.includes(scope)) {
        ok(`${scope} (optional)`);
      } else if (scope === "write_merchant_managed_fulfillment_orders" && flag("GIFT_VOUCHER_FULFILL_ORDERS")) {
        warn(`${scope} fehlt, aber GIFT_VOUCHER_FULFILL_ORDERS ist an — Gutschein-Positionen können nicht als erledigt markiert werden.`);
      } else {
        info(`– ${scope} (optional) nicht erteilt${scope === "read_gift_card_transactions" ? " — kein Einlöseverlauf, nur das Restguthaben" : " — Positionen bleiben in Shopify offen"}`);
      }
    }
  }

  // ── 5. Products ────────────────────────────────────────────────────────────
  section("5) Produkte");
  const products = await gql(GIFT_VOUCHER_PRODUCTS_QUERY, { voucher: voucherHandle, print: printHandle });
  if (products.error) {
    fail(`Produkte nicht lesbar: ${products.error.message}`);
  } else {
    const voucher = parseGiftVoucherProduct(products.data.voucher);
    const print = parseGiftVoucherProduct(products.data.print);
    for (const [label, handle, p] of [
      ["Gutschein-Produkt", voucherHandle, voucher],
      ["Druck-Zusatzprodukt", printHandle, print],
    ]) {
      if (!p) {
        info(`${label} „${handle}“: nicht gefunden`);
        continue;
      }
      ok(
        `${label} „${p.handle}“: „${p.title}“ (${p.status}), ID ${p.numericId}, Shopify-Geschenkkarte: ${p.isGiftCard ? "JA" : "nein"}`
      );
      for (const v of p.variants) {
        info(
          `· ${v.title} — ${euro(v.priceCents)} · Variante ${v.numericId} · ${v.taxable ? "steuerpflichtig" : "ohne Steuer"} · ${v.requiresShipping ? "mit Versand" : "ohne Versand"}`
        );
      }
    }
    for (const issue of describeGiftVoucherProductIssues({ voucher, print, handles: { voucher: voucherHandle, print: printHandle } })) {
      if (issue.level === "error") fail(issue.message);
      else warn(issue.message);
    }
  }

  // ── 6. giftCardConfiguration ───────────────────────────────────────────────
  section("6) Geschenkkarten-Einstellungen (giftCardConfiguration)");
  const config = await gql(GIFT_CARD_CONFIGURATION_QUERY);
  if (config.error) {
    // Denied although write_gift_cards is granted: the gift-card API itself is not open to
    // this app (Shopify has limited it to some plans / approved apps before).
    const hint =
      config.error.kind !== "denied"
        ? undefined
        : canWrite
          ? "Der Scope ist erteilt, Shopify verweigert die Gift-Card-API trotzdem — Tarif bzw. Freigabe beim Shopify-Support klären."
          : "siehe 4) — erst den Scope erteilen.";
    fail(`Die Gift-Card-API antwortet nicht: ${config.error.message}`, hint);
  } else {
    const c = parseGiftCardConfiguration(config.data.giftCardConfiguration);
    ok(
      `Ausgabelimit ${euro(c?.issueLimitCents ?? null)} · Kauflimit ${euro(c?.purchaseLimitCents ?? null)} · ` +
        `Standard-Ablauf ${c?.expiration ? `${c.expiration.value} ${c.expiration.unit}` : "keiner"}`
    );
    const maxEuro = Math.max(euroEnv("GIFT_VOUCHER_MAX_EUR", 500), euroEnv("GIFT_VOUCHER_ADMIN_MAX_EUR", 250));
    if (typeof c?.issueLimitCents === "number" && c.issueLimitCents < maxEuro * 100) {
      warn(
        `Das Ausgabelimit (${euro(c.issueLimitCents)}) liegt unter dem höchsten Gutscheinwert (${euro(maxEuro * 100)}, GIFT_VOUCHER_MAX_EUR / _ADMIN_MAX_EUR) — höhere Gutscheine scheitern mit GIFT_CARD_LIMIT_EXCEEDED.`
      );
    }
  }

  // ── 7. Test card (opt-in, writes) ──────────────────────────────────────────
  if (!CREATE_TEST_CARD) {
    section("7) Testkarte");
    info(`Schreibzugriff (giftCardCreate) nicht geprüft — mit "-- ${OPTION_CREATE}" anlegen und sofort sperren.`);
    return;
  }
  section("7) Testkarte (1,00 €, wird sofort gesperrt)");
  if (!canWrite) {
    fail("Übersprungen — write_gift_cards ist nicht bestätigt (siehe 4).");
    return;
  }
  await createAndDeactivateTestCard();
}

/** Mo's code alphabet (no 0/O/1/I), unbiased with byte % 32. */
function randomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from(randomBytes(16), (b) => alphabet[b % 32]).join("");
}

/** Tomorrow in Berlin as YYYY-MM-DD — the card expires even if the deactivation failed. */
function berlinTomorrow() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(Date.now() + 86_400_000)
  );
}

async function createAndDeactivateTestCard() {
  const code = randomCode();
  const masked = maskGiftCardCode(code);
  const created = await gql(
    GIFT_CARD_CREATE_MUTATION,
    { input: { initialValue: "1.00", code, expiresOn: berlinTomorrow(), note: "Mo verify — sofort gesperrt" } },
    { secret: code }
  );
  if (created.error) {
    const failure = giftCardMutationFailure(created.error);
    const hint =
      failure.kind === "denied"
        ? SCOPE_HINT
        : failure.kind === "unknown"
          ? `Ob eine Karte entstanden ist, ist offen — im Shopify-Admin unter Geschenkgutscheine nach ${masked} (1,00 €) suchen und sie deaktivieren.`
          : "Es wurde keine Karte angelegt.";
    fail(`giftCardCreate gescheitert: ${created.error.message}`, hint);
    return;
  }
  const payload = created.data.giftCardCreate;
  const userError = classifyGiftCardUserErrors(payload?.userErrors, code);
  if (userError) {
    fail(`giftCardCreate abgelehnt (${userError.kind}): ${userError.message}`);
    return;
  }
  const card = parseGiftCardNode(payload?.giftCard);
  if (!card) {
    fail("giftCardCreate lieferte keine lesbare Karte — im Shopify-Admin prüfen und eine 1,00-€-Karte ggf. von Hand sperren.");
    return;
  }
  ok(`Karte angelegt: ${card.id} · Code ${masked} · ${euro(card.initialCents)} · gültig bis ${card.expiresOn ?? "unbegrenzt"}`);
  const echoed = normalizeGiftCardCode(payload?.giftCardCode ?? "");
  if ((echoed !== null && echoed !== code) || card.lastCharacters !== code.slice(-4)) {
    fail("Shopify hat NICHT Mos Code übernommen — der gedruckte Code würde nicht funktionieren.");
  } else {
    ok(`Shopify hat Mos Code übernommen${echoed ? "" : " (geprüft über die letzten vier Zeichen)"}`);
  }

  // The adoption path after a lost answer: find the card by its full code.
  let found = null;
  for (let attempt = 1; attempt <= 4 && !found; attempt++) {
    const search = await gql(GIFT_CARDS_BY_CODE_QUERY, { query: giftCardSearchQuery(code) }, { secret: code });
    if (search.error) {
      warn(`Suche per Code gescheitert: ${search.error.message}`);
      break;
    }
    const pick = pickGiftCardByCode(search.data.giftCards?.nodes, code);
    if (pick.card?.id === card.id) found = pick.card;
    else if (attempt < 4) await sleep(2000);
  }
  if (found) ok("Suche per Code findet die Karte (Mo kann eine Karte nach verlorener Antwort übernehmen)");
  else warn("Suche per Code hat die Karte nicht gefunden (Suchindex verzögert?) — nach einer verlorenen Antwort übernimmt Mo die Karte dann erst bei einem späteren Versuch.");

  const deactivated = await gql(GIFT_CARD_DEACTIVATE_MUTATION, { id: card.id });
  const deactivateErrors = deactivated.data?.giftCardDeactivate?.userErrors ?? [];
  if (deactivated.error || deactivateErrors.length) {
    fail(
      `SPERREN GESCHEITERT: ${deactivated.error ? deactivated.error.message : giftCardDeactivateErrorMessage(deactivateErrors)}`,
      `Bitte sofort im Shopify-Admin unter Geschenkgutscheine die Karte ${masked} (1,00 €, Notiz „Mo verify — sofort gesperrt“) deaktivieren. Sie läuft morgen ab.`
    );
    return;
  }
  ok(`Karte gesperrt (${deactivated.data.giftCardDeactivate?.giftCard?.deactivatedAt ?? "ohne Zeitstempel"})`);

  const readBack = await gql(GIFT_CARD_BY_ID_QUERY, { id: card.id });
  const after = readBack.error ? null : parseGiftCardNode(readBack.data.giftCard);
  if (!after) {
    warn(`Karte nach dem Sperren nicht lesbar${readBack.error ? `: ${readBack.error.message}` : ""}`);
    return;
  }
  if (after.enabled) fail("Die Karte ist nach dem Sperren noch aktiv — im Shopify-Admin deaktivieren.");
  info("So sieht Mo eine Karte (ShopifyGiftCardInfo, ohne Code):");
  for (const line of JSON.stringify(after, null, 2).split("\n")) info(line);
}

main()
  .catch((err) => {
    // Never print a raw error that might echo a request (the test card's code).
    fail(`Unerwarteter Fehler: ${describeAdminGraphqlError(err).message}`);
  })
  .finally(() => {
    console.log(
      errors
        ? `\nFAILURE — ${errors} Fehler, ${warnings} Hinweis(e).\n`
        : `\n${warnings ? `OK mit ${warnings} Hinweis(en)` : "SUCCESS"} — die Shopify-Seite der Geschenkgutscheine ist bereit${CREATE_TEST_CARD ? "" : " (Schreibzugriff ungeprüft)"}.\n`
    );
    process.exit(errors ? 1 : 0);
  });
