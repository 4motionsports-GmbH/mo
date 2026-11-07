import { test } from "node:test";
import assert from "node:assert/strict";
import { CONFIGURATOR_WIDGET_EVENTS, KPI_CONFIGURATOR_CHAT_STARTED, KPI_CONFIGURATOR_OPTIONS_SHOWN, KPI_CONFIGURATOR_PLAN_SHOWN } from "./configurator-core.mjs";
import {
  CONFIGURATOR_ONLY_PERSONAS,
  KONFIGURATOR_RESET_SINCE,
  RESET_CONFIGURATOR_TOOLS,
  classifySessions,
  configuratorPersonaChoices,
  decideOrders,
  isConfiguratorEvent,
  mergeWindows,
  parseOrderList,
  parseResetArgs,
  selectConfiguratorConversations,
} from "./konfigurator-reset-core.mjs";

const NOW = Date.parse("2026-11-08T08:00:00Z");

test("every configurator event name matches the prefix — and the prefix matches nothing else we send", () => {
  const names = [...Object.values(CONFIGURATOR_WIDGET_EVENTS), KPI_CONFIGURATOR_CHAT_STARTED, KPI_CONFIGURATOR_PLAN_SHOWN, KPI_CONFIGURATOR_OPTIONS_SHOWN];
  assert.equal(names.length, 19);
  for (const n of names) assert.ok(isConfiguratorEvent(n), n);
  for (const n of ["chat_opened", "message_sent", "product_cta_clicked", "add_to_cart_clicked", "configuratorx", "configurator", "Configurator_viewed"]) {
    assert.ok(!isConfiguratorEvent(n), n);
  }
});

test("the tools and the configurator-only personas", () => {
  assert.deepEqual([...RESET_CONFIGURATOR_TOOLS], ["suggest_replies", "show_gym_plan", "offer_plan_options"]);
  const choices = configuratorPersonaChoices();
  for (const p of CONFIGURATOR_ONLY_PERSONAS) assert.ok(choices.includes(p), `${p} is a persona choice of the page`);
});

test("lower bound: the day before the configurator release, nothing older is ever touched", () => {
  assert.equal(KONFIGURATOR_RESET_SINCE, "2026-10-20T00:00:00.000Z");
});

test("parseResetArgs: --before with a zone or 'now'; preview by default", () => {
  const p = parseResetArgs(["--before", "2026-11-08T09:00:00+01:00"], NOW);
  assert.equal(p.ok, true, p.errors.join("; "));
  assert.equal(p.before, "2026-11-08T08:00:00.000Z");
  assert.equal(p.apply, false);
  const n = parseResetArgs(["--before=now", "--apply"], NOW);
  assert.equal(n.ok, true);
  assert.equal(n.before, new Date(NOW).toISOString());
  assert.equal(n.beforeWasNow, true);
  assert.equal(n.apply, true);
  const z = parseResetArgs(["--before", "2026-11-07T23:00Z"], NOW);
  assert.equal(z.ok, true, z.errors.join("; "));
});

test("parseResetArgs refuses what could hit real data or is ambiguous", () => {
  // required
  assert.match(parseResetArgs([], NOW).errors.join(" "), /--before fehlt/);
  // no zone → ambiguous local time
  assert.match(parseResetArgs(["--before", "2026-11-08T09:00"], NOW).errors.join(" "), /Zeitzone/);
  assert.match(parseResetArgs(["--before", "2026-11-08"], NOW).errors.join(" "), /Zeitzone/);
  // the future
  assert.match(parseResetArgs(["--before", "2026-11-09T00:00:00Z"], NOW).errors.join(" "), /Zukunft/);
  // a few minutes of clock skew are fine
  assert.equal(parseResetArgs(["--before", "2026-11-08T08:03:00Z"], NOW).ok, true);
  // before the configurator existed
  assert.match(parseResetArgs(["--before", "2026-10-01T00:00:00Z"], NOW).errors.join(" "), /ersten Konfigurator-Release/);
  // unknown option, conflicting order flags
  assert.match(parseResetArgs(["--before", "now", "--delete-all"], NOW).errors.join(" "), /Unbekannte Option/);
  assert.match(parseResetArgs(["--before", "now", "--orders", "#1", "--keep-orders"], NOW).errors.join(" "), /schließen sich aus/);
  assert.equal(parseResetArgs(["--help"], NOW).help, true);
});

test("parseOrderList: names with or without #, commas or spaces", () => {
  assert.deepEqual(parseOrderList("#1001, 1002 #1003;;"), ["1001", "1002", "1003"]);
  assert.deepEqual(parseOrderList("gid://shopify/Order/1"), []);
  assert.deepEqual(parseOrderList(""), []);
});

const conv = (over) => ({
  id: 1,
  sessionId: "s1",
  conversationKey: "s1",
  customerId: null,
  createdAt: "2026-11-01T10:00:30Z",
  lastAt: "2026-11-01T10:10:00Z",
  hasConfiguratorTool: false,
  personaLabel: null,
  ...over,
});

test("selectConfiguratorConversations: tool rows, configurator personas and the handover thread", () => {
  const conversations = [
    conv({ id: 1, hasConfiguratorTool: true }), // a configurator thread with chips / plan
    conv({ id: 2, sessionId: "s2", personaLabel: "design_lifestyle" }), // persona only the page sets
    conv({ id: 3, sessionId: "s3", personaLabel: "strength_focused" }), // greeting-only handover thread
    conv({ id: 4, sessionId: "s4", personaLabel: "strength_focused" }), // a normal chat — no handover event
  ];
  const chatStarts = [{ sessionId: "s3", at: "2026-11-01T10:00:05Z" }];
  const picked = selectConfiguratorConversations({ conversations, chatStarts });
  assert.deepEqual([...picked.keys()].sort(), [1, 2, 3]);
  assert.deepEqual(picked.get(1), ["werkzeug"]);
  assert.deepEqual(picked.get(2), ["persona"]);
  assert.deepEqual(picked.get(3), ["übergabe"]);
});

test("the handover rule takes ONE thread: created within 5 minutes after the event, a configurator thread first", () => {
  // A signed-in tester keeps the session id: a normal chat 3 minutes after a
  // handover whose greeting failed (no row) must NOT be taken when a configurator
  // thread exists; a chat 10 minutes later is never taken.
  const conversations = [
    conv({ id: 10, sessionId: "u", createdAt: "2026-11-01T10:00:20Z", hasConfiguratorTool: false }),
    conv({ id: 11, sessionId: "u", createdAt: "2026-11-01T10:01:00Z", hasConfiguratorTool: true }),
    conv({ id: 12, sessionId: "u", createdAt: "2026-11-01T10:10:00Z", hasConfiguratorTool: false }),
  ];
  const picked = selectConfiguratorConversations({ conversations, chatStarts: [{ sessionId: "u", at: "2026-11-01T10:00:00Z" }] });
  assert.deepEqual([...picked.keys()].sort((a, b) => a - b), [11]);
  assert.deepEqual(picked.get(11), ["werkzeug", "übergabe"]);

  // No configurator thread in the window → the earliest one in it.
  const greetingOnly = selectConfiguratorConversations({
    conversations: [conv({ id: 20, sessionId: "v", createdAt: "2026-11-01T10:00:20Z" }), conv({ id: 21, sessionId: "v", createdAt: "2026-11-01T10:02:00Z" })],
    chatStarts: [{ sessionId: "v", at: "2026-11-01T10:00:00Z" }],
  });
  assert.deepEqual([...greetingOnly.keys()], [20]);

  // A thread created BEFORE the event is never the handover thread.
  const before = selectConfiguratorConversations({
    conversations: [conv({ id: 30, sessionId: "w", createdAt: "2026-11-01T09:59:00Z" })],
    chatStarts: [{ sessionId: "w", at: "2026-11-01T10:00:00Z" }],
  });
  assert.equal(before.size, 0);
});

test("classifySessions: anonymous configurator sessions are exclusive, signed-in or mixed ones are windowed", () => {
  const configuratorConversations = [
    { id: 1, sessionId: "anon", createdAt: "2026-11-01T10:00:30Z", lastAt: "2026-11-01T10:10:00Z" },
    { id: 2, sessionId: "signed", createdAt: "2026-11-02T12:00:00Z", lastAt: "2026-11-02T12:20:00Z" },
    { id: 3, sessionId: "mixed", createdAt: "2026-11-03T08:00:00Z", lastAt: "2026-11-03T08:05:00Z" },
    { id: 4, sessionId: "signed", createdAt: "2026-11-02T12:22:00Z", lastAt: "2026-11-02T12:30:00Z" },
  ];
  const r = classifySessions({
    configuratorConversations,
    writerSessions: new Map([[2, ["signed", "phone"]]]),
    conversationCounts: new Map([
      ["anon", 1],
      ["signed", 2],
      ["mixed", 2], // one configurator chat + one normal chat
      ["phone", 5],
    ]),
    signedInSessions: new Set(["signed", "phone"]),
  });
  assert.deepEqual(r.exclusive, ["anon"]);
  assert.deepEqual(
    r.shared.map((s) => s.sessionId),
    ["mixed", "phone", "signed"]
  );
  // Overlapping windows of one session are merged (12:00−5 min … 12:30+5 min).
  assert.deepEqual(r.shared.find((s) => s.sessionId === "signed").windows, [
    { from: "2026-11-02T11:55:00.000Z", to: "2026-11-02T12:35:00.000Z" },
  ]);
  assert.deepEqual(r.shared.find((s) => s.sessionId === "phone").windows, [
    { from: "2026-11-02T11:55:00.000Z", to: "2026-11-02T12:25:00.000Z" },
  ]);
});

test("a signed-in session is never exclusive, even with only configurator chats", () => {
  const r = classifySessions({
    configuratorConversations: [{ id: 1, sessionId: "s", createdAt: "2026-11-01T10:00:00Z", lastAt: "2026-11-01T10:05:00Z" }],
    writerSessions: new Map(),
    conversationCounts: new Map([["s", 1]]),
    signedInSessions: new Set(["s"]),
  });
  assert.deepEqual(r.exclusive, []);
  assert.equal(r.shared.length, 1);
});

test("mergeWindows drops broken windows and merges touching ones", () => {
  assert.deepEqual(
    mergeWindows([
      { from: 10, to: 20 },
      { from: 20, to: 30 },
      { from: 50, to: 40 },
      { from: NaN, to: 1 },
    ]),
    [{ from: new Date(10).toISOString(), to: new Date(30).toISOString() }]
  );
});

test("decideOrders: named test orders go; undecided candidates block the apply", () => {
  const candidates = [
    { id: 1, orderName: "#1001", shopifyOrderId: "555" },
    { id: 2, orderName: "#1002", shopifyOrderId: "556" },
  ];
  const all = decideOrders({ candidates, named: candidates, requested: ["1001", "#1002"], keepOrders: false });
  assert.equal(all.ok, true);
  assert.deepEqual(all.deleteIds, [1, 2]);

  const partial = decideOrders({ candidates, named: [candidates[0]], requested: ["1001"], keepOrders: false });
  assert.equal(partial.ok, false);
  assert.deepEqual(partial.undecided.map((o) => o.id), [2]);

  const keep = decideOrders({ candidates, named: [], requested: [], keepOrders: true });
  assert.equal(keep.ok, true);
  assert.deepEqual(keep.deleteIds, []);

  // a named order that is not in the window is reported, not silently ignored
  const missing = decideOrders({ candidates: [], named: [], requested: ["9999"], keepOrders: false });
  assert.equal(missing.ok, false);
  assert.deepEqual(missing.missing, ["9999"]);

  // a Shopify id works as well as the name
  const byId = decideOrders({ candidates, named: [candidates[1]], requested: ["556"], keepOrders: false });
  assert.deepEqual(byId.missing, []);

  // no candidates, nothing named → fine
  assert.equal(decideOrders({ candidates: [], named: [], requested: [], keepOrders: false }).ok, true);
});
