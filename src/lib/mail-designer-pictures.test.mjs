import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DESIGNER_PICTURE_LIMITS,
  PICTURE_ASPECTS,
  PICTURE_INPUT_SCHEMA,
  PICTURE_PURPOSES,
  PICTURE_STORE_WIDTH,
  PICTURE_TEXT_CHECK_PROMPT,
  createPictureStudio,
  designerPictureAttempts,
  designerPicturePrompt,
  forbiddenPictureText,
  isPictureRefusal,
  normalizePictureText,
  parsePictureInput,
  pictureCrop,
  pictureFailureReason,
  pictureIndexFromUrl,
  pictureLabel,
  picturePlaceholderUrl,
  pictureRefIndex,
  pictureTextVerdict,
  pictureTextWarning,
  pictureUnavailableAnswer,
  renderPictureWithCheck,
} from "./mail-designer-pictures.mjs";
import { DESIGNER_PICTURES_PER_RUN } from "./mail-template-designer-settings.mjs";

// ── fixtures ─────────────────────────────────────────────────────────────────

const HERO = Object.freeze({
  purpose: "hero",
  aspect: "wide",
  prompt: "A dark home gym at dusk, warm rim light on a power rack, colours #111111 and #ffd400, calm area at the top for the lettering.",
  textInImage: "Winter-Power",
  name: "Titelbild mit Überschrift",
});
const TAPE = Object.freeze({
  purpose: "decoration",
  aspect: "banner",
  prompt: "A yellow and black barrier tape running diagonally across, top half solid #111111, bottom half solid #ffffff.",
  transparent: true,
});

/** A render that delivers at once (or after `ms`), with one billed call. */
const okRender =
  (ms = 0, model = "gpt-image-2") =>
  async (job, o) => {
    if (ms) {
      await new Promise((resolve, reject) => {
        const t = setTimeout(resolve, ms);
        o?.signal?.addEventListener("abort", () => {
          clearTimeout(t);
          reject(o.signal.reason);
        });
      });
    }
    return {
      ok: true,
      image: { bytes: new Uint8Array([1, 2, 3]), width: job.width, height: job.height, transparent: Boolean(job.transparent), model },
      calls: [{ model, usage: { inputTokens: 150, outputTokens: 6200, cacheReadTokens: 0, cacheWriteTokens: 0 }, usageComplete: true }],
      warnings: [],
    };
  };

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

// ── vocabulary ───────────────────────────────────────────────────────────────

test("the vocabulary: purposes, formats gpt-image-2 renders (multiples of 16, at most 3:1), the placeholders", () => {
  assert.deepEqual(PICTURE_PURPOSES, ["hero", "banner", "background", "decoration", "icon", "scene"]);
  assert.deepEqual(
    Object.entries(PICTURE_ASPECTS).map(([k, a]) => [k, a.size]),
    [
      ["wide", "1536x1024"],
      ["banner", "1536x512"],
      ["square", "1024x1024"],
      ["tall", "1024x1536"],
    ]
  );
  for (const a of Object.values(PICTURE_ASPECTS)) {
    assert.equal(a.width % 16, 0);
    assert.equal(a.height % 16, 0);
    assert.ok(Math.max(a.width, a.height) / Math.min(a.width, a.height) <= 3);
    assert.ok(["1536x1024", "1024x1024", "1024x1536"].includes(a.classic), "the fallback is a classic size");
  }
  assert.equal(DESIGNER_PICTURE_LIMITS.perRun, DESIGNER_PICTURES_PER_RUN);
  assert.equal(DESIGNER_PICTURE_LIMITS.perRun, 3);
  assert.equal(PICTURE_STORE_WIDTH.icon < PICTURE_STORE_WIDTH.hero, true);
  // https://bild.invalid/N — RFC 2606, never resolves; the short form bild:N
  assert.equal(picturePlaceholderUrl(2), "https://bild.invalid/2");
  assert.equal(pictureIndexFromUrl("https://bild.invalid/2"), 2);
  assert.equal(pictureIndexFromUrl(" https://BILD.invalid/12/ "), 12);
  for (const no of ["https://bild.invalid/", "https://bild.invalid/123", "http://bild.invalid/1", "https://anhang.invalid/1", null]) assert.equal(pictureIndexFromUrl(no), null, String(no));
  assert.equal(pictureRefIndex("bild:3"), 3);
  assert.equal(pictureRefIndex(" Bild : 4 "), 4);
  assert.equal(pictureRefIndex("anhang:1"), null);
  // the tool's schema: the required fields and German descriptions
  assert.deepEqual(PICTURE_INPUT_SCHEMA.required, ["purpose", "prompt", "aspect"]);
  for (const key of ["purpose", "prompt", "aspect", "textInImage", "transparent", "productRefs", "name", "realistic"]) {
    assert.ok(PICTURE_INPUT_SCHEMA.properties[key]?.description?.length > 20, key);
  }
  assert.match(PICTURE_INPUT_SCHEMA.properties.textInImage.description, /höchstens 60 Zeichen/);
  assert.match(PICTURE_INPUT_SCHEMA.properties.productRefs.description, /echten Katalogfotos/);
});

test("parsePictureInput: lenient where a default is obvious, strict about what ends up in the picture", () => {
  const ok = parsePictureInput({ ...HERO, productRefs: ["a", "a", "b", "c", "d", "e", 7] });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.ok && ok.value, {
    purpose: "hero",
    prompt: HERO.prompt,
    aspect: "wide",
    text: "Winter-Power",
    transparent: false,
    productRefs: ["a", "b", "c", "d"],
    name: "Titelbild mit Überschrift",
    realistic: true,
  });
  // a missing or unknown format → the purpose's own; realism by purpose unless set
  const tape = parsePictureInput({ ...TAPE, aspect: "panorama" });
  assert.equal(tape.ok && tape.value.aspect, "banner");
  assert.equal(tape.ok && tape.value.realistic, false);
  assert.equal(tape.ok && tape.value.transparent, true);
  assert.equal(parsePictureInput({ purpose: "icon", prompt: "A dumbbell icon, flat, #e30613 stroke" }).value?.aspect, "square");
  assert.equal(parsePictureInput({ ...HERO, realistic: false }).value?.realistic, false);
  assert.equal(parsePictureInput({ ...HERO, purpose: " SCENE " }).value?.purpose, "scene");
  // the problems (the call then does not count)
  const bad = parsePictureInput({ purpose: "poster", prompt: "x", textInImage: "Nur 99 € bis 30.11.!" });
  assert.equal(bad.ok, false);
  assert.equal(bad.ok ? 0 : bad.problems.length, 3);
  assert.match(bad.ok ? "" : bad.problems.join("\n"), /purpose fehlt oder ist unbekannt/);
  assert.match(bad.ok ? "" : bad.problems.join("\n"), /prompt fehlt/);
  assert.match(bad.ok ? "" : bad.problems.join("\n"), /textInImage: Preise gehören nie ins Bild/);
  const long = parsePictureInput({ ...HERO, textInImage: "x".repeat(61) });
  assert.match(long.ok ? "" : long.problems[0], /zu lang \(61 Zeichen, höchstens 60\)/);
  assert.match(parsePictureInput({ ...HERO, textInImage: "Hallo {{vorname}}" }).problems?.[0] ?? "", /Platzhalter/);
  // the prompt may not ask for prices or links — a percentage of the frame is composition
  assert.equal(parsePictureInput({ ...HERO, prompt: `${HERO.prompt} A sign reading 49,99 €.` }).ok, false);
  assert.equal(parsePictureInput({ ...HERO, prompt: `${HERO.prompt} Logo of www.example.com.` }).ok, false);
  assert.equal(parsePictureInput({ ...HERO, prompt: `${HERO.prompt} The left 40 % of the frame stays calm.` }).ok, true);
  assert.equal(parsePictureInput(null).ok, false);
});

test("forbiddenPictureText: prices, percentages, codes, dates, times, links, phone numbers — headlines pass", () => {
  const cases = {
    "Winter-Power": null,
    "BLACK WEEK": null,
    "Dein Home-Gym. Jetzt.": null,
    "Black Week 2026": null,
    "Größer. Stärker. Leiser.": null,
    "Nur 49 €": "Preise",
    "€ 49": "Preise",
    "25 % auf alles": "Prozente",
    "30 Prozent": "Prozente",
    "Code BLACK25": "Codes",
    "WEEK-30": "Codes",
    "bis 30.11.": "Daten oder Uhrzeiten",
    "Ab 24. Dezember": "Daten oder Uhrzeiten",
    "Endet 23:59": "Daten oder Uhrzeiten",
    "Bis 18 Uhr": "Daten oder Uhrzeiten",
    "motionsports.de": "Links oder Adressen",
    "info@motionsports.de": "Links oder Adressen",
    "+49 8142 448666": "Telefonnummern",
  };
  for (const [text, want] of Object.entries(cases)) assert.equal(forbiddenPictureText(text), want, text);
});

// ── the image model ──────────────────────────────────────────────────────────

test("the image prompt: the purpose's brief, the description, the format, exactly this text or none, transparency, references", () => {
  const job = parsePictureInput(HERO).value;
  const p = designerPicturePrompt(job);
  assert.match(p, /^An e-mail hero visual/);
  assert.ok(p.includes(HERO.prompt));
  assert.match(p, /Format: 1536×1024 px \(landscape 3:2\)\./);
  assert.match(p, /Render this text exactly once, letter for letter, and no other words, letters or numbers anywhere in the picture: "Winter-Power"\./);
  assert.ok(!p.includes("Spelling matters"), "the spelling stress only for a re-render");
  assert.match(designerPicturePrompt(job, { emphasizeText: true }), /Spelling matters more than anything else: the text has 12 characters and must read exactly "Winter-Power"/);
  assert.match(p, /Never show prices, percentages, discount codes, dates, web addresses or brand logos/);
  assert.ok(!/Transparent background/.test(p));
  // no text: no lettering at all; transparency; the banner rendered in 3:2 is composed for its crop
  const tape = parsePictureInput(TAPE).value;
  const t = designerPicturePrompt(tape, { size: "1536x1024", cropTo: "banner" });
  assert.match(t, /No text at all: no letters, words, numbers, logos, signs or watermarks\./);
  assert.match(t, /Transparent background: only the element itself/);
  assert.match(t, /Format: rendered at 1536×1024 px, but only the middle band of 1536×512 px \(a wide 3:1 band\) is used/);
  assert.match(designerPicturePrompt(tape), /Format: 1536×512 px \(a wide 3:1 band\)\./);
  // reference photos: the hero pipeline's numbered block
  const withRefs = designerPicturePrompt({ ...job, text: "" }, { references: [{ label: "ATX® Power Rack 620", role: "new" }] });
  assert.match(withRefs, /REFERENCE PHOTOS: the attached pictures are catalogue photos of the exact products to show — picture 1 = ATX® Power Rack 620/);
  assert.equal(pictureLabel(job), "Titelbild mit Überschrift");
  assert.equal(pictureLabel({ ...job, name: "" }), "Titelbereich „Winter-Power“");
  assert.equal(pictureLabel(tape), "Schmuckelement");
});

test("designerPictureAttempts: the hero pipeline's chain in the picture's own format", () => {
  const sizes = (list) => list.map((a) => `${a.mode}:${a.model}:${a.size}${a.cropTo ? `→${a.cropTo}` : ""}`);
  assert.deepEqual(sizes(designerPictureAttempts({}, { aspect: "wide" })), ["generate:gpt-image-2:1536x1024", "generate:gpt-image-1.5:1536x1024"]);
  // a banner: its free size first, then 3:2 cropped to 3:1, then the previous model
  assert.deepEqual(sizes(designerPictureAttempts({}, { aspect: "banner" })), [
    "generate:gpt-image-2:1536x512",
    "generate:gpt-image-2:1536x1024→banner",
    "generate:gpt-image-1.5:1536x1024→banner",
  ]);
  // reference photos: edits first; gpt-image-2 takes no input_fidelity
  const refs = designerPictureAttempts({}, { aspect: "square", withReferences: true });
  assert.deepEqual(sizes(refs), ["edit:gpt-image-2:1024x1024", "generate:gpt-image-2:1024x1024", "generate:gpt-image-1.5:1024x1024"]);
  assert.equal(refs[0].inputFidelity, undefined);
  assert.equal(designerPictureAttempts({ EMAIL_HERO_IMAGE_MODEL: "gpt-image-1.5" }, { withReferences: true })[0].inputFidelity, "high");
  // transparency on every attempt; quality and model from the hero's env
  assert.ok(designerPictureAttempts({}, { aspect: "banner", transparent: true }).every((a) => a.background === "transparent"));
  assert.ok(designerPictureAttempts({}, { aspect: "wide" }).every((a) => a.quality === "high" && !a.background));
  assert.ok(designerPictureAttempts({ EMAIL_HERO_IMAGE_QUALITY: "medium" }).every((a) => a.quality === "medium"));
  assert.deepEqual(sizes(designerPictureAttempts({ EMAIL_HERO_IMAGE_MODEL: "gpt-image-1.5" }, { aspect: "tall" })), ["generate:gpt-image-1.5:1024x1536"]);
  assert.deepEqual(sizes(designerPictureAttempts({}, { aspect: "bogus" })), sizes(designerPictureAttempts({}, { aspect: "wide" })));
});

test("pictureCrop: a 3:2 render becomes its middle 3:1 band; a fitting picture stays", () => {
  assert.deepEqual(pictureCrop(1536, 1024, "banner"), { left: 0, top: 256, width: 1536, height: 512 });
  assert.equal(pictureCrop(1536, 512, "banner"), null);
  assert.equal(pictureCrop(1536, 1024, "wide"), null);
  assert.deepEqual(pictureCrop(1024, 1024, "tall"), { left: 171, top: 0, width: 683, height: 1024 });
  assert.equal(pictureCrop(0, 10, "wide"), null);
  assert.equal(pictureCrop(10, 10, "bogus"), null);
});

// ── the text check ───────────────────────────────────────────────────────────

test("the text check: transcribed without the expected text, compared letter for letter (case, punctuation, ß/SS aside)", () => {
  assert.equal(normalizePictureText("WINTER–POWER!"), "winter power");
  assert.equal(normalizePictureText("Groß. Stärker."), "gross stärker");
  assert.equal(normalizePictureText("GROSS STÄRKER"), "gross stärker");
  assert.deepEqual(pictureTextVerdict({ expected: "Winter-Power", read: "WINTER POWER", legible: true }), { pass: true, score: 1, read: "WINTER POWER" });
  const umlaut = pictureTextVerdict({ expected: "Stärker", read: "Starker", legible: true });
  assert.equal(umlaut.pass, false);
  assert.ok(umlaut.score > 0.8 && umlaut.score < 1);
  assert.equal(pictureTextVerdict({ expected: "Winter-Power", read: "Winter-Power", legible: false }).pass, false, "illegible");
  assert.equal(pictureTextVerdict({ expected: "Winter-Power", read: "Winter-Power Trining", legible: true }).pass, false, "extra lettering");
  assert.equal(pictureTextVerdict({ expected: "Winter", read: "", legible: true }).score, 0);
  assert.match(PICTURE_TEXT_CHECK_PROMPT, /Transcribe ALL lettering/);
  assert.ok(!/Winter/.test(PICTURE_TEXT_CHECK_PROMPT), "the expected text is never in the check's prompt");
  assert.equal(
    pictureTextWarning({ n: 2, text: "Winter-Power" }, { read: "Wnter-Power" }),
    "Bild 2: Der Text im Bild ist nicht sicher richtig (erwartet „Winter-Power“, gelesen „Wnter-Power“) — bitte prüfen oder das Bild neu erzeugen lassen."
  );
});

test("renderPictureWithCheck: right text — one render; wrong — one re-render with the spelling stressed; still wrong — the better one with a warning", async () => {
  const job = { ...parsePictureInput(HERO).value, n: 1, width: 1536, height: 1024, label: "Titelbild" };
  const call = (model) => ({ model, usage: { inputTokens: 10, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0 }, usageComplete: true });
  /** renders numbered images; checkText reads `reads[i]` for the i-th render */
  const setup = (reads) => {
    const renders = [];
    const deps = {
      renderOnce: async (j, o) => {
        renders.push(o);
        return { ok: true, image: { bytes: new Uint8Array([renders.length]), width: 1, height: 1, transparent: false, model: "gpt-image-2" }, calls: [call("gpt-image-2")], warnings: [] };
      },
      checkText: async (image, expected) => ({ verdict: pictureTextVerdict({ expected, read: reads[image.bytes[0] - 1], legible: true }), calls: [call("claude-sonnet-5-5")] }),
    };
    return { renders, deps };
  };
  const right = setup(["WINTER-POWER"]);
  const r1 = await renderPictureWithCheck(job, right.deps);
  assert.equal(r1.ok, true);
  assert.equal(right.renders.length, 1);
  assert.deepEqual(r1.warnings, []);
  assert.deepEqual(r1.calls.map((c) => c.model), ["gpt-image-2", "claude-sonnet-5-5"]);

  const fixed = setup(["Wnter-Power", "Winter-Power"]);
  const r2 = await renderPictureWithCheck(job, fixed.deps);
  assert.equal(fixed.renders.length, 2);
  assert.deepEqual(fixed.renders.map((o) => [o.attempt, o.emphasizeText]), [[1, false], [2, true]]);
  assert.equal(r2.ok && r2.image.bytes[0], 2, "the passing second render");
  assert.equal(r2.rerendered, true);
  assert.deepEqual(r2.warnings, []);
  assert.equal(r2.calls.length, 4, "two renders, two checks — all billed");

  const worse = setup(["Wnter-Power", "XYZ"]);
  const r3 = await renderPictureWithCheck(job, worse.deps);
  assert.equal(r3.ok && r3.image.bytes[0], 1, "the first, closer one is kept");
  assert.match(r3.warnings[0], /^Bild 1: Der Text im Bild ist nicht sicher richtig \(erwartet „Winter-Power“, gelesen „Wnter-Power“\)/);

  // no time for a second render: the picture stays, with the warning
  const late = setup(["Wnter-Power"]);
  const r4 = await renderPictureWithCheck(job, { ...late.deps, deadlineAt: 1_000_000 + DESIGNER_PICTURE_LIMITS.rerenderMinMs - 1, now: () => 1_000_000 });
  assert.equal(late.renders.length, 1);
  assert.match(r4.warnings[0], /nicht sicher richtig/);

  // a check that cannot run keeps the picture silently; no text — no check
  const broken = setup([]);
  const r5 = await renderPictureWithCheck(job, { ...broken.deps, checkText: async () => Promise.reject(new Error("vision down")) });
  assert.equal(r5.ok, true);
  assert.deepEqual(r5.warnings, []);
  let checked = 0;
  await renderPictureWithCheck({ ...job, text: "" }, { ...right.deps, checkText: async () => (checked++, null) });
  assert.equal(checked, 0);

  // a render that fails: the reason, its calls kept
  const failed = await renderPictureWithCheck(job, { renderOnce: async () => ({ ok: false, reason: "Fehler beim Bilddienst", calls: [call("gpt-image-2")] }) });
  assert.deepEqual([failed.ok, failed.reason, failed.calls.length], [false, "Fehler beim Bilddienst", 1]);
});

test("pictureFailureReason: time, cancel, the content policy, overload, the key — refusals end the attempt chain", () => {
  const timeout = new AbortController();
  timeout.abort(Object.assign(new Error("t"), { name: "TimeoutError" }));
  assert.equal(pictureFailureReason(new Error("aborted"), timeout.signal), "nicht rechtzeitig fertig");
  const cancel = new AbortController();
  cancel.abort(Object.assign(new Error("c"), { name: "AbortError" }));
  assert.equal(pictureFailureReason(new Error("x"), cancel.signal), "abgebrochen");
  const refused = Object.assign(new Error("400 Your request was rejected as a result of our safety system."), { status: 400, code: "moderation_blocked" });
  assert.equal(pictureFailureReason(refused), "vom Bilddienst abgelehnt — das Motiv anders beschreiben");
  assert.equal(isPictureRefusal(refused), true);
  assert.equal(isPictureRefusal(Object.assign(new Error("Bad size"), { status: 400 })), false);
  assert.equal(pictureFailureReason(Object.assign(new Error("Rate limit reached"), { status: 429 })), "der Bilddienst ist gerade ausgelastet");
  assert.equal(pictureFailureReason(Object.assign(new Error("Incorrect API key"), { status: 401 })), "der OpenAI-Schlüssel wurde abgelehnt");
  assert.equal(pictureFailureReason(new Error("socket hang up")), "Fehler beim Bilddienst");
  assert.equal(pictureFailureReason(null), "Fehler beim Bilddienst");
});

// ── the studio ───────────────────────────────────────────────────────────────

test("the studio answers at once with a placeholder while the picture renders in the background", async () => {
  const lines = [];
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  const studio = createPictureStudio({
    render: async (job) => {
      await gate;
      return okRender()(job);
    },
    onProgress: (t) => lines.push(t),
  });
  const res = studio.request(HERO);
  assert.equal(res.progress, "Lässt ein Bild erzeugen: Titelbild mit Überschrift …");
  assert.equal(res.answer.ok, true);
  assert.equal(res.answer.src, "https://bild.invalid/1");
  assert.deepEqual([res.answer.picture, res.answer.width, res.answer.height, res.answer.heightAt600, res.answer.picturesLeft], [1, 1536, 1024, 400, 2]);
  assert.match(res.answer.note, /entsteht jetzt im Hintergrund/);
  assert.match(res.answer.note, /Der Text „Winter-Power“ gehört auch in den alt-Text/);
  // still rendering: pending for the check, its cost not known yet
  assert.deepEqual(studio.pictures().map((p) => [p.n, p.status, p.text, p.realistic]), [[1, "pending", "Winter-Power", true]]);
  assert.equal(studio.calls()[0].usageComplete, false);
  release();
  const settled = await studio.settle();
  assert.equal(settled[0].status, "ready");
  assert.deepEqual(studio.pictures()[0].status, "ready");
  assert.equal(studio.produced(), 1);
  assert.deepEqual(studio.calls(), [{ model: "gpt-image-2", usage: { inputTokens: 150, outputTokens: 6200, cacheReadTokens: 0, cacheWriteTokens: 0 }, usageComplete: true }]);
  assert.deepEqual(lines, ["Wartet auf das Bild …", "Bild fertig"]);
  // a transparent decoration, an icon in px
  const tape = studio.request(TAPE).answer;
  assert.deepEqual([tape.src, tape.width, tape.height, tape.heightAt600, tape.transparent], ["https://bild.invalid/2", 1536, 512, 200, true]);
  assert.match(studio.request({ purpose: "icon", prompt: "A dumbbell icon, flat, #e30613" }).answer.note, /width in px \(z\. B\. 56 für ein Icon\)/);
  await studio.settle();
  assert.ok(lines.includes("Bild 2 von 3 fertig") || lines.includes("Bild 3 von 3 fertig"));
  // only a tall or square picture is offered as the phone version of a wide one
  assert.doesNotMatch(res.answer.note, /mobileSrc/);
  const phone = createPictureStudio({ render: okRender() }).request({ ...HERO, aspect: "tall" }).answer;
  assert.match(phone.note, /oder als Handy-Fassung eines breiten Bildes: mobileSrc des image-Bausteins bzw\. bgImageMobile des Abschnitts/);
});

test("the studio: at most three pictures, invalid input does not count, a failed one frees its place, no picture without time or with unknown refs", async () => {
  let rendered = 0;
  let fail = true;
  const studio = createPictureStudio({
    render: async (job) => {
      rendered++;
      if (fail) {
        fail = false;
        return { ok: false, reason: "vom Bilddienst abgelehnt — das Motiv anders beschreiben", calls: [] };
      }
      return okRender()(job);
    },
    checkRefs: (refs) => ({ unknown: refs.filter((r) => r !== "atx®-hantelbank") }),
  });
  // invalid: answered with the problems, nothing started
  const bad = studio.request({ purpose: "hero", prompt: "x" });
  assert.equal(bad.answer.ok, false);
  assert.match(bad.answer.problems[0], /prompt fehlt/);
  assert.match(bad.answer.hint, /zählt nicht/);
  const unknownRef = studio.request({ ...HERO, productRefs: ["atx®-hantelbank", "erfunden"] });
  assert.match(unknownRef.answer.problems[0], /productRefs: „erfunden“ gibt es im Katalog nicht/);
  assert.equal(rendered, 0);
  // the first fails — its place is free again
  assert.equal(studio.request({ ...HERO, productRefs: ["atx®-hantelbank"] }).answer.ok, true);
  await studio.settle();
  assert.equal(studio.pictures()[0].status, "failed");
  assert.match(studio.pictures()[0].reason, /abgelehnt/);
  for (let i = 0; i < 3; i++) assert.equal(studio.request(HERO).answer.ok, true, `picture ${i + 2}`);
  const over = studio.request(HERO);
  assert.equal(over.answer.ok, false);
  assert.match(over.answer.note, /^Höchstens 3 Bilder pro Auftrag — dieses Bild wurde nicht erzeugt/);
  assert.equal(over.progress, undefined);
  assert.deepEqual(studio.pictures().map((p) => p.n), [1, 2, 3, 4]);
  // too little time left before the model's deadline
  const late = createPictureStudio({ render: okRender(), deadlineAt: 1_000_000, now: () => 1_000_000 - DESIGNER_PICTURE_LIMITS.startMinMs + 1 });
  assert.match(late.request(HERO).answer.note, /Für ein neues Bild reicht die Zeit nicht mehr/);
  assert.deepEqual(late.pictures(), []);
});

test("the studio when pictures are off or not configured: the tool stays and says so", () => {
  for (const state of ["off", "unavailable"]) {
    let rendered = 0;
    const studio = createPictureStudio({ state, render: async () => (rendered++, okRender()({ width: 1, height: 1 })) });
    const res = studio.request(HERO);
    assert.deepEqual(res.answer, pictureUnavailableAnswer(state));
    assert.equal(res.progress, undefined);
    assert.equal(rendered, 0);
    assert.deepEqual(studio.pictures(), []);
  }
  assert.match(pictureUnavailableAnswer("off").note, /Das Team hat das Erzeugen von Bildern ausgeschaltet/);
  assert.match(pictureUnavailableAnswer("unavailable").note, /Bilder können hier nicht erzeugt werden/);
});

test("the studio settles: waits for the used pictures until `until`, aborts the unused at once, a late render fails with an unknown cost", async () => {
  const lines = [];
  const studio = createPictureStudio({ render: okRender(400), onProgress: (t) => lines.push(t) });
  studio.request(HERO); // 1 — used, too slow for `until`
  studio.request(TAPE); // 2 — not used
  const t0 = Date.now();
  const settled = await studio.settle({ used: [1], until: Date.now() + 60 });
  assert.ok(Date.now() - t0 < 400, "did not wait for the slow render");
  assert.deepEqual(settled.map((s) => [s.n, s.status]), [
    [1, "failed"],
    [2, "failed"],
  ]);
  assert.deepEqual(studio.pictures().map((p) => p.reason), ["nicht rechtzeitig fertig", "nicht verwendet"]);
  assert.ok(lines.includes("Wartet auf das Bild …"));
  assert.ok(lines.some((l) => /^Bild 1 \(„Titelbild mit Überschrift“\) konnte nicht erzeugt werden — nicht rechtzeitig fertig$/.test(l)));
  assert.ok(!lines.some((l) => /^Bild 2/.test(l)), "no line for a picture nobody uses");
  assert.ok(studio.calls().every((c) => c.usageComplete === false), "their cost is not known");
  assert.equal(studio.produced(), 0);

  // the model's deadline ends a render on its own (plus the grace): a clock that jumps from the
  // start check (just enough time) to the start of the render (20 ms before deadline + grace)
  let reads = 0;
  const clock = () => (reads++ === 0 ? 0 : DESIGNER_PICTURE_LIMITS.startMinMs + DESIGNER_PICTURE_LIMITS.afterDeadlineMs - 20);
  const timed = createPictureStudio({ render: okRender(500), deadlineAt: DESIGNER_PICTURE_LIMITS.startMinMs, now: clock });
  assert.equal(timed.request(HERO).answer.ok, true);
  await tick(80);
  assert.deepEqual(timed.pictures().map((p) => [p.status, p.reason]), [["failed", "nicht rechtzeitig fertig"]]);

  // the operator goes away: every render aborted
  const cancel = new AbortController();
  const gone = createPictureStudio({ render: okRender(500), cancelSignal: cancel.signal });
  gone.request(HERO);
  cancel.abort(Object.assign(new Error("Die Verbindung wurde getrennt."), { name: "AbortError" }));
  await tick(10);
  assert.deepEqual(gone.pictures().map((p) => [p.status, p.reason]), [["failed", "abgebrochen"]]);

  // abort() and a render that throws: failed pictures, never an exception
  const errors = [];
  const thrower = createPictureStudio({ render: async () => Promise.reject(new Error("boom")), onError: (e) => errors.push(e.message) });
  thrower.request(HERO);
  await thrower.settle();
  assert.deepEqual([thrower.pictures()[0].status, thrower.pictures()[0].reason, errors], ["failed", "Fehler beim Bilddienst", ["boom"]]);
  const stopped = createPictureStudio({ render: okRender(500) });
  stopped.request(HERO);
  stopped.abort();
  await tick(10);
  assert.equal(stopped.pictures()[0].reason, "abgebrochen");
});

test("a finished picture's own warnings reach the check and the final swap", async () => {
  const studio = createPictureStudio({
    render: async (job) => ({ ...(await okRender()(job)), warnings: [pictureTextWarning(job, { read: "Wnter" })] }),
  });
  studio.request(HERO);
  await studio.settle();
  assert.deepEqual(studio.pictures()[0].warnings, ["Bild 1: Der Text im Bild ist nicht sicher richtig (erwartet „Winter-Power“, gelesen „Wnter“) — bitte prüfen oder das Bild neu erzeugen lassen."]);
});
