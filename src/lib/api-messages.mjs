// User-facing API message catalog (pure .mjs, unit-tested). The error CODE in
// the JSON envelope stays stable + machine-readable; only the human `message`
// localises. The German values are byte-identical to the strings that shipped
// before i18n (the de path is unchanged); English is the /en variant.
//
// NOTE: purely technical / developer-facing strings that were ALREADY English
// for both locales (e.g. "Invalid JSON body" in the chat route, "Unexpected
// server error", "Too many requests", product-id parameter errors, the TTS
// boundary messages) are intentionally NOT in this catalog — they stay as-is in
// both locales, which keeps German byte-identical and is already English on /en.

/**
 * @param {string} id
 * @param {"de" | "en"} locale
 * @returns {string}
 */
export function apiMessage(id, locale) {
  const entry = MESSAGES[id];
  if (!entry) return id; // fail visibly rather than throw inside a route
  return locale === "en" ? entry.en : entry.de;
}

const MESSAGES = {
  invalid_json: {
    de: "Ungültiger JSON-Body",
    en: "Invalid JSON body",
  },
  invalid_email: {
    de: "Ungültige E-Mail-Adresse",
    en: "Invalid email address",
  },
  transactional_consent_required: {
    de: "Bitte bestätige die erste Checkbox — ohne deine Einwilligung können wir dir die Zusammenfassung nicht per E-Mail schicken.",
    en: "Please tick the first checkbox — without your consent we can't email you the summary.",
  },
  consent_save_failed: {
    de: "Einwilligung konnte nicht gespeichert werden — bitte später erneut versuchen.",
    en: "Your consent could not be saved — please try again later.",
  },
  summary_delivery_failed: {
    de: "Die Zusammenfassung konnte nicht zugestellt werden.",
    en: "The summary could not be delivered.",
  },
  contact_required_fields: {
    de: "Pflichtfelder fehlen oder ungültig (name, email, message, reason)",
    en: "Required fields are missing or invalid (name, email, message, reason)",
  },
  email_delivery_failed: {
    de: "E-Mail konnte nicht zugestellt werden",
    en: "The email could not be delivered",
  },
  feedback_save_failed: {
    de: "Feedback konnte nicht gespeichert werden — bitte später erneut versuchen.",
    en: "Your feedback could not be saved — please try again later.",
  },
  conversation_key_missing: {
    de: "conversationKey fehlt",
    en: "conversationKey is missing",
  },
  conversation_not_found: {
    de: "Konversation nicht gefunden",
    en: "Conversation not found",
  },
  invalid_conversation_id: {
    de: "Ungültige Konversations-ID",
    en: "Invalid conversation id",
  },
  title_empty: {
    de: "Titel darf nicht leer sein",
    en: "The title must not be empty",
  },
  export_failed: {
    de: "Export konnte nicht erstellt werden — bitte später erneut versuchen.",
    en: "The export could not be created — please try again later.",
  },
  erase_failed: {
    de: "Löschung konnte nicht durchgeführt werden — bitte später erneut versuchen.",
    en: "The deletion could not be carried out — please try again later.",
  },
  marketing_consent_required: {
    de: "Bitte bestätige die Einwilligung aktiv (das Häkchen ist standardmäßig nicht gesetzt).",
    en: "Please actively confirm consent (the box is unchecked by default).",
  },
  customer_not_found: {
    de: "Kunde nicht gefunden",
    en: "Customer not found",
  },
  no_verified_email: {
    de: "Für dieses Konto liegt keine verifizierte E-Mail-Adresse vor.",
    en: "There is no verified email address on file for this account.",
  },
  // Expired bundle-offer redirect page (GET /api/r/[token]).
  offer_expired_title: {
    de: "Angebot abgelaufen — Motion Sports",
    en: "Offer expired — Motion Sports",
  },
  offer_expired_heading: {
    de: "Dieses Angebot ist leider abgelaufen",
    en: "Unfortunately this offer has expired",
  },
  offer_expired_body: {
    de: "Dein persönliches Set ist nicht mehr verfügbar. Stöbere gerne in unserem Shop — vielleicht ist etwas Passendes für dich dabei.",
    en: "Your personal set is no longer available. Feel free to browse our shop — you might find something that suits you.",
  },
  offer_expired_cta: {
    de: "Zum Shop",
    en: "To the shop",
  },
};
