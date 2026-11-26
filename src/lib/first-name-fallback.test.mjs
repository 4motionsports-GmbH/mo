import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fallbackNameProblems,
  fallbackNameWords,
  fallbacksOfMerges,
  firstNameFallbacks,
  namelessReading,
  namelessReadings,
  namesIn,
  neutralGreetingFor,
  neutralizeDoc,
  neutralizeMerges,
  peopleFirstNames,
  stripNames,
} from "./first-name-fallback.mjs";
import { applyMergeFields, normalizeMailTemplateDoc } from "./mail-template-doc.mjs";
import { MAIL_COMPANY_LINES } from "./mail-template-render.mjs";

/** A mail whose greeting and heading carry a name („Lucas“) in their fallbacks — what the guard is for. */
const LUCAS_DOC = normalizeMailTemplateDoc({
  version: 2,
  blocks: [
    { type: "greeting", text: "Hallo {{vorname}},", fallback: "Hallo Lucas," },
    { type: "heading", text: "{{vorname|Lucas}}, die Black Week ist da" },
    {
      type: "section",
      columns: [{ blocks: [{ type: "text", text: "Nur für dich, {{vorname|Sportsfreund}}!" }] }, { blocks: [{ type: "button", label: "Los geht's", href: "https://motionsports.de/" }] }],
    },
    { type: "footer" },
  ],
});

test("firstNameFallbacks: the subject, greetings and {{vorname|…}} in every block, sections included", () => {
  const f = firstNameFallbacks("{{vorname|Hey}}, nur heute", LUCAS_DOC);
  assert.deepEqual(f, [
    { where: "Betreff", fallback: "Hey", reads: "Hey, nur heute" },
    { where: "Anrede", text: "Hallo {{vorname}},", fallback: "Hallo Lucas," },
    { where: "Überschrift", fallback: "Lucas", reads: "Lucas, die Black Week ist da" },
    { where: "Text", fallback: "Sportsfreund", reads: "Nur für dich, Sportsfreund!" },
  ]);
  // {{vorname}} without „|…“ falls back to nothing
  assert.deepEqual(firstNameFallbacks("Für {{vorname}}", normalizeMailTemplateDoc({ version: 2, blocks: [{ type: "footer" }] })), [
    { where: "Betreff", fallback: "", reads: "Für" },
  ]);
  assert.deepEqual(firstNameFallbacks("", null), []);
});

test("namelessReading: the sentence of the first {{vorname}} as someone without a known name reads it", () => {
  assert.equal(namelessReading("{{vorname|Hey}}, die Black Week ist da"), "Hey, die Black Week ist da");
  assert.equal(namelessReading("{{vorname}}, die Black Week ist da"), "Die Black Week ist da");
  assert.equal(namelessReading("Die Black Week ist da. Nur für dich, {{vorname}}! Bis Montag."), "… Nur für dich! Bis Montag.");
  assert.equal(namelessReading("<p>Hallo {{vorname|Lucas}},</p>"), "Hallo Lucas,");
  assert.equal(namelessReading("{{vorname}}"), "");
  const long = namelessReading(`{{vorname|Hey}}, ${"sehr ".repeat(30)}lang`);
  assert.ok(long.length <= 91 && long.startsWith("Hey, sehr") && long.endsWith(" …"), long);
});

test("fallbacksOfMerges: the fallbacks of a released Rundmail", () => {
  assert.deepEqual(
    fallbacksOfMerges({ body: [{ fallback: "Lucas" }], greetings: [{ text: "Hallo {{vorname}},", fallback: "Hallo Lucas," }], subject: [{ fallback: "Hey" }] }),
    [
      { where: "Betreff", fallback: "Hey" },
      { where: "Anrede", text: "Hallo {{vorname}},", fallback: "Hallo Lucas," },
      { where: "Text", fallback: "Lucas" },
    ]
  );
  assert.deepEqual(fallbacksOfMerges(null), []);
});

test("fallbackNameWords: capitalised words, no greeting words, each once", () => {
  assert.deepEqual(fallbackNameWords(firstNameFallbacks("{{vorname|Hey}}, nur heute", LUCAS_DOC)), ["lucas"]);
  assert.deepEqual(fallbackNameWords([{ fallback: "Liebe Sportsfreundin, Hallo Team!" }, { fallback: "hey du" }, { fallback: "Hi Anna-Lena," }]), ["anna-lena"]);
  assert.deepEqual(fallbackNameWords([{ fallback: "" }, { fallback: "A" }]), []);
});

test("namesIn / stripNames: the names of a text, and the text without them", () => {
  assert.deepEqual(namesIn("Hallo Lucas,", ["lucas"]), ["Lucas"]);
  assert.deepEqual(namesIn("Hallo,", ["lucas"]), []);
  assert.equal(stripNames("Hallo Lucas,", ["lucas"]), "Hallo,");
  assert.equal(stripNames("Lucas", ["lucas"]), "");
  assert.equal(stripNames("Lucas, schön dass du da bist", ["lucas"]), "schön dass du da bist");
  assert.equal(stripNames("Hey Lucas und Sabine!", ["lucas", "sabine"]), "Hey und!");
  assert.equal(stripNames("Hallo LUCAS!", new Set(["lucas"])), "Hallo!");
  assert.equal(stripNames("Hallo Lucas,,", ["lucas"]), "Hallo,");
});

test("neutralizeMerges: names out of every fallback; a greeting falls back to its text or the neutral greeting", () => {
  const merges = {
    body: [{ fallback: "Lucas" }, { fallback: "Hey" }],
    greetings: [
      { text: "Hallo {{vorname}},", fallback: "Hallo Lucas," },
      { text: "Hey {{vorname}}!", fallback: "Lucas" },
      { text: "Lieber {{vorname}},", fallback: "Lieber Lucas," },
    ],
    subject: [{ fallback: "Lucas" }],
    refresh: { outcome: "unveraendert" },
  };
  const { merges: out, changed } = neutralizeMerges(merges, ["lucas"]);
  assert.deepEqual(out.body, [{ fallback: "" }, { fallback: "Hey" }]);
  assert.deepEqual(
    out.greetings.map((g) => g.fallback),
    ["Hallo,", "Hey!", "Hallo,"]
  );
  assert.deepEqual(out.subject, [{ fallback: "" }]);
  assert.deepEqual(out.refresh, { outcome: "unveraendert" });
  assert.equal(changed.length, 5);
  assert.deepEqual(changed[0], { where: "Betreff", from: "Lucas", to: "" });
  // English mails get „Hi,“
  assert.equal(neutralizeMerges({ greetings: [{ text: "Dear {{vorname}},", fallback: "Dear Lucas," }] }, ["lucas"], { language: "en" }).merges.greetings[0].fallback, "Hi,");
  assert.equal(neutralGreetingFor("de"), "Hallo,");
  // nothing to do: the same object
  const clean = { body: [{ fallback: "Hey" }], greetings: [{ text: "Hallo {{vorname}},", fallback: "Hallo," }], subject: [] };
  assert.equal(neutralizeMerges(clean, ["lucas"]).merges, clean);
  assert.equal(neutralizeMerges(clean, []).merges, clean);
});

test("neutralizeDoc: names out of a Vorlage's greetings and {{vorname|…}} fallbacks, sections included", () => {
  const { doc, changed } = neutralizeDoc(LUCAS_DOC, ["lucas"]);
  const blocks = /** @type {any[]} */ (doc.blocks);
  assert.equal(blocks[0].fallback, "Hallo,");
  assert.equal(blocks[0].text, "Hallo {{vorname}},");
  assert.equal(blocks[1].text, "{{vorname}}, die Black Week ist da");
  assert.equal(blocks[2].columns[0].blocks[0].text, "Nur für dich, {{vorname|Sportsfreund}}!");
  assert.deepEqual(changed, [
    { where: "Anrede", from: "Hallo Lucas,", to: "Hallo," },
    { where: "Überschrift", from: "Lucas", to: "" },
  ]);
  // what someone without a known first name reads now
  assert.equal(applyMergeFields(blocks[1].text, { firstName: null }), "Die Black Week ist da");
  assert.equal(applyMergeFields(blocks[1].text, { firstName: "tom" }), "Tom, die Black Week ist da");
  // a name inside a longer fallback; a section's own columns
  const inner = normalizeMailTemplateDoc({
    version: 2,
    blocks: [{ type: "section", columns: [{ blocks: [{ type: "greeting", text: "Hey {{vorname}}!", fallback: "Hey Lucas!" }] }, { blocks: [{ type: "button", label: "{{vorname|Hey Lucas}}, los", href: "https://motionsports.de/" }] }] }],
  });
  const fixed = /** @type {any} */ (neutralizeDoc(inner, ["lucas"]).doc);
  assert.equal(fixed.blocks[0].columns[0].blocks[0].fallback, "Hey!");
  assert.equal(fixed.blocks[0].columns[1].blocks[0].label, "{{vorname|Hey}}, los");
  // nothing to do: the same document
  assert.equal(neutralizeDoc(LUCAS_DOC, []).doc, LUCAS_DOC);
  assert.equal(neutralizeDoc(LUCAS_DOC, ["anna"]).doc, LUCAS_DOC);
  assert.equal(neutralizeDoc(null, ["lucas"]).doc, null);
});

test("fallbackNameProblems / namelessReadings: what the release check reports", () => {
  const f = firstNameFallbacks("{{vorname|Hey}}, nur heute", LUCAS_DOC);
  assert.deepEqual(fallbackNameProblems(f, ["lucas"]), [
    { where: "Anrede", fallback: "Hallo Lucas,", reads: "Hallo Lucas,", names: ["Lucas"] },
    { where: "Überschrift", fallback: "Lucas", reads: "Lucas, die Black Week ist da", names: ["Lucas"] },
  ]);
  assert.deepEqual(fallbackNameProblems(f, []), []);
  assert.deepEqual(namelessReadings(f), [
    "Betreff: „Hey, nur heute“",
    "Anrede: „Hallo Lucas,“",
    "Überschrift: „Lucas, die Black Week ist da“",
    "Text: „Nur für dich, Sportsfreund!“",
  ]);
  assert.deepEqual(namelessReadings([{ where: "Betreff", fallback: "" }, { where: "Betreff", fallback: " " }]), ["Betreff: (nichts)"]);
});

test("peopleFirstNames: the managing directors of the imprint", () => {
  assert.deepEqual(peopleFirstNames(MAIL_COMPANY_LINES), ["sabine", "lucas"]);
  assert.deepEqual(peopleFirstNames(["Geschäftsführerin: Dr. Maximiliane Mustermann", "Inhaber: Jan Muster und Eva Beispiel"]), ["maximiliane", "jan", "eva"]);
  assert.deepEqual(peopleFirstNames(["4motionsports GmbH"]), []);
});
