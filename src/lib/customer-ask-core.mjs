// „Frag Mo“ (pure, tested) — the operator asks a question about ONE customer
// („Welche Größe hat sie bestellt?“) and the answer must come from that
// person's record and cite it. This core turns the record into numbered
// sources (orders with every line item and variant, Mo chats, mails,
// campaign mails, consent changes), renders them for the prompt within a
// character budget (newest first), and maps the model's cited numbers back
// to the sources — numbers that do not exist are dropped, never invented.
// docs/CUSTOMER_PLATFORM_PLAN.md §9.5.

const KIND_LABELS = {
  order: "Bestellung",
  chat: "Gespräch mit Mo",
  mail_in: "E-Mail von der Person",
  mail_out: "E-Mail an die Person",
  campaign: "Kampagnen-Mail",
  consent: "Einwilligung",
};

const day = (iso) => (iso ? String(iso).slice(0, 10) : "ohne Datum");
const clip = (s, n) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
const euro = (cents) => `${((Number(cents) || 0) / 100).toFixed(2).replace(".", ",")} €`;

/**
 * @typedef {{ n: number, at: string | null, kind: keyof typeof KIND_LABELS, title: string, body: string }} AskSource
 */

/**
 * Build the numbered sources from a customer detail (lib/customer-detail.ts
 * shape, only the fields used here). Newest first.
 * @returns {AskSource[]}
 */
export function buildAskSources(detail) {
  /** @type {Omit<AskSource, "n">[]} */
  const out = [];
  for (const o of detail.orders ?? []) {
    const items = (o.lineItems ?? [])
      .map((i) => `${i.quantity > 1 ? `${i.quantity}× ` : ""}${i.title}${i.variantTitle ? ` (${i.variantTitle})` : ""}${i.unitPrice != null ? ` à ${String(i.unitPrice).replace(".", ",")} €` : ""}`)
      .join("; ");
    const status = [o.financialStatus, o.fulfillmentStatus, o.cancelledAt ? "storniert" : null].filter(Boolean).join(", ");
    out.push({
      at: o.processedAt ?? null,
      kind: "order",
      title: `Bestellung ${o.name ?? ""} · ${euro(o.totalCents)}`.replace("  ", " "),
      body: [items, status ? `Status: ${status}` : null, o.discountCodes?.length ? `Rabattcodes: ${o.discountCodes.join(", ")}` : null]
        .filter(Boolean)
        .join(" · "),
    });
  }
  for (const s of detail.sessions ?? []) {
    const turns = (s.transcript ?? [])
      .filter((t) => (t.role === "user" || t.role === "assistant") && !t.toolName && String(t.content ?? "").trim())
      .map((t) => `${t.role === "user" ? "Kunde" : "Mo"}: ${clip(t.content, 400)}`);
    out.push({
      at: s.createdAt ?? null,
      kind: "chat",
      title: `Gespräch mit Mo (${s.messageCount ?? turns.length} Nachrichten)`,
      body: turns.join("\n"),
    });
  }
  for (const m of detail.correspondence ?? []) {
    out.push({
      at: m.occurredAt ?? null,
      kind: m.direction === "received" ? "mail_in" : "mail_out",
      title: m.subject ? `„${clip(m.subject, 120)}“` : "(kein Betreff)",
      body: clip(m.snippet ?? "", 600),
    });
  }
  for (const c of detail.campaigns ?? []) {
    if (!c.sentAt) continue;
    out.push({
      at: c.sentAt,
      kind: "campaign",
      title: `${c.campaignName}${c.subject ? ` — „${clip(c.subject, 120)}“` : ""}`,
      body: [c.clickedAt ? `geklickt am ${day(c.clickedAt)}` : "nicht geklickt", c.unsubscribedAt ? "danach abgemeldet" : null]
        .filter(Boolean)
        .join(" · "),
    });
  }
  for (const e of detail.consent?.history ?? []) {
    out.push({
      at: e.occurredAt ?? null,
      kind: "consent",
      title: `${e.state}${e.level ? ` (${e.level})` : ""} · ${e.sourceLabel ?? ""}`.trim(),
      body: e.note ? clip(e.note, 200) : "",
    });
  }
  out.sort((a, b) => String(b.at ?? "").localeCompare(String(a.at ?? "")));
  return out.map((s, i) => ({ n: i + 1, ...s }));
}

/**
 * Render the sources for the prompt, newest first, until the budget is used.
 * @param {AskSource[]} sources
 * @returns {{ text: string, included: number }}
 */
export function renderAskSources(sources, maxChars = 30000) {
  const parts = [];
  let used = 0;
  for (const s of sources) {
    const block = `[${s.n}] ${day(s.at)} · ${KIND_LABELS[s.kind] ?? s.kind} · ${s.title}${s.body ? `\n${s.body}` : ""}`;
    if (used + block.length > maxChars && parts.length > 0) break;
    parts.push(block);
    used += block.length + 2;
  }
  return { text: parts.join("\n\n"), included: parts.length };
}

/**
 * The cited sources of an answer: valid, unique numbers among the included
 * ones, in the model's order. Unknown numbers are dropped.
 * @param {unknown} cited
 * @param {AskSource[]} sources
 * @param {number} included
 */
export function citedSources(cited, sources, included) {
  const seen = new Set();
  const out = [];
  for (const raw of Array.isArray(cited) ? cited : []) {
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1 || n > included || seen.has(n)) continue;
    const s = sources[n - 1];
    if (!s) continue;
    seen.add(n);
    out.push({ n: s.n, at: s.at, kind: s.kind, kindLabel: KIND_LABELS[s.kind] ?? s.kind, title: s.title });
  }
  return out;
}

/**
 * Validate the operator's question.
 * @param {unknown} q
 * @returns {{ ok: true, question: string } | { ok: false, message: string }}
 */
export function normalizeAskQuestion(q) {
  const t = String(q ?? "").replace(/\s+/g, " ").trim();
  if (t.length < 3) return { ok: false, message: "Bitte eine Frage eingeben." };
  if (t.length > 500) return { ok: false, message: "Die Frage ist zu lang (höchstens 500 Zeichen)." };
  return { ok: true, question: t };
}
