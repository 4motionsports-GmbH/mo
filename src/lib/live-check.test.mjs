import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CONFIGURATOR_NOTES_SCRIPT_MARKER,
  CONFIGURATOR_OLD_PATHS,
  CONFIGURATOR_PAGE_PATH,
  configuratorPageStatus,
  redirectsTo,
  themeAssetUrl,
  urlPath,
} from "./live-check.mjs";

test("the configurator's public path and the old one", () => {
  assert.equal(CONFIGURATOR_PAGE_PATH, "/pages/home-gym-konfigurator");
  assert.deepEqual([...CONFIGURATOR_OLD_PATHS], ["/pages/home-gym-konfigurator-1"]);
});

test("configuratorPageStatus: the section's dock and form markers, step 04", () => {
  const section = `<section class="ms-hgk"><form data-ms-hgk-form></form><div data-ms-chat-dock></div></section>`;
  assert.deepEqual(configuratorPageStatus(section), { configurator: true, dock: true, form: true, notes: false });
  // the section of 2026-10-27 prints the „Überspringen“ button of step 04
  const withNotes = section.replace("</form>", `<button type="button" data-ms-hgk-skip hidden>Überspringen</button></form>`);
  assert.deepEqual(configuratorPageStatus(withNotes), { configurator: true, dock: true, form: true, notes: true });
  // the old static guide (or any other page): neither marker
  assert.deepEqual(configuratorPageStatus(`<div id="shopify-block-ai_gen_block_296597c">Home gym guide</div>`), {
    configurator: false,
    dock: false,
    form: false,
    notes: false,
  });
  // half a section is not the configurator
  assert.equal(configuratorPageStatus(`<div data-ms-chat-dock></div>`).configurator, false);
  assert.equal(configuratorPageStatus(undefined).configurator, false);
});

test("themeAssetUrl: the page script Shopify serves, protocol-relative or absolute", () => {
  const html = `<script src="//www.motionsports.de/cdn/shop/t/12/assets/ms-home-gym-configurator.js?v=123&amp;x=1" defer></script>
    <link href="https://www.motionsports.de/cdn/shop/t/12/assets/ms-home-gym-configurator.css?v=9" rel="stylesheet">`;
  assert.equal(
    themeAssetUrl(html, "ms-home-gym-configurator.js"),
    "https://www.motionsports.de/cdn/shop/t/12/assets/ms-home-gym-configurator.js?v=123&x=1"
  );
  assert.equal(
    themeAssetUrl(html, "ms-home-gym-configurator.css", "http://localhost:5199"),
    "https://www.motionsports.de/cdn/shop/t/12/assets/ms-home-gym-configurator.css?v=9"
  );
  assert.equal(themeAssetUrl(`<script src="//localhost:5199/cdn/ms-home-gym-configurator.js"></script>`, "ms-home-gym-configurator.js", "http://localhost:5199"), "http://localhost:5199/cdn/ms-home-gym-configurator.js");
  // a different file whose name merely ends the same way is not it
  assert.equal(themeAssetUrl(`<script src="//x.de/assets/old-ms-home-gym-configurator.js"></script>`, "ms-home-gym-configurator.js"), null);
  assert.equal(themeAssetUrl("", "ms-home-gym-configurator.js"), null);
  assert.equal(CONFIGURATOR_NOTES_SCRIPT_MARKER, "configurator_note_step");
});

test("urlPath: path without query, hash and trailing slash", () => {
  assert.equal(urlPath("https://motionsports.de/pages/home-gym-konfigurator?partner=mh#x"), "/pages/home-gym-konfigurator");
  assert.equal(urlPath("/pages/home-gym-konfigurator/"), "/pages/home-gym-konfigurator");
  assert.equal(urlPath("https://www.motionsports.de/"), "/");
  assert.equal(urlPath(""), "");
  assert.equal(urlPath(null), "");
});

test("redirectsTo: a 301 to the configurator path, relative or absolute", () => {
  assert.equal(redirectsTo(301, "/pages/home-gym-konfigurator", CONFIGURATOR_PAGE_PATH), true);
  assert.equal(redirectsTo(301, "https://www.motionsports.de/pages/home-gym-konfigurator", CONFIGURATOR_PAGE_PATH), true);
  assert.equal(redirectsTo(302, "https://motionsports.de/pages/home-gym-konfigurator?x=1", CONFIGURATOR_PAGE_PATH), true);
  assert.equal(redirectsTo(301, "/pages/home-gym-konfigurator-1", CONFIGURATOR_PAGE_PATH), false);
  assert.equal(redirectsTo(200, "/pages/home-gym-konfigurator", CONFIGURATOR_PAGE_PATH), false);
  assert.equal(redirectsTo(404, null, CONFIGURATOR_PAGE_PATH), false);
});
