// The KI-Gestalter's settings in the browser — the panel's choice for one
// conversation (admin/vorlagen/DesignerPanel.tsx, use-designer-session.ts)
// and the card „KI-Gestalter“ in Einstellungen
// (admin/einstellungen/DesignerSettingsCard.tsx). The browser half of
// mail-template-designer-settings.mjs, which the server reads on every run.
// Pure and tested (mail-designer-choice.test.mjs):
//
//   * designerChoiceFrom — the choice of a conversation: model, effort,
//     freedom, the capabilities switch and the pictures switch („Bilder mit
//     KI erzeugen“) — the stored settings without the house style (the server
//     always takes that from the stored settings). Every value is checked; an
//     unknown one falls back to its default.
//   * designerChoiceWithQuality — a quality level („Schnell“, „Gründlich“,
//     „Maximal“) sets model and effort together.
//   * designerRequestSettings — the assist request's `settings`: the whole
//     choice goes with every request; the server merges it over the stored
//     settings (mergeDesignerSettings).
//   * designerChoiceShort — the button next to „Gestalten“: „Gründlich ·
//     Opus 5.5“, „Maximal · Fable 5.2“, „Eigene · Opus 5.5 · Sehr hoch“.
//   * isDefaultDesignerChoice, designerSettingsWithDefaultChoices,
//     designerSettingsDirty, houseStyleLength — the Einstellungen card
//     („Standard wiederherstellen“ keeps the house style; a change of
//     whitespace alone is no change — the server cleans the text).
//   * DESIGNER_TEXTS — the explanations the card and the panel show in their
//     InfoTips (one wording for both; `images` is the owner's wording for
//     „Bilder mit KI erzeugen“).

import { adminTabHref } from "./admin-tabs.mjs";
import {
  DEFAULT_DESIGNER_SETTINGS,
  DESIGNER_QUALITY,
  cleanHouseStyle,
  designerEffortLabel,
  designerModelLabel,
  designerQualityOf,
  parseDesignerSettings,
} from "./mail-template-designer-settings.mjs";

/** @typedef {import("./mail-template-designer-settings.mjs").DesignerSettings} DesignerSettings */
/** The choice of one conversation (the assist request's `settings`). @typedef {Pick<DesignerSettings, "model" | "effort" | "freedom" | "proactive" | "images">} DesignerChoice */
/** @typedef {"schnell" | "gruendlich" | "maximal"} DesignerQualityId */

/** The id of the card „KI-Gestalter“ in Einstellungen — the panel links to it. */
export const DESIGNER_SETTINGS_ANCHOR = "ki-gestalter";

/** Einstellungen → „KI-Gestalter“ (the panel opens it in a new tab, so unsaved editor work stays). */
export const DESIGNER_SETTINGS_HREF = `${adminTabHref("einstellungen")}#${DESIGNER_SETTINGS_ANCHOR}`;

/**
 * The choice of a conversation from stored settings (or another choice):
 * model, effort, freedom, capabilities, pictures — checked, defaults for
 * anything unknown; never the house style.
 * @param {unknown} settings
 * @returns {DesignerChoice}
 */
export function designerChoiceFrom(settings) {
  const s = parseDesignerSettings(settings && typeof settings === "object" ? { ...settings, houseStyle: "" } : null);
  return { model: s.model, effort: s.effort, freedom: s.freedom, proactive: s.proactive, images: s.images };
}

/**
 * The choice with a quality level's model and effort (freedom and the
 * capabilities switch stay); an unknown level changes nothing.
 * @param {unknown} choice
 * @param {string} quality
 * @returns {DesignerChoice}
 */
export function designerChoiceWithQuality(choice, quality) {
  const base = designerChoiceFrom(choice);
  const level = DESIGNER_QUALITY.find((q) => q.id === quality);
  return level ? { ...base, model: level.model, effort: /** @type {DesignerChoice["effort"]} */ (level.effort) } : base;
}

/**
 * Same model and effort (the „Qualität“ of both)?
 * @param {{ model?: unknown, effort?: unknown } | null | undefined} a
 * @param {{ model?: unknown, effort?: unknown } | null | undefined} b
 */
export function sameDesignerQuality(a, b) {
  return Boolean(a && b) && a?.model === b?.model && a?.effort === b?.effort;
}

/**
 * The assist request's `settings` — the whole choice, checked.
 * @param {unknown} choice
 * @returns {DesignerChoice}
 */
export function designerRequestSettings(choice) {
  return designerChoiceFrom(choice);
}

/** „Claude Opus 5.5“ → „Opus 5.5“ (an unknown id stays as it is). @param {string} id */
export function designerModelShort(id) {
  return designerModelLabel(id).replace(/^Claude\s+/, "");
}

/**
 * The short line of a choice for the button next to „Gestalten“: the level
 * and the model, or — for an own combination — „Eigene“, model and effort.
 * @param {{ model: string, effort: string }} choice
 */
export function designerChoiceShort(choice) {
  const level = DESIGNER_QUALITY.find((q) => q.id === designerQualityOf(choice));
  const model = designerModelShort(choice?.model ?? "");
  return level ? `${level.label} · ${model}` : `Eigene · ${model} · ${designerEffortLabel(choice?.effort ?? "")}`;
}

/**
 * Model, effort, freedom, the capabilities switch and the pictures switch are
 * the defaults? („Standard wiederherstellen“ has nothing to do.) A choice
 * without the pictures switch (from before it existed) counts as on.
 * @param {{ model?: unknown, effort?: unknown, freedom?: unknown, proactive?: unknown, images?: unknown } | null | undefined} s
 */
export function isDefaultDesignerChoice(s) {
  const d = DEFAULT_DESIGNER_SETTINGS;
  return s?.model === d.model && s?.effort === d.effort && s?.freedom === d.freedom && s?.proactive === d.proactive && (s?.images ?? true) === d.images;
}

/**
 * „Standard wiederherstellen“: the default choices — the house style stays
 * as typed (it is the team's own text, not a setting with a default).
 * @param {{ houseStyle?: unknown } | null | undefined} s
 * @returns {DesignerSettings}
 */
export function designerSettingsWithDefaultChoices(s) {
  return { ...DEFAULT_DESIGNER_SETTINGS, houseStyle: typeof s?.houseStyle === "string" ? s.houseStyle : "" };
}

/**
 * Does the form differ from the saved settings? The house style compares as
 * the server stores it (cleaned): trailing spaces or extra blank lines alone
 * are no change.
 * @param {DesignerSettings} form
 * @param {DesignerSettings} saved
 */
export function designerSettingsDirty(form, saved) {
  return (
    form.model !== saved.model ||
    form.effort !== saved.effort ||
    form.freedom !== saved.freedom ||
    form.proactive !== saved.proactive ||
    (form.images ?? true) !== (saved.images ?? true) ||
    cleanHouseStyle(form.houseStyle) !== cleanHouseStyle(saved.houseStyle)
  );
}

/**
 * The house style's length as the server counts it (cleaned — the limit is
 * HOUSE_STYLE_MAX_CHARS).
 * @param {unknown} text
 */
export function houseStyleLength(text) {
  return cleanHouseStyle(text).length;
}

/**
 * The explanations of the card „KI-Gestalter“ and of the panel's settings —
 * the InfoTips show them; lists are one paragraph per entry.
 */
export const DESIGNER_TEXTS = Object.freeze({
  card: "Wie der KI-Gestalter in Vorlagen und Rundmail arbeitet — für das ganze Team. Im KI-Gestalter selbst lassen sich Qualität, Gestaltungsfreiheit, Mo-Funktionen und KI-Bilder für eine Unterhaltung ändern; der Hausstil gilt immer.",
  quality: Object.freeze([
    "Wie gründlich die KI gestaltet.",
    "Schnell: Claude Sonnet 5.5 mit mittlerer Denktiefe — für kleine Änderungen an Texten, Farben und Abständen, meist unter einer Minute, etwa halb so teuer.",
    "Gründlich (Standard): Claude Opus 5.5 mit hoher Denktiefe — für neue Mails und größere Umbauten, meist ein bis drei Minuten.",
    "Maximal: Claude Fable 5.2, Anthropics stärkstes Modell — für Nachbauten nach Screenshots und aufwendige Mails; dauert länger und kostet etwa das Doppelte.",
  ]),
  effort:
    "Wie lange die KI nachdenkt, bevor und während sie gestaltet. Höher heißt sorgfältiger, aber langsamer und teurer. „Sehr hoch“ und „Maximal“ lohnen sich nur für sehr aufwendige Mails: Eine Gestaltung darf höchstens fünf Minuten dauern — reicht die Zeit nicht, übernimmt die KI ihren letzten geprüften Stand.",
  freedom: Object.freeze([
    "Genau nach Auftrag: Die KI ändert nur, was du verlangst — Aufbau, Texte und Farben bleiben sonst, wie sie sind.",
    "Ausgewogen (Standard): Sie setzt den Auftrag um und verbessert nebenbei Lesbarkeit und Abstände.",
    "Frei gestalten: Der Auftrag ist das Ziel — die KI darf Aufbau und Gestaltung frei verbessern und Bausteine ergänzen oder entfernen.",
  ]),
  proactive: Object.freeze([
    "An: Die KI baut passende Funktionen von Mo auch ohne Auftrag ein — Produkte aus dem Katalog, Gutschein-Code, Countdown, die Beratung mit Mo.",
    "Aus: nur, wenn du sie verlangst oder die Mail sie schon enthält.",
  ]),
  images:
    "Die KI darf Bilder für die Mail erzeugen lassen — zum Beispiel einen Titelbereich mit eingebauter Überschrift, einen Hintergrund, ein Absperrband oder Icons. Produkte zeigt sie nur mit den echten Katalogfotos als Vorlage. Kostet je Bild etwa 0,20 € und dauert etwas länger.",
  houseStyle:
    "Was die KI bei jeder Mail beachten soll — zum Beispiel Hausfarben und Schriften, du oder Sie, Tonfall, Wörter, die nie vorkommen dürfen, feste Links (Instagram, Kontakt). Gilt für alle Vorlagen und Rundmails; eine ausdrückliche Anweisung im Auftrag geht vor.",
  houseStylePlaceholder:
    "z. B. Hausfarben Schwarz (#111111) und Rot (#E30613), Überschriften in Montserrat. Wir duzen, sportlich und direkt. Nie „billig“ schreiben.",
});
