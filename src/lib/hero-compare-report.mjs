// The comparison sheet scripts/hero-quality-compare.mjs writes: one
// self-contained HTML file (images embedded) that puts two renders of the
// same hero prompt side by side, each shown the way the reader sees it
// (desktop hero with the headline over it, mobile row under the text).
//
// Pure: takes the rendered rows, returns HTML. Tested — the blind mode and
// the embedded images are what make the sheet usable in a client meeting.

const escapeHtml = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const dataUri = (buf, mime = "image/jpeg") => `data:${mime};base64,${Buffer.from(buf).toString("base64")}`;

export const fmtUsd = (n) => `${Number(n ?? 0).toFixed(3)} $`;
export const fmtEur = (n) => `${Number(n ?? 0).toFixed(2).replace(".", ",")} €`;

/**
 * Deterministic order of the variants per row (seeded on the prompt text):
 * stable across re-generations of the SAME prompts, yet the better variant
 * is not always in the same position — the blind mode depends on that.
 * @param {string} prompt
 * @param {number} n
 * @returns {number[]} variant indexes in display order
 */
export function variantOrder(prompt, n) {
  let h = 0;
  for (const ch of String(prompt)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const order = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    h = (h * 1103515245 + 12345) >>> 0;
    const j = h % (i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

const LETTERS = "ABCDEFGH";

/**
 * @typedef {object} CompareVariant
 * @property {string} label          what this variant is ("high + Referenzen")
 * @property {string} quality        "medium" | "high"
 * @property {string} model          the model that actually rendered
 * @property {string} [mode]         "generate" | "edit"
 * @property {number} [references]   reference photos handed to the model
 * @property {{ score: number, pass: boolean, reasons: string[] } | null} [qa]
 * @property {string} size           the size that was accepted
 * @property {Buffer} desktop        JPEG with gradient
 * @property {Buffer} mobile         JPEG crop
 * @property {number} inputTokens
 * @property {number} outputTokens
 * @property {number} usd
 * @property {number} eur
 * @property {number} seconds
 */

/**
 * @typedef {object} CompareRow
 * @property {number} index
 * @property {string} source        where the prompt came from ("campaign #12", "datei")
 * @property {string} prompt        the full prompt sent to the model
 * @property {string} headline      two lines, "\n"-separated
 * @property {CompareVariant[]} variants  two or more
 */

function heroMock(v, headline, kicker, subline, cta) {
  const lines = escapeHtml(headline).split("\n").join("<br>");
  return `
      <div class="hero" style="background-image:url('${dataUri(v.desktop)}')">
        <div class="hero-text">
          <div class="kicker">${escapeHtml(kicker)}</div>
          <div class="title">${lines}</div>
          <div class="sub">${escapeHtml(subline)}</div>
          <div class="cta">${escapeHtml(cta)} &nbsp;→</div>
        </div>
        <div class="ai-label">KI-generiertes Bild</div>
      </div>
      <div class="mobile">
        <div class="mobile-text">
          <div class="kicker">${escapeHtml(kicker)}</div>
          <div class="title">${lines}</div>
          <div class="cta">${escapeHtml(cta)} &nbsp;→</div>
        </div>
        <img src="${dataUri(v.mobile)}" alt="Handy-Ausschnitt">
      </div>
      <div class="raw"><a href="${dataUri(v.desktop)}" target="_blank" rel="noopener">Bild in voller Größe öffnen</a></div>`;
}

/**
 * @param {CompareRow[]} rows
 * @param {{ title?: string, generatedAt?: Date, note?: string, kicker?: string, subline?: string, cta?: string }} [opts]
 * @returns {string}
 */
export function buildCompareReportHtml(rows, opts = {}) {
  const title = opts.title ?? "Hero-Bilder: Qualitätsvergleich";
  const generatedAt = opts.generatedAt ?? new Date();
  const kicker = opts.kicker ?? "Mehr aus deinem Setup";
  const subline = opts.subline ?? "Handverlesen auf Basis deiner letzten Einkäufe — abgestimmt auf dein Training.";
  const cta = opts.cta ?? "Beratung starten";
  const totalUsd = rows.reduce((s, r) => s + r.variants.reduce((t, v) => t + (v.usd ?? 0), 0), 0);
  const totalEur = rows.reduce((s, r) => s + r.variants.reduce((t, v) => t + (v.eur ?? 0), 0), 0);
  const labels = [...new Set(rows.flatMap((r) => r.variants.map((v) => v.label ?? v.quality)))];
  const models = [...new Set(rows.flatMap((r) => r.variants.map((v) => v.model)))];

  const rowHtml = rows
    .map((r) => {
      const order = variantOrder(r.prompt, r.variants.length);
      const card = (v, side) => {
        const label = v.label ?? v.quality;
        const qa = v.qa
          ? ` · KI-Prüfung ${v.qa.score}/10 ${v.qa.pass ? "✓" : "✗"}${v.qa.reasons?.length ? ` (${escapeHtml(v.qa.reasons.join(", "))})` : ""}`
          : "";
        const refs = v.references ? ` · ${v.references} Referenzfotos` : "";
        return `
    <div class="card" data-variant="${escapeHtml(label)}">
      <div class="card-head">
        <span class="side">${side}</span>
        <span class="secret">${escapeHtml(label)} · ${escapeHtml(v.model)} · ${escapeHtml(v.size)}${refs} · ${fmtUsd(v.usd)} (${fmtEur(v.eur)}) · ${v.seconds.toFixed(0)} s${qa}</span>
        <label class="pick"><input type="radio" name="pick-${r.index}" value="${escapeHtml(label)}"> Favorit</label>
      </div>${heroMock(v, r.headline, kicker, subline, cta)}
    </div>`;
      };
      return `
  <section class="row" id="row-${r.index}">
    <h2>Prompt ${r.index} <small>${escapeHtml(r.source)}</small></h2>
    <details><summary>Prompt anzeigen</summary><pre>${escapeHtml(r.prompt)}</pre></details>
    <div class="pair">${order.map((vi, pos) => card(r.variants[vi], LETTERS[pos])).join("")}</div>
  </section>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; padding: 24px; background: #f2f2f2; color: #222; font-family: Arial, Helvetica, sans-serif; }
  header { max-width: 2040px; margin: 0 auto 24px; }
  h1 { font-size: 22px; margin: 0 0 6px; }
  .meta { color: #555; font-size: 13px; }
  .controls { margin: 14px 0; display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
  button { font: inherit; padding: 8px 14px; border: 1px solid #bbb; border-radius: 6px; background: #fff; cursor: pointer; }
  button.primary { background: #e30613; color: #fff; border-color: #e30613; }
  .tally { font-size: 14px; color: #333; }
  .row { max-width: 2040px; margin: 0 auto 36px; }
  h2 { font-size: 16px; margin: 0 0 6px; }
  h2 small { font-weight: normal; color: #777; font-size: 13px; margin-left: 8px; }
  details { margin: 0 0 10px; font-size: 12px; color: #555; }
  pre { white-space: pre-wrap; background: #fff; border: 1px solid #ddd; padding: 10px; border-radius: 6px; }
  /* Every card keeps the hero's TRUE width (640px + padding) so the mock is
     what the mail shows; cards wrap to as many per row as the screen fits. */
  .pair { display: flex; flex-wrap: wrap; gap: 20px; }
  .card { flex: 0 0 auto; width: 640px; box-sizing: content-box; background: #fff; border: 1px solid #ddd; border-radius: 8px; padding: 12px; }
  .card-head { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; font-size: 13px; }
  .side { font-weight: 700; font-size: 15px; background: #111; color: #fff; border-radius: 4px; padding: 2px 9px; }
  .secret { color: #555; visibility: hidden; }
  body.revealed .secret { visibility: visible; }
  .pick { margin-left: auto; cursor: pointer; }
  .hero { position: relative; width: 640px; height: 300px; max-width: 100%; background-size: cover; background-position: center right; background-color: #f2f2f2; overflow: hidden; }
  .hero-text { position: absolute; left: 0; top: 0; width: 55%; height: 100%; box-sizing: border-box; padding: 36px 20px 36px 40px; display: flex; flex-direction: column; justify-content: center; }
  .kicker { color: #e30613; font-size: 11px; line-height: 16px; font-weight: 700; letter-spacing: .4px; text-transform: uppercase; margin-bottom: 12px; }
  .title { font-size: 40px; line-height: 44px; color: #111; font-weight: 800; letter-spacing: -1.5px; margin-bottom: 14px; }
  .sub { font-size: 14px; line-height: 21px; color: #333; margin-bottom: 22px; max-width: 300px; }
  .cta { display: inline-block; align-self: flex-start; background: #e30613; color: #fff; font-weight: 700; font-size: 14px; padding: 12px 24px; border-radius: 4px; letter-spacing: .3px; }
  .ai-label { position: absolute; right: 12px; bottom: 10px; font-size: 10px; line-height: 14px; color: #555; background: #f2f2f2; border: 1px solid #d9d9d9; border-radius: 3px; padding: 2px 7px; }
  .mobile { width: 390px; max-width: 100%; margin-top: 14px; border: 1px solid #ddd; border-radius: 10px; overflow: hidden; background: #fff; }
  .mobile-text { background: #f7f7f7; padding: 22px; }
  .mobile .title { font-size: 32px; line-height: 36px; letter-spacing: -1px; }
  .mobile .cta { display: block; text-align: center; margin-top: 6px; }
  .mobile img { display: block; width: 100%; height: auto; }
  .raw { font-size: 12px; margin-top: 8px; }
  a { color: #e30613; }
</style>
</head>
<body>
<header>
  <h1>${escapeHtml(title)}</h1>
  <div class="meta">Erzeugt am ${escapeHtml(generatedAt.toLocaleString("de-DE", { timeZone: "Europe/Berlin" }))} · ${rows.length} Prompts × ${labels.length} Varianten (${escapeHtml(labels.join(" / "))}) · Modell ${escapeHtml(models.join(", "))} · Gesamtkosten dieses Vergleichs ${fmtUsd(totalUsd)} (${fmtEur(totalEur)})${opts.note ? ` · ${escapeHtml(opts.note)}` : ""}</div>
  <div class="controls">
    <button class="primary" id="reveal">Auflösen: Qualität, Modell und Kosten zeigen</button>
    <span class="tally" id="tally">Favoriten: noch keine gewählt</span>
  </div>
  <div class="meta">Blind-Modus: Erst die Varianten vergleichen und je Prompt einen Favoriten wählen, dann auflösen. Jede Karte zeigt den Desktop-Hero mit Schlagzeile und darunter die Handy-Ansicht — genau so, wie die E-Mail beim Empfänger aussieht.</div>
</header>
${rowHtml}
<script>
  const body = document.body;
  document.getElementById("reveal").addEventListener("click", () => {
    body.classList.toggle("revealed");
    document.getElementById("reveal").textContent = body.classList.contains("revealed") ? "Wieder verbergen" : "Auflösen: Qualität, Modell und Kosten zeigen";
  });
  const tally = () => {
    const counts = {};
    let total = 0;
    document.querySelectorAll("input[type=radio]:checked").forEach((el) => { counts[el.value] = (counts[el.value] || 0) + 1; total++; });
    const el = document.getElementById("tally");
    if (!total) { el.textContent = "Favoriten: noch keine gewählt"; return; }
    const detail = body.classList.contains("revealed")
      ? " — " + Object.entries(counts).map(([q, n]) => q + " " + n + "×").join(", ")
      : "";
    el.textContent = "Favoriten: " + total + " gewählt" + detail;
  };
  document.querySelectorAll("input[type=radio]").forEach((el) => el.addEventListener("change", tally));
  document.getElementById("reveal").addEventListener("click", tally);
</script>
</body>
</html>`;
}
