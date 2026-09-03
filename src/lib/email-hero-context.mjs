// Pure helpers that turn what we know about ONE recipient into the compact
// context lines the hero generator hands to the model (email-hero.ts).
//
// Why this is its own module: the hero's quality is decided almost entirely by
// what the model is TOLD, so the summarisation rules (which purchases count,
// how much of the profile survives, how the season is phrased) deserve tests
// and a place where they can be tuned without touching the I/O around them.
//
// Everything here is deterministic and side-effect free — .mjs like the other
// cores so it runs under node --test.

/**
 * The fixed style/constraint tail every hero prompt carries — the motion sports
 * look plus the hard rules the CURRENT hero layout depends on (landscape, and a
 * bright left half where the headline sits). Appended to the AI scene
 * suggestion and shown to the operator as part of the editable prompt.
 */
export const HERO_PROMPT_STYLE_TAIL =
  "TEXT LEFT, SCENE RIGHT — this photo is the background of an email and a dark " +
  "headline is printed over its left part. Keep the LEFT 45% of the frame calm: " +
  "a plain, evenly lit pale wall and floor — no equipment, no furniture, no " +
  "window, no clutter, no strong shadows — with brightness easing gently from " +
  "that bright left into the scene, no hard edge. The whole scene lives in the " +
  "RIGHT 55%: show EVERY named product, arranged as one believable home-gym " +
  "setup — the NEW pieces in front as the eye-catchers, the pieces the customer " +
  "already owns behind or beside them, large equipment at the back, small items " +
  "in front, nothing reaching into the left 45%. " +
  "STYLE: photorealistic premium e-commerce photograph of a bright modern home " +
  "gym — pale concrete and warm white surfaces, soft natural daylight, matte " +
  "black equipment, shallow depth of field, calm and motivating mood. WIDE " +
  "LANDSCAPE composition, about twice as wide as tall (the email hero format). " +
  "BRAND FIDELITY: render each named product true to its brand's real design " +
  "language — proportions, frame profile, finish and colour — including the " +
  "small brand lettering as it actually appears on such equipment (discreet, on " +
  "the frame or end caps), so it reads as the genuine product. That equipment " +
  "marking is the ONLY lettering allowed: no headline text, no captions, no " +
  "posters or signage on the wall, no watermarks, no human faces.";

/**
 * What the drafting model is told about the SCENE it writes for the image
 * model. Lives here, not inline in email-hero.ts, because it is the product:
 * this text decides whether the hero looks like the customer's own setup or
 * like a stock photo — and because it MUST agree with HERO_PROMPT_STYLE_TAIL.
 *
 * They drifted apart once: an edit that was meant to allow brand names landed
 * in the schema but silently missed this text, which went on telling the model
 * that brand names mean nothing to an image model. The two then fought each
 * other on every generation. The tests below assert they agree.
 */
export const HERO_SCENE_INSTRUCTION =
  "SZENE (englisch, für ein Bildmodell): Sie soll wie das Setup DIESER " +
  "Person wirken, nicht wie ein Stockfoto — und sie soll verkaufen. Nutze " +
  "dafür in dieser Reihenfolge: (1) die empfohlenen PRODUKTE — ALLE, die " +
  "in den Vorgaben stehen: Marke und Produktbezeichnung wörtlich " +
  "übernehmen, dazu Bauart und Farbe, damit jedes Gerät dem tatsächlich " +
  "verkauften nahekommt; sie sind der Blickfang und stehen vorne, (2) ein " +
  "bis zwei VERTRAUTE Geräte aus dem Besitz (Kaufhistorie) dahinter oder " +
  "daneben — die neuen Teile ERGÄNZEN sichtbar ein bestehendes Setup, " +
  "(3) die Rahmenbedingungen aus dem Kundenverständnis (Platz, Lautstärke, " +
  "Wohnung vs. Keller vs. Garage, Niveau), (4) ein angehängtes Set als " +
  "Gruppe, (5) die Jahreszeit für Licht und Stimmung. ANORDNUNG, " +
  "ausdrücklich in die Szene schreiben: alles als EIN zusammenhängendes " +
  "Setup RECHTS im Bild, große Geräte hinten, kleine vorne; links davon " +
  "eine ruhige, helle, leere Wand- und Bodenfläche (dort steht später die " +
  "Schlagzeile).\n\n";

/**
 * The single normalisation a hero prompt goes through before it is measured or
 * sent. Shared so the API route and the generator can never disagree on how
 * long a prompt is — the route used to measure the RAW text (counting the
 * blank line between scene and tail) while the generator measured the
 * collapsed one, so a prompt could be rejected by one and accepted by the
 * other.
 *
 * @param {unknown} prompt
 * @returns {string}
 */
export function normalizeHeroPrompt(prompt) {
  return String(prompt ?? "").replace(/\s+/g, " ").trim();
}

/**
 * How much room the operator-editable SCENE gets, on top of the fixed tail.
 * Generous enough for the ≤90-word scene the drafter is asked for — it now
 * names EVERY recommended product plus one or two owned ones — INCLUDING
 * long catalogue product names ("ATX® Hardcore Power Rack & Pull Station
 * FCR-780 (Power Racks, black / grey)"), with room for a model that
 * overshoots its word budget, which is what broke generation once already.
 */
export const MAX_HERO_SCENE_CHARS = 1400;

/**
 * The cap on a complete hero prompt — DERIVED from the tail, never a magic
 * number.
 *
 * This was a hard-coded 1500 once, and adding the BRAND FIDELITY RULE pushed
 * the tail to a length that left too little room for a normal scene: every
 * "Bild generieren" failed with a 400. Deriving the cap means growing the tail
 * automatically grows the budget, so that class of bug cannot come back.
 *
 * The +8 covers the blank line between scene and tail, which the generator
 * collapses to a single space before measuring.
 */
export const MAX_HERO_PROMPT_CHARS =
  HERO_PROMPT_STYLE_TAIL.length + MAX_HERO_SCENE_CHARS + 8;

/** The marker identifying the CURRENT tail — the newest rule it carries. */
export const HERO_TAIL_MARKER = "TEXT LEFT, SCENE RIGHT";

/**
 * The opening words of every tail version that has ever shipped, newest first.
 * ensureHeroStyleTail cuts a stored prompt at the earliest of these to recover
 * the operator's own scene text.
 */
export const SUPERSEDED_TAIL_STARTS = [
  HERO_TAIL_MARKER,
  // The #174 tail (left 55% empty, at most two objects).
  "COMPOSITION FIRST",
  // The #172 tail (brand fidelity, composition rule in the middle).
  "Photorealistic premium e-commerce hero shot",
];

/**
 * Guarantee a prompt carries the CURRENT style rules. A prompt stored before
 * those rules existed (the earlier portrait tail, or the pre-brand-fidelity
 * one, or the one that still banned brand markings) would fight the layout or
 * carry the wrong instruction, so a superseded
 * tail is REPLACED — the operator's own scene text is never touched.
 *
 * The marker is the newest rule in the tail, so bumping the tail automatically
 * supersedes every stored prompt written against an older version. It is
 * currently "TEXT LEFT, SCENE RIGHT" (the calm zone shrank to the left 45%
 * because the server-side gradient now guarantees legibility, and the scene
 * may show every named product instead of two).
 *
 * @param {string} prompt
 * @returns {string}
 */
export function ensureHeroStyleTail(prompt) {
  const text = String(prompt ?? "");
  if (text.includes(HERO_TAIL_MARKER)) return text;
  // Where a superseded tail begins. Every marker a tail has EVER started with
  // belongs here — otherwise a prompt stored against an older tail keeps that
  // tail glued to its scene and the new rules never reach the image model.
  const start = SUPERSEDED_TAIL_STARTS.map((m) => text.indexOf(m))
    .filter((i) => i >= 0)
    .sort((a, b) => a - b)[0];
  const scene = (start === undefined ? text : text.slice(0, start)).trim();
  return `${scene}\n\n${HERO_PROMPT_STYLE_TAIL}`;
}

/** Longest slice of the customer-understanding text that reaches the prompt. */
export const MAX_PROFILE_CHARS = 600;

/**
 * German season/occasion hint for a date. The hero is the first thing the
 * reader sees, and a scene that matches the season (bright summer light vs.
 * dark-outside winter training) reads as "made now" rather than stock.
 *
 * @param {Date} [date]
 * @returns {string}
 */
export function seasonHint(date = new Date()) {
  const month = date.getMonth() + 1;
  switch (month) {
    case 1:
      return "Jahresanfang: Neujahrsvorsätze, Trainingsstart, frische Motivation";
    case 2:
      return "Spätwinter: drinnen trainieren, dranbleiben statt aufgeben";
    case 3:
    case 4:
      return "Frühjahr: helles Tageslicht, Motivation für die neue Saison";
    case 5:
      return "Frühsommer: Vorbereitung auf die Outdoor-Saison";
    case 6:
    case 7:
      return "Sommer: warmes, helles Licht, leichtes Training";
    case 8:
      return "Spätsommer: Routine wieder aufnehmen";
    case 9:
    case 10:
      return "Herbst: zurück ins Home-Gym, es wird früher dunkel";
    case 11:
      return "Spätherbst: drinnen trainieren, gemütliches Kunstlicht";
    default:
      return "Weihnachtszeit: Geschenke, Jahresabschluss, Start ins neue Trainingsjahr";
  }
}

/** Squash whitespace and cut on a word boundary. */
export function clip(text, maxChars) {
  const t = String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (t.length <= maxChars) return t;
  const cut = t.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(" ");
  return `${lastSpace > maxChars * 0.6 ? cut.slice(0, lastSpace) : cut}…`;
}

/**
 * The distinct product titles a customer ALREADY owns, newest order first.
 * Feeding these to the hero does two things: the scene can show the new gear
 * completing the existing setup (recognition), and the model stops inventing
 * equipment the person never bought.
 *
 * Accepts BOTH history shapes we store: the chat customer's OrderHistory
 * (customers.purchase_summary) and the campaign contact's CampaignPurchaseSummary.
 *
 * @param {{ orders?: Array<{ items?: Array<{ title?: string | null }> }> } | null | undefined} history
 * @param {number} [limit]
 * @returns {string[]}
 */
export function ownedProductTitles(history, limit = 6) {
  const orders = Array.isArray(history?.orders) ? history.orders : [];
  const seen = new Set();
  const out = [];
  for (const order of orders) {
    for (const item of Array.isArray(order?.items) ? order.items : []) {
      const title = typeof item?.title === "string" ? item.title.trim() : "";
      if (!title) continue;
      const key = title.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(title);
      if (out.length >= limit) return out;
    }
  }
  return out;
}

/**
 * German colour/finish values as the catalogue stores them, mapped to English
 * for the image prompt. The stored values carry a RAL-ish code suffix
 * ("schwarz-150"), which is meaningless to an image model and is stripped.
 * Anything unmapped survives as-is — a wrong colour word is worse than a
 * German one the model can still often read.
 */
const COLOR_WORDS = new Map([
  ["schwarz", "black"],
  ["weiss", "white"],
  ["weiß", "white"],
  ["grau", "grey"],
  ["anthrazit", "anthracite grey"],
  ["silber", "silver"],
  ["chrom", "chrome"],
  ["rot", "red"],
  ["blau", "blue"],
  ["gruen", "green"],
  ["grün", "green"],
  ["gelb", "yellow"],
  ["orange", "orange"],
  ["holz", "wood"],
  ["edelstahl", "stainless steel"],
]);

/**
 * Turn a catalogue colour spec into a prompt-ready English colour word.
 * "schwarz-150" → "black", "Schwarz / Rot" → "black / red".
 *
 * @param {unknown} value
 * @returns {string}
 */
export function colorWordForPrompt(value) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return "";
  return raw
    .split(/\s*[\/,;]\s*/)
    .map((part) => {
      // Drop a trailing code ("-150", " RAL 9005") — pure noise for a model.
      const word = part.replace(/[-\s]+(?:ral\s*)?\d+\s*$/i, "").trim().toLowerCase();
      return COLOR_WORDS.get(word) ?? word;
    })
    .filter(Boolean)
    .slice(0, 2)
    .join(" / ");
}

/**
 * The recommended products as CONCRETE, nameable objects for the image prompt:
 * brand + exact product name + object type + colour, e.g.
 *   "ATX® Functional Trainer - Dual Pulley (Weight Lifting Machines with
 *    Pulleys, black)"
 *
 * Why brand AND type: the brand pins the design language of what the shop
 * actually sells (ATX® is 53 % of this catalogue and has a recognisable matte
 * black, heavy-steel look), while the object type is what the model can
 * reliably render. Neither alone is enough — the type without the brand gives a
 * generic stock gym, the brand without the type gives nothing at all.
 *
 * The colour comes from the catalogue's own spec (846 of 965 products carry
 * one), which is the single cheapest lever on how close the render lands.
 *
 * @param {Array<{ name?: string|null, brand?: string|null, category?: string|null,
 *   specifications?: Record<string, string|number>|null }>} products
 * @param {number} [limit]
 * @returns {string[]}
 */
export function productHeroDescriptors(products, limit = 6) {
  const out = [];
  for (const p of products ?? []) {
    const name = typeof p?.name === "string" ? p.name.trim() : "";
    if (!name) continue;
    const brand = typeof p?.brand === "string" ? p.brand.trim() : "";
    const category = typeof p?.category === "string" ? p.category.trim() : "";
    const specs = p?.specifications ?? {};
    const colorKey = Object.keys(specs).find((k) => /^(farbe|color|ausf)/i.test(k));
    const color = colorKey ? colorWordForPrompt(specs[colorKey]) : "";

    // "Uncategorized" is a catalogue placeholder, not an object type.
    const type = category && !/^uncategori[sz]ed$/i.test(category) ? category : "";
    const detail = [type, color].filter(Boolean).join(", ");
    // Only prefix the brand when the name does not already carry it — some
    // catalogue names lead with a size ("150 kg ATX® Gym Bumper Plates"), so a
    // startsWith check would double it.
    const head =
      brand && !name.toLowerCase().includes(brand.toLowerCase())
        ? `${brand} ${name}`
        : name;
    out.push(detail ? `${head} (${detail})` : head);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Distinct product CATEGORIES of the recommended products — the generic object
 * types, kept alongside the full descriptors as the fallback for products with
 * no brand or colour on file.
 *
 * @param {Array<{ category?: string | null }>} products
 * @param {number} [limit]
 * @returns {string[]}
 */
export function productCategories(products, limit = 4) {
  const seen = new Set();
  const out = [];
  for (const p of products ?? []) {
    const c = typeof p?.category === "string" ? p.category.trim() : "";
    if (!c) continue;
    const key = c.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Loyalty framing for the campaign audience (they never chatted, so their
 * order record is the only thing we know about them).
 *
 * @param {number} ordersCount
 * @param {number} totalSpentCents
 * @returns {string}
 */
export function loyaltyHint(ordersCount, totalSpentCents) {
  const euro = Math.round((Number(totalSpentCents) || 0) / 100);
  if (!Number.isFinite(ordersCount) || ordersCount <= 0) return "Noch kein Kauf bekannt";
  if (ordersCount === 1) return `Erstkäufer:in (1 Bestellung, ca. ${euro} €)`;
  if (ordersCount >= 5) return `Treue:r Stammkund:in (${ordersCount} Bestellungen, ca. ${euro} €)`;
  return `Wiederkäufer:in (${ordersCount} Bestellungen, ca. ${euro} €)`;
}

/**
 * Assemble the labelled context block from already-resolved parts. Empty
 * values are dropped so the model never sees "Bereits gekauft: (unbekannt)"
 * and starts inventing around it.
 *
 * @param {Record<string, string | string[] | null | undefined>} parts
 * @returns {string[]} one "Label: value" line per known fact
 */
export function heroContextLines(parts) {
  const lines = [];
  for (const [label, value] of Object.entries(parts ?? {})) {
    if (Array.isArray(value)) {
      const items = value.filter((v) => typeof v === "string" && v.trim());
      if (items.length) lines.push(`${label}: ${items.join(", ")}`);
      continue;
    }
    const v = typeof value === "string" ? value.trim() : "";
    if (v) lines.push(`${label}: ${v}`);
  }
  return lines;
}
