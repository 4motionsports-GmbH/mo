import { test } from "node:test";
import assert from "node:assert/strict";
import { isUndefinedColumnError } from "./db-errors.mjs";

test("isUndefinedColumnError: SQLSTATE 42703 on the error or its cause", () => {
  assert.equal(isUndefinedColumnError({ code: "42703" }), true);
  assert.equal(isUndefinedColumnError({ cause: { code: "42703" } }), true);
  assert.equal(isUndefinedColumnError(Object.assign(new Error("column \"session_id\" does not exist"), { code: "42703" })), true);
});

test("isUndefinedColumnError: anything else is false", () => {
  for (const e of [null, undefined, "42703", {}, { code: "23505" }, { code: 42703 }, { cause: { code: "42P01" } }, new Error("x")]) {
    assert.equal(isUndefinedColumnError(e), false, String(e && JSON.stringify(e)));
  }
});
