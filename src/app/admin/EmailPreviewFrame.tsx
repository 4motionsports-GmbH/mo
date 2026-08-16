"use client";

// Rendered-email viewer frame with a Desktop/Mobil width toggle.
//
// Email media queries react to the IFRAME's width, not the admin window's —
// the shell's ≤480px rule stacks the 1/3 | 2/3 product-row columns. The frame
// therefore always renders the email at a REAL device viewport (640px desktop
// / 390px phone) so the layout is exactly what that client shows. When the
// dialog is narrower than the device width, the frame is scaled down visually
// (transform) instead of shrinking the viewport — the layout stays accurate,
// it's just zoomed to fit, so there is never sideways scrolling.

import { useEffect, useRef, useState } from "react";
import { Monitor, Smartphone } from "lucide-react";
import { cn } from "./ui/cn";

const MODES = [
  { key: "desktop", label: "Desktop", width: 640, icon: Monitor },
  { key: "mobile", label: "Mobil", width: 390, icon: Smartphone },
] as const;
type ModeKey = (typeof MODES)[number]["key"];

/** Displayed frame height; the iframe's inner height is this divided by the
 * scale so the visible area stays constant when zoomed. */
const FRAME_HEIGHT = "68vh";

export function EmailPreviewFrame({ src, title }: { src: string; title: string }) {
  const [mode, setMode] = useState<ModeKey>("desktop");
  const [scale, setScale] = useState(1);
  const containerRef = useRef<HTMLDivElement>(null);
  const width = MODES.find((m) => m.key === mode)!.width;

  // Fit-to-width: watch the container and shrink the render (never enlarge)
  // when the dialog can't hold the full device width.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const fit = () => setScale(Math.min(1, el.clientWidth / width));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [width]);

  return (
    <div className="mt-3">
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
          <span className="text-xs text-muted-foreground" title={`Auf ${width}px gerendert, zum Einpassen verkleinert`}>
            {Math.round(scale * 100)} %
          </span>
        )}
      </div>
      <div
        ref={containerRef}
        className="mt-2 rounded-md border border-border bg-secondary/30 p-2"
      >
        <div
          className="mx-auto overflow-hidden rounded-md border border-border bg-white"
          style={{ width: Math.round(width * scale), height: FRAME_HEIGHT }}
        >
          <iframe
            title={title}
            src={src}
            sandbox=""
            className="block border-0 bg-white"
            style={{
              width,
              height: `calc(${FRAME_HEIGHT} / ${scale})`,
              transform: `scale(${scale})`,
              transformOrigin: "top left",
            }}
          />
        </div>
      </div>
    </div>
  );
}
