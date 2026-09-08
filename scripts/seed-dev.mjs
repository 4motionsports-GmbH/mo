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
import { CATEGORY_LABELS, QUALITY_LABELS } from "../src/lib/conversation-analysis-core.mjs";
import { CAMPAIGN_SEGMENT_KEYS } from "../src/lib/campaign-segments.mjs";
import { SHOP_CATEGORIES, MO_CATEGORIES } from "../src/lib/improvement-core.mjs";

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

// ─── Vocabularies imported from the pure cores (stay in sync with the app) ─────


const PERSONAS = [
  "pragmatic_beginner",
  "ambitious_home_athlete",
  "strength_focused",
  "cardio_focused",
  "studio_operator",
  "physio",
  "public_sector",
];
const CATEGORY_KEYS = Object.keys(CATEGORY_LABELS);
const QUALITY_KEYS = Object.keys(QUALITY_LABELS);
const SEGMENT_KEYS = CAMPAIGN_SEGMENT_KEYS.filter((k) => k !== "unbekannt");
const PLACEHOLDER_CODE = "MO-XXXX";
const ALL_PRODUCTS = Object.values(P);

const FIRST_NAMES = ["Lena", "Jonas", "Sarah", "Tobias", "Katharina", "Maximilian", "Anna", "Felix", "Julia", "Lukas", "Laura", "Niklas", "Sophie", "Paul", "Marie", "David", "Hannah", "Simon", "Lea", "Jan", "Nina", "Tim", "Clara", "Moritz", "Eva", "Philipp", "Mia", "Leon", "Lisa", "Finn"];
const LAST_NAMES = ["Müller", "Schmidt", "Schneider", "Fischer", "Weber", "Meyer", "Wagner", "Becker", "Schulz", "Hoffmann", "Koch", "Richter", "Klein", "Wolf", "Schröder", "Neumann", "Braun", "Zimmermann", "Krüger", "Hartmann", "Lange", "Werner", "Krause", "Lehmann", "Huber", "Vogel", "Keller", "Roth", "Frank", "Berger"];
const CITIES = [["Berlin", "10115"], ["Hamburg", "20095"], ["München", "80331"], ["Köln", "50667"], ["Frankfurt am Main", "60311"], ["Stuttgart", "70173"], ["Leipzig", "04109"], ["Nürnberg", "90402"], ["Freiburg", "79098"], ["Münster", "48143"]];
const STREETS = ["Lindenstraße", "Bahnhofstraße", "Gartenweg", "Schillerstraße", "Am Sportplatz", "Hauptstraße", "Ringstraße", "Waldweg"];
const DOMAINS = ["gmail.com", "web.de", "gmx.de", "outlook.de", "posteo.de", "t-online.de"];

function personName(i) {
  return [FIRST_NAMES[i % FIRST_NAMES.length], LAST_NAMES[(i * 7 + 3) % LAST_NAMES.length]];
}
function emailFor(first, last, i) {
  const slug = `${first}.${last}`.toLowerCase().replace(/ü/g, "ue").replace(/ö/g, "oe").replace(/ä/g, "ae").replace(/ß/g, "ss");
  // Name pairs repeat every FIRST_NAMES.length indices → suffix keeps emails unique.
  const suffix = i % 4 === 0 || i >= FIRST_NAMES.length ? String(i) : "";
  return `${slug}${suffix}@${DOMAINS[i % DOMAINS.length]}`;
}
const money = (n) => n.toFixed(2);

// ─── Consultation themes (German, product-grounded) ───────────────────────────

const THEMES = [
  {
    persona: "pragmatic_beginner",
    products: [P.benchFold, P.hexSet, P.matFitline],
    profile: { segment: "home", experienceLevel: "beginner", trainingFocus: ["general_fitness"], spaceM2: 8, budgetEUR: 600, trainingFrequency: "2-3x", housing: "apartment", noiseSensitive: true, confidence: "medium" },
    turns: [
      ["user", "Hallo, ich möchte zu Hause anfangen zu trainieren. Ich habe aber nur eine kleine Ecke im Wohnzimmer und wenig Budget."],
      ["assistant", "Hallo! Für den Einstieg in einer kleinen Ecke brauchst du gar nicht viel. Wie viel Platz hast du ungefähr, und trainierst du eher morgens oder abends (wegen der Nachbarn)?"],
      ["user", "So 2 mal 3 Meter, meistens abends. Nachbarn unter mir, also bitte leise."],
      ["tool:update_customer_profile", null],
      ["tool:search_products", { query: "Hantelbank klappbar Kurzhanteln leise" }],
      ["assistant", `Dann passt eine **klappbare Hantelbank** plus ein Satz gummierter Hexagon-Hanteln gut zu dir — die Gummierung dämpft das Absetzen, und die Bank verschwindet nach dem Training an der Wand.\n\n- ${productName(P.benchFold)}\n- ${productName(P.hexSet)}\n- ${productName(P.matFitline)} als Unterlage gegen Trittschall`],
      ["tool:show_product", { productId: P.benchFold }],
      ["tool:show_product", { productId: P.hexSet }],
      ["user", "Reicht das für den Anfang wirklich? Ich will nicht in 3 Monaten wieder was Neues kaufen."],
      ["assistant", "Ja — mit Bank, Hanteln und Matte deckst du Brust, Rücken, Beine und Schultern ab. Wenn du später mehr willst, ergänzt du ein Loop-Band-Set oder schwerere Hanteln, statt etwas zu ersetzen."],
      ["tool:add_to_cart", { productIds: [P.benchFold, P.hexSet, P.matFitline] }],
    ],
  },
  {
    persona: "strength_focused",
    products: [P.rack510, P.bumper150, P.belt],
    profile: { segment: "home", experienceLevel: "advanced", trainingFocus: ["strength"], spaceM2: 20, budgetEUR: 2500, trainingFrequency: "4-5x", housing: "house", noiseSensitive: false, confidence: "high" },
    turns: [
      ["user", "Ich suche ein Power Rack für die Garage. Deckenhöhe 2,10 m, ich mache Kniebeugen bis 180 kg und Bankdrücken."],
      ["tool:update_customer_profile", null],
      ["tool:search_products", { query: "Power Rack 195 cm Höhe Spotter" }],
      ["assistant", `Bei 2,10 m Deckenhöhe brauchst du ein Rack unter 2 m. Das **${productName(P.rack510)}** ist 195 cm hoch, für 180 kg mehr als ausreichend dimensioniert und hat Flip-Down-Spotter für sicheres Bankdrücken ohne Partner.`],
      ["tool:show_product", { productId: P.rack510 }],
      ["user", "Welche Scheiben würdest du dazu nehmen? Ich habe noch keine."],
      ["assistant", `Für Kniebeugen und Kreuzheben in der Garage sind **Bumper Plates** ideal — sie schonen den Boden und die Stange. Das ${productName(P.bumper150)} bringt dich mit einer 20-kg-Stange direkt auf 170 kg.`],
      ["tool:show_product", { productId: P.bumper150 }],
      ["tool:compare_products", { productIds: [P.rack510, P.wallBar] }],
      ["user", "Passt. Und einen Gürtel?"],
      ["assistant", `Der ${productName(P.belt)} ist ein klassischer 10-mm-Ledergürtel — für schwere Kniebeugen die richtige Wahl.`],
      ["tool:add_to_cart", { productIds: [P.rack510, P.bumper150, P.belt] }],
    ],
  },
  {
    persona: "cardio_focused",
    products: [P.airBike, P.ergometer],
    profile: { segment: "home", experienceLevel: "intermediate", trainingFocus: ["endurance"], spaceM2: 12, budgetEUR: 1200, trainingFrequency: "3x", housing: "apartment", noiseSensitive: true, confidence: "medium" },
    turns: [
      ["user", "Ich will meine Ausdauer verbessern und brauche ein Cardiogerät für die Wohnung. Was ist besser: Air Bike oder Ergometer?"],
      ["tool:update_customer_profile", null],
      ["assistant", `Das hängt vom Ziel ab: Ein **Air Bike** ist intensiv (Ganzkörper, Intervalle), aber laut. Ein **Ergometer** ist leiser und angenehmer für längere Einheiten — in einer Wohnung meist die bessere Wahl.`],
      ["tool:compare_products", { productIds: [P.airBike, P.ergometer] }],
      ["tool:show_product", { productId: P.ergometer }],
      ["user", "Wie laut ist das Air Bike wirklich?"],
      ["assistant", "Ein Air Bike erzeugt den Widerstand über einen Ventilator — bei Intervallen ist es deutlich hörbar, vergleichbar mit einem starken Lüfter. Für abends in der Wohnung würde ich zum Ergometer raten."],
      ["tool:show_product", { productId: P.airBike }],
    ],
  },
  {
    persona: "studio_operator",
    products: [P.legPress, P.multiTower, P.legCombo],
    profile: { segment: "studio", experienceLevel: "professional", trainingFocus: ["strength"], spaceM2: 200, budgetEUR: 15000, trainingFrequency: "daily", housing: "commercial", noiseSensitive: false, confidence: "high" },
    turns: [
      ["user", "Wir eröffnen ein kleines Studio mit 200 m² und brauchen Geräte für den Beinbereich. Was empfehlt ihr für den Einstieg?"],
      ["tool:update_customer_profile", null],
      ["tool:search_products", { query: "Beinpresse Studio Beinstrecker Beinbeuger" }],
      ["assistant", `Für den Beinbereich im Studio sind eine 45°-Beinpresse und eine Kombi aus Beinstrecker/-beuger die Basis:\n\n- ${productName(P.legPress)}\n- ${productName(P.legCombo)}\n\nDazu ein ${productName(P.multiTower)} als platzsparende Station für Klimmzüge und Dips.`],
      ["tool:show_product", { productId: P.legPress }],
      ["tool:show_product", { productId: P.legCombo }],
      ["user", "Gibt es für Studios Mengenrabatte oder eine Beratung vor Ort?"],
      ["assistant", "Für gewerbliche Ausstattung beraten wir gern persönlich — inklusive Flächenplanung. Ich kann dir das Kontaktformular öffnen, dann meldet sich das Team."],
      ["tool:show_contact_form", { reason: "studio" }],
      ["tool:suggest_showroom", {}],
    ],
  },
  {
    persona: "physio",
    products: [P.loopBands, P.faszien, P.matFitline],
    profile: { segment: "rehab", experienceLevel: "professional", trainingFocus: ["mobility"], spaceM2: 40, budgetEUR: 1500, trainingFrequency: "daily", housing: "commercial", noiseSensitive: false, confidence: "high" },
    turns: [
      ["user", "Ich bin Physiotherapeutin und brauche Kleingeräte für die Praxis: Bänder, Rollen, Matten. Was ist robust genug für den täglichen Einsatz?"],
      ["tool:update_customer_profile", null],
      ["tool:search_products", { query: "Loop Band Faszienrolle Gymnastikmatte Praxis" }],
      ["assistant", `Für die Praxis empfehle ich Material, das viele Zyklen aushält:\n\n- ${productName(P.loopBands)} — fünf Zugstärken, gut für Progressionen\n- ${productName(P.faszien)}\n- ${productName(P.matFitline)} — die Airex-Matten sind hygienisch abwischbar`],
      ["tool:show_product", { productId: P.loopBands }],
      ["tool:show_product", { productId: P.matFitline }],
      ["user", "Danke, das nehme ich in die Bestellung auf."],
      ["tool:add_to_cart", { productIds: [P.loopBands, P.faszien, P.matFitline] }],
      ["tool:offer_email_summary", { trigger: "buying_intent", message: "Soll ich dir die Zusammenstellung per E-Mail schicken?" }],
    ],
  },
  {
    persona: "public_sector",
    products: [P.wallBar, P.plyoBox, P.slamBall],
    profile: { segment: "public", experienceLevel: "intermediate", trainingFocus: ["general_fitness"], spaceM2: 120, budgetEUR: 8000, trainingFrequency: "daily", housing: "commercial", noiseSensitive: false, procurementNeeds: true, confidence: "medium" },
    turns: [
      ["user", "Wir statten eine Schulsporthalle aus. Brauchen wir für die Beschaffung ein Angebot mit Bruttopreisen und Lieferzeit?"],
      ["tool:update_customer_profile", null],
      ["assistant", "Ja, für öffentliche Beschaffung stellen wir ein formales Angebot mit allen Positionen, Bruttopreisen und Lieferzeiten aus. Sag mir, welche Geräte in Frage kommen, dann bereite ich das vor."],
      ["user", "Sprossenwand, Sprungboxen und Slam Balls für 30 Schüler."],
      ["tool:search_products", { query: "Sprossenwand Sprungbox Slam Ball Schule" }],
      ["assistant", `Passend wären:\n\n- ${productName(P.wallBar)} (mit Bank)\n- ${productName(P.plyoBox)} — Soft-Boxen sind für Schulen sicherer\n- ${productName(P.slamBall)}\n\nIch öffne das Kontaktformular für das Angebot.`],
      ["tool:show_product", { productId: P.plyoBox }],
      ["tool:show_contact_form", { reason: "public_procurement" }],
    ],
  },
  {
    persona: "ambitious_home_athlete",
    products: [P.nuobell, P.benchMbx, P.pullUpBar],
    profile: { segment: "home", experienceLevel: "intermediate", trainingFocus: ["strength", "hypertrophy"], spaceM2: 15, budgetEUR: 1800, trainingFrequency: "4x", housing: "apartment", noiseSensitive: false, confidence: "high" },
    turns: [
      ["user", "Ich trainiere seit 3 Jahren im Gym und will jetzt ein Homegym. Verstellbare Hanteln bis 32 kg, eine gute Bank und eine Klimmzugstange."],
      ["tool:update_customer_profile", null],
      ["tool:search_products", { query: "verstellbare Kurzhanteln 32 kg Hantelbank Klimmzugstange" }],
      ["assistant", `Klingt nach einem soliden Setup:\n\n- ${productName(P.nuobell)} — 2–32 kg in einer Hantel\n- ${productName(P.benchMbx)}\n- ${productName(P.pullUpBar)}`],
      ["tool:show_product", { productId: P.nuobell }],
      ["tool:show_product", { productId: P.benchMbx }],
      ["user", "Sind die Nüobell wirklich haltbar? Ich habe gemischte Meinungen gelesen."],
      ["assistant", "Die Nüobell sind mechanisch robust, solange man sie auf der Ablage einstellt und nicht fallen lässt — das gilt für alle verstellbaren Hanteln. Für dein Volumen sind sie die platzsparendste Lösung."],
      ["tool:add_to_cart", { productIds: [P.nuobell, P.benchMbx] }],
    ],
  },
];

// ─── Reset ─────────────────────────────────────────────────────────────────────

const SEEDED_TABLES = [
  "admin_access_log", "ai_usage", "analytics_reports", "bundle_offers", "campaign_contacts",
  "campaign_drafts", "campaign_sends", "conversation_insights", "conversations", "customer_auth_pending",
  "customer_merge_conflicts", "customer_oauth_tokens", "customer_session_links", "customers",
  "email_captures", "email_design_selections", "email_messages", "feedback", "improvement_runs",
  "improvement_suggestions", "kpi_events", "kpi_persona_question_summaries", "marketing_sends", "messages",
  "mo_attribution_tokens", "mo_directive_versions", "mo_directives", "mo_orders", "physical_letters",
  "qa_entries", "suppression_list",
];

async function main() {
  console.log(`[seed-dev] database ${dbName} @ ${dbHost} — anchor ${ANCHOR_YMD}`);
  const nonEmpty = [];
  for (const t of SEEDED_TABLES) {
    const r = await sql.query(`SELECT count(*)::int AS n FROM ${t}`);
    if (Number(r[0]?.n) > 0) nonEmpty.push(`${t} (${r[0].n})`);
  }
  if (nonEmpty.length > 0) {
    if (!RESET) {
      console.error(
        `[seed-dev] ABORTED — these tables already hold data: ${nonEmpty.join(", ")}.\n` +
          "  Re-run with --reset to truncate and refill them."
      );
      process.exit(1);
    }
    await sql.query(`TRUNCATE ${SEEDED_TABLES.join(", ")} RESTART IDENTITY CASCADE`);
    console.log("[seed-dev] truncated seeded tables");
  }

  const counts = {};
  const count = (table, n) => {
    counts[table] = (counts[table] ?? 0) + n;
  };

  // ── Customers + captures ─────────────────────────────────────────────────────
  const customers = [];
  for (let i = 0; i < 45; i++) {
    const [first, last] = personName(i);
    const email = emailFor(first, last, i);
    const firstSeenDays = int(20, 118);
    const lastSeenDays = int(0, Math.min(firstSeenDays, 60));
    const tier = i % 5 === 0 ? 3 : i % 11 === 0 ? 1 : 2;
    const marketing = pick(["confirmed", "confirmed", "confirmed", "pending", "none", "unsubscribed"]);
    const hasPurchases = chance(0.55);
    const orders = hasPurchases
      ? Array.from({ length: int(1, 3) }, (_, k) => {
          const items = shuffle(ALL_PRODUCTS).slice(0, int(1, 3));
          const total = items.reduce((s, id) => s + productPrice(id), 0);
          return {
            name: `#${1200 + i * 3 + k}`,
            createdAt: shopTime(int(lastSeenDays, 118)),
            totalAmount: money(total),
            currencyCode: "EUR",
            financialStatus: k === 0 && chance(0.1) ? "REFUNDED" : "PAID",
            items: items.map((id) => ({ title: productName(id), handle: id, quantity: 1 })),
          };
        })
      : [];
    const [city, plz] = CITIES[i % CITIES.length];
    const hasAddress = tier >= 2 && chance(0.35);
    customers.push({
      i, first, last, email, tier, marketing, orders,
      created_at: at(firstSeenDays, 9),
      first_seen_at: shopTime(firstSeenDays),
      last_seen_at: shopTime(lastSeenDays),
      transactional_consent: true,
      marketing_status: marketing,
      profile_summary: chance(0.6)
        ? `**Aktuelles Verständnis**\n\n${first} trainiert ${pick(["zu Hause im Wohnzimmer", "in der Garage", "in einer kleinen Praxis", "mit der Familie"])} und interessiert sich vor allem für ${pick(["Krafttraining mit Kurzhanteln", "Ausdauertraining", "Mobilität und Regeneration", "ein kompaktes Homegym"])}. Budgetrahmen ca. ${int(4, 25) * 100} €. ${pick(["Achtet auf leise Geräte (Mietwohnung).", "Hat bereits eine Bank und sucht Ergänzungen.", "Möchte langfristig ausbauen.", "Fragt häufig nach Lieferzeiten."])}`
        : null,
      profile_summary_updated_at: chance(0.6) ? shopTime(int(0, 30)) : null,
      purchase_summary: hasPurchases
        ? json({ orders, truncated: false, fetchedAt: shopTime(int(0, 10)) })
        : chance(0.5) ? json({ orders: [], truncated: false, fetchedAt: shopTime(int(0, 10)) }) : null,
      purchase_summary_updated_at: hasPurchases ? shopTime(int(0, 10)) : null,
      admin_instructions: i % 9 === 0 ? pick(["Erwähne die neue Rudergeräte-Linie.", "Kunde hat nach Lieferung nach Österreich gefragt.", "Kein Rabatt anbieten — Stammkunde zahlt gern Vollpreis."]) : null,
      admin_instructions_updated_at: i % 9 === 0 ? shopTime(int(0, 20)) : null,
      shopify_customer_id: tier === 3 ? String(7100000000000 + i) : null,
      shopify_customer_gid: tier === 3 ? `gid://shopify/Customer/${7100000000000 + i}` : null,
      shopify_linked_at: tier === 3 ? shopTime(int(lastSeenDays, firstSeenDays)) : null,
      identity_tier: tier,
      shopify_account_summary: tier === 3
        ? json({ displayName: `${first} ${last}`, firstName: first, addressContext: { city, countryCode: "DE" }, addressCount: 1, fetchedAt: shopTime(int(0, 10)) })
        : null,
      shopify_account_summary_updated_at: tier === 3 ? shopTime(int(0, 10)) : null,
      postal_address: hasAddress
        ? json({ name: `${first} ${last}`, company: null, address_line_1: `${pick(STREETS)} ${int(1, 99)}`, address_line_2: null, postal_code: plz, city, country: "DE" })
        : null,
      postal_address_source: hasAddress ? pick(["purchase", "consented_capture"]) : null,
      postal_address_updated_at: hasAddress ? shopTime(int(0, 30)) : null,
      postal_address_checked_at: chance(0.5) ? shopTime(int(0, 5)) : null,
      letter_draft_subject: i === 3 || i === 17 ? "Ihr persönliches Angebot für den Winter" : null,
      letter_draft_body: i === 3 || i === 17 ? `Sehr geehrte Frau ${last},\n\nvielen Dank für Ihr Vertrauen. Passend zu Ihrer Hantelbank haben wir ein Set zusammengestellt, das Ihr Training zu Hause abrundet.\n\nMit sportlichen Grüßen\nIhr motion sports Team` : null,
      letter_draft_updated_at: i === 3 || i === 17 ? shopTime(int(0, 5)) : null,
    });
  }
  const customerCols = ["email", "created_at", "first_seen_at", "last_seen_at", "transactional_consent", "marketing_status", "profile_summary", "profile_summary_updated_at", "purchase_summary", "purchase_summary_updated_at", "admin_instructions", "admin_instructions_updated_at", "shopify_customer_id", "shopify_customer_gid", "shopify_linked_at", "identity_tier", "shopify_account_summary", "shopify_account_summary_updated_at", "postal_address", "postal_address_source", "postal_address_updated_at", "postal_address_checked_at", "letter_draft_subject", "letter_draft_body", "letter_draft_updated_at"];
  const customerIds = await insertRows("customers", customerCols, customers, {
    casts: { purchase_summary: "jsonb", shopify_account_summary: "jsonb", postal_address: "jsonb", created_at: "timestamptz", first_seen_at: "timestamptz", last_seen_at: "timestamptz", profile_summary_updated_at: "timestamptz", purchase_summary_updated_at: "timestamptz", admin_instructions_updated_at: "timestamptz", shopify_linked_at: "timestamptz", shopify_account_summary_updated_at: "timestamptz", postal_address_updated_at: "timestamptz", postal_address_checked_at: "timestamptz", letter_draft_updated_at: "timestamptz" },
    returning: "id",
  });
  customers.forEach((c, k) => { c.id = Number(customerIds[k].id); });
  count("customers", customers.length);

  const captures = [];
  for (const c of customers) {
    const sessionId = `sess_${hex(24)}`;
    c.sessionId = sessionId;
    const status = c.marketing === "none" ? "none" : c.marketing === "unsubscribed" ? "confirmed" : c.marketing;
    captures.push({
      session_id: sessionId,
      email: c.email,
      created_at: c.first_seen_at,
      transactional_consent: true,
      marketing_consent: c.marketing !== "none",
      marketing_doi_status: status,
      doi_token: status === "pending" ? hex(48) : null,
      doi_sent_at: c.marketing !== "none" ? addMs(c.first_seen_at, 60_000) : null,
      doi_confirmed_at: status === "confirmed" ? addMs(c.first_seen_at, int(2, 90) * 60_000) : null,
      consent_text_shown: "Ja, ich möchte die Zusammenfassung per E-Mail erhalten. | Ja, informiert mich über passende Angebote (jederzeit widerrufbar).",
      unsubscribed_at: c.marketing === "unsubscribed" ? shopTime(int(0, 40)) : null,
      customer_id: c.id,
      consent_copy_version: "v4",
      locale: c.i % 6 === 0 ? "en" : "de",
    });
  }
  for (let k = 0; k < 8; k++) {
    captures.push({
      session_id: `sess_${hex(24)}`,
      email: `anon${k}@example.org`,
      created_at: shopTime(int(0, 90)),
      transactional_consent: true,
      marketing_consent: false,
      marketing_doi_status: "none",
      doi_token: null, doi_sent_at: null, doi_confirmed_at: null,
      consent_text_shown: "Ja, ich möchte die Zusammenfassung per E-Mail erhalten.",
      unsubscribed_at: null, customer_id: null, consent_copy_version: "v4", locale: "de",
    });
  }
  const captureIds = await insertRows("email_captures", ["session_id", "email", "created_at", "transactional_consent", "marketing_consent", "marketing_doi_status", "doi_token", "doi_sent_at", "doi_confirmed_at", "consent_text_shown", "unsubscribed_at", "customer_id", "consent_copy_version", "locale"], captures, {
    casts: { created_at: "timestamptz", doi_sent_at: "timestamptz", doi_confirmed_at: "timestamptz", unsubscribed_at: "timestamptz" },
    returning: "id, email",
  });
  const captureIdByEmail = new Map(captureIds.map((r) => [r.email, Number(r.id)]));
  count("email_captures", captures.length);

  const suppressed = customers.filter((c) => c.marketing === "unsubscribed").slice(0, 2);
  const suppressionRows = [
    ...suppressed.map((c) => ({ email: c.email, added_at: shopTime(int(0, 40)), reason: "unsubscribe" })),
    { email: "bounced.mailbox@example.org", added_at: shopTime(12), reason: "bounce" },
  ];
  await insertRows("suppression_list", ["email", "added_at", "reason"], suppressionRows, { casts: { added_at: "timestamptz" } });
  count("suppression_list", suppressionRows.length);

  // ── Conversations + messages + telemetry ─────────────────────────────────────
  const conversations = [];
  const messageRows = [];
  const kpiRows = [];
  const usageRows = [];
  const linkRows = [];
  const linkedCustomers = shuffle(customers).slice(0, 35);
  for (let i = 0; i < 140; i++) {
    const theme = THEMES[i % THEMES.length];
    const linked = i < linkedCustomers.length ? linkedCustomers[i] : null;
    const daysAgo = linked ? Math.max(0, weightedDaysAgo()) : weightedDaysAgo();
    const startedAt = shopTime(daysAgo);
    const sessionId = linked ? linked.sessionId : `sess_${hex(24)}`;
    const turns = theme.turns.slice(0, int(Math.min(4, theme.turns.length), theme.turns.length));
    const hasError = i % 23 === 0;
    const status = daysAgo === 0 && chance(0.5) ? "active" : chance(0.15) ? "converted" : chance(0.35) ? "abandoned" : "active";
    const analyzed = chance(0.4);
    const recommended = theme.products.slice(0, int(1, theme.products.length));
    const selected = turns.some(([k]) => k === "tool:add_to_cart") ? theme.products : [];
    let t = startedAt;
    let msgCount = 0;
    const convIndex = conversations.length;
    turns.forEach(([kind, payload], ti) => {
      t = addMs(t, int(20, 120) * 1000);
      if (kind === "user") {
        messageRows.push({ convIndex, client_message_id: `m${i}-${ti}`, role: "user", content: payload, tool_name: null, created_at: t });
        msgCount++;
        if (hasError && ti === turns.length - 1) return;
      } else if (kind === "assistant") {
        if (hasError && ti >= 1) return; // the bot went silent after the first user turn
        messageRows.push({ convIndex, client_message_id: `m${i}-${ti}`, role: "assistant", content: payload, tool_name: null, created_at: t });
        msgCount++;
      } else {
        if (hasError) return;
        const toolName = kind.slice(5);
        const input = toolName === "update_customer_profile" ? theme.profile : payload ?? {};
        messageRows.push({ convIndex, client_message_id: `m${i}-${ti}`, role: "assistant", content: JSON.stringify(input), tool_name: toolName, created_at: t });
        if (toolName === "offer_email_summary") {
          kpiRows.push({ session_id: sessionId, event: "email_capture_ask_shown", data: json({ trigger: input.trigger ?? "buying_intent", askNumber: 1 }), created_at: t });
        }
      }
    });
    if (hasError) {
      // keep only the user turns for a "no reply" conversation
      for (let k = messageRows.length - 1; k >= 0 && messageRows[k].convIndex === convIndex; k--) {
        if (messageRows[k].role === "assistant") messageRows.splice(k, 1);
      }
      msgCount = messageRows.filter((m) => m.convIndex === convIndex).length;
    }
    const lastActivity = t;
    conversations.push({
      session_id: sessionId,
      conversation_key: `conv_${hex(20)}`,
      created_at: startedAt,
      updated_at: lastActivity,
      last_activity_at: lastActivity,
      persona_label: hasError ? null : theme.persona,
      message_count: msgCount,
      recommended_product_ids: recommended,
      selected_product_ids: selected,
      status: hasError ? "abandoned" : status,
      customer_id: linked ? linked.id : null,
      title: linked && chance(0.5) ? `Beratung ${germanDate(startedAt)}` : null,
      title_auto: turns[0][1].slice(0, 60).replace(/[.!?].*$/, ""),
      analysis_summary: analyzed ? pick([
        "Einsteiger sucht ein kompaktes, leises Homegym-Setup; Bank + Hanteln empfohlen, Warenkorb geöffnet.",
        "Fortgeschrittener fragt nach Rack und Scheiben für die Garage; Deckenhöhe war das entscheidende Kriterium.",
        "Cardio-Interessent vergleicht Air Bike und Ergometer; Lautstärke in der Wohnung ist der Knackpunkt.",
        "Studiobetreiber plant Beinbereich; Übergabe ans Kontaktformular für Angebot.",
        "Physiopraxis sucht robuste Kleingeräte; Zusammenstellung per E-Mail angefragt.",
        "Öffentliche Beschaffung: Angebot mit Bruttopreisen gewünscht; Kontaktformular geöffnet.",
      ]) : null,
      analysis_category: analyzed ? pick(CATEGORY_KEYS.slice(0, 5)) : null,
      analysis_tags: analyzed ? shuffle(["homegym", "budget", "lautstärke", "lieferzeit", "studio", "reha", "vergleich", "angebot"]).slice(0, int(1, 3)) : [],
      analysis_quality: analyzed ? (hasError ? "dropped_off" : pick(QUALITY_KEYS)) : null,
      analysis_model: analyzed ? "claude-haiku-4-5" : null,
      analysis_input_tokens: analyzed ? int(1800, 4200) : null,
      analysis_output_tokens: analyzed ? int(120, 320) : null,
      analysis_updated_at: analyzed ? addMs(lastActivity, int(1, 72) * 3_600_000) : null,
      qa_scanned_at: chance(0.4) ? addMs(lastActivity, int(1, 48) * 3_600_000) : null,
      locale: i % 7 === 0 ? "en" : "de",
    });
    if (linked) {
      linkRows.push({ session_id: sessionId, customer_id: linked.id, linked_at: startedAt, last_seen_at: lastActivity });
    }
    // telemetry for this session
    kpiRows.push({ session_id: sessionId, event: "chat_opened", data: json({ page: "/products/" + theme.products[0] }), created_at: addMs(startedAt, -30_000) });
    if (!hasError && chance(0.7)) kpiRows.push({ session_id: sessionId, event: "product_card_click", data: json({ productId: theme.products[0] }), created_at: addMs(startedAt, 200_000) });
    if (selected.length > 0 && chance(0.6)) kpiRows.push({ session_id: sessionId, event: "add_to_cart_click", data: json({ productIds: selected }), created_at: lastActivity });
    if (chance(0.3)) {
      kpiRows.push({ session_id: sessionId, event: "consent_gate_shown", data: json({ surface: linked && linked.tier === 3 ? "signin" : "chat" }), created_at: addMs(startedAt, 90_000) });
      const outcome = pick(["consent_gate_accepted", "consent_gate_accepted", "consent_gate_declined", "consent_gate_dismissed"]);
      kpiRows.push({ session_id: sessionId, event: outcome, data: json({ surface: linked && linked.tier === 3 ? "signin" : "chat" }), created_at: addMs(startedAt, 95_000) });
    }
    if (linked) {
      kpiRows.push({ session_id: sessionId, event: "email_capture_submitted", data: json({}), created_at: addMs(lastActivity, 10_000) });
      if (linked.marketing !== "none") kpiRows.push({ session_id: sessionId, event: "email_capture_marketing_opted_in", data: json({}), created_at: addMs(lastActivity, 11_000) });
      if (linked.marketing === "confirmed" || linked.marketing === "unsubscribed") kpiRows.push({ session_id: sessionId, event: "email_capture_marketing_confirmed", data: json({}), created_at: addMs(lastActivity, int(5, 120) * 60_000) });
      if (linked.tier === 3) kpiRows.push({ session_id: sessionId, event: "account_signin_succeeded", data: json({ silent: chance(0.5) }), created_at: addMs(startedAt, -10_000) });
    } else if (chance(0.15)) {
      kpiRows.push({ session_id: sessionId, event: "email_capture_declined", data: json({}), created_at: addMs(lastActivity, 5_000) });
    }
    // chat token usage (1 row per assistant turn)
    const assistantTurns = turns.filter(([k]) => k === "assistant").length || 1;
    for (let k = 0; k < assistantTurns; k++) {
      const input = int(2800, 6500);
      usageRows.push({ convIndex, call_site: "chat", model: "claude-sonnet-4-6", input_tokens: input, output_tokens: int(120, 480), cache_read_tokens: k === 0 ? 0 : Math.floor(input * 0.8), cache_write_tokens: k === 0 ? Math.floor(input * 0.7) : 0, estimated: false, created_at: addMs(startedAt, (k + 1) * 90_000) });
    }
    if (chance(0.3)) usageRows.push({ convIndex, call_site: "embeddings", model: "text-embedding-3-small", input_tokens: int(20, 60), output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, estimated: false, created_at: addMs(startedAt, 60_000) });
    if (chance(0.1)) usageRows.push({ convIndex, call_site: "tts", model: "gpt-4o-mini-tts", input_tokens: int(300, 900), output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, estimated: true, created_at: addMs(startedAt, 150_000) });
    if (conversations[convIndex].analysis_summary) usageRows.push({ convIndex, call_site: "conversation_analysis", model: "claude-haiku-4-5", input_tokens: conversations[convIndex].analysis_input_tokens, output_tokens: conversations[convIndex].analysis_output_tokens, cache_read_tokens: 0, cache_write_tokens: 0, estimated: false, created_at: conversations[convIndex].analysis_updated_at });
  }
  const convCols = ["session_id", "conversation_key", "created_at", "updated_at", "last_activity_at", "persona_label", "message_count", "recommended_product_ids", "selected_product_ids", "status", "customer_id", "title", "title_auto", "analysis_summary", "analysis_category", "analysis_tags", "analysis_quality", "analysis_model", "analysis_input_tokens", "analysis_output_tokens", "analysis_updated_at", "qa_scanned_at", "locale"];
  const convIds = await insertRows("conversations", convCols, conversations, {
    casts: { created_at: "timestamptz", updated_at: "timestamptz", last_activity_at: "timestamptz", analysis_updated_at: "timestamptz", qa_scanned_at: "timestamptz", recommended_product_ids: "text[]", selected_product_ids: "text[]", analysis_tags: "text[]" },
    returning: "id",
  });
  conversations.forEach((c, k) => { c.id = Number(convIds[k].id); });
  count("conversations", conversations.length);

  await insertRows("messages", ["conversation_id", "client_message_id", "role", "content", "tool_name", "created_at"],
    messageRows.map((m) => ({ ...m, conversation_id: conversations[m.convIndex].id })), { casts: { created_at: "timestamptz" } });
  count("messages", messageRows.length);

  await insertRows("customer_session_links", ["session_id", "customer_id", "linked_at", "last_seen_at"], linkRows, { casts: { linked_at: "timestamptz", last_seen_at: "timestamptz" } });
  count("customer_session_links", linkRows.length);

  // ── Campaign module ──────────────────────────────────────────────────────────
  const contacts = [];
  const statusPlan = [...Array(20).fill("pending"), ...Array(18).fill("drafted"), ...Array(22).fill("sent"), ...Array(4).fill("skipped"), ...Array(4).fill("suppressed"), ...Array(2).fill("draft_failed")];
  for (let i = 0; i < statusPlan.length; i++) {
    const [first, last] = personName(i + 50);
    const status = statusPlan[i];
    const lastOrderDays = chance(0.9) ? int(5, 400) : null;
    const orders = int(1, 6);
    contacts.push({
      i, first, last, status,
      shopify_customer_id: String(7200000000000 + i),
      email: emailFor(first, last, i + 50).replace("@", `+shop@`),
      first_name: first,
      last_name: last,
      language: i % 6 === 0 ? "en" : "de",
      opt_in_level: pick(["CONFIRMED_OPT_IN", "CONFIRMED_OPT_IN", "CONFIRMED_OPT_IN", "SINGLE_OPT_IN", "UNKNOWN"]),
      consent_updated_at: shopTime(int(30, 400)),
      orders_count: orders,
      total_spent_cents: int(80, 2400) * 100,
      last_synced_at: shopTime(0),
      sent_at: status === "sent" ? shopTime(int(0, 60)) : null,
      skipped_at: status === "skipped" ? shopTime(int(0, 20)) : null,
      created_at: shopTime(int(10, 90)),
      language_override: i % 25 === 0 ? "en" : null,
      last_order_at: lastOrderDays != null ? shopTime(lastOrderDays) : null,
      lastOrderDays,
    });
  }
  const contactIds = await insertRows("campaign_contacts", ["shopify_customer_id", "email", "first_name", "last_name", "language", "opt_in_level", "consent_updated_at", "orders_count", "total_spent_cents", "last_synced_at", "status", "sent_at", "skipped_at", "created_at", "language_override", "last_order_at"], contacts, {
    casts: { consent_updated_at: "timestamptz", last_synced_at: "timestamptz", sent_at: "timestamptz", skipped_at: "timestamptz", created_at: "timestamptz", last_order_at: "timestamptz" },
    returning: "id",
  });
  contacts.forEach((c, k) => { c.id = Number(contactIds[k].id); });
  count("campaign_contacts", contacts.length);

  const draftBody = (c, recs, discount, expiresAt) => {
    const de = c.language !== "en" && !c.language_override;
    const greet = de ? `Hallo ${c.first},` : `Hi ${c.first},`;
    const lines = recs.map((id) => `- [${productName(id)}](https://motionsports.de/products/${id})`).join("\n");
    const disc = discount > 0
      ? de
        ? `\n\nAls Dankeschön gibt es **${discount} % Rabatt** mit dem Code **${PLACEHOLDER_CODE}** — gültig bis ${germanDate(expiresAt)}.`
        : `\n\nAs a thank-you, enjoy **${discount}% off** with code **${PLACEHOLDER_CODE}** — valid until ${germanDate(expiresAt)}.`
      : "";
    return de
      ? `${greet}\n\nschön, dass du bei uns bestellt hast. Passend zu deinem bisherigen Training haben wir drei Ergänzungen herausgesucht, die dein Setup sinnvoll erweitern:\n\n${lines}${disc}\n\nSportliche Grüße\nDein motion sports Team`
      : `${greet}\n\nthanks for training with us. Based on your last order we picked a few additions that complement your setup:\n\n${lines}${disc}\n\nStay strong\nYour motion sports team`;
  };
  const purchaseSummaryFor = (c) => ({
    orders: Array.from({ length: Math.min(c.orders_count, 3) }, (_, k) => {
      const items = shuffle(ALL_PRODUCTS).slice(0, int(1, 2));
      return {
        name: `#${3000 + c.i * 5 + k}`,
        createdAt: shopTime((c.lastOrderDays ?? 60) + k * 40),
        totalAmount: money(items.reduce((s, id) => s + productPrice(id), 0)),
        currencyCode: "EUR",
        items: items.map((id) => ({ title: productName(id), quantity: 1, productId: id })),
      };
    }),
    truncated: false,
  });
  const drafts = [];
  for (const c of contacts.filter((x) => x.status === "drafted" || x.status === "sent")) {
    const recs = shuffle(ALL_PRODUCTS).slice(0, 3);
    const discount = pick([0, 0, 5, 10, 10, 15]);
    const expiresAt = addDays(shopTime(0), 7);
    const segment = c.lastOrderDays == null ? null : c.lastOrderDays < 7 ? "frisch" : c.lastOrderDays < 30 ? "ausbauen_frueh" : c.lastOrderDays < 90 ? "ausbauen" : c.lastOrderDays < 180 ? "weiterentwickeln" : c.lastOrderDays < 365 ? "zurueckholen" : "ruhen";
    const hero = c.status === "drafted" && (c.i % 9 === 0);
    drafts.push({
      contact_id: c.id,
      subject: c.language === "en" ? `${c.first}, three additions for your training` : `${c.first}, drei Ergänzungen für dein Training`,
      body: draftBody(c, recs, discount, expiresAt),
      discount_percent: discount,
      discount_expires_at: discount > 0 ? expiresAt : null,
      purchase_summary: json(purchaseSummaryFor(c)),
      recommended_product_ids: recs,
      low_confidence: c.i % 13 === 0,
      created_at: shopTime(int(0, 3)),
      updated_at: shopTime(0),
      purchase_selected_ids: c.i % 17 === 0 ? [ALL_PRODUCTS[0]] : null,
      product_highlights: json(recs.map((id) => ({ name: productName(id), description: pick(["Robust verarbeitet und platzsparend — passt zu deinem Setup.", "Ergänzt dein Training um eine neue Reizvariante.", "Bewährt bei unseren Kund:innen mit ähnlichem Profil."]) }))),
      text_mode: pick(["compact", "compact", "detailed", "minimal"]),
      hero_image_url: hero ? "http://localhost:3000/email-hero-default.jpg" : null,
      hero_image_prompt: hero ? "Bright home gym at golden hour, adjustable dumbbells on a rack, foldable bench, soft natural light, editorial photography, left half calm and uncluttered" : null,
      hero_headline: hero ? "Mehr Leistung.\nMehr Fokus." : null,
      segment,
      segment_days: c.lastOrderDays,
      hero_image_mobile_url: hero ? "http://localhost:3000/email-hero-default.jpg" : null,
      recs, discount, segment,
    });
  }
  await insertRows("campaign_drafts", ["contact_id", "subject", "body", "discount_percent", "discount_expires_at", "purchase_summary", "recommended_product_ids", "low_confidence", "created_at", "updated_at", "purchase_selected_ids", "product_highlights", "text_mode", "hero_image_url", "hero_image_prompt", "hero_headline", "segment", "segment_days", "hero_image_mobile_url"], drafts, {
    casts: { discount_expires_at: "timestamptz", purchase_summary: "jsonb", recommended_product_ids: "text[]", created_at: "timestamptz", updated_at: "timestamptz", purchase_selected_ids: "text[]", product_highlights: "jsonb" },
  });
  count("campaign_drafts", drafts.length);

  // Bundle offers: a few for customers (marketing channel) and two for campaign contacts.
  const bundleRows = [];
  const bundleComponents = (ids) => ids.map((id) => ({ productId: id, title: productName(id), variantId: `gid://shopify/ProductVariant/${variantIdFor(id)}`, numericVariantId: variantIdFor(id), quantity: 1, unitPrice: money(productPrice(id)), currency: "EUR" }));
  const bundleTargets = customers.filter((c) => c.marketing === "confirmed").slice(0, 5);
  bundleTargets.forEach((c, k) => {
    const ids = shuffle(ALL_PRODUCTS).slice(0, int(2, 3));
    const sum = ids.reduce((s, id) => s + productPrice(id), 0);
    const status = ["active", "active", "expired", "failed", "active"][k];
    bundleRows.push({
      customer_id: c.id, marketing_send_id: null, campaign_contact_id: null,
      components: json(bundleComponents(ids)), components_sum: money(sum), bundle_price: money(sum * 0.92), currency: "EUR",
      title: pick(["Dein persönliches Set", "Homegym-Starterpaket", "Regenerations-Set"]),
      shopify_product_id: status === "failed" ? null : `gid://shopify/Product/${8300000000000 + k}`,
      shopify_variant_id: status === "failed" ? null : `gid://shopify/ProductVariant/${8400000000000 + k}`,
      numeric_variant_id: status === "failed" ? null : String(8400000000000 + k),
      shopify_handle: status === "failed" ? null : `set-${c.first.toLowerCase()}-${k}`,
      creation_mode: "native_fixed_bundle", status,
      error: status === "failed" ? "publishablePublish: ACCESS_DENIED (write_publications scope missing)" : null,
      cart_url: status === "failed" ? null : `https://motionsports.de/cart/${8400000000000 + k}:1`,
      redirect_token: urlToken(), expires_at: status === "expired" ? shopTime(3) : addDays(shopTime(0), 5),
      archived_at: status === "expired" ? shopTime(2) : null, created_at: shopTime(status === "expired" ? 12 : int(0, 4)), updated_at: shopTime(0),
    });
  });
  const campaignBundleContacts = contacts.filter((c) => c.status === "drafted").slice(0, 2);
  campaignBundleContacts.forEach((c, k) => {
    const ids = shuffle(ALL_PRODUCTS).slice(0, 2);
    const sum = ids.reduce((s, id) => s + productPrice(id), 0);
    bundleRows.push({
      customer_id: null, marketing_send_id: null, campaign_contact_id: c.id,
      components: json(bundleComponents(ids)), components_sum: money(sum), bundle_price: money(sum * 0.9), currency: "EUR",
      title: "Dein persönliches Set", shopify_product_id: `gid://shopify/Product/${8310000000000 + k}`, shopify_variant_id: `gid://shopify/ProductVariant/${8410000000000 + k}`, numeric_variant_id: String(8410000000000 + k), shopify_handle: `set-kampagne-${k}`,
      creation_mode: "native_fixed_bundle", status: "active", error: null, cart_url: `https://motionsports.de/cart/${8410000000000 + k}:1`, redirect_token: urlToken(), expires_at: addDays(shopTime(0), 6), archived_at: null, created_at: shopTime(1), updated_at: shopTime(0),
    });
  });
  const bundleIds = await insertRows("bundle_offers", ["customer_id", "marketing_send_id", "campaign_contact_id", "components", "components_sum", "bundle_price", "currency", "title", "shopify_product_id", "shopify_variant_id", "numeric_variant_id", "shopify_handle", "creation_mode", "status", "error", "cart_url", "redirect_token", "expires_at", "archived_at", "created_at", "updated_at"], bundleRows, {
    casts: { components: "jsonb", expires_at: "timestamptz", archived_at: "timestamptz", created_at: "timestamptz", updated_at: "timestamptz" },
    returning: "id",
  });
  bundleRows.forEach((b, k) => { b.id = Number(bundleIds[k].id); });
  count("bundle_offers", bundleRows.length);
  const campaignBundleIds = bundleRows.filter((b) => b.campaign_contact_id).map((b) => b.id);

  // Campaign sends (45 over the last 60 days) with the KPI snapshot + delivery columns.
  const sends = [];
  const sentContacts = contacts.filter((c) => c.status === "sent");
  for (let k = 0; k < 45; k++) {
    const c = sentContacts[k % sentContacts.length];
    const daysAgo = k < 6 ? 0 : int(1, 60);
    const sentAt = shopTime(daysAgo);
    const via = k % 9 === 8 ? "copy" : "email";
    const discount = pick([0, 5, 10, 10, 15]);
    const heroVariant = via === "copy" ? "none" : pick(["ai", "default", "default", "none"]);
    const recs = shuffle(ALL_PRODUCTS).slice(0, 3);
    const body = draftBody(c, recs, discount, addDays(sentAt, 7)).replace(PLACEHOLDER_CODE, `MK-${hex(6).toUpperCase()}`);
    const bounced = k % 15 === 7;
    const withBundle = k < campaignBundleIds.length * 2 && chance(0.6);
    sends.push({
      contact_id: c.id, email: c.email,
      subject: c.language === "en" ? `${c.first}, three additions for your training` : `${c.first}, drei Ergänzungen für dein Training`,
      body_hash: sha256(body),
      body_text: k % 11 === 10 ? null : body,
      body_html: k % 11 === 10 ? null : `<div style="font-family:Montserrat,Arial,sans-serif;max-width:600px;margin:auto"><h1 style="font-size:22px">${c.first}, drei Ergänzungen für dein Training</h1>${body.split("\n\n").map((p) => `<p>${p.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/\n/g, "<br/>")}</p>`).join("")}<p style="color:#6b7280;font-size:12px">Abmelden: <a href="http://localhost:3000/api/unsubscribe?token=demo">hier</a></p></div>`,
      sent_via: via,
      discount_code: discount > 0 ? `MK-${hex(6).toUpperCase()}` : null,
      discount_code_gid: discount > 0 ? `gid://shopify/DiscountCodeNode/${9000000000000 + k}` : null,
      discount_expires_at: discount > 0 ? addDays(sentAt, 7) : null,
      sent_at: sentAt, created_at: sentAt,
      redirect_token: via === "email" ? urlToken() : null,
      clicked_at: via === "email" && chance(0.35) ? addMs(sentAt, int(30, 2400) * 60_000) : null,
      segment: c.lastOrderDays == null ? null : c.lastOrderDays < 30 ? "ausbauen_frueh" : c.lastOrderDays < 90 ? "ausbauen" : pick(SEGMENT_KEYS),
      design_key: heroVariant === "none" ? "classic" : "performance",
      hero_variant: heroVariant,
      hero_image_url: heroVariant === "ai" ? "http://localhost:3000/email-hero-default.jpg" : null,
      hero_headline: heroVariant === "ai" ? "Mehr Leistung.\nMehr Fokus." : null,
      text_mode: pick(["compact", "detailed", "minimal"]),
      language: c.language,
      discount_percent: discount,
      bundle_offer_id: withBundle ? campaignBundleIds[k % campaignBundleIds.length] : null,
      bundle_clicked_at: withBundle && chance(0.5) ? addMs(sentAt, int(60, 3000) * 60_000) : null,
      unsubscribed_at: k % 21 === 20 ? addMs(sentAt, int(1, 20) * 3_600_000) : null,
      provider_email_id: via === "email" ? `re_${hex(24)}` : null,
      delivered_at: via === "email" && !bounced && chance(0.85) ? addMs(sentAt, int(1, 15) * 60_000) : null,
      bounced_at: bounced ? addMs(sentAt, int(1, 30) * 60_000) : null,
      bounce_type: bounced ? (k % 30 === 7 ? "soft" : "hard") : null,
      complained_at: k === 33 ? addMs(sentAt, 2 * 3_600_000) : null,
      heroVariant,
    });
  }
  const sendIds = await insertRows("campaign_sends", ["contact_id", "email", "subject", "body_hash", "body_text", "body_html", "sent_via", "discount_code", "discount_code_gid", "discount_expires_at", "sent_at", "created_at", "redirect_token", "clicked_at", "segment", "design_key", "hero_variant", "hero_image_url", "hero_headline", "text_mode", "language", "discount_percent", "bundle_offer_id", "bundle_clicked_at", "unsubscribed_at", "provider_email_id", "delivered_at", "bounced_at", "bounce_type", "complained_at"], sends, {
    casts: { discount_expires_at: "timestamptz", sent_at: "timestamptz", created_at: "timestamptz", clicked_at: "timestamptz", bundle_clicked_at: "timestamptz", unsubscribed_at: "timestamptz", delivered_at: "timestamptz", bounced_at: "timestamptz", complained_at: "timestamptz" },
    returning: "id",
  });
  count("campaign_sends", sends.length);
  // hero-generation spend for the AI-hero sends (priced per variant on the KPI tab)
  sends.forEach((s, k) => {
    if (s.heroVariant !== "ai") return;
    usageRows.push({ convIndex: null, campaign_contact_id: s.contact_id, call_site: "hero_image", model: "claude-sonnet-4-6", input_tokens: int(2500, 4000), output_tokens: int(200, 400), cache_read_tokens: 0, cache_write_tokens: 0, estimated: false, created_at: addMs(s.sent_at, -20 * 60_000) });
    usageRows.push({ convIndex: null, campaign_contact_id: s.contact_id, call_site: "hero_image", model: "gpt-image-2", input_tokens: int(900, 1400), output_tokens: int(3000, 6000), cache_read_tokens: 0, cache_write_tokens: 0, estimated: true, created_at: addMs(s.sent_at, -15 * 60_000) });
    void sendIds[k];
  });
  contacts.filter((c) => c.status !== "pending").forEach((c) => {
    usageRows.push({ convIndex: null, campaign_contact_id: c.id, call_site: "campaign_draft", model: "claude-sonnet-4-6", input_tokens: int(3500, 7000), output_tokens: int(350, 700), cache_read_tokens: 0, cache_write_tokens: 0, estimated: false, created_at: shopTime(int(0, 60)) });
  });
  // clicks as telemetry too
  sends.filter((s) => s.clicked_at).forEach((s) => kpiRows.push({ session_id: null, event: "campaign_email_clicked", data: json({ sendId: null }), created_at: s.clicked_at }));

  // ── Marketing sends (Mo channel, per capture) ────────────────────────────────
  const marketingRows = [];
  const marketable = customers.filter((c) => c.marketing === "confirmed");
  marketable.forEach((c, k) => {
    if (k >= 20) return;
    const captureId = captureIdByEmail.get(c.email);
    const sent = k % 3 !== 0;
    const discount = pick([0, 5, 10, 15]);
    const ids = shuffle(ALL_PRODUCTS).slice(0, 2);
    const sentAt = sent ? shopTime(int(1, 70)) : null;
    const code = sent && discount > 0 ? `MS5-${hex(6).toUpperCase()}` : null;
    const text = `Hallo ${c.first},\n\nvielen Dank für dein Gespräch mit Mo. Passend zu deinen Fragen haben wir zwei Empfehlungen zusammengestellt:\n\n- [${productName(ids[0])}](https://motionsports.de/products/${ids[0]})\n- [${productName(ids[1])}](https://motionsports.de/products/${ids[1]})` +
      (discount > 0 ? `\n\nMit dem Code **${code ?? PLACEHOLDER_CODE}** sparst du **${discount} %** — 7 Tage gültig.` : "") + `\n\nSportliche Grüße\nDein motion sports Team`;
    marketingRows.push({
      email_capture_id: captureId, customer_id: c.id, status: sent ? "sent" : "draft",
      subject: `${c.first}, deine Empfehlungen von Mo`, drafted_text: text,
      discount_code: code, discount_code_gid: code ? `gid://shopify/DiscountCodeNode/${9100000000000 + k}` : null,
      discount_expires_at: sent && discount > 0 ? addDays(sentAt, 7) : null, discount_percent: discount,
      product_ids: ids, persona_label: pick(PERSONAS), cart_url: sent ? cartUrlFor(ids, code) : null,
      redirect_token: sent ? urlToken() : null, clicked_at: sent && chance(0.4) ? addMs(sentAt, int(30, 3000) * 60_000) : null,
      sent_at: sentAt, created_at: sent ? addMs(sentAt, -3_600_000) : shopTime(int(0, 4)), updated_at: sentAt ?? shopTime(0),
      admin_instructions: c.admin_instructions, product_highlights: json(ids.map((id) => ({ name: productName(id), description: "Passt zu deinem Setup." }))),
      text_mode: pick(["compact", "detailed"]),
      hero_image_url: null, hero_image_prompt: null, hero_headline: null, hero_image_mobile_url: null,
      c,
    });
  });
  const marketingIds = await insertRows("marketing_sends", ["email_capture_id", "customer_id", "status", "subject", "drafted_text", "discount_code", "discount_code_gid", "discount_expires_at", "discount_percent", "product_ids", "persona_label", "cart_url", "redirect_token", "clicked_at", "sent_at", "created_at", "updated_at", "admin_instructions", "product_highlights", "text_mode", "hero_image_url", "hero_image_prompt", "hero_headline", "hero_image_mobile_url"], marketingRows, {
    casts: { discount_expires_at: "timestamptz", product_ids: "text[]", clicked_at: "timestamptz", sent_at: "timestamptz", created_at: "timestamptz", updated_at: "timestamptz", product_highlights: "jsonb" },
    returning: "id",
  });
  marketingRows.forEach((m, k) => { m.id = Number(marketingIds[k].id); });
  count("marketing_sends", marketingRows.length);
  marketingRows.filter((m) => m.clicked_at).forEach((m) => kpiRows.push({ session_id: m.c.sessionId, event: "marketing_email_clicked", data: json({ sendId: m.id }), created_at: m.clicked_at }));
  marketingRows.forEach((m) => usageRows.push({ convIndex: null, campaign_contact_id: null, call_site: "marketing_draft", model: "claude-sonnet-4-6", input_tokens: int(4000, 8000), output_tokens: int(300, 600), cache_read_tokens: 0, cache_write_tokens: 0, estimated: false, created_at: m.created_at }));

  // ── Correspondence + physical letters ────────────────────────────────────────
  const mailRows = [];
  const correspondents = customers.slice(0, 12);
  correspondents.forEach((c, k) => {
    const threadId = `<${hex(16)}@mail.motionsports.de>`;
    const t0 = shopTime(int(2, 60));
    mailRows.push({ customer_id: c.id, direction: "sent", channel: "email", message_id: threadId, in_reply_to: null, references_ids: [], thread_id: threadId, from_address: "motion sports <kontakt@motionsports.de>", to_address: c.email, subject: pick(["Deine Frage zur Lieferzeit", "Rückfrage zu deiner Bestellung", "Deine Beratung mit Mo — Nachtrag"]), body_text: `Hallo ${c.first},\n\ndanke für deine Nachricht. Die Lieferung erfolgt frei Bordsteinkante innerhalb von 5–8 Werktagen.\n\nViele Grüße\nJulia vom motion sports Team`, body_html: null, snippet: "danke für deine Nachricht. Die Lieferung erfolgt frei Bordsteinkante…", attachments: json([]), provider: "resend", provider_email_id: `re_${hex(24)}`, marketing_send_id: null, occurred_at: t0, created_at: t0 });
    if (k % 2 === 0) {
      const replyId = `<${hex(16)}@${DOMAINS[k % DOMAINS.length]}>`;
      const t1 = addMs(t0, int(2, 48) * 3_600_000);
      mailRows.push({ customer_id: c.id, direction: "received", channel: "email", message_id: replyId, in_reply_to: threadId, references_ids: [threadId], thread_id: threadId, from_address: c.email, to_address: "bot@chat.motionsports.de", subject: "Re: Deine Frage zur Lieferzeit", body_text: `Danke, das passt. Können Sie die Lieferung auf Samstag legen?\n\nViele Grüße\n${c.first} ${c.last}`, body_html: null, snippet: "Danke, das passt. Können Sie die Lieferung auf Samstag legen?", attachments: json(k % 4 === 0 ? [{ filename: "Rechnung.pdf", content_type: "application/pdf", size: 48213 }] : []), provider: "resend", provider_email_id: `re_${hex(24)}`, marketing_send_id: null, occurred_at: t1, created_at: t1 });
    }
  });
  for (let k = 0; k < 3; k++) {
    const t = shopTime(int(0, 6));
    mailRows.push({ customer_id: null, direction: "received", channel: "email", message_id: `<${hex(16)}@unknown.example>`, in_reply_to: null, references_ids: [], thread_id: `<${hex(16)}@unknown.example>`, from_address: `neu${k}@example.com`, to_address: "bot@chat.motionsports.de", subject: pick(["Frage zu Ihrem Angebot", "Anfrage Studioausstattung", "Reklamation Lieferung"]), body_text: "Guten Tag, ich habe Ihre E-Mail weitergeleitet bekommen und hätte eine Frage zur Lieferzeit der Hantelbank.", body_html: null, snippet: "Guten Tag, ich habe Ihre E-Mail weitergeleitet bekommen und hätte eine Frage…", attachments: json([]), provider: "resend", provider_email_id: `re_${hex(24)}`, marketing_send_id: null, occurred_at: t, created_at: t });
  }
  await insertRows("email_messages", ["customer_id", "direction", "channel", "message_id", "in_reply_to", "references_ids", "thread_id", "from_address", "to_address", "subject", "body_text", "body_html", "snippet", "attachments", "provider", "provider_email_id", "marketing_send_id", "occurred_at", "created_at"], mailRows, {
    casts: { references_ids: "text[]", attachments: "jsonb", occurred_at: "timestamptz", created_at: "timestamptz" },
  });
  count("email_messages", mailRows.length);

  const letterRows = [];
  customers.filter((c) => c.postal_address).slice(0, 6).forEach((c, k) => {
    const addr = JSON.parse(c.postal_address);
    const status = ["posted", "posted", "printing", "submitted", "failed", "undeliverable"][k];
    const t = shopTime(int(3, 50));
    letterRows.push({ customer_id: c.id, marketing_send_id: null, provider: "pingen", provider_letter_id: status === "failed" ? null : `ltr_${hex(20)}`, status, recipient_name: addr.name, recipient_company: null, recipient_address_line1: addr.address_line_1, recipient_address_line2: null, recipient_postal_code: addr.postal_code, recipient_city: addr.city, recipient_country: addr.country, cost_cents: status === "posted" ? pick([106, 125]) : null, error: status === "failed" ? "Pingen: 422 address_invalid (postal code)" : null, created_at: t, submitted_at: status === "failed" ? null : addMs(t, 120_000), updated_at: addMs(t, 3_600_000), subject: "Ihr persönliches Angebot", body: `Sehr geehrte/r ${addr.name},\n\nvielen Dank für Ihr Vertrauen in motion sports. Anbei unser Vorschlag für Ihr Training zu Hause.\n\nMit sportlichen Grüßen\nIhr motion sports Team` });
  });
  await insertRows("physical_letters", ["customer_id", "marketing_send_id", "provider", "provider_letter_id", "status", "recipient_name", "recipient_company", "recipient_address_line1", "recipient_address_line2", "recipient_postal_code", "recipient_city", "recipient_country", "cost_cents", "error", "created_at", "submitted_at", "updated_at", "subject", "body"], letterRows, { casts: { created_at: "timestamptz", submitted_at: "timestamptz", updated_at: "timestamptz" } });
  count("physical_letters", letterRows.length);

  // ── Feedback ────────────────────────────────────────────────────────────────
  const feedbackRows = [];
  const FEEDBACK_TEXTS = ["Mo hat mir super geholfen, die richtige Bank zu finden!", "Die Antworten kamen etwas langsam, aber inhaltlich top.", "Hätte gern mehr Infos zur Lieferzeit gehabt.", "Sehr freundlich, aber die Produktkarten waren auf dem Handy abgeschnitten.", "Perfekt — habe direkt bestellt.", "Ich wollte eigentlich mit einem Menschen sprechen.", "Empfehlungen passten gut zu meinem Budget.", "Der Vergleich zwischen den Bikes war hilfreich."];
  for (let k = 0; k < 20; k++) {
    const conv = conversations[int(0, conversations.length - 1)];
    feedbackRows.push({ message: pick(FEEDBACK_TEXTS), session_id: conv.session_id, conversation_id: k % 3 === 0 ? null : conv.conversation_key, tier: conv.customer_id ? (customers.find((c) => c.id === conv.customer_id)?.tier === 3 ? "signed-in" : "email") : "anonymous", email: k % 4 === 0 ? customers[k % customers.length].email : null, page: pick(["/", "/products/" + ALL_PRODUCTS[k % ALL_PRODUCTS.length], "/collections/hantelbaenke"]), created_at: addMs(conv.last_activity_at, int(1, 30) * 60_000), rating: null, email_kind: null });
  }
  for (let k = 0; k < 5; k++) {
    const rating = pick([3, 4, 4, 5, 5]);
    feedbackRows.push({ message: `Newsletter-Bewertung: ${rating}/5 (campaign)`, session_id: null, conversation_id: null, tier: null, email: null, page: "email:campaign", created_at: shopTime(int(0, 30)), rating, email_kind: "campaign" });
  }
  await insertRows("feedback", ["message", "session_id", "conversation_id", "tier", "email", "page", "created_at", "rating", "email_kind"], feedbackRows, { casts: { created_at: "timestamptz" } });
  count("feedback", feedbackRows.length);

  // ── Q&A knowledge ────────────────────────────────────────────────────────────
  const QA = [
    ["Wie laut ist das Air Bike in einer Mietwohnung?", P.airBike, "Kunde fragte nach Lautstärke des Air Bikes; Mo konnte keine dB-Angabe machen.", "Das Air Bike erzeugt bei Intervallen ein deutlich hörbares Lüftergeräusch (ca. 70–75 dB). Für Mietwohnungen empfehlen wir ein Ergometer oder das Training tagsüber."],
    ["Passt die klappbare Hantelbank unter ein Bett mit 20 cm Bodenfreiheit?", P.benchFold, "Maße im zusammengeklappten Zustand fehlten im Gespräch.", "Zusammengeklappt ist die Bank ca. 25 cm hoch — unter ein Bett mit 20 cm Bodenfreiheit passt sie nicht, hinter eine Tür oder an die Wand gelehnt schon."],
    ["Welche Deckenhöhe braucht das Power Rack PRX-510?", P.rack510, "Deckenhöhe war unklar; Kunde hat abgebrochen.", "Das Rack ist 195 cm hoch; mit Klimmzügen empfehlen wir mindestens 2,30 m Raumhöhe, für reines Rack-Training reichen 2,05 m."],
    ["Bieten Sie Ratenzahlung an?", null, "Zahlungsfrage konnte Mo nicht beantworten.", "Ja, im Checkout stehen Klarna-Ratenkauf (3–36 Monate) und PayPal Ratenzahlung zur Verfügung."],
    ["Wie lange dauert die Lieferung von Speditionsware?", null, "Lieferzeit für Sperrgut nicht bekannt.", "Speditionsware liefern wir innerhalb von 5–8 Werktagen frei Bordsteinkante; die Spedition vereinbart telefonisch einen Termin."],
    ["Sind die Bumper Plates für Olympia-Stangen (50 mm) geeignet?", P.bumper150, "Lochdurchmesser nicht im Gespräch verfügbar.", "Ja, alle ATX Bumper Plates haben 50,4 mm Bohrung und passen auf jede Olympia-Stange."],
    ["Kann ich die Loop-Bänder in der Waschmaschine reinigen?", P.loopBands, "Pflegehinweis fehlte.", "Bitte nur mit mildem Seifenwasser abwischen — Waschmaschine und Trockner beschädigen das Latex."],
    ["Gibt es die Nüobell auch in 2–20 kg?", P.nuobell, "Variantenfrage offen.", "Ja, die Nüobell gibt es als 2–20 kg und 2–32 kg; die 20-kg-Version ist kompakter und günstiger."],
    ["Do you ship to Austria?", null, "Versand nach Österreich unklar (englische Beratung).", "Yes — we ship to Austria; bulky items go by freight forwarder within 7–10 working days."],
    ["Welche Matte dämpft Trittschall am besten?", P.matFitline, "Vergleich Matten-Dicke fehlte.", "Für Trittschall empfehlen wir Bodenschutzplatten (20 mm); die Airex Fitline ist eine Übungsmatte, keine Schallschutzmatte."],
  ];
  const qaRows = [];
  const qaStatuses = ["open", "open", "open", "answered", "answered", "published", "published", "published", "dismissed", "open"];
  for (let k = 0; k < 20; k++) {
    const [q, productId, gap, answer] = QA[k % QA.length];
    const status = qaStatuses[k % qaStatuses.length];
    const conv = conversations[(k * 7) % conversations.length];
    const created = shopTime(int(1, 60));
    const question = k >= QA.length ? `${q} (Variante ${k})` : q;
    qaRows.push({ conversation_id: conv.id, product_id: productId, product_title: productId ? productName(productId) : null, gap_summary: gap, question, question_fingerprint: sha256(question.toLowerCase()), answer: status === "open" ? null : answer, status, model: "claude-haiku-4-5", input_tokens: int(1500, 3000), output_tokens: int(80, 200), created_at: created, updated_at: status === "open" ? created : addMs(created, int(2, 72) * 3_600_000), answered_at: status === "open" ? null : addMs(created, int(2, 48) * 3_600_000), published_at: status === "published" ? addMs(created, int(48, 96) * 3_600_000) : null, question_en: status === "published" ? "How loud is the air bike in an apartment?" : null, answer_en: status === "published" ? "The air bike produces a clearly audible fan noise during intervals; we recommend an ergometer for apartments." : null });
  }
  await insertRows("qa_entries", ["conversation_id", "product_id", "product_title", "gap_summary", "question", "question_fingerprint", "answer", "status", "model", "input_tokens", "output_tokens", "created_at", "updated_at", "answered_at", "published_at", "question_en", "answer_en"], qaRows, { casts: { created_at: "timestamptz", updated_at: "timestamptz", answered_at: "timestamptz", published_at: "timestamptz" } });
  count("qa_entries", qaRows.length);
  qaRows.forEach((q) => usageRows.push({ convIndex: null, campaign_contact_id: null, call_site: "qa_draft", model: "claude-haiku-4-5", input_tokens: q.input_tokens, output_tokens: q.output_tokens, cache_read_tokens: 0, cache_write_tokens: 0, estimated: false, created_at: q.created_at }));

  // ── Insights, persona summaries, analytics reports, improvement loop ─────────
  const analyzedConvs = conversations.filter((c) => c.analysis_summary);
  const insightsMd = `## Top-Themen & Fragen\n- Homegym-Einstieg mit kleinem Budget (Bank + Hanteln) ist das häufigste Thema.\n- Lautstärke in Mietwohnungen entscheidet zwischen Ergometer und Air Bike.\n- Studios und Praxen fragen nach Angeboten und Mengenrabatten.\n\n## Wo Beratungen stocken oder scheitern\n- Fehlende Maße (Klapphöhe, Deckenhöhe) führen zu Abbrüchen.\n- Lieferzeiten für Speditionsware sind nicht im Wissen hinterlegt.\n\n## Häufige unerfüllte Bedürfnisse\n- Ratenzahlung, Versand nach Österreich, Pflegehinweise.\n\n## Vorschläge zur Verfeinerung\n- Maße und Lieferzeiten als Q&A veröffentlichen.\n- Bei Wohnungs-Kontext proaktiv leise Alternativen nennen.`;
  const refs = analyzedConvs.slice(0, 8).map((c, k) => ({ section: ["top_themen", "stockend", "beduerfnisse", "vorschlaege"][k % 4], conversationId: c.id, reason: pick(["Budget-Einstieg mit Bank + Hanteln", "Abbruch nach Frage zur Deckenhöhe", "Frage nach Ratenzahlung blieb offen", "Leise Alternative wurde gut angenommen"]) }));
  await insertRows("conversation_insights", ["date_from", "date_to", "summary_md", "analyzed_count", "model", "input_tokens", "output_tokens", "generated_at", "references_json"], [
    { date_from: ymdDaysAgo(29), date_to: ymdDaysAgo(0), summary_md: insightsMd, analyzed_count: Math.max(1, analyzedConvs.filter((c) => new Date(c.created_at) >= new Date(at(29))).length), model: "claude-haiku-4-5", input_tokens: 18000, output_tokens: 1400, generated_at: shopTime(0), references_json: json(refs) },
    { date_from: ymdDaysAgo(89), date_to: ymdDaysAgo(0), summary_md: insightsMd, analyzed_count: analyzedConvs.length, model: "claude-haiku-4-5", input_tokens: 41000, output_tokens: 1600, generated_at: shopTime(2), references_json: json(refs.slice(0, 4)) },
  ], { casts: { generated_at: "timestamptz", references_json: "jsonb" } });
  count("conversation_insights", 2);
  usageRows.push({ convIndex: null, campaign_contact_id: null, call_site: "conversation_insights", model: "claude-haiku-4-5", input_tokens: 18000, output_tokens: 1400, cache_read_tokens: 0, cache_write_tokens: 0, estimated: false, created_at: shopTime(0) });

  await insertRows("kpi_persona_question_summaries", ["persona_label", "summary_md", "sample_size", "model", "generated_at"], PERSONAS.slice(0, 4).map((p, k) => ({ persona_label: p, summary_md: `1. **Wie viel Platz brauche ich wirklich?** — taucht in fast jedem Gespräch auf.\n2. **Was ist leise genug für die Wohnung?**\n3. **Reicht das Set für die nächsten Jahre?**\n4. **Wie lange dauert die Lieferung?**`, sample_size: int(30, 80), model: "claude-sonnet-4-6", generated_at: shopTime(k + 1) })), { casts: { generated_at: "timestamptz" } });
  count("kpi_persona_question_summaries", 4);
  usageRows.push({ convIndex: null, campaign_contact_id: null, call_site: "top_questions", model: "claude-sonnet-4-6", input_tokens: 9000, output_tokens: 600, cache_read_tokens: 0, cache_write_tokens: 0, estimated: false, created_at: shopTime(1) });

  const distribution = (key) => {
    const m = new Map();
    for (const c of analyzedConvs) { const v = c[key]; if (v) m.set(v, (m.get(v) ?? 0) + 1); }
    return [...m.entries()].map(([k, n]) => ({ label: key === "analysis_category" ? CATEGORY_LABELS[k] ?? k : QUALITY_LABELS[k] ?? k, count: n })).sort((a, b) => b.count - a.count);
  };
  const reportSections = (from, to, withProfiles) => {
    const inRange = conversations.filter((c) => c.created_at.slice(0, 10) >= from && c.created_at.slice(0, 10) <= to);
    const tiers = { anonymous: inRange.filter((c) => !c.customer_id).length, emailOnly: inRange.filter((c) => c.customer_id && customers.find((x) => x.id === c.customer_id)?.tier !== 3).length, signedIn: inRange.filter((c) => c.customer_id && customers.find((x) => x.id === c.customer_id)?.tier === 3).length };
    return {
      kpis: { conversations: inRange.length, analyzed: inRange.filter((c) => c.analysis_summary).length, tiers, withError: inRange.filter((c) => c.message_count > 0 && c.persona_label == null).length, emailCaptured: inRange.filter((c) => c.customer_id).length, cartUsed: inRange.filter((c) => c.selected_product_ids.length > 0).length, checkoutOffered: inRange.filter((c) => c.recommended_product_ids.length > 0).length },
      spend: { totalEur: 12.84, byCallSite: [{ callSite: "chat", eur: 9.1 }, { callSite: "conversation_analysis", eur: 1.9 }, { callSite: "analytics_report", eur: 1.84 }] },
      categories: distribution("analysis_category"),
      qualities: distribution("analysis_quality"),
      insightsMd,
      personas: PERSONAS.slice(0, 5).map((p) => ({ personaLabel: p, personaDisplay: p.replace(/_/g, " "), chatCount: inRange.filter((c) => c.persona_label === p).length, favoriteProducts: shuffle(ALL_PRODUCTS).slice(0, 3).map((id, k) => ({ productId: id, name: productName(id), count: 9 - k * 2 })), topQuestionsMd: "- Wie viel Platz brauche ich?\n- Was ist leise genug?" })),
      customerKnowledgeMd: "Die meisten identifizierten Kund:innen trainieren zu Hause in Mietwohnungen, kaufen zunächst eine Bank plus Hanteln und ergänzen innerhalb von 30 Tagen Zubehör (Bänder, Matten). Studios und Praxen fragen früh nach Angeboten und bevorzugen persönlichen Kontakt.",
      profiles: withProfiles ? customers.filter((c) => c.profile_summary).slice(0, 4).map((c) => ({ customerId: c.id, name: `${c.first} ${c.last}`, profileSummary: c.profile_summary, sessionCount: conversations.filter((x) => x.customer_id === c.id).length, lastSeenAt: c.last_seen_at })) : [],
      appendix: inRange.filter((c) => c.analysis_summary).slice(0, 25).map((c) => ({ conversationKey: c.conversation_key, createdAt: c.created_at, tier: c.customer_id ? (customers.find((x) => x.id === c.customer_id)?.tier === 3 ? "signedIn" : "emailOnly") : "anonymous", personaDisplay: c.persona_label ? c.persona_label.replace(/_/g, " ") : null, category: c.analysis_category ? CATEGORY_LABELS[c.analysis_category] : null, quality: c.analysis_quality ? QUALITY_LABELS[c.analysis_quality] : null, summary: c.analysis_summary })),
      notes: ["Gespräche ohne Analyse wurden für Verteilungen nicht berücksichtigt."],
    };
  };
  const progressDone = (analyzed) => ({ analyzed, analyzeFailed: 0, analyzeRemaining: 0, personasTotal: 5, personasDone: 5, profilesTotal: 4, profilesDone: 4, profilesFailed: 0 });
  const report1From = ymdDaysAgo(29), report1To = ymdDaysAgo(0);
  const report2From = ymdDaysAgo(89), report2To = ymdDaysAgo(30);
  const sections1 = reportSections(report1From, report1To, true);
  const sections2 = reportSections(report2From, report2To, false);
  const reportRows = [
    { title: `Komplettanalyse ${germanDate(at(29))} – ${germanDate(at(0))}`, date_from: report1From, date_to: report1To, preset: "30d", status: "complete", phase: "done", progress: json(progressDone(sections1.kpis.analyzed)), options: json({ includePerCustomer: true, includeAppendix: true, maxAnalyze: 2000, maxProfiles: 50 }), sections: json(sections1), usage: json({ "claude-haiku-4-5": { input: 61000, output: 4200 }, "claude-sonnet-4-6": { input: 22000, output: 3100 }, "claude-opus-4-8": { input: 9000, output: 1800 } }), error: null, created_at: shopTime(1), updated_at: shopTime(1), completed_at: addMs(shopTime(1), 14 * 60_000) },
    { title: `Komplettanalyse ${germanDate(at(89))} – ${germanDate(at(30))}`, date_from: report2From, date_to: report2To, preset: "custom", status: "complete", phase: "done", progress: json(progressDone(sections2.kpis.analyzed)), options: json({ includePerCustomer: false, includeAppendix: true, maxAnalyze: 2000, maxProfiles: 50 }), sections: json(sections2), usage: json({ "claude-haiku-4-5": { input: 88000, output: 6100 }, "claude-sonnet-4-6": { input: 31000, output: 4200 } }), error: null, created_at: shopTime(31), updated_at: shopTime(31), completed_at: addMs(shopTime(31), 22 * 60_000) },
    { title: `Komplettanalyse ${germanDate(at(6))} – ${germanDate(at(0))}`, date_from: ymdDaysAgo(6), date_to: ymdDaysAgo(0), preset: "7d", status: "failed", phase: "insights", progress: json({ analyzed: 12, analyzeFailed: 1, analyzeRemaining: 0, personasTotal: 0, personasDone: 0, profilesTotal: 0, profilesDone: 0, profilesFailed: 0 }), options: json({ includePerCustomer: false, includeAppendix: false, maxAnalyze: 2000, maxProfiles: 50 }), sections: null, usage: json({ "claude-haiku-4-5": { input: 12000, output: 900 } }), error: "Anthropic API: overloaded_error (529) after 3 retries", created_at: shopTime(0), updated_at: shopTime(0), completed_at: null },
  ];
  const reportIds = await insertRows("analytics_reports", ["title", "date_from", "date_to", "preset", "status", "phase", "progress", "options", "sections", "usage", "error", "created_at", "updated_at", "completed_at"], reportRows, { casts: { progress: "jsonb", options: "jsonb", sections: "jsonb", usage: "jsonb", created_at: "timestamptz", updated_at: "timestamptz", completed_at: "timestamptz" }, returning: "id" });
  count("analytics_reports", reportRows.length);
  usageRows.push({ convIndex: null, campaign_contact_id: null, call_site: "analytics_report", model: "claude-sonnet-4-6", input_tokens: 22000, output_tokens: 3100, cache_read_tokens: 0, cache_write_tokens: 0, estimated: false, created_at: shopTime(1) });

  const baselineOf = (s) => {
    const n = s.kpis.conversations || 1;
    const share = (x) => Math.round((x / n) * 1000) / 10;
    return { conversations: s.kpis.conversations, analyzedShare: share(s.kpis.analyzed), emailCapturedShare: share(s.kpis.emailCaptured), cartUsedShare: share(s.kpis.cartUsed), checkoutOfferedShare: share(s.kpis.checkoutOffered), withErrorShare: share(s.kpis.withError), qualityShares: Object.fromEntries(s.qualities.map((q) => [q.label, share(q.count)])), categoryShares: Object.fromEntries(s.categories.map((q) => [q.label, share(q.count)])) };
  };
  const prevBase = baselineOf(sections2), curBase = baselineOf(sections1);
  const deltaRows = [["emailCapturedShare", "E-Mail-Capture-Quote"], ["cartUsedShare", "Warenkorb-Klick-Quote"], ["checkoutOfferedShare", "Checkout-Angebots-Quote"], ["withErrorShare", "Quote ohne Bot-Antwort"], ["analyzedShare", "Analyse-Abdeckung"]].map(([key, label]) => ({ key, label, prev: prevBase[key], cur: curBase[key], delta: Math.round((curBase[key] - prevBase[key]) * 10) / 10 }));
  const runRows = [
    { report_id: Number(reportIds[1].id), report_title: reportRows[1].title, range_from: report2From, range_to: report2To, prompt_hash: sha256("prompt-v1"), baseline_json: json(prevBase), delta_json: null, effect_check_md: null, status: "complete", phase: "done", error: null, usage: json({ "claude-sonnet-4-6": { input: 14000, output: 2600 } }), created_at: shopTime(28), updated_at: shopTime(28), completed_at: addMs(shopTime(28), 6 * 60_000), step_claimed_at: null },
    { report_id: Number(reportIds[0].id), report_title: reportRows[0].title, range_from: report1From, range_to: report1To, prompt_hash: sha256("prompt-v2"), baseline_json: json(curBase), delta_json: json({ prevConversations: prevBase.conversations, curConversations: curBase.conversations, rows: deltaRows }), effect_check_md: "Die im letzten Lauf beschlossene Anweisung (leise Alternativen bei Wohnungs-Kontext) korreliert mit weniger Abbrüchen in Cardio-Beratungen. Die Capture-Quote ist stabil; ein Effekt der neuen Q&A-Einträge ist noch nicht messbar.", status: "complete", phase: "done", error: null, usage: json({ "claude-sonnet-4-6": { input: 19000, output: 3900 } }), created_at: shopTime(1), updated_at: shopTime(1), completed_at: addMs(shopTime(1), 7 * 60_000), step_claimed_at: null },
    { report_id: Number(reportIds[0].id), report_title: reportRows[0].title, range_from: report1From, range_to: report1To, prompt_hash: sha256("prompt-v2"), baseline_json: json(curBase), delta_json: null, effect_check_md: null, status: "running", phase: "vorschlaege_shop", error: null, usage: json({}), created_at: shopTime(0), updated_at: shopTime(0), completed_at: null, step_claimed_at: null },
  ];
  const runIds = await insertRows("improvement_runs", ["report_id", "report_title", "range_from", "range_to", "prompt_hash", "baseline_json", "delta_json", "effect_check_md", "status", "phase", "error", "usage", "created_at", "updated_at", "completed_at", "step_claimed_at"], runRows, { casts: { baseline_json: "jsonb", delta_json: "jsonb", usage: "jsonb", created_at: "timestamptz", updated_at: "timestamptz", completed_at: "timestamptz", step_claimed_at: "timestamptz" }, returning: "id" });
  count("improvement_runs", runRows.length);
  const SUGGESTIONS = [
    ["mo", "anweisung", "Bei Mietwohnungen proaktiv leise Alternativen nennen", "Wenn ein Kunde eine Wohnung oder Nachbarn erwähnt, weise unaufgefordert auf leise Alternativen (Ergometer statt Air Bike, gummierte Hanteln, Bodenschutzplatten) hin.", "implemented", "hoch", "niedrig"],
    ["mo", "wissen", "Lieferzeiten für Speditionsware ins Wissen aufnehmen", null, "accepted", "hoch", "niedrig"],
    ["mo", "anweisung", "Maße immer mit Klapp- und Aufbaumaß angeben", "Nenne bei Bänken und Racks immer beide Maße: aufgebaut und zusammengeklappt/verpackt, inklusive der benötigten Deckenhöhe.", "open", "mittel", "niedrig"],
    ["shop", "produktdaten", "Lautstärke-Angaben (dB) auf Cardio-Produktseiten ergänzen", null, "open", "hoch", "mittel"],
    ["shop", "preis_angebot", "Ratenzahlung im Warenkorb prominenter zeigen", null, "dismissed", "mittel", "mittel"],
    ["shop", "prozess", "Studio-Anfragen innerhalb von 24 h beantworten", null, "accepted", "mittel", "hoch"],
  ];
  const suggestionRows = SUGGESTIONS.map(([lane, category, title, directive, status, impact, effort]) => ({ run_id: Number(runIds[1].id), lane, category, title, fingerprint: sha256(title.toLowerCase()), rationale_md: `In ${int(4, 12)} analysierten Gesprächen des Zeitraums trat dieses Muster auf. ${pick(["Die Abbruchquote lag dort deutlich über dem Durchschnitt.", "Kund:innen fragten explizit danach.", "Mo konnte die Frage nicht beantworten und verwies ans Team."])}`, proposal_md: directive ? `Als Anweisung aktivieren: „${directive}“` : `**Vorschlag:** ${title}.\n\nUmsetzung durch das Shop-Team; Mo verweist bis dahin auf das Kontaktformular.`, directive_text: directive, expected_effect: pick(["Weniger Abbrüche in Cardio-Beratungen (Qualität „Abgesprungen“ sinkt).", "Höhere Warenkorb-Klick-Quote.", "Weniger Übergaben ans Kontaktformular."]), impact, effort, evidence_json: json([`Gespräch #${analyzedConvs[0]?.id ?? 1}: Frage nach Lautstärke blieb offen`, `Gespräch #${analyzedConvs[1]?.id ?? 2}: Abbruch nach Maßfrage`]), status, status_note: status === "dismissed" ? "Klarna-Badge ist bereits im Checkout — kein Handlungsbedarf." : null, status_changed_at: status === "open" ? null : shopTime(int(0, 1)), created_at: shopTime(1), updated_at: shopTime(int(0, 1)) }));
  const suggestionIds = await insertRows("improvement_suggestions", ["run_id", "lane", "category", "title", "fingerprint", "rationale_md", "proposal_md", "directive_text", "expected_effect", "impact", "effort", "evidence_json", "status", "status_note", "status_changed_at", "created_at", "updated_at"], suggestionRows, { casts: { evidence_json: "jsonb", status_changed_at: "timestamptz", created_at: "timestamptz", updated_at: "timestamptz" }, returning: "id" });
  count("improvement_suggestions", suggestionRows.length);
  void SHOP_CATEGORIES; void MO_CATEGORIES;

  const directiveRows = [
    { content: SUGGESTIONS[0][3], active: true, source: "suggestion", suggestion_id: Number(suggestionIds[0].id), created_at: shopTime(1), updated_at: shopTime(1) },
    { content: "Wenn ein Kunde nach Lieferzeiten für Speditionsware fragt, weise proaktiv auf die Lieferung frei Bordsteinkante (5–8 Werktage) hin.", active: true, source: "operator", suggestion_id: null, created_at: shopTime(20), updated_at: shopTime(20) },
    { content: "Empfiehl bei Budgets unter 500 € zuerst Bank, Hanteln und Matte — kein Rack.", active: true, source: "operator", suggestion_id: null, created_at: shopTime(45), updated_at: shopTime(10) },
    { content: "Erwähne die Sommeraktion auf Rudergeräte.", active: false, source: "operator", suggestion_id: null, created_at: shopTime(70), updated_at: shopTime(30) },
  ];
  const directiveIds = await insertRows("mo_directives", ["content", "active", "source", "suggestion_id", "created_at", "updated_at"], directiveRows, { casts: { created_at: "timestamptz", updated_at: "timestamptz" }, returning: "id" });
  count("mo_directives", directiveRows.length);
  const versionRows = [];
  directiveRows.forEach((d, k) => {
    const id = Number(directiveIds[k].id);
    versionRows.push({ directive_id: id, content: d.content, active: true, action: "created", created_at: d.created_at });
    if (k === 2) versionRows.push({ directive_id: id, content: d.content, active: true, action: "updated", created_at: d.updated_at });
    if (k === 3) versionRows.push({ directive_id: id, content: d.content, active: false, action: "deactivated", created_at: d.updated_at });
  });
  await insertRows("mo_directive_versions", ["directive_id", "content", "active", "action", "created_at"], versionRows, { casts: { created_at: "timestamptz" } });
  count("mo_directive_versions", versionRows.length);

  await insertRows("email_design_selections", ["email_kind", "design_key", "updated_at"], [
    { email_kind: "campaign", design_key: "performance", updated_at: shopTime(3) },
    { email_kind: "marketing", design_key: "studio", updated_at: shopTime(9) },
  ], { casts: { updated_at: "timestamptz" } });
  count("email_design_selections", 2);

  // ── Order attribution ────────────────────────────────────────────────────────
  const tokenRows = [];
  const orderRows = [];
  for (let k = 0; k < 40; k++) {
    const conv = conversations[(k * 3) % conversations.length];
    tokenRows.push({ token: urlToken(), session_id: conv.session_id, source: pick(["widget", "widget", "summary_email", "marketing_email", "bundle"]), created_at: addMs(conv.created_at, 60_000) });
  }
  await insertRows("mo_attribution_tokens", ["token", "session_id", "source", "created_at"], tokenRows, { casts: { created_at: "timestamptz" } });
  count("mo_attribution_tokens", tokenRows.length);
  const mkCodes = sends.filter((s) => s.discount_code).map((s) => s.discount_code);
  const msCodes = marketingRows.filter((m) => m.discount_code).map((m) => m.discount_code);
  for (let k = 0; k < 30; k++) {
    const tok = tokenRows[k % tokenRows.length];
    const conv = conversations.find((c) => c.session_id === tok.session_id);
    const items = shuffle(ALL_PRODUCTS).slice(0, int(1, 3));
    const overlap = conv ? items.some((id) => conv.recommended_product_ids.includes(id)) : false;
    const withCode = k % 4 === 0 ? (k % 8 === 0 ? mkCodes[k % Math.max(1, mkCodes.length)] : msCodes[k % Math.max(1, msCodes.length)]) : null;
    const tier = withCode || ["summary_email", "marketing_email", "bundle"].includes(tok.source) ? "direct" : overlap ? "assisted" : "influenced";
    const processed = shopTime(int(0, 85));
    orderRows.push({ shopify_order_id: String(5500000000000 + k), order_name: `#${1500 + k}`, processed_at: processed, financial_status: k % 9 === 8 ? "PENDING" : "PAID", currency: "EUR", total_price: money(items.reduce((s, id) => s + productPrice(id), 0)), discount_codes: withCode ? [withCode] : [], line_items: json(items.map((id) => ({ title: productName(id), handle: id, quantity: 1, price: money(productPrice(id)) }))), attribution_token: tok.token, session_id: tok.session_id, attribution_source: withCode ? "discount_code" : tok.source, attribution_tier: tier, recommended_overlap: overlap, matched_handles: overlap && conv ? items.filter((id) => conv.recommended_product_ids.includes(id)) : [], created_at: processed, updated_at: processed });
  }
  await insertRows("mo_orders", ["shopify_order_id", "order_name", "processed_at", "financial_status", "currency", "total_price", "discount_codes", "line_items", "attribution_token", "session_id", "attribution_source", "attribution_tier", "recommended_overlap", "matched_handles", "created_at", "updated_at"], orderRows, { casts: { processed_at: "timestamptz", discount_codes: "text[]", line_items: "jsonb", matched_handles: "text[]", created_at: "timestamptz", updated_at: "timestamptz" } });
  count("mo_orders", orderRows.length);

  // ── Telemetry + AI usage + access log ────────────────────────────────────────
  for (let k = 0; k < 6; k++) kpiRows.push({ session_id: `sess_${hex(24)}`, event: "contact_form_submitted", data: json({ reason: pick(["studio", "rehab", "public_procurement"]) }), created_at: shopTime(int(0, 60)) });
  for (let k = 0; k < 3; k++) kpiRows.push({ session_id: customers[k].sessionId, event: pick(["account_export_requested", "account_erased"]), data: json({}), created_at: shopTime(int(0, 40)) });
  await insertRows("kpi_events", ["session_id", "event", "data", "created_at"], kpiRows, { casts: { data: "jsonb", created_at: "timestamptz" } });
  count("kpi_events", kpiRows.length);

  customers.filter((c) => c.profile_summary).forEach((c) => usageRows.push({ convIndex: null, campaign_contact_id: null, call_site: "customer_profile", model: "claude-opus-4-8", input_tokens: int(6000, 12000), output_tokens: int(400, 900), cache_read_tokens: 0, cache_write_tokens: 0, estimated: false, created_at: c.profile_summary_updated_at ?? shopTime(5) }));
  await insertRows("ai_usage", ["conversation_id", "campaign_contact_id", "call_site", "model", "input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens", "estimated", "created_at"],
    usageRows.map((u) => ({ conversation_id: u.convIndex == null ? null : conversations[u.convIndex].id, campaign_contact_id: u.campaign_contact_id ?? null, call_site: u.call_site, model: u.model, input_tokens: u.input_tokens, output_tokens: u.output_tokens, cache_read_tokens: u.cache_read_tokens, cache_write_tokens: u.cache_write_tokens, estimated: u.estimated, created_at: u.created_at })),
    { casts: { created_at: "timestamptz" } });
  count("ai_usage", usageRows.length);

  const accessRows = ["customer.profile.generate", "conversation.view", "correspondence.read", "conversation.analyze", "email_hero.generate", "analytics.report.create", "directive.toggle", "conversation.view"].map((action, k) => ({ action, target_customer_id: k % 2 === 0 ? customers[k].id : null, detail: json({ via: "admin" }), ip: "203.0.113.42", session_fp: hex(12), occurred_at: shopTime(int(0, 10)) }));
  await insertRows("admin_access_log", ["action", "target_customer_id", "detail", "ip", "session_fp", "occurred_at"], accessRows, { casts: { detail: "jsonb", occurred_at: "timestamptz" } });
  count("admin_access_log", accessRows.length);

  console.log("[seed-dev] done — rows per table:");
  for (const [t, n] of Object.entries(counts).sort()) console.log(`  ${t.padEnd(34)} ${String(n).padStart(6)}`);
}

main().catch((err) => {
  console.error("[seed-dev] Failed:", err);
  process.exit(1);
});

