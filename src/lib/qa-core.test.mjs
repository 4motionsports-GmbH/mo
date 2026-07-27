import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isEligibleForQaScan,
  buildQaDraftPrompt,
  parseQaDraftResponse,
  questionFingerprint,
  parseQaMetafield,
  mergeQaList,
  removeQaFromList,
  serializeQaMetafield,
  QA_MAX_PER_PRODUCT,
} from "./qa-core.mjs";

// ── Eligibility ──────────────────────────────────────────────────────────────

test("eligibility: unmet_need / dropped_off / contact form qualify, others don't", () => {
  assert.equal(isEligibleForQaScan({ quality: "unmet_need" }), true);
  assert.equal(isEligibleForQaScan({ quality: "dropped_off" }), true);
  assert.equal(isEligibleForQaScan({ quality: "handled_well" }), false);
  assert.equal(isEligibleForQaScan({ quality: null }), false);
  assert.equal(
    isEligibleForQaScan({ quality: "handled_well", contactFormShown: true }),
    true
  );
});

// ── Draft parsing ────────────────────────────────────────────────────────────

test("parseQaDraftResponse: valid found=true draft", () => {
  const parsed = parseQaDraftResponse(
    JSON.stringify({
      found: true,
      gap_summary: "Mo kannte die maximale Deckenhöhe nicht.",
      question: "Welche Deckenhöhe brauche ich für die ATX Multipresse MPX-780?",
      product_handle: "atx-multipresse-mpx-780",
    })
  );
  assert.ok(parsed && parsed.found);
  assert.equal(parsed.productHandle, "atx-multipresse-mpx-780");
  assert.match(parsed.question, /Deckenhöhe/);
});

test("parseQaDraftResponse: tolerates code fences and surrounding prose", () => {
  const parsed = parseQaDraftResponse(
    'Hier ist das Ergebnis:\n```json\n{"found": true, "gap_summary": "X fehlt.", "question": "Wie schwer ist X?", "product_handle": null}\n```'
  );
  assert.ok(parsed && parsed.found);
  assert.equal(parsed.productHandle, null);
});

test("parseQaDraftResponse: found=false and incomplete drafts collapse to {found:false}", () => {
  assert.deepEqual(parseQaDraftResponse('{"found": false}'), { found: false });
  // found=true but missing question → not usable → found:false
  assert.deepEqual(
    parseQaDraftResponse('{"found": true, "gap_summary": "X", "question": ""}'),
    { found: false }
  );
});

test("parseQaDraftResponse: garbage → null (model error, not cacheable)", () => {
  assert.equal(parseQaDraftResponse("keine ahnung"), null);
  assert.equal(parseQaDraftResponse(""), null);
});

test("buildQaDraftPrompt lists handles and caps them", () => {
  const p = buildQaDraftPrompt({
    transcript: "Kunde: Hallo",
    productHandles: ["a", "b"],
  });
  assert.match(p, /## Produkte im Gespräch/);
  assert.match(p, /\na\nb\n/);
  const empty = buildQaDraftPrompt({ transcript: "Kunde: Hallo", productHandles: [] });
  assert.match(empty, /keine erkannt/);
});

// ── Fingerprint ──────────────────────────────────────────────────────────────

test("questionFingerprint folds case, umlauts and punctuation", () => {
  const a = questionFingerprint("Welche Deckenhöhe brauche ich für die MPX-780?");
  const b = questionFingerprint("welche deckenhoehe brauche ich fuer die MPX 780");
  // ö → o (NFD strip), but "hoehe"/"fuer" spellings differ — only exact-fold
  // variants collide:
  const c = questionFingerprint("Welche Deckenhöhe brauche ich für die MPX 780???");
  assert.equal(a, c);
  assert.notEqual(a, b);
  assert.equal(questionFingerprint("Groß?"), questionFingerprint("gross"));
});

// ── custom.qa metafield format ───────────────────────────────────────────────

test("parseQaMetafield: canonical {q,a} list round-trips; junk → []", () => {
  const value = JSON.stringify([
    { q: "Frage 1?", a: "Antwort 1." },
    { q: "", a: "ohne Frage" }, // dropped
    { q: "Frage 2?", a: "Antwort 2." },
  ]);
  const parsed = parseQaMetafield(value);
  assert.deepEqual(parsed, [
    { question: "Frage 1?", answer: "Antwort 1." },
    { question: "Frage 2?", answer: "Antwort 2." },
  ]);
  assert.deepEqual(parseQaMetafield("kein json"), []);
  assert.deepEqual(parseQaMetafield('{"q":"x"}'), []);
  assert.deepEqual(parseQaMetafield(null), []);
});

test("mergeQaList replaces the same question (fingerprint) instead of duplicating", () => {
  const merged = mergeQaList(
    [{ question: "Wie schwer ist die MPX-780?", answer: "Alt: 170 kg" }],
    { question: "Wie schwer ist die MPX-780???", answer: "Neu: 176 kg" }
  );
  assert.equal(merged.length, 1);
  assert.equal(merged[0].answer, "Neu: 176 kg");
});

test("mergeQaList caps at QA_MAX_PER_PRODUCT by dropping the oldest", () => {
  const many = Array.from({ length: QA_MAX_PER_PRODUCT }, (_, i) => ({
    question: `Frage ${i}?`,
    answer: `Antwort ${i}.`,
  }));
  const merged = mergeQaList(many, { question: "Neue Frage?", answer: "Neue Antwort." });
  assert.equal(merged.length, QA_MAX_PER_PRODUCT);
  assert.equal(merged.at(-1).question, "Neue Frage?");
  assert.equal(merged[0].question, "Frage 1?"); // Frage 0 dropped
});

test("removeQaFromList removes by fingerprint and is idempotent (unpublish)", () => {
  const list = [
    { question: "Wie schwer ist die MPX-780?", answer: "176 kg" },
    { question: "Welche Deckenhöhe brauche ich?", answer: "2,30 m" },
  ];
  // Punctuation/case variants of the same question match (same rule as merge).
  const removed = removeQaFromList(list, "wie schwer ist die MPX 780???");
  assert.deepEqual(removed, [
    { question: "Welche Deckenhöhe brauche ich?", answer: "2,30 m" },
  ]);
  // Removing an absent question is a no-op — unpublish stays idempotent.
  assert.deepEqual(removeQaFromList(removed, "Gibt es Ratenzahlung?"), removed);
  assert.deepEqual(removeQaFromList([], "x"), []);
});

test("serializeQaMetafield emits the terse {q,a} shape", () => {
  const s = serializeQaMetafield([{ question: " F? ", answer: " A. " }]);
  assert.deepEqual(JSON.parse(s), [{ q: "F?", a: "A." }]);
});

// ── i18n: the English pair rides along, complete-or-not-at-all ───────────────

test("English pair round-trips through serialize/parse; incomplete pairs are dropped", () => {
  const s = serializeQaMetafield([
    {
      question: "Wie hoch ist die MPX-780?",
      answer: "2.195 mm.",
      questionEn: "How tall is the MPX-780?",
      answerEn: "2,195 mm.",
    },
    { question: "Nur Deutsch?", answer: "Ja.", questionEn: "orphan without answerEn" },
  ]);
  assert.deepEqual(JSON.parse(s), [
    {
      q: "Wie hoch ist die MPX-780?",
      a: "2.195 mm.",
      q_en: "How tall is the MPX-780?",
      a_en: "2,195 mm.",
    },
    { q: "Nur Deutsch?", a: "Ja." },
  ]);
  const parsed = parseQaMetafield(s);
  assert.deepEqual(parsed[0], {
    question: "Wie hoch ist die MPX-780?",
    answer: "2.195 mm.",
    questionEn: "How tall is the MPX-780?",
    answerEn: "2,195 mm.",
  });
  assert.deepEqual(parsed[1], { question: "Nur Deutsch?", answer: "Ja." });
});

test("mergeQaList carries the English pair and replacement updates it", () => {
  const merged = mergeQaList(
    [
      {
        question: "Wie schwer?",
        answer: "Alt",
        questionEn: "How heavy?",
        answerEn: "Old",
      },
    ],
    { question: "Wie schwer???", answer: "Neu", questionEn: "How heavy?", answerEn: "New" }
  );
  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0], {
    question: "Wie schwer???",
    answer: "Neu",
    questionEn: "How heavy?",
    answerEn: "New",
  });
  // German-only replacement drops the stale English pair (no half-updated i18n).
  const deOnly = mergeQaList(merged, { question: "Wie schwer?", answer: "Neuer" });
  assert.deepEqual(deOnly, [{ question: "Wie schwer?", answer: "Neuer" }]);
});

// ── Product links in answers (markdown → a_html) ─────────────────────────────

test("serializeQaMetafield adds a_html only for answers containing a link", () => {
  const s = serializeQaMetafield([
    { question: "Ohne Link?", answer: "Nur Text." },
    {
      question: "Passendes Zubehör?",
      answer: "Wir empfehlen die [ATX Hantelbank](https://motionsports.de/products/atx-bank).",
      questionEn: "Matching accessories?",
      answerEn: "We recommend the [ATX bench](https://motionsports.de/products/atx-bank).",
    },
  ]);
  const arr = JSON.parse(s);
  assert.equal(arr[0].a_html, undefined);
  assert.equal(
    arr[1].a_html,
    'Wir empfehlen die <a href="https://motionsports.de/products/atx-bank" target="_blank" rel="noopener noreferrer">ATX Hantelbank</a>.'
  );
  assert.equal(
    arr[1].a_en_html,
    'We recommend the <a href="https://motionsports.de/products/atx-bank" target="_blank" rel="noopener noreferrer">ATX bench</a>.'
  );
  // The raw markdown stays the source of truth and survives the round-trip.
  const parsed = parseQaMetafield(s);
  assert.ok(parsed[1].answer.includes("[ATX Hantelbank]("));
});

test("a_html is recomputed from the text on every serialize (no drift)", () => {
  const roundTripped = parseQaMetafield(
    serializeQaMetafield([
      { question: "F?", answer: "Alt: [A](https://a.de/alt)" },
    ])
  );
  const edited = mergeQaList(roundTripped, {
    question: "F?",
    answer: "Neu: [B](https://a.de/neu)",
  });
  const arr = JSON.parse(serializeQaMetafield(edited));
  assert.equal(arr.length, 1);
  assert.ok(arr[0].a_html.includes('href="https://a.de/neu"'));
  assert.ok(!arr[0].a_html.includes("alt"));
});
