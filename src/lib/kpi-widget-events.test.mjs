import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ACCOUNT_SIGNIN_RETURN,
  ACCOUNT_SIGNIN_STARTED,
  DISCONTINUED_WIDGET_EVENTS,
  LOGIN_GATE_DECLINED,
  LOGIN_GATE_DISMISSED,
  LOGIN_GATE_SHOWN,
  LOGIN_GATE_SIGNIN_CLICKED,
  RETIRED_CONSENT_GATE_SURFACES,
  discontinuedWidgetEvent,
  loginGateRates,
  signinSource,
} from "./kpi-widget-events.mjs";
import { CART_PATTERNS, CTA_PATTERNS } from "./kpi-event-patterns.mjs";

test("the widget's 2026-10-01 event names, exactly as it sends them", () => {
  assert.equal(LOGIN_GATE_SHOWN, "login_gate_shown");
  assert.equal(LOGIN_GATE_SIGNIN_CLICKED, "login_gate_signin_clicked");
  assert.equal(LOGIN_GATE_DECLINED, "login_gate_declined");
  assert.equal(LOGIN_GATE_DISMISSED, "login_gate_dismissed");
  assert.equal(ACCOUNT_SIGNIN_STARTED, "account_signin_started");
  assert.equal(ACCOUNT_SIGNIN_RETURN, "account_signin_return");
});

/** SQL ILIKE → RegExp, to check the headline click signals stay clean. */
const like = (p) => new RegExp(`^${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*")}$`, "i");

test("no new event counts as a product click or a cart click", () => {
  const names = [
    LOGIN_GATE_SHOWN,
    LOGIN_GATE_SIGNIN_CLICKED,
    LOGIN_GATE_DECLINED,
    LOGIN_GATE_DISMISSED,
    ACCOUNT_SIGNIN_STARTED,
    ACCOUNT_SIGNIN_RETURN,
    "consent_gate_shown",
    "consent_gate_accepted",
    "account_signin_linked",
    "account_signin_link_refused",
  ];
  for (const name of names) {
    for (const p of [...CTA_PATTERNS, ...CART_PATTERNS]) {
      assert.equal(like(p).test(name), false, `${name} must not match ${p}`);
    }
  }
});

test("signinSource: only the popup counts as login_gate", () => {
  assert.equal(signinSource("login_gate"), "login_gate");
  assert.equal(signinSource(undefined), "other");
  assert.equal(signinSource(""), "other");
  assert.equal(signinSource("welcome"), "other");
  assert.equal(signinSource({}), "other");
});

test("starter_* are discontinued, nothing else is", () => {
  assert.deepEqual(Object.keys(DISCONTINUED_WIDGET_EVENTS).sort(), ["starter_clicked", "starter_shown"]);
  assert.equal(discontinuedWidgetEvent("starter_shown")?.since, "2026-10-01");
  assert.equal(discontinuedWidgetEvent("login_gate_shown"), null);
  assert.equal(discontinuedWidgetEvent("toString"), null);
  assert.equal(RETIRED_CONSENT_GATE_SURFACES.chat, "2026-10-01");
});

test("loginGateRates: per-session rates, null without a base", () => {
  const r = loginGateRates({ shown: 200, clicked: 50, declined: 100, dismissed: 30, signedIn: 40, linked: 30 });
  assert.equal(r.clickRate, 0.25);
  assert.equal(r.declineRate, 0.5);
  assert.equal(r.dismissRate, 0.15);
  assert.equal(r.signInRate, 0.8);
  assert.equal(r.linkRate, 0.75);
  assert.equal(r.overallRate, 0.15);
  assert.equal(r.unlinked, 10);

  const none = loginGateRates({ shown: 0, clicked: 0, declined: 0, dismissed: 0, signedIn: 0, linked: 0 });
  assert.deepEqual(
    [none.clickRate, none.declineRate, none.dismissRate, none.signInRate, none.linkRate, none.overallRate],
    [null, null, null, null, null, null]
  );
});

test("loginGateRates: junk and impossible counts never break the funnel", () => {
  const r = loginGateRates({ shown: "10", clicked: -3, declined: null, dismissed: undefined, signedIn: 2, linked: 5 });
  assert.equal(r.clickRate, 0);
  assert.equal(r.declineRate, 0);
  assert.equal(r.signInRate, null);
  assert.equal(r.linkRate, 1); // capped
  assert.equal(r.unlinked, 0);
});
