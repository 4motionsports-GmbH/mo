import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ADMIN_TABS,
  ADMIN_TAB_GROUPS,
  ADMIN_TAB_KEYS,
  adminTabForShortcut,
  adminTabHref,
  adminTabMeta,
  parseAdminTab,
} from "./admin-tabs.mjs";

test("registry has ten screens with unique keys, labels and shortcuts", () => {
  assert.equal(ADMIN_TABS.length, 10);
  assert.equal(new Set(ADMIN_TAB_KEYS).size, 10);
  assert.equal(new Set(ADMIN_TABS.map((t) => t.label)).size, 10);
  assert.equal(new Set(ADMIN_TABS.map((t) => t.shortcut)).size, 10);
  for (const t of ADMIN_TABS) {
    assert.ok(ADMIN_TAB_GROUPS.includes(t.group), `${t.key} has a known group`);
    assert.ok(t.description.length > 10, `${t.key} has a description`);
  }
});

test("every legacy tab key still resolves", () => {
  for (const key of [
    "overview",
    "kunden",
    "kampagne",
    "kpi",
    "feedback",
    "gespraeche",
    "wissen",
    "analyse",
    "verbesserung",
    "einstellungen",
  ]) {
    assert.equal(parseAdminTab(key), key);
  }
});

test("parseAdminTab handles aliases, arrays, casing and junk", () => {
  assert.equal(parseAdminTab("customers"), "kunden");
  assert.equal(parseAdminTab("marketing"), "kunden");
  assert.equal(parseAdminTab(["kpi", "x"]), "kpi");
  assert.equal(parseAdminTab(" KPI "), "kpi");
  assert.equal(parseAdminTab(undefined), "overview");
  assert.equal(parseAdminTab(""), "overview");
  assert.equal(parseAdminTab("nope"), "overview");
  assert.equal(parseAdminTab(42), "overview");
});

test("adminTabHref keeps the historical URL contract", () => {
  assert.equal(adminTabHref("overview"), "/admin");
  assert.equal(adminTabHref("kunden"), "/admin?tab=kunden");
  assert.equal(adminTabHref("kunden", { filter: "no_purchase" }), "/admin?tab=kunden&filter=no_purchase");
  assert.equal(adminTabHref("overview", { x: "" }), "/admin");
  assert.equal(adminTabHref("kpi", { kpiRange: "7d", kpiFrom: undefined }), "/admin?tab=kpi&kpiRange=7d");
});

test("shortcuts map 1…9 and 0 in display order", () => {
  assert.equal(adminTabForShortcut("1"), "overview");
  assert.equal(adminTabForShortcut("0"), "einstellungen");
  assert.equal(adminTabForShortcut("x"), null);
  assert.equal(adminTabMeta("kampagne").wide, true);
  assert.equal(adminTabMeta("feedback").group, "Einblicke");
});
