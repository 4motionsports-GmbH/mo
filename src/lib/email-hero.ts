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
//      gpt-image-1 (landscape 1536×1024 for the full-bleed hero), store the
//      PNG in the PRIVATE Vercel Blob store and publish it through our own
//      /api/email-hero-image route (email-hero-blob.mjs explains why), then
//      save that URL + the prompt on the draft row (email-hero-store) so
//      preview and send show the same image and the audit trail keeps prompt
//      and image together.
//
// Both are admin-triggered (never on the send path) and fail-soft: any error
// returns ok:false with a German message for the toast — a hero problem can
// never break drafting or sending (the design falls back to the default hero
// asset: public/email-hero-default.jpg / EMAIL_HERO_DEFAULT_URL).

import OpenAI from "openai";
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
  heroContextLines,
  loyaltyHint,
  ownedProductTitles,
  productCategories,
  seasonHint,
  MAX_PROFILE_CHARS,
} from "./email-hero-context.mjs";
import {
  heroBlobFileFromPathname,
  heroBlobKey,
  heroImagePublicUrl,
} from "./email-hero-blob.mjs";
import { setEmailHero, type EmailHeroKind } from "./email-hero-store";
import { recordAiUsage } from "./ai-usage-store";
import { reportError } from "./observability";

// Re-exported so callers keep one import site for the hero vocabulary.
export { HERO_PROMPT_STYLE_TAIL, ensureHeroStyleTail };

const PROMPT_MODEL = "claude-sonnet-4-6";
const IMAGE_MODEL = "gpt-image-1";
/**
 * LANDSCAPE 3:2 — the hero is a FULL-BLEED background across the whole card
 * (640px wide, ~300px tall), with the headline sitting on its faded left half.
 * A portrait crop would tower over the text and get cut off on both sides.
 */
const IMAGE_SIZE = "1536x1024" as const;

export const MAX_HERO_PROMPT_CHARS = 1500;
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

/** Deterministic fallback scene when the prompt model is unavailable/fails. */
function fallbackScene(ctx: HeroContext): string {
  const items = (ctx.productCategories.length ? ctx.productCategories : ctx.productNames)
    .slice(0, 3)
    .join(", ");
  return items
    ? `A styled arrangement of fitness equipment inspired by: ${items} — placed on a light concrete floor in front of a power rack, composed like a premium sports-brand campaign visual.`
    : "A styled arrangement of premium home-gym accessories — resistance bands, a black steel water bottle and a folded floor mat — on a light concrete floor in front of a power rack.";
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
      "ENGLISCHE Szenen-Beschreibung für das Bildmodell: EIN Absatz, max. 60 " +
        "Wörter, konkrete hochwertige Produkt-/Lifestyle-Szene passend zu den " +
        "empfohlenen Produkten. Keine Markennamen, kein Text im Bild, keine " +
        "Gesichter, keine Stil-/Licht-Angaben (werden separat angehängt)."
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
          "SZENE (englisch, für ein Bildmodell): Sie soll wie das Setup " +
          "DIESER Person wirken, nicht wie ein Stockfoto. Nutze dafür in " +
          "dieser Reihenfolge: (1) was die Person bereits besitzt — die neuen " +
          "Teile ERGÄNZEN sichtbar ein bestehendes Setup, (2) die " +
          "Rahmenbedingungen aus dem Kundenverständnis (Platz, Lautstärke, " +
          "Wohnung vs. Keller vs. Garage, Niveau), (3) die empfohlenen " +
          "PRODUKTARTEN als konkrete Objekte (Markennamen sagen dem Bildmodell " +
          "nichts — beschreibe die Gegenstände), (4) ein angehängtes Set als " +
          "zusammengehörige Gruppe, (5) die Jahreszeit für Licht und Stimmung.\n\n" +
          "SCHLAGZEILE (deutsch, zwei kurze Zeilen): Sie benennt das ZIEL oder " +
          "die konkrete Situation dieser Person („Dein Rack. Jetzt komplett.“, " +
          "„Leise trainieren. Endlich.“) — nicht das Produkt und keine " +
          "Allgemeinplätze. Bei englischsprachigen Empfänger:innen auf " +
          "Englisch.\n\n" +
          "VERBOTEN in der Schlagzeile: Rabatt-Prozente, Preise oder " +
          "Verfügbarkeiten (die stehen deterministisch an anderer Stelle der " +
          "E-Mail und würden hier veralten), Produktnamen, Anrede/Name.",
        prompt: [
          ctx.productNames.length
            ? `## Empfohlene Produkte (Inhalt dieser E-Mail)\n${ctx.productNames
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

  return { ok: true, prompt: `${scene}\n\n${HERO_PROMPT_STYLE_TAIL}`, headline };
}

export type GenerateHeroImageResult =
  | { ok: true; url: string }
  | { ok: false; message: string };

/**
 * Render the prompt with gpt-image-1, upload the PNG to Vercel Blob and store
 * URL + prompt on the draft row. Returns the public https URL.
 */
export async function generateHeroImage(
  kind: EmailHeroKind,
  id: number,
  prompt: string
): Promise<GenerateHeroImageResult> {
  const trimmed = prompt.replace(/\s+/g, " ").trim();
  if (!trimmed || trimmed.length > MAX_HERO_PROMPT_CHARS) {
    return { ok: false, message: `Bitte einen Prompt mit 1–${MAX_HERO_PROMPT_CHARS} Zeichen angeben.` };
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
    const res = await client.images.generate({
      model: IMAGE_MODEL,
      prompt: ensureHeroStyleTail(trimmed),
      size: IMAGE_SIZE,
    });
    const b64 = res.data?.[0]?.b64_json;
    if (!b64) return { ok: false, message: "Das Bildmodell hat kein Bild geliefert." };

    // Image-model usage is token-based for gpt-image-1; unknown models price
    // as 0 in the cost table — the row still documents the call.
    await recordAiUsage({
      callSite: "hero_image",
      model: IMAGE_MODEL,
      inputTokens: res.usage?.input_tokens ?? 0,
      outputTokens: res.usage?.output_tokens ?? 0,
    });

    // The blob store is PRIVATE (it also holds the catalog + embeddings), so
    // the image is written privately and published through our own route —
    // see email-hero-blob.mjs for why, and for the validation that keeps that
    // route from reaching anything but hero images.
    const blob = await put(heroBlobKey(kind, id), Buffer.from(b64, "base64"), {
      access: "private",
      contentType: "image/png",
      addRandomSuffix: true,
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });
    const publicUrl = heroImagePublicUrl(
      getBaseUrl(),
      heroBlobFileFromPathname(blob.pathname)
    );

    const saved = await setEmailHero(kind, id, publicUrl, ensureHeroStyleTail(trimmed));
    if (!saved.ok) {
      return {
        ok: false,
        message: saved.notFound
          ? "Entwurf nicht gefunden — bitte zuerst einen Entwurf erzeugen."
          : "Bild erzeugt, aber Speichern am Entwurf fehlgeschlagen.",
      };
    }
    return { ok: true, url: publicUrl };
  } catch (err) {
    reportError(err, { route: "lib/email-hero", phase: "generate" });
    return { ok: false, message: "Bild-Generierung fehlgeschlagen — bitte erneut versuchen." };
  }
}
