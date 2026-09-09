// TranscriptView — the one way a consultation transcript is rendered in the
// admin (Kunden → Beratungen, Gespräche). Customer turns as plain text,
// advisor turns through the sanitised Markdown renderer, optional timestamps
// (Europe/Berlin), tool calls as small chips.

import * as React from "react";
import { Wrench } from "lucide-react";
import { ADMIN_TIME, formatAdmin } from "@/lib/admin-datetime.mjs";
import { cn } from "./cn";
import { EmptyState } from "./empty-state";
import { Markdown } from "./markdown";

export interface TranscriptTurn {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  toolName?: string | null;
  createdAt?: string | null;
}

export interface TranscriptViewProps {
  turns: readonly TranscriptTurn[];
  /** Show the clock time next to each turn when the data carries one. */
  showTimes?: boolean;
  /** Render tool calls as chips (default: hidden). */
  showTools?: boolean;
  emptyText?: string;
  dense?: boolean;
  className?: string;
}

export function TranscriptView({
  turns,
  showTimes = true,
  showTools = false,
  emptyText = "Kein lesbares Transkript.",
  dense = false,
  className,
}: TranscriptViewProps) {
  const visible = turns.filter((t) => {
    if (t.toolName) return showTools;
    return (t.role === "user" || t.role === "assistant") && t.content.trim() !== "";
  });
  if (visible.length === 0) {
    return <EmptyState compact plain title={emptyText} className={className} />;
  }
  return (
    <ol className={cn("flex flex-col", dense ? "gap-2" : "gap-3", className)}>
      {visible.map((t, i) => {
        if (t.toolName) {
          return (
            <li key={i} className="flex items-center gap-1.5 text-2xs text-muted-foreground">
              <Wrench className="size-3" aria-hidden />
              <span className="font-medium">{t.toolName}</span>
              {showTimes && t.createdAt && <span>· {formatAdmin(t.createdAt, ADMIN_TIME)}</span>}
            </li>
          );
        }
        const isUser = t.role === "user";
        return (
          <li key={i} className={cn("flex", isUser ? "justify-start" : "justify-start")}>
            <div
              className={cn(
                "min-w-0 max-w-[92%] rounded-lg px-3 py-2 text-sm",
                isUser ? "bg-surface-2 text-foreground" : "border border-border bg-card text-foreground"
              )}
            >
              <div className="mb-0.5 flex items-center gap-2 text-2xs text-muted-foreground">
                <strong className={cn("font-semibold", isUser ? "text-foreground" : "text-accent")}>
                  {isUser ? "Kunde" : "Mo"}
                </strong>
                {showTimes && t.createdAt && <span>{formatAdmin(t.createdAt, ADMIN_TIME)}</span>}
              </div>
              {isUser ? (
                <p className="whitespace-pre-wrap leading-relaxed">{t.content}</p>
              ) : (
                <Markdown content={t.content} className="leading-relaxed" />
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
