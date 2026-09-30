import { test } from "node:test";
import assert from "node:assert/strict";
import {
  blendRecommendationScore,
  hasProfileSignal,
  normalizeProfileData,
  profileFactsBlock,
  profileNeedsUpkeep,
  profileSteeringQuery,
} from "./customer-profile-core.mjs";

test("normalizeProfileData fixes the shape whatever comes in", () => {
  const d = normalizeProfileData(null);
  assert.deepEqual(d, {
    persona: "unknown",
    goals: [],
    owned: [],
    interests: [],
    level: "unbekannt",
    budget: "unbekannt",
    nextSteps: [],
  });
  const n = normalizeProfileData({
    persona: "Strength_Focused",
    goals: ["  Muskelaufbau  ", "Muskelaufbau", 42, ""],
    level: "wizard",
    budget: "HOCH",
  });
  assert.equal(n.persona, "strength_focused");
  assert.deepEqual(n.goals, ["Muskelaufbau"]);
  assert.equal(n.level, "unbekannt");
  assert.equal(n.budget, "hoch");
});

test("lists are capped and long items clipped", () => {
  const n = normalizeProfileData({ interests: Array.from({ length: 20 }, (_, i) => `i${i}`), goals: ["x".repeat(500)] });
  assert.equal(n.interests.length, 8);
  assert.equal(n.goals[0].length, 160);
});

test("profileFactsBlock is empty without signal and lists the known fields otherwise", () => {
  assert.equal(profileFactsBlock(null), "");
  assert.equal(profileFactsBlock({ persona: "unknown" }), "");
  assert.equal(hasProfileSignal({ goals: ["Rücken stärken"] }), true);
  const block = profileFactsBlock(
    { persona: "cardio_focused", goals: ["Ausdauer"], owned: ["Laufband X"], budget: "mittel" },
    "Cardio / Gesundheit"
  );
  assert.match(block, /Persona: Cardio \/ Gesundheit/);
  assert.match(block, /Ziele: Ausdauer/);
  assert.match(block, /Besitzt: Laufband X/);
  assert.match(block, /Budget-Signal: mittel/);
  assert.doesNotMatch(block, /Niveau/);
  assert.match(profileFactsBlock({ goals: ["Endurance"] }, null, "en"), /Goals: Endurance/);
});

test("profileSteeringQuery uses goals, interests and next steps only", () => {
  assert.equal(profileSteeringQuery(null), null);
  assert.equal(profileSteeringQuery({ owned: ["Rack"] }), null);
  assert.equal(
    profileSteeringQuery({ goals: ["Kraft"], interests: ["Langhantel"], nextSteps: ["Hantelscheiben"] }),
    "Kraft. Langhantel. Hantelscheiben"
  );
});

test("blendRecommendationScore falls back to whichever signal exists", () => {
  assert.equal(blendRecommendationScore(null, null), 0);
  assert.equal(blendRecommendationScore(0.8, null), 0.8);
  assert.equal(blendRecommendationScore(null, 0.5), 0.5);
  assert.ok(Math.abs(blendRecommendationScore(1, 0.5) - 0.8) < 1e-9);
});

test("profileNeedsUpkeep: never checked, or activity after the last check", () => {
  assert.equal(profileNeedsUpkeep({ checkedAt: null, lastActivityAt: null }), true);
  assert.equal(profileNeedsUpkeep({ checkedAt: "2026-09-01T00:00:00Z", lastActivityAt: null }), false);
  assert.equal(
    profileNeedsUpkeep({ checkedAt: "2026-09-01T00:00:00Z", lastActivityAt: "2026-08-30T00:00:00Z" }),
    false
  );
  assert.equal(
    profileNeedsUpkeep({ checkedAt: "2026-09-01T00:00:00Z", lastActivityAt: "2026-09-02T00:00:00Z" }),
    true
  );
});

test("profileForPrompt joins the summary and the structured fields", async () => {
  const { profileForPrompt } = await import("./customer-profile-core.mjs");
  assert.equal(profileForPrompt(null, null), null);
  assert.equal(profileForPrompt("  Text  ", null), "Text");
  const both = profileForPrompt("Text", { goals: ["Kraft"] }, null);
  assert.match(both, /^Text\n\nAuf einen Blick:\n- Ziele: Kraft$/);
  assert.match(profileForPrompt("", { goals: ["Kraft"] }), /^Auf einen Blick:/);
});
