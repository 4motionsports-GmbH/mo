// Automatic quality check of a rendered hero BEFORE the operator sees it: a
// vision model looks at the picture and answers the questions that decide
// whether the hero works in the mail — calm left part, products on the
// right, no stray text, no pasted-in catalogue cut-outs, products true to the
// named ones. A failing verdict triggers ONE re-render (email-hero.ts); the
// better of the two is kept. Costs about a cent per check.
//
// The verdict logic is pure and tested; the model call takes its
// generateObject implementation as a parameter so it is testable too.

import { z } from "zod";

export const HERO_QA_MODEL = "claude-sonnet-4-6";
/** How many renders a single "Bild generieren" may spend: the first, plus
 * one retry when the check fails. */
export const HERO_QA_MAX_RENDERS = 2;
/** Overall score (1–10) below which the picture is re-rendered. */
export const HERO_QA_MIN_SCORE = 6;

export const heroQaSchema = z.object({
  leftCalm: z
    .boolean()
    .describe("Is the LEFT ~45% of the frame a calm, bright, mostly empty wall/floor with no equipment or clutter?"),
  productsRight: z.boolean().describe("Is all the equipment placed in the right part of the frame?"),
  strayText: z
    .boolean()
    .describe("Is there any lettering other than small brand markings on the equipment (headlines, captions, posters, watermarks)?"),
  cutoutLook: z
    .boolean()
    .describe("Does any product look pasted in — flat catalogue cut-out, white box around it, wrong perspective or lighting?"),
  // No .min()/.max() here: Anthropic's structured output rejects JSON-schema
  // `minimum`/`maximum` on numbers ("properties maximum, minimum are not
  // supported" — the first live run failed every check on that). The ranges
  // live in the descriptions and are clamped in clampReview.
  productFidelity: z
    .number()
    .describe("Integer 1–5: do the products look like real, specific fitness equipment of the named type and brand (5) or generic/deformed (1)?"),
  overall: z.number().describe("Integer 1–10: overall quality as a premium e-commerce hero photo."),
  issues: z.array(z.string()).describe("Short list (at most 5) of concrete problems, empty when none."),
});

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(n) ? Math.round(n) : lo));

/** Bring a model answer into the documented ranges. */
export function clampReview(review) {
  return {
    ...review,
    productFidelity: clamp(review.productFidelity, 1, 5),
    overall: clamp(review.overall, 1, 10),
    issues: Array.isArray(review.issues) ? review.issues.slice(0, 5) : [],
  };
}

/** Is the check switched on? Needs the Anthropic key; EMAIL_HERO_QA=off disables. */
export function heroQaEnabled(env = process.env) {
  return (env.EMAIL_HERO_QA ?? "").trim().toLowerCase() !== "off" && Boolean(env.ANTHROPIC_API_KEY);
}

/**
 * Pass/fail from a review. Hard fails: busy left part (the headline becomes
 * unreadable), stray text (collides with the design's own headline), a
 * cut-out look (the reference photos were pasted, not photographed). A low
 * overall score fails too.
 * @param {z.infer<typeof heroQaSchema>} review
 * @returns {{ pass: boolean, score: number, reasons: string[] }}
 */
export function heroQaVerdict(review) {
  const reasons = [];
  if (!review.leftCalm) reasons.push("linke Bildhälfte nicht ruhig");
  if (!review.productsRight) reasons.push("Geräte nicht rechts");
  if (review.strayText) reasons.push("Fremdtext im Bild");
  if (review.cutoutLook) reasons.push("Produkte wirken eingeklebt");
  if (review.overall < HERO_QA_MIN_SCORE) reasons.push(`Gesamtwertung ${review.overall}/10`);
  return { pass: reasons.length === 0, score: review.overall, reasons };
}

/** Pick the better of several reviewed renders: a passing one over a failing
 * one, then the higher score, then the earlier (cheaper) one. */
export function pickBestRender(items) {
  return [...items].sort((a, b) => {
    const pa = a.verdict?.pass ? 1 : 0;
    const pb = b.verdict?.pass ? 1 : 0;
    if (pa !== pb) return pb - pa;
    return (b.verdict?.score ?? 0) - (a.verdict?.score ?? 0);
  })[0];
}

export function heroQaPrompt(productNames = []) {
  const named = productNames.length ? `The products meant to be shown: ${productNames.join("; ")}.` : "";
  return (
    "You are checking a generated background photo for an e-mail hero. A dark headline will be printed over " +
    "its LEFT part, so that part must be a calm, bright, empty wall/floor; all equipment belongs on the right. " +
    "Small brand lettering on the equipment is fine, any other text is not. " +
    named +
    " Judge strictly like an art director for a premium fitness shop."
  );
}

/**
 * Run the check.
 * @param {Buffer | Uint8Array} imageBytes JPEG/PNG of the hero (before the gradient — the check is about the scene)
 * @param {{ productNames?: string[], model?: string, generate?: Function, modelFactory?: Function }} [opts]
 * @returns {Promise<{ review: z.infer<typeof heroQaSchema>, verdict: ReturnType<typeof heroQaVerdict>, model: string, usage: { inputTokens: number, outputTokens: number } }>}
 */
export async function reviewHeroImage(imageBytes, opts = {}) {
  const model = opts.model ?? HERO_QA_MODEL;
  const generate = opts.generate ?? (await import("ai")).generateObject;
  const modelFactory = opts.modelFactory ?? (await import("@ai-sdk/anthropic")).anthropic;
  const { object, usage } = await generate({
    model: modelFactory(model),
    schema: heroQaSchema,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", image: imageBytes, mediaType: "image/jpeg" },
          { type: "text", text: heroQaPrompt(opts.productNames) },
        ],
      },
    ],
  });
  const review = clampReview(object);
  return {
    review,
    verdict: heroQaVerdict(review),
    model,
    usage: { inputTokens: usage?.inputTokens ?? 0, outputTokens: usage?.outputTokens ?? 0 },
  };
}
