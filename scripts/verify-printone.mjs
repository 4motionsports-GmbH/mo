#!/usr/bin/env node
// Verify the print.one side of the Premium-Karte (Geschenkgutscheine, docs/GIFT_VOUCHERS.md).
//
// READ-ONLY by default — nothing is created, changed or printed, and NO secret is ever printed
// (API key, webhook secret):
//   1. env        PRINTONE_* / GIFT_VOUCHER_PRINT_* / PUBLIC_BASE_URL — values only where they are
//                 not secret; the legal gate GIFT_VOUCHER_PRINT_SENDS_APPROVED.
//   2. countries  GET /v2/countries (no key needed): every GIFT_VOUCHER_PRINT_COUNTRIES entry is
//                 supported by print.one, with its delivery time.
//   3. key        GET /v2/webhooks — answers only for a LIVE key (TEST keys and plans without
//                 webhooks get 403), so it tells the key mode; with a LIVE key it also checks that
//                 a webhook for order_status_update points at <PUBLIC_BASE_URL>/api/webhooks/printone.
//   4. template   GET /v2/templates/{PRINTONE_TEMPLATE_ID}: format GREETINGCARD_SQ14, exactly the
//                 merge variables outside_url + inside_url, two pages. Without an id: the SQ14
//                 templates of the account, to pick one.
//
// WRITING / FILE options (one at a time):
//   --create-template          POST /v2/templates: the GREETINGCARD_SQ14 template whose two pages
//                              hold nothing but a full-bleed <img> of {{outside_url}} (page 1, outside
//                              spread) and {{inside_url}} (page 2, inside spread). Prints the id →
//                              set PRINTONE_TEMPLATE_ID.
//   --test-order <outside-url> <inside-url> [--live]
//                              One order with the TEST key (PRINTONE_TEST_API_KEY when set, else
//                              PRINTONE_API_KEY) to the shop's own address. TEST orders are never
//                              printed or posted and cost nothing. A key that looks LIVE (its name
//                              says "live", or GET /v2/webhooks answers) is refused unless --live is
//                              passed — then a real proof card (≈ 3,80 €) goes to the shop. Should
//                              print.one still bill an order made without --live (isBillable true),
//                              the script cancels it at once. Prints the full response and saves the
//                              preview PDF.
//   --preview <orderId>        GET /v2/storage/order/preview/{orderId}?inline=false → saves
//                              printone-preview-<orderId>.pdf (waits while print.one renders it).
//   --test-pattern <dir>       Writes printone-testmuster-aussen.png / -innen.png (3378 × 1724 px):
//                              trim and safe lines, the fold, LINKS / RECHTS labels and the address
//                              circle as Mo expects it on BOTH outside halves. No network.
//
// HOW TO VERIFY THE PANEL GEOMETRY (before the first live card — spec §7, §10):
//   1. npm run verify:printone -- --test-pattern ./tmp
//   2. Upload both PNGs somewhere public over https (e.g. Shopify admin → Inhalte → Dateien gives
//      a cdn.shopify.com URL) — print.one's renderer must be able to load them (2xx).
//   3. npm run verify:printone -- --test-order <url-aussen> <url-innen>
//      (needs PRINTONE_TEMPLATE_ID; the script saves printone-preview-<orderId>.pdf; if print.one is
//      still rendering, fetch it later with --preview <orderId>).
//   4. In the preview PDF (page 1 = outside, page 2 = inside):
//      · FRONT SIDE: print.one prints the recipient address in a 77 mm circle on the BACK panel.
//        If that circle sits on the half labelled LINKS, the back is left and the front is right →
//        PRINTONE_FRONT_SIDE=right (default). Circle on RECHTS → PRINTONE_FRONT_SIDE=left.
//      · CIRCLE POSITION: the printed circle must lie inside the dashed Ø 77 mm circle and well
//        inside the Ø 95 mm keep-out ring the test pattern draws on that half — Mo's back panel
//        keeps exactly that area empty. If it is off-centre, the voucher back layout (P1,
//        gift-voucher-designs.mjs) must move its keep-out area accordingly.
//      · TRIM / SAFE: nothing important outside the green safe line (5 mm), the red bleed (3 mm) is
//        cut off; the page is neither rotated (the „oben“ arrow points up) nor mirrored.
//      · INSIDE: page 2 shows LINKS left (personal message) and RECHTS right (code panel).
//   5. Then the same with real voucher spreads (admin → Gutscheine → Druckdateien herunterladen),
//      and finally one --live proof card to the shop to judge paper, colours and the envelope.
//
// Scripts cannot import TypeScript: the URL / body / parsing helpers come from the tested pure
// core (src/lib/printone-core.mjs), the env readers from src/lib/gift-voucher-flags.mjs.
//
// Run: npm run verify:printone                       (read-only)
//      npm run verify:printone -- --create-template
//      npm run verify:printone -- --test-order https://…/aussen.png https://…/innen.png [--live]
//      npm run verify:printone -- --preview ord_…
//      npm run verify:printone -- --test-pattern ./tmp

import process from "node:process";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  configuredGiftVoucherPrintProvider,
  giftVoucherPrintCountries,
  isGiftVoucherPrintSendsApproved,
  printOneApiBase,
  printOneApiKey,
  printOneBillingId,
  printOneCardCostCents,
  printOneFinish,
  printOneFrontSide,
  printOneTemplateId,
  printOneWebhookSecret,
} from "../src/lib/gift-voucher-flags.mjs";
import {
  PRINTONE_SQ14_SPREAD,
  PRINTONE_TEMPLATE_FORMAT,
  buildPrintOneOrderBody,
  buildPrintOneTemplateBody,
  classifyPrintOneFailure,
  describePrintOneFailure,
  isPrintOneOrderId,
  parsePrintOneError,
  parsePrintOneOrder,
  parsePrintOneTemplate,
  printOneCancelPath,
  printOneApiUrl,
  printOneKeyLooksLive,
  printOneOrderPath,
  printOnePreviewPath,
  printOneTemplateIssues,
  publicHttpsBaseUrl,
} from "../src/lib/printone-core.mjs";
import { parsePrintOneWebhookSecrets } from "../src/lib/printone-webhook.mjs";

// ── arguments ────────────────────────────────────────────────────────────────

const MODES = ["--create-template", "--test-order", "--preview", "--test-pattern"];
const ARITY = { "--create-template": 0, "--test-order": 2, "--preview": 1, "--test-pattern": 1 };
const argv = process.argv.slice(2);
if (argv.includes("--help") || argv.includes("-h")) {
  console.log(
    "Usage: npm run verify:printone [-- <option>]\n" +
      "  (none)                                  read-only checks\n" +
      "  --create-template                       create the GREETINGCARD_SQ14 template, print its id\n" +
      "  --test-order <outside-url> <inside-url> [--live]   TEST order to the shop, saves the preview PDF\n" +
      "  --preview <orderId>                     save an order's preview PDF\n" +
      "  --test-pattern <dir>                    write the two geometry test patterns (PNG)"
  );
  process.exit(0);
}
const modes = argv.filter((a) => MODES.includes(a));
if (modes.length > 1) {
  console.error(`Nur eine Option auf einmal: ${modes.join(", ")}.`);
  process.exit(2);
}
const MODE = modes[0] ?? null;
const LIVE = argv.includes("--live");
const positional = MODE ? argv.slice(argv.indexOf(MODE) + 1).filter((a) => !a.startsWith("--")) : [];
const strays = argv.filter((a) => !a.startsWith("--")).length - positional.length;
const unknown = argv.filter((a) => a.startsWith("--") && !MODES.includes(a) && a !== "--live");
if (unknown.length || strays > 0 || (MODE && positional.length !== ARITY[MODE]) || (LIVE && MODE !== "--test-order")) {
  console.error(
    unknown.length
      ? `Unbekannte Option(en): ${unknown.join(" ")}.`
      : LIVE && MODE !== "--test-order"
        ? "--live gilt nur zusammen mit --test-order."
        : MODE
          ? `${MODE} erwartet ${ARITY[MODE]} Argument(e) direkt dahinter.`
          : "Argumente ohne Option — siehe --help."
  );
  process.exit(2);
}

// ── output ───────────────────────────────────────────────────────────────────

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
const isSet = (name) => Boolean((process.env[name] ?? "").trim());
const euro = (cents) => `${Math.floor(cents / 100)},${String(cents % 100).padStart(2, "0")} €`;
const size = (bytes) => (bytes < 1024 ? `${bytes} B` : `${Math.round(bytes / 1024)} KB`);

// ── HTTP ─────────────────────────────────────────────────────────────────────

const API_BASE = printOneApiBase();

/** One print.one request; never throws. `pdf`: read the body as bytes. */
async function api(method, pathname, { key = null, body, idempotencyKey, query, timeoutMs = 20_000, pdf = false } = {}) {
  const headers = { Accept: pdf ? "application/pdf" : "application/json" };
  if (key) headers["x-api-key"] = key;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    const res = await fetch(printOneApiUrl(API_BASE, pathname, query), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: abort.signal,
      redirect: "error",
    });
    if (pdf && res.ok) return { ok: true, status: res.status, bytes: Buffer.from(await res.arrayBuffer()) };
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (res.ok) return { ok: true, status: res.status, json };
    return { ok: false, status: res.status, error: parsePrintOneError(res.status, json ?? text) };
  } catch (err) {
    return { ok: false, status: null, error: parsePrintOneError(null, null), cause: String(err?.message ?? err) };
  } finally {
    clearTimeout(timer);
  }
}

/** The German description of a failed call (print.one's own messages included — the maintainer's terminal only). */
function describe(res, op) {
  const text = describePrintOneFailure(classifyPrintOneFailure(res.error, op), res.error, op);
  return res.cause ? `${text} (${res.cause})` : text;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ── 1. environment ───────────────────────────────────────────────────────────

const KEY = printOneApiKey();
const TEMPLATE_ID = printOneTemplateId();
const BASE_URL = publicHttpsBaseUrl(process.env.PUBLIC_BASE_URL);

function printEnv() {
  console.log(`\nprint.one — Prüfung der Premium-Karte (API ${API_BASE})`);
  section("1. Umgebung");
  // The read-only check judges the whole setup; an action (--create-template, --test-order,
  // --preview) only needs its own inputs, so the app-level gaps are hints there.
  const appGap = MODE ? (msg, hint) => warn(hint ? `${msg} — ${hint}` : msg) : fail;
  if (KEY) ok(`PRINTONE_API_KEY gesetzt${printOneKeyLooksLive(KEY) ? " (Name deutet auf einen LIVE-Schlüssel)" : ""}`);
  else appGap("PRINTONE_API_KEY fehlt", "portal.print.one → API keys; erst einen TEST-Schlüssel, später LIVE.");
  if (isSet("PRINTONE_TEST_API_KEY")) ok("PRINTONE_TEST_API_KEY gesetzt (nur für --test-order)");
  if (TEMPLATE_ID) ok(`PRINTONE_TEMPLATE_ID = ${TEMPLATE_ID}`);
  else warn("PRINTONE_TEMPLATE_ID fehlt — `npm run verify:printone -- --create-template` legt die Vorlage an.");
  const secrets = parsePrintOneWebhookSecrets(printOneWebhookSecret()).length;
  if (secrets > 0) ok(`PRINTONE_WEBHOOK_SECRET: ${secrets} Secret(s)`);
  else warn("PRINTONE_WEBHOOK_SECRET fehlt — /api/webhooks/printone antwortet 503, Status kommen nur per Abfrage (stündlich).");
  info(`Papier ${printOneFinish()} · Kostenstelle „${printOneBillingId()}“ · Schätzung ${euro(printOneCardCostCents())} je Karte · Vorderseite ${printOneFrontSide() === "right" ? "rechts" : "links"} (PRINTONE_FRONT_SIDE)`);
  if (BASE_URL) ok(`PUBLIC_BASE_URL = ${BASE_URL} → Druckdateien unter ${BASE_URL}/api/gift-vouchers/print-asset/…`);
  else appGap("PUBLIC_BASE_URL fehlt oder ist keine https-Adresse", "print.one muss die Druckdateien öffentlich laden können.");
  for (const name of ["BLOB_READ_WRITE_TOKEN", "TOKEN_ENC_KEY"]) {
    if (isSet(name)) ok(`${name} gesetzt`);
    else appGap(`${name} fehlt`, name === "BLOB_READ_WRITE_TOKEN" ? "Druckdateien werden im privaten Blob-Speicher abgelegt." : "Ohne ihn ist der Gutscheincode nicht lesbar.");
  }
  const provider = configuredGiftVoucherPrintProvider();
  info(`GIFT_VOUCHER_PRINT_PROVIDER = ${provider}${provider === "manual" ? " (Druck von Hand — print.one wird nicht beauftragt)" : ""}`);
  info(`GIFT_VOUCHER_PRINT_COUNTRIES = ${giftVoucherPrintCountries().join(", ")}`);
  if (isGiftVoucherPrintSendsApproved()) ok("GIFT_VOUCHER_PRINT_SENDS_APPROVED = true — Adressen gehen an print.one (AV-Vertrag muss vorliegen).");
  else warn("GIFT_VOUCHER_PRINT_SENDS_APPROVED ist aus (Standard) — Druckaufträge warten in der Admin-Warteschlange.");
}

// ── 2.–4. read-only checks ───────────────────────────────────────────────────

async function checkCountries() {
  section("2. Länder (GET /v2/countries)");
  const res = await api("GET", "/v2/countries", { timeoutMs: 15_000 });
  if (!res.ok) return fail(`Länderliste nicht lesbar — ${describe(res, "read")}`);
  const list = Array.isArray(res.json) ? res.json : [];
  for (const code of giftVoucherPrintCountries()) {
    const c = list.find((x) => x && x.iso31661Alpha2 === code);
    if (!c) fail(`${code}: print.one kennt das Land nicht`);
    else if (c.supported !== true) fail(`${code} (${c.nativeName ?? c.englishName}): print.one versendet nicht dorthin`);
    else ok(`${code} (${c.nativeName ?? c.englishName}) unterstützt · Region ${c.region ?? "?"} · Laufzeit ${c.internationalDuration ?? "?"} Tage`);
  }
}

/** GET /v2/webhooks answers only for LIVE keys → "live" | "not_live" | "invalid" | "unknown". */
async function probeKeyMode(key) {
  const res = await api("GET", "/v2/webhooks", { key, timeoutMs: 15_000 });
  if (res.ok) return { mode: "live", webhooks: Array.isArray(res.json) ? res.json : Array.isArray(res.json?.data) ? res.json.data : [] };
  if (res.status === 401) return { mode: "invalid", res };
  if (res.status === 403) return { mode: "not_live", res };
  return { mode: "unknown", res };
}

async function checkKey() {
  section("3. API-Schlüssel (GET /v2/webhooks)");
  if (!KEY) return fail("Ohne PRINTONE_API_KEY keine Prüfung möglich.");
  const probe = await probeKeyMode(KEY);
  if (probe.mode === "invalid") return fail("print.one lehnt PRINTONE_API_KEY ab (401).", "Schlüssel im Portal prüfen / neu anlegen.");
  if (probe.mode === "unknown") return warn(`Schlüsselart nicht feststellbar — ${describe(probe.res, "read")}`);
  if (probe.mode === "not_live") {
    ok("Schlüssel gültig für print.one; Webhooks nicht lesbar (403) → TEST-Schlüssel oder Tarif ohne Webhooks.");
    info("TEST-Aufträge werden nie gedruckt. Vor dem Livegang einen LIVE-Schlüssel eintragen.");
    return;
  }
  ok("LIVE-Schlüssel — Aufträge werden gedruckt, verschickt und vom Guthaben abgebucht.");
  const target = BASE_URL ? `${BASE_URL}/api/webhooks/printone` : null;
  const hooks = probe.webhooks.filter((w) => w && typeof w.url === "string");
  for (const w of hooks) info(`Webhook „${w.name ?? w.id}“ → ${w.url} · ${w.active ? "aktiv" : "inaktiv"} · ${(w.events ?? []).join(", ")}`);
  const ours = target ? hooks.find((w) => w.url.replace(/\/+$/, "") === target) : null;
  if (!ours) warn(`Kein Webhook auf ${target ?? "<PUBLIC_BASE_URL>/api/webhooks/printone"} — im Portal unter Integrate → Webhooks anlegen (Event order_status_update).`);
  else if (!ours.active || !(ours.events ?? []).includes("order_status_update")) warn("Der Mo-Webhook ist inaktiv oder ohne order_status_update.");
  else ok("Mo-Webhook für order_status_update ist eingerichtet.");
}

async function readTemplate(key, id) {
  const direct = await api("GET", `/v2/templates/${encodeURIComponent(id)}`, { key, timeoutMs: 15_000 });
  if (direct.ok || direct.status !== 404) return direct;
  // Some setups only answer with an explicit version: read the version list, take the newest.
  const versions = await api("GET", `/v2/templates/${encodeURIComponent(id)}/versions`, { key, timeoutMs: 15_000 });
  if (!versions.ok) return direct;
  const list = Array.isArray(versions.json) ? versions.json : Array.isArray(versions.json?.data) ? versions.json.data : [];
  const numbers = list.map((v) => Number(typeof v === "object" && v ? v.version : v)).filter(Number.isFinite);
  if (numbers.length === 0) return direct;
  return api("GET", `/v2/templates/${encodeURIComponent(id)}/${Math.max(...numbers)}`, { key, timeoutMs: 15_000 });
}

async function checkTemplate() {
  section(`4. Vorlage (${PRINTONE_TEMPLATE_FORMAT})`);
  if (!KEY) return fail("Ohne PRINTONE_API_KEY keine Prüfung möglich.");
  if (!TEMPLATE_ID) {
    const res = await api("GET", "/v2/templates", { key: KEY, query: { page: "1", limit: "50" }, timeoutMs: 15_000 });
    if (!res.ok) return warn(`Vorlagen nicht lesbar — ${describe(res, "list")}`);
    const rows = (Array.isArray(res.json?.data) ? res.json.data : []).filter((t) => t && t.format === PRINTONE_TEMPLATE_FORMAT);
    if (rows.length === 0) return warn("Keine SQ14-Vorlage im Konto — mit --create-template anlegen.");
    for (const t of rows) info(`${t.id} · „${t.name ?? ""}“ · Variablen ${(t.mergeVariables ?? []).join(", ") || "–"}`);
    return warn("PRINTONE_TEMPLATE_ID auf eine Vorlage mit genau outside_url + inside_url setzen.");
  }
  const res = await readTemplate(KEY, TEMPLATE_ID);
  if (!res.ok) return fail(`Vorlage ${TEMPLATE_ID} nicht lesbar — ${describe(res, "read")}`, "PRINTONE_TEMPLATE_ID prüfen (TEST- und LIVE-Schlüssel sehen dieselben Vorlagen?).");
  const template = parsePrintOneTemplate(res.json);
  const issues = printOneTemplateIssues(template);
  if (issues.length === 0) ok(`Vorlage ${template.id} „${template.name ?? ""}“ (Version ${template.version ?? "?"}) passt: ${PRINTONE_TEMPLATE_FORMAT}, outside_url + inside_url, ${template.pages ?? "?"} Seiten.`);
  for (const issue of issues) fail(issue, "Mit --create-template eine passende Vorlage anlegen und PRINTONE_TEMPLATE_ID umstellen.");
}

// ── --create-template ────────────────────────────────────────────────────────

async function createTemplate() {
  section("Vorlage anlegen (POST /v2/templates)");
  if (!KEY) return fail("PRINTONE_API_KEY fehlt.");
  if (TEMPLATE_ID) warn(`PRINTONE_TEMPLATE_ID ist schon gesetzt (${TEMPLATE_ID}) — es wird eine ZUSÄTZLICHE Vorlage angelegt.`);
  const res = await api("POST", "/v2/templates", { key: KEY, body: buildPrintOneTemplateBody(), timeoutMs: 30_000 });
  if (!res.ok) return fail(`Anlegen fehlgeschlagen — ${describe(res, "create")}`);
  const template = parsePrintOneTemplate(res.json);
  if (!template) return fail("print.one hat ohne Vorlagen-ID geantwortet.", JSON.stringify(res.json).slice(0, 300));
  ok(`Vorlage angelegt: ${template.id} (Version ${template.version ?? "?"}, Format ${template.format ?? "?"}, Variablen ${template.mergeVariables.join(", ") || "–"}).`);
  for (const issue of printOneTemplateIssues(template)) warn(issue);
  console.log(`\n  In .env / Vercel eintragen:\n\n    PRINTONE_TEMPLATE_ID=${template.id}\n`);
  info("Dann die Geometrie mit --test-pattern und --test-order prüfen (siehe Kopf dieses Skripts).");
}

// ── --test-order ─────────────────────────────────────────────────────────────

/** The shop's own address (GIFT_VOUCHER_ISSUER_LINE default) — a --live proof card goes there. */
const SAMPLE_ADDRESS = {
  name: "4motionsports GmbH · Mo Testkarte",
  address_line_1: "Am Weidegrund 1",
  address_line_2: null,
  postal_code: "82194",
  city: "Gröbenzell",
  country: "DE",
};

/** An https URL on a public host (print.one's renderer cannot reach localhost). */
function isPublicHttpsUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(u.hostname) && !u.username && !u.password;
  } catch {
    return false;
  }
}

async function checkImageUrl(url, label) {
  if (!isPublicHttpsUrl(url)) {
    fail(`${label}: keine öffentliche https-Adresse (${url})`);
    return false;
  }
  if (!/\.(png|jpe?g)(\?|#|$)/i.test(url)) warn(`${label}: Endung ist nicht .png / .jpg — print.one braucht ein Rasterbild.`);
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 15_000);
  try {
    const res = await fetch(url, { method: "GET", signal: abort.signal });
    const type = res.headers.get("content-type") ?? "?";
    const bytes = Buffer.from(await res.arrayBuffer()).length;
    if (!res.ok) {
      fail(`${label}: HTTP ${res.status} — print.one würde den Auftrag scheitern lassen.`);
      return false;
    }
    if (!/^image\/(png|jpeg)/i.test(type)) warn(`${label}: Content-Type ${type} (erwartet image/png oder image/jpeg).`);
    ok(`${label}: HTTP ${res.status}, ${type}, ${size(bytes)}`);
    return true;
  } catch (err) {
    fail(`${label}: nicht ladbar (${String(err?.message ?? err)})`);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function cancelRightAway(key, orderId) {
  const cancelPath = printOneCancelPath(orderId);
  for (let i = 0; i < 10 && cancelPath; i++) {
    const res = await api("POST", cancelPath, { key, body: {}, timeoutMs: 15_000 });
    if (res.ok) return ok(`Auftrag ${orderId} storniert.`);
    if (classifyPrintOneFailure(res.error, "cancel") !== "not_cancellable_yet") {
      return fail(`Stornieren fehlgeschlagen — ${describe(res, "cancel")}`, `Sofort im print.one-Portal stornieren: ${orderId}`);
    }
    await sleep(3000);
  }
  fail(`print.one ließ den Auftrag noch nicht stornieren.`, `Sofort im print.one-Portal stornieren: ${orderId}`);
}

async function savePreview(key, orderId, { waitMs = 60_000 } = {}) {
  const previewPath = printOnePreviewPath(orderId);
  if (!previewPath) return fail(`Ungültige Auftragsnummer: ${orderId}`);
  const until = Date.now() + waitMs;
  for (;;) {
    const res = await api("GET", previewPath, { key, query: { inline: "false" }, timeoutMs: 30_000, pdf: true });
    if (res.ok) {
      const file = path.resolve(`printone-preview-${orderId}.pdf`);
      await writeFile(file, res.bytes);
      return ok(`Vorschau gespeichert: ${file} (${size(res.bytes.length)})`);
    }
    if (res.status === 410) return fail("Die Vorschau ist bei print.one nicht mehr verfügbar (410).");
    if (res.status !== 404 || Date.now() > until) {
      return warn(
        res.status === 404
          ? `Die Vorschau wird noch erzeugt — später: npm run verify:printone -- --preview ${orderId}`
          : `Vorschau nicht ladbar — ${describe(res, "read")}`
      );
    }
    await sleep(5000);
  }
}

async function testOrder(outsideUrl, insideUrl) {
  section(LIVE ? "LIVE-Probekarte (POST /v2/orders)" : "TEST-Auftrag (POST /v2/orders)");
  const key = (process.env.PRINTONE_TEST_API_KEY ?? "").trim() || KEY;
  if (!key) return fail("Kein Schlüssel: PRINTONE_TEST_API_KEY oder PRINTONE_API_KEY setzen.");
  if (!TEMPLATE_ID) return fail("PRINTONE_TEMPLATE_ID fehlt — zuerst --create-template.");
  const probe = await probeKeyMode(key);
  if (probe.mode === "invalid") return fail("print.one lehnt den Schlüssel ab (401).");
  const looksLive = printOneKeyLooksLive(key) || probe.mode === "live";
  if (looksLive && !LIVE) {
    return fail(
      "Der Schlüssel sieht nach einem LIVE-Schlüssel aus — ein Auftrag würde gedruckt, verschickt und berechnet.",
      "PRINTONE_TEST_API_KEY mit einem TEST-Schlüssel setzen, oder bewusst --live anhängen (Probekarte an den Shop)."
    );
  }
  if (LIVE) warn(`--live: eine echte Karte (≈ ${euro(printOneCardCostCents())}) geht an ${SAMPLE_ADDRESS.address_line_1}, ${SAMPLE_ADDRESS.postal_code} ${SAMPLE_ADDRESS.city}.`);
  const okOutside = await checkImageUrl(outsideUrl, "Außen-Bild");
  const okInside = await checkImageUrl(insideUrl, "Innen-Bild");
  if (!okOutside || !okInside) return;

  const built = buildPrintOneOrderBody({
    templateId: TEMPLATE_ID,
    finish: printOneFinish(),
    billingId: "Mo Test",
    address: SAMPLE_ADDRESS,
    outsideUrl,
    insideUrl,
  });
  if (!built.ok) return fail(`Auftrag nicht baubar (${built.reason}).`);
  const res = await api("POST", "/v2/orders", {
    key,
    body: built.body,
    idempotencyKey: `mo-verify-${randomBytes(8).toString("hex")}`,
    timeoutMs: 30_000,
  });
  if (!res.ok) return fail(`Auftrag abgelehnt — ${describe(res, "create")}`);
  console.log("\n  Antwort von print.one:\n");
  console.log(
    JSON.stringify(res.json, null, 2)
      .split("\n")
      .map((l) => `    ${l}`)
      .join("\n")
  );
  const order = parsePrintOneOrder(res.json);
  if (!order) return fail("Antwort ohne Auftragsnummer.");
  ok(`Auftrag ${order.id}: ${order.status ?? "?"} (${order.friendlyStatus ?? "?"}), isBillable ${order.isBillable}`);
  for (const e of order.errors) fail(`print.one-Fehler: ${e}`);
  for (const w of order.warnings) warn(`print.one-Hinweis: ${w}`);
  if (order.isBillable === true && !LIVE) {
    fail("print.one berechnet diesen Auftrag (isBillable true) — er wird sofort storniert.");
    await cancelRightAway(key, order.id);
    return;
  }
  section("Vorschau (GET /v2/storage/order/preview)");
  await savePreview(key, order.id);
  info("Geometrie prüfen wie im Kopf dieses Skripts beschrieben (Vorderseite, Adresskreis, Beschnitt, Innenseite).");
  if (printOneOrderPath(order.id)) info(`Status später: GET ${API_BASE}${printOneOrderPath(order.id)}`);
}

// ── --preview ────────────────────────────────────────────────────────────────

async function previewOnly(orderId) {
  section("Vorschau (GET /v2/storage/order/preview)");
  const key = (process.env.PRINTONE_TEST_API_KEY ?? "").trim() || KEY;
  if (!key) return fail("Kein Schlüssel gesetzt.");
  if (!isPrintOneOrderId(orderId)) return fail(`Ungültige Auftragsnummer: ${orderId}`);
  await savePreview(key, orderId, { waitMs: 90_000 });
}

// ── --test-pattern ───────────────────────────────────────────────────────────

function testPatternSvg(side) {
  const { widthPx: W, heightPx: H, bleedPx: B, foldX, addressCirclePx } = PRINTONE_SQ14_SPREAD;
  const SAFE = B + Math.round((5 / 25.4) * 300); // 5 mm inside the trim line
  const keepOut = Math.round((95 / 25.4) * 300); // the Ø 95 mm area Mo keeps empty
  const halves = [
    { x: 0, label: "LINKS" },
    { x: foldX, label: "RECHTS" },
  ];
  const title = side === "outside" ? "AUSSEN · Seite 1" : "INNEN · Seite 2";
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`,
    `<rect width="${W}" height="${H}" fill="#f6c7c7"/>`,
    `<rect x="${B}" y="${B}" width="${W - 2 * B}" height="${H - 2 * B}" fill="#ffffff" stroke="#d00000" stroke-width="4" stroke-dasharray="24 12"/>`,
    `<rect x="${SAFE}" y="${SAFE}" width="${W - 2 * SAFE}" height="${H - 2 * SAFE}" fill="none" stroke="#008a00" stroke-width="4" stroke-dasharray="12 12"/>`,
    `<line x1="${foldX}" y1="0" x2="${foldX}" y2="${H}" stroke="#008ccb" stroke-width="6" stroke-dasharray="30 15"/>`,
    `<text x="${foldX + 20}" y="${H - 60}" font-family="sans-serif" font-size="44" fill="#008ccb">Falz</text>`,
    `<text x="${B + 20}" y="${B + 60}" font-family="sans-serif" font-size="40" fill="#d00000">Beschnitt 3 mm (rot) · Sicherheitsabstand 5 mm (grün)</text>`,
  ];
  for (const h of halves) {
    const cx = h.x + foldX / 2;
    const cy = H / 2;
    parts.push(`<text x="${cx}" y="${SAFE + 150}" text-anchor="middle" font-family="sans-serif" font-size="90" font-weight="700" fill="#111">${title}</text>`);
    parts.push(`<text x="${cx}" y="${H - SAFE - 30}" text-anchor="middle" font-family="sans-serif" font-size="150" font-weight="800" fill="#111">${h.label}</text>`);
    const ax = h.x + SAFE + 70;
    parts.push(`<path d="M ${ax} ${SAFE + 90} l -45 80 h 90 z" fill="#111"/><text x="${ax + 70}" y="${SAFE + 165}" font-family="sans-serif" font-size="44" fill="#111">oben</text>`);
    if (side === "outside") {
      parts.push(`<circle cx="${cx}" cy="${cy}" r="${keepOut / 2}" fill="#fff6d6" stroke="#b58900" stroke-width="4" stroke-dasharray="16 10"/>`);
      parts.push(`<circle cx="${cx}" cy="${cy}" r="${addressCirclePx / 2}" fill="none" stroke="#111" stroke-width="5" stroke-dasharray="20 12"/>`);
      parts.push(`<text x="${cx}" y="${cy + 15}" text-anchor="middle" font-family="sans-serif" font-size="48" fill="#111">Adresskreis Ø 77 mm hier?</text>`);
      parts.push(`<text x="${cx}" y="${cy + 80}" text-anchor="middle" font-family="sans-serif" font-size="36" fill="#7a5c00">frei gehalten Ø 95 mm</text>`);
    } else {
      parts.push(`<text x="${cx}" y="${cy}" text-anchor="middle" font-family="sans-serif" font-size="60" fill="#111">${h.label === "LINKS" ? "Persönliche Nachricht" : "Gutscheincode + QR"}</text>`);
    }
  }
  parts.push("</svg>");
  return parts.join("");
}

async function writeTestPattern(dir) {
  section("Testmuster schreiben");
  let sharp;
  try {
    sharp = (await import("sharp")).default;
  } catch {
    return fail("sharp ist nicht installiert (npm install im Projekt ausführen).");
  }
  const target = path.resolve(dir);
  await mkdir(target, { recursive: true });
  for (const [side, name] of [
    ["outside", "printone-testmuster-aussen.png"],
    ["inside", "printone-testmuster-innen.png"],
  ]) {
    const file = path.join(target, name);
    await sharp(Buffer.from(testPatternSvg(side))).png().withMetadata({ density: PRINTONE_SQ14_SPREAD.dpi }).toFile(file);
    ok(`${file} (${PRINTONE_SQ14_SPREAD.widthPx} × ${PRINTONE_SQ14_SPREAD.heightPx} px)`);
  }
  info("Beide Dateien öffentlich (https) hochladen, dann: npm run verify:printone -- --test-order <url-aussen> <url-innen>");
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (MODE === "--test-pattern") {
    await writeTestPattern(positional[0]);
  } else {
    printEnv();
    if (MODE === "--create-template") await createTemplate();
    else if (MODE === "--test-order") await testOrder(positional[0], positional[1]);
    else if (MODE === "--preview") await previewOnly(positional[0]);
    else {
      await checkCountries();
      await checkKey();
      await checkTemplate();
    }
  }
  console.log(
    errors > 0
      ? `\nFAILURE — ${errors} Fehler, ${warnings} Hinweis(e).\n`
      : `\n${warnings > 0 ? `OK mit ${warnings} Hinweis(en).` : "OK."}${MODE ? "" : " Nichts wurde angelegt oder gedruckt."}\n`
  );
  process.exit(errors > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("\nFAILURE: unerwarteter Fehler:", err?.message ?? err);
  process.exit(1);
});
