import { test } from "node:test";
import assert from "node:assert/strict";
import { applyMintedDiscountToBody } from "./discount-swap.mjs";

test("swaps the placeholder for the real code wherever it appears", () => {
  const body = "Dein Code MO-XXXX gilt 7 Tage. Nochmal: MO-XXXX.";
  const out = applyMintedDiscountToBody(body, {
    placeholder: "MO-XXXX",
    code: "MK-ABCD2345",
  });
  assert.equal(out, "Dein Code MK-ABCD2345 gilt 7 Tage. Nochmal: MK-ABCD2345.");
});

test("swaps a stale projected expiry label for the real one", () => {
  const body = "Code MO-XXXX, gültig bis 01.08.2026.";
  const out = applyMintedDiscountToBody(body, {
    placeholder: "MO-XXXX",
    code: "MK-ABCD2345",
    draftExpiryLabel: "01.08.2026",
    realExpiryLabel: "05.08.2026",
  });
  assert.equal(out, "Code MK-ABCD2345, gültig bis 05.08.2026.");
});

test("identical labels are left untouched; missing labels are a no-op", () => {
  const body = "Code MO-XXXX, gültig bis 01.08.2026.";
  assert.equal(
    applyMintedDiscountToBody(body, {
      placeholder: "MO-XXXX",
      code: "MS5-XYZ",
      draftExpiryLabel: "01.08.2026",
      realExpiryLabel: "01.08.2026",
    }),
    "Code MS5-XYZ, gültig bis 01.08.2026."
  );
  assert.equal(
    applyMintedDiscountToBody(body, { placeholder: "MO-XXXX", code: "MS5-XYZ" }),
    "Code MS5-XYZ, gültig bis 01.08.2026."
  );
});

test("defensive: non-string body → empty string, empty swap fields are no-ops", () => {
  assert.equal(applyMintedDiscountToBody(null, { placeholder: "MO-XXXX", code: "X" }), "");
  assert.equal(
    applyMintedDiscountToBody("unchanged", { placeholder: "", code: "X" }),
    "unchanged"
  );
});
