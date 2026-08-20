// Text modes for the AI-generated marketing/campaign emails (pure, no I/O).
//
// The rendered email carries the message visually — the product rows below the
// prose show image, name, price and a personalised per-product description. The
// TEXT MODE controls how much prose sits above them:
//
//   detailed — the classic long-form email (3–5 short paragraphs) that weaves
//              the customer knowledge into the prose. What every draft was
//              before the mode existed, so legacy rows (text_mode NULL) render
//              and regenerate as "detailed".
//   compact  — a short greeting + 2–3 sentences; the product tiles carry the
//              message. The DEFAULT for newly generated drafts.
//   minimal  — greeting + ONE lead-in sentence; the email is essentially a
//              visual lookbook with a personal opener.
//
// Shared by the prompt builders (marketing-draft.ts / campaign-draft.ts), the
// API routes (validation) and the admin UI (labels), so the mode vocabulary can
// never drift apart between the layers.

/** @typedef {"detailed" | "compact" | "minimal"} EmailTextMode */

export const EMAIL_TEXT_MODES = /** @type {EmailTextMode[]} */ ([
  "detailed",
  "compact",
  "minimal",
]);

/** Default for NEWLY generated drafts (modern, image-first). */
export const DEFAULT_EMAIL_TEXT_MODE = /** @type {EmailTextMode} */ ("compact");

/** What a stored draft without a mode (text_mode NULL, pre-migration-0047) was
 * generated as — the long-form prose that was the only behaviour back then. */
export const LEGACY_EMAIL_TEXT_MODE = /** @type {EmailTextMode} */ ("detailed");

/** German UI labels (the admin panel is German). */
export const EMAIL_TEXT_MODE_LABELS = /** @type {Record<EmailTextMode, string>} */ ({
  detailed: "Ausführlich",
  compact: "Kompakt",
  minimal: "Minimal",
});

/** One-line UI hint per mode. */
export const EMAIL_TEXT_MODE_HINTS = /** @type {Record<EmailTextMode, string>} */ ({
  detailed: "Mehr Text: 3–5 kurze Absätze, die das Kundenwissen einweben.",
  compact: "Kurze Begrüßung + 2–3 Sätze — die Produktbilder tragen die Botschaft.",
  minimal: "Nur Anrede + ein Satz — die E-Mail wirkt wie ein visuelles Lookbook.",
});

/**
 * Parse an untrusted value into a mode. Returns the mode, or null when the
 * value is not a known mode (callers decide between 400 and a default).
 *
 * @param {unknown} value
 * @returns {EmailTextMode | null}
 */
export function parseEmailTextMode(value) {
  return typeof value === "string" && EMAIL_TEXT_MODES.includes(/** @type {EmailTextMode} */ (value))
    ? /** @type {EmailTextMode} */ (value)
    : null;
}

/**
 * The mode a STORED draft was generated with: its persisted mode, or the
 * legacy long-form mode for rows that predate the column.
 *
 * @param {{ textMode?: EmailTextMode | null } | null | undefined} draft
 * @returns {EmailTextMode}
 */
export function storedTextMode(draft) {
  return (draft && draft.textMode) || LEGACY_EMAIL_TEXT_MODE;
}

/**
 * The prompt rule describing how long/short the email BODY prose must be.
 * German for the marketing drafts; the campaign drafts pass the target
 * language so an English email gets the rule in English (better compliance).
 *
 * The compact/minimal caps deliberately EXCLUDE the discount/bundle mentions:
 * both are mandated by their own prompt sections (discountHint/bundleHint) and
 * must never be squeezed out by the length budget.
 *
 * @param {EmailTextMode} mode
 * @param {"de" | "en"} [language]
 * @returns {string}
 */
export function textModeBodyRule(mode, language = "de") {
  const en = language === "en";
  if (mode === "minimal") {
    return en
      ? "TEXT MODE: MINIMAL. Write only the bare minimum of prose: a personal " +
          "greeting and ONE single short lead-in sentence pointing to the " +
          "products shown below (e.g. \"I picked out a few things that fit " +
          "your training perfectly\"). At most ~25 words before the sign-off. " +
          "Do NOT name individual products in the prose — the pictures below " +
          "speak for themselves. Exception: a given discount offer or attached " +
          "set offer may each add ONE extra short sentence."
      : "TEXTMODUS: MINIMAL. Schreibe nur das absolute Minimum an Fließtext: " +
          "eine persönliche Anrede und EINEN einzigen kurzen Satz, der auf die " +
          "darunter gezeigten Produkte hinführt (z. B. „ich habe dir ein paar " +
          "Dinge herausgesucht, die perfekt zu deinem Training passen“). " +
          "Höchstens ~25 Wörter vor der Grußformel. Nenne KEINE einzelnen " +
          "Produktnamen im Fließtext — die Bilder darunter sprechen für sich. " +
          "Ausnahme: Ein vorgegebenes Rabattangebot oder Set-Angebot darf " +
          "zusätzlich je EINEN kurzen Satz bekommen.";
  }
  if (mode === "compact") {
    return en
      ? "TEXT MODE: COMPACT. Keep the prose deliberately short and modern: a " +
          "personal greeting plus at most 2–3 short sentences (roughly 60 " +
          "words) that make the reader curious about the products shown below. " +
          "No paragraph per product, no listing of product names — the product " +
          "tiles below carry the message. Exception: a given discount offer or " +
          "attached set offer may each add ONE extra short sentence."
      : "TEXTMODUS: KOMPAKT. Halte den Fließtext bewusst kurz und modern: eine " +
          "persönliche Anrede plus höchstens 2–3 kurze Sätze (etwa 60 Wörter), " +
          "die neugierig auf die darunter gezeigten Produkte machen. Kein " +
          "Absatz pro Produkt, keine Aufzählung von Produktnamen — die " +
          "Produktkacheln darunter tragen die Botschaft. Ausnahme: Ein " +
          "vorgegebenes Rabattangebot oder Set-Angebot darf zusätzlich je " +
          "EINEN kurzen Satz bekommen.";
  }
  return en
    ? "TEXT MODE: DETAILED. Write a fuller personal email: 3–5 short " +
        "paragraphs that concretely weave in what you know about this person. " +
        "Mention the recommended products briefly and naturally in the prose — " +
        "still no catalog block and no bullet list per product."
    : "TEXTMODUS: AUSFÜHRLICH. Schreibe eine ausführlichere persönliche " +
        "E-Mail: 3–5 kurze Absätze, die das Wissen über diese Person konkret " +
        "einweben. Erwähne die empfohlenen Produkte knapp und natürlich im " +
        "Fließtext — trotzdem kein Katalogblock und keine Aufzählung pro " +
        "Produkt.";
}

/**
 * The length phrase for the per-product highlight descriptions (the
 * personalised text next to each product image/title/price). Used inside the
 * zod schema description, so it is written as a spec, not as an imperative.
 *
 * @param {EmailTextMode} mode
 * @returns {string}
 */
export function textModeHighlightRule(mode) {
  if (mode === "minimal") {
    return "Ein sehr kurzes, prägnantes Fragment oder ein Mini-Satz (max. ~8 Wörter), wie eine Bildunterschrift";
  }
  if (mode === "compact") {
    return "GENAU EIN kurzer, prägnanter Satz";
  }
  return "1–3 kurze Sätze";
}
