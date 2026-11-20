// STUB — replaced by P1 Renderer (spec §7, gift-voucher-designs.mjs).
//
// The Geschenkgutschein designs („Motive“): the six keys of
// GIFT_VOUCHER_DESIGN_KEYS (gift-voucher-core.mjs) with names, descriptions
// and colours, so validation, the storefront config and the admin work while
// the renderer is being built. The SVG builders below only paint the
// background colour — the real decorative layers and panels come with P1.
// Pure (no I/O).

/**
 * @typedef {{
 *   background: string, ink: string, accent: string, muted: string,
 *   insideBackground: string, insideInk: string,
 * }} GiftVoucherDesignColors
 * @typedef {{
 *   key: string,
 *   name: { de: string, en: string },
 *   description: { de: string, en: string },
 *   photo: boolean,
 *   colors: GiftVoucherDesignColors,
 * }} GiftVoucherDesign
 */

/** @param {GiftVoucherDesign} d @returns {Readonly<GiftVoucherDesign>} */
function freezeDesign(d) {
  Object.freeze(d.name);
  Object.freeze(d.description);
  Object.freeze(d.colors);
  return Object.freeze(d);
}

/** @type {ReadonlyArray<Readonly<GiftVoucherDesign>>} */
export const GIFT_VOUCHER_DESIGNS = Object.freeze([
  freezeDesign({
    key: "classic",
    name: { de: "Klassisch", en: "Classic" },
    description: {
      de: "Dunkles Anthrazit mit feinem Rändel-Muster wie an einem Hantelgriff und silbrigem Wert.",
      en: "Deep charcoal with a fine knurl pattern like a barbell grip and a silver value.",
    },
    photo: false,
    colors: {
      background: "#15171a",
      ink: "#f3e7c6",
      accent: "#008ccb",
      muted: "#9aa3ab",
      insideBackground: "#fbfaf6",
      insideInk: "#1b1d20",
    },
  }),
  freezeDesign({
    key: "birthday",
    name: { de: "Geburtstag", en: "Birthday" },
    description: {
      de: "Hell und luftig mit Konfetti in Blautönen und einem warmen Akzent.",
      en: "Light and airy with confetti in shades of blue and one warm accent.",
    },
    photo: false,
    colors: {
      background: "#ffffff",
      ink: "#00577f",
      accent: "#f2a33a",
      muted: "#6b7f8c",
      insideBackground: "#ffffff",
      insideInk: "#1b1d20",
    },
  }),
  freezeDesign({
    key: "christmas",
    name: { de: "Weihnachten", en: "Christmas" },
    description: {
      de: "Tiefes Nachtblau mit feinen Sternen und warmem Gold.",
      en: "Deep navy with fine stars and warm gold.",
    },
    photo: false,
    colors: {
      background: "#0b2440",
      ink: "#ffffff",
      accent: "#d9b26f",
      muted: "#9fb3c8",
      insideBackground: "#fbfaf6",
      insideInk: "#0b2440",
    },
  }),
  freezeDesign({
    key: "thanks",
    name: { de: "Danke", en: "Thank you" },
    description: {
      de: "Zartes Hellblau mit fließenden Wellenlinien in Markenblau.",
      en: "Soft light blue with flowing wave lines in brand blue.",
    },
    photo: false,
    colors: {
      background: "#eaf6fc",
      ink: "#00577f",
      accent: "#008ccb",
      muted: "#5f7f93",
      insideBackground: "#ffffff",
      insideInk: "#1b1d20",
    },
  }),
  freezeDesign({
    key: "training",
    name: { de: "Training", en: "Training" },
    description: {
      de: "Kraftvoll: eine große Hantelscheibe in Blau und Schwarz.",
      en: "Bold: a large weight plate in blue and black.",
    },
    photo: false,
    colors: {
      background: "#0f1113",
      ink: "#ffffff",
      accent: "#008ccb",
      muted: "#8f99a3",
      insideBackground: "#ffffff",
      insideInk: "#0f1113",
    },
  }),
  freezeDesign({
    key: "photo",
    name: { de: "Eigenes Foto", en: "Your photo" },
    description: {
      de: "Dein Foto auf der ganzen Vorderseite, die Schrift gut lesbar darüber.",
      en: "Your photo across the whole front, with the lettering legible on top.",
    },
    photo: true,
    colors: {
      background: "#1b1d20",
      ink: "#ffffff",
      accent: "#008ccb",
      muted: "#c4cbd1",
      insideBackground: "#fbfaf6",
      insideInk: "#1b1d20",
    },
  }),
]);

/**
 * The design of a key, or null.
 * @param {unknown} key
 * @returns {Readonly<GiftVoucherDesign> | null}
 */
export function giftVoucherDesign(key) {
  return GIFT_VOUCHER_DESIGNS.find((d) => d.key === key) ?? null;
}

/** @param {unknown} n @param {number} fallback */
function size(n, fallback) {
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.round(n) : fallback;
}

/**
 * The decorative background layer of a design (no text) — STUB: a plain
 * rectangle in the design's background colour. Unknown keys use "classic".
 * @param {unknown} key
 * @param {{ width?: number, height?: number }} [box]
 * @returns {string}
 */
export function giftVoucherBackgroundSvg(key, { width = 210, height = 148 } = {}) {
  const d = giftVoucherDesign(key) ?? GIFT_VOUCHER_DESIGNS[0];
  const w = size(width, 210);
  const h = size(height, 148);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="${d.colors.background}"/></svg>`;
}

/**
 * A full panel as SVG — STUB: the background (or the inside background)
 * colour only, no text, no photo, no QR code.
 * @param {{
 *   panel: "front" | "inside" | "inside-message" | "inside-info" | "back",
 *   layout: "landscape" | "square",
 *   widthPx: number, heightPx: number, bleedPx?: number,
 *   design: Readonly<GiftVoucherDesign> | null, data?: unknown, fonts?: unknown,
 *   photoDataUri?: string | null, qrMatrix?: unknown,
 * }} input
 * @returns {string}
 */
export function buildGiftVoucherPanelSvg({ panel, widthPx, heightPx, design }) {
  const d = design ?? GIFT_VOUCHER_DESIGNS[0];
  const w = size(widthPx, 1000);
  const h = size(heightPx, 705);
  const fill = panel === "front" || panel === "back" ? d.colors.background : d.colors.insideBackground;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="${fill}"/></svg>`;
}
