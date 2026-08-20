import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EMAIL_TEXT_MODES,
  DEFAULT_EMAIL_TEXT_MODE,
  LEGACY_EMAIL_TEXT_MODE,
  EMAIL_TEXT_MODE_LABELS,
  EMAIL_TEXT_MODE_HINTS,
  parseEmailTextMode,
  storedTextMode,
  textModeBodyRule,
  textModeHighlightRule,
} from "./email-text-mode.mjs";

test("mode vocabulary: defaults are valid modes, every mode has UI copy", () => {
  assert.ok(EMAIL_TEXT_MODES.includes(DEFAULT_EMAIL_TEXT_MODE));
  assert.ok(EMAIL_TEXT_MODES.includes(LEGACY_EMAIL_TEXT_MODE));
  for (const mode of EMAIL_TEXT_MODES) {
    assert.ok(EMAIL_TEXT_MODE_LABELS[mode], `label for ${mode}`);
    assert.ok(EMAIL_TEXT_MODE_HINTS[mode], `hint for ${mode}`);
  }
});

test("parseEmailTextMode: known modes pass, everything else is null", () => {
  for (const mode of EMAIL_TEXT_MODES) {
    assert.equal(parseEmailTextMode(mode), mode);
  }
  assert.equal(parseEmailTextMode("short"), null);
  assert.equal(parseEmailTextMode(""), null);
  assert.equal(parseEmailTextMode(null), null);
  assert.equal(parseEmailTextMode(undefined), null);
  assert.equal(parseEmailTextMode(42), null);
  assert.equal(parseEmailTextMode({}), null);
});

test("storedTextMode: legacy rows (NULL) count as detailed", () => {
  assert.equal(storedTextMode(null), "detailed");
  assert.equal(storedTextMode(undefined), "detailed");
  assert.equal(storedTextMode({ textMode: null }), "detailed");
  assert.equal(storedTextMode({ textMode: "compact" }), "compact");
  assert.equal(storedTextMode({ textMode: "minimal" }), "minimal");
});

test("body rule: every mode/language pair yields a distinct, non-empty rule", () => {
  for (const language of ["de", "en"]) {
    const rules = EMAIL_TEXT_MODES.map((m) => textModeBodyRule(m, language));
    for (const rule of rules) assert.ok(rule.length > 50);
    assert.equal(new Set(rules).size, rules.length, "rules must differ per mode");
  }
  // Default language is German.
  assert.equal(textModeBodyRule("compact"), textModeBodyRule("compact", "de"));
});

test("body rule: compact/minimal keep the discount + set mentions exempt from the cap", () => {
  for (const language of ["de", "en"]) {
    for (const mode of ["compact", "minimal"]) {
      const rule = textModeBodyRule(mode, language).toLowerCase();
      assert.ok(
        rule.includes("ausnahme") || rule.includes("exception"),
        `${mode}/${language} must exempt the mandated offer mentions`
      );
    }
  }
});

test("highlight rule: shorter modes demand shorter per-product descriptions", () => {
  assert.ok(textModeHighlightRule("detailed").includes("1–3"));
  assert.ok(textModeHighlightRule("compact").toLowerCase().includes("ein"));
  assert.ok(textModeHighlightRule("minimal").includes("~8"));
});
