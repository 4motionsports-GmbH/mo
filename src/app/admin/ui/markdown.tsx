// Markdown — a small, dependency-free, SANITIZED markdown renderer for the admin
// panel. It exists so model-generated text (customer "current understanding"
// summaries, marketing email drafts/previews) renders as nicely formatted,
// theme-aware HTML instead of raw markdown — consistent with the rest of the
// admin design system (design tokens, light/dark).
//
// SAFETY: this renderer NEVER uses dangerouslySetInnerHTML. It parses a small
// markdown subset and emits React elements directly, so every bit of model text
// becomes a text node (escaped by React) — there is no HTML-injection surface.
// The only attribute derived from content is link href, which is whitelisted to
// safe schemes (http/https/mailto/tel) or relative/anchor paths; anything else
// is downgraded to plain text.
//
// Supported subset (what the model actually emits in these flows): headings
// (#..######), bold (**/__), italic (*/_), inline code (`…`), links
// ([text](url)), unordered (-/*/+) and ordered (1.) lists, blockquotes (>),
// horizontal rules (---), paragraphs and single line breaks.

import * as React from "react";
import { cn } from "./cn";

/** Whitelist link targets to safe schemes; return null for anything unsafe so
 * the caller renders the text without a link (e.g. `javascript:` is dropped). */
function sanitizeUrl(url: string): string | null {
  const t = url.trim();
  if (/^(https?:|mailto:|tel:)/i.test(t)) return t;
  if (t.startsWith("/") || t.startsWith("#")) return t;
  return null;
}

/** Inline parser: bold / italic / inline code / links. Recurses for the content
 * of emphasis and link text. Returns an array of strings and React elements. */
function parseInline(text: string, keyBase: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let buf = "";
  let i = 0;
  let n = 0;
  const push = (node: React.ReactNode) => {
    if (buf) {
      out.push(buf);
      buf = "";
    }
    out.push(node);
  };
  while (i < text.length) {
    const rest = text.slice(i);
    let m: RegExpExecArray | null;
    if ((m = /^`([^`]+)`/.exec(rest))) {
      push(
        <code
          key={`${keyBase}-c${n++}`}
          className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]"
        >
          {m[1]}
        </code>
      );
      i += m[0].length;
    } else if ((m = /^(\*\*|__)(?=\S)([\s\S]+?)\1/.exec(rest))) {
      push(
        <strong key={`${keyBase}-b${n++}`} className="font-semibold text-foreground">
          {parseInline(m[2], `${keyBase}-b${n}`)}
        </strong>
      );
      i += m[0].length;
    } else if ((m = /^(\*|_)(?=\S)([\s\S]+?)\1/.exec(rest))) {
      push(
        <em key={`${keyBase}-i${n++}`}>{parseInline(m[2], `${keyBase}-i${n}`)}</em>
      );
      i += m[0].length;
    } else if ((m = /^\[([^\]]+)\]\(([^)\s]+)\)/.exec(rest))) {
      const href = sanitizeUrl(m[2]);
      if (href) {
        push(
          <a
            key={`${keyBase}-a${n++}`}
            href={href}
            target="_blank"
            rel="noreferrer"
            className="text-accent underline underline-offset-2 hover:opacity-80"
          >
            {parseInline(m[1], `${keyBase}-a${n}`)}
          </a>
        );
      } else {
        buf += m[1];
      }
      i += m[0].length;
    } else {
      buf += text[i];
      i += 1;
    }
  }
  if (buf) out.push(buf);
  return out;
}

/** Render a paragraph's text, turning single newlines into <br/>. */
function inlineWithBreaks(text: string, keyBase: string): React.ReactNode[] {
  const lines = text.split("\n");
  const out: React.ReactNode[] = [];
  lines.forEach((line, idx) => {
    if (idx > 0) out.push(<br key={`${keyBase}-br${idx}`} />);
    out.push(...parseInline(line, `${keyBase}-l${idx}`));
  });
  return out;
}

const HEADING_CLASS: Record<number, string> = {
  1: "mt-1 text-base font-semibold text-foreground",
  2: "mt-1 text-sm font-semibold text-foreground",
  3: "text-[13px] font-semibold text-foreground",
  4: "text-[13px] font-semibold text-foreground",
  5: "text-xs font-semibold text-muted-foreground",
  6: "text-xs font-semibold text-muted-foreground",
};

function isBlockStart(line: string): boolean {
  return (
    /^(#{1,6})\s+/.test(line) ||
    /^\s*[-*+]\s+/.test(line) ||
    /^\s*\d+[.)]\s+/.test(line) ||
    /^>\s?/.test(line) ||
    /^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)
  );
}

/** Block parser: splits the source into headings, lists, blockquotes, rules and
 * paragraphs, each rendered with inline formatting. */
function parseBlocks(md: string): React.ReactNode[] {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const blocks: React.ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Blank line → block separator.
    if (!line.trim()) {
      i += 1;
      continue;
    }

    // Horizontal rule.
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      blocks.push(<hr key={`hr${key++}`} className="my-3 border-border" />);
      i += 1;
      continue;
    }

    // Heading.
    const hm = /^(#{1,6})\s+(.*)$/.exec(line);
    if (hm) {
      const level = hm[1].length;
      const Tag = `h${level}` as keyof React.JSX.IntrinsicElements;
      blocks.push(
        <Tag key={`h${key++}`} className={HEADING_CLASS[level]}>
          {parseInline(hm[2], `h${key}`)}
        </Tag>
      );
      i += 1;
      continue;
    }

    // Blockquote — gather consecutive `>` lines.
    if (/^>\s?/.test(line)) {
      const quoted: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        quoted.push(lines[i].replace(/^>\s?/, ""));
        i += 1;
      }
      blocks.push(
        <blockquote
          key={`bq${key++}`}
          className="border-l-2 border-border pl-3 text-muted-foreground italic"
        >
          {parseBlocks(quoted.join("\n"))}
        </blockquote>
      );
      continue;
    }

    // Unordered list.
    if (/^\s*[-*+]\s+/.test(line)) {
      const items: React.ReactNode[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        const content = lines[i].replace(/^\s*[-*+]\s+/, "");
        items.push(
          <li key={`uli${key}-${items.length}`}>{parseInline(content, `uli${key}-${items.length}`)}</li>
        );
        i += 1;
      }
      blocks.push(
        <ul key={`ul${key++}`} className="list-disc space-y-1 pl-5">
          {items}
        </ul>
      );
      continue;
    }

    // Ordered list.
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: React.ReactNode[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        const content = lines[i].replace(/^\s*\d+[.)]\s+/, "");
        items.push(
          <li key={`oli${key}-${items.length}`}>{parseInline(content, `oli${key}-${items.length}`)}</li>
        );
        i += 1;
      }
      blocks.push(
        <ol key={`ol${key++}`} className="list-decimal space-y-1 pl-5">
          {items}
        </ol>
      );
      continue;
    }

    // Paragraph — gather consecutive lines until a blank line or a new block.
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i])) {
      para.push(lines[i]);
      i += 1;
    }
    blocks.push(
      <p key={`p${key++}`}>{inlineWithBreaks(para.join("\n"), `p${key}`)}</p>
    );
  }

  return blocks;
}

/**
 * Render model-generated markdown as themed, sanitized HTML. Presentation only —
 * the underlying stored text is never modified. Use anywhere the model's
 * markdown would otherwise be shown raw (summaries, drafts, previews).
 */
export function Markdown({
  content,
  className,
}: {
  content: string | null | undefined;
  className?: string;
}) {
  const text = content ?? "";
  return (
    <div
      className={cn(
        "space-y-2 text-sm leading-relaxed break-words text-foreground",
        className
      )}
    >
      {parseBlocks(text)}
    </div>
  );
}
