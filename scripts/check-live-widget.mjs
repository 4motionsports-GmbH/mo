#!/usr/bin/env node
// Which widget build does the live storefront serve, and does the App Proxy
// answer? Read-only HTTP GETs against the public shop — no secrets, no cookies.
//
//   npm run verify:widget
//   npm run verify:widget -- --origin https://www.motionsports.de
//
// Checks (docs/frontend/07-feature-and-kpi-playbook.md §6.3, §6.4):
//   1. the home page's ms-chat-widget.js → marker counts → build (widget-fingerprint.mjs)
//   2. the head script `ms-chat-early-params` in layout/theme.liquid
//   3. /cart prints the CTA-hiding <style> (snippet of 8d0a0c4)
//   4. /apps/chat/whoami answers JSON (App Proxy set up) — without cookies the
//      answer is {"signedIn":false}; check signedIn:true in a browser signed in
//      to the shop.
// Exit code 0 only when every check passes: a build the backend switches may
// be flipped for, the head script, the /cart style, and no App Proxy answering
// a widget that cannot redeem the code. The App Proxy not being set up yet is
// not a failure. Shopify may serve the JS minified; the markers survive that.

import {
  CART_CTA_HIDING_STYLE,
  classifyWidgetBuild,
  containsLoosely,
  countWidgetMarkers,
  widgetAssetUrls,
  widgetRedeemsLinkCode,
  WIDGET_BUILDS,
} from "../src/lib/widget-fingerprint.mjs";

const args = process.argv.slice(2);
const argValue = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const origin = (argValue("--origin") ?? "https://www.motionsports.de").replace(/\/+$/, "");
const UA = "Mozilla/5.0 (Mo live check; +https://mo.motionsports.de)";

async function get(path) {
  const url = path.startsWith("http") ? path : `${origin}${path}`;
  try {
    const res = await fetch(url, { headers: { "user-agent": UA, accept: "*/*" }, redirect: "follow" });
    return { ok: res.ok, status: res.status, type: res.headers.get("content-type") ?? "", text: await res.text(), url };
  } catch (err) {
    return { ok: false, status: 0, type: "", text: "", url, error: String(err?.cause?.code ?? err?.message ?? err) };
  }
}

const line = (ok, label, detail = "") => console.log(`${ok === null ? "·" : ok ? "✔" : "✘"} ${label}${detail ? ` — ${detail}` : ""}`);

let pass = true;

console.log(`Live-Check ${origin}\n`);

// 1 + 2: home page → widget asset + head script
const home = await get("/");
if (!home.ok) {
  line(false, "Startseite", home.error ?? `HTTP ${home.status}`);
  process.exit(1);
}
const assets = widgetAssetUrls(home.text, origin);
const headScript = home.text.includes("ms-chat-early-params");
line(headScript, "Head-Skript ms-chat-early-params in layout/theme.liquid", headScript ? "" : "fehlt — ms_code/mo_c landen in Shopifys Analyse-URLs");
if (!headScript) pass = false;
if (!assets.js) {
  line(false, "ms-chat-widget.js auf der Startseite", "nicht gefunden (Snippet nicht eingebunden?)");
  process.exit(1);
}
const js = await get(assets.js);
if (!js.ok) {
  line(false, "ms-chat-widget.js laden", js.error ?? `HTTP ${js.status}`);
  process.exit(1);
}
const counts = countWidgetMarkers(js.text);
const build = classifyWidgetBuild(counts);
console.log(`\n  Asset: ${assets.js}\n  Größe: ${js.text.length} Zeichen`);
console.log("  Marker:", Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(", "));
if (build) {
  line(build.acceptable, `Widget-Build: ${build.label}`);
  console.log(`  → ${build.consequence}`);
  if (!build.acceptable) pass = false;
} else {
  line(false, "Widget-Build unbekannt", "keine Zeile der Tabelle passt — Marker von Hand vergleichen (07 §6.4)");
  pass = false;
}
const expected = WIDGET_BUILDS.find((b) => b.current);
if (expected && !build?.current) console.log(`  Erwartet: ${expected.label}`);

// 3: /cart CTA-hiding style
const cart = await get("/cart");
const cartStyle = cart.ok && containsLoosely(cart.text, CART_CTA_HIDING_STYLE);
line(cartStyle, "/cart blendet den Produktseiten-Knopf aus (Snippet 8d0a0c4)", cart.ok ? "" : cart.error ?? `HTTP ${cart.status}`);
if (!cartStyle) pass = false;

// 4: App Proxy
const sid = `livecheck-${Math.random().toString(36).slice(2, 10)}`;
const who = await get(`/apps/chat/whoami?session=${sid}`);
let whoJson = null;
try {
  whoJson = JSON.parse(who.text);
} catch {
  /* not JSON */
}
if (whoJson && typeof whoJson.signedIn === "boolean") {
  line(true, "App Proxy /apps/chat/whoami antwortet JSON", `signedIn=${whoJson.signedIn} (ohne Shop-Cookie erwartet: false)`);
  if (!widgetRedeemsLinkCode(counts)) {
    // A build without the one-time code treats a whoami answer as a sign-in (07 P0.3).
    line(false, "App Proxy ist an, aber dieses Widget löst den linkCode nicht ein", "App Proxy sofort abschalten, bis der richtige Build live ist");
    pass = false;
  }
} else {
  line(
    null,
    "App Proxy /apps/chat/whoami",
    `noch nicht eingerichtet (HTTP ${who.status}, ${who.type.split(";")[0] || "kein Content-Type"})`
  );
}

console.log(
  pass
    ? "\nOK: alle Prüfungen bestanden."
    : "\nAchtung: mindestens eine Prüfung ist fehlgeschlagen (✘) — Upload/Drift prüfen, bevor App Proxy oder Bestellstatus eingeschaltet werden."
);
process.exit(pass ? 0 : 1);
