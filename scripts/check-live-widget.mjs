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
//   5. the Home-Gym-Konfigurator is served under its public URL
//      /pages/home-gym-konfigurator (live-check.mjs; `--configurator-path` to
//      check another path), with step 04 „Deine Hinweise“ of 2026-10-27 in the
//      section and the page script, and the old /pages/home-gym-konfigurator-1
//      redirects there (a missing step 04 or redirect is a hint, not a failure).
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
import {
  CONFIGURATOR_NOTES_SCRIPT_MARKER,
  CONFIGURATOR_OLD_PATHS,
  CONFIGURATOR_PAGE_PATH,
  configuratorPageStatus,
  redirectsTo,
  themeAssetUrl,
  urlPath,
} from "../src/lib/live-check.mjs";

const args = process.argv.slice(2);
const argValue = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const origin = (argValue("--origin") ?? "https://www.motionsports.de").replace(/\/+$/, "");
const UA = "Mozilla/5.0 (Mo live check; +https://mo.motionsports.de)";

async function get(path, { redirect = "follow" } = {}) {
  const url = path.startsWith("http") ? path : `${origin}${path}`;
  try {
    const res = await fetch(url, { headers: { "user-agent": UA, accept: "*/*" }, redirect });
    return {
      ok: res.ok,
      status: res.status,
      type: res.headers.get("content-type") ?? "",
      location: res.headers.get("location"),
      text: redirect === "manual" ? "" : await res.text(),
      url,
      finalUrl: res.url || url,
    };
  } catch (err) {
    return { ok: false, status: 0, type: "", location: null, text: "", url, finalUrl: url, error: String(err?.cause?.code ?? err?.message ?? err) };
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

// 5: the configurator under its public URL (and the old one redirecting there)
const configuratorPath = argValue("--configurator-path") ?? CONFIGURATOR_PAGE_PATH;
const cfgPage = await get(configuratorPath);
const cfgStatus = configuratorPageStatus(cfgPage.text);
const cfgFinalPath = urlPath(cfgPage.finalUrl, origin);
const cfgAtPath = cfgPage.ok && cfgFinalPath === urlPath(configuratorPath, origin);
if (cfgAtPath && cfgStatus.configurator) {
  line(true, `Konfigurator unter ${configuratorPath}`);
  // The round of 2026-10-27: step 04 „Deine Hinweise“ needs the section AND
  // the page script of that upload (a hint, not a failure).
  const pageJsUrl = themeAssetUrl(cfgPage.text, "ms-home-gym-configurator.js", origin);
  const pageJs = pageJsUrl ? await get(pageJsUrl) : null;
  const scriptNotes = Boolean(pageJs?.ok && pageJs.text.includes(CONFIGURATOR_NOTES_SCRIPT_MARKER));
  if (cfgStatus.notes && scriptNotes) {
    line(true, "Konfigurator mit Schritt 04 „Deine Hinweise“ (Abschnitt und Seiten-Skript vom 27.10.)");
  } else {
    const missing = [
      cfgStatus.notes ? null : "Abschnitt sections/ms-home-gym-configurator.liquid noch alt",
      scriptNotes
        ? null
        : pageJsUrl
          ? "Seiten-Skript assets/ms-home-gym-configurator.js noch alt"
          : "Seiten-Skript ms-home-gym-configurator.js nicht gefunden",
    ].filter(Boolean);
    line(null, "Konfigurator ohne Schritt 04 „Deine Hinweise“", `${missing.join(", ")} — Dateien aus MANIFEST.md (Eintrag 2026-10-27) hochladen`);
  }
} else {
  line(
    false,
    `Konfigurator unter ${configuratorPath}`,
    !cfgPage.ok
      ? cfgPage.error ?? `HTTP ${cfgPage.status}`
      : !cfgAtPath
        ? `leitet weiter nach ${cfgFinalPath} — die Seite mit der Vorlage „home-gym-mo“ muss diesen Handle haben`
        : "die Seite zeigt nicht den Konfigurator (alte Vorlage? Seite muss die Vorlage „home-gym-mo“ nutzen)"
  );
  pass = false;
}
for (const oldPath of CONFIGURATOR_OLD_PATHS) {
  if (urlPath(oldPath, origin) === urlPath(configuratorPath, origin)) continue;
  const old = await get(oldPath, { redirect: "manual" });
  if (redirectsTo(old.status, old.location, configuratorPath, origin)) {
    line(true, `${oldPath} leitet auf ${configuratorPath} weiter`, `HTTP ${old.status}`);
  } else {
    line(
      null,
      `${oldPath}`,
      old.status === 404
        ? `antwortet 404 — Weiterleitung einrichten (Shopify → Navigation → URL-Weiterleitungen: ${oldPath} → ${configuratorPath})`
        : `HTTP ${old.status}${old.location ? ` → ${urlPath(old.location, origin)}` : ""} (erwartet: 301 → ${configuratorPath})`
    );
  }
}

console.log(
  pass
    ? "\nOK: alle Prüfungen bestanden."
    : "\nAchtung: mindestens eine Prüfung ist fehlgeschlagen (✘) — Upload/Drift prüfen, bevor App Proxy oder Bestellstatus eingeschaltet werden."
);
process.exit(pass ? 0 : 1);
