"use client";

// Rendered-email viewer frame with a Desktop/Mobil width toggle.
//
// Email media queries react to the IFRAME's width, not the admin window's —
// the shell's ≤480px rule stacks the 1/3 | 2/3 product-row columns. The two
// modes therefore render at real client viewports:
//
//   Desktop — the iframe fills the available width (at least 640px), like a
//             maximized mail client: the 600px email sits centered on its
//             #fafafa background. When the dialog is narrower than 640px the
//             render keeps the 640px viewport and is visually scaled down
//             (transform) instead — layout stays accurate, never sideways
//             scrolling.
//   Mobil   — fixed 390px phone viewport (scaled down the same way if needed).
//
// The frame is height-flexible: inside a flex-col dialog it fills whatever
// vertical space the dialog grants (the near-fullscreen preview dialogs).

import { useEffect, useRef, useState } from "react";
import { Monitor, Smartphone } from "lucide-react";
import { cn } from "./ui/cn";

const MODES = [
  { key: "desktop", label: "Desktop", width: 640, icon: Monitor },
  { key: "mobile", label: "Mobil", width: 390, icon: Smartphone },
] as const;
type ModeKey = (typeof MODES)[number]["key"];

/** Horizontal + vertical inner padding of the measured container (p-2). */
const PAD = 16;

export function EmailPreviewFrame({ src, title }: { src: string; title: string }) {
  const [mode, setMode] = useState<ModeKey>("desktop");
  const [box, setBox] = useState({ w: 0, h: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () =>
      setBox({ w: el.clientWidth - PAD, h: el.clientHeight - PAD });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const base = MODES.find((m) => m.key === mode)!.width;
  const scale = box.w > 0 ? Math.min(1, box.w / base) : 1;
  // Desktop stretches to the dialog width; mobile stays a phone.
  const viewportWidth = mode === "desktop" ? Math.max(base, box.w) : base;
  const clipWidth = Math.round(viewportWidth * scale);
  const clipHeight = Math.max(200, box.h);

  return (
    <div className="mt-3 flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-center gap-2">
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
        {scale < 1 && (
          <span
            className="text-xs text-muted-foreground"
            title={`Auf ${base}px gerendert, zum Einpassen verkleinert`}
          >
            {Math.round(scale * 100)} %
          </span>
        )}
      </div>
      <div
        ref={containerRef}
        className="mt-2 min-h-0 flex-1 rounded-md border border-border bg-secondary/30 p-2"
      >
        {box.w > 0 && (
          <div
            className="mx-auto overflow-hidden rounded-md border border-border bg-white"
            style={{ width: clipWidth, height: clipHeight }}
          >
            <iframe
              title={title}
              src={src}
              sandbox=""
              className="block border-0 bg-white"
              style={{
                width: viewportWidth,
                height: clipHeight / scale,
                transform: `scale(${scale})`,
                transformOrigin: "top left",
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
