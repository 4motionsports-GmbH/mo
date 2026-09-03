// Hero-image QUALITY COMPARISON for a client meeting: renders the same real
// hero prompts in two quality levels through the exact production pipeline
// (model attempt chain, native hero format, legibility gradient, mobile crop)
// and writes ONE self-contained HTML sheet with the results side by side,
// blind A/B first, labels + real cost on reveal.
//
//   npm run hero:compare                      # 5 newest stored prompts, medium vs high
//   npm run hero:compare -- --count 8
//   npm run hero:compare -- --prompts prompts.txt   # own prompts, blank-line separated
//   npm run hero:compare -- --qualities low,high --out hero-compare-low
//   npm run hero:compare -- --dry-run         # no API calls: layout check with the default asset
//
// Prompts come from the drafts' stored hero prompts (what "Hero vorschlagen"
// produced for real contacts / sends), newest first, or from a file. Nothing
// is written to the database or the blob store; the images land in --out
// (default ./hero-compare, git-ignored) next to index.html.
//
// Needs OPENAI_API_KEY (and DATABASE_URL unless --prompts is given).

import process from "node:process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import OpenAI from "openai";
import { neon } from "@neondatabase/serverless";
import { ensureHeroStyleTail, normalizeHeroPrompt } from "../src/lib/email-hero-context.mjs";
import { buildHeroVariants, heroImageAttempts } from "../src/lib/email-hero-variants.mjs";
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
const qualities = (flag("qualities", "medium,high") ?? "")
  .split(",")
  .map((q) => q.trim().toLowerCase())
  .filter((q) => ["low", "medium", "high"].includes(q));
const outDir = flag("out", "hero-compare");
const dryRun = has("dry-run");
const parallel = Math.max(1, Math.min(4, Number(flag("parallel", "2")) || 2));

if (qualities.length !== 2) {
  console.error("--qualities braucht genau zwei Stufen aus low, medium, high (z. B. medium,high).");
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
      .map((prompt, i) => ({ source: `Datei, Absatz ${i + 1}`, prompt, headline: DEFAULT_HEADLINE }));
  }
  if (dryRun && !process.env.DATABASE_URL) {
    return Array.from({ length: Math.min(count, 2) }, (_, i) => ({
      source: `Dry-Run ${i + 1}`,
      prompt: `An ATX® Power Rack 620 (Power Racks, black) with an ATX® Multibank MBX-610 in front of it on the RIGHT side of a bright home gym, the left part a calm pale wall. (Beispiel ${i + 1})`,
      headline: DEFAULT_HEADLINE,
    }));
  }
  if (!process.env.DATABASE_URL) {
    log("DATABASE_URL fehlt — Prompts können nicht aus den Entwürfen gelesen werden. Alternative: --prompts datei.txt");
    process.exit(1);
  }
  const sql = neon(process.env.DATABASE_URL);
  const rows = await sql`
    SELECT 'campaign #' || contact_id AS source, hero_image_prompt AS prompt, hero_headline AS headline, updated_at
      FROM campaign_drafts WHERE hero_image_prompt IS NOT NULL
    UNION ALL
    SELECT 'marketing #' || id AS source, hero_image_prompt AS prompt, hero_headline AS headline, updated_at
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
    out.push({ source: r.source, prompt, headline: (r.headline ?? "").trim() || DEFAULT_HEADLINE });
    if (out.length >= count) break;
  }
  if (out.length === 0) {
    log("Keine gespeicherten Hero-Prompts gefunden. Erst im Workspace „Hero vorschlagen“ nutzen — oder --prompts datei.txt.");
    process.exit(1);
  }
  if (out.length < count) log(`Nur ${out.length} gespeicherte Prompts gefunden (gewünscht: ${count}).`);
  return out;
}

// ── Rendering (same chain as generateHeroImage) ──────────────────────────────
const prices = loadModelPrices(process.env);
const rate = usdEurRate(process.env);
const client = dryRun ? null : new OpenAI();

async function renderOnce(prompt, quality) {
  const started = Date.now();
  if (dryRun) {
    const image = readFileSync(new URL("../public/email-hero-default.jpg", import.meta.url));
    const v = await buildHeroVariants(image);
    return { model: "dry-run", size: "1536x1024", inputTokens: 0, outputTokens: 0, usd: 0, eur: 0, seconds: (Date.now() - started) / 1000, ...v };
  }
  const attempts = heroImageAttempts({ ...process.env, EMAIL_HERO_IMAGE_QUALITY: quality });
  let lastError = null;
  for (const attempt of attempts) {
    try {
      const res = await client.images.generate({
        model: attempt.model,
        prompt: ensureHeroStyleTail(prompt),
        size: attempt.size,
        quality: attempt.quality,
      });
      const b64 = res.data?.[0]?.b64_json;
      if (!b64) throw new Error(`${attempt.model} returned no image`);
      const inputTokens = res.usage?.input_tokens ?? 0;
      const outputTokens = res.usage?.output_tokens ?? 0;
      const usd = usdCostForUsage({ model: attempt.model, inputTokens, outputTokens }, prices);
      const v = await buildHeroVariants(Buffer.from(b64, "base64"));
      return {
        model: attempt.model,
        size: attempt.size,
        inputTokens,
        outputTokens,
        usd,
        eur: usd * rate,
        seconds: (Date.now() - started) / 1000,
        ...v,
      };
    } catch (err) {
      lastError = err;
      log(`  ✗ ${attempt.model} ${attempt.size} ${quality}: ${err?.message ?? err}`);
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
log(`${prompts.length} Prompts × ${qualities.join(" + ")} → ${prompts.length * 2} Bilder${dryRun ? " (Dry-Run, keine API-Aufrufe)" : ""}`);
mkdirSync(outDir, { recursive: true });

const jobs = prompts.flatMap((p, i) => qualities.map((quality) => ({ p, i, quality })));
const results = await pool(jobs, parallel, async ({ p, i, quality }) => {
  log(`→ Prompt ${i + 1} (${p.source}) · ${quality} …`);
  const v = await renderOnce(p.prompt, quality);
  const base = join(outDir, `${String(i + 1).padStart(2, "0")}-${quality}`);
  writeFileSync(`${base}-desktop.jpg`, v.desktop);
  writeFileSync(`${base}-mobile.jpg`, v.mobile);
  log(`  ✓ Prompt ${i + 1} · ${quality}: ${v.model} ${v.size}, ${v.outputTokens} Bild-Tokens, ${v.usd.toFixed(3)} $, ${v.seconds.toFixed(0)} s`);
  return { i, quality, v };
});

const rows = prompts.map((p, i) => ({
  index: i + 1,
  source: p.source,
  prompt: ensureHeroStyleTail(p.prompt),
  headline: p.headline,
  variants: qualities.map((q) => {
    const r = results.find((x) => x.i === i && x.quality === q);
    return { quality: q, ...r.v };
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
console.log("Prompt  Qualität  Modell        Größe      Bild-Tokens  Kosten $  Sekunden");
for (const r of results.sort((a, b) => a.i - b.i || a.quality.localeCompare(b.quality))) {
  console.log(
    `${String(r.i + 1).padEnd(7)} ${r.quality.padEnd(9)} ${r.v.model.padEnd(13)} ${r.v.size.padEnd(10)} ${String(r.v.outputTokens).padEnd(12)} ${r.v.usd.toFixed(3).padEnd(9)} ${r.v.seconds.toFixed(0)}`
  );
}
console.log(`\nGesamt: ${totalUsd.toFixed(3)} $ (${(totalUsd * rate).toFixed(2)} €)`);
console.log(`Vergleichsseite: ${indexPath}  (eine Datei, Bilder eingebettet — direkt weiterschickbar)`);
