// Round axis ticks for the admin charts (dataviz: y-ticks are clean numbers —
// 0 / 500 / 1.000 — never 0 / 550 / 1.100). Pure; node:test imports it.

/**
 * Evenly spaced ticks from 0 to at least `max`, with a step of 1, 2, 2.5 or 5
 * times a power of ten, aiming at `target` intervals.
 *
 * @param {number} max   the largest value to show
 * @param {number} [target] intended number of intervals (default 4)
 * @returns {number[]}  ascending, starting at 0; [0, 1] for an empty series
 */
export function niceTicks(max, target = 4) {
  const m = Number(max);
  if (!Number.isFinite(m) || m <= 0) return [0, 1];
  const raw = m / Math.max(1, Math.floor(target));
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((f) => f * power).find((s) => s >= raw) ?? 10 * power;
  const ticks = [];
  for (let v = 0; v < m + step - 1e-9; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return ticks;
}
