// The plan role of a catalog product (PLAN_ROLES of configurator-core.mjs:
// base | accessory | weights | cardio | flooring | extra) — pure, no I/O. Its
// own module since 2026-10-27 so the product rules (product-rules.mjs) and the
// configurator core (which re-exports it) can both use it without importing
// each other. docs/CONFIGURATOR.md §4.

// The plan role of an assortment product, for „+ Produkt hinzufügen“ on the
// page (GET /api/configurator/assortment). First match wins: storage racks and
// bar collars are accessories although they say "Rack"/"Weight"; cardio
// machines ("Rowing Machines") stay cardio, and a strength machine is a base
// unit although it says "Plate Load" (Hip Thruster Machine Plate Load — not a
// weight plate, so the picker does not add it in pairs).
const ROLE_RULES = /** @type {ReadonlyArray<readonly [string, RegExp]>} */ ([
  ["flooring", /floor protection|gym mats?|bodenschutz|bodenmatte|puzzlematte|schutzmatte|unterlegmatte/i],
  ["accessory", /storage|ablage|st[äa]nder|collar|verschl[üu]ss|bench|hantelbank|\bbank\b|barbell|weightlifting bars?|langhantel|stange|handles?|griff|accessor|zubeh[öo]r|klimmzug|pull.?up bar|belt|g[üu]rtel|resistance bands?|widerstandsb[äa]nder?|\bbands?\b/i],
  ["cardio", /treadmill|laufband|bikes?|ergometer|rowing|ruderger[äa]t|rower|elliptical|crosstrainer|cross.?trainer|stepper|stair|spinning|indoor.?cycl|cardio|walking.?pad/i],
  ["base", /\bmachines?\b|maschine|plate.?load/i],
  ["weights", /weight plates?|hantelscheibe|dumbbells?|kurzhantel|\bhanteln\b|kettlebell|gewichtsscheibe|\bgewichte\b|\bplates?\b|scheiben/i],
  ["base", /power racks?|half racks?|squat racks?|weight lifting (machines|racks)|smith|multipresse|power towers?|kraftstation|equipment sets|multi.?gym|cable|kabelzug|functional trainer|\brack\b|machines?/i],
]);

/**
 * Plan role (PLAN_ROLES) of a catalog product, from its category, else its
 * name; "extra" when nothing matches.
 * @param {{ category?: unknown, name?: unknown }} p
 * @returns {"base" | "accessory" | "weights" | "cardio" | "flooring" | "extra"}
 */
export function planRoleForProduct(p) {
  for (const text of [String(p?.category ?? ""), String(p?.name ?? "")]) {
    if (!text.trim()) continue;
    for (const [role, re] of ROLE_RULES) {
      if (re.test(text)) return /** @type {any} */ (role);
    }
  }
  return "extra";
}
