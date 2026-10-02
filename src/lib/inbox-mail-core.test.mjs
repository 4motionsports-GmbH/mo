import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAIL_ITEM_KIND,
  buildMailReplyPrompt,
  contactFormMessage,
  htmlToText,
  mailSnippet,
  mailItemReason,
  mergeMailEvidence,
  newMailItem,
  sanitizeMailDraft,
  splitName,
  stripQuoted,
} from "./inbox-mail-core.mjs";

const mail = { customerId: 7, emailMessageId: 41, subject: "Frage zur Lieferung", snippet: "Hallo, wann kommt mein Rack?", occurredAt: "2026-10-02T18:00:00Z" };

test("a new mail opens one item per episode, keyed by its first mail", () => {
  const it = newMailItem(mail);
  assert.equal(it.kind, MAIL_ITEM_KIND);
  assert.equal(it.dedupeKey, "antwort_offen:7:m41");
  assert.equal(it.title, "E-Mail beantworten");
  assert.equal(it.reason, "E-Mail: „Frage zur Lieferung“ — Hallo, wann kommt mein Rack?");
  assert.deepEqual(it.evidence.messageIds, [41]);
  assert.equal(it.expiresAt, null);
});

test("further mails join the open item", () => {
  const first = mergeMailEvidence(null, mail);
  const second = mergeMailEvidence(first, { ...mail, emailMessageId: 52, subject: "Nachtrag", occurredAt: "2026-10-02T19:00:00Z" });
  assert.deepEqual(second.messageIds, [41, 52]);
  assert.equal(second.count, 2);
  assert.equal(second.lastMessageId, 52);
  assert.equal(second.lastSubject, "Nachtrag");
  // The same mail twice (webhook retry) does not count twice.
  assert.equal(mergeMailEvidence(second, { ...mail, emailMessageId: 52 }).count, 2);
  // At most 20 ids are kept.
  let ev = null;
  for (let i = 1; i <= 25; i++) ev = mergeMailEvidence(ev, { ...mail, emailMessageId: i });
  assert.equal(ev.messageIds.length, 20);
  assert.equal(ev.messageIds[0], 6);
});

test("the reason names the source and clips long text", () => {
  assert.match(mailItemReason({ subject: null, snippet: null, count: 2 }), /^2 E-Mails: \(ohne Betreff\)$/);
  assert.match(mailItemReason({ subject: "Leasing", snippet: "x", count: 1, source: "kontaktformular" }), /^Kontaktanfrage: „Leasing“/);
  assert.equal(mailItemReason({ subject: "Kontaktanfrage: Leasing", snippet: "Bitte ein Angebot.", count: 1, source: "kontaktformular" }), "Kontaktanfrage: „Leasing“ — Bitte ein Angebot.");
  assert.ok(mailItemReason({ subject: "S", snippet: "a".repeat(500), count: 1 }).length < 260);
});

test("contact-form requests become a readable message", () => {
  const m = contactFormMessage({ reasonLabel: "Leasing", name: "  Ina Roth ", email: "ina@example.com", phone: "0170", message: "Bitte ein Angebot.", products: ["rack-pro"] });
  assert.equal(m.subject, "Kontaktanfrage: Leasing");
  assert.match(m.bodyText, /Name: Ina Roth\nTelefon: 0170\nProdukte: rack-pro\n\nBitte ein Angebot\.$/);
  assert.equal(m.snippet, "Bitte ein Angebot.");
});

test("names, html and quoted history", () => {
  assert.deepEqual(splitName("Ina Maria Roth"), { firstName: "Ina Maria", lastName: "Roth" });
  assert.deepEqual(splitName("Ina"), { firstName: "Ina", lastName: null });
  assert.deepEqual(splitName(""), { firstName: null, lastName: null });
  assert.equal(htmlToText("<p>Hallo&nbsp;Team</p><p>Gruß<br>Ina</p><style>x{}</style>"), "Hallo Team\nGruß\nIna");
  assert.equal(stripQuoted("Danke!\n\nAm 1.10.2026 schrieb motion sports:\n> alte Mail"), "Danke!");
  assert.equal(stripQuoted("Ja\n> zitiert\nnoch was"), "Ja\nnoch was");
  assert.equal(mailSnippet("Passt!\n\nAm 1.10. schrieb Mo:\n> alt", null, "Passt! Am 1.10. schrieb"), "Passt!");
  assert.equal(mailSnippet(null, "<p>Hallo</p>", null), "Hallo");
  assert.equal(mailSnippet("", null, "fallback"), "fallback");
});

test("the prompt forbids advertising and inventing, and carries the sources", () => {
  const { system, prompt } = buildMailReplyPrompt({
    customerName: "Ina Roth",
    language: "de",
    messages: [{ direction: "received", at: "2026-10-02T18:00:00Z", subject: "Lieferung", text: "Wann kommt mein Rack?" }],
    orders: [{ at: "2026-09-28T10:00:00Z", status: "unfulfilled", items: ["Rack Pro"] }],
    profile: null,
  });
  assert.match(system, /KEINE Werbung/);
  assert.match(system, /Erfinde nichts/);
  assert.match(system, /im Zweifel Deutsch/);
  assert.match(prompt, /Bestellung vom 2026-09-28 \(unfulfilled\): Rack Pro/);
  assert.doesNotMatch(prompt, /#\d/); // no order numbers (dossier §7.1)
  assert.match(prompt, /Wann kommt mein Rack\?/);
  assert.match(buildMailReplyPrompt({ customerName: null, language: "en", messages: [], orders: [], profile: null }).system, /im Zweifel Englisch/);
});

test("the draft is cleaned into a reply suggestion", () => {
  const s = sanitizeMailDraft(
    { zusammenfassung: "Fragt nach dem Liefertermin.", anliegen: "bestellung_lieferung", dringlichkeit: "hoch", naechster_schritt: "Status prüfen", betreff: "", text: " Hallo … ", offene_punkte: ["[Liefertermin prüfen]"] },
    { fallbackSubject: "Re: Lieferung" }
  );
  assert.equal(s.kanal, "antwort");
  assert.equal(s.betreff, "Re: Lieferung");
  assert.equal(s.text, "Hallo …");
  assert.equal(s.anliegen, "bestellung_lieferung");
  assert.deepEqual(s.offenePunkte, ["[Liefertermin prüfen]"]);
  assert.equal(s.rabatt, null);
  const odd = sanitizeMailDraft({ anliegen: "werbung", dringlichkeit: "sofort" }, { fallbackSubject: "Re: x" });
  assert.equal(odd.anliegen, "sonstiges");
  assert.equal(odd.dringlichkeit, "mittel");
});
