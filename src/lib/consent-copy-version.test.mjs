import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CONSENT_COPY_VERSION,
  composeConsentTextShown,
  resolveConsentCopyVersion,
} from "./consent-copy-version.mjs";

// The version stamp stored alongside consent_text_shown on every capture
// (migration 0011). The strings themselves live in src/lib/consent-copy.ts
// (lawyer file); these tests pin the version mechanics.

test("current consent copy version is v2", () => {
  assert.equal(CONSENT_COPY_VERSION, "v2");
});

test("consentTextShown is composed in display order with the stable separator", () => {
  assert.equal(
    composeConsentTextShown(["A", "B", "C"]),
    "A | B | C"
  );
});

test("a byte-identical echo of the served copy attests the current version", () => {
  const canonical = composeConsentTextShown(["Label A", "Label B", "Footer"]);
  assert.equal(resolveConsentCopyVersion(canonical, canonical), CONSENT_COPY_VERSION);
});

test("any other echo resolves to null (stored as unattested, never mislabelled)", () => {
  const canonical = "Label A | Label B | Footer";
  // Stale v1 copy across a deploy boundary, a recomposed string, no echo at
  // all — none of these may be stamped with the current version.
  assert.equal(resolveConsentCopyVersion("old v1 text", canonical), null);
  assert.equal(resolveConsentCopyVersion(canonical + " ", canonical), null);
  assert.equal(resolveConsentCopyVersion(null, canonical), null);
  assert.equal(resolveConsentCopyVersion(undefined, canonical), null);
});
