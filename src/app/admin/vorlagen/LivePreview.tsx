"use client";

// Live preview of a template / Rundmail while it is edited: the UNSAVED
// document goes (debounced) to POST /api/admin/vorlagen/preview, which renders
// it through the production renderers — as a Rundmail or as the design of a
// personal campaign mail — and returns inert HTML. Shown in the shared
// EmailPreviewFrame (sandboxed iframe, Desktop / Mobil).

import * as React from "react";
import { Callout, SegmentedControl, Skeleton } from "../ui";
import { EmailPreviewFrame } from "../EmailPreviewFrame";
import { num } from "@/lib/admin-format.mjs";
import type { MailDoc } from "./BlockEditor";

/** Above this the preview warns (Gmail clips at 102 KB); above the limit a Rundmail cannot be released. */
const MAIL_SIZE_WARN_BYTES = 90 * 1024;
const MAIL_SIZE_LIMIT_BYTES = 100 * 1024;

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
  const [state, setState] = React.useState<{ url: string | null; error: string | null; loading: boolean; bytes: number | null }>({
    url: null,
    error: null,
    loading: true,
    bytes: null,
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
          const bytes = Number(res.headers.get("X-Mail-Bytes")) || null;
          const blob = await res.blob();
          if (controller.signal.aborted) return;
          objectUrl = URL.createObjectURL(blob);
          setState({ url: objectUrl, error: null, loading: false, bytes });
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return;
          setState({ url: null, error: err instanceof Error ? err.message : "Vorschau fehlgeschlagen.", loading: false, bytes: null });
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
      {!state.error && state.bytes != null && state.bytes > MAIL_SIZE_WARN_BYTES && (
        <Callout tone={state.bytes > MAIL_SIZE_LIMIT_BYTES ? "destructive" : "warning"} className="mt-3">
          Die Mail ist {num(Math.round(state.bytes / 1024))} KB groß — Gmail kürzt Mails ab 102 KB und versteckt dann die
          Fußzeile mit dem Abmelde-Link. Bitte Bausteine, Produkt-Kacheln oder Text reduzieren.
        </Callout>
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
