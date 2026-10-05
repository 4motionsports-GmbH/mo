import { test } from "node:test";
import assert from "node:assert/strict";
import { KPI_RELEASES, SIGNIN_OUTAGE, germanDay, releaseNotesFor, releasesInRange } from "./kpi-releases.mjs";

test("release keys are unique and dates ascend", () => {
  const keys = KPI_RELEASES.map((r) => r.key);
  assert.equal(new Set(keys).size, keys.length);
  const dates = KPI_RELEASES.map((r) => r.date);
  assert.deepEqual([...dates].sort(), dates);
});

test("releases are ordered and dated as documented", () => {
  assert.deepEqual(KPI_RELEASES.map((r) => r.date), ["2026-10-01", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-05", "2026-10-05", "2026-10-05", "2026-10-05"]);
  assert.deepEqual(SIGNIN_OUTAGE, { from: "2026-10-03", to: "2026-10-04" });
  assert.equal(germanDay("2026-10-04"), "04.10.2026");
});

test("a 30-day period across the releases annotates every affected section", () => {
  const range = { from: "2026-09-05", to: "2026-10-04" };
  const popup = releaseNotesFor("anmelde-popup", range);
  assert.equal(popup.length, 2);
  assert.match(popup[0], /^Erst ab dem 04\.10\.2026 aussagekräftig/);
  assert.match(popup[1], /Vom 03\.10\.2026 bis zum Widget-Upload am 04\.10\.2026/);
  assert.equal(releaseNotesFor("consent", range).length, 3);
  assert.match(releaseNotesFor("consent", range)[1], /Ergebnis und Quelle der Opt-ins erst ab dem 05\.10\.2026/);
  assert.equal(releaseNotesFor("capture", range).length, 1);
  assert.equal(releaseNotesFor("konto", range).length, 2);
  // Campaigns: only the mo_c note, no sign-in outage.
  const campaign = releaseNotesFor("campaign", range);
  assert.equal(campaign.length, 1);
  assert.match(campaign[0], /mo_c/);
});

test("a period starting on the upload day needs no 'meaningful from' note, but still covers the outage day", () => {
  const notes = releaseNotesFor("anmelde-popup", { from: "2026-10-04", to: "2026-10-10" });
  assert.equal(notes.length, 1);
  assert.match(notes[0], /konnte sich niemand im Chat anmelden/);
});

test("a period entirely after the releases has no notes", () => {
  for (const s of ["anmelde-popup", "consent", "konto", "campaign", "attribution", "capture"]) {
    assert.deepEqual(releaseNotesFor(s, { from: "2026-10-05", to: "2026-11-03" }), []);
  }
});

test("attribution: one 'meaningful from' note before the window switch, no sign-in outage note", () => {
  const notes = releaseNotesFor("attribution", { from: "2026-09-06", to: "2026-10-05" });
  assert.equal(notes.length, 1);
  assert.match(notes[0], /^Erst ab dem 05\.10\.2026/);
  assert.match(notes[0], /Direkt/);
});

test("unknown sections and invalid ranges stay silent", () => {
  assert.deepEqual(releaseNotesFor("core", { from: "2026-09-01", to: "2026-10-04" }), []);
  assert.deepEqual(releaseNotesFor("anmelde-popup", { from: "x", to: "2026-10-04" }), []);
  assert.deepEqual(releaseNotesFor("anmelde-popup", /** @type {any} */ (null)), []);
});

test("releasesInRange is inclusive on both ends", () => {
  assert.deepEqual(releasesInRange({ from: "2026-10-01", to: "2026-10-03" }).map((r) => r.key), ["widget-popups", "signin-code"]);
  assert.deepEqual(releasesInRange({ from: "2026-10-04", to: "2026-10-04" }).map((r) => r.key), ["customer-platform-widget"]);
  assert.deepEqual(releasesInRange({ from: "2026-10-05", to: "2026-10-30" }).map((r) => r.key), [
    "attribution-unresolved",
    "attribution-window",
    "signedin-offer-off",
    "app-proxy-signin",
    "optin-measurement",
  ]);
  assert.deepEqual(releasesInRange({ from: "2026-10-06", to: "2026-10-30" }), []);
  assert.deepEqual(releasesInRange({ from: "bad", to: "2026-10-30" }), []);
});
