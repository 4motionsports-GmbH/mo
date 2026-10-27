// The quantity and floor-area fields of the configurator tools show_gym_plan
// and offer_plan_options (tools.ts) as zod schemas — a pure module, so the
// tests safeParse the very schemas the tools use (round 6, 2026-10-27).

import { z } from "zod";
import { RULE_LIMITS } from "./product-rules.mjs";

/**
 * A line's quantity: 1 to a floor line's cap (RULE_LIMITS.floorLineMax, 200 —
 * a whole room in small tiles). The tools then apply the per-product cap
 * (validateLines: 20 for a line without coverage) and report a clamp in
 * `adjusted` („höchstens 20 je Position“) instead of failing the whole call.
 */
export const lineQuantitySchema = z.number().int().min(1).max(RULE_LIMITS.floorLineMax).optional();

/**
 * The floor area in m² (`floorAreaM2` of show_gym_plan, `areaM2` of
 * offer_plan_options): a number, null or absent. Lenient on purpose — a null
 * area never invalidates the plan or the options (an invalid call renders no
 * card and costs a model step); normalizeAreaM2 is the only gate (it drops 0,
 * negatives and more than RULE_LIMITS.areaMaxM2).
 */
export const floorAreaSchema = z.number().nullish();
