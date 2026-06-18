// The text that gets embedded for each product — the QUALITY lever for semantic
// retrieval. ONE source of truth shared by the cron sync
// (api/cron/sync-catalog), the runtime mapper (catalog-mapping.ts re-exports it)
// and the offline builder (scripts/build-embeddings.mjs), so the doc shape can
// never drift between "what we embedded" and "what we'd embed now".
//
// GOAL: put each product's vector in the SAME need-space the customer describes
// their problem in. A shopper types "leises Laufband für die Wohnung" or
// "gelenkschonendes Cardio nach Knie-OP", not the product's spec sheet. So the
// embedded doc leads with WHAT PROBLEM THE PRODUCT SOLVES and WHO IT'S FOR — in
// the words customers actually use — then backs it with the real description,
// every meaningful feature, and the technical data. The previous doc truncated
// the description to 240 chars and capped features at 12, dropping exactly the
// signal that drives recall; this version raises those limits (with a sane upper
// bound well under the 8192-token per-input cap) and adds derived use-case /
// benefit phrasing.
//
// VERSIONING: EMBEDDING_DOC_VERSION is stamped into the embeddings blob. When the
// doc composition changes, bump it — the sync then knows the stored vectors are
// stale and MUST be regenerated (the carry-forward path refuses to reuse a vector
// whose docVersion no longer matches; see embed-resilience.mjs). embeddingDocHash
// lets the per-product webhook update (Part E) skip re-embedding when only
// non-text fields (e.g. stock) changed.

import { createHash } from "node:crypto";

// Bump whenever buildEmbeddingDoc's OUTPUT shape changes in a way that should
// force a full re-embed on the next sync. v1 = the old "Name/Kategorie/…/≤12
// features/240-char description" doc; v2 = this problem-oriented doc.
export const EMBEDDING_DOC_VERSION = 2;

// Upper bounds — generous (the old doc dropped real signal) but safely under the
// model's 8192-token-per-input cap. ~6000 chars of German ≈ ~2000 tokens.
const MAX_DESCRIPTION_CHARS = 1200;
const MAX_FEATURES = 40;
const MAX_SPECS = 40;
const MAX_DOC_CHARS = 6000;

/** Stable short hash of a doc string — used to detect that a product's embedded
 *  text changed (so the webhook path re-embeds only when it actually must). */
export function embeddingDocHash(doc) {
  return createHash("sha256").update(String(doc ?? ""), "utf8").digest("hex").slice(0, 16);
}

function clip(s, max) {
  const str = String(s ?? "").trim();
  if (str.length <= max) return str;
  const cut = str.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trim() + "…";
}

function uniqueNonEmpty(values, max) {
  const seen = new Set();
  const out = [];
  for (const raw of values ?? []) {
    const v = typeof raw === "string" ? raw.trim() : raw == null ? "" : String(raw).trim();
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Derive customer-language use-case / benefit phrases from the product's signals
 * (category, footprint, noise, rehab flag, target group, tags, features, specs).
 * Deterministic and data-driven so the same product always yields the same doc.
 * These phrases are the bridge between a spec sheet and a shopper's described
 * NEED — e.g. a foldable, small-footprint cardio machine gains "kompaktes
 * Heim-Gym für kleine Wohnungen" and "kniefreundliches Low-Impact-Cardio".
 *
 * @param {object} p a Product-shaped object
 * @returns {string[]} ordered, de-duplicated benefit phrases
 */
export function deriveUseCases(p) {
  const phrases = [];
  const cat = (p?.category || "").toLowerCase();
  const name = (p?.name || "").toLowerCase();
  const haystack = [
    name,
    cat,
    (p?.brand || "").toLowerCase(),
    (p?.tags || []).join(" ").toLowerCase(),
    (p?.features || []).join(" ").toLowerCase(),
    (p?.targetGroup || []).join(" ").toLowerCase(),
    Object.entries(p?.specifications || {})
      .map(([k, v]) => `${k} ${v}`)
      .join(" ")
      .toLowerCase(),
  ].join(" ");

  const has = (...needles) => needles.some((n) => haystack.includes(n));

  // --- Trainings-Domäne (Kraft vs. Cardio vs. funktionell) -------------------
  const isCardio = has(
    "laufband", "treadmill", "crosstrainer", "ellipsen", "ergometer", "fahrrad",
    "bike", "rudergerät", "rudergerat", "rower", "stepper", "cardio", "ausdauer"
  );
  const isStrength = has(
    "kraftstation", "power rack", "rack", "hantel", "kurzhantel", "langhantel",
    "gewicht", "bank", "klimmzug", "dip", "kabelzug", "smith", "kraft", "muskel"
  );
  const isFunctional = has(
    "kettlebell", "functional", "schlingentrainer", "sling", "trx", "medizinball",
    "widerstandsband", "resistance", "faszien", "balance"
  );
  if (isCardio) phrases.push("Ausdauertraining und Cardio für zu Hause");
  if (isStrength) phrases.push("Krafttraining und Muskelaufbau");
  if (isFunctional) phrases.push("funktionelles Ganzkörper- und Beweglichkeitstraining");

  // --- Gelenkschonend / Low-Impact ------------------------------------------
  const lowImpact = has(
    "crosstrainer", "ellipsen", "rudergerät", "rudergerat", "rower",
    "liege-ergometer", "liegeergometer", "recumbent", "gelenkschonend", "low impact"
  );
  if (lowImpact) phrases.push("kniefreundliches, gelenkschonendes Low-Impact-Cardio");

  // --- Platz / Wohnung -------------------------------------------------------
  const foldable = has("klappbar", "faltbar", "klapp", "platzsparend", "kompakt", "foldable");
  const smallFootprint =
    typeof p?.footprintM2 === "number" && p.footprintM2 > 0 && p.footprintM2 <= 2;
  if (foldable || smallFootprint) {
    phrases.push("kompaktes, platzsparendes Heim-Gym für kleine Wohnungen");
  }

  // --- Lautstärke / Mietwohnung ---------------------------------------------
  const quiet =
    has("leise", "geräuscharm", "gerauscharm", "silent", "flüsterleise") ||
    (typeof p?.noiseLevelDb === "number" && p.noiseLevelDb > 0 && p.noiseLevelDb <= 60);
  if (quiet) phrases.push("leise genug für die Mietwohnung und das Mehrfamilienhaus");

  // --- Reha / Physio ---------------------------------------------------------
  const rehab =
    p?.medicalCertification?.suitableForRehab === true ||
    has("reha", "physio", "therapie", "rehabilitation", "praxis");
  if (rehab) phrases.push("geeignet für Reha, Physiotherapie und gelenkschonendes Aufbautraining");

  // --- Einsteiger vs. Profi --------------------------------------------------
  const beginner = has("einsteiger", "anfänger", "anfanger", "einstieg", "verstellbar", "progressiv");
  if (beginner) phrases.push("progressiver, verstellbarer Widerstand für Kraft- und Cardio-Einsteiger");
  const pro = has("profi", "studio", "gewerblich", "commercial", "dauerbetrieb");
  if (pro) phrases.push("studiotauglich und robust für ambitioniertes oder gewerbliches Training");

  return uniqueNonEmpty(phrases, 8);
}

/**
 * Build the text embedded for a single product. Order is deliberate: identity →
 * who/what-for → real description → features → technical data → audience, so the
 * highest-signal, customer-language content leads. Missing fields are skipped
 * cleanly (the committed fallback bundle carries fewer fields than a live sync).
 *
 * @param {object} p a Product-shaped object
 * @returns {string}
 */
export function buildEmbeddingDoc(p) {
  const lines = [];

  // Identity line — name, category, brand together (the anchor terms).
  const ident = [p?.name, p?.category && `Kategorie: ${p.category}`, p?.brand && `Marke: ${p.brand}`]
    .filter(Boolean)
    .join(" — ");
  if (ident) lines.push(ident);
  if (p?.series) lines.push(`Serie: ${p.series}`);

  // Price (incl. sale) — shoppers filter hard on budget.
  if (typeof p?.price === "number") {
    const sale =
      typeof p?.salePrice === "number" && p.salePrice > 0 && p.salePrice < p.price
        ? ` (reduziert auf ${p.salePrice} EUR)`
        : "";
    lines.push(`Preis: ${p.price} EUR${sale}`);
  }

  // WHO / WHAT FOR — the need-space bridge. This is the new, highest-leverage
  // section: it states the problem the product solves in customer language.
  const useCases = deriveUseCases(p);
  if (useCases.length) {
    lines.push("", "Wofür und für wen geeignet:");
    for (const phrase of useCases) lines.push(`- ${phrase}`);
  }

  // Meaningful description — the OLD doc clipped this to 240 chars (dropping most
  // of the real signal). Prefer the full detailed description, clipped to a sane
  // bound; fall back to the short one.
  const description = clip(p?.detailedDescription || p?.shortDescription || "", MAX_DESCRIPTION_CHARS);
  if (description) lines.push("", "Beschreibung:", description);

  // ALL meaningful features (no hard 12 cap — up to MAX_FEATURES).
  const features = uniqueNonEmpty(p?.features, MAX_FEATURES);
  if (features.length) {
    lines.push("", "Eigenschaften:");
    for (const f of features) lines.push(`- ${f}`);
  }

  // Technical data (specs) — material, dimensions, weight, colour, certification…
  const specEntries = Object.entries(p?.specifications || {})
    .filter(([k, v]) => k && v != null && String(v).trim() !== "" && String(v).trim() !== "—")
    .slice(0, MAX_SPECS);
  if (specEntries.length) {
    lines.push("", "Technische Daten:");
    for (const [k, v] of specEntries) lines.push(`- ${k}: ${v}`);
  }

  // Structured audience / discovery signals.
  const targetGroup = uniqueNonEmpty(p?.targetGroup, 12);
  if (targetGroup.length) lines.push("", `Zielgruppe: ${targetGroup.join(", ")}`);
  const tags = uniqueNonEmpty(p?.tags, 20);
  if (tags.length) lines.push(`Tags: ${tags.join(", ")}`);

  // Explicit persona flags (kept from v1 so the existing filters still match).
  if (p?.medicalCertification?.suitableForRehab === true) lines.push("Reha-geeignet: ja");
  if (typeof p?.noiseLevelDb === "number") lines.push(`Lautstärke: ${p.noiseLevelDb} dB`);
  if (typeof p?.footprintM2 === "number" && p.footprintM2 > 0) {
    lines.push(`Stellfläche: ca. ${p.footprintM2} m²`);
  }

  return clip(lines.join("\n"), MAX_DOC_CHARS);
}
