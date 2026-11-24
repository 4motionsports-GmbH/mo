import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GIF_ENCODE_OPTIONS,
  GIF_MAX_ATTEMPTS,
  GIF_MAX_BYTES,
  GIF_UPLOAD_BUDGET_SECONDS,
  gifEncodeSeconds,
  gifShrunkWarning,
  gifWidthForSeconds,
  nextGifWidth,
  planAnimatedGif,
  shrinkAnimatedGif,
  sizeLabel,
} from "./mail-template-gif.mjs";

/** The owner's GIF of 24.11.2026: 1,440 × 1,440, a text ring turning around a photo. */
const RING = { width: 1440, height: 1440, frames: 40 };

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

/** A fake encoder: the size follows the area of the width (`bytesAt1200` at 1,200 px). */
function fakeEncoder(bytesAt1200, log) {
  return async (width) => {
    log.push(width);
    return new Uint8Array(Math.round(bytesAt1200 * (width / 1200) ** 2));
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
  const res = await shrinkAnimatedGif({ gif: RING, firstWidth: 1200, encode: slow });
  assert.equal(log.length, GIF_MAX_ATTEMPTS);
  assert.ok(log[0] > log[1] && log[1] > log[2]);
  assert.equal(res.ok, true);
  assert.ok(res.data.length <= GIF_MAX_BYTES);
});

test("shrinkAnimatedGif: still too large at the floor, out of attempts or out of time → a German message", async () => {
  const log = [];
  const huge = await shrinkAnimatedGif({ gif: RING, firstWidth: 1200, encode: fakeEncoder(40_000_000, log) });
  assert.equal(huge.ok, false);
  assert.equal(huge.code, "gif_too_large");
  assert.equal(log.at(-1), 600);
  assert.match(huge.message, /^Das animierte GIF ist auch auf 600 px verkleinert noch 10,0 MB groß \(höchstens 2 MB\) — bitte mit weniger Einzelbildern oder kleiner exportieren\.$/);

  // the budget is used up after the first encode → no second one
  let t = 0;
  const log2 = [];
  const encode = async (width) => {
    log2.push(width);
    t += 200_000;
    return new Uint8Array(3_000_000);
  };
  const late = await shrinkAnimatedGif({ gif: RING, firstWidth: 1200, budgetSeconds: 150, encode, now: () => t });
  assert.equal(late.ok, false);
  assert.deepEqual(log2, [1200]);
  assert.match(late.message, /auf 1200 px verkleinert noch 3,0 MB/);
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
  assert.deepEqual({ ...GIF_ENCODE_OPTIONS }, { effort: 1, interFrameMaxError: 8 });
  assert.ok(Object.isFrozen(GIF_ENCODE_OPTIONS));
});
