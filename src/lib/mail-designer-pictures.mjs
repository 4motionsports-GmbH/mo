// The picture tool of the KI-Gestalter — `generate_image`, the „Bild-KI“ the
// designer model delegates to (owner, 12.11.2026: „the ai automatically
// delegates a task to a picture generating ai … a hero section with a nice
// integration of the headline in the hero picture … a nice looking barrier
// tape“). The pure core, tested in mail-designer-pictures.test.mjs; the
// OpenAI calls, the reference photos, the text check and the storage live in
// mail-designer-pictures-io.ts; the loop (runDesigner), the submission check
// and the placeholder swap in mail-template-designer.mjs. docs/EMAIL_TEMPLATES.md §6.
//
// How it works — asynchronous, so the model keeps designing:
//   1. The model calls generate_image { purpose, prompt, aspect, textInImage?,
//      transparent?, productRefs?, name?, realistic? }. The studio
//      (createPictureStudio) checks the input (parsePictureInput: no prices,
//      percentages, codes, dates or links in the picture's text), the limit
//      (3 per run), the time left and the product refs, starts the render in
//      the background and answers AT ONCE with a placeholder address
//      https://bild.invalid/N (RFC 2606 — never resolves) plus width and
//      height. The model puts it into an image src or a section bgImage.
//   2. The render (injected; the I/O layer: gpt-image-2 like the hero
//      pipeline — designerPictureAttempts, the catalogue photos of
//      productRefs as references, designerPicturePrompt) runs while the loop
//      goes on; renderPictureWithCheck reads a picture's text with a vision
//      model once and re-renders once when it is wrong and time allows.
//   3. The submission check accepts exactly the placeholders of pictures
//      started in this run (a failed one is a problem the model fixes).
//   4. After the run the studio settles (bounded by the deadline plus a
//      short grace), the I/O layer stores the pictures the accepted design
//      uses and the placeholders are swapped — a picture that failed or did
//      not finish is removed cleanly (finishDesignerPictures).
//
// The tool is in the tool list on EVERY step of every run (the append-only
// loop: the same tools, a fixed system prompt) — when pictures are switched
// off (Einstellungen → „Bilder mit KI erzeugen“) or not configured (no
// OPENAI_API_KEY / BLOB_READ_WRITE_TOKEN) it answers so, and the working
// rules of the run say it up front.

import { HERO_FALLBACK_IMAGE_MODEL, HERO_PRIMARY_IMAGE_MODEL, inputFidelityFor } from "./email-hero-variants.mjs";
import { referenceInstruction } from "./email-hero-references.mjs";
import { DESIGNER_PICTURES_PER_RUN } from "./mail-template-designer-settings.mjs";

/** Bounds of the picture tool. */
export const DESIGNER_PICTURE_LIMITS = Object.freeze({
  /** Pictures one run may start (each costs about 0.20 € and up to a minute). */
  perRun: DESIGNER_PICTURES_PER_RUN,
  /** The model's description of the picture (what goes to the image model). */
  promptChars: 1500,
  minPromptChars: 12,
  /** Text rendered INTO the picture (textInImage). */
  textChars: 60,
  nameChars: 40,
  /** Catalogue products whose photos go along as references. */
  productRefs: 4,
  /** A picture is started only with at least this much of the model's time left. */
  startMinMs: 75_000,
  /** A second render after a failed text check only with at least this much time left. */
  rerenderMinMs: 70_000,
  /** Renders may run until this long after the model's deadline (the route still answers within maxDuration). */
  afterDeadlineMs: 3_000,
  /** Started pictures in all, failed ones included (a failed one frees its place, up to this). */
  attemptsPerRun: 5,
  /** After a render is aborted, its promise is given this long to settle before it counts as failed. */
  abortGraceMs: 1_500,
});

/** What a picture is for. */
export const PICTURE_PURPOSES = Object.freeze(["hero", "banner", "background", "decoration", "icon", "scene"]);

/** German names of the purposes (progress lines, warnings). */
export const PICTURE_PURPOSE_LABELS = Object.freeze({
  hero: "Titelbereich",
  banner: "Banner",
  background: "Hintergrund",
  decoration: "Schmuckelement",
  icon: "Icon",
  scene: "Stimmungsbild",
});

/**
 * The formats — sizes gpt-image-2 renders natively (free sizes: multiples of
 * 16, at most 3:1); `classic` is the size every GPT image model accepts (the
 * fallback; a banner rendered there is cropped to 3:1 afterwards).
 */
export const PICTURE_ASPECTS = Object.freeze({
  wide: Object.freeze({ width: 1536, height: 1024, size: "1536x1024", classic: "1536x1024", label: "3:2 quer" }),
  banner: Object.freeze({ width: 1536, height: 512, size: "1536x512", classic: "1536x1024", label: "3:1 Band" }),
  square: Object.freeze({ width: 1024, height: 1024, size: "1024x1024", classic: "1024x1024", label: "quadratisch" }),
  tall: Object.freeze({ width: 1024, height: 1536, size: "1024x1536", classic: "1024x1536", label: "2:3 hoch" }),
});

/** The format a purpose gets when the model names none. */
const DEFAULT_ASPECT = Object.freeze({ hero: "wide", banner: "banner", background: "wide", decoration: "banner", icon: "square", scene: "wide" });

/** Photo-like by default (they get the EU label „AI GENERATED“) — graphics are not. */
const REALISTIC_BY_DEFAULT = new Set(["hero", "banner", "background", "scene"]);

/** The widest file stored per purpose (an icon shows at 48–96 px — 2× is plenty). */
export const PICTURE_STORE_WIDTH = Object.freeze({ hero: 1200, banner: 1200, background: 1200, decoration: 1200, icon: 320, scene: 1200 });

/** The reserved placeholder of generated picture N (see the header). */
export const PICTURE_URL_PREFIX = "https://bild.invalid/";

/** The placeholder URL of picture N. @param {number} n */
export function picturePlaceholderUrl(n) {
  return `${PICTURE_URL_PREFIX}${n}`;
}

/** N of a picture placeholder URL, or null. @param {unknown} url */
export function pictureIndexFromUrl(url) {
  const m = /^https:\/\/bild\.invalid\/(\d{1,2})\/?$/i.exec(String(url ?? "").trim());
  return m ? Number(m[1]) : null;
}

/** "bild:N" (the short form a model may write, like "anhang:N") → N, or null. @param {unknown} v */
export function pictureRefIndex(v) {
  const m = /^\s*bild\s*:\s*(\d{1,2})\s*$/i.exec(String(v ?? ""));
  return m ? Number(m[1]) : null;
}

// ── small helpers ────────────────────────────────────────────────────────────

/** @param {unknown} v @returns {v is Record<string, any>} */
function isObj(v) {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}

/** One line, control characters out, cut to `max`. @param {unknown} v @param {number} max */
function oneLine(v, max) {
  return String(typeof v === "string" ? v : "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/** Shorten to `max` characters with „…“. @param {string} s @param {number} max */
function clip(s, max) {
  return s.length <= max ? s : `${s.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

/** @param {number} n @param {string} one @param {string} many */
function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

// ── what may not be in a picture ─────────────────────────────────────────────

const PRICE_IN_TEXT_RE = /\d\s*(?:€|eur\b|euro\b)|(?:€|\beur\b)\s*\d/i;
const PERCENT_IN_TEXT_RE = /\d\s*(?:%|prozent\b|percent\b)/i;
const LINK_IN_TEXT_RE = /https?:\/\/|\bwww\.|@|\b[a-z0-9-]+\.(?:de|com|net|org|shop|eu|info|io|at|ch)\b/i;
const DATE_IN_TEXT_RE =
  /\b\d{1,2}\.\s?\d{1,2}\.|\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\.?\s+(?:jan(?:uar)?|feb(?:ruar)?|märz|mär|apr(?:il)?|mai|juni?|juli?|aug(?:ust)?|sep(?:t(?:ember)?)?|okt(?:ober)?|nov(?:ember)?|dez(?:ember)?)\b|\b\d{1,2}:\d{2}\b|\b\d{1,2}\.\d{2}\s?(?:uhr|h)\b|\b\d{1,2}\s?uhr\b/i;
/** A token of capitals mixed with digits („BLACK25“, „WEEK-30“) — a code. */
const CODE_IN_TEXT_RE = /\b(?=[A-Z0-9_-]*\d)(?=[A-Z0-9_-]*[A-Z])[A-Z0-9][A-Z0-9_-]{3,}\b/;
const PHONE_IN_TEXT_RE = /\+?\d[\d ()/-]{7,}\d/;

/**
 * Why a text may not stand in a picture (it must stay live, checkable text in
 * the mail), or null: prices, percentages, codes, dates and times, links,
 * e-mail addresses, phone numbers.
 * @param {string} text
 * @returns {string | null}
 */
export function forbiddenPictureText(text) {
  const s = String(text ?? "");
  if (PRICE_IN_TEXT_RE.test(s)) return "Preise";
  if (PERCENT_IN_TEXT_RE.test(s)) return "Prozente";
  if (LINK_IN_TEXT_RE.test(s)) return "Links oder Adressen";
  if (DATE_IN_TEXT_RE.test(s)) return "Daten oder Uhrzeiten";
  if (PHONE_IN_TEXT_RE.test(s)) return "Telefonnummern";
  if (CODE_IN_TEXT_RE.test(s)) return "Codes";
  return null;
}

// ── the tool's input ─────────────────────────────────────────────────────────

/** The input schema of generate_image (lenient JSON schema — tool input is not compiled). */
export const PICTURE_INPUT_SCHEMA = Object.freeze({
  type: "object",
  properties: {
    purpose: {
      type: "string",
      enum: [...PICTURE_PURPOSES],
      description:
        "Wofür das Bild ist: hero = Titelbereich (auch mit eingebauter Überschrift) · banner = ganzbreites Band (Aktion, Saison) · background = Hintergrund eines Abschnitts mit Live-Text darüber (ruhig, ohne Text) · decoration = Schmuckelement (Absperrband, Papierkante, Badge, Sticker) · icon = Symbol, z. B. für eine Vorteile-Leiste · scene = Stimmungsbild (z. B. Training zu Hause).",
    },
    prompt: {
      type: "string",
      description:
        "Was das Bild zeigt — am besten auf Englisch (Bild-KIs verstehen Englisch am besten): Motiv, Stil (Foto, Illustration, flach, 3D …), Licht und Stimmung, die Farben der Mail als #rrggbb, Bildaufbau und wo Live-Text Platz braucht (z. B. „calm dark area on the left“). 12–1500 Zeichen. Keine Preise, Prozente, Codes, Daten, Links oder fremden Logos.",
    },
    aspect: {
      type: "string",
      enum: Object.keys(PICTURE_ASPECTS),
      description:
        "Format: wide = 1536×1024 (3:2 — Titelbild, Szene, Hintergrund) · banner = 1536×512 (3:1 — ganzbreites Band, Absperrband) · square = 1024×1024 (Icon, Badge, Sticker) · tall = 1024×1536 (2:3 — Bild in einer Spalte).",
    },
    textInImage: {
      type: "string",
      description:
        "Optional: genau dieser Text erscheint IM Bild (höchstens 60 Zeichen, in der Sprache der Mail, genau so geschrieben) — z. B. eine Überschrift, die ins Motiv eingebaut ist. Nie Preise, Prozente, Codes, Daten, Links oder Rechtliches. Der Text gehört auch in den alt-Text; Wichtiges steht zusätzlich als Live-Text in der Mail.",
    },
    transparent: {
      type: "boolean",
      description: "Optional: true = PNG mit transparentem Hintergrund — für Schmuckelemente, Sticker und Icons, die auf der Farbe des Abschnitts liegen.",
    },
    productRefs: {
      type: "array",
      items: { type: "string" },
      description:
        "Optional: bis zu 4 refs aus search_products — ihre echten Katalogfotos sind die Vorlage, damit die Produkte echt aussehen. Produkte zeigt ein erzeugtes Bild nur so, nie frei erfunden.",
    },
    name: { type: "string", description: "Optional: kurzer deutscher Name für die Person, z. B. „Titelbild mit Überschrift“ oder „Absperrband“ (höchstens 40 Zeichen)." },
    realistic: {
      type: "boolean",
      description:
        "Optional: wirkt das Bild wie ein echtes Foto (Menschen, Räume, Geräte)? Dann setzt Mo das EU-Kennzeichen „AI GENERATED“ darunter. Standard: true bei hero, banner, background und scene, false bei decoration und icon — für Grafik, Muster oder reine Typografie false setzen.",
    },
  },
  required: ["purpose", "prompt", "aspect"],
  additionalProperties: true,
});

/**
 * @typedef {"hero" | "banner" | "background" | "decoration" | "icon" | "scene"} PicturePurpose
 * @typedef {"wide" | "banner" | "square" | "tall"} PictureAspect
 * @typedef {{
 *   purpose: PicturePurpose,
 *   prompt: string,
 *   aspect: PictureAspect,
 *   text: string,
 *   transparent: boolean,
 *   productRefs: string[],
 *   name: string,
 *   realistic: boolean,
 * }} PictureRequest
 */

/**
 * The generate_image input → a clean request, or the problems for the model
 * (the call then does not count). Lenient where a default is obvious (an
 * unknown or missing aspect → the purpose's format, the purpose's realism);
 * strict about what would end up IN the picture: textInImage at most 60
 * characters and never prices, percentages, codes, dates, links or phone
 * numbers (forbiddenPictureText) — those must stay live, checkable text; the
 * prompt may not ask for prices or links either (a percentage there is
 * composition: „the left 40 % stays calm“).
 * @param {unknown} raw
 * @returns {{ ok: true, value: PictureRequest } | { ok: false, problems: string[] }}
 */
export function parsePictureInput(raw) {
  const r = isObj(raw) ? raw : {};
  const L = DESIGNER_PICTURE_LIMITS;
  /** @type {string[]} */
  const problems = [];
  const purpose = /** @type {PicturePurpose} */ (typeof r.purpose === "string" && PICTURE_PURPOSES.includes(r.purpose.trim().toLowerCase()) ? r.purpose.trim().toLowerCase() : "");
  if (!purpose) problems.push(`purpose fehlt oder ist unbekannt — eines von ${PICTURE_PURPOSES.join(", ")}.`);
  const aspectRaw = typeof r.aspect === "string" ? r.aspect.trim().toLowerCase() : "";
  const aspect = /** @type {PictureAspect} */ (Object.hasOwn(PICTURE_ASPECTS, aspectRaw) ? aspectRaw : DEFAULT_ASPECT[purpose || "hero"]);
  const promptFull = String(typeof r.prompt === "string" ? r.prompt : "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (promptFull.length < L.minPromptChars) problems.push("prompt fehlt — beschreibe Motiv, Stil, Farben (#rrggbb) und Bildaufbau (am besten auf Englisch).");
  const prompt = promptFull.slice(0, L.promptChars);
  // (percentages stay allowed here — „the left 40 % of the frame stays calm“ is composition, not a claim)
  if (PRICE_IN_TEXT_RE.test(prompt) || /https?:\/\/|\bwww\./i.test(prompt)) {
    problems.push("prompt: Preise und Links gehören nicht ins Bild — sie stehen als Live-Text in der Mail. Beschreibe nur das Motiv.");
  }
  const textRaw = String(typeof r.textInImage === "string" ? r.textInImage : "").replace(/\s+/g, " ").trim();
  if (textRaw.length > L.textChars) problems.push(`textInImage ist zu lang (${textRaw.length} Zeichen, höchstens ${L.textChars}) — kürzer fassen; der Rest steht als Live-Text in der Mail.`);
  const forbidden = textRaw ? forbiddenPictureText(textRaw) : null;
  if (forbidden) {
    problems.push(`textInImage: ${forbidden} gehören nie ins Bild — sie müssen als Live-Text prüfbar und aktuell bleiben. Nur eine Überschrift oder einen Slogan ins Bild setzen.`);
  }
  if (/\{\{/.test(textRaw)) problems.push("textInImage: Platzhalter wie {{vorname}} werden in Bildern nicht ersetzt.");
  /** @type {string[]} */
  const productRefs = [];
  for (const ref of Array.isArray(r.productRefs) ? r.productRefs : []) {
    const v = typeof ref === "string" ? ref.trim() : "";
    if (v && !productRefs.includes(v)) productRefs.push(v);
  }
  if (productRefs.length > L.productRefs) productRefs.length = L.productRefs;
  if (problems.length) return { ok: false, problems };
  return {
    ok: true,
    value: {
      purpose,
      prompt,
      aspect,
      text: textRaw,
      transparent: r.transparent === true,
      productRefs,
      name: oneLine(r.name, L.nameChars),
      realistic: typeof r.realistic === "boolean" ? r.realistic : REALISTIC_BY_DEFAULT.has(purpose),
    },
  };
}

/**
 * How a picture is named for the operator: the model's name, else the
 * purpose with its text („Titelbereich „Winter-Power““).
 * @param {{ name?: string, purpose: string, text?: string }} job
 */
export function pictureLabel(job) {
  if (job.name) return job.name;
  const base = PICTURE_PURPOSE_LABELS[/** @type {PicturePurpose} */ (job.purpose)] ?? "Bild";
  return job.text ? `${base} „${clip(job.text, 30)}“` : base;
}

// ── the image model ──────────────────────────────────────────────────────────

/** What each purpose asks the image model for (English — the image models follow English best). */
const PURPOSE_BRIEF = Object.freeze({
  hero:
    "An e-mail hero visual — the first thing readers see at the top of a marketing e-mail from motion sports, a German online shop for fitness equipment. One strong focal point, premium commercial look, crisp details.",
  banner: "A full-width e-mail banner band for motion sports, a German online shop for fitness equipment: bold, flat and clear, it must read at 600 px wide.",
  background:
    "A background picture for a section of a marketing e-mail with live text laid over it: calm and low in detail where the text sits, soft contrast, still good when slightly darkened. No text in the picture.",
  decoration:
    "A decorative graphic element for an e-mail layout (for example a barrier tape, a torn paper edge, a badge or a sticker): clean edges, print quality, nothing else in the frame.",
  icon: "One simple icon for an e-mail benefit bar: a single centred symbol, clean geometric shapes, consistent stroke and fill, generous padding, legible at 48 px.",
  scene: "A photographic lifestyle scene for a fitness e-mail: realistic materials, natural light, high-end commercial photography.",
});

/**
 * The full prompt for the image model: the purpose's brief, the model's
 * description, the format (with the crop rule when a banner is rendered in
 * 3:2), the text rule (exactly this text and nothing else — or no text at
 * all), transparency, the reference photos and what never goes into a picture.
 * @param {PictureRequest} job
 * @param {{ size?: string | null, cropTo?: string | null, references?: ReadonlyArray<{ label: string, role: "new" | "owned" }>, emphasizeText?: boolean }} [opts]
 *   size: the size the attempt renders; cropTo: the format it is cropped to afterwards (a banner rendered in 3:2)
 */
export function designerPicturePrompt(job, opts = {}) {
  const a = PICTURE_ASPECTS[job.aspect] ?? PICTURE_ASPECTS.wide;
  const parts = [PURPOSE_BRIEF[job.purpose] ?? PURPOSE_BRIEF.hero, job.prompt];
  const shape = job.aspect === "banner" ? "a wide 3:1 band" : job.aspect === "square" ? "square" : job.aspect === "tall" ? "portrait 2:3" : "landscape 3:2";
  if (opts.cropTo) {
    const rendered = String(opts.size ?? "").replace("x", "×") || "a 3:2 canvas";
    parts.push(
      `Format: rendered at ${rendered} px, but only the middle band of ${a.width}×${a.height} px (${shape}) is used: compose everything important — and any text — inside the middle third of the height; the top and bottom thirds are cropped away.`
    );
  } else {
    parts.push(`Format: ${a.width}×${a.height} px (${shape}).`);
  }
  if (job.text) {
    let rule = `Render this text exactly once, letter for letter, and no other words, letters or numbers anywhere in the picture: "${job.text}". Bold, clean, highly legible lettering integrated into the design with strong contrast, fully inside the frame with a safe margin of at least 8 % from every edge.`;
    if (opts.emphasizeText) {
      rule += ` Spelling matters more than anything else: the text has ${[...job.text].length} characters and must read exactly "${job.text}" — every letter, umlaut and hyphen as written, nothing added, nothing missing.`;
    }
    parts.push(rule);
  } else {
    parts.push("No text at all: no letters, words, numbers, logos, signs or watermarks.");
  }
  if (job.transparent) parts.push("Transparent background: only the element itself, cleanly isolated — no backdrop, no floor, no frame, no shadow plane.");
  const refs = opts.references ?? [];
  if (refs.length) parts.push(referenceInstruction(/** @type {any} */ (refs)));
  parts.push("Never show prices, percentages, discount codes, dates, web addresses or brand logos other than the markings on the reference products.");
  return parts.join("\n\n");
}

/**
 * The render attempts of one picture, in order — the hero pipeline's chain
 * (email-hero-variants.mjs heroImageAttempts) in the picture's format: with
 * reference photos first images.edit, then images.generate with the primary
 * model (EMAIL_HERO_IMAGE_MODEL, default gpt-image-2) in the native size, the
 * classic size when that differs (a banner — cropped to 3:1 afterwards:
 * `cropTo`), then the previous-generation model (gpt-image-1.5) in the
 * classic size. Quality EMAIL_HERO_IMAGE_QUALITY (default high). A
 * transparent picture asks every attempt for a transparent PNG.
 * @param {Record<string, string | undefined>} [env]
 * @param {{ aspect?: string, transparent?: boolean, withReferences?: boolean }} [opts]
 * @returns {Array<{ mode: "generate" | "edit", model: string, size: string, quality: string, inputFidelity?: "high", cropTo?: string, background?: "transparent" }>}
 */
export function designerPictureAttempts(env = process.env, opts = {}) {
  const primary = (env.EMAIL_HERO_IMAGE_MODEL ?? "").trim() || HERO_PRIMARY_IMAGE_MODEL;
  const q = (env.EMAIL_HERO_IMAGE_QUALITY ?? "").trim().toLowerCase();
  const quality = ["low", "medium", "high"].includes(q) ? q : "high";
  const key = opts.aspect && Object.hasOwn(PICTURE_ASPECTS, opts.aspect) ? opts.aspect : "wide";
  const a = PICTURE_ASPECTS[/** @type {PictureAspect} */ (key)];
  const sizes = a.size === a.classic ? [a.size] : [a.size, a.classic];
  const crop = (/** @type {string} */ size) => (size === a.size ? {} : { cropTo: key });
  /** @type {Array<any>} */
  const out = [];
  if (opts.withReferences) {
    const fidelity = inputFidelityFor(primary);
    for (const size of sizes) out.push({ mode: "edit", model: primary, size, quality, ...(fidelity ? { inputFidelity: fidelity } : {}), ...crop(size) });
  }
  for (const size of sizes) out.push({ mode: "generate", model: primary, size, quality, ...crop(size) });
  if (primary !== HERO_FALLBACK_IMAGE_MODEL) out.push({ mode: "generate", model: HERO_FALLBACK_IMAGE_MODEL, size: a.classic, quality, ...crop(a.classic) });
  return opts.transparent ? out.map((x) => ({ ...x, background: "transparent" })) : out;
}

/**
 * The centred crop that turns a w×h render into the picture's format
 * (a banner rendered in 3:2 → its middle 3:1 band), or null when it already fits.
 * @param {number} width @param {number} height @param {string} aspect
 * @returns {{ left: number, top: number, width: number, height: number } | null}
 */
export function pictureCrop(width, height, aspect) {
  const a = PICTURE_ASPECTS[/** @type {PictureAspect} */ (aspect)];
  const w = Math.round(Number(width) || 0);
  const h = Math.round(Number(height) || 0);
  if (!a || w <= 0 || h <= 0) return null;
  const target = a.width / a.height;
  const ratio = w / h;
  if (Math.abs(ratio - target) / target < 0.02) return null;
  if (ratio < target) {
    const ch = Math.max(1, Math.round(w / target));
    return { left: 0, top: Math.max(0, Math.round((h - ch) / 2)), width: w, height: Math.min(h, ch) };
  }
  const cw = Math.max(1, Math.round(h * target));
  return { left: Math.max(0, Math.round((w - cw) / 2)), top: 0, width: Math.min(w, cw), height: h };
}

// ── the text check ───────────────────────────────────────────────────────────

/**
 * A text as the comparison sees it: letters and digits only (case, quotes,
 * dashes, punctuation and line breaks do not matter — a picture may set a
 * headline in capitals), „ß“ as „ss“ (capital lettering writes SS).
 * @param {unknown} s
 */
export function normalizePictureText(s) {
  return String(s ?? "")
    .normalize("NFC")
    .toLowerCase()
    .replace(/ß/g, "ss")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Edit distance of two short strings. @param {string} a @param {string} b */
function editDistance(a, b) {
  const x = [...a];
  const y = [...b];
  let prev = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    const cur = [i];
    for (let j = 1; j <= y.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[y.length];
}

/**
 * Does the rendered text match? `read` is what a vision model transcribed
 * (all lettering of the picture, without being told the expected text).
 * Passes only when it is legible and — compared as normalizePictureText — the
 * same; `score` (0…1, similarity) decides which of two renders is better.
 * @param {{ expected: string, read: string, legible: boolean }} r
 * @returns {{ pass: boolean, score: number, read: string }}
 */
export function pictureTextVerdict({ expected, read, legible }) {
  const e = normalizePictureText(expected);
  const g = normalizePictureText(read);
  const longest = Math.max(e.length, g.length, 1);
  const score = Math.max(0, 1 - editDistance(e.slice(0, 200), g.slice(0, 200)) / longest);
  return { pass: Boolean(legible) && e.length > 0 && e === g, score: Math.round(score * 1000) / 1000, read: oneLine(read, 120) };
}

/** The instruction of the text check (the vision model is NOT told the expected text — it transcribes). */
export const PICTURE_TEXT_CHECK_PROMPT =
  "Transcribe ALL lettering visible in this picture exactly as it is written, in reading order — keep the spelling, umlauts, hyphens and punctuation as rendered, do not correct anything. Ignore tiny brand markings printed on fitness equipment. Return an empty text when there is no lettering. Say whether the main lettering is clearly legible at a glance.";

/**
 * The warning when a picture's text is not certainly right (after the second
 * render, or without time for one).
 * @param {{ n: number, text: string }} job
 * @param {{ read?: string } | null | undefined} verdict
 */
export function pictureTextWarning(job, verdict) {
  const read = verdict?.read ? `, gelesen „${clip(verdict.read, 60)}“` : "";
  return `Bild ${job.n}: Der Text im Bild ist nicht sicher richtig (erwartet „${job.text}“${read}) — bitte prüfen oder das Bild neu erzeugen lassen.`;
}

/**
 * @typedef {{ inputTokens: number, outputTokens: number, cacheReadTokens: number, cacheWriteTokens: number }} PictureUsage
 * @typedef {{ model: string, usage: PictureUsage, usageComplete: boolean }} PictureCall
 *   one billed call (an image render or a text check) — the shape of
 *   DesignerModelCall, so the run line prices it with the model calls.
 * @typedef {{ bytes: Uint8Array, width: number, height: number, transparent: boolean, model: string }} PictureImage
 * @typedef {(
 *   | { ok: true, image: PictureImage, calls: PictureCall[], warnings: string[] }
 *   | { ok: false, reason: string, calls: PictureCall[], warnings?: string[] }
 * )} PictureOutcome
 * @typedef {PictureRequest & { n: number, width: number, height: number, label: string }} PictureJob
 */

/**
 * One picture: render it, and when it carries text, read the text back once
 * (`checkText`, a cheap vision call) — wrong or unreadable text gets ONE more
 * render with the spelling stressed when time allows (`rerenderMinMs` before
 * `deadlineAt`); the better of the two is kept (a passing one, else the higher
 * score) and a picture whose text is still not certainly right carries a
 * warning. A check that cannot run keeps the picture without a warning. Never
 * throws when the injected functions do not.
 * @param {PictureJob} job
 * @param {{
 *   renderOnce: (job: PictureJob, o: { attempt: number, emphasizeText: boolean, signal?: AbortSignal }) => Promise<PictureOutcome>,
 *   checkText?: ((image: PictureImage, expected: string, o: { signal?: AbortSignal }) => Promise<{ verdict: ReturnType<typeof pictureTextVerdict>, calls: PictureCall[] } | null>) | null,
 *   now?: () => number,
 *   deadlineAt?: number | null,
 *   signal?: AbortSignal,
 * }} deps
 * @returns {Promise<PictureOutcome & { rerendered?: boolean }>}
 */
export async function renderPictureWithCheck(job, deps) {
  const now = deps.now ?? (() => Date.now());
  /** @type {PictureCall[]} */
  const calls = [];
  /** @type {string[]} */
  const warnings = [];
  const first = await deps.renderOnce(job, { attempt: 1, emphasizeText: false, signal: deps.signal });
  calls.push(...(first.calls ?? []));
  warnings.push(...(first.warnings ?? []));
  if (!first.ok) return { ok: false, reason: first.reason, calls, warnings };
  if (!job.text || !deps.checkText || deps.signal?.aborted) return { ok: true, image: first.image, calls, warnings };
  const check = async (/** @type {PictureImage} */ image) => {
    try {
      const res = await /** @type {NonNullable<typeof deps.checkText>} */ (deps.checkText)(image, job.text, { signal: deps.signal });
      if (res) calls.push(...(res.calls ?? []));
      return res?.verdict ?? null;
    } catch {
      return null;
    }
  };
  const v1 = await check(first.image);
  if (!v1 || v1.pass) return { ok: true, image: first.image, calls, warnings };
  let best = { image: first.image, verdict: v1 };
  const left = deps.deadlineAt == null ? Infinity : deps.deadlineAt - now();
  if (left >= DESIGNER_PICTURE_LIMITS.rerenderMinMs && !deps.signal?.aborted) {
    const second = await deps.renderOnce(job, { attempt: 2, emphasizeText: true, signal: deps.signal });
    calls.push(...(second.calls ?? []));
    if (second.ok) {
      const v2 = await check(second.image);
      if (v2?.pass) return { ok: true, image: second.image, calls, warnings: [...warnings, ...(second.warnings ?? [])], rerendered: true };
      if (v2 && v2.score > best.verdict.score) best = { image: second.image, verdict: v2 };
    }
  }
  return { ok: true, image: best.image, calls, warnings: [...warnings, pictureTextWarning(job, best.verdict)], rerendered: best.image !== first.image };
}

/**
 * A short German reason a render failed (progress line, warning, the
 * submission check): the time limit, a cancel, the image service's content
 * policy, overload, the key, anything else.
 * @param {unknown} err
 * @param {AbortSignal | null} [signal]
 */
export function pictureFailureReason(err, signal = null) {
  const reason = /** @type {any} */ (signal?.aborted ? signal.reason : null);
  const e = /** @type {any} */ (err ?? {});
  const names = [reason?.name, e?.name, e?.cause?.name].filter(Boolean).join(" ");
  if (/TimeoutError|APIConnectionTimeoutError/.test(names)) return "nicht rechtzeitig fertig";
  if (/AbortError|APIUserAbortError/.test(names) || signal?.aborted) return "abgebrochen";
  const status = Number(e.status ?? e.statusCode);
  const text = `${typeof e.message === "string" ? e.message : ""} ${typeof e.code === "string" ? e.code : ""} ${typeof e?.error?.code === "string" ? e.error.code : ""}`;
  if (isPictureRefusal(err)) return "vom Bilddienst abgelehnt — das Motiv anders beschreiben";
  if (status === 429 || /rate limit|overloaded/i.test(text)) return "der Bilddienst ist gerade ausgelastet";
  if (status === 401 || status === 403) return "der OpenAI-Schlüssel wurde abgelehnt";
  return "Fehler beim Bilddienst";
}

/** Did the image service refuse the subject (moderation — no point in another model or size)? @param {unknown} err */
export function isPictureRefusal(err) {
  const e = /** @type {any} */ (err ?? {});
  const text = `${typeof e.message === "string" ? e.message : ""} ${typeof e.code === "string" ? e.code : ""} ${typeof e?.error?.code === "string" ? e.error.code : ""}`;
  return /moderation|safety|content[_ -]?policy/i.test(text);
}

// ── the studio: the pictures of one run ──────────────────────────────────────

/** @typedef {"on" | "off" | "unavailable"} PictureState */

/** What generate_image answers when pictures are switched off or not configured. @param {PictureState | null | undefined} state */
export function pictureUnavailableAnswer(state) {
  return state === "off"
    ? {
        ok: false,
        note: "Das Team hat das Erzeugen von Bildern ausgeschaltet (Einstellungen → KI-Gestalter) — gestalte ohne erzeugte Bilder: Anhänge, Bilder der Mail, Produktbilder, Farbflächen und Typografie. Fehlt ein Bild, sag es in notes.",
      }
    : {
        ok: false,
        note: "Bilder können hier nicht erzeugt werden (der Bilddienst ist nicht eingerichtet) — gestalte ohne erzeugte Bilder: Anhänge, Bilder der Mail, Produktbilder, Farbflächen und Typografie. Fehlt ein Bild, sag es in notes.",
      };
}

/** An error that marks the end of a render's time. */
function timeoutError() {
  const err = new Error("Zeitlimit des Bildes erreicht.");
  err.name = "TimeoutError";
  return err;
}

/** An error that marks a cancelled render. @param {string} message */
function abortError(message) {
  const err = new Error(message);
  err.name = "AbortError";
  return err;
}

/** A call whose usage is not known (a render cut off) — the run line's cost becomes unknown. @param {string} model */
function unknownCall(model) {
  return { model, usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }, usageComplete: false };
}

/**
 * The picture of one run as the submission check and the final swap see it.
 * @typedef {{
 *   n: number,
 *   label: string,
 *   purpose: PicturePurpose,
 *   aspect: PictureAspect,
 *   width: number,
 *   height: number,
 *   status: "pending" | "ready" | "failed",
 *   reason?: string,
 *   text?: string,
 *   realistic: boolean,
 *   transparent: boolean,
 *   warnings?: string[],
 * }} PictureInfo
 *   warnings: what the operator should know about a finished picture (its
 *   text could not be confirmed …).
 */

/**
 * The pictures of ONE run: generate_image's answer (request), the renders in
 * the background, what the check sees (pictures), the wait at the end
 * (settle) and the bill (calls). `render(job, { signal, deadlineAt })` makes
 * one picture (the I/O layer — renderPictureWithCheck around the OpenAI call)
 * and should never throw (a throw counts as a failed picture). Every render
 * is aborted `afterDeadlineMs` after `deadlineAt`, when `cancelSignal` fires
 * (the operator went away) or by abort(). `checkRefs` says which product refs
 * exist. Progress lines go to `onProgress` („Bild 1 von 2 fertig“).
 * @param {{
 *   state?: PictureState,
 *   limit?: number,
 *   render: (job: PictureJob, o: { signal: AbortSignal, deadlineAt: number | null }) => Promise<PictureOutcome>,
 *   checkRefs?: ((refs: string[]) => { unknown: string[] }) | null,
 *   deadlineAt?: number | null,
 *   now?: () => number,
 *   cancelSignal?: AbortSignal | null,
 *   onProgress?: (text: string) => void,
 *   onError?: (err: unknown) => void,
 *   primaryModel?: string,
 * }} opts
 */
export function createPictureStudio(opts) {
  const state = opts.state ?? "on";
  const limit = Math.max(0, Math.floor(opts.limit ?? DESIGNER_PICTURE_LIMITS.perRun));
  const now = opts.now ?? (() => Date.now());
  const deadlineAt = opts.deadlineAt ?? null;
  const jobDeadline = deadlineAt == null ? null : deadlineAt + DESIGNER_PICTURE_LIMITS.afterDeadlineMs;
  const primaryModel = opts.primaryModel ?? HERO_PRIMARY_IMAGE_MODEL;
  /**
   * @type {Array<{
   *   job: PictureJob,
   *   status: "pending" | "ready" | "failed",
   *   outcome: (PictureOutcome & { rerendered?: boolean }) | null,
   *   controller: AbortController,
   *   promise: Promise<unknown>,
   *   done: () => void,
   *   unused: boolean,
   * }>}
   */
  const entries = [];
  const say = (/** @type {string} */ text) => {
    try {
      opts.onProgress?.(text);
    } catch {
      /* a broken listener never breaks a picture */
    }
  };

  /** @param {(typeof entries)[number]} entry @param {PictureOutcome} outcome */
  const finish = (entry, outcome) => {
    if (entry.status !== "pending") return;
    entry.outcome = outcome;
    entry.status = outcome.ok ? "ready" : "failed";
    entry.done();
    if (entry.unused) return;
    const total = entries.length;
    const finished = entries.filter((e) => e.status !== "pending").length;
    if (outcome.ok) say(total === 1 ? "Bild fertig" : `Bild ${finished} von ${total} fertig`);
    else say(`Bild ${entry.job.n} („${entry.job.label}“) konnte nicht erzeugt werden — ${outcome.reason}`);
  };

  /** @param {PictureJob} job */
  const start = (job) => {
    const controller = new AbortController();
    /** @type {ReturnType<typeof setTimeout> | null} */
    let timer = null;
    const cancel = opts.cancelSignal ?? null;
    const onCancel = () => controller.abort(abortError("Abgebrochen."));
    if (jobDeadline != null) timer = setTimeout(() => controller.abort(timeoutError()), Math.max(0, jobDeadline - now()));
    if (cancel) {
      if (cancel.aborted) onCancel();
      else cancel.addEventListener("abort", onCancel, { once: true });
    }
    /** @type {(typeof entries)[number]} */
    const entry = {
      job,
      status: "pending",
      outcome: null,
      controller,
      promise: Promise.resolve(),
      done: () => {
        if (timer) clearTimeout(timer);
        timer = null;
        cancel?.removeEventListener("abort", onCancel);
      },
      unused: false,
    };
    entries.push(entry);
    entry.promise = Promise.resolve()
      // aborted before it began (the operator went away in the same tick): no render at all
      .then(() => (controller.signal.aborted ? Promise.reject(controller.signal.reason) : opts.render(job, { signal: controller.signal, deadlineAt: jobDeadline })))
      .then(
        (out) =>
          out && typeof out === "object" && typeof out.ok === "boolean"
            ? /** @type {PictureOutcome} */ (out)
            : { ok: false, reason: "Fehler beim Bilddienst", calls: [] },
        (err) => {
          // an abort (time, cancel, not used) is no error worth reporting
          if (!controller.signal.aborted) {
            try {
              opts.onError?.(err);
            } catch {
              /* ignore */
            }
          }
          return /** @type {PictureOutcome} */ ({ ok: false, reason: pictureFailureReason(err, controller.signal), calls: [] });
        }
      )
      .then((outcome) => finish(entry, outcome));
    return entry;
  };

  return {
    /** "on", "off" (the team's setting) or "unavailable" (not configured). */
    state,

    /**
     * generate_image: start a picture and answer at once with its placeholder
     * — or say why not (switched off, not configured, the input, the limit,
     * the time, unknown product refs; such a call does not count). `progress`:
     * the line for the panel when a picture started.
     * @param {unknown} raw
     * @returns {{ answer: Record<string, unknown>, progress?: string }}
     */
    request(raw) {
      if (state !== "on") return { answer: pictureUnavailableAnswer(state) };
      const parsed = parsePictureInput(raw);
      if (!parsed.ok) return { answer: { ok: false, problems: parsed.problems, hint: "Korrigieren und generate_image erneut aufrufen — dieser Aufruf hat kein Bild gestartet und zählt nicht." } };
      const active = entries.filter((e) => e.status !== "failed").length;
      if (active >= limit || entries.length >= Math.max(limit, DESIGNER_PICTURE_LIMITS.attemptsPerRun)) {
        return {
          answer: {
            ok: false,
            note: `Höchstens ${plural(limit, "Bild", "Bilder")} pro Auftrag — dieses Bild wurde nicht erzeugt. Nutze die schon erzeugten Bilder, Produktbilder, Farbflächen und Typografie.`,
          },
        };
      }
      if (deadlineAt != null && deadlineAt - now() < DESIGNER_PICTURE_LIMITS.startMinMs) {
        return { answer: { ok: false, note: "Für ein neues Bild reicht die Zeit nicht mehr (ein Bild braucht bis zu einer Minute) — gestalte ohne dieses Bild und nenne es in notes." } };
      }
      const req = parsed.value;
      if (req.productRefs.length && opts.checkRefs) {
        let unknown = [];
        try {
          unknown = opts.checkRefs(req.productRefs)?.unknown ?? [];
        } catch {
          unknown = [];
        }
        if (unknown.length) {
          return { answer: { ok: false, problems: [`productRefs: „${unknown.join("“, „")}“ gibt es im Katalog nicht — die refs GENAU aus search_products übernehmen (mit ®).`] } };
        }
      }
      const n = entries.length + 1;
      const a = PICTURE_ASPECTS[req.aspect];
      /** @type {PictureJob} */
      const job = { ...req, n, width: a.width, height: a.height, label: "" };
      job.label = pictureLabel(job);
      start(job);
      const url = picturePlaceholderUrl(n);
      const heightAt600 = Math.round((600 * a.height) / a.width);
      const use =
        req.purpose === "icon"
          ? `als src eines image-Bausteins mit width in px (z. B. 56 für ein Icon)`
          : `als src eines image-Bausteins (width "full" = ganze Breite) oder als bgImage eines Abschnitts (mit background-Farbe als Ersatz und Live-Text darüber)`;
      return {
        answer: {
          ok: true,
          picture: n,
          src: url,
          width: a.width,
          height: a.height,
          heightAt600,
          transparent: req.transparent,
          picturesLeft: Math.max(0, limit - active - 1),
          note: `Das Bild entsteht jetzt im Hintergrund (etwa 20–60 Sekunden), während du weitergestaltest. Setze ${url} ${use} ein — bei 600 px Breite ist es etwa ${heightAt600} px hoch.${req.text ? ` Der Text „${req.text}“ gehört auch in den alt-Text.` : ""} Mo setzt das fertige Bild ein, sobald dein Entwurf übernommen ist; klappt es nicht, entfernt Mo den Bild-Baustein bzw. das Hintergrundbild — die Mail muss auch ohne das Bild funktionieren.`,
        },
        progress: `Lässt ein Bild erzeugen: ${job.label} …`,
      };
    },

    /** The pictures of this run, for the submission check and the final swap. @returns {PictureInfo[]} */
    pictures() {
      return entries.map((e) => ({
        n: e.job.n,
        label: e.job.label,
        purpose: e.job.purpose,
        aspect: e.job.aspect,
        width: e.job.width,
        height: e.job.height,
        status: e.status,
        ...(e.outcome && !e.outcome.ok ? { reason: e.outcome.reason } : {}),
        ...(e.job.text ? { text: e.job.text } : {}),
        realistic: e.job.realistic,
        transparent: e.job.transparent,
        ...(e.outcome?.ok && e.outcome.warnings?.length ? { warnings: [...e.outcome.warnings] } : {}),
      }));
    },

    /**
     * Wait for the pictures `used` names (all when null) until `until` (epoch
     * ms; null = no limit); pending pictures that are not used are aborted
     * at once, the used ones that are still not done at `until`. Returns
     * every picture with its outcome; never throws.
     * @param {{ until?: number | null, used?: Iterable<number> | null }} [o]
     */
    async settle(o = {}) {
      const wanted = o.used ? new Set(o.used) : null;
      // A picture the design does not use is not waited for (its cost is then not known).
      for (const e of entries) {
        if (e.status !== "pending" || !wanted || wanted.has(e.job.n)) continue;
        e.unused = true;
        e.controller.abort(abortError("Nicht verwendet."));
        finish(e, { ok: false, reason: "nicht verwendet", calls: [unknownCall(primaryModel)] });
      }
      const waiting = entries.filter((e) => e.status === "pending" && (!wanted || wanted.has(e.job.n)));
      if (waiting.length) {
        say(waiting.length === 1 ? "Wartet auf das Bild …" : `Wartet auf ${waiting.length} Bilder …`);
        const all = Promise.all(waiting.map((e) => e.promise));
        const ms = o.until == null ? null : o.until - now();
        if (ms == null) await all;
        else {
          /** @type {ReturnType<typeof setTimeout> | null} */
          let t = null;
          await Promise.race([all, new Promise((resolve) => (t = setTimeout(resolve, Math.max(0, ms))))]);
          if (t) clearTimeout(t);
        }
      }
      // Whatever is still pending: aborted, given a moment to settle, then counted as failed.
      const late = entries.filter((e) => e.status === "pending");
      if (late.length) {
        for (const e of late) e.controller.abort(timeoutError());
        /** @type {ReturnType<typeof setTimeout> | null} */
        let t = null;
        await Promise.race([Promise.all(late.map((e) => e.promise)), new Promise((resolve) => (t = setTimeout(resolve, DESIGNER_PICTURE_LIMITS.abortGraceMs)))]);
        if (t) clearTimeout(t);
        for (const e of late) finish(e, { ok: false, reason: "nicht rechtzeitig fertig", calls: [unknownCall(primaryModel)] });
      }
      return entries.map((e) => ({ n: e.job.n, job: e.job, status: e.status, outcome: e.outcome }));
    },

    /** Abort every picture still rendering (the run failed or the operator went away). @param {string} [why] */
    abort(why = "Abgebrochen.") {
      for (const e of entries) if (e.status === "pending") e.controller.abort(abortError(why));
    },

    /**
     * The billed calls so far (renders and text checks) for the run line; a
     * render still running or cut off counts as a call whose cost is not known.
     * @returns {PictureCall[]}
     */
    calls() {
      return entries.flatMap((e) => (e.outcome ? e.outcome.calls ?? [] : [unknownCall(primaryModel)]));
    },

    /** How many pictures were made (renders that delivered a picture). */
    produced() {
      return entries.filter((e) => e.status === "ready").length;
    },

    /** The outcome of picture N (null while it renders or when there is none). @param {number} n */
    outcome(n) {
      return entries.find((e) => e.job.n === n)?.outcome ?? null;
    },
  };
}

/** @typedef {ReturnType<typeof createPictureStudio>} PictureStudio */
