"use client";

// Expanded editor of one Q&A entry. Flow: the AI drafted { Wissenslücke,
// Frage, Produkt? } → the operator edits question / product / answer (+ an
// optional English override) → "Speichern" (status answered) →
// "Veröffentlichen" pushes a product-linked pair to Shopify's custom.qa
// metafield or activates a general pair for Mo's prompt knowledge base;
// "Zurückziehen" / "Verwerfen" / "Wiederherstellen" as before. Every action
// calls the same /api/admin/qa/* route with the same payload.

import * as React from "react";
import Link from "next/link";
import { ArchiveRestore, ExternalLink, Lightbulb, Link2, Save, Send, Trash2, Undo2 } from "lucide-react";
import type { QaEntry } from "@/lib/qa-store";
import { qaAnswerHasLink, qaAnswerHtml } from "@/lib/qa-links.mjs";
import {
  Button,
  Callout,
  CatalogProductPicker,
  Disclosure,
  Field,
  Input,
  Textarea,
  buttonVariants,
  toast,
} from "../ui";
import { adminFetch, errorMessage } from "../lib/admin-fetch";
import { ProductField, type ProductRef } from "./ProductField";

type Busy = null | "save" | "publish" | "dismiss" | "unpublish" | "restore";

function fail(e: unknown) {
  toast({ variant: "error", title: "Fehler", description: errorMessage(e) });
}

export function QaEntryEditor({ entry, onChanged }: { entry: QaEntry; onChanged: () => Promise<void> }) {
  const [question, setQuestion] = React.useState(entry.question);
  const [answer, setAnswer] = React.useState(entry.answer ?? "");
  const [product, setProduct] = React.useState<ProductRef | null>(
    entry.productId ? { handle: entry.productId, title: entry.productTitle } : null
  );
  const [questionEn, setQuestionEn] = React.useState(entry.questionEn ?? "");
  const [answerEn, setAnswerEn] = React.useState(entry.answerEn ?? "");
  const [busy, setBusy] = React.useState<Busy>(null);
  const [linking, setLinking] = React.useState(false);
  const answerRef = React.useRef<HTMLTextAreaElement>(null);
  const readOnly = entry.status === "dismissed";

  /** Insert a markdown product link at the answer's cursor position (falls
   * back to appending) and put the cursor right after it. */
  const insertProductLink = (markdown: string) => {
    const el = answerRef.current;
    setAnswer((prev) => {
      const at = el && el.selectionStart != null ? el.selectionStart : prev.length;
      const end = el && el.selectionEnd != null ? el.selectionEnd : at;
      const sepBefore = at > 0 && !/\s$/.test(prev.slice(0, at)) ? " " : "";
      const insert = `${sepBefore}${markdown}`;
      const next = prev.slice(0, at) + insert + prev.slice(end);
      const cursor = at + insert.length;
      requestAnimationFrame(() => {
        el?.focus();
        el?.setSelectionRange(cursor, cursor);
      });
      return next;
    });
  };

  const save = async (): Promise<boolean> => {
    try {
      await adminFetch("/api/admin/qa/answer", {
        body: {
          id: entry.id,
          question,
          answer,
          productId: product?.handle.trim() || null,
          questionEn,
          answerEn,
        },
      });
      return true;
    } catch (e) {
      fail(e);
      return false;
    }
  };

  const onSave = async () => {
    setBusy("save");
    if (await save()) {
      toast({ variant: "success", title: "Gespeichert" });
      await onChanged();
    }
    setBusy(null);
  };

  const onPublish = async () => {
    if (!answer.trim()) {
      fail(new Error("Bitte zuerst eine Antwort eintragen."));
      return;
    }
    setBusy("publish");
    // Save first so exactly what is on screen gets published.
    if (await save()) {
      try {
        const res = await adminFetch<{ catalogRefreshed?: boolean; hasEnglish?: boolean }>(
          "/api/admin/qa/publish",
          { body: { id: entry.id } }
        );
        const enNote = res.hasEnglish
          ? " Englische Version inklusive."
          : " ⚠️ Ohne englische Übersetzung (Fallback: Deutsch) — erneut veröffentlichen versucht es nochmal.";
        toast({
          variant: "success",
          title: "Veröffentlicht",
          description:
            (product
              ? `In Shopify (custom.qa) gespeichert${res.catalogRefreshed ? " und Mos Katalog sofort aktualisiert" : " — Mos Katalog folgt mit dem nächsten Sync"}.`
              : "In Mos allgemeine Wissensbasis übernommen.") + enNote,
        });
        await onChanged();
      } catch (e) {
        fail(e);
      }
    }
    setBusy(null);
  };

  const simpleAction = async (
    kind: Exclude<Busy, null | "save" | "publish">,
    path: string,
    success: (res: { entry?: { status?: string } }) => { title: string; description?: string } | null
  ) => {
    setBusy(kind);
    try {
      const res = await adminFetch<{ entry?: { status?: string } }>(path, { body: { id: entry.id } });
      const t = success(res);
      if (t) toast({ variant: "success", ...t });
      await onChanged();
    } catch (e) {
      fail(e);
    }
    setBusy(null);
  };

  const onUnpublish = () =>
    simpleAction("unpublish", "/api/admin/qa/unpublish", () => ({
      title: "Zurückgezogen",
      description: entry.productId
        ? "Aus dem Shopify-Metafeld entfernt und aus Mos Wissen gelöscht. Der Eintrag steht wieder auf „Beantwortet“."
        : "Aus Mos allgemeiner Wissensbasis entfernt. Der Eintrag steht wieder auf „Beantwortet“.",
    }));
  const onRestore = () =>
    simpleAction("restore", "/api/admin/qa/restore", (res) => ({
      title: "Wiederhergestellt",
      description:
        res.entry?.status === "answered"
          ? "Der Eintrag ist zurück in der Warteschlange (Beantwortet — Antwort blieb erhalten)."
          : "Der Eintrag ist zurück in der Offen-Warteschlange.",
    }));
  const onDismiss = () =>
    simpleAction("dismiss", "/api/admin/qa/dismiss", () => ({
      title: "Verworfen",
      description: "Der Eintrag ist unter „Verworfen“ wiederherstellbar.",
    }));

  const hasEnglish = Boolean(entry.questionEn || entry.answerEn);

  return (
    <div className="flex flex-col gap-4 border-t border-border px-4 pb-4 pt-3">
      <Callout tone="neutral" compact icon={<Lightbulb className="size-3.5" />}>
        <span className="font-medium">Wissenslücke:</span> {entry.gapSummary}
      </Callout>

      <Field label="Frage" info="Öffentlich sichtbar — im Q&A der Produktseite bzw. als Frage in Mos Wissensbasis. Anpassbar.">
        <Input value={question} onChange={(e) => setQuestion(e.target.value)} disabled={readOnly} />
      </Field>

      <Field
        label="Produkt"
        info="Leer = allgemeine Frage für Mos Wissensbasis. Mit Produkt schreibt „Veröffentlichen“ die Frage in das Shopify-Metafeld custom.qa (Q&A-Tab der Produktseite + Mos Produktwissen)."
        htmlFor={`qa-product-${entry.id}`}
      >
        <div id={`qa-product-${entry.id}`}>
          <ProductField value={product} onChange={setProduct} disabled={readOnly} onError={fail} />
        </div>
      </Field>

      <Field
        label="Antwort"
        info={
          <>
            Erscheint öffentlich im Q&A und in Mos Wissen. Links als{" "}
            <code>[Angezeigter Text](https://…)</code> schreiben — sie erscheinen im Q&A als
            klickbarer Text statt als URL; „Produkt verlinken“ fügt einen fertigen Link an der
            Cursorposition ein.
          </>
        }
        labelEnd={
          !readOnly && !linking ? (
            <Button size="xs" variant="ghost" onClick={() => setLinking(true)}>
              <Link2 /> Produkt verlinken
            </Button>
          ) : undefined
        }
      >
        <Textarea
          ref={answerRef}
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          rows={4}
          placeholder="Die Antwort des motion sports Teams — erscheint öffentlich im Q&A und in Mos Wissen."
          disabled={readOnly}
        />
      </Field>
      {linking && (
        <div className="flex items-start gap-1.5">
          <div className="min-w-0 flex-1">
            <CatalogProductPicker
              autoFocus
              showThumbnails={false}
              maxResults={6}
              selectLabel="verlinken"
              placeholder="Produkt suchen (tippen)…"
              ariaLabel="Produkt zum Verlinken suchen"
              disableReason={(hit) => (hit.url ? null : "Für dieses Produkt ist keine Shop-URL bekannt")}
              onSelect={(hit, variant) => {
                if (!hit.url) return;
                const url =
                  variant?.variantId != null
                    ? `${hit.url}${hit.url.includes("?") ? "&" : "?"}variant=${variant.variantId}`
                    : hit.url;
                const label = variant?.title ? `${hit.title} – ${variant.title}` : hit.title;
                insertProductLink(`[${label}](${url})`);
                setLinking(false);
              }}
              onError={fail}
            />
          </div>
          <Button size="sm" variant="ghost" onClick={() => setLinking(false)}>
            Abbrechen
          </Button>
        </div>
      )}
      <QaAnswerPreview answer={answer} />

      {!readOnly && (
        <Disclosure
          framed={false}
          title={<span className="text-xs font-medium">Englische Version</span>}
          meta="optional — leer = automatische Übersetzung beim Veröffentlichen"
          defaultOpen={hasEnglish}
        >
          <div className="flex flex-col gap-2">
            <Input
              value={questionEn}
              onChange={(e) => setQuestionEn(e.target.value)}
              placeholder="Question (English) — auto-translated if empty"
              aria-label="Frage (Englisch)"
            />
            <Textarea
              value={answerEn}
              onChange={(e) => setAnswerEn(e.target.value)}
              rows={3}
              placeholder="Answer (English) — auto-translated if empty"
              aria-label="Antwort (Englisch)"
            />
            <QaAnswerPreview answer={answerEn} />
          </div>
        </Disclosure>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {readOnly ? (
          <Button onClick={() => void onRestore()} loading={busy === "restore"} disabled={busy !== null} variant="outline">
            {busy !== "restore" && <ArchiveRestore />}
            Wiederherstellen
          </Button>
        ) : (
          <>
            <Button onClick={() => void onSave()} loading={busy === "save"} disabled={busy !== null} variant="outline">
              {busy !== "save" && <Save />}
              Speichern
            </Button>
            <Button
              onClick={() => void onPublish()}
              loading={busy === "publish"}
              disabled={busy !== null || !answer.trim()}
            >
              {busy !== "publish" && <Send />}
              {entry.status === "published" ? "Änderung erneut veröffentlichen" : "Veröffentlichen"}
            </Button>
            {entry.status === "published" ? (
              <Button onClick={() => void onUnpublish()} loading={busy === "unpublish"} disabled={busy !== null} variant="ghost">
                {busy !== "unpublish" && <Undo2 />}
                Zurückziehen
              </Button>
            ) : (
              <Button onClick={() => void onDismiss()} loading={busy === "dismiss"} disabled={busy !== null} variant="ghost">
                {busy !== "dismiss" && <Trash2 />}
                Verwerfen
              </Button>
            )}
          </>
        )}
        {entry.conversationId != null && (
          <Link
            href={`/admin?tab=gespraeche&gid=${entry.conversationId}`}
            className={`${buttonVariants({ variant: "ghost", size: "sm" })} ml-auto text-muted-foreground`}
          >
            <ExternalLink /> Gespräch #{entry.conversationId}
          </Link>
        )}
      </div>
    </div>
  );
}

/** Live preview of an answer's rendered form — shown only when the text
 * actually contains a link. The HTML comes from qa-links.mjs, which escapes
 * everything and only ever emits http(s) anchors (the same renderer the
 * published metafield's a_html uses, so the preview IS what the storefront
 * shows). */
function QaAnswerPreview({ answer }: { answer: string }) {
  if (!qaAnswerHasLink(answer)) return null;
  return (
    <div className="rounded-md border border-border bg-surface-2 px-3 py-2 text-sm">
      <div className="mb-1 text-2xs font-medium text-muted-foreground">
        Vorschau (so erscheint die Antwort im Q&A)
      </div>
      <div
        className="whitespace-pre-line [&_a]:text-info [&_a]:underline [&_a]:underline-offset-2"
        dangerouslySetInnerHTML={{ __html: qaAnswerHtml(answer) }}
      />
    </div>
  );
}
