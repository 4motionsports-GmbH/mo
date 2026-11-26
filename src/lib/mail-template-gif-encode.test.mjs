import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { encodeAnimatedGifVariant } from "./mail-template-gif-encode.mjs";
import { gifKeptFrames } from "./mail-template-gif.mjs";

/** A small real animated GIF: one solid colour per frame (frame i → red 25·i), a 500-ms pause at frame 3. */
const W = 40;
const H = 30;
const DELAYS = [50, 50, 50, 500, 50, 50, 50, 50, 50];
const colourOf = (i) => [25 * i, 255 - 25 * i, 100];

async function makeGif({ loop = 0 } = {}) {
  const frameBytes = W * H * 4;
  const strip = Buffer.alloc(frameBytes * DELAYS.length);
  DELAYS.forEach((_, i) => {
    const [r, g, b] = colourOf(i);
    for (let p = 0; p < W * H; p++) strip.set([r, g, b, 255], i * frameBytes + p * 4);
  });
  return sharp(strip, { raw: { width: W, height: H * DELAYS.length, channels: 4, pageHeight: H } })
    .gif({ delay: DELAYS, loop })
    .toBuffer();
}

/** The red value of every frame's centre pixel. */
async function frameReds(gif) {
  const { data, info } = await sharp(gif, { animated: true }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const meta = await sharp(gif).metadata();
  const frameHeight = info.height / meta.pages;
  return Array.from({ length: meta.pages }, (_, f) => data[((f * frameHeight + Math.floor(frameHeight / 2)) * info.width + Math.floor(info.width / 2)) * 4]);
}

const near = (a, b) => Math.abs(a - b) <= 8;

test("encodeAnimatedGifVariant: all frames at a new width, timing and loop kept", async () => {
  const gif = await makeGif({ loop: 3 });
  const out = await encodeAnimatedGifVariant(gif, { width: 20, interFrameMaxError: 16, frameStep: 1 }, { frames: DELAYS.length, delays: DELAYS, loop: 3, limitInputPixels: W * H * DELAYS.length + 1 });
  const meta = await sharp(out).metadata();
  assert.equal(meta.format, "gif");
  assert.equal(meta.width, 20);
  assert.equal(meta.pageHeight ?? meta.height, 15);
  assert.equal(meta.pages, DELAYS.length);
  assert.deepEqual(meta.delay, DELAYS);
  assert.equal(meta.loop, 3);
});

test("encodeAnimatedGifVariant: every second frame — the kept frames, their summed delays, the pause and the loop stay", async () => {
  const gif = await makeGif();
  const out = await encodeAnimatedGifVariant(gif, { width: W, interFrameMaxError: 32, frameStep: 2 }, { frames: DELAYS.length, delays: DELAYS, loop: 0, limitInputPixels: W * H * DELAYS.length + 1 });
  const expected = gifKeptFrames(DELAYS, 2);
  assert.deepEqual(expected.keep, [0, 2, 3, 4, 6, 8]);
  const meta = await sharp(out).metadata();
  assert.equal(meta.pages, expected.keep.length);
  assert.equal(meta.width, W);
  assert.deepEqual(meta.delay, expected.delays);
  assert.equal(
    meta.delay.reduce((a, b) => a + b, 0),
    DELAYS.reduce((a, b) => a + b, 0)
  );
  assert.equal(meta.loop, 0);
  const reds = await frameReds(out);
  expected.keep.forEach((i, k) => assert.ok(near(reds[k], colourOf(i)[0]), `frame ${k} shows frame ${i}: red ${reds[k]} vs ${colourOf(i)[0]}`));
});

test("encodeAnimatedGifVariant: unknown delays count as 100 ms", async () => {
  const gif = await makeGif();
  const out = await encodeAnimatedGifVariant(gif, { width: W, interFrameMaxError: 32, frameStep: 3 }, { frames: DELAYS.length, delays: null, loop: null, limitInputPixels: W * H * DELAYS.length + 1 });
  const meta = await sharp(out).metadata();
  assert.deepEqual(meta.delay, gifKeptFrames(Array(DELAYS.length).fill(100), 3).delays);
  assert.equal(meta.loop, 0);
});
