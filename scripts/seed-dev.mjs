#!/usr/bin/env node
// scripts/seed-dev.mjs — fill a LOCAL development database with realistic,
// deterministic German demo data so every admin tab (/admin) shows content.
//
// What it seeds (mirroring the value conventions of the canonical writers in
// src/lib/*-store.ts — status strings, JSON column shapes, event names, FKs):
//   conversations + messages (tool rows as persistTurn writes them),
//   customer_session_links, kpi_events (the whole funnel the KPI tab counts),
//   ai_usage (chat + admin call sites, several model ids),
//   kpi_persona_question_summaries, conversation_insights (per-window rollups),
//   customers, email_captures, suppression_list, marketing_sends, bundle_offers,
//   email_messages, physical_letters,
//   campaign_contacts, campaign_drafts, campaign_sends (incl. 0054/0055 columns),
//   feedback, qa_entries, analytics_reports, improvement_runs,
//   improvement_suggestions, mo_directives, mo_directive_versions,
//   email_design_selections, mo_attribution_tokens, mo_orders, admin_access_log.
//
// NOT touched: _migrations (schema tracker), customer_oauth_tokens,
// customer_auth_pending, customer_merge_conflicts.
//
// Deterministic: a seeded PRNG + a fixed date anchor (2026-09-08) mean a re-run
// produces the same rows. Dates spread over the ~120 days before the anchor,
// with rows in the last 7 days and on the anchor day itself.
//
// ⚠  SAFETY: refuses to run unless the connection string points at
//    localhost / 127.0.0.1 / ::1 — or `--i-know-this-is-not-production` is passed.
//
// Usage:
//   node --env-file=.env.local scripts/seed-dev.mjs --reset
//     --reset                          TRUNCATE the seeded tables first
//                                      (RESTART IDENTITY CASCADE); without it the
//                                      script refuses when they hold rows.
//     --anchor=YYYY-MM-DD              override the fixed date anchor
//     --i-know-this-is-not-production  allow a non-local database host
//
// Connection string: DATABASE_URL_UNPOOLED || POSTGRES_URL_NON_POOLING ||
// DATABASE_URL || POSTGRES_URL. With NEON_FETCH_ENDPOINT set, the Neon HTTP
// driver is pointed at the local proxy (same switch as src/lib/db.ts).

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { neon, neonConfig } from "@neondatabase/serverless";

if (process.env.NEON_FETCH_ENDPOINT) {
  neonConfig.fetchEndpoint = process.env.NEON_FETCH_ENDPOINT;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const CATALOG_PATH = join(__dirname, "..", "src", "data", "product-catalog.json");

// ─── CLI ──────────────────────────────────────────────────────────────────────

const args = new Set(process.argv.slice(2).filter((a) => !a.startsWith("--anchor=")));
const anchorArg = process.argv.slice(2).find((a) => a.startsWith("--anchor="));
const RESET = args.has("--reset");
const ALLOW_REMOTE = args.has("--i-know-this-is-not-production");
const ANCHOR_YMD = anchorArg ? anchorArg.slice("--anchor=".length) : "2026-09-08";
if (!/^\d{4}-\d{2}-\d{2}$/.test(ANCHOR_YMD)) {
  console.error(`[seed-dev] Invalid --anchor value "${ANCHOR_YMD}" (expected YYYY-MM-DD).`);
  process.exit(1);
}

// ─── Connection string + safety gate ──────────────────────────────────────────

function connectionString() {
  return (
    process.env.DATABASE_URL_UNPOOLED ||
    process.env.POSTGRES_URL_NON_POOLING ||
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL
  );
}

const cs = connectionString();
if (!cs) {
  console.error(
    "[seed-dev] No Postgres connection string found.\n" +
      "  Set DATABASE_URL (or DATABASE_URL_UNPOOLED / POSTGRES_URL) in your env file.\n"
  );
  process.exit(1);
}

let dbHost = "(unknown)";
let dbName = "(unknown)";
try {
  const u = new URL(cs.replace(/^postgres:\/\//, "postgresql://"));
  dbHost = u.hostname;
  dbName = u.pathname.replace(/^\//, "") || "(unknown)";
} catch {
  // keep "(unknown)" — the local-host check below then fails closed
}
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
if (!LOCAL_HOSTS.has(dbHost) && !ALLOW_REMOTE) {
  console.error(
    "\n[seed-dev] ABORTED — safety gate triggered.\n\n" +
      `  The database host is "${dbHost}" (db "${dbName}"), which is not a local host.\n` +
      "  This script TRUNCATEs and refills ~30 tables with demo data and is meant\n" +
      "  for a LOCAL development database only. If you really want to seed this\n" +
      "  database, re-run with --i-know-this-is-not-production.\n"
  );
  process.exit(1);
}

// ─── Deterministic PRNG (mulberry32) ──────────────────────────────────────────

let prngState = 0x5eed2026;
function rand() {
  prngState |= 0;
  prngState = (prngState + 0x6d2b79f5) | 0;
  let t = Math.imul(prngState ^ (prngState >>> 15), 1 | prngState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
/** Integer in [min, max] (inclusive). */
function int(min, max) {
  return min + Math.floor(rand() * (max - min + 1));
}
function pick(arr) {
  return arr[Math.floor(rand() * arr.length)];
}
function chance(p) {
  return rand() < p;
}
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
/** Deterministic pseudo-random hex string of `n` chars. */
function hex(n) {
  let s = "";
  while (s.length < n) s += Math.floor(rand() * 16).toString(16);
  return s;
}
/** Deterministic base64url token (the /api/r/<token> shape: 24 bytes → 32 chars). */
function urlToken(bytes = 24) {
  const buf = Buffer.alloc(bytes);
  for (let i = 0; i < bytes; i++) buf[i] = Math.floor(rand() * 256);
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function sha256(s) {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

// ─── Dates (all UTC, relative to the fixed anchor) ────────────────────────────

const DAY_MS = 86_400_000;
const ANCHOR = new Date(`${ANCHOR_YMD}T12:00:00.000Z`);

/** ISO timestamp `days` days before the anchor at a given UTC hour (fractional ok). */
function at(daysAgo, hourUtc = 10, minute = 0) {
  const d = new Date(ANCHOR.getTime() - daysAgo * DAY_MS);
  d.setUTCHours(Math.floor(hourUtc), Math.floor(minute + (hourUtc % 1) * 60), int(0, 59), 0);
  return d.toISOString();
}
/** A shop-hours timestamp (06:00–20:00 UTC) `daysAgo` days before the anchor. */
function shopTime(daysAgo) {
  return at(daysAgo, int(6, 20), int(0, 59));
}
function addMs(iso, ms) {
  return new Date(new Date(iso).getTime() + ms).toISOString();
}
function addDays(iso, days) {
  return addMs(iso, days * DAY_MS);
}
function ymd(iso) {
  return iso.slice(0, 10);
}
function ymdDaysAgo(days) {
  return ymd(new Date(ANCHOR.getTime() - days * DAY_MS).toISOString());
}
/** Days-ago sample weighted towards recent activity (0 = the anchor day). */
function weightedDaysAgo() {
  const r = rand();
  if (r < 0.1) return int(0, 2);
  if (r < 0.45) return int(0, 29);
  if (r < 0.7) return int(30, 59);
  if (r < 0.9) return int(60, 89);
  return int(90, 118);
}
function germanDate(iso) {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getUTCDate())}.${p(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`;
}

// ─── DB helpers ───────────────────────────────────────────────────────────────

const sql = neon(cs);

/**
 * Chunked multi-row INSERT. `casts` maps a column to a Postgres cast
 * (e.g. { data: "jsonb", created_at: "timestamptz", ids: "text[]" }). JSON
 * columns take a JSON string; arrays are passed as JS arrays.
 */
async function insertRows(table, columns, rows, { casts = {}, returning = null, chunk = 150 } = {}) {
  const out = [];
  for (let i = 0; i < rows.length; i += chunk) {
    const slice = rows.slice(i, i + chunk);
    const params = [];
    const values = slice.map((row) => {
      const ph = columns.map((c) => {
        params.push(row[c] === undefined ? null : row[c]);
        return `$${params.length}${casts[c] ? `::${casts[c]}` : ""}`;
      });
      return `(${ph.join(", ")})`;
    });
    const text =
      `INSERT INTO ${table} (${columns.join(", ")}) VALUES ${values.join(", ")}` +
      (returning ? ` RETURNING ${returning}` : "");
    const res = await sql.query(text, params);
    if (returning) out.push(...res);
  }
  return out;
}

const json = (v) => (v == null ? null : JSON.stringify(v));

// ─── Catalog ──────────────────────────────────────────────────────────────────

const catalog = JSON.parse(readFileSync(CATALOG_PATH, "utf8"));
const catalogById = new Map(catalog.map((p) => [p.id, p]));

/** Resolve a catalog id; fall back to the first in-stock product of `category`
 *  (sorted by id) when the preferred id no longer exists, so a catalog refresh
 *  never breaks the seed. */
function product(id, fallbackCategory) {
  const p = catalogById.get(id);
  if (p) return p;
  const alt = catalog
    .filter((x) => x.category === fallbackCategory && x.inStock && !x.hideFromSearch)
    .sort((a, b) => a.id.localeCompare(b.id))[0];
  if (!alt) throw new Error(`[seed-dev] catalog has neither "${id}" nor any "${fallbackCategory}" product`);
  console.warn(`[seed-dev] catalog id "${id}" missing — using "${alt.id}" instead`);
  return alt;
}
const productName = (id) => catalogById.get(id)?.name ?? id;
const productPrice = (id) => {
  const p = catalogById.get(id);
  return p ? Number(p.salePrice ?? p.price ?? 0) : 0;
};
/** Synthetic numeric Shopify variant id (the bundled catalog carries none). */
const variantIdFor = (id) => String(46000000000000 + (parseInt(sha256(id).slice(0, 8), 16) % 900000000));
const cartUrlFor = (ids, code) =>
  `https://motionsports.de/cart/${ids.map((id) => `${variantIdFor(id)}:1`).join(",")}` +
  (code ? `?discount=${code}` : "");

// The product sets each consultation theme draws from (verified catalog ids;
// each has a category fallback for robustness).
const P = {
  benchFold: product("atx®-hantelbank-klappbar-schwarz-silber", "Exercise Benches").id,
  hexSet: product("hexagon-hanteln-hantelsatze-gummi", "Dumbbells").id,
  loopBands: product("atx®-loop-band-widerstandsbander-in-5-zugkraftstarken", "Exercise Bands & Loops").id,
  matFitline: product("airex®-gymnastikmatte-fitline-180-x-60-cm", "Gym Mats").id,
  rack510: product("atx®-power-rack-prx-510-mit-flip-down-spotter-hohe-195-cm", "Power Racks").id,
  rack780: product("atx®-power-rack-prx-780", "Power Racks").id,
  bar20: product("atx®-training-bar-20-kg-chrome", "Barbells & Weightlifting Bars").id,
  bumperClub: product("atx®-barbell-club-bumper-plates-5-bis-25-kg", "Weight Plates").id,
  benchHeavy: product("atx®-flat-bench-heavy-weight", "Exercise Benches").id,
  floorMat: product("bodenschutzmatte-excellence-1000-x-1000-x-15-mm", "Floor Protection Mats").id,
  floorMatStd: product("bodenschutzmatte-standard-1000-x-1000-x-20-mm", "Floor Protection Mats").id,
  treadmill50: product("horizon-fitness-5-0at-laufband", "Treadmills").id,
  treadmillOmega: product("horizon-fitness-omega-z-laufband", "Treadmills").id,
  rowerg: product("concept2-rowerg-rudergerat", "Rowing Machines").id,
  rowergMat: product("concept2-rowerg-unterlegmatte", "Floor Protection Mats").id,
  waterA1: product("rudergerat-waterrower-a1", "Rowing Machines").id,
  waterOak: product("rudergerat-waterrower-eiche", "Rowing Machines").id,
  kettlebell: product("atx®-kettlebell-guss-von-8-bis-48-kg", "Kettlebells").id,
  kettlebellAdj: product("kettlebell-verstellbar-6-bis-16-kg", "Kettlebells").id,
  trxHome: product("trx-schlingentrainer-home-2", "Suspension Trainers").id,
  yogaStart: product("airex®-yogamatte-calyana-start-185-x-65-cm", "Yoga & Pilates Mats").id,
  theraband: product("theraband-5-50-m", "Exercise Bands & Loops").id,
  balancePad: product("airex®-balance-pad", "Balance Pads").id,
  coronella: product("airex®-gymnastikmatte-coronella-185-x-60-cm-mit-osen", "Gym Mats").id,
  gymBall: product("gymnastikball-professional-55-65-75-cm", "Exercise Balls").id,
  miniBandMed: product("mini-band-medical-5-zugstarken", "Exercise Bands & Loops").id,
  rig700: product("atx®-functional-rig-700-basic-3", "Power Towers").id,
  cableTower: product("atx®-cable-pull-tower-kabelzugstation", "Weight Lifting Machines with Pulleys").id,
  legPress: product("atx®-beinpresse-45-leg-press-calssic", "Weight Lifting Machines & Racks").id,
  bumper150: product("atx®-bumper-plate-color-code-150-kg-set", "Weight Plates").id,
  wallBar: product("atx®-wall-bar-gym-mit-bank", "Power Towers").id,
  multiTower: product("atx®-multi-tower-fitness-tree", "Power Towers").id,
  nuobell: product("atx®-nuobell-kompakthantel-2-32-kg", "Dumbbells").id,
  octa24: product("atx®-octa-dumbbells-2-x-24-kg-verstellbare-hanteln-inkl-ablagestander", "Dumbbells").id,
  benchMbx: product("atx®-multi-bench-hantelbank-mbx-520", "Exercise Benches").id,
  pullUpBar: product("atx®-klimmzugstange-gladiator-multi-chin-monkey-chin", "Push Up & Pull Up Bars").id,
  legCombo: product("atx®-beinstrecker-beinbeuger-leg-combo-chair", "Weight Lifting Machines & Racks").id,
  belt: product("atx®-heavy-weight-lifting-belt-grossen-s-xxl", "Weight Lifting Belts").id,
  chalk: product("atx-liquid-chalk-flussigkreide-250-ml", "Free Weight Accessories").id,
  plyoBox: product("atx®-soft-plyo-box-sprungbox-50-x-60-x-70-cm", "Fitness & General Exercise Equipment").id,
  slamBall: product("atx®-power-slam-ball-4-20-kg", "Slam Balls").id,
  airBike: product("atx®-air-power-bike", "Upright Exercise Bikes").id,
  ergometer: product("fahrradtrainer-paros-3-0-horizon-fitness", "Upright Exercise Bikes").id,
  faszien: product("faszienrolle-32-cm", "Foam Rollers").id,
  whey: product("whey-protein-motion-sports", "Protein Supplements").id,
};

// __SEED_CONTINUES__
