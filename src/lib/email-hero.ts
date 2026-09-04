// AI HERO IMAGES for the image-first email designs (docs/EMAIL_DESIGNS.md):
// the killer feature of the 'performance' design. Two capabilities:
//
//   1. suggestHeroPrompt — draft a personalised IMAGE PROMPT *and* the
//      two-line hero claim from everything we know about this recipient
//      (email-hero-context.mjs assembles it: what they already own, the
//      condensed customer understanding, the recommended product categories,
//      an attached set, persona/team notes, loyalty, season). The prompt is
//      English (image models follow English best), one editable text: the
//      personal scene followed by the fixed brand-style + constraint
//      sentences, so the operator sees EXACTLY what the image model gets.
//   2. generateHeroImage — render the (operator-edited) prompt with OpenAI
//      gpt-image-2 in the hero's native 1536×720 format, giving the model
//      the catalogue photos of the products as references
//      (email-hero-references.mjs; fallbacks in email-hero-variants.mjs),
//      let a vision model check the result and re-render once if it fails
//      (email-hero-qa.mjs), derive the desktop file (legibility gradient
//      over its left part) and the mobile crop, store both as JPEG in the
//      PRIVATE Vercel Blob store and publish them through our own
//      /api/email-hero-image route (email-hero-blob.mjs explains why), then
//      save that URL + the prompt on the draft row (email-hero-store) so
//      preview and send show the same image and the audit trail keeps prompt
//      and image together.
//
// Both are admin-triggered (never on the send path) and fail-soft: any error
// returns ok:false with a German message for the toast — a hero problem can
// never break drafting or sending (the design falls back to the default hero
// asset: public/email-hero-default.jpg / EMAIL_HERO_DEFAULT_URL).

import OpenAI, { toFile } from "openai";
import { put } from "@vercel/blob";
import { generateObject } from "ai";
import { z } from "zod";
import { anthropic } from "@ai-sdk/anthropic";
import { getBaseUrl } from "./base-url";
import { getSendById } from "./marketing-store";
import { getContactById, getDraftForContact } from "./campaign-store";
import { getProductsByIds } from "./product-catalog";
import { getCustomerById } from "./customer-store";
import { getActiveBundleForSend, getActiveBundleForCampaignContact } from "./bundle-offers-store";
import {
  clip,
  ensureHeroStyleTail,
  HERO_PROMPT_STYLE_TAIL,
  HERO_SCENE_INSTRUCTION,
  heroContextLines,
  loyaltyHint,
  MAX_HERO_PROMPT_CHARS,
  MAX_HERO_SCENE_CHARS,
  normalizeHeroPrompt,
  ownedProductTitles,
  productCategories,
  productHeroDescriptors,
  seasonHint,
  MAX_PROFILE_CHARS,
} from "./email-hero-context.mjs";
import {
  heroBlobFileFromPathname,
  heroBlobKey,
  heroImagePublicUrl,
} from "./email-hero-blob.mjs";
import { buildHeroVariants, heroImageAttempts } from "./email-hero-variants.mjs";
import {
  loadReferenceImages,
  ownedProductIds,
  pickReferenceCandidates,
  withReferenceInstruction,
} from "./email-hero-references.mjs";
import {
  HERO_QA_MAX_RENDERS,
  heroQaEnabled,
  pickBestRender,
  reviewHeroImage,
} from "./email-hero-qa.mjs";
import { setEmailHero, type EmailHeroKind } from "./email-hero-store";
import { recordAiUsage } from "./ai-usage-store";
import { reportError } from "./observability";

// Re-exported so callers keep one import site for the hero vocabulary. The
// prompt cap is DERIVED from the style tail (email-hero-context.mjs) so a
// longer tail can never again leave too little room for the scene.
export {
  HERO_PROMPT_STYLE_TAIL,
  ensureHeroStyleTail,
  MAX_HERO_PROMPT_CHARS,
  normalizeHeroPrompt,
};

const PROMPT_MODEL = "claude-sonnet-4-6";
// The image model, size and quality live in email-hero-variants.mjs
// (heroImageAttempts): gpt-image-2 in the hero's native 1536×720 first, then
// the same model in 3:2, then gpt-image-1.5 — the first attempt that renders
// wins, so one refused size or one model outage never blocks the operator.

export const MAX_HERO_HEADLINE_CHARS = 60;

/** The default hero asset used when a send has no custom hero. */
export function defaultHeroImageUrl(): string {
  return process.env.EMAIL_HERO_DEFAULT_URL || `${getBaseUrl()}/email-hero-default.jpg`;
}

/** Both external services the generator needs (image model + blob store). */
export function isHeroGenerationConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY) && Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

interface HeroContext {
  /** Recommended product NAMES (for the headline's sense of what's offered). */
  productNames: string[];
  /** Brand + name + object type + colour of the recommended products — what
   *  the image prompt names verbatim so the render resembles the real thing. */
  productDescriptors: string[];
  /** Recommended product CATEGORIES — what the image model can actually draw. */
  productCategories: string[];
  proseExcerpt: string;
  /** Labelled "Was wir über diese Person wissen" lines (may be empty). */
  extraContext: string[];
}

/**
 * Assemble the personalisation context for one draft — everything we legitimately
 * know about THIS recipient, condensed into labelled lines. The richer this is,
 * the more the hero looks like the reader's own gym instead of stock imagery:
 *
 *   - what they already OWN (purchase history) → the scene completes their setup
 *   - the condensed customer understanding (goals, space, noise, level)
 *   - the recommended products' categories → objects the image model can draw
 *   - an attached set offer → show those pieces together
 *   - persona / team notes / loyalty / language / season
 *
 * Null → the draft doesn't exist. Every individual lookup is fail-soft: a
 * missing piece just drops out of the context.
 */
async function loadHeroContext(
  kind: EmailHeroKind,
  id: number
): Promise<HeroContext | null> {
  if (kind === "marketing") {
    const send = await getSendById(id);
    if (!send) return null;
    const products = send.productIds.length ? await getProductsByIds(send.productIds) : [];

    // The chat customer's profile + purchases (both fail-soft).
    let profileSummary = "";
    let owned: string[] = [];
    if (send.customerId) {
      try {
        const customer = await getCustomerById(send.customerId);
        profileSummary = clip(customer?.profileSummary ?? "", MAX_PROFILE_CHARS);
        owned = ownedProductTitles(customer?.purchaseSummary);
      } catch (err) {
        reportError(err, { route: "lib/email-hero", phase: "customerContext" });
      }
    }

    let bundleTitles: string[] = [];
    try {
      const bundle = await getActiveBundleForSend(id);
      bundleTitles = (bundle?.components ?? [])
        .map((c) => (typeof c.title === "string" ? c.title : ""))
        .filter(Boolean);
    } catch (err) {
      reportError(err, { route: "lib/email-hero", phase: "bundleContext" });
    }

    return {
      productNames: products.map((p) => p.name),
      productDescriptors: productHeroDescriptors(products),
      productCategories: productCategories(products),
      proseExcerpt: clip(send.draftedText ?? "", 800),
      extraContext: heroContextLines({
        "Kundenverständnis (verdichtet)": profileSummary,
        "Bereits im Besitz (Kaufhistorie)": owned,
        "Empfohlene Produktarten": productCategories(products),
        "Angehängtes Set (zusammen zeigen)": bundleTitles,
        Persona: send.personaLabel ?? "",
        "Hinweise vom Team": send.adminInstructions ?? "",
        Jahreszeit: seasonHint(),
      }),
    };
  }

  const contact = await getContactById(id);
  const draft = await getDraftForContact(id);
  if (!contact || !draft) return null;
  const products = draft.recommendedProductIds.length
    ? await getProductsByIds(draft.recommendedProductIds)
    : [];

  // This audience never chatted — their order record IS the personalisation.
  const owned = ownedProductTitles(draft.purchaseSummary);
  let bundleTitles: string[] = [];
  try {
    const bundle = await getActiveBundleForCampaignContact(id);
    bundleTitles = (bundle?.components ?? [])
      .map((c) => (typeof c.title === "string" ? c.title : ""))
      .filter(Boolean);
  } catch (err) {
    reportError(err, { route: "lib/email-hero", phase: "bundleContext" });
  }

  return {
    productNames: products.map((p) => p.name),
    productDescriptors: productHeroDescriptors(products),
    productCategories: productCategories(products),
    proseExcerpt: clip(draft.body, 800),
    extraContext: heroContextLines({
      "Bereits im Besitz (Kaufhistorie)": owned,
      "Empfohlene Produktarten": productCategories(products),
      "Angehängtes Set (zusammen zeigen)": bundleTitles,
      Kundenstatus: loyaltyHint(contact.ordersCount, contact.totalSpentCents),
      Vorname: contact.firstName ?? "",
      "Empfänger-Sprache": contact.language === "en" ? "Englisch" : "Deutsch",
      Jahreszeit: seasonHint(),
    }),
  };
}

/** Deterministic fallback scene when the prompt model is unavailable/fails.
 *  Names brand + product too, so a fallback hero is no more generic than a
 *  drafted one. */
function fallbackScene(ctx: HeroContext): string {
  const list = ctx.productDescriptors.length
    ? ctx.productDescriptors
    : ctx.productCategories.length
      ? ctx.productCategories
      : ctx.productNames;
  const items = list.slice(0, 4);
  const named = items.length > 1
    ? `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`
    : items[0] ?? "";
  return named
    ? `${named}, arranged as one home-gym setup on the RIGHT side of a bright room, large equipment at the back and small items in front, the left part of the frame a calm, softly lit pale wall and floor.`
    : "A matte black power rack with a bench in front of it on the RIGHT side of a bright home gym, the left part of the frame a calm, softly lit pale wall and floor.";
}

export type SuggestHeroPromptResult =
  | { ok: true; prompt: string; headline: string }
  | { ok: false; message: string };

/** Fallback claim when the model is unavailable — the design's own default
 * wording, so the hero never renders empty. */
const FALLBACK_HEADLINE = "Mehr Leistung.\nMehr Fokus.";

const heroSuggestionSchema = z.object({
  scene: z
    .string()
    .describe(
      "ENGLISCHE Szenen-Beschreibung für das Bildmodell: EIN Absatz, max. 90 " +
        "Wörter.\n" +
        "(1) Benenne ALLE empfohlenen Produkte mit Marke und Produktnamen genau " +
        "so, wie sie in den Vorgaben stehen (z. B. „an ATX® Power Rack 620“), " +
        "dazu Farbe und Bauform — das wichtigste ausführlich, die weiteren " +
        "knapp. Sie stehen vorne als Blickfang.\n" +
        "(2) Dazu ein bis zwei vertraute Geräte aus dem Besitz (Kaufhistorie) " +
        "dahinter oder daneben, damit es wie das eigene Setup wirkt.\n" +
        "(3) Die Szene MUSS die Anordnung selbst beschreiben: alles als EIN " +
        "zusammenhängendes Setup RECHTS im Bild, große Geräte hinten, kleine " +
        "vorne; links davon nur eine ruhige, hell beleuchtete Wand- und " +
        "Bodenfläche. Schreib das ausdrücklich in den Satz hinein.\n" +
        "Keine Gesichter, keine Stil- oder Licht-Angaben (werden separat " +
        "angehängt)."
    ),
  headline: z
    .string()
    .describe(
      "DEUTSCHE Hero-Schlagzeile: GENAU ZWEI kurze Zeilen, getrennt durch " +
        "einen Zeilenumbruch, je 2–3 Wörter, je mit Punkt (Beispiel: " +
        "\"Mehr Leistung.\\nMehr Fokus.\"). Konkret auf diese E-Mail bezogen, " +
        "werblich, ohne Produktnamen, ohne Anrede, max. 60 Zeichen gesamt."
    ),
});

/**
 * Draft the personalised hero-image prompt for one marketing send / campaign
 * contact: a short AI-written scene rooted in the email's actual products and
 * story, followed by the fixed style tail. The operator edits the full text.
 */
export async function suggestHeroPrompt(
  kind: EmailHeroKind,
  id: number
): Promise<SuggestHeroPromptResult> {
  const ctx = await loadHeroContext(kind, id);
  if (!ctx) return { ok: false, message: "Entwurf nicht gefunden." };

  let scene = fallbackScene(ctx);
  let headline = FALLBACK_HEADLINE;
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const { object, usage } = await generateObject({
        model: anthropic(PROMPT_MODEL),
        schema: heroSuggestionSchema,
        system:
          "Du entwirfst den HERO einer personalisierten E-Mail eines " +
          "Fitness-Shops (motion sports) — das Erste, was diese eine Person " +
          "sieht, und der Hebel dafür, ob sie weiterliest.\n\n" +
          HERO_SCENE_INSTRUCTION +
          "\n\n" +
          "SCHLAGZEILE (deutsch, zwei kurze Zeilen): Sie benennt das ZIEL oder " +
          "die konkrete Situation dieser Person („Dein Rack. Jetzt komplett.“, " +
          "„Leise trainieren. Endlich.“) — nicht das Produkt und keine " +
          "Allgemeinplätze. Bei englischsprachigen Empfänger:innen auf " +
          "Englisch.\n\n" +
          "VERBOTEN in der Schlagzeile: Rabatt-Prozente, Preise oder " +
          "Verfügbarkeiten (die stehen deterministisch an anderer Stelle der " +
          "E-Mail und würden hier veralten), Produktnamen, Anrede/Name.",
        prompt: [
          ctx.productDescriptors.length
            ? `## Empfohlene Produkte — Marke, Name, Bauart, Farbe\n` +
              `(wörtlich in die Szene übernehmen)\n${ctx.productDescriptors
                .map((n) => `- ${n}`)
                .join("\n")}`
            : "## Empfohlene Produkte\n(keine — allgemeines Home-Gym-Zubehör)",
          ctx.extraContext.length
            ? `\n## Was wir über diese Person wissen\n${ctx.extraContext
                .map((l) => `- ${l}`)
                .join("\n")}`
            : "",
          ctx.proseExcerpt ? `\n## E-Mail-Text (Auszug)\n${ctx.proseExcerpt}` : "",
          "\nEntwirf Szene und Schlagzeile für genau diese Person.",
        ].join("\n"),
      });
      await recordAiUsage({
        callSite: "hero_image",
        model: PROMPT_MODEL,
        inputTokens: usage?.inputTokens ?? 0,
        outputTokens: usage?.outputTokens ?? 0,
      });
      if (object.scene?.trim()) scene = object.scene.trim();
      const h = object.headline?.trim();
      if (h && h.length <= MAX_HERO_HEADLINE_CHARS) headline = h;
    } catch (err) {
      reportError(err, { route: "lib/email-hero", phase: "suggest" });
    }
  }

  // Clip the scene to its budget so a SUGGESTED prompt can never be rejected by
  // our own length check — the drafting model is asked for ≤90 words but is not
  // bound by that, and an overshoot used to make "Bild generieren" fail.
  const boundedScene = clip(scene, MAX_HERO_SCENE_CHARS);
  return { ok: true, prompt: `${boundedScene}\n\n${HERO_PROMPT_STYLE_TAIL}`, headline };
}

export interface HeroRenderReview {
  /** 1–10 from the automatic check (email-hero-qa.mjs). */
  score: number;
  pass: boolean;
  reasons: string[];
  /** True when the first render failed the check and a second one was made. */
  rerendered: boolean;
  /** How many reference photos the model was given. */
  references: number;
}

export type GenerateHeroImageResult =
  | { ok: true; url: string; review: HeroRenderReview | null }
  | { ok: false; message: string };

interface LoadedReference {
  label: string;
  url: string;
  role: "new" | "owned";
  bytes: Buffer;
}

/**
 * The catalogue photos of the products this hero should show (recommended
 * ones first, then up to two owned), fetched and downscaled — or [] when the
 * draft has none, a lookup fails, or EMAIL_HERO_REFERENCES=off. Fail-soft:
 * a missing picture never blocks the render, it only makes it less specific.
 */
async function loadHeroReferences(
  kind: EmailHeroKind,
  id: number
): Promise<{ refs: LoadedReference[]; productNames: string[] }> {
  const none = { refs: [] as LoadedReference[], productNames: [] as string[] };
  if ((process.env.EMAIL_HERO_REFERENCES ?? "").trim().toLowerCase() === "off") return none;
  try {
    let recommendedIds: string[] = [];
    let history: unknown = null;
    if (kind === "marketing") {
      const send = await getSendById(id);
      if (!send) return none;
      recommendedIds = send.productIds;
      if (send.customerId) {
        try {
          history = (await getCustomerById(send.customerId))?.purchaseSummary ?? null;
        } catch (err) {
          reportError(err, { route: "lib/email-hero", phase: "referenceHistory" });
        }
      }
    } else {
      const draft = await getDraftForContact(id);
      if (!draft) return none;
      recommendedIds = draft.recommendedProductIds;
      history = draft.purchaseSummary;
    }
    const recommended = recommendedIds.length ? await getProductsByIds(recommendedIds) : [];
    const ownedIds = ownedProductIds(history as Parameters<typeof ownedProductIds>[0]).filter(
      (pid) => !recommendedIds.includes(pid)
    );
    const owned = ownedIds.length ? await getProductsByIds(ownedIds) : [];
    const candidates = pickReferenceCandidates({ recommended, owned });
    const refs = (await loadReferenceImages(candidates)) as LoadedReference[];
    return { refs, productNames: recommended.map((p) => p.name) };
  } catch (err) {
    reportError(err, { route: "lib/email-hero", phase: "references" });
    return none;
  }
}

/**
 * Render the prompt with gpt-image-1, upload the PNG to Vercel Blob and store
 * URL + prompt on the draft row. Returns the public https URL.
 */
export async function generateHeroImage(
  kind: EmailHeroKind,
  id: number,
  prompt: string
): Promise<GenerateHeroImageResult> {
  const trimmed = normalizeHeroPrompt(prompt);
  if (!trimmed) {
    return { ok: false, message: "Bitte einen Prompt eingeben." };
  }
  if (trimmed.length > MAX_HERO_PROMPT_CHARS) {
    return {
      ok: false,
      message:
        `Prompt zu lang: ${trimmed.length} von ${MAX_HERO_PROMPT_CHARS} Zeichen — ` +
        `bitte die Szene um ${trimmed.length - MAX_HERO_PROMPT_CHARS} Zeichen kürzen.`,
    };
  }
  if (!isHeroGenerationConfigured()) {
    return {
      ok: false,
      message:
        "Bild-Generierung ist nicht konfiguriert (OPENAI_API_KEY / BLOB_READ_WRITE_TOKEN).",
    };
  }

  try {
    const client = new OpenAI();
    const fullPrompt = ensureHeroStyleTail(trimmed);

    // The catalogue photos of the products to show. With them the primary
    // attempts EDIT the references into the scene (true-to-product); without
    // them, or if those attempts fail, the plain generate chain runs.
    const { refs, productNames } = await loadHeroReferences(kind, id);
    const attempts = heroImageAttempts(process.env, { withReferences: refs.length > 0 });
    const referenceFiles = await Promise.all(
      refs.map((r, i) => toFile(r.bytes, `reference-${i + 1}.jpg`, { type: "image/jpeg" }))
    );

    // First attempt that renders wins. Each failure is reported with its
    // model so a refused size or a model outage is visible in Sentry, not
    // silently absorbed.
    const renderOnce = async () => {
      let lastError: unknown = null;
      for (const attempt of attempts) {
        try {
          const common = {
            model: attempt.model,
            // The installed SDK types only list the classic sizes; gpt-image-2
            // accepts any WIDTHxHEIGHT (multiples of 16, ratio ≤ 3:1) — the
            // fallback attempts use a classic size anyway.
            size: attempt.size as "1536x1024",
            quality: attempt.quality as "low" | "medium" | "high",
          };
          const res =
            attempt.mode === "edit"
              ? await client.images.edit({
                  ...common,
                  image: referenceFiles,
                  prompt: withReferenceInstruction(fullPrompt, refs),
                  // Only the gpt-image-1 family takes input_fidelity;
                  // gpt-image-2 rejects it (see inputFidelityFor).
                  ...(attempt.inputFidelity ? { input_fidelity: attempt.inputFidelity } : {}),
                })
              : await client.images.generate({ ...common, prompt: fullPrompt });
          const b64 = res.data?.[0]?.b64_json;
          if (!b64) throw new Error(`${attempt.model} returned no image`);
          // Token-based image billing; the price table (ai-pricing.mjs) knows
          // the image models, so the KPI shows the real cost of every hero.
          await recordAiUsage({
            callSite: "hero_image",
            model: attempt.model,
            inputTokens: res.usage?.input_tokens ?? 0,
            outputTokens: res.usage?.output_tokens ?? 0,
          });
          return { b64, model: attempt.model, mode: attempt.mode };
        } catch (err) {
          lastError = err;
          reportError(err, {
            route: "lib/email-hero",
            phase: `${attempt.mode}:${attempt.model}:${attempt.size}`,
          });
        }
      }
      throw lastError ?? new Error("no image model attempt succeeded");
    };

    // Render, check, and re-render ONCE if the check fails; keep the better
    // picture. The check looks at the un-graded scene (variants.master).
    const qaOn = heroQaEnabled();
    const renders: Array<{
      variants: Awaited<ReturnType<typeof buildHeroVariants>>;
      verdict: { pass: boolean; score: number; reasons: string[] } | null;
    }> = [];
    for (let n = 0; n < (qaOn ? HERO_QA_MAX_RENDERS : 1); n++) {
      const rendered = await renderOnce();
      // One render → two files (email-hero-variants.mjs): the desktop picture
      // with the legibility gradient over its left part (deterministic — the
      // prompt's composition rule only makes the calm left LIKELY), and the
      // right-side crop for phones, where the picture sits under the text.
      const variants = await buildHeroVariants(Buffer.from(rendered.b64, "base64"));
      let verdict: { pass: boolean; score: number; reasons: string[] } | null = null;
      if (qaOn) {
        try {
          const qa = await reviewHeroImage(variants.master, { productNames });
          await recordAiUsage({
            callSite: "hero_image",
            model: qa.model,
            inputTokens: qa.usage.inputTokens,
            outputTokens: qa.usage.outputTokens,
          });
          verdict = qa.verdict;
        } catch (err) {
          reportError(err, { route: "lib/email-hero", phase: "qa" });
        }
      }
      renders.push({ variants, verdict });
      if (!verdict || verdict.pass) break;
    }
    const best = pickBestRender(renders);
    const variants = best.variants;
    const review: HeroRenderReview | null = best.verdict
      ? {
          score: best.verdict.score,
          pass: best.verdict.pass,
          reasons: best.verdict.reasons,
          rerendered: renders.length > 1,
          references: refs.length,
        }
      : null;

    // The blob store is PRIVATE (it also holds the catalog + embeddings), so
    // the images are written privately and published through our own route —
    // see email-hero-blob.mjs for why, and for the validation that keeps that
    // route from reaching anything but hero images.
    const blobOpts = {
      access: "private" as const,
      contentType: "image/jpeg",
      addRandomSuffix: true,
      token: process.env.BLOB_READ_WRITE_TOKEN,
    };
    const [desktopBlob, mobileBlob] = await Promise.all([
      put(heroBlobKey(kind, id, { ext: "jpg" }), variants.desktop, blobOpts),
      put(heroBlobKey(kind, id, { variant: "mobile", ext: "jpg" }), variants.mobile, blobOpts),
    ]);
    const publicUrl = heroImagePublicUrl(
      getBaseUrl(),
      heroBlobFileFromPathname(desktopBlob.pathname)
    );
    const mobileUrl = heroImagePublicUrl(
      getBaseUrl(),
      heroBlobFileFromPathname(mobileBlob.pathname)
    );

    const saved = await setEmailHero(kind, id, publicUrl, fullPrompt, mobileUrl);
    if (!saved.ok) {
      return {
        ok: false,
        message: saved.notFound
          ? "Entwurf nicht gefunden — bitte zuerst einen Entwurf erzeugen."
          : "Bild erzeugt, aber Speichern am Entwurf fehlgeschlagen.",
      };
    }
    return { ok: true, url: publicUrl, review };
  } catch (err) {
    reportError(err, { route: "lib/email-hero", phase: "generate" });
    return { ok: false, message: "Bild-Generierung fehlgeschlagen — bitte erneut versuchen." };
  }
}
