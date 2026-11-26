import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GIF_COMPACT_STEPS,
  GIF_ENCODE_OPTIONS,
  GIF_MAX_ATTEMPTS,
  GIF_MAX_BYTES,
  GIF_MAX_WIDTH_ATTEMPTS,
  GIF_RAW_MAX_BYTES,
  GIF_UPLOAD_BUDGET_SECONDS,
  gifEncodeSeconds,
  gifKeptFrames,
  gifRawBytes,
  gifShrunkWarning,
  gifWidthForSeconds,
  nextCompactStep,
  nextGifWidth,
  planAnimatedGif,
  shrinkAnimatedGif,
  sizeLabel,
} from "./mail-template-gif.mjs";

/** The owner's GIF of 24.11.2026: 1,440 × 1,440, a text ring turning around a photo. */
const RING = { width: 1440, height: 1440, frames: 40 };
/** The client's phone GIF of 26.11.2026: 384 × 682, a video (70 frames of 60 ms) — 3.1 MB at its own width. */
const PHONE = { width: 384, height: 682, frames: 70, delays: Array.from({ length: 70 }, () => 60) };

test("sizeLabel: KB below a megabyte, MB with a German decimal comma", () => {
  assert.equal(sizeLabel(640_000), "640 KB");
  assert.equal(sizeLabel(1_864_000), "1,9 MB");
  assert.equal(sizeLabel(1_741_000), "1,7 MB");
  assert.equal(sizeLabel(2_000_000), "2,0 MB");
  assert.equal(sizeLabel(300), "1 KB");
  assert.equal(sizeLabel(Number.NaN), "1 KB");
});

test("planAnimatedGif: a GIF that fits is kept byte for byte", () => {
  assert.deepEqual(planAnimatedGif({ width: 1200, height: 600, frames: 30, bytes: GIF_MAX_BYTES }), { action: "keep" });
  assert.deepEqual(planAnimatedGif({ width: 600, height: 300, frames: 300, bytes: 900_000 }), { action: "keep" });
});

test("planAnimatedGif: too wide or too large → encoded (at most 1,200 px), not refused", () => {
  // the owner's GIF: 1,440 px, 1.9 MB, 40 frames → 1,200 px
  assert.deepEqual(planAnimatedGif({ ...RING, bytes: 1_864_000 }), { action: "encode", width: 1200 });
  // narrow enough but over 2 MB → encoded at its own width first
  assert.deepEqual(planAnimatedGif({ width: 1000, height: 1000, frames: 60, bytes: 3_200_000 }), { action: "encode", width: 1000 });
  // a small but heavy GIF keeps its width (never enlarged)
  assert.deepEqual(planAnimatedGif({ width: 480, height: 270, frames: 400, bytes: 2_500_000 }), { action: "encode", width: 480 });
});

test("planAnimatedGif: a long GIF starts narrower so the encode fits the budget; refused only when 600 px does not fit", () => {
  const long = { width: 1440, height: 1440, frames: 400, bytes: 3_900_000 };
  const plan = planAnimatedGif(long);
  assert.equal(plan.action, "encode");
  assert.ok(plan.width >= 600 && plan.width < 1200, `width ${plan.width}`);
  assert.ok(gifEncodeSeconds(long, plan.width) <= GIF_UPLOAD_BUDGET_SECONDS);
  assert.ok(gifEncodeSeconds(long, plan.width + 10) > GIF_UPLOAD_BUDGET_SECONDS);
  // thousands of frames: not even 600 px fits → a clear refusal
  const endless = planAnimatedGif({ width: 1440, height: 1440, frames: 3000, bytes: 3_900_000 });
  assert.equal(endless.action, "refuse");
  assert.equal(endless.code, "gif_too_long");
  assert.match(endless.message, /^Das animierte GIF \(1440 px, 3000 Einzelbilder, 3,9 MB\) lässt sich hier nicht schnell genug verkleinern/);
  // a tight budget (the KI-Gestalter's) refuses what the upload would shrink
  assert.equal(planAnimatedGif({ ...RING, bytes: 1_864_000, budgetSeconds: 0 }).action, "refuse");
  assert.equal(planAnimatedGif({ ...RING, bytes: 1_864_000, budgetSeconds: 2 }).action, "refuse");
});

test("planAnimatedGif: no frames or no size → unreadable", () => {
  assert.equal(planAnimatedGif({ width: 0, height: 100, frames: 10, bytes: 10 }).code, "unreadable");
  assert.equal(planAnimatedGif({ width: 100, height: 100, frames: 1, bytes: 10 }).code, "unreadable");
});

test("gifEncodeSeconds / gifWidthForSeconds: the planned time grows with frames and area; the width fits the seconds", () => {
  const at1200 = gifEncodeSeconds(RING, 1200);
  assert.ok(at1200 > 15 && at1200 < 30, `planned ${at1200} s (measured 13.8 s on one core)`);
  assert.ok(gifEncodeSeconds(RING, 600) < at1200 / 2);
  assert.ok(gifEncodeSeconds({ ...RING, frames: 80 }, 1200) > 1.9 * at1200);
  assert.equal(gifWidthForSeconds(RING, 1000, 1200), 1200);
  const w = gifWidthForSeconds(RING, 10, 1200);
  assert.ok(w % 10 === 0 && w > 0 && w < 1200);
  assert.ok(gifEncodeSeconds(RING, w) <= 10);
  assert.equal(gifWidthForSeconds(RING, 0, 1200), 0);
  // not even decoding fits
  assert.equal(gifWidthForSeconds({ width: 1440, height: 1440, frames: 10_000 }, 5, 1200), 0);
});

test("nextGifWidth: narrower by what the size has to lose, at least 10 px, never below 600 px, within the time left", () => {
  // 1,200 px came out at 3.2 MB → (1.8/3.2)^(1/1.6) of the width (size ∝ width^1.6)
  assert.equal(nextGifWidth({ gif: RING, triedWidth: 1200, outBytes: 3_200_000, secondsLeft: 120 }), 830);
  // with the attempt before, the GIF's own exponent: 1,200 → 4 MB, 720 → 2.167 MB is k = 1.2 → 610 px
  assert.equal(nextGifWidth({ gif: RING, triedWidth: 720, outBytes: 2_167_000, secondsLeft: 120, previous: { width: 1200, bytes: 4_000_000 } }), 610);
  // a measured exponent outside 1 … 2.5 is clamped: k = 7.2 would step only to 960 px, k = 2.5 steps to 890 px
  assert.equal(nextGifWidth({ gif: RING, triedWidth: 1000, outBytes: 2_400_000, secondsLeft: 120, previous: { width: 1200, bytes: 9_000_000 } }), 890);
  // barely over → still at least 10 px narrower
  assert.equal(nextGifWidth({ gif: RING, triedWidth: 1200, outBytes: 1_810_000, secondsLeft: 120 }), 1190);
  // far over → the floor
  assert.equal(nextGifWidth({ gif: RING, triedWidth: 1200, outBytes: 20_000_000, secondsLeft: 120 }), 600);
  // at the floor → no next attempt
  assert.equal(nextGifWidth({ gif: RING, triedWidth: 600, outBytes: 2_500_000, secondsLeft: 120 }), null);
  // a GIF narrower than the mail is never made narrower
  assert.equal(nextGifWidth({ gif: { width: 480, height: 270, frames: 400 }, triedWidth: 480, outBytes: 2_400_000, secondsLeft: 120 }), null);
  // little time left → as wide as the time allows, or nothing
  const tight = nextGifWidth({ gif: RING, triedWidth: 1200, outBytes: 2_100_000, secondsLeft: 12 });
  assert.equal(tight, 800);
  assert.ok(gifEncodeSeconds(RING, tight) <= 12);
  // 600 px is planned with 8.1 s — 8 s left is not enough for any attempt
  assert.equal(nextGifWidth({ gif: RING, triedWidth: 1200, outBytes: 2_100_000, secondsLeft: 8 }), null);
  assert.equal(nextGifWidth({ gif: RING, triedWidth: 1200, outBytes: 2_100_000, secondsLeft: 1 }), null);
  assert.equal(nextGifWidth({ gif: RING, triedWidth: 1200, outBytes: 0, secondsLeft: 120 }), null);
});

/** A fake encoder: the size follows the area of the width (`bytesAt1200` at 1,200 px); the compact steps are ignored. */
function fakeEncoder(bytesAt1200, log) {
  return async ({ width }) => {
    log.push(width);
    return new Uint8Array(Math.round(bytesAt1200 * (width / 1200) ** 2));
  };
}

/**
 * A fake encoder modelled on the measurements of 26.11.2026: tolerance 16 =
 * 0.55 × the size, 32 = 0.3 ×, fewer frames = their share (+ 20 % for the
 * larger frame-to-frame changes). `bytesAtOwnWidth` at the GIF's width.
 */
function compactEncoder(gif, bytesAtOwnWidth, log) {
  return async (v) => {
    log.push(v);
    const tolerance = v.interFrameMaxError >= 32 ? 0.3 : v.interFrameMaxError >= 16 ? 0.55 : 1;
    const kept = v.frameStep > 1 ? gifKeptFrames(gif.delays, v.frameStep).keep.length / gif.frames : 1;
    const frames = v.frameStep > 1 ? Math.min(1, kept * 1.2) : 1;
    return new Uint8Array(Math.round(bytesAtOwnWidth * (v.width / gif.width) ** 2 * tolerance * frames));
  };
}

test("shrinkAnimatedGif: the first fitting encode wins; a too large one is followed by a narrower one", async () => {
  const log = [];
  const once = await shrinkAnimatedGif({ gif: RING, firstWidth: 1200, encode: fakeEncoder(1_741_000, log) });
  assert.deepEqual(log, [1200]);
  assert.equal(once.ok, true);
  assert.equal(once.width, 1200);
  assert.equal(once.attempts, 1);
  assert.equal(once.data.length, 1_741_000);

  const log2 = [];
  const twice = await shrinkAnimatedGif({ gif: RING, firstWidth: 1200, encode: fakeEncoder(3_000_000, log2) });
  assert.equal(twice.ok, true);
  assert.equal(log2.length, 2);
  assert.equal(log2[0], 1200);
  assert.ok(log2[1] < 1200 && log2[1] >= 600);
  assert.ok(twice.data.length <= GIF_MAX_BYTES);
  assert.equal(twice.width, log2[1]);
});

test("shrinkAnimatedGif: an estimate that misses gets a third, narrower attempt", async () => {
  // a GIF whose size shrinks slower than its area (much fine motion)
  const log = [];
  const slow = async (width) => {
    log.push(width);
    return new Uint8Array(Math.round(4_000_000 * (width / 1200) ** 1.2));
  };
  const res = await shrinkAnimatedGif({ gif: RING, firstWidth: 1200, encode: ({ width }) => slow(width) });
  assert.equal(log.length, GIF_MAX_WIDTH_ATTEMPTS);
  assert.ok(log[0] > log[1] && log[1] > log[2]);
  assert.equal(res.ok, true);
  assert.ok(res.data.length <= GIF_MAX_BYTES);
});

test("shrinkAnimatedGif: still too large after every step, out of attempts or out of time → a German message", async () => {
  // nothing helps: narrower down to 600 px, then every compact step at 600 px
  const log = [];
  const huge = await shrinkAnimatedGif({ gif: RING, firstWidth: 1200, encode: fakeEncoder(40_000_000, log) });
  assert.equal(huge.ok, false);
  assert.equal(huge.code, "gif_too_large");
  // 1,200 px, straight to the 600-px floor (the estimate says so), then every compact step there
  assert.deepEqual(log, [1200, 600, ...Array(GIF_COMPACT_STEPS.length).fill(600)]);
  assert.equal(
    huge.message,
    "Das animierte GIF ist auch auf 600 px verkleinert, stärker komprimiert und mit nur jedem dritten Einzelbild noch 10,0 MB groß (höchstens 2 MB) — bitte kürzer, schmaler oder mit weniger Einzelbildern exportieren."
  );

  // the budget is used up after the first encode → no second one
  let t = 0;
  const log2 = [];
  const encode = async ({ width }) => {
    log2.push(width);
    t += 200_000;
    return new Uint8Array(3_000_000);
  };
  const late = await shrinkAnimatedGif({ gif: RING, firstWidth: 1200, budgetSeconds: 150, encode, now: () => t });
  assert.equal(late.ok, false);
  assert.deepEqual(log2, [1200]);
  assert.equal(
    late.message,
    "Das animierte GIF ist auch auf 1200 px verkleinert noch 3,0 MB groß (höchstens 2 MB) — bitte kürzer, schmaler oder mit weniger Einzelbildern exportieren."
  );
});

test("shrinkAnimatedGif: a GIF that cannot get narrower is compressed harder, gentlest step first (owner report 26.11.2026)", async () => {
  // 3.1 MB at its own 384 px: the tolerance 16 is enough
  const log = [];
  const res = await shrinkAnimatedGif({ gif: PHONE, firstWidth: 384, encode: compactEncoder(PHONE, 3_100_000, log) });
  assert.equal(res.ok, true);
  assert.deepEqual(
    log.map((v) => [v.width, v.interFrameMaxError, v.frameStep]),
    [
      [384, 8, 1],
      [384, 16, 1],
    ]
  );
  assert.equal(res.width, 384);
  assert.equal(res.interFrameMaxError, 16);
  assert.equal(res.keptFrames, 70);
  assert.equal(res.attempts, 2);

  // a heavy one goes on to every second frame — the same duration
  const log2 = [];
  const heavy = await shrinkAnimatedGif({ gif: PHONE, firstWidth: 384, encode: compactEncoder(PHONE, 10_000_000, log2) });
  assert.equal(heavy.ok, true);
  assert.deepEqual(
    log2.map((v) => [v.interFrameMaxError, v.frameStep]),
    [
      [8, 1],
      [16, 1],
      [32, 1],
      [32, 2],
    ]
  );
  assert.equal(heavy.frameStep, 2);
  assert.equal(heavy.keptFrames, 36);
  assert.ok(heavy.data.length <= GIF_MAX_BYTES);

  // a wide GIF is made narrower first and compressed only at its narrowest
  const log3 = [];
  const wide = await shrinkAnimatedGif({ gif: RING, firstWidth: 1200, encode: compactEncoder(RING, 25_000_000, log3) });
  assert.equal(wide.ok, true);
  assert.equal(log3[0].width, 1200);
  assert.ok(log3.filter((v) => v.interFrameMaxError > 8).every((v) => v.width === log3.at(-1).width));
  assert.ok(wide.interFrameMaxError > 8);
});

test("gifKeptFrames: every n-th frame, pauses and slides stay, the last stays, the duration stays", () => {
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  assert.deepEqual(gifKeptFrames([50, 50, 50, 50, 50, 50, 50], 2), { keep: [0, 2, 4, 6], delays: [100, 100, 100, 50] });
  assert.deepEqual(gifKeptFrames([50, 50, 50, 50, 50, 50, 50], 3), { keep: [0, 3, 6], delays: [150, 150, 50] });
  // a pause of 500 ms (index 3) is never left out
  const withPause = [50, 50, 50, 500, 50, 50, 50];
  const kept = gifKeptFrames(withPause, 2);
  assert.deepEqual(kept, { keep: [0, 2, 3, 4, 6], delays: [100, 50, 500, 100, 50] });
  assert.equal(sum(kept.delays), sum(withPause));
  // a slideshow keeps every slide
  assert.deepEqual(gifKeptFrames([1000, 1500, 1000, 2000], 2).keep, [0, 1, 2, 3]);
  // 0 / 10 ms play as 100 ms in the browsers
  assert.deepEqual(gifKeptFrames([0, 0, 0, 0], 2), { keep: [0, 2, 3], delays: [200, 100, 100] });
  // step 1: all frames, unchanged
  assert.deepEqual(gifKeptFrames([40, 40, 40], 1), { keep: [0, 1, 2], delays: [40, 40, 40] });
});

test("nextCompactStep: the gentlest step next; frames only out of a video-like GIF, within memory and time", () => {
  const at = (gif, after, seconds = 150, width = gif.width) => nextCompactStep(gif, width, after, seconds);
  assert.deepEqual(at(PHONE, -1), { index: 0, width: 384, interFrameMaxError: 16, frameStep: 1 });
  assert.deepEqual(at(PHONE, 0), { index: 1, width: 384, interFrameMaxError: 32, frameStep: 1 });
  assert.deepEqual(at(PHONE, 1), { index: 2, width: 384, interFrameMaxError: 32, frameStep: 2 });
  assert.deepEqual(at(PHONE, 2), { index: 3, width: 384, interFrameMaxError: 32, frameStep: 3 });
  assert.equal(at(PHONE, 3), null);
  // a slideshow (every frame a slide of 1 s) never loses a frame
  const slides = { width: 600, height: 400, frames: 8, delays: Array.from({ length: 8 }, () => 1000) };
  assert.equal(at(slides, 1), null);
  // too few frames: at least 4 stay
  const short = { width: 600, height: 400, frames: 5, delays: [60, 60, 60, 60, 60] };
  assert.equal(at(short, 1), null);
  // every frame at once would not fit the memory → no frames left out
  const huge = { width: 1200, height: 1200, frames: 200, delays: Array.from({ length: 200 }, () => 40) };
  assert.ok(gifRawBytes(huge, 1200) > GIF_RAW_MAX_BYTES);
  assert.equal(at(huge, 1, 10_000), null);
  // no time left → null
  assert.equal(at(PHONE, -1, 0), null);
});

test("gifEncodeSeconds: leaving frames out encodes fewer (every frame is still decoded)", () => {
  const all = gifEncodeSeconds(PHONE, 384);
  const half = gifEncodeSeconds(PHONE, 384, 2);
  assert.ok(half < all && half > all / 2);
  assert.equal(gifEncodeSeconds(PHONE, 384, 1), all);
});

test("shrinkAnimatedGif: an encoder error propagates (the caller reports it)", async () => {
  await assert.rejects(
    shrinkAnimatedGif({
      gif: RING,
      firstWidth: 1200,
      encode: async () => {
        throw new Error("gifload: bad frame");
      },
    }),
    /bad frame/
  );
});

test("gifShrunkWarning and the encoder options", () => {
  assert.equal(
    gifShrunkWarning({ fromWidth: 1440, toWidth: 1200, fromBytes: 1_864_000, toBytes: 1_741_000, frames: 40 }),
    "Animiertes GIF für die Mail verkleinert: 1440 → 1200 px breit, 1,9 MB → 1,7 MB (alle 40 Einzelbilder bleiben)."
  );
  assert.equal(
    gifShrunkWarning({ fromWidth: 1000, toWidth: 1000, fromBytes: 3_200_000, toBytes: 1_900_000, frames: 60 }),
    "Animiertes GIF für die Mail neu gespeichert: 3,2 MB → 1,9 MB (alle 60 Einzelbilder bleiben)."
  );
  assert.equal(
    gifShrunkWarning({ fromWidth: 384, toWidth: 384, fromBytes: 3_900_000, toBytes: 1_500_000, frames: 70, keptFrames: 70, compressed: true }),
    "Animiertes GIF für die Mail stärker komprimiert: 3,9 MB → 1,5 MB (alle 70 Einzelbilder bleiben)."
  );
  assert.equal(
    gifShrunkWarning({ fromWidth: 384, toWidth: 384, fromBytes: 3_900_000, toBytes: 1_900_000, frames: 70, keptFrames: 36, compressed: true }),
    "Animiertes GIF für die Mail stärker komprimiert: 3,9 MB → 1,9 MB — 70 → 36 Einzelbilder, gleiche Dauer; bitte die Animation in der Vorschau prüfen."
  );
  assert.equal(
    gifShrunkWarning({ fromWidth: 1440, toWidth: 600, fromBytes: 3_900_000, toBytes: 1_800_000, frames: 40, compressed: true }),
    "Animiertes GIF für die Mail verkleinert und stärker komprimiert: 1440 → 600 px breit, 3,9 MB → 1,8 MB (alle 40 Einzelbilder bleiben)."
  );
  assert.deepEqual(
    GIF_COMPACT_STEPS.map((c) => [c.interFrameMaxError, c.frameStep]),
    [
      [16, 1],
      [32, 1],
      [32, 2],
      [32, 3],
    ]
  );
  assert.equal(GIF_MAX_ATTEMPTS, GIF_MAX_WIDTH_ATTEMPTS + GIF_COMPACT_STEPS.length);
  assert.deepEqual({ ...GIF_ENCODE_OPTIONS }, { effort: 1, interFrameMaxError: 8 });
  assert.ok(Object.isFrozen(GIF_ENCODE_OPTIONS));
});
