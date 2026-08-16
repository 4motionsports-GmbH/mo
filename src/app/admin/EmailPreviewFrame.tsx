"use client";

// Rendered-email viewer frame with a Desktop/Mobil width toggle.
//
// Email media queries react to the IFRAME's width, not the admin window's —
// the shell's ≤480px rule stacks the 1/3 | 2/3 product-row columns. Forcing
// the frame to a real device width therefore shows the layout exactly as a
// desktop client (640px → two columns) or a phone (390px → stacked) renders
// it, no matter how narrow the dialog happens to be. Wider than the dialog
// the frame scrolls horizontally instead of shrinking into the mobile rule.

import { useState } from "react";
import { Monitor, Smartphone } from "lucide-react";
import { cn } from "./ui/cn";

const MODES = [
  { key: "desktop", label: "Desktop", width: 640, icon: Monitor },
  { key: "mobile", label: "Mobil", width: 390, icon: Smartphone },
] as const;
type ModeKey = (typeof MODES)[number]["key"];

export function EmailPreviewFrame({ src, title }: { src: string; title: string }) {
  const [mode, setMode] = useState<ModeKey>("desktop");
  const width = MODES.find((m) => m.key === mode)!.width;

  return (
    <div className="mt-3">
      <div className="flex justify-center">
        <div
          role="group"
          aria-label="Vorschau-Breite"
          className="inline-flex gap-0.5 rounded-md border border-border bg-secondary/50 p-0.5"
        >
          {MODES.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => setMode(key)}
              aria-pressed={mode === key}
              className={cn(
                "inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                mode === key
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-2 overflow-x-auto rounded-md border border-border bg-secondary/30 p-3">
        <iframe
          title={title}
          src={src}
          sandbox=""
          style={{ width }}
          className="mx-auto block h-[65vh] shrink-0 rounded-md border border-border bg-white"
        />
      </div>
    </div>
  );
}
