import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DESIGNER_SETTINGS_ANCHOR,
  DESIGNER_SETTINGS_HREF,
  DESIGNER_TEXTS,
  designerChoiceFrom,
  designerChoiceShort,
  designerChoiceWithQuality,
  designerModelShort,
  designerRequestSettings,
  designerSettingsDirty,
  designerSettingsWithDefaultChoices,
  houseStyleLength,
  isDefaultDesignerChoice,
  sameDesignerQuality,
} from "./mail-designer-choice.mjs";
import {
  DEFAULT_DESIGNER_SETTINGS,
  DESIGNER_QUALITY,
  HOUSE_STYLE_MAX_CHARS,
  mergeDesignerSettings,
  parseDesignerRunOverride,
} from "./mail-template-designer-settings.mjs";
import { FABLE_MODEL, OPUS_MODEL, SONNET_MODEL } from "./ai-models.mjs";

const stored = (extra = {}) => ({ ...DEFAULT_DESIGNER_SETTINGS, houseStyle: "Wir duzen.", ...extra });

test("the choice of a conversation: the stored settings without the house style, every value checked", () => {
  assert.deepEqual(designerChoiceFrom(DEFAULT_DESIGNER_SETTINGS), {
    model: OPUS_MODEL,
    effort: "high",
    freedom: "ausgewogen",
    proactive: true,
    images: true,
  });
  const custom = designerChoiceFrom(stored({ model: FABLE_MODEL, effort: "xhigh", freedom: "frei", proactive: false, images: false }));
  assert.deepEqual(custom, { model: FABLE_MODEL, effort: "xhigh", freedom: "frei", proactive: false, images: false });
  assert.equal("houseStyle" in custom, false);
  // unknown values fall back one by one; garbage → the defaults
  assert.deepEqual(designerChoiceFrom({ model: "gpt-9", effort: "ultra", freedom: "frei", proactive: "ja", images: "nein" }), {
    model: OPUS_MODEL,
    effort: "high",
    freedom: "frei",
    proactive: true,
    images: true,
  });
  assert.deepEqual(designerChoiceFrom(null), designerChoiceFrom(DEFAULT_DESIGNER_SETTINGS));
  assert.deepEqual(designerChoiceFrom("x"), designerChoiceFrom(DEFAULT_DESIGNER_SETTINGS));
  assert.deepEqual(designerChoiceFrom([1, 2]), designerChoiceFrom(DEFAULT_DESIGNER_SETTINGS));
});

test("a quality level sets model and effort together; freedom and the capabilities switch stay", () => {
  const base = designerChoiceFrom(stored({ freedom: "genau", proactive: false, images: false }));
  assert.deepEqual(designerChoiceWithQuality(base, "schnell"), { model: SONNET_MODEL, effort: "medium", freedom: "genau", proactive: false, images: false });
  assert.deepEqual(designerChoiceWithQuality(base, "maximal"), { model: FABLE_MODEL, effort: "high", freedom: "genau", proactive: false, images: false });
  assert.deepEqual(designerChoiceWithQuality(base, "gruendlich"), { model: OPUS_MODEL, effort: "high", freedom: "genau", proactive: false, images: false });
  for (const q of DESIGNER_QUALITY) {
    const c = designerChoiceWithQuality(base, q.id);
    assert.deepEqual([c.model, c.effort], [q.model, q.effort]);
  }
  // an unknown level changes nothing (and the input is not mutated)
  assert.deepEqual(designerChoiceWithQuality(base, "turbo"), base);
  assert.notEqual(designerChoiceWithQuality(base, "turbo"), base);
  assert.equal(base.model, OPUS_MODEL);
});

test("same quality: model and effort", () => {
  assert.equal(sameDesignerQuality({ model: OPUS_MODEL, effort: "high" }, stored()), true);
  assert.equal(sameDesignerQuality({ model: OPUS_MODEL, effort: "xhigh" }, stored()), false);
  assert.equal(sameDesignerQuality({ model: FABLE_MODEL, effort: "high" }, stored()), false);
  assert.equal(sameDesignerQuality(null, stored()), false);
  assert.equal(sameDesignerQuality(undefined, undefined), false);
});

test("the request settings: the whole choice, checked — what the server merges over the stored settings", () => {
  const choice = { model: SONNET_MODEL, effort: "medium", freedom: "genau", proactive: false, images: false, houseStyle: "nie aus der Anfrage" };
  const settings = designerRequestSettings(choice);
  assert.deepEqual(settings, { model: SONNET_MODEL, effort: "medium", freedom: "genau", proactive: false, images: false });
  assert.deepEqual(Object.keys(settings), ["model", "effort", "freedom", "proactive", "images"]);
  // the server keeps every field and never takes a house style from it
  assert.deepEqual(parseDesignerRunOverride(settings), settings);
  assert.deepEqual(mergeDesignerSettings(stored(), settings), { ...settings, houseStyle: "Wir duzen." });
  // broken values never reach the request
  assert.deepEqual(designerRequestSettings({ model: "x", effort: 3 }), designerChoiceFrom(DEFAULT_DESIGNER_SETTINGS));
});

test("the short line next to „Gestalten“", () => {
  assert.equal(designerChoiceShort(DEFAULT_DESIGNER_SETTINGS), "Gründlich · Opus 5.5");
  assert.equal(designerChoiceShort({ model: FABLE_MODEL, effort: "high" }), "Maximal · Fable 5.2");
  assert.equal(designerChoiceShort({ model: SONNET_MODEL, effort: "medium" }), "Schnell · Sonnet 5.5");
  assert.equal(designerChoiceShort({ model: OPUS_MODEL, effort: "xhigh" }), "Eigene · Opus 5.5 · Sehr hoch");
  assert.equal(designerChoiceShort({ model: SONNET_MODEL, effort: "high" }), "Eigene · Sonnet 5.5 · Hoch");
  assert.equal(designerChoiceShort({ model: FABLE_MODEL, effort: "max" }), "Eigene · Fable 5.2 · Maximal");
  assert.equal(designerModelShort(OPUS_MODEL), "Opus 5.5");
  assert.equal(designerModelShort("claude-unknown"), "claude-unknown");
});

test("Einstellungen card: „Standard wiederherstellen“ resets the choices but keeps the house style", () => {
  assert.equal(isDefaultDesignerChoice(DEFAULT_DESIGNER_SETTINGS), true);
  assert.equal(isDefaultDesignerChoice(stored()), true); // the house style is no choice
  assert.equal(isDefaultDesignerChoice(stored({ proactive: false })), false);
  assert.equal(isDefaultDesignerChoice(stored({ freedom: "frei" })), false);
  assert.equal(isDefaultDesignerChoice(stored({ effort: "max" })), false);
  assert.equal(isDefaultDesignerChoice(stored({ images: false })), false);
  assert.equal(isDefaultDesignerChoice({ model: OPUS_MODEL, effort: "high", freedom: "ausgewogen", proactive: true }), true, "without the switch (older state): on");
  assert.equal(isDefaultDesignerChoice(null), false);
  const form = stored({ model: FABLE_MODEL, effort: "max", freedom: "genau", proactive: false, images: false, houseStyle: "Rot und Schwarz.\n" });
  const reset = designerSettingsWithDefaultChoices(form);
  assert.deepEqual(reset, { ...DEFAULT_DESIGNER_SETTINGS, houseStyle: "Rot und Schwarz.\n" });
  assert.equal(isDefaultDesignerChoice(reset), true);
  assert.equal(form.model, FABLE_MODEL); // not mutated
  assert.deepEqual(designerSettingsWithDefaultChoices(null), { ...DEFAULT_DESIGNER_SETTINGS });
});

test("Einstellungen card: dirty compares the house style as the server stores it", () => {
  const saved = stored({ houseStyle: "Wir duzen.\n\nNie „billig“." });
  assert.equal(designerSettingsDirty({ ...saved }, saved), false);
  // whitespace alone is no change
  assert.equal(designerSettingsDirty({ ...saved, houseStyle: "Wir duzen.  \n\n\n\nNie „billig“.  " }, saved), false);
  assert.equal(designerSettingsDirty({ ...saved, houseStyle: "Wir siezen." }, saved), true);
  assert.equal(designerSettingsDirty({ ...saved, model: SONNET_MODEL }, saved), true);
  assert.equal(designerSettingsDirty({ ...saved, effort: "medium" }, saved), true);
  assert.equal(designerSettingsDirty({ ...saved, freedom: "frei" }, saved), true);
  assert.equal(designerSettingsDirty({ ...saved, proactive: false }, saved), true);
  assert.equal(designerSettingsDirty({ ...saved, images: false }, saved), true);
});

test("Einstellungen card: the house style counts as the server counts it", () => {
  assert.equal(houseStyleLength("  Wir duzen.  "), "Wir duzen.".length);
  assert.equal(houseStyleLength("a\r\n\r\n\r\nb"), 4); // "a\n\nb"
  assert.equal(houseStyleLength(null), 0);
  assert.equal(houseStyleLength("x".repeat(HOUSE_STYLE_MAX_CHARS + 1)), HOUSE_STYLE_MAX_CHARS + 1); // counted, not cut
});

test("the deep link to the card and the shared explanations", () => {
  assert.equal(DESIGNER_SETTINGS_ANCHOR, "ki-gestalter");
  assert.equal(DESIGNER_SETTINGS_HREF, "/admin?tab=einstellungen#ki-gestalter");
  // the quality text names the three levels with their models
  const quality = DESIGNER_TEXTS.quality.join(" ");
  for (const word of ["Schnell: Claude Sonnet 5.5", "Gründlich (Standard): Claude Opus 5.5", "Maximal: Claude Fable 5.2"]) {
    assert.ok(quality.includes(word), word);
  }
  assert.deepEqual(
    DESIGNER_TEXTS.freedom.map((p) => p.split(":")[0]),
    ["Genau nach Auftrag", "Ausgewogen (Standard)", "Frei gestalten"]
  );
  assert.ok(Object.isFrozen(DESIGNER_TEXTS) && Object.isFrozen(DESIGNER_TEXTS.quality));
  // „Bilder mit KI erzeugen“ — the owner's wording; the card names the switch for one conversation
  assert.equal(
    DESIGNER_TEXTS.images,
    "Die KI darf Bilder für die Mail erzeugen lassen — zum Beispiel einen Titelbereich mit eingebauter Überschrift, einen Hintergrund, ein Absperrband oder Icons. Produkte zeigt sie nur mit den echten Katalogfotos als Vorlage. Kostet je Bild etwa 0,20 € und dauert etwas länger."
  );
  assert.match(DESIGNER_TEXTS.card, /KI-Bilder für eine Unterhaltung/);
});
