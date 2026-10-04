import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CART_CTA_HIDING_STYLE,
  WIDGET_BUILDS,
  WIDGET_MARKERS,
  classifyWidgetBuild,
  countWidgetMarkers,
  widgetAssetUrls,
} from "./widget-fingerprint.mjs";

// Marker counts measured on the theme repo's assets/ms-chat-widget.js at each
// commit (MarcelKueck/ms_shopify_clone), so the rules match the real files.
const MEASURED = {
  "3e87341": { redeemLinkCode: 4, captureCampaignToken: 4, "ms-chat-early-params": 1, order_support: 3, "Bestellnummer + kurz": 1, "sessionId: sid": 3, "abortActiveStream()": 3, "stop any audio still queued": 1, presentLoginGate: 4, moStampCart: 3, handleMoDeepLink: 3, "ms-mo-attr": 1, "ms-chat-whoami-done": 1 },
  "8d0a0c4": { redeemLinkCode: 4, captureCampaignToken: 4, "ms-chat-early-params": 1, order_support: 3, "Bestellnummer + kurz": 1, "sessionId: sid": 3, "abortActiveStream()": 3, presentLoginGate: 4, moStampCart: 3, handleMoDeepLink: 3, "ms-mo-attr": 1, "ms-chat-whoami-done": 1 },
  a0df103: { redeemLinkCode: 4, captureCampaignToken: 4, "ms-chat-early-params": 1, "sessionId: sid": 2, "abortActiveStream()": 1, presentLoginGate: 4, moStampCart: 3, handleMoDeepLink: 3, "ms-mo-attr": 1, "ms-chat-whoami-done": 1 },
  "44a076b": { "sessionId: sid": 2, presentLoginGate: 4, moStampCart: 3, handleMoDeepLink: 2, "ms-mo-attr": 1 },
  beff918: { "sessionId: sid": 2, moStampCart: 3, handleMoDeepLink: 2, "ms-mo-attr": 1 },
  e4b12f1: { "sessionId: sid": 2, moStampCart: 3, starter_shown: 2, "ms-mo-attr": 1 },
  f7dc50a: { "sessionId: sid": 2, starter_shown: 2 },
};

test("every measured build is recognised as the documented row", () => {
  const expected = {
    "3e87341": "main-2026-10-04",
    "8d0a0c4": "fixes-8d0a0c4",
    a0df103: "pr73",
    "44a076b": "popup-2026-10-01",
    beff918: "restore-2026-10-01",
    e4b12f1: "drift-2026-08-12",
    f7dc50a: "pre-2026-08-12",
  };
  for (const [commit, key] of Object.entries(expected)) {
    assert.equal(classifyWidgetBuild(MEASURED[commit])?.key, key, commit);
  }
  assert.equal(WIDGET_BUILDS.filter((b) => b.current).map((b) => b.commit).join(), "3e87341");
});

test("a half-applied fix set is not passed off as a known build", () => {
  assert.equal(classifyWidgetBuild({ ...MEASURED.a0df103, order_support: 3 }), null);
  assert.equal(classifyWidgetBuild({ redeemLinkCode: 1 }), null);
  assert.equal(classifyWidgetBuild({ moStampCart: 1 }), null);
  // Not the widget at all (an error page): never "older than 2026-08-12".
  assert.equal(classifyWidgetBuild(countWidgetMarkers("<html>Not found</html>")), null);
});

test("countWidgetMarkers counts non-overlapping occurrences of every marker", () => {
  const js = `function x(){ abortActiveStream(); abortActiveStream(); } // order_support order_support
    post({ sessionId: sid }); redeemLinkCode(); "Bestellnummer + kurz dein Anliegen…"`;
  const c = countWidgetMarkers(js);
  assert.deepEqual(Object.keys(c), [...WIDGET_MARKERS]);
  assert.equal(c["abortActiveStream()"], 2);
  assert.equal(c.order_support, 2);
  assert.equal(c["sessionId: sid"], 1);
  assert.equal(c.redeemLinkCode, 1);
  assert.equal(c["Bestellnummer + kurz"], 1);
  assert.equal(c.presentLoginGate, 0);
  assert.equal(countWidgetMarkers(null).redeemLinkCode, 0);
});

test("widgetAssetUrls finds the asset_url output of the snippet", () => {
  const html = `<link href="//www.motionsports.de/cdn/shop/t/12/assets/ms-chat-widget.css?v=1234" rel="stylesheet">
    <script src="//www.motionsports.de/cdn/shop/t/12/assets/ms-chat-widget.js?v=5678&amp;x=1" defer></script>`;
  assert.deepEqual(widgetAssetUrls(html, "https://www.motionsports.de"), {
    js: "https://www.motionsports.de/cdn/shop/t/12/assets/ms-chat-widget.js?v=5678&x=1",
    css: "https://www.motionsports.de/cdn/shop/t/12/assets/ms-chat-widget.css?v=1234",
  });
  assert.deepEqual(widgetAssetUrls("<html></html>", "https://www.motionsports.de"), { js: null, css: null });
  assert.ok(CART_CTA_HIDING_STYLE.includes("display: none !important"));
});
