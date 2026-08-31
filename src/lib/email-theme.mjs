// Email design themes ("Vorlagen") — the pure vocabulary + validation core for
// the operator-managed email templates (migration 0048, admin "Einstellungen"
// tab). A theme parameterises the SHARED branded shell (email-template.ts):
// accent color, the signature separator-band colors, the outer background, the
// font stack, the CTA button shape, an optional logo override and the
// social-icon row. Content (AI prose, legal copy, product data) is untouched.
//
// Shared by the shell renderer (defaults + token lookup), the store/API routes
// (validation) and the admin UI (labels/hints), so the vocabulary can never
// drift apart between the layers — same pattern as email-text-mode.mjs.
//
// Plain .mjs with JSDoc types so it is unit-testable under node --test AND
// importable from both server TS and client components (the settings form).

/** @typedef {"summary" | "doi" | "marketing" | "campaign"} EmailThemeKind */
/** @typedef {"montserrat" | "verdana" | "arial" | "helvetica" | "georgia" | "trebuchet"} EmailFontKey */
/** @typedef {"pill" | "rounded" | "square"} EmailButtonShape */

/**
 * @typedef {Object} EmailThemeTokens
 * @property {string} accentColor      CTA buttons, prose links, savings line ('#rrggbb').
 * @property {string} bandBackground   The signature full-width separator bands ('#rrggbb').
 * @property {string} bandTextColor    Text on the separator bands ('#rrggbb').
 * @property {string} outerBackground  Page background around the white card ('#rrggbb').
 * @property {EmailFontKey} fontFamily Font stack key (EMAIL_FONT_CHOICES).
 * @property {EmailButtonShape} buttonShape CTA button corner shape.
 * @property {string | null} logoUrl   Absolute https logo override, or null → env/default.
 * @property {boolean} showSocial      Social-icons row in the footer.
 */

// ── Email kinds a template can be assigned to ────────────────────────────────
// 'correspondence' (operator plain-text mail) and the internal contact-form
// notification never render the branded shell, so they are not themeable.

export const EMAIL_THEME_KINDS = /** @type {EmailThemeKind[]} */ ([
  "summary",
  "doi",
  "marketing",
  "campaign",
]);

/** German UI labels (the admin panel is German). */
export const EMAIL_THEME_KIND_LABELS = /** @type {Record<EmailThemeKind, string>} */ ({
  summary: "Zusammenfassung",
  doi: "Anmelde-Bestätigung (DOI)",
  marketing: "Marketing (Kunden)",
  campaign: "Kampagne (Shopify-Abonnenten)",
});

/** One-line UI hint per kind. */
export const EMAIL_THEME_KIND_HINTS = /** @type {Record<EmailThemeKind, string>} */ ({
  summary: "Transaktionale Beratungs-Zusammenfassung mit Warenkorb-Link.",
  doi: "Double-Opt-in-Bestätigung — der rechtlich geprüfte Text bleibt unverändert.",
  marketing: "Persönliche KI-E-Mails an Chat-Kunden (Rabatt, Warenkorb, Set-Angebot).",
  campaign: "Persönliche KI-E-Mails an Shopify-Marketing-Abonnent:innen (de/en).",
});

// ── Font stacks ──────────────────────────────────────────────────────────────
// Email-client-safe stacks only. Montserrat is the one web font (loaded via the
// shell's <head> link; clients that block web fonts fall back to Verdana) —
// every other choice is a system font that renders identically everywhere.

export const EMAIL_FONT_CHOICES =
  /** @type {Record<EmailFontKey, { label: string; stack: string; webFont: boolean }>} */ ({
    montserrat: {
      label: "Montserrat (Markenschrift)",
      stack: "'Montserrat', Verdana, Geneva, sans-serif",
      webFont: true,
    },
    verdana: { label: "Verdana", stack: "Verdana, Geneva, sans-serif", webFont: false },
    arial: { label: "Arial", stack: "Arial, Helvetica, sans-serif", webFont: false },
    helvetica: {
      label: "Helvetica",
      stack: "'Helvetica Neue', Helvetica, Arial, sans-serif",
      webFont: false,
    },
    georgia: {
      label: "Georgia (Serifenschrift)",
      stack: "Georgia, 'Times New Roman', serif",
      webFont: false,
    },
    trebuchet: {
      label: "Trebuchet MS",
      stack: "'Trebuchet MS', Tahoma, sans-serif",
      webFont: false,
    },
  });

export const EMAIL_FONT_KEYS = /** @type {EmailFontKey[]} */ (
  Object.keys(EMAIL_FONT_CHOICES)
);

/**
 * The inline font stack for a font key (unknown keys → default stack).
 * @param {string} key
 * @returns {string}
 */
export function fontStackFor(key) {
  const choice = EMAIL_FONT_CHOICES[/** @type {EmailFontKey} */ (key)];
  return (choice ?? EMAIL_FONT_CHOICES.montserrat).stack;
}

/**
 * Whether the shell must emit the Montserrat web-font <link> for this key.
 * @param {string} key
 * @returns {boolean}
 */
export function fontNeedsWebFont(key) {
  const choice = EMAIL_FONT_CHOICES[/** @type {EmailFontKey} */ (key)];
  return (choice ?? EMAIL_FONT_CHOICES.montserrat).webFont;
}

// ── Button shapes ────────────────────────────────────────────────────────────

export const EMAIL_BUTTON_SHAPES = /** @type {EmailButtonShape[]} */ ([
  "pill",
  "rounded",
  "square",
]);

export const EMAIL_BUTTON_SHAPE_LABELS =
  /** @type {Record<EmailButtonShape, string>} */ ({
    pill: "Pille (rund)",
    rounded: "Abgerundet",
    square: "Eckig",
  });

const BUTTON_SHAPE_RADIUS = /** @type {Record<EmailButtonShape, string>} */ ({
  pill: "200px",
  rounded: "8px",
  square: "0",
});

/**
 * The border-radius for a button shape (unknown shapes → pill, today's look).
 * @param {string} shape
 * @returns {string}
 */
export function buttonRadiusFor(shape) {
  return BUTTON_SHAPE_RADIUS[/** @type {EmailButtonShape} */ (shape)] ?? BUTTON_SHAPE_RADIUS.pill;
}

// ── Defaults ─────────────────────────────────────────────────────────────────
// EXACTLY today's hard-coded design (email-template.ts before themes existed):
// an unassigned email type must keep rendering byte-for-byte the same chrome.

export const DEFAULT_EMAIL_THEME = /** @type {EmailThemeTokens} */ ({
  accentColor: "#008ccb",
  bandBackground: "#000000",
  bandTextColor: "#ffffff",
  outerBackground: "#fafafa",
  fontFamily: "montserrat",
  buttonShape: "pill",
  logoUrl: null,
  showSocial: true,
});

// ── Limits ───────────────────────────────────────────────────────────────────

export const MAX_TEMPLATE_NAME_CHARS = 80;
export const MAX_TEMPLATE_DESCRIPTION_CHARS = 200;
export const MAX_TEMPLATE_LOGO_URL_CHARS = 500;
export const MAX_EMAIL_TEMPLATES = 20;

// ── Parsing (untrusted input → vocabulary value or null) ─────────────────────

/**
 * Parse an untrusted value into a themeable email kind.
 * @param {unknown} value
 * @returns {EmailThemeKind | null}
 */
export function parseEmailThemeKind(value) {
  return typeof value === "string" &&
    EMAIL_THEME_KINDS.includes(/** @type {EmailThemeKind} */ (value))
    ? /** @type {EmailThemeKind} */ (value)
    : null;
}

/**
 * Parse an untrusted value into a normalized '#rrggbb' hex color ('#rgb' is
 * expanded, case is lowered). Anything else — including named colors, rgb(),
 * or url(...) smuggling — returns null: the value is interpolated into inline
 * CSS and must stay a pure hex literal.
 * @param {unknown} value
 * @returns {string | null}
 */
export function parseHexColor(value) {
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(v)) return v;
  const short = v.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
  return null;
}

/**
 * Parse an untrusted value into a font key.
 * @param {unknown} value
 * @returns {EmailFontKey | null}
 */
export function parseEmailFontKey(value) {
  return typeof value === "string" &&
    EMAIL_FONT_KEYS.includes(/** @type {EmailFontKey} */ (value))
    ? /** @type {EmailFontKey} */ (value)
    : null;
}

/**
 * Parse an untrusted value into a button shape.
 * @param {unknown} value
 * @returns {EmailButtonShape | null}
 */
export function parseEmailButtonShape(value) {
  return typeof value === "string" &&
    EMAIL_BUTTON_SHAPES.includes(/** @type {EmailButtonShape} */ (value))
    ? /** @type {EmailButtonShape} */ (value)
    : null;
}

/**
 * Parse an untrusted logo URL. Empty/absent → { ok: true, value: null } (use
 * the env/default logo). Otherwise the value must be an absolute https URL
 * (mail clients won't load http/relative images) within the length limit.
 * @param {unknown} value
 * @returns {{ ok: boolean; value: string | null }}
 */
export function parseLogoUrl(value) {
  if (value == null) return { ok: true, value: null };
  if (typeof value !== "string") return { ok: false, value: null };
  const v = value.trim();
  if (!v) return { ok: true, value: null };
  if (v.length > MAX_TEMPLATE_LOGO_URL_CHARS) return { ok: false, value: null };
  let parsed;
  try {
    parsed = new URL(v);
  } catch {
    return { ok: false, value: null };
  }
  if (parsed.protocol !== "https:") return { ok: false, value: null };
  return { ok: true, value: v };
}

/**
 * Validate a full theme-token object from an untrusted source (API body).
 * Missing fields fall back to the default; PRESENT-but-invalid fields fail so
 * a typo never silently ships the default. `errors` names the bad fields
 * (empty array = valid).
 * @param {unknown} raw
 * @returns {{ theme: EmailThemeTokens; errors: string[] }}
 */
export function parseEmailThemeInput(raw) {
  const src = raw && typeof raw === "object" ? /** @type {Record<string, unknown>} */ (raw) : {};
  const errors = [];

  /** @type {(field: string, parse: (v: unknown) => string | null, fallback: string) => string} */
  const color = (field, parse, fallback) => {
    if (src[field] == null || src[field] === "") return fallback;
    const parsed = parse(src[field]);
    if (parsed == null) {
      errors.push(field);
      return fallback;
    }
    return parsed;
  };

  const accentColor = color("accentColor", parseHexColor, DEFAULT_EMAIL_THEME.accentColor);
  const bandBackground = color(
    "bandBackground",
    parseHexColor,
    DEFAULT_EMAIL_THEME.bandBackground
  );
  const bandTextColor = color(
    "bandTextColor",
    parseHexColor,
    DEFAULT_EMAIL_THEME.bandTextColor
  );
  const outerBackground = color(
    "outerBackground",
    parseHexColor,
    DEFAULT_EMAIL_THEME.outerBackground
  );

  let fontFamily = DEFAULT_EMAIL_THEME.fontFamily;
  if (src.fontFamily != null && src.fontFamily !== "") {
    const parsed = parseEmailFontKey(src.fontFamily);
    if (parsed == null) errors.push("fontFamily");
    else fontFamily = parsed;
  }

  let buttonShape = DEFAULT_EMAIL_THEME.buttonShape;
  if (src.buttonShape != null && src.buttonShape !== "") {
    const parsed = parseEmailButtonShape(src.buttonShape);
    if (parsed == null) errors.push("buttonShape");
    else buttonShape = parsed;
  }

  const logo = parseLogoUrl(src.logoUrl);
  if (!logo.ok) errors.push("logoUrl");

  let showSocial = DEFAULT_EMAIL_THEME.showSocial;
  if (src.showSocial != null) {
    if (typeof src.showSocial !== "boolean") errors.push("showSocial");
    else showSocial = src.showSocial;
  }

  return {
    theme: {
      accentColor,
      bandBackground,
      bandTextColor,
      outerBackground,
      fontFamily,
      buttonShape,
      logoUrl: logo.ok ? logo.value : null,
      showSocial,
    },
    errors,
  };
}

/**
 * Normalize a template name. Returns the trimmed name, or null when empty /
 * over the limit (callers map that to a 400).
 * @param {unknown} value
 * @returns {string | null}
 */
export function normalizeTemplateName(value) {
  if (typeof value !== "string") return null;
  const t = value.replace(/\s+/g, " ").trim();
  if (!t || t.length > MAX_TEMPLATE_NAME_CHARS) return null;
  return t;
}

/**
 * Normalize an optional template description: trimmed string, or null when
 * empty/absent. Over-limit → undefined (invalid, callers map to 400).
 * @param {unknown} value
 * @returns {string | null | undefined}
 */
export function normalizeTemplateDescription(value) {
  if (value == null) return null;
  if (typeof value !== "string") return undefined;
  const t = value.replace(/\s+/g, " ").trim();
  if (!t) return null;
  if (t.length > MAX_TEMPLATE_DESCRIPTION_CHARS) return undefined;
  return t;
}
