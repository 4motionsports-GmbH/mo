import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseConversationFilter,
  parseConversationId,
  flattenConversationFilter,
  conversationFilterParams,
  conversationFilterHref,
  activeConversationFilterCount,
  defaultConversationFilterState,
  SEARCH_MAX_LENGTH,
} from "./admin-conversation-filter.mjs";

const NOW = new Date("2026-09-09T12:00:00Z");

test("parseConversationFilter: defaults", () => {
  const f = parseConversationFilter({}, NOW);
  assert.equal(f.range.preset, "30d");
  assert.equal(f.range.to, "2026-09-09");
  assert.deepEqual(
    { tier: f.tier, hasError: f.hasError, category: f.category, quality: f.quality, q: f.q, page: f.page },
    { tier: null, hasError: false, category: null, quality: null, q: null, page: 1 }
  );
});

test("parseConversationFilter: valid values pass, unknown ones fall back", () => {
  const f = parseConversationFilter(
    {
      grange: "custom",
      gfrom: "2026-08-01",
      gto: "2026-08-15",
      gtier: "email-only",
      gerr: "1",
      gcat: "product-advice",
      gqual: "handled_well",
      gq: "  anna  ",
      gpage: "3",
    },
    NOW
  );
  assert.equal(f.range.preset, "custom");
  assert.equal(f.range.from, "2026-08-01");
  assert.equal(f.tier, "email-only");
  assert.equal(f.hasError, true);
  assert.equal(f.category, "product-advice");
  assert.equal(f.quality, "handled_well");
  assert.equal(f.q, "anna");
  assert.equal(f.page, 3);

  const g = parseConversationFilter(
    { gtier: "vip", gcat: "nope", gqual: "great", gerr: "yes", gpage: "-2", gq: "   " },
    NOW
  );
  assert.equal(g.tier, null);
  assert.equal(g.category, null);
  assert.equal(g.quality, null);
  assert.equal(g.hasError, false);
  assert.equal(g.page, 1);
  assert.equal(g.q, null);
});

test("parseConversationFilter: search is capped", () => {
  const f = parseConversationFilter({ gq: "x".repeat(SEARCH_MAX_LENGTH + 50) }, NOW);
  assert.equal(f.q?.length, SEARCH_MAX_LENGTH);
});

test("parseConversationId", () => {
  assert.equal(parseConversationId("42"), 42);
  assert.equal(parseConversationId("0"), null);
  assert.equal(parseConversationId("-1"), null);
  assert.equal(parseConversationId("abc"), null);
  assert.equal(parseConversationId(undefined), null);
  assert.equal(parseConversationId("1".repeat(13)), null);
});

test("conversationFilterParams: only non-default keys; round-trips through the parser", () => {
  const state = flattenConversationFilter(parseConversationFilter({}, NOW));
  assert.deepEqual(conversationFilterParams(state), { tab: "gespraeche", grange: "30d" });

  const params = conversationFilterParams(
    state,
    { preset: "custom", from: "2026-08-01", to: "2026-08-15", tier: "signed-in", hasError: true, category: "product-advice", q: "hantel", page: 2 },
    77
  );
  assert.deepEqual(params, {
    tab: "gespraeche",
    grange: "custom",
    gfrom: "2026-08-01",
    gto: "2026-08-15",
    gtier: "signed-in",
    gerr: "1",
    gcat: "product-advice",
    gq: "hantel",
    gpage: "2",
    gid: "77",
  });
  const back = parseConversationFilter(params, NOW);
  assert.equal(back.range.from, "2026-08-01");
  assert.equal(back.tier, "signed-in");
  assert.equal(back.hasError, true);
  assert.equal(back.category, "product-advice");
  assert.equal(back.q, "hantel");
  assert.equal(back.page, 2);
  assert.equal(parseConversationId(params.gid), 77);
});

test("conversationFilterHref encodes the search", () => {
  const state = defaultConversationFilterState(NOW);
  assert.equal(conversationFilterHref(state, { q: "anna müller" }), "/admin?tab=gespraeche&grange=30d&gq=anna+m%C3%BCller");
});

test("activeConversationFilterCount counts deviations, not the page", () => {
  const state = defaultConversationFilterState(NOW);
  assert.equal(activeConversationFilterCount(state), 0);
  assert.equal(activeConversationFilterCount({ ...state, page: 4 }), 0);
  assert.equal(
    activeConversationFilterCount({ ...state, preset: "7d", tier: "anonymous", hasError: true, category: "x", quality: "y", q: "z" }),
    6
  );
});
