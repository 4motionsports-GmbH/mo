import { test } from "node:test";
import assert from "node:assert/strict";

import { partitionSummaryProducts } from "./summary-products.mjs";

const P = (id) => ({ id });

test("alternatives are the discussed products minus the chosen set", () => {
  const discussed = [P("a"), P("b"), P("c"), P("d")];
  const { alternatives } = partitionSummaryProducts(["b", "d"], discussed);
  assert.deepEqual(
    alternatives.map((p) => p.id),
    ["a", "c"]
  );
});

test("chosen ∩ alternatives = ∅", () => {
  const discussed = [P("a"), P("b"), P("c")];
  const chosenIds = ["a", "c"];
  const { alternatives } = partitionSummaryProducts(chosenIds, discussed);
  const chosen = new Set(chosenIds);
  for (const p of alternatives) {
    assert.ok(!chosen.has(p.id), `chosen id ${p.id} leaked into alternatives`);
  }
});

test("alternatives is empty when every discussed product was chosen (fallback case)", () => {
  // When no clear choice is made the cart link falls back to ALL discussed
  // products, so the chosen set equals the discussed set and there is nothing
  // left over — the alternatives section is omitted entirely.
  const discussed = [P("a"), P("b"), P("c")];
  const { alternatives } = partitionSummaryProducts(["a", "b", "c"], discussed);
  assert.equal(alternatives.length, 0);
});

test("alternatives is all discussed products when none are chosen", () => {
  const discussed = [P("a"), P("b")];
  const { alternatives } = partitionSummaryProducts([], discussed);
  assert.deepEqual(
    alternatives.map((p) => p.id),
    ["a", "b"]
  );
});

test("chosen ids absent from the discussed list never fabricate alternatives", () => {
  // A product the user selected that was not in the discussed list simply isn't
  // present here; it must not appear in alternatives, and must not error.
  const discussed = [P("a")];
  const { alternatives } = partitionSummaryProducts(["x", "y"], discussed);
  assert.deepEqual(
    alternatives.map((p) => p.id),
    ["a"]
  );
});

test("original discussed order is preserved", () => {
  const discussed = [P("d"), P("c"), P("b"), P("a")];
  const { alternatives } = partitionSummaryProducts(["c"], discussed);
  assert.deepEqual(
    alternatives.map((p) => p.id),
    ["d", "b", "a"]
  );
});
