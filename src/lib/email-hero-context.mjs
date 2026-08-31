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
  "Photorealistic premium e-commerce hero shot in a bright modern home gym: " +
  "clean white and light-grey concrete surfaces, soft natural daylight from a " +
  "large window, matte black fitness equipment with subtle red accents, shallow " +
  "depth of field, calm and motivating mood. WIDE LANDSCAPE composition (3:2). " +
  "IMPORTANT COMPOSITION RULE: the left 45% of the frame must stay very bright, " +
  "soft and almost empty — an out-of-focus near-white wall or floor area that " +
  "fades smoothly into the scene — because dark headline text is placed there; " +
  "all products and visual interest belong in the right half. Strictly no text, " +
  "no lettering, no logos, no watermarks, no human faces.";

/**
 * Guarantee a prompt carries the CURRENT style rules. A prompt stored before
 * those rules existed (e.g. the earlier portrait tail) would fight the layout,
 * so a superseded tail is replaced — the operator's own scene text is never
 * touched.
 *
 * @param {string} prompt
 * @returns {string}
 */
export function ensureHeroStyleTail(prompt) {
  const text = String(prompt ?? "");
  if (text.includes("IMPORTANT COMPOSITION RULE")) return text;
  const legacyStart = text.indexOf("Photorealistic premium e-commerce hero shot");
  const scene = (legacyStart >= 0 ? text.slice(0, legacyStart) : text).trim();
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
 * Distinct product CATEGORIES of the recommended products. Image models render
 * "power rack, resistance bands" far more reliably than "ATX® Kabelzuggriff-Set"
 * — the brand names mean nothing to them, the object types mean everything.
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
