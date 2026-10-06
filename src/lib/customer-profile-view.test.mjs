import { test } from "node:test";
import assert from "node:assert/strict";
import {
  groupProfileSections,
  lastProfileActivityAt,
  nextStepKind,
  parseProfileSections,
  profileFreshness,
  PROFILE_OLD_DAYS,
} from "./customer-profile-view.mjs";

/** Every word of the input must survive somewhere in the parse (labels count). */
function assertNoContentLost(input, parsed, { ignore = [] } = {}) {
  const words = (s) => (s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
  const out = new Set(
    words([parsed.intro, ...parsed.sections.flatMap((s) => [s.sourceLabel, s.body])].join(" "))
  );
  const skip = new Set(ignore.flatMap(words));
  const lost = words(input).filter((w) => !skip.has(w) && !out.has(w));
  assert.deepEqual(lost, [], `lost words: ${lost.join(", ")}`);
}

const MODEL_BOLD = `**Bedarf & Ziele:** Katrin möchte zu Hause Kraft aufbauen und den unteren Rücken stabilisieren.

**Niveau & Kontext:** Fortgeschritten, trainierte jahrelang im Studio. Mietwohnung im 2. Stock.

**Vorlieben & Budget-Signale:** Leise, platzsparende Geräte; Bestellungen um 300–500 €.

**Besitzt bereits (Käufe):** Verstellbare Kurzhanteln 2–24 kg, Bodenschutzmatte.

**Offene Punkte / nächste sinnvolle Schritte:** Klappbare Hantelbank fehlt noch.`;

test("the five model labels become five sections in order", () => {
  const p = parseProfileSections(MODEL_BOLD);
  assert.equal(p.structured, true);
  assert.equal(p.intro, "");
  assert.deepEqual(
    p.sections.map((s) => s.key),
    ["needs", "level", "preferences", "owned", "next"]
  );
  assert.deepEqual(
    p.sections.map((s) => s.label),
    ["Bedarf & Ziele", "Niveau & Kontext", "Vorlieben & Budget-Signale", "Besitzt bereits", "Offene Punkte & nächste Schritte"]
  );
  assert.equal(p.sections[0].body, "Katrin möchte zu Hause Kraft aufbauen und den unteren Rücken stabilisieren.");
  assert.equal(p.sections[3].sourceLabel, "Besitzt bereits (Käufe)");
  assertNoContentLost(MODEL_BOLD, p);
});

test("plain, heading, list and bold-outside-colon labels all count", () => {
  const plain = "Bedarf & Ziele: Abnehmen.\nNiveau & Kontext: Einsteigerin.\nBesitzt bereits: nichts.";
  assert.deepEqual(parseProfileSections(plain).sections.map((s) => [s.key, s.body]), [
    ["needs", "Abnehmen."],
    ["level", "Einsteigerin."],
    ["owned", "nichts."],
  ]);

  const headings = "### Bedarf & Ziele\nMuskelaufbau.\n\n### Nächste Schritte:\n- Hantelbank anbieten\n- Lieferzeit klären";
  const h = parseProfileSections(headings);
  assert.deepEqual(h.sections.map((s) => s.key), ["needs", "next"]);
  assert.equal(h.sections[1].body, "- Hantelbank anbieten\n- Lieferzeit klären");

  const list = "- **Bedarf und Ziele**: Ausdauer.\n- **Vorlieben & Budget**: eher günstig.";
  assert.deepEqual(parseProfileSections(list).sections.map((s) => [s.key, s.body]), [
    ["needs", "Ausdauer."],
    ["preferences", "eher günstig."],
  ]);

  const labelLines = "Bedarf & Ziele\nMehr Beweglichkeit.\n\nNiveau & Kontext\nPhysio-Patientin.";
  assert.deepEqual(parseProfileSections(labelLines).sections.map((s) => [s.key, s.body]), [
    ["needs", "Mehr Beweglichkeit."],
    ["level", "Physio-Patientin."],
  ]);
});

test("English labels map onto the same sections", () => {
  const en =
    "**Needs & goals:** Rehab after knee surgery.\n\n**Level & context:** Physio practice.\n\n" +
    "**Preferences & budget signals:** Quiet magnetic resistance.\n\n**Already owns:** Two mats.\n\n" +
    "**Open points / next steps:** Send a B2B offer.";
  const p = parseProfileSections(en);
  assert.deepEqual(p.sections.map((s) => s.key), ["needs", "level", "preferences", "owned", "next"]);
  assert.equal(p.sections[0].label, "Bedarf & Ziele");
  assert.equal(p.sections[0].sourceLabel, "Needs & goals");
  assertNoContentLost(en, p);
});

test("extra paragraphs stay with their section, text before the first label is the intro", () => {
  const text =
    "Julia richtet einen Behandlungsraum ein.\n\n" +
    "**Bedarf & Ziele:** Geräte für die Reha.\n\nFragte auch nach Rechnungen für die Praxis.\n\n" +
    "**Offene Punkte:** B2B-Angebot schicken.\n\nHinweis: Rechnung auf die Praxis.";
  const p = parseProfileSections(text);
  assert.equal(p.intro, "Julia richtet einen Behandlungsraum ein.");
  assert.equal(p.sections[0].body, "Geräte für die Reha.\n\nFragte auch nach Rechnungen für die Praxis.");
  assert.equal(p.sections[1].body, "B2B-Angebot schicken.\n\nHinweis: Rechnung auf die Praxis.");
  assertNoContentLost(text, p);
});

test("a known label in the middle of a line is split off", () => {
  const text = "**Bedarf & Ziele:** Kraft. **Niveau & Kontext:** Profi. Mag **schwere** Gewichte.";
  const p = parseProfileSections(text);
  assert.deepEqual(p.sections.map((s) => [s.key, s.body]), [
    ["needs", "Kraft."],
    ["level", "Profi. Mag **schwere** Gewichte."],
  ]);
  assertNoContentLost(text, p);
});

test("headings that carry text keep it", () => {
  const text = "### **Bedarf & Ziele:** Kraft. **Niveau & Kontext:** Profi.\n## Nächste Schritte: Bank anbieten";
  const p = parseProfileSections(text);
  assert.deepEqual(p.sections.map((s) => [s.key, s.body]), [
    ["needs", "Kraft."],
    ["level", "Profi."],
    ["next", "Bank anbieten"],
  ]);
  assertNoContentLost(text, p);
  // A long heading is text, not a label; a heading with emphasis is an unknown label.
  const q = parseProfileSections("**Ziele:** a\n## **Wichtig** ist ihr die Lautstärke\nleise Geräte");
  assert.deepEqual(q.sections.map((s) => s.key), ["needs", "other"]);
  assertNoContentLost("**Ziele:** a\n## **Wichtig** ist ihr die Lautstärke\nleise Geräte", q);
});

test("unknown bold labels become their own section next to known ones", () => {
  const text = "**Bedarf & Ziele:** Kraft.\n\n**Lieferung:** Nur samstags zustellen.";
  const p = parseProfileSections(text);
  assert.deepEqual(p.sections.map((s) => [s.key, s.label, s.body]), [
    ["needs", "Bedarf & Ziele", "Kraft."],
    ["other", "Lieferung", "Nur samstags zustellen."],
  ]);
});

test("emphasis and sentences with a colon are not labels", () => {
  const text = "**Bedarf & Ziele:** Kraft.\n**Wichtig** ist ihr die Lautstärke.\nZiel des Kunden ist es, im Winter weiterzutrainieren: drinnen.";
  const p = parseProfileSections(text);
  assert.equal(p.sections.length, 1);
  assert.match(p.sections[0].body, /\*\*Wichtig\*\* ist ihr/);
  assert.match(p.sections[0].body, /Ziel des Kunden ist es/);
});

test("old free-text profiles come back unsplit, minus a title that repeats the card", () => {
  const old =
    "**Aktuelles Verständnis**\n\nSarah trainiert zu Hause im Wohnzimmer. Budgetrahmen ca. 700 €. Fragt häufig nach Lieferzeiten.";
  const p = parseProfileSections(old);
  assert.equal(p.structured, false);
  assert.deepEqual(p.sections, []);
  assert.equal(p.intro, "Sarah trainiert zu Hause im Wohnzimmer. Budgetrahmen ca. 700 €. Fragt häufig nach Lieferzeiten.");
  assertNoContentLost(old, p, { ignore: ["Aktuelles Verständnis"] });

  const prose = "Kauft regelmäßig Zubehör.\n\n**Hinweis:** Kein Interesse an Großgeräten.";
  const q = parseProfileSections(prose);
  assert.equal(q.structured, false);
  assert.equal(q.intro, prose);
});

test("a title in the middle of the text is kept", () => {
  const text = "**Bedarf & Ziele:** Kraft.\n\n**Kundenprofil**\n\nWeitere Notizen.";
  const p = parseProfileSections(text);
  assert.deepEqual(p.sections.map((s) => s.key), ["needs", "other"]);
  assert.equal(p.sections[1].body, "Weitere Notizen.");
});

test("empty, null and label-only inputs are safe", () => {
  assert.deepEqual(parseProfileSections(null), { structured: false, intro: "", sections: [] });
  assert.deepEqual(parseProfileSections("   \n "), { structured: false, intro: "", sections: [] });
  const onlyLabels = parseProfileSections("**Bedarf & Ziele:**\n\n**Niveau & Kontext:** Profi.");
  assert.deepEqual(onlyLabels.sections.map((s) => s.key), ["level"]);
  // An unknown empty label is kept as text, never dropped.
  const strayLabel = parseProfileSections("**Bedarf & Ziele:** Kraft.\n\n**Sonstiges**");
  assert.equal(strayLabel.sections.length, 1);
  assert.match(strayLabel.sections[0].body, /\*\*Sonstiges\*\*/);
});

test("Windows line breaks and duplicated labels", () => {
  const text = "**Ziele:** A.\r\n\r\n**Ziele:** B.";
  const p = parseProfileSections(text);
  assert.deepEqual(p.sections.map((s) => [s.key, s.body]), [
    ["needs", "A."],
    ["needs", "B."],
  ]);
});

test("nextStepKind picks the icon family", () => {
  assert.equal(nextStepKind("Klappbare Hantelbank anbieten — zweimal im Chat gefragt"), "offer");
  assert.equal(nextStepKind("Lieferzeit nach Hamburg beantworten"), "clarify");
  assert.equal(nextStepKind("In Kampagnen Zubehör statt Großgeräte zeigen"), "contact");
  assert.equal(nextStepKind("Rückentrainer als Ergänzung zeigen"), "offer");
  assert.equal(nextStepKind("Im Frühjahr an Outdoor-Zubehör erinnern"), "contact");
  assert.equal(nextStepKind("Zum Saisonstart im Herbst wieder aufgreifen"), "timing");
  assert.equal(nextStepKind("Send a B2B offer for two ergometers"), "offer");
  assert.equal(nextStepKind("Hantelbank"), "step");
  assert.equal(nextStepKind(null), "step");
});

test("profileFreshness: unknown, fresh, behind the activity, old", () => {
  const now = Date.parse("2026-10-06T12:00:00Z");
  assert.deepEqual(profileFreshness({ updatedAt: null, now }), { state: "unknown", ageDays: null });
  assert.deepEqual(profileFreshness({ updatedAt: "kaputt", now }), { state: "unknown", ageDays: null });
  assert.deepEqual(profileFreshness({ updatedAt: "2026-10-04T08:00:00Z", now }), { state: "fresh", ageDays: 2 });
  assert.deepEqual(
    profileFreshness({ updatedAt: "2026-10-04T08:00:00Z", lastActivityAt: "2026-10-05T09:00:00Z", now }),
    { state: "behind", ageDays: 2 }
  );
  // The run's own input (activity right before / at the Stand) is not news.
  assert.equal(
    profileFreshness({ updatedAt: "2026-10-04T08:00:00Z", lastActivityAt: "2026-10-04T08:00:30Z", now }).state,
    "fresh"
  );
  const old = new Date(now - PROFILE_OLD_DAYS * 86_400_000).toISOString();
  assert.equal(profileFreshness({ updatedAt: old, now }).state, "old");
  // New activity wins over age: it is the actionable reason.
  assert.equal(profileFreshness({ updatedAt: old, lastActivityAt: "2026-10-01T00:00:00Z", now }).state, "behind");
});

test("lastProfileActivityAt ignores consent changes and bad dates", () => {
  assert.equal(lastProfileActivityAt(null), null);
  assert.equal(
    lastProfileActivityAt([
      { at: "2026-10-05T10:00:00Z", kind: "consent" },
      { at: "2026-09-01T10:00:00Z", kind: "order" },
      { at: "2026-09-20T10:00:00Z", kind: "mail_in" },
      { at: "nicht-datum", kind: "chat" },
    ]),
    "2026-09-20T10:00:00Z"
  );
});

test("fuzz: whatever the mix of labels and prose, no word is lost", () => {
  let seed = 42;
  const rand = (n) => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed % n;
  };
  const labels = [
    "Bedarf & Ziele", "Niveau & Kontext", "Vorlieben & Budget-Signale", "Besitzt bereits (Käufe)",
    "Offene Punkte / nächste sinnvolle Schritte", "Needs & goals", "Already owns", "Next steps", "Lieferung", "Hinweis",
  ];
  const forms = [
    (l, b) => `**${l}:** ${b}`, (l, b) => `**${l}**: ${b}`, (l, b) => `${l}: ${b}`, (l, b) => `### ${l}\n${b}`,
    (l, b) => `- **${l}:** ${b}`, (l, b) => `**${l}**\n${b}`, (l, b) => `${b} **${l}:** ${b}`, (l, b) => `## ${l}: ${b}`,
  ];
  const bodies = [
    "Kraftaufbau zu Hause mit Kurzhanteln.", "Ziel: leiser trainieren.", "- Hantelbank\n- Bodenmatte",
    "Budget ca. 700 €, vergleicht Preise.", "**Wichtig** ist ihr die Lautstärke.", "Fragte nach Lieferzeiten.",
  ];
  for (let i = 0; i < 400; i++) {
    const parts = [];
    const n = 1 + rand(6);
    for (let j = 0; j < n; j++) {
      parts.push(rand(4) === 0 ? bodies[rand(bodies.length)] : forms[rand(forms.length)](labels[rand(labels.length)], bodies[rand(bodies.length)]));
    }
    const text = parts.join(rand(2) ? "\n\n" : "\n");
    assertNoContentLost(text, parseProfileSections(text));
  }
});

test("groupProfileSections joins a repeated label and keeps unknown ones apart", () => {
  const p = parseProfileSections("**Ziele:** A.\n\n**Lieferung:** Samstags.\n\n**Ziele:** B.\n\n**Besitzt bereits:** Matte.");
  const g = groupProfileSections(p.sections);
  assert.deepEqual(g.bodies, { needs: "A.\n\nB.", level: null, preferences: null, owned: "Matte.", next: null });
  assert.deepEqual(g.others.map((s) => [s.label, s.body]), [["Lieferung", "Samstags."]]);
  assert.deepEqual(groupProfileSections([]).others, []);
});
