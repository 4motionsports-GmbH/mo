import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { KPI_RELEASES, NOTE_STEP_FROM, SIGNIN_OUTAGE, germanDay, noteStepCounted, releaseNotesFor, releasesInRange } from "./kpi-releases.mjs";
import { configuratorFunnel } from "./configurator-core.mjs";

test("release keys are unique and dates ascend", () => {
  const keys = KPI_RELEASES.map((r) => r.key);
  assert.equal(new Set(keys).size, keys.length);
  const dates = KPI_RELEASES.map((r) => r.date);
  assert.deepEqual([...dates].sort(), dates);
});

test("releases are ordered and dated as documented", () => {
  assert.deepEqual(KPI_RELEASES.map((r) => r.date), ["2026-10-01", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-05", "2026-10-05", "2026-10-05", "2026-10-05", "2026-10-06", "2026-10-06", "2026-10-06", "2026-10-06", "2026-10-06", "2026-10-06", "2026-10-08", "2026-10-21", "2026-10-21", "2026-10-22", "2026-10-24", "2026-10-24", "2026-10-28"]);
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
  assert.deepEqual(releasesInRange({ from: "2026-10-05", to: "2026-10-20" }).map((r) => r.key), [
    "attribution-unresolved",
    "attribution-window",
    "signedin-offer-off",
    "app-proxy-signin",
    "optin-measurement",
    "consent-benefits-served",
    "page-context-typed",
    "attribution-token-renewal",
    "doi-mail-sent",
    "consent-ask-suppressed",
    "attribution-threads-maillinks",
    "widget-reward-dormant",
  ]);
  assert.deepEqual(releasesInRange({ from: "2026-10-06", to: "2026-10-20" }).map((r) => r.key), [
    "consent-benefits-served",
    "page-context-typed",
    "attribution-token-renewal",
    "doi-mail-sent",
    "consent-ask-suppressed",
    "attribution-threads-maillinks",
    "widget-reward-dormant",
  ]);
  assert.deepEqual(releasesInRange({ from: "2026-10-07", to: "2026-10-20" }).map((r) => r.key), ["widget-reward-dormant"]);
  assert.deepEqual(releasesInRange({ from: "2026-10-09", to: "2026-10-20" }), []);
  assert.deepEqual(releasesInRange({ from: "2026-10-09", to: "2026-10-30" }).map((r) => r.key), [
    "home-gym-konfigurator",
    "attribution-variants-refunds",
    "konfigurator-personas",
    "konfigurator-schritt-fuer-schritt",
    "konfigurator-pflichtangaben-rabatt",
    "konfigurator-hinweise-regeln",
  ]);
  assert.deepEqual(releasesInRange({ from: "2026-10-24", to: "2026-10-30" }).map((r) => r.key), [
    "konfigurator-schritt-fuer-schritt",
    "konfigurator-pflichtangaben-rabatt",
    "konfigurator-hinweise-regeln",
  ]);
  assert.deepEqual(releasesInRange({ from: "2026-10-23", to: "2026-10-23" }), []);
  assert.deepEqual(releasesInRange({ from: "2026-10-25", to: "2026-10-26" }), []);
  assert.deepEqual(releasesInRange({ from: "2026-10-25", to: "2026-10-30" }).map((r) => r.key), ["konfigurator-hinweise-regeln"]);
  assert.deepEqual(releasesInRange({ from: "2026-10-28", to: "2026-10-30" }).map((r) => r.key), ["konfigurator-hinweise-regeln"]);
  assert.deepEqual(releasesInRange({ from: "2026-10-29", to: "2026-10-30" }), []);
  assert.deepEqual(releasesInRange({ from: "bad", to: "2026-10-30" }), []);
});

test("konfigurator: one 'meaningful from' note before the launch, none after", () => {
  const notes = releaseNotesFor("konfigurator", { from: "2026-09-22", to: "2026-10-21" });
  assert.equal(notes.length, 1);
  assert.match(notes[0], /^Erst ab dem 21\.10\.2026 aussagekräftig/);
  assert.deepEqual(releaseNotesFor("konfigurator", { from: "2026-10-21", to: "2026-11-19" }), []);
});

test("NOTE_STEP_FROM is the date of the release konfigurator-hinweise-regeln — one date to re-date", () => {
  const release = KPI_RELEASES.find((r) => r.key === "konfigurator-hinweise-regeln");
  assert.ok(release);
  assert.equal(NOTE_STEP_FROM, release.date);
  // derived, not a second literal: the module reads it from the release list
  const src = readFileSync(new URL("./kpi-releases.mjs", import.meta.url), "utf8");
  assert.match(src, /export const NOTE_STEP_FROM = releaseDay\("konfigurator-hinweise-regeln"\);/);
});

test("the Konfigurator funnel shows „Hinweise erreicht“ only for periods from NOTE_STEP_FROM on", () => {
  const counts = { viewed: 900, started: 300, handover: 200, chats: 190, plans: 150, carts: 40, orders: 5 };
  // what queryConfiguratorSummary passes: the stage's sessions only when the period starts on or after the day
  const funnel = (/** @type {{ from: string, to: string }} */ range, notes) =>
    configuratorFunnel({ ...counts, notes: noteStepCounted(range) ? notes : 0 }).stages.map((st) => st.key);
  // a 30-day period across the release: no stage (it would read „13 % weiter“, then „500 % weiter“)
  const across = { from: "2026-10-01", to: NOTE_STEP_FROM };
  assert.equal(noteStepCounted(across), false);
  assert.deepEqual(funnel(across, 40), ["started", "handover", "chats", "plans", "carts", "orders"]);
  // a period that starts on the day: the stage between started and handover
  const after = { from: NOTE_STEP_FROM, to: "2026-11-25" };
  assert.equal(noteStepCounted(after), true);
  assert.deepEqual(funnel(after, 40), ["started", "notes", "handover", "chats", "plans", "carts", "orders"]);
  // … and without any such sessions still none
  assert.deepEqual(funnel(after, 0), ["started", "handover", "chats", "plans", "carts", "orders"]);
  assert.equal(noteStepCounted({ from: "2026-12-01", to: "2026-12-30" }), true);
  assert.equal(noteStepCounted({ from: "x", to: "2026-12-30" }), false);
  assert.equal(noteStepCounted(null), false);
});
