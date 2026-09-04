// Hero-image VARIANT COMPARISON for a client meeting: renders the same real
// hero prompts in several variants (quality level, with/without the products'
// catalogue photos as references) through the exact production pipeline
// (model attempt chain, native hero format, legibility gradient, mobile crop,
// automatic quality check) and writes ONE self-contained HTML sheet with the
// results side by side, blind first, labels + real cost + check on reveal.
//
//   npm run hero:compare                      # 5 newest stored prompts: medium, high, high+refs
//   npm run hero:compare -- --count 8
//   npm run hero:compare -- --prompts prompts.txt   # own prompts, blank-line separated (no references)
//   npm run hero:compare -- --variants high,high+refs --out hero-compare-refs
//   npm run hero:compare -- --dry-run         # no API calls: layout check with the default asset
//
// Prompts come from the drafts' stored hero prompts (what "Hero vorschlagen"
// produced for real contacts / sends), newest first — together with the
// drafts' product ids, so the "+refs" variants get the same reference photos
// a real render gets. Nothing is written to the database or the blob store;
// the images land in --out (default ./hero-compare, git-ignored) next to
// index.html.
//
// Needs OPENAI_API_KEY (and DATABASE_URL unless --prompts is given);
// ANTHROPIC_API_KEY switches the automatic check on.

import process from "node:process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import OpenAI, { toFile } from "openai";
import { neon } from "@neondatabase/serverless";
import { ensureHeroStyleTail, normalizeHeroPrompt } from "../src/lib/email-hero-context.mjs";
import { buildHeroVariants, heroImageAttempts } from "../src/lib/email-hero-variants.mjs";
import {
  loadReferenceImages,
  ownedProductIds,
  pickReferenceCandidates,
  withReferenceInstruction,
} from "../src/lib/email-hero-references.mjs";
import { heroQaEnabled, reviewHeroImage } from "../src/lib/email-hero-qa.mjs";
import { loadModelPrices, usdCostForUsage, usdEurRate } from "../src/lib/ai-pricing.mjs";
import { buildCompareReportHtml } from "../src/lib/hero-compare-report.mjs";


// ── CLI ──────────────────────────────────────────────────────────────────────
function flag(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--")
    ? process.argv[i + 1]
    : fallback;
}
const has = (name) => process.argv.includes(`--${name}`);

const count = Math.max(1, Math.min(20, Number(flag("count", "5")) || 5));
const promptsFile = flag("prompts");
// A variant is "<quality>" or "<quality>+refs" (with the products' photos).
const variants = (flag("variants", flag("qualities", "medium,high,high+refs")) ?? "")
  .split(",")
  .map((v) => v.trim().toLowerCase())
  .filter(Boolean)
  .map((v) => {
    const [quality, extra] = v.split("+");
    return { key: v, quality, refs: extra === "refs", label: extra === "refs" ? `${quality} + Referenzen` : quality };
  })
  .filter((v) => ["low", "medium", "high"].includes(v.quality));
const outDir = flag("out", "hero-compare");
const dryRun = has("dry-run");
const parallel = Math.max(1, Math.min(4, Number(flag("parallel", "2")) || 2));

if (variants.length < 2 || variants.length > 6 || new Set(variants.map((v) => v.key)).size !== variants.length) {
  console.error("--variants braucht zwei bis sechs verschiedene Einträge aus low, medium, high, je optional mit +refs (z. B. medium,high,high+refs).");
  process.exit(1);
}
if (!dryRun && !process.env.OPENAI_API_KEY) {
  console.error("OPENAI_API_KEY fehlt (npm run hero:compare lädt .env).");
  process.exit(1);
}

const log = (msg) => console.error(msg);

// ── Prompts ──────────────────────────────────────────────────────────────────
const DEFAULT_HEADLINE = "Mehr Leistung.\nMehr Fokus.";

async function loadPrompts() {
  if (promptsFile) {
    const text = readFileSync(promptsFile, "utf8");
    return text
      .split(/\n\s*\n/)
      .map((p) => normalizeHeroPrompt(p))
      .filter(Boolean)
      .slice(0, count)
      .map((prompt, i) => ({ source: `Datei, Absatz ${i + 1}`, prompt, headline: DEFAULT_HEADLINE, productIds: [], ownedIds: [] }));
  }
  if (dryRun && !process.env.DATABASE_URL) {
    return Array.from({ length: Math.min(count, 2) }, (_, i) => ({
      source: `Dry-Run ${i + 1}`,
      prompt: `An ATX® Power Rack 620 (Power Racks, black) with an ATX® Multibank MBX-610 in front of it on the RIGHT side of a bright home gym, the left part a calm pale wall. (Beispiel ${i + 1})`,
      headline: DEFAULT_HEADLINE,
      productIds: [],
      ownedIds: [],
    }));
  }
  if (!process.env.DATABASE_URL) {
    log("DATABASE_URL fehlt — Prompts können nicht aus den Entwürfen gelesen werden. Alternative: --prompts datei.txt");
    process.exit(1);
  }
  const sql = neon(process.env.DATABASE_URL);
  const rows = await sql`
    SELECT 'campaign #' || contact_id AS source, hero_image_prompt AS prompt, hero_headline AS headline,
           recommended_product_ids AS product_ids, purchase_summary, updated_at
      FROM campaign_drafts WHERE hero_image_prompt IS NOT NULL
    UNION ALL
    SELECT 'marketing #' || id AS source, hero_image_prompt AS prompt, hero_headline AS headline,
           product_ids, NULL::jsonb AS purchase_summary, updated_at
      FROM marketing_sends WHERE hero_image_prompt IS NOT NULL
    ORDER BY updated_at DESC
    LIMIT ${count * 3}
  `;
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    const prompt = normalizeHeroPrompt(r.prompt);
    if (!prompt || seen.has(prompt)) continue;
    seen.add(prompt);
    const productIds = Array.isArray(r.product_ids) ? r.product_ids : [];
    const history = typeof r.purchase_summary === "string" ? JSON.parse(r.purchase_summary) : r.purchase_summary;
    out.push({
      source: r.source,
      prompt,
      headline: (r.headline ?? "").trim() || DEFAULT_HEADLINE,
      productIds,
      ownedIds: ownedProductIds(history).filter((id) => !productIds.includes(id)),
    });
    if (out.length >= count) break;
  }
  if (out.length === 0) {
    log("Keine gespeicherten Hero-Prompts gefunden. Erst im Workspace „Hero vorschlagen“ nutzen — oder --prompts datei.txt.");
    process.exit(1);
  }
  if (out.length < count) log(`Nur ${out.length} gespeicherte Prompts gefunden (gewünscht: ${count}).`);
  return out;
}

// ── Reference photos (same selection as generateHeroImage) ───────────────────
const catalogById = (() => {
  try {
    const raw = JSON.parse(readFileSync(new URL("../src/data/product-catalog.json", import.meta.url), "utf8"));
    const list = Array.isArray(raw) ? raw : raw.products ?? [];
    return new Map(list.map((p) => [p.id, p]));
  } catch {
    return new Map();
  }
})();

async function referencesFor(p) {
  if (dryRun) return [];
  const recommended = p.productIds.map((id) => catalogById.get(id)).filter(Boolean);
  const owned = p.ownedIds.map((id) => catalogById.get(id)).filter(Boolean);
  return loadReferenceImages(pickReferenceCandidates({ recommended, owned }));
}

// ── Rendering (same chain as generateHeroImage) ──────────────────────────────
const prices = loadModelPrices(process.env);
const rate = usdEurRate(process.env);
const client = dryRun ? null : new OpenAI();
const qaOn = !dryRun && heroQaEnabled(process.env);

async function renderOnce(p, spec, refs) {
  const started = Date.now();
  if (dryRun) {
    const image = readFileSync(new URL("../public/email-hero-default.jpg", import.meta.url));
    const v = await buildHeroVariants(image);
    return { model: "dry-run", mode: "generate", size: "1536x1024", references: 0, inputTokens: 0, outputTokens: 0, usd: 0, eur: 0, seconds: (Date.now() - started) / 1000, qa: null, ...v };
  }
  const useRefs = spec.refs && refs.length > 0;
  const attempts = heroImageAttempts({ ...process.env, EMAIL_HERO_IMAGE_QUALITY: spec.quality }, { withReferences: useRefs });
  const fullPrompt = ensureHeroStyleTail(p.prompt);
  const files = useRefs
    ? await Promise.all(refs.map((r, i) => toFile(r.bytes, `reference-${i + 1}.jpg`, { type: "image/jpeg" })))
    : [];
  let lastError = null;
  for (const attempt of attempts) {
    try {
      const common = { model: attempt.model, size: attempt.size, quality: attempt.quality };
      const res =
        attempt.mode === "edit"
          ? await client.images.edit({
              ...common,
              image: files,
              prompt: withReferenceInstruction(fullPrompt, refs),
              ...(attempt.inputFidelity ? { input_fidelity: attempt.inputFidelity } : {}),
            })
          : await client.images.generate({ ...common, prompt: fullPrompt });
      const b64 = res.data?.[0]?.b64_json;
      if (!b64) throw new Error(`${attempt.model} returned no image`);
      const inputTokens = res.usage?.input_tokens ?? 0;
      const outputTokens = res.usage?.output_tokens ?? 0;
      let usd = usdCostForUsage({ model: attempt.model, inputTokens, outputTokens }, prices);
      const v = await buildHeroVariants(Buffer.from(b64, "base64"));
      let qa = null;
      if (qaOn) {
        try {
          const r = await reviewHeroImage(v.master, {
            productNames: p.productIds.map((id) => catalogById.get(id)?.name).filter(Boolean),
          });
          usd += usdCostForUsage({ model: r.model, ...r.usage }, prices);
          qa = r.verdict;
        } catch (err) {
          log(`  ! KI-Prüfung fehlgeschlagen: ${err?.message ?? err}`);
        }
      }
      return {
        model: attempt.model,
        mode: attempt.mode,
        size: attempt.size,
        references: attempt.mode === "edit" ? refs.length : 0,
        inputTokens,
        outputTokens,
        usd,
        eur: usd * rate,
        seconds: (Date.now() - started) / 1000,
        qa,
        ...v,
      };
    } catch (err) {
      lastError = err;
      log(`  ✗ ${attempt.mode} ${attempt.model} ${attempt.size} ${spec.quality}: ${err?.message ?? err}`);
    }
  }
  throw lastError ?? new Error("no attempt succeeded");
}

async function pool(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        results[i] = await fn(items[i], i);
      }
    })
  );
  return results;
}

// ── Main ─────────────────────────────────────────────────────────────────────
const prompts = await loadPrompts();
log(`${prompts.length} Prompts × ${variants.map((v) => v.label).join(" + ")} → ${prompts.length * variants.length} Bilder${dryRun ? " (Dry-Run, keine API-Aufrufe)" : ""}${qaOn ? " · KI-Prüfung an" : ""}`);
mkdirSync(outDir, { recursive: true });

// Reference photos once per prompt (shared by its "+refs" variants).
const needRefs = variants.some((v) => v.refs);
const refsByPrompt = await Promise.all(prompts.map((p) => (needRefs ? referencesFor(p) : [])));
if (needRefs && !dryRun) {
  prompts.forEach((p, i) => {
    if (p.productIds.length && !refsByPrompt[i].length) log(`  ! Prompt ${i + 1}: keine Referenzfotos ladbar (${p.productIds.length} Produkt-IDs)`);
    if (!p.productIds.length) log(`  ! Prompt ${i + 1}: keine Produkt-IDs am Entwurf — „+refs“ rendert ohne Referenzen`);
  });
}

const jobs = prompts.flatMap((p, i) => variants.map((spec) => ({ p, i, spec })));
const results = await pool(jobs, parallel, async ({ p, i, spec }) => {
  log(`→ Prompt ${i + 1} (${p.source}) · ${spec.label} …`);
  const v = await renderOnce(p, spec, refsByPrompt[i]);
  const base = join(outDir, `${String(i + 1).padStart(2, "0")}-${spec.key.replace("+", "-")}`);
  writeFileSync(`${base}-desktop.jpg`, v.desktop);
  writeFileSync(`${base}-mobile.jpg`, v.mobile);
  log(`  ✓ Prompt ${i + 1} · ${spec.label}: ${v.mode} ${v.model} ${v.size}${v.references ? `, ${v.references} Referenzen` : ""}, ${v.outputTokens} Bild-Tokens, ${v.usd.toFixed(3)} $, ${v.seconds.toFixed(0)} s${v.qa ? `, KI-Prüfung ${v.qa.score}/10${v.qa.pass ? "" : " ✗"}` : ""}`);
  return { i, key: spec.key, v };
});

const rows = prompts.map((p, i) => ({
  index: i + 1,
  source: p.source,
  prompt: ensureHeroStyleTail(p.prompt),
  headline: p.headline,
  variants: variants.map((spec) => {
    const r = results.find((x) => x.i === i && x.key === spec.key);
    return { label: spec.label, quality: spec.quality, ...r.v };
  }),
}));

const html = buildCompareReportHtml(rows, {
  note: dryRun ? "Dry-Run: Platzhalterbild statt Modell-Renders" : undefined,
});
const indexPath = join(outDir, "index.html");
writeFileSync(indexPath, html);

// Summary table on stdout (stderr carried the progress).
const totalUsd = results.reduce((s, r) => s + r.v.usd, 0);
console.log("");
console.log("Prompt  Variante          Modell        Größe      Refs  Bild-Tokens  Kosten $  Sek.  KI-Prüfung");
for (const r of results.sort((a, b) => a.i - b.i || a.key.localeCompare(b.key))) {
  console.log(
    `${String(r.i + 1).padEnd(7)} ${r.key.padEnd(17)} ${r.v.model.padEnd(13)} ${r.v.size.padEnd(10)} ${String(r.v.references).padEnd(5)} ${String(r.v.outputTokens).padEnd(12)} ${r.v.usd.toFixed(3).padEnd(9)} ${r.v.seconds.toFixed(0).padEnd(5)} ${r.v.qa ? `${r.v.qa.score}/10${r.v.qa.pass ? "" : " ✗"}` : "–"}`
  );
}
console.log(`\nGesamt: ${totalUsd.toFixed(3)} $ (${(totalUsd * rate).toFixed(2)} €)`);
console.log(`Vergleichsseite: ${indexPath}  (eine Datei, Bilder eingebettet — direkt weiterschickbar)`);
