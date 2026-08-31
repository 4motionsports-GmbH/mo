// Unit tests for the email-theme vocabulary/validation core (node --test).

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_EMAIL_THEME,
  EMAIL_BUTTON_SHAPES,
  EMAIL_FONT_KEYS,
  EMAIL_THEME_KINDS,
  EMAIL_THEME_KIND_LABELS,
  buttonRadiusFor,
  fontNeedsWebFont,
  fontStackFor,
  normalizeTemplateDescription,
  normalizeTemplateName,
  parseEmailButtonShape,
  parseEmailFontKey,
  parseEmailThemeInput,
  parseEmailThemeKind,
  parseHexColor,
  parseLogoUrl,
} from "./email-theme.mjs";

test("every kind has a label", () => {
  for (const kind of EMAIL_THEME_KINDS) {
    assert.equal(typeof EMAIL_THEME_KIND_LABELS[kind], "string");
    assert.ok(EMAIL_THEME_KIND_LABELS[kind].length > 0);
  }
});

test("parseEmailThemeKind accepts kinds, rejects everything else", () => {
  assert.equal(parseEmailThemeKind("summary"), "summary");
  assert.equal(parseEmailThemeKind("doi"), "doi");
  assert.equal(parseEmailThemeKind("correspondence"), null);
  assert.equal(parseEmailThemeKind(""), null);
  assert.equal(parseEmailThemeKind(42), null);
  assert.equal(parseEmailThemeKind(null), null);
});

test("parseHexColor normalizes and rejects non-hex", () => {
  assert.equal(parseHexColor("#008CCB"), "#008ccb");
  assert.equal(parseHexColor("  #fafafa "), "#fafafa");
  assert.equal(parseHexColor("#f0a"), "#ff00aa");
  assert.equal(parseHexColor("008ccb"), null);
  assert.equal(parseHexColor("red"), null);
  assert.equal(parseHexColor("#12345"), null);
  assert.equal(parseHexColor("#0088ccdd"), null);
  // Inline-CSS injection attempts must never survive.
  assert.equal(parseHexColor("#000; background: url(x)"), null);
  assert.equal(parseHexColor(123), null);
});

test("font keys parse and resolve to stacks", () => {
  for (const key of EMAIL_FONT_KEYS) {
    assert.equal(parseEmailFontKey(key), key);
    assert.ok(fontStackFor(key).length > 0);
  }
  assert.equal(parseEmailFontKey("comic-sans"), null);
  // Unknown keys fall back to the brand stack.
  assert.equal(fontStackFor("nonsense"), fontStackFor("montserrat"));
  assert.equal(fontNeedsWebFont("montserrat"), true);
  assert.equal(fontNeedsWebFont("arial"), false);
});

test("button shapes parse and resolve to radii", () => {
  for (const shape of EMAIL_BUTTON_SHAPES) {
    assert.equal(parseEmailButtonShape(shape), shape);
    assert.equal(typeof buttonRadiusFor(shape), "string");
  }
  assert.equal(parseEmailButtonShape("circle"), null);
  assert.equal(buttonRadiusFor("pill"), "200px");
  assert.equal(buttonRadiusFor("square"), "0");
  // Unknown shapes fall back to today's pill.
  assert.equal(buttonRadiusFor("weird"), "200px");
});

test("parseLogoUrl: empty → default (null), https only", () => {
  assert.deepEqual(parseLogoUrl(undefined), { ok: true, value: null });
  assert.deepEqual(parseLogoUrl(""), { ok: true, value: null });
  assert.deepEqual(parseLogoUrl("   "), { ok: true, value: null });
  assert.deepEqual(parseLogoUrl("https://cdn.example.com/logo.png"), {
    ok: true,
    value: "https://cdn.example.com/logo.png",
  });
  assert.equal(parseLogoUrl("http://cdn.example.com/logo.png").ok, false);
  assert.equal(parseLogoUrl("javascript:alert(1)").ok, false);
  assert.equal(parseLogoUrl("not a url").ok, false);
  assert.equal(parseLogoUrl(`https://x.de/${"a".repeat(600)}`).ok, false);
});

test("parseEmailThemeInput: empty input → exact defaults, no errors", () => {
  const { theme, errors } = parseEmailThemeInput({});
  assert.deepEqual(errors, []);
  assert.deepEqual(theme, DEFAULT_EMAIL_THEME);
});

test("parseEmailThemeInput: valid fields are taken over", () => {
  const { theme, errors } = parseEmailThemeInput({
    accentColor: "#CF2E2E",
    bandBackground: "#111111",
    bandTextColor: "#ffffff",
    outerBackground: "#f2f2f2",
    fontFamily: "georgia",
    buttonShape: "rounded",
    logoUrl: "https://cdn.example.com/logo.png",
    showSocial: false,
  });
  assert.deepEqual(errors, []);
  assert.equal(theme.accentColor, "#cf2e2e");
  assert.equal(theme.fontFamily, "georgia");
  assert.equal(theme.buttonShape, "rounded");
  assert.equal(theme.logoUrl, "https://cdn.example.com/logo.png");
  assert.equal(theme.showSocial, false);
});

test("parseEmailThemeInput: present-but-invalid fields are named", () => {
  const { errors } = parseEmailThemeInput({
    accentColor: "blue",
    fontFamily: "wingdings",
    buttonShape: "triangle",
    logoUrl: "ftp://x",
    showSocial: "yes",
  });
  assert.deepEqual(
    [...errors].sort(),
    ["accentColor", "buttonShape", "fontFamily", "logoUrl", "showSocial"]
  );
});

test("normalizeTemplateName trims, collapses whitespace, bounds length", () => {
  assert.equal(normalizeTemplateName("  Sommer   Sale  "), "Sommer Sale");
  assert.equal(normalizeTemplateName(""), null);
  assert.equal(normalizeTemplateName("   "), null);
  assert.equal(normalizeTemplateName(42), null);
  assert.equal(normalizeTemplateName("x".repeat(81)), null);
  assert.equal(normalizeTemplateName("x".repeat(80)), "x".repeat(80));
});

test("normalizeTemplateDescription: null/empty → null, over limit → undefined", () => {
  assert.equal(normalizeTemplateDescription(null), null);
  assert.equal(normalizeTemplateDescription(""), null);
  assert.equal(normalizeTemplateDescription("  hi  "), "hi");
  assert.equal(normalizeTemplateDescription(42), undefined);
  assert.equal(normalizeTemplateDescription("x".repeat(201)), undefined);
});
