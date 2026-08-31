// AI HERO IMAGES for the image-first email designs (docs/EMAIL_DESIGNS.md):
// the killer feature of the 'performance' design. Two capabilities:
//
//   1. suggestHeroPrompt — draft a personalised IMAGE PROMPT from everything
//      the system knows about this specific email (recommended products, the
//      drafted prose, persona/admin context). The prompt is English (image
//      models follow English best), one editable text: a personal scene
//      description followed by the fixed brand-style + constraint sentences,
//      so the operator sees and controls EXACTLY what the image model gets.
//   2. generateHeroImage — render the (operator-edited) prompt with OpenAI
//      gpt-image-1 (portrait 1024×1536, matching the hero slot), upload the
//      PNG to Vercel Blob (public), and store URL + prompt on the draft row
//      (email-hero-store) so preview and send show the same image and the
//      audit trail keeps prompt + image together.
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
import { setEmailHero, type EmailHeroKind } from "./email-hero-store";
import { recordAiUsage } from "./ai-usage-store";
import { reportError } from "./observability";

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

/**
 * The fixed style/constraint tail every hero prompt carries — the motion
 * sports look (matte black equipment, red accents, bright clean setting) plus
 * the hard rules image models need stated explicitly. Appended to the AI
 * scene suggestion and shown to the operator as part of the editable text.
 */
export const HERO_PROMPT_STYLE_TAIL =
  "Photorealistic premium e-commerce hero shot in a bright modern home gym: " +
  "clean white and light-grey concrete surfaces, soft natural daylight from a " +
  "large window, matte black fitness equipment with subtle red accents, shallow " +
  "depth of field, calm and motivating mood. WIDE LANDSCAPE composition (3:2). " +
  "IMPORTANT COMPOSITION RULE: the left 45% of the frame must stay very bright, " +
  "soft and almost empty — an out-of-focus near-white wall or floor area that " +
  "fades smoothly into the scene — because dark headline text is placed there; " +
  "all products and visual interest belong in the right half. Strictly no text, " +
  "no lettering, no logos, no watermarks, no human faces.";

/** The default hero asset used when a send has no custom hero. */
export function defaultHeroImageUrl(): string {
  return process.env.EMAIL_HERO_DEFAULT_URL || `${getBaseUrl()}/email-hero-default.jpg`;
}

/** Both external services the generator needs (image model + blob store). */
export function isHeroGenerationConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY) && Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

interface HeroContext {
  productNames: string[];
  proseExcerpt: string;
  extraContext: string[];
}

/** Assemble the personalisation context for one draft. Null → unknown draft. */
async function loadHeroContext(
  kind: EmailHeroKind,
  id: number
): Promise<HeroContext | null> {
  if (kind === "marketing") {
    const send = await getSendById(id);
    if (!send) return null;
    const products = send.productIds.length ? await getProductsByIds(send.productIds) : [];
    const extra: string[] = [];
    if (send.personaLabel) extra.push(`Persona: ${send.personaLabel}`);
    if (send.adminInstructions) extra.push(`Team-Hinweise: ${send.adminInstructions}`);
    return {
      productNames: products.map((p) => p.name),
      proseExcerpt: (send.draftedText ?? "").slice(0, 800),
      extraContext: extra,
    };
  }
  const contact = await getContactById(id);
  const draft = await getDraftForContact(id);
  if (!contact || !draft) return null;
  const products = draft.recommendedProductIds.length
    ? await getProductsByIds(draft.recommendedProductIds)
    : [];
  return {
    productNames: products.map((p) => p.name),
    proseExcerpt: draft.body.slice(0, 800),
    extraContext: contact.language === "en" ? ["Empfänger-Sprache: Englisch"] : [],
  };
}

/** Deterministic fallback scene when the prompt model is unavailable/fails. */
function fallbackScene(ctx: HeroContext): string {
  const items = ctx.productNames.slice(0, 3).join(", ");
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
          "Fitness-Shops — das Erste, was diese eine Person sieht: eine " +
          "Bild-Szene (englisch, für ein Bildmodell) und eine deutsche " +
          "Schlagzeile aus genau zwei kurzen Zeilen. Beides muss zu den " +
          "empfohlenen Produkten und zur Geschichte dieser E-Mail passen.",
        prompt: [
          ctx.productNames.length
            ? `Empfohlene Produkte:\n${ctx.productNames.map((n) => `- ${n}`).join("\n")}`
            : "Empfohlene Produkte: (keine — allgemeines Home-Gym-Zubehör)",
          ctx.proseExcerpt ? `\nE-Mail-Text (Auszug):\n${ctx.proseExcerpt}` : "",
          ctx.extraContext.length ? `\n${ctx.extraContext.join("\n")}` : "",
          "\nEntwirf Szene und Schlagzeile.",
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
      prompt: trimmed,
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

    const blob = await put(
      `email-heroes/${kind}-${id}-${Date.now()}.png`,
      Buffer.from(b64, "base64"),
      { access: "public", contentType: "image/png", addRandomSuffix: false }
    );

    const saved = await setEmailHero(kind, id, blob.url, trimmed);
    if (!saved.ok) {
      return {
        ok: false,
        message: saved.notFound
          ? "Entwurf nicht gefunden — bitte zuerst einen Entwurf erzeugen."
          : "Bild erzeugt, aber Speichern am Entwurf fehlgeschlagen.",
      };
    }
    return { ok: true, url: blob.url };
  } catch (err) {
    reportError(err, { route: "lib/email-hero", phase: "generate" });
    return { ok: false, message: "Bild-Generierung fehlgeschlagen — bitte erneut versuchen." };
  }
}
