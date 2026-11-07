"use client";

// Live preview of a template / Rundmail while it is edited: the UNSAVED
// document goes (debounced) to POST /api/admin/vorlagen/preview, which renders
// it through the production renderers — as a Rundmail or as the design of a
// personal campaign mail — and returns inert HTML. Shown in the shared
// EmailPreviewFrame (sandboxed iframe, Desktop / Mobil).

import * as React from "react";
import { Callout, SegmentedControl, Skeleton } from "../ui";
import { EmailPreviewFrame } from "../EmailPreviewFrame";
import type { MailDoc } from "./BlockEditor";

export function LivePreview({
  doc,
  use,
  subject = "",
  preheader = null,
  language = "de",
  firstName = "Alex",
  title,
}: {
  doc: MailDoc;
  /** bulk = as a Rundmail; personal = around a sample campaign mail. */
  use: "bulk" | "personal";
  subject?: string;
  preheader?: string | null;
  language?: "de" | "en";
  firstName?: string | null;
  title: string;
}) {
  const [sample, setSample] = React.useState<"items" | "set">("items");
  const [state, setState] = React.useState<{ url: string | null; error: string | null; loading: boolean }>({
    url: null,
    error: null,
    loading: true,
  });
  const payload = JSON.stringify({ doc, use, subject, preheader, language, firstName, sample });

  React.useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | null = null;
    setState((s) => ({ ...s, loading: true }));
    const handle = setTimeout(() => {
      fetch("/api/admin/vorlagen/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
        signal: controller.signal,
      })
        .then(async (res) => {
          if (!res.ok) {
            const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
            throw new Error(json?.error?.message ?? `Vorschau fehlgeschlagen (${res.status})`);
          }
          const blob = await res.blob();
          if (controller.signal.aborted) return;
          objectUrl = URL.createObjectURL(blob);
          setState({ url: objectUrl, error: null, loading: false });
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return;
          setState({ url: null, error: err instanceof Error ? err.message : "Vorschau fehlgeschlagen.", loading: false });
        });
    }, 500);
    return () => {
      clearTimeout(handle);
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [payload]);

  return (
    <div className="flex h-full min-h-[560px] flex-col">
      {use === "personal" && (
        <div className="flex items-center justify-center">
          <SegmentedControl
            label="Beispiel"
            size="sm"
            value={sample}
            onChange={setSample}
            options={[
              { value: "items", label: "Einzelprodukte" },
              { value: "set", label: "Set-Angebot" },
            ]}
          />
        </div>
      )}
      {state.error ? (
        <Callout tone="warning" className="mt-3">
          {state.error}
        </Callout>
      ) : state.url ? (
        <EmailPreviewFrame src={state.url} title={title} />
      ) : (
        <Skeleton className="mt-3 h-full min-h-[520px] w-full" />
      )}
    </div>
  );
}
