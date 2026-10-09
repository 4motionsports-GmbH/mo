import { test } from "node:test";
import assert from "node:assert/strict";
import { isWelcomeCode, parseWelcomeCodeMatch, welcomeCodeLikePatterns } from "./welcome-code-match.mjs";

test("empty or unset → disabled, nothing matches", () => {
  for (const raw of [undefined, null, "", "  ", ",", " , ", 42]) {
    const m = parseWelcomeCodeMatch(raw);
    assert.equal(m.enabled, false, String(raw));
    assert.equal(isWelcomeCode("WELCOME5", m), false);
  }
});

test("exact codes and prefixes, case-insensitive", () => {
  const m = parseWelcomeCodeMatch(" welcome5 , WILLKOMMEN-* ,Newsletter5");
  assert.deepEqual(m, { enabled: true, exact: ["WELCOME5", "NEWSLETTER5"], prefixes: ["WILLKOMMEN-"] });
  assert.equal(isWelcomeCode("WELCOME5", m), true);
  assert.equal(isWelcomeCode(" Welcome5 ", m), true);
  assert.equal(isWelcomeCode("WELCOME50", m), false);
  assert.equal(isWelcomeCode("willkommen-a1b2c3", m), true);
  assert.equal(isWelcomeCode("WILLKOMMEN", m), false);
  assert.equal(isWelcomeCode("newsletter5", m), true);
  assert.equal(isWelcomeCode("", m), false);
  assert.equal(isWelcomeCode(null, m), false);
});

test("a lone * or an inner * never matches everything", () => {
  const m = parseWelcomeCodeMatch("*, WEL*COME, **, ok*");
  assert.deepEqual(m, { enabled: true, exact: [], prefixes: ["OK"] });
  assert.equal(parseWelcomeCodeMatch("*").enabled, false);
});

test("duplicates collapse; overlong entries and entries beyond 20 are ignored", () => {
  assert.deepEqual(parseWelcomeCodeMatch("A,a,A").exact, ["A"]);
  assert.equal(parseWelcomeCodeMatch("X".repeat(65)).enabled, false);
  const many = Array.from({ length: 25 }, (_, i) => `C${i}`).join(",");
  assert.equal(parseWelcomeCodeMatch(many).exact.length, 20);
});

test("LIKE patterns escape %, _ and backslash", () => {
  const m = parseWelcomeCodeMatch("WEL_COME*,100%*,A\\B*");
  assert.deepEqual(welcomeCodeLikePatterns(m), ["WEL\\_COME%", "100\\%%", "A\\\\B%"]);
  assert.deepEqual(welcomeCodeLikePatterns(parseWelcomeCodeMatch("")), []);
});
