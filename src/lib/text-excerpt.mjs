// Plain-text excerpt of a Markdown text (pure, tested) — for one-line previews
// such as the profile excerpt on the Eingang customer card. Drops heading
// lines (incl. a bold-only first line like „**Aktuelles Verständnis**“),
// strips inline markers and list bullets, collapses whitespace and cuts at a
// word boundary.

/**
 * @param {string | null | undefined} md
 * @param {number} [max]
 * @returns {string | null}
 */
export function plainExcerpt(md, max = 280) {
  if (!md) return null;
  const lines = String(md)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !/^#{1,6}\s/.test(l) && !/^\*\*[^*]+\*\*:?$/.test(l))
    .map((l) =>
      l
        .replace(/^[-*+]\s+/, "")
        .replace(/^\d+\.\s+/, "")
        .replace(/\*\*([^*]+)\*\*/g, "$1")
        .replace(/__([^_]+)__/g, "$1")
        .replace(/\*([^*]+)\*/g, "$1")
        .replace(/`([^`]+)`/g, "$1")
        .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    );
  const text = lines.join(" ").replace(/\s+/g, " ").trim();
  if (!text) return null;
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()} …`;
}
