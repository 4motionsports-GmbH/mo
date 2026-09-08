import { test } from "node:test";
import assert from "node:assert/strict";
import { ADMIN_HOME, safeAdminNext } from "./admin-login-redirect.mjs";

test("safeAdminNext accepts admin paths with query strings", () => {
  assert.equal(safeAdminNext("/admin"), "/admin");
  assert.equal(safeAdminNext("/admin?tab=kampagne"), "/admin?tab=kampagne");
  assert.equal(safeAdminNext("/admin/kunden/42?x=1"), "/admin/kunden/42?x=1");
});

test("safeAdminNext rejects anything that could leave /admin", () => {
  for (const bad of [
    undefined,
    null,
    "",
    "   ",
    "https://evil.example/admin",
    "//evil.example/admin",
    "/adminx",
    "/api/admin/export",
    "/",
    "/admin\\@evil.example",
    "/admin?x= y",
    "/admin/login",
    "/admin/login?error=invalid",
    "javascript:alert(1)",
    "/admin?" + "a".repeat(600),
  ]) {
    assert.equal(safeAdminNext(bad), ADMIN_HOME, `should reject ${String(bad).slice(0, 40)}`);
  }
});
