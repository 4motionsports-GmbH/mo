import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CONFIGURATOR_OLD_PATHS,
  CONFIGURATOR_PAGE_PATH,
  configuratorPageStatus,
  redirectsTo,
  urlPath,
} from "./live-check.mjs";

test("the configurator's public path and the old one", () => {
  assert.equal(CONFIGURATOR_PAGE_PATH, "/pages/home-gym-konfigurator");
  assert.deepEqual([...CONFIGURATOR_OLD_PATHS], ["/pages/home-gym-konfigurator-1"]);
});

test("configuratorPageStatus: the section's dock and form markers", () => {
  const section = `<section class="ms-hgk"><form data-ms-hgk-form></form><div data-ms-chat-dock></div></section>`;
  assert.deepEqual(configuratorPageStatus(section), { configurator: true, dock: true, form: true });
  // the old static guide (or any other page): neither marker
  assert.deepEqual(configuratorPageStatus(`<div id="shopify-block-ai_gen_block_296597c">Home gym guide</div>`), {
    configurator: false,
    dock: false,
    form: false,
  });
  // half a section is not the configurator
  assert.equal(configuratorPageStatus(`<div data-ms-chat-dock></div>`).configurator, false);
  assert.equal(configuratorPageStatus(undefined).configurator, false);
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
