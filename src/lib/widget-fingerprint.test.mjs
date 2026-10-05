import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CART_CTA_HIDING_STYLE,
  WIDGET_BUILDS,
  WIDGET_MARKERS,
  classifyWidgetBuild,
  containsLoosely,
  countWidgetMarkers,
  widgetAssetUrls,
  widgetRedeemsLinkCode,
} from "./widget-fingerprint.mjs";

// Marker counts measured on the theme repo's assets/ms-chat-widget.js at each
// commit (MarcelKueck/ms_shopify_clone): as committed (raw), after terser with
// comments and whitespace removed only (ws), and after terser with compress +
// mangle (min) — Shopify may minify ES5 theme JS when it serves it.
const MEASURED = {
  raw: {
    "3e87341": {"/api/chat": 8, "/api/auth/link": 2, "ms_mo_c": 1, "ms-chat-whoami-done": 1, "ms-chat-early-params": 1, "get_order_status": 7, "order_support": 3, "Bestellnummer + kurz": 1, "endSpeaking(": 10, "ms-chat-login-gate-snooze": 1, "ms-chat-mkt-decision": 1, "ms-mo-attr": 1, "/api/attribution/token": 2, "Rabattaktionen zuerst erfahren": 1},
    "8d0a0c4": {"/api/chat": 8, "/api/auth/link": 2, "ms_mo_c": 1, "ms-chat-whoami-done": 1, "ms-chat-early-params": 1, "get_order_status": 7, "order_support": 3, "Bestellnummer + kurz": 1, "endSpeaking(": 8, "ms-chat-login-gate-snooze": 1, "ms-chat-mkt-decision": 1, "ms-mo-attr": 1, "/api/attribution/token": 2, "Rabattaktionen zuerst erfahren": 1},
    "a0df103": {"/api/chat": 8, "/api/auth/link": 2, "ms_mo_c": 1, "ms-chat-whoami-done": 1, "ms-chat-early-params": 1, "get_order_status": 7, "endSpeaking(": 8, "ms-chat-login-gate-snooze": 1, "ms-chat-mkt-decision": 1, "ms-mo-attr": 1, "/api/attribution/token": 2, "Rabattaktionen zuerst erfahren": 1},
    "44a076b": {"/api/chat": 5, "endSpeaking(": 7, "ms-chat-login-gate-snooze": 1, "ms-chat-mkt-decision": 1, "ms-mo-attr": 1, "/api/attribution/token": 2, "Rabattaktionen zuerst erfahren": 1},
    "4dbc625": {"/api/chat": 5, "endSpeaking(": 7, "ms-chat-login-gate-snooze": 1, "ms-chat-mkt-decision": 1, "ms-mo-attr": 1, "/api/attribution/token": 2, "Rabattaktionen zuerst erfahren": 1},
    "beff918": {"/api/chat": 7, "endSpeaking(": 7, "ms-chat-mkt-decision": 1, "ms-mo-attr": 1, "/api/attribution/token": 2, "Rabattaktionen zuerst erfahren": 1},
    "e4b12f1": {"/api/chat": 5, "endSpeaking(": 7, "ms-mo-attr": 1, "/api/attribution/token": 2, "starter_shown": 2},
    "f7dc50a": {"/api/chat": 5, "endSpeaking(": 7, "starter_shown": 2},
  },
  ws: {
    "3e87341": {"/api/chat": 1, "/api/auth/link": 1, "ms_mo_c": 1, "ms-chat-whoami-done": 1, "ms-chat-early-params": 1, "get_order_status": 1, "order_support": 3, "Bestellnummer + kurz": 1, "endSpeaking(": 10, "ms-chat-login-gate-snooze": 1, "ms-chat-mkt-decision": 1, "ms-mo-attr": 1, "/api/attribution/token": 1, "Rabattaktionen zuerst erfahren": 1},
    "8d0a0c4": {"/api/chat": 1, "/api/auth/link": 1, "ms_mo_c": 1, "ms-chat-whoami-done": 1, "ms-chat-early-params": 1, "get_order_status": 1, "order_support": 3, "Bestellnummer + kurz": 1, "endSpeaking(": 8, "ms-chat-login-gate-snooze": 1, "ms-chat-mkt-decision": 1, "ms-mo-attr": 1, "/api/attribution/token": 1, "Rabattaktionen zuerst erfahren": 1},
    "a0df103": {"/api/chat": 1, "/api/auth/link": 1, "ms_mo_c": 1, "ms-chat-whoami-done": 1, "ms-chat-early-params": 1, "get_order_status": 1, "endSpeaking(": 8, "ms-chat-login-gate-snooze": 1, "ms-chat-mkt-decision": 1, "ms-mo-attr": 1, "/api/attribution/token": 1, "Rabattaktionen zuerst erfahren": 1},
    "44a076b": {"/api/chat": 1, "endSpeaking(": 7, "ms-chat-login-gate-snooze": 1, "ms-chat-mkt-decision": 1, "ms-mo-attr": 1, "/api/attribution/token": 1, "Rabattaktionen zuerst erfahren": 1},
    "4dbc625": {"/api/chat": 1, "endSpeaking(": 7, "ms-chat-login-gate-snooze": 1, "ms-chat-mkt-decision": 1, "ms-mo-attr": 1, "/api/attribution/token": 1, "Rabattaktionen zuerst erfahren": 1},
    "beff918": {"/api/chat": 2, "endSpeaking(": 7, "ms-chat-mkt-decision": 1, "ms-mo-attr": 1, "/api/attribution/token": 1, "Rabattaktionen zuerst erfahren": 1},
    "e4b12f1": {"/api/chat": 1, "endSpeaking(": 7, "ms-mo-attr": 1, "/api/attribution/token": 1, "starter_shown": 1},
    "f7dc50a": {"/api/chat": 1, "endSpeaking(": 7, "starter_shown": 1},
  },
  min: {
    "3e87341": {"/api/chat": 1, "/api/auth/link": 1, "ms_mo_c": 1, "ms-chat-whoami-done": 1, "ms-chat-early-params": 1, "get_order_status": 1, "order_support": 3, "Bestellnummer + kurz": 1, "ms-chat-login-gate-snooze": 1, "ms-chat-mkt-decision": 1, "ms-mo-attr": 1, "/api/attribution/token": 1, "Rabattaktionen zuerst erfahren": 1},
    "8d0a0c4": {"/api/chat": 1, "/api/auth/link": 1, "ms_mo_c": 1, "ms-chat-whoami-done": 1, "ms-chat-early-params": 1, "get_order_status": 1, "order_support": 3, "Bestellnummer + kurz": 1, "ms-chat-login-gate-snooze": 1, "ms-chat-mkt-decision": 1, "ms-mo-attr": 1, "/api/attribution/token": 1, "Rabattaktionen zuerst erfahren": 1},
    "a0df103": {"/api/chat": 1, "/api/auth/link": 1, "ms_mo_c": 1, "ms-chat-whoami-done": 1, "ms-chat-early-params": 1, "get_order_status": 1, "ms-chat-login-gate-snooze": 1, "ms-chat-mkt-decision": 1, "ms-mo-attr": 1, "/api/attribution/token": 1, "Rabattaktionen zuerst erfahren": 1},
    "44a076b": {"/api/chat": 1, "ms-chat-login-gate-snooze": 1, "ms-chat-mkt-decision": 1, "ms-mo-attr": 1, "/api/attribution/token": 1, "Rabattaktionen zuerst erfahren": 1},
    "4dbc625": {"/api/chat": 1, "ms-chat-login-gate-snooze": 1, "ms-chat-mkt-decision": 1, "ms-mo-attr": 1, "/api/attribution/token": 1, "Rabattaktionen zuerst erfahren": 1},
    "beff918": {"/api/chat": 2, "ms-chat-mkt-decision": 1, "ms-mo-attr": 1, "/api/attribution/token": 1, "Rabattaktionen zuerst erfahren": 1},
    "e4b12f1": {"/api/chat": 1, "ms-mo-attr": 1, "/api/attribution/token": 1, "starter_shown": 1},
    "f7dc50a": {"/api/chat": 1, "starter_shown": 1},
  },
};

const EXPECTED = {
  raw: { "3e87341": "main-2026-10-04", "8d0a0c4": "fixes-8d0a0c4" },
  ws: { "3e87341": "main-2026-10-04", "8d0a0c4": "fixes-8d0a0c4" },
  min: { "3e87341": "fixes-minified", "8d0a0c4": "fixes-minified" },
};
const OLDER = {
  a0df103: "pr73",
  "44a076b": "popup-2026-10-01",
  "4dbc625": "popup-2026-10-01",
  beff918: "restore-2026-10-01",
  e4b12f1: "drift-2026-08-12",
  f7dc50a: "pre-2026-08-12",
};

test("every measured build is recognised, raw and minified", () => {
  for (const variant of ["raw", "ws", "min"]) {
    for (const [commit, key] of Object.entries({ ...EXPECTED[variant], ...OLDER })) {
      assert.equal(classifyWidgetBuild(MEASURED[variant][commit])?.key, key, `${variant} ${commit}`);
    }
  }
});

test("the live-safe builds are exactly the ones that redeem the code", () => {
  for (const variant of ["raw", "ws", "min"]) {
    for (const [commit, counts] of Object.entries(MEASURED[variant])) {
      const b = classifyWidgetBuild(counts);
      assert.equal(Boolean(b?.acceptable), widgetRedeemsLinkCode(counts), `${variant} ${commit}`);
    }
  }
  assert.deepEqual(WIDGET_BUILDS.filter((b) => b.current).map((b) => b.key), ["main-2026-10-04", "fixes-minified"]);
});

test("a half-applied set or a non-widget file is never passed off as a known build", () => {
  assert.equal(classifyWidgetBuild({ ...MEASURED.raw.a0df103, order_support: 3 }), null);
  assert.equal(classifyWidgetBuild({ "/api/chat": 1, "/api/auth/link": 1 }), null);
  assert.equal(classifyWidgetBuild({ "/api/chat": 1, "ms-mo-attr": 1 }), null);
  assert.equal(classifyWidgetBuild(countWidgetMarkers("<html>Not found</html>")), null);
  assert.equal(classifyWidgetBuild({}), null);
});

test("countWidgetMarkers ignores whitespace and counts every marker", () => {
  const js = `fetch("/api/chat");fetch( "/api/auth/link" );var a="order_support",b='order_support';
    var p = "Bestellnummer  +\n kurz dein Anliegen…"; endSpeaking (); endSpeaking();`;
  const c = countWidgetMarkers(js);
  assert.deepEqual(Object.keys(c), [...WIDGET_MARKERS]);
  assert.equal(c["/api/chat"], 1);
  assert.equal(c["/api/auth/link"], 1);
  assert.equal(c.order_support, 2);
  assert.equal(c["Bestellnummer + kurz"], 1);
  assert.equal(c["endSpeaking("], 2);
  assert.equal(c.ms_mo_c, 0);
  assert.equal(countWidgetMarkers(null)["/api/chat"], 0);
});

test("widgetAssetUrls finds the asset_url output of the snippet", () => {
  const html = `<link href="//www.motionsports.de/cdn/shop/t/12/assets/ms-chat-widget.css?v=1234" rel="stylesheet">
    <script src="//www.motionsports.de/cdn/shop/t/12/assets/ms-chat-widget.js?v=5678&amp;x=1" defer></script>`;
  assert.deepEqual(widgetAssetUrls(html, "https://www.motionsports.de"), {
    js: "https://www.motionsports.de/cdn/shop/t/12/assets/ms-chat-widget.js?v=5678&x=1",
    css: "https://www.motionsports.de/cdn/shop/t/12/assets/ms-chat-widget.css?v=1234",
  });
  assert.equal(
    widgetAssetUrls(`<script src="https://cdn.shopify.com/s/files/1/0/t/3/assets/ms-chat-widget.js?v=9"></script>`, "https://x.de").js,
    "https://cdn.shopify.com/s/files/1/0/t/3/assets/ms-chat-widget.js?v=9"
  );
  assert.deepEqual(widgetAssetUrls("<html></html>", "https://www.motionsports.de"), { js: null, css: null });
});

test("containsLoosely finds the cart style with any whitespace", () => {
  assert.equal(containsLoosely("<style>.ms-chat-product-advisor,.ms-chat-product-cta{display:none!important;}</style>", CART_CTA_HIDING_STYLE), true);
  assert.equal(containsLoosely("<style>.ms-chat-product-cta{display:none}</style>", CART_CTA_HIDING_STYLE), false);
  assert.equal(containsLoosely(null, CART_CTA_HIDING_STYLE), false);
});

test("the upload with the tasks of 2026-10-05 is recognised only when complete", () => {
  const base = { ...MEASURED.raw["3e87341"], "Rabattaktionen zuerst erfahren": 0 };
  const full = { ...base, "ms-chat-ctx-last": 1, "ms-chat-optin-benefits": 2 };
  assert.equal(classifyWidgetBuild(full)?.key, "tasks-2026-10-05");
  assert.equal(classifyWidgetBuild({ ...MEASURED.min["3e87341"], "Rabattaktionen zuerst erfahren": 0, "ms-chat-ctx-last": 1, "ms-chat-optin-benefits": 1 })?.key, "tasks-2026-10-05");
  // Half-applied: one marker missing, or the old bullet still in the file.
  assert.equal(classifyWidgetBuild({ ...base, "ms-chat-ctx-last": 1 }), null);
  assert.equal(classifyWidgetBuild({ ...full, "Rabattaktionen zuerst erfahren": 1 }), null);
  assert.equal(WIDGET_BUILDS.find((b) => b.key === "tasks-2026-10-05")?.acceptable, true);
});
