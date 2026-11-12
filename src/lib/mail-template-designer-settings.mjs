// KI-Gestalter settings — which model designs, how long it thinks, how freely
// it changes a mail, whether it adds Mo's capabilities by itself, and the
// team's house style. Pure and tested (mail-template-designer-settings.test.mjs).
//
// Stored as ONE row of admin_settings (key DESIGNER_SETTINGS_KEY, migration
// 0078 — no new migration), edited in Einstellungen → „KI-Gestalter“ and read
// by mail-template-assist.ts on every run. The KI-Gestalter panel may override
// model, effort, freedom and the capabilities switch for one conversation
// (parseDesignerRunOverride); the house style always comes from the stored
// settings. Every value is parsed leniently at read time — an unknown or
// broken value falls back to the default — so a stored row never breaks a run.

import { AI_EFFORTS, FABLE_MODEL, OPUS_MODEL, SONNET_MODEL } from "./ai-models.mjs";

/** The admin_settings key. */
export const DESIGNER_SETTINGS_KEY = "mail_designer";

/** Characters of the house style (the system prompt carries it on every run). */
export const HOUSE_STYLE_MAX_CHARS = 2000;

/**
 * The models the operator may choose — a closed list (ids from ai-models.mjs,
 * priced in ai-pricing.mjs). Strongest first.
 */
export const DESIGNER_MODELS = Object.freeze([
  Object.freeze({
    id: FABLE_MODEL,
    label: "Claude Fable 5.2",
    note: "Anthropics stärkstes Modell — am besten für Nachbauten nach Screenshots und aufwendige Mails. Langsamer, etwa die doppelten Kosten von Opus.",
  }),
  Object.freeze({
    id: OPUS_MODEL,
    label: "Claude Opus 5.5",
    note: "Sehr gute Qualität bei mittlerem Tempo — der Standard.",
  }),
  Object.freeze({
    id: SONNET_MODEL,
    label: "Claude Sonnet 5.5",
    note: "Schneller und etwa halb so teuer — gut für kleine Änderungen an Texten, Farben und Abständen.",
  }),
]);

/** Effort („Denktiefe“) — how much the model thinks before and between its steps. */
export const DESIGNER_EFFORTS = Object.freeze([
  Object.freeze({ id: "low", label: "Niedrig" }),
  Object.freeze({ id: "medium", label: "Mittel" }),
  Object.freeze({ id: "high", label: "Hoch" }),
  Object.freeze({ id: "xhigh", label: "Sehr hoch" }),
  Object.freeze({ id: "max", label: "Maximal" }),
]);

/** The three quality levels: a model and an effort each. */
export const DESIGNER_QUALITY = Object.freeze([
  Object.freeze({ id: "schnell", label: "Schnell", model: SONNET_MODEL, effort: "medium" }),
  Object.freeze({ id: "gruendlich", label: "Gründlich", model: OPUS_MODEL, effort: "high" }),
  Object.freeze({ id: "maximal", label: "Maximal", model: FABLE_MODEL, effort: "high" }),
]);

/** How freely the designer may change the mail beyond the instruction. */
export const DESIGNER_FREEDOM = Object.freeze([
  Object.freeze({ id: "genau", label: "Genau nach Auftrag" }),
  Object.freeze({ id: "ausgewogen", label: "Ausgewogen" }),
  Object.freeze({ id: "frei", label: "Frei gestalten" }),
]);

/**
 * The defaults — what the KI-Gestalter did before it had settings: Opus 5.5
 * at effort high (tier `designer`), balanced freedom, capabilities on.
 */
export const DEFAULT_DESIGNER_SETTINGS = Object.freeze({
  model: OPUS_MODEL,
  effort: "high",
  freedom: "ausgewogen",
  proactive: true,
  houseStyle: "",
});

/** @typedef {"low" | "medium" | "high" | "xhigh" | "max"} DesignerEffort */
/** @typedef {"genau" | "ausgewogen" | "frei"} DesignerFreedom */
/**
 * @typedef {{
 *   model: string,
 *   effort: DesignerEffort,
 *   freedom: DesignerFreedom,
 *   proactive: boolean,
 *   houseStyle: string,
 * }} DesignerSettings
 */
/** @typedef {Partial<Pick<DesignerSettings, "model" | "effort" | "freedom" | "proactive">>} DesignerRunOverride */

const MODEL_IDS = DESIGNER_MODELS.map((m) => m.id);
const FREEDOM_IDS = DESIGNER_FREEDOM.map((f) => f.id);

/** @param {unknown} v */
const isModel = (v) => typeof v === "string" && MODEL_IDS.includes(v);
/** @param {unknown} v */
const isEffort = (v) => typeof v === "string" && AI_EFFORTS.includes(v);
/** @param {unknown} v */
const isFreedom = (v) => typeof v === "string" && FREEDOM_IDS.includes(v);

/**
 * The house style as stored and sent: control characters out (newlines and
 * tabs stay), trailing spaces per line and runs of blank lines collapsed,
 * trimmed. Does NOT cut — the caller decides between refusing (save) and
 * clipping (read).
 * @param {unknown} v
 */
export function cleanHouseStyle(v) {
  if (typeof v !== "string") return "";
  return v
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u2028\u2029]/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Cut at `max` characters without leaving half a surrogate pair. @param {string} s @param {number} max */
function clipChars(s, max) {
  if (s.length <= max) return s;
  let cut = s.slice(0, max);
  if (/[\ud800-\udbff]$/.test(cut)) cut = cut.slice(0, -1);
  return cut.trimEnd();
}

/**
 * Stored value (JSONB object or its JSON text) → settings. Lenient: every
 * field that is missing or not valid falls back to its default, the house
 * style is cleaned and clipped. Never throws.
 * @param {unknown} raw
 * @returns {DesignerSettings}
 */
export function parseDesignerSettings(raw) {
  let v = raw;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      v = null;
    }
  }
  const r = v && typeof v === "object" && !Array.isArray(v) ? /** @type {Record<string, unknown>} */ (v) : {};
  return {
    model: isModel(r.model) ? /** @type {string} */ (r.model) : DEFAULT_DESIGNER_SETTINGS.model,
    effort: isEffort(r.effort) ? /** @type {DesignerEffort} */ (r.effort) : /** @type {DesignerEffort} */ (DEFAULT_DESIGNER_SETTINGS.effort),
    freedom: isFreedom(r.freedom) ? /** @type {DesignerFreedom} */ (r.freedom) : /** @type {DesignerFreedom} */ (DEFAULT_DESIGNER_SETTINGS.freedom),
    proactive: typeof r.proactive === "boolean" ? r.proactive : DEFAULT_DESIGNER_SETTINGS.proactive,
    houseStyle: clipChars(cleanHouseStyle(r.houseStyle), HOUSE_STYLE_MAX_CHARS),
  };
}

/**
 * The body of a save (Einstellungen → „KI-Gestalter“ → „Speichern“): every
 * field required and checked; German messages per field.
 * @param {unknown} raw
 * @returns {{ ok: true, value: DesignerSettings } | { ok: false, errors: Record<string, string> }}
 */
export function validateDesignerSettingsInput(raw) {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? /** @type {Record<string, unknown>} */ (raw) : {};
  /** @type {Record<string, string>} */
  const errors = {};
  if (!isModel(r.model)) errors.model = "Bitte ein Modell aus der Liste wählen.";
  if (!isEffort(r.effort)) errors.effort = "Bitte eine Denktiefe aus der Liste wählen.";
  if (!isFreedom(r.freedom)) errors.freedom = "Bitte eine Gestaltungsfreiheit wählen.";
  if (typeof r.proactive !== "boolean") errors.proactive = "„Mo-Funktionen von sich aus einbauen“ fehlt.";
  if (r.houseStyle != null && typeof r.houseStyle !== "string") errors.houseStyle = "Der Hausstil muss Text sein.";
  const houseStyle = cleanHouseStyle(r.houseStyle);
  if (houseStyle.length > HOUSE_STYLE_MAX_CHARS) {
    errors.houseStyle = `Der Hausstil ist zu lang (${houseStyle.length} von höchstens ${HOUSE_STYLE_MAX_CHARS} Zeichen).`;
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      model: /** @type {string} */ (r.model),
      effort: /** @type {DesignerEffort} */ (r.effort),
      freedom: /** @type {DesignerFreedom} */ (r.freedom),
      proactive: /** @type {boolean} */ (r.proactive),
      houseStyle,
    },
  };
}

/**
 * The panel's choice for one conversation (the assist request's `settings`):
 * only valid fields are kept, anything else is dropped — the stored settings
 * fill the rest. The house style is never taken from a request.
 * @param {unknown} raw
 * @returns {DesignerRunOverride}
 */
export function parseDesignerRunOverride(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const r = /** @type {Record<string, unknown>} */ (raw);
  /** @type {DesignerRunOverride} */
  const out = {};
  if (isModel(r.model)) out.model = /** @type {string} */ (r.model);
  if (isEffort(r.effort)) out.effort = /** @type {DesignerEffort} */ (r.effort);
  if (isFreedom(r.freedom)) out.freedom = /** @type {DesignerFreedom} */ (r.freedom);
  if (typeof r.proactive === "boolean") out.proactive = r.proactive;
  return out;
}

/**
 * The settings of one run: the stored ones, with the panel's choice on top.
 * @param {DesignerSettings} saved
 * @param {DesignerRunOverride | null | undefined} override
 * @returns {DesignerSettings}
 */
export function mergeDesignerSettings(saved, override) {
  const base = parseDesignerSettings(saved);
  const o = parseDesignerRunOverride(override);
  return { ...base, ...o, houseStyle: base.houseStyle };
}

/**
 * The quality level a model + effort pair matches, or null (an own setting).
 * @param {{ model: string, effort: string }} s
 * @returns {"schnell" | "gruendlich" | "maximal" | null}
 */
export function designerQualityOf(s) {
  const q = DESIGNER_QUALITY.find((p) => p.model === s?.model && p.effort === s?.effort);
  return q ? /** @type {"schnell" | "gruendlich" | "maximal"} */ (q.id) : null;
}

/** The label of a model id (the id itself when unknown). @param {string} id */
export function designerModelLabel(id) {
  return DESIGNER_MODELS.find((m) => m.id === id)?.label ?? id;
}

/** The label of an effort (the id itself when unknown). @param {string} id */
export function designerEffortLabel(id) {
  return DESIGNER_EFFORTS.find((e) => e.id === id)?.label ?? id;
}

/**
 * One line for the panel and the result: „Gründlich · Claude Opus 5.5 ·
 * Denktiefe Hoch“, or „Eigene Einstellung · …“.
 * @param {{ model: string, effort: string }} s
 */
export function designerSettingsLabel(s) {
  const q = designerQualityOf(s);
  const level = q ? DESIGNER_QUALITY.find((p) => p.id === q)?.label : "Eigene Einstellung";
  return `${level} · ${designerModelLabel(s.model)} · Denktiefe ${designerEffortLabel(s.effort)}`;
}

/** The answer budget of a run (a whole block document — DESIGNER_LIMITS.answerTokens). */
export const DESIGNER_ANSWER_TOKENS = 32_000;
/** Max output of the three models (thinking + answer). */
export const DESIGNER_MODEL_MAX_OUTPUT = 128_000;
/** Room for thinking per effort: more effort, more thinking — capped by the model's output limit. */
const THINKING_HEADROOM = Object.freeze({ low: 8_000, medium: 16_000, high: 32_000, xhigh: 64_000, max: 96_000 });

/**
 * The output-token cap of a run: the answer budget plus the thinking room of
 * its effort (thinking counts toward max_tokens — a cap sized for the answer
 * alone would cut a deep-thinking run off before it submits).
 * @param {string} effort
 * @param {number} [answerTokens]
 */
export function designerMaxOutputTokens(effort, answerTokens = DESIGNER_ANSWER_TOKENS) {
  const headroom = THINKING_HEADROOM[/** @type {DesignerEffort} */ (effort)] ?? THINKING_HEADROOM.high;
  return Math.min(DESIGNER_MODEL_MAX_OUTPUT, Math.max(1, Math.floor(answerTokens)) + headroom);
}

// ── what the model reads ─────────────────────────────────────────────────────

/**
 * The house style as the last section of the system prompt ("" when empty —
 * then the prompt stays byte-identical to the one without settings and keeps
 * its cache). Team text, so its links and codes count as named by the
 * operator; the wrapper cannot be closed from inside.
 * @param {DesignerSettings | { houseStyle?: string }} s
 */
export function designerHouseStyleSection(s) {
  const text = clipChars(cleanHouseStyle(s?.houseStyle), HOUSE_STYLE_MAX_CHARS).replace(/<\/?\s*hausstil/gi, "‹hausstil");
  if (!text) return "";
  return [
    "## Hausstil des Shops (vom Team in den Einstellungen vorgegeben)",
    "Diese Vorgaben gelten für JEDE Mail — Farben, Schriften, Tonfall, Dinge, die nie vorkommen dürfen. Sie gehen deinen eigenen Stilentscheidungen vor. Verlangt die Anweisung eines Auftrags ausdrücklich etwas anderes, gilt die Anweisung. Werte darin (Links, Codes, Zahlen) gelten als vom Team genannt.",
    "<hausstil>",
    text,
    "</hausstil>",
  ].join("\n");
}

const FREEDOM_TEXT = Object.freeze({
  genau:
    "Gestaltungsfreiheit: GENAU NACH AUFTRAG. Ändere nur, was die Anweisung verlangt. Aufbau, Reihenfolge, Texte, Farben und Bausteine der aktuellen Mail bleiben sonst unverändert — keine eigenen Ergänzungen, Umstellungen oder Neuformulierungen. Bei einer neuen Mail hältst du dich eng an die Anweisung und die Anhänge. Fällt dir eine Verbesserung auf, nenne sie in notes, statt sie einzubauen.",
  ausgewogen:
    "Gestaltungsfreiheit: AUSGEWOGEN. Setze die Anweisung um; kleine Verbesserungen an Lesbarkeit, Abständen und Aufbau sind erwünscht, größere Umbauten nur, wenn die Anweisung sie nahelegt.",
  frei:
    "Gestaltungsfreiheit: FREI GESTALTEN. Die Anweisung ist das Ziel, nicht die Grenze: Du darfst Aufbau, Reihenfolge, Gestaltung und Texte frei verbessern und Bausteine ergänzen oder entfernen, um eine wirklich starke Mail zu bauen. Nenne größere Änderungen kurz in notes.",
});

const PROACTIVE_TEXT = Object.freeze({
  on: "Mo-Funktionen: Setze passende Funktionen von Mo auch ohne ausdrücklichen Auftrag ein, wo sie der Mail helfen (wie im Leitfaden beschrieben).",
  off: "Mo-Funktionen: Baue Produkte, Gutschein-Code, Countdown, die Beratung mit Mo und andere Mo-Bausteine NUR ein, wenn die Anweisung sie verlangt oder die aktuelle Mail sie schon enthält — nicht von dir aus. Fehlt aus deiner Sicht etwas, nenne es in notes.",
});

/**
 * The team's working rules for this run, for the user content (after the
 * material, right before the instruction): freedom and the capabilities
 * switch. Always two lines, so the model never guesses the defaults.
 * @param {DesignerSettings | DesignerRunOverride} s
 */
export function designerRunRules(s) {
  const freedom = isFreedom(s?.freedom) ? /** @type {DesignerFreedom} */ (s.freedom) : /** @type {DesignerFreedom} */ (DEFAULT_DESIGNER_SETTINGS.freedom);
  const proactive = typeof s?.proactive === "boolean" ? s.proactive : DEFAULT_DESIGNER_SETTINGS.proactive;
  return `So arbeitest du bei diesem Auftrag (Einstellungen des Teams):\n- ${FREEDOM_TEXT[freedom]}\n- ${proactive ? PROACTIVE_TEXT.on : PROACTIVE_TEXT.off}`;
}
