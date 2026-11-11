import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SENDER_ID,
  MAX_SENDER_IDENTITIES,
  allowedSenderDomains,
  isSenderDomainAllowed,
  normalizeSenderIdentity,
  parseSenderIdentities,
  parseStoredSender,
  resolveSender,
  sameSenderIdentity,
  senderDomain,
  senderFromHeader,
  senderIdFor,
  validateSenderIdentitiesInput,
} from "./sender-identities.mjs";

const domains = ["motionsports.de"];

test("senderDomain: the lower-cased domain of every mailbox shape", () => {
  assert.equal(senderDomain("Mo <mo@MotionSports.de>"), "motionsports.de");
  assert.equal(senderDomain("info@motionsports.de"), "motionsports.de");
  assert.equal(senderDomain("nope"), "");
  assert.equal(senderDomain(undefined), "");
});

test("allowedSenderDomains: the env sender's domain plus EMAIL_SENDER_DOMAINS, unique", () => {
  assert.deepEqual(allowedSenderDomains("Mo <mo@motionsports.de>"), ["motionsports.de"]);
  assert.deepEqual(allowedSenderDomains("mo@motionsports.de", "news.motionsports.de, MOTIONSPORTS.de;@shop.example.com"), [
    "motionsports.de",
    "news.motionsports.de",
    "shop.example.com",
  ]);
  assert.deepEqual(allowedSenderDomains(undefined, "  "), []);
  assert.deepEqual(allowedSenderDomains("", "not a domain, -bad-.de"), []);
});

test("isSenderDomainAllowed: exact domain match only (no subdomain, no lookalike)", () => {
  assert.equal(isSenderDomainAllowed("info@motionsports.de", domains), true);
  assert.equal(isSenderDomainAllowed("INFO@MotionSports.DE", domains), true);
  assert.equal(isSenderDomainAllowed("info@mo.motionsports.de", domains), false);
  assert.equal(isSenderDomainAllowed("info@motionsports.de.evil.com", domains), false);
  assert.equal(isSenderDomainAllowed("info@motionsports.com", domains), false);
  assert.equal(isSenderDomainAllowed("info@motionsports.de", []), false);
});

test("senderIdFor: the local part as a slug, never the default id, unique", () => {
  assert.equal(senderIdFor("info@motionsports.de"), "info");
  assert.equal(senderIdFor("Black.Week@motionsports.de"), "black-week");
  assert.equal(senderIdFor("standard@motionsports.de"), "standard-2");
  assert.equal(senderIdFor("info@motionsports.de", ["info"]), "info-2");
  assert.equal(senderIdFor("info@motionsports.de", ["info", "info-2"]), "info-3");
});

test("normalizeSenderIdentity: a usable identity or null", () => {
  assert.deepEqual(
    normalizeSenderIdentity({ address: " Info@MotionSports.de ", name: "  motion   sports ", replies: "direct" }, { allowedDomains: domains }),
    { id: "info", address: "info@motionsports.de", name: "motion sports", replies: "direct" }
  );
  const bad = [
    null,
    "info@motionsports.de",
    { address: "info@other.de", name: "x", replies: "mo" },
    { address: "info@motionsports.de", name: "", replies: "mo" },
    { address: "info@motionsports.de", name: "a".repeat(61), replies: "mo" },
    { address: "info@motionsports.de", name: "motion\r\nBcc: x@y.de", replies: "mo" },
    { address: "info@motionsports.de", name: "motion sports", replies: "somewhere" },
  ];
  for (const b of bad) assert.equal(normalizeSenderIdentity(b, { allowedDomains: domains }), null, JSON.stringify(b));
  // A stored id is kept; the default id is never taken over.
  assert.equal(normalizeSenderIdentity({ id: "news", address: "info@motionsports.de", name: "x", replies: "mo" }, { allowedDomains: domains })?.id, "news");
  assert.equal(normalizeSenderIdentity({ id: DEFAULT_SENDER_ID, address: "info@motionsports.de", name: "x", replies: "mo" }, { allowedDomains: domains })?.id, "info");
});

test("parseSenderIdentities: lenient read — invalid and duplicate entries drop out", () => {
  const stored = {
    senders: [
      { id: "info", address: "info@motionsports.de", name: "motion sports", replies: "direct" },
      { id: "x", address: "info@motionsports.de", name: "Dup", replies: "mo" },
      { id: "old", address: "news@removed-domain.de", name: "Old", replies: "mo" },
      { id: "info", address: "news@motionsports.de", name: "News", replies: "mo" },
    ],
  };
  const list = parseSenderIdentities(stored, { allowedDomains: domains });
  assert.deepEqual(list.map((s) => [s.id, s.address]), [
    ["info", "info@motionsports.de"],
    // The colliding stored id is re-derived from its own address.
    ["news", "news@motionsports.de"],
  ]);
  assert.deepEqual(parseSenderIdentities(JSON.stringify(stored), { allowedDomains: domains }).length, 2);
  assert.deepEqual(parseSenderIdentities("not json", { allowedDomains: domains }), []);
  assert.deepEqual(parseSenderIdentities(null, { allowedDomains: domains }), []);
});

test("validateSenderIdentitiesInput: strict, with a German message per problem", () => {
  const ok = validateSenderIdentitiesInput(
    [{ address: "info@motionsports.de", name: "motion sports", replies: "direct" }],
    { allowedDomains: domains, defaultAddress: "Mo von motion sports <mo@motionsports.de>" }
  );
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.ok && ok.senders, [{ id: "info", address: "info@motionsports.de", name: "motion sports", replies: "direct" }]);

  const cases = [
    [[{ address: "x", name: "n", replies: "mo" }], /keine gültige E-Mail-Adresse/],
    [[{ address: "info@gmail.com", name: "n", replies: "mo" }], /nicht auf einer in Resend bestätigten Domain \(erlaubt: motionsports\.de\)/],
    [[{ address: "mo@motionsports.de", name: "n", replies: "mo" }], /schon der Standard-Absender/],
    [[{ address: "info@motionsports.de", name: " ", replies: "mo" }], /Anzeigename/],
    [[{ address: "info@motionsports.de", name: "n", replies: "?" }], /wohin Antworten gehen/],
    [
      [
        { address: "info@motionsports.de", name: "n", replies: "mo" },
        { address: "INFO@motionsports.de", name: "m", replies: "mo" },
      ],
      /doppelt/,
    ],
    ["nope", /Ungültige Absender-Liste/],
  ];
  for (const [input, re] of cases) {
    const r = validateSenderIdentitiesInput(input, { allowedDomains: domains, defaultAddress: "mo@motionsports.de" });
    assert.equal(r.ok, false, JSON.stringify(input));
    assert.match(r.ok ? "" : r.message, re);
  }
  const tooMany = Array.from({ length: MAX_SENDER_IDENTITIES + 1 }, (_, i) => ({ address: `a${i}@motionsports.de`, name: "n", replies: "mo" }));
  assert.equal(validateSenderIdentitiesInput(tooMany, { allowedDomains: domains }).ok, false);
});

test("senderFromHeader: quoted display name in front of the address", () => {
  assert.equal(senderFromHeader({ name: "motion sports", address: "info@motionsports.de" }), "motion sports <info@motionsports.de>");
  assert.equal(senderFromHeader({ name: "motion sports, Black Week", address: "info@motionsports.de" }), '"motion sports, Black Week" <info@motionsports.de>');
});

test("resolveSender: default identity = today's behaviour (env sender, replies to Mo)", () => {
  const r = resolveSender({
    identity: null,
    defaultFrom: "Mo von motion sports <mo@motionsports.de>",
    inboundAddress: "hello@reply.motionsports.de",
    allowedDomains: domains,
  });
  assert.deepEqual(r, {
    ok: true,
    from: "Mo von motion sports <mo@motionsports.de>",
    replyTo: "hello@reply.motionsports.de",
    address: "mo@motionsports.de",
    isDefault: true,
  });
  assert.equal(resolveSender({ identity: null, defaultFrom: undefined, inboundAddress: undefined, allowedDomains: domains }).ok, false);
});

test("resolveSender: a chosen identity — replies to Mo or directly to the address", () => {
  const base = { defaultFrom: "Mo <mo@motionsports.de>", inboundAddress: "hello@reply.motionsports.de", allowedDomains: domains };
  const direct = resolveSender({ ...base, identity: { id: "info", address: "info@motionsports.de", name: "motion sports", replies: "direct" } });
  assert.deepEqual(direct, { ok: true, from: "motion sports <info@motionsports.de>", replyTo: undefined, address: "info@motionsports.de", isDefault: false });
  const viaMo = resolveSender({ ...base, identity: { id: "info", address: "info@motionsports.de", name: "motion sports", replies: "mo" } });
  assert.equal(viaMo.ok && viaMo.replyTo, "hello@reply.motionsports.de");
  // Replies "mo" with the inbound address being the From itself → no Reply-To.
  const same = resolveSender({ ...base, inboundAddress: "info@motionsports.de", identity: { id: "info", address: "info@motionsports.de", name: "x", replies: "mo" } });
  assert.equal(same.ok && same.replyTo, undefined);
});

test("resolveSender: an identity whose domain is no longer allowed is refused, never swapped", () => {
  const r = resolveSender({
    identity: { id: "news", address: "news@old-domain.de", name: "News", replies: "mo" },
    defaultFrom: "Mo <mo@motionsports.de>",
    inboundAddress: undefined,
    allowedDomains: domains,
  });
  assert.equal(r.ok, false);
  assert.match(r.ok ? "" : r.message, /news@old-domain\.de ist nicht mehr erlaubt/);
});

test("parseStoredSender: what a campaign stored, without the domain rule (the send re-checks)", () => {
  assert.deepEqual(parseStoredSender({ id: "info", address: "info@old-domain.de", name: "motion sports", replies: "direct" }), {
    id: "info",
    address: "info@old-domain.de",
    name: "motion sports",
    replies: "direct",
  });
  assert.deepEqual(parseStoredSender(JSON.stringify({ address: "info@motionsports.de", name: "x", replies: "mo" }))?.address, "info@motionsports.de");
  for (const bad of [null, "", "{", [], { address: "nope", name: "x", replies: "mo" }, { address: "a@b.de", name: "", replies: "mo" }]) {
    assert.equal(parseStoredSender(bad), null, JSON.stringify(bad));
  }
});

test("sameSenderIdentity: address, name and reply routing decide; null is the default sender", () => {
  const info = normalizeSenderIdentity({ address: "info@motionsports.de", name: "motion sports", replies: "direct" }, { allowedDomains: domains });
  assert.ok(info);
  assert.equal(sameSenderIdentity(info, { ...info }), true);
  assert.equal(sameSenderIdentity(null, null), true);
  assert.equal(sameSenderIdentity(undefined, null), true);
  assert.equal(sameSenderIdentity(info, null), false);
  assert.equal(sameSenderIdentity(null, info), false);
  assert.equal(sameSenderIdentity(info, { ...info, address: "hallo@motionsports.de" }), false);
  assert.equal(sameSenderIdentity(info, { ...info, name: "Motion Sports Team" }), false);
  assert.equal(sameSenderIdentity(info, { ...info, replies: "mo" }), false);
});
