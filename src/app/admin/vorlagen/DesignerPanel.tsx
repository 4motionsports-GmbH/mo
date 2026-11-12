"use client";

// „KI-Gestalter“ — the AI designer of the template and Rundmail editors
// (docs/EMAIL_TEMPLATES.md). A docked, NON-modal card at the top of the
// editor column, so the live preview stays in view while the AI works:
//
//   · the conversation of this editing session — the operator's
//     instructions (with the names of their attachments), the AI's notes as
//     replies (plain text — model output never becomes a link here; with
//     warnings and, in the Rundmail, subject / preview-line suggestions to
//     „Übernehmen“; marked „rückgängig gemacht“ once „Rückgängig“ took the
//     result back, with a notice), failures as destructive callouts; example
//     chips while it is empty. A new reply that is taller than the box is
//     shown from its start (what the AI did comes first); the operator's own
//     turn scrolls to the bottom;
//   · the instruction (Ctrl/⌘ + Enter sends) and the attachments: „Datei
//     anhängen“, drag & drop onto the card, pictures pasted into the text
//     field — they stay for the whole conversation until removed;
//   · while it runs: the latest progress text, the elapsed time and
//     „Abbrechen“;
//   · „Einstellungen für diese Unterhaltung“ — a popover from the header
//     („Einstellungen der KI“) and from the button next to „Gestalten“ that
//     names the active choice („Gründlich · Opus 5.5“): Qualität, Gestaltungs-
//     freiheit, Mo-Funktionen, and the link to the team's defaults and house
//     style (Einstellungen → „KI-Gestalter“, in a new tab so unsaved work
//     stays). Locked while the AI works;
//   · under each reply (and a failure that says so) what the run used, how
//     long it took and what it cost.
//
// The state lives in useDesignerSession (in the workspace); this file is
// only the view. „Mit KI gestalten“ (DesignerToggle) opens and closes it.

import * as React from "react";
import Link from "next/link";
import {
  Check,
  ExternalLink,
  FileCode2,
  FileText,
  Mail,
  MessageSquarePlus,
  Paperclip,
  SlidersHorizontal,
  Sparkles,
  TriangleAlert,
  X,
} from "lucide-react";
import {
  DESIGNER_ATTACHMENT_ACCEPT,
  DESIGNER_ATTACHMENT_BUDGET_BYTES,
  DESIGNER_ATTACHMENT_LIMITS,
  OUTLOOK_MAIL_ADVICE,
  attachmentKindLabel,
  formatFileSize,
} from "@/lib/mail-designer-attachments.mjs";
import {
  DESIGNER_INSTRUCTION_CHARS,
  designerNotesText,
  designerRunLine,
  elapsedLabel,
  type DesignerRun,
  type DesignerTurn,
} from "@/lib/mail-designer-client.mjs";
import {
  DESIGNER_SETTINGS_HREF,
  DESIGNER_TEXTS,
  designerChoiceShort,
  designerChoiceWithQuality,
  sameDesignerQuality,
} from "@/lib/mail-designer-choice.mjs";
import {
  DESIGNER_FREEDOM,
  DESIGNER_QUALITY,
  designerQualityOf,
  designerSettingsLabel,
  type DesignerFreedom,
  type DesignerSettings,
} from "@/lib/mail-template-designer-settings.mjs";
import {
  Button,
  Callout,
  Card,
  Checkbox,
  EmptyState,
  IconButton,
  InfoTip,
  Kbd,
  Popover,
  ProgressBar,
  SegmentedControl,
  Spinner,
  Textarea,
  Tooltip,
  cn,
} from "../ui";
import type { DesignerAttachmentEntry, DesignerSession, DesignerUse } from "./use-designer-session";

interface Example {
  label: string;
  text: string;
  /** the example is about an attachment — open the file picker when none is there */
  wantsFile?: boolean;
}

const REBUILD: Example = {
  label: "Bau diese Mail nach",
  text: "Bau die Mail aus dem Anhang für motion sports nach — gleicher Aufbau und Stil, aber mit unseren Farben, Produkten und Links.",
  wantsFile: true,
};

/** The same for a design of Mo's personal mails: the look of the attachment, Mo's blocks stay. */
const REBUILD_PERSONAL: Example = {
  label: "Bau diese Mail nach",
  text: "Bau das Design der Mail aus dem Anhang für motion sports nach — gleicher Aufbau und Stil, aber mit unseren Farben und Links; Mos persönlicher Text, Mos Angebot und der Mo-Hinweis bleiben drin.",
  wantsFile: true,
};

const EXAMPLES: Record<DesignerUse, Example[]> = {
  bulk: [
    {
      label: "Black-Week-Mail",
      text: "Black-Week-Mail in Schwarz und Gelb: großes Banner oben, kurzer knackiger Text, Gutschein BLACKWEEK25 für 25 % auf alles, Countdown bis Sonntag 23:59 Uhr, unsere Bestseller als Produkt-Raster und ein großer Button „Jetzt sparen“.",
    },
    {
      label: "Newsletter mit Produkt-Spalten",
      text: "Newsletter im Markenlook: Logo mit Navigation (Kraft, Cardio, Zubehör, Sale), Titelbild, kurze Einleitung, dann ein Abschnitt mit zwei Spalten mit je einem Produkt-Highlight und darunter ein Button zum Shop.",
    },
    REBUILD,
  ],
  personal: [
    {
      label: "Ruhiger Premium-Rahmen",
      text: "Ruhiger, hochwertiger Rahmen um Mos Text: Logo oben, Titelbild, dann Mos persönlicher Text, Mos Angebot und der Mo-Hinweis mit Button — viel Weißraum, Akzentfarbe Dunkelblau, eine elegante Schrift für die Überschriften.",
    },
    REBUILD_PERSONAL,
  ],
  template: [
    {
      label: "Newsletter im Markenlook",
      text: "Newsletter-Vorlage im Markenlook von motion sports: Logo mit Navigation, Titelbild, Überschrift, kurzer Text, zwei Produkt-Highlights nebeneinander, ein Button zum Shop und die Fußzeile mit Social-Media.",
    },
    REBUILD,
  ],
};

const EMPTY_TITLE: Record<DesignerUse, string> = {
  bulk: "Beschreib die Rundmail — oder häng eine Mail an, die dir gefällt.",
  personal: "Beschreib das Design um Mos Text.",
  template: "Beschreib die Vorlage — oder häng eine Mail an, die dir gefällt.",
};

const PLACEHOLDER: Record<DesignerUse, string> = {
  bulk: "Beschreib die Rundmail oder was sich ändern soll — z. B. „Button gelb und direkt unter das Bild“",
  personal: "Beschreib das Design um Mos Text — z. B. „ruhiger, mehr Weißraum, Akzentfarbe Dunkelblau“",
  template: "Beschreib die Vorlage oder was sich ändern soll — z. B. „zwei Produkte nebeneinander unter dem Titelbild“",
};
const PLACEHOLDER_LATER = "Was soll sich ändern? z. B. „Überschrift größer, Hintergrund dunkler“";

const hasFiles = (dt: DataTransfer | null) => Array.from(dt?.types ?? []).includes("Files");

const QUALITY_OPTIONS = DESIGNER_QUALITY.map((q) => ({ value: q.id, label: q.label }));
const FREEDOM_OPTIONS = DESIGNER_FREEDOM.map((f) => ({ value: f.id as DesignerFreedom, label: f.label }));
/** Wide enough for the three freedoms in one row (the primitive's own width is 22rem). */
const SETTINGS_POPOVER = "min-w-[min(24rem,calc(100vw-1rem))]";
const SETTINGS_TITLE = "Einstellungen für diese Unterhaltung";

// The modifier key of the shortcut hint — read on the client only (the
// server renders „Strg“), without an effect.
const noSubscribe = () => () => undefined;
const modifierKey = () => (/Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent) ? "⌘" : "Strg");
const serverModifierKey = () => "Strg";

export interface DesignerPanelProps {
  session: DesignerSession;
  use: DesignerUse;
  /** the team's stored settings (Einstellungen → „KI-Gestalter“) — „Standard“ in the settings popover */
  designerSettings: DesignerSettings;
  onClose: () => void;
  /** Rundmail: subject and preview line — the AI's suggestions can be taken over. */
  fields?: {
    subject: string;
    preheader: string;
    onSubject: (value: string) => void;
    onPreheader: (value: string) => void;
    disabled?: boolean;
  } | null;
  className?: string;
}

export function DesignerPanel({ session, use, designerSettings, onClose, fields = null, className }: DesignerPanelProps) {
  const titleId = React.useId();
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const lastTurnRef = React.useRef<HTMLLIElement>(null);
  const depth = React.useRef(0);
  const [dragging, setDragging] = React.useState(false);
  const [now, setNow] = React.useState(0);
  // The settings popover opens at the button that was used (header or next to „Gestalten“).
  const [settingsAt, setSettingsAt] = React.useState<"header" | "footer" | null>(null);
  const mod = React.useSyncExternalStore(noSubscribe, modifierKey, serverModifierKey);
  const L = DESIGNER_ATTACHMENT_LIMITS;
  const { turns, attachments, running } = session;
  const full = attachments.length >= L.maxCount;
  const answered = turns.some((t) => t.role === "assistant");
  const attachedBytes = attachments.reduce((n, a) => n + (a.prepared?.size ?? 0), 0);

  // The instruction gets the focus when the panel opens.
  React.useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // The newest turn in view. The operator's own turn (and with it the
  // running request): the bottom. A reply, an error or a notice: its START
  // when it is taller than the box — the first sentences say what the AI did
  // and what is missing; the suggestions follow below.
  const lastRole = turns.length > 0 ? turns[turns.length - 1].role : null;
  React.useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const li = lastTurnRef.current;
    if (!li || lastRole === "user") {
      el.scrollTop = el.scrollHeight;
      return;
    }
    const gap = 12; // the box's top padding
    if (li.offsetHeight > el.clientHeight - gap) {
      el.scrollTop = Math.max(0, li.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop - gap);
    } else {
      el.scrollTop = el.scrollHeight;
    }
  }, [turns.length, lastRole]);

  // The elapsed time while a request runs.
  React.useEffect(() => {
    if (!running) return;
    const handle = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(handle);
  }, [running]);

  // A file dropped NEXT to the panel must not replace the admin with the file
  // (the unsaved mail would be lost) — swallowed while the panel is open.
  React.useEffect(() => {
    const swallow = (e: DragEvent) => {
      if (e.defaultPrevented || !hasFiles(e.dataTransfer)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "none";
    };
    window.addEventListener("dragover", swallow);
    window.addEventListener("drop", swallow);
    return () => {
      window.removeEventListener("dragover", swallow);
      window.removeEventListener("drop", swallow);
    };
  }, []);

  const elapsed = session.startedAt != null ? Math.max(0, now - session.startedAt) : 0;
  const choiceShort = designerChoiceShort(session.choice);
  const settingsPanel = <DesignerChoiceFields session={session} designerSettings={designerSettings} />;

  const pickFiles = () => fileRef.current?.click();

  // The send button turns into a spinner (disabled) — keep the keyboard in the
  // instruction field for the next turn.
  const send = () => {
    session.send();
    textareaRef.current?.focus();
  };

  const pickExample = (ex: Example) => {
    session.setDraft(ex.text);
    if (ex.wantsFile && attachments.length === 0) pickFiles();
    else textareaRef.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      if (session.canSend) send();
    }
  };

  // Pictures from the clipboard (a screenshot) become attachments; when the
  // clipboard holds text too, the text is pasted and nothing is attached.
  const onPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const data = e.clipboardData;
    if (!data || Array.from(data.types).includes("text/plain")) return;
    const files = Array.from(data.items)
      .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter((f): f is File => f !== null);
    if (files.length === 0) return;
    e.preventDefault();
    session.addFiles(files, "paste");
  };

  const onDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    if (!hasFiles(e.dataTransfer)) return;
    e.preventDefault();
    depth.current += 1;
    setDragging(true);
  };
  const onDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (!hasFiles(e.dataTransfer)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };
  const onDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    if (!hasFiles(e.dataTransfer)) return;
    depth.current = Math.max(0, depth.current - 1);
    if (depth.current === 0) setDragging(false);
  };
  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    if (!hasFiles(e.dataTransfer)) return;
    e.preventDefault();
    depth.current = 0;
    setDragging(false);
    const files = Array.from(e.dataTransfer.files ?? []);
    if (files.length > 0) session.addFiles(files, "drop");
  };

  return (
    <Card
      role="region"
      aria-labelledby={titleId}
      className={cn("relative flex flex-col", className)}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center gap-2 rounded-lg border-2 border-dashed border-accent bg-accent-soft/90 text-sm font-medium text-foreground">
          <Paperclip className="size-4" aria-hidden /> {full ? `Höchstens ${L.maxCount} Anhänge` : "Dateien hier ablegen"}
        </div>
      )}

      {/* header */}
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <Sparkles className="size-4 shrink-0 text-accent" aria-hidden />
        <h3 id={titleId} className="text-sm font-semibold">
          KI-Gestalter
        </h3>
        <InfoTip label="Was der KI-Gestalter kann" panelClassName="max-w-md">
          <p>
            Die KI gestaltet frei: eigene Layouts mit Spalten, Farben, Schriften, Abständen und Hintergrundbildern — und setzt
            Mos Bausteine von selbst ein: Produkte live aus dem Katalog (Bild, Preis und Link stimmen beim Versand), Gutschein,
            Countdown, Anrede mit Vornamen, Navigation, Social-Media und die Pflicht-Fußzeile mit Abmelde-Link.
          </p>
          {use !== "bulk" && (
            <p>
              Für persönliche Mails ordnet sie „Mos persönlicher Text“, „Mos Angebot“ und den Mo-Hinweis ein — den Text schreibt Mo
              weiter selbst.
            </p>
          )}
          <p>
            Klick-Tracking und Abmelde-Link kommen automatisch dazu. Sie ändert, was du sagst — auch Schritt für Schritt im
            Gespräch — und lässt Bilder, Produkte und Codes stehen, die schon in der Mail sind, solange du nichts anderes sagst.
          </p>
          <p>
            Jedes Ergebnis ist ungespeichert: „Rückgängig“ holt den Stand davor zurück — das Gespräch vermerkt es, und die KI
            erfährt es mit der nächsten Anweisung.
          </p>
          <p>
            Wie gründlich und wie frei sie gestaltet und ob sie Mos Funktionen von sich aus einbaut, stellst du für dieses Gespräch
            in „Einstellungen der KI“ ein; den Standard und den Hausstil in Einstellungen.
          </p>
        </InfoTip>
        <div className="ml-auto flex items-center gap-1">
          {(turns.length > 0 || attachments.length > 0) && (
            <Button size="xs" variant="ghost" onClick={session.reset} disabled={running}>
              <MessageSquarePlus aria-hidden /> Neues Gespräch
            </Button>
          )}
          <Popover
            open={settingsAt === "header"}
            onOpenChange={(o) => setSettingsAt(o ? "header" : null)}
            label={SETTINGS_TITLE}
            align="end"
            className={SETTINGS_POPOVER}
            trigger={
              <IconButton label="Einstellungen der KI" size="icon-sm">
                <SlidersHorizontal />
              </IconButton>
            }
          >
            {settingsPanel}
          </Popover>
          <IconButton
            label={running ? "Schließen geht erst, wenn die KI fertig ist" : "KI-Gestalter schließen"}
            size="icon-sm"
            onClick={onClose}
            disabled={running}
          >
            <X />
          </IconButton>
        </div>
      </div>

      {/* conversation */}
      <div ref={scrollRef} className="max-h-80 min-h-0 overflow-y-auto px-4 py-3">
        {turns.length === 0 ? (
          <EmptyState
            compact
            plain
            icon={<Sparkles />}
            title={EMPTY_TITLE[use]}
            action={
              <div className="flex flex-wrap justify-center gap-1.5">
                {EXAMPLES[use].map((ex) => (
                  <Button key={ex.label} size="xs" variant="outline" onClick={() => pickExample(ex)}>
                    {ex.wantsFile ? <Paperclip aria-hidden /> : <Sparkles aria-hidden />} {ex.label}
                  </Button>
                ))}
              </div>
            }
          />
        ) : (
          <ol className="flex flex-col gap-3" aria-label="Gespräch mit der KI" aria-live="polite" aria-relevant="additions">
            {turns.map((turn, i) => (
              <TurnView key={turn.id} turn={turn} fields={fields} ref={i === turns.length - 1 ? lastTurnRef : undefined} />
            ))}
          </ol>
        )}
      </div>

      {/* progress */}
      {running && (
        <div className="flex flex-col gap-1.5 border-t border-border px-4 py-2.5">
          <div className="flex items-center gap-2 text-xs">
            <Spinner size="xs" />
            <span className="min-w-0 flex-1 truncate" role="status">
              {session.progress ?? "Die KI legt los …"}
            </span>
            <span className="shrink-0 tabular-nums text-muted-foreground" aria-hidden>
              {elapsedLabel(elapsed)}
            </span>
            <Button size="xs" variant="outline" onClick={session.abort}>
              Abbrechen
            </Button>
          </div>
          <ProgressBar label="Die KI gestaltet" />
        </div>
      )}

      {/* composer */}
      <div className="flex flex-col gap-2 border-t border-border p-3">
        {session.notice && (
          <Callout tone="destructive" compact>
            {session.notice}
          </Callout>
        )}
        <Textarea
          ref={textareaRef}
          rows={3}
          value={session.draft}
          maxLength={DESIGNER_INSTRUCTION_CHARS}
          onChange={(e) => session.setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          placeholder={answered ? PLACEHOLDER_LATER : PLACEHOLDER[use]}
          aria-label="Anweisung an die KI"
          className="resize-y"
        />
        {attachments.length > 0 && (
          <div className="flex flex-col gap-1">
            <ul className="flex flex-wrap gap-1.5" aria-label="Anhänge">
              {attachments.map((a) => (
                <AttachmentChip key={a.id} entry={a} onRemove={() => session.removeAttachment(a.id)} />
              ))}
            </ul>
            <p className={cn("text-2xs", attachedBytes > DESIGNER_ATTACHMENT_BUDGET_BYTES ? "text-destructive" : "text-muted-foreground")}>
              Anhänge zusammen {formatFileSize(attachedBytes)} von etwa {formatFileSize(DESIGNER_ATTACHMENT_BUDGET_BYTES)} · gehen mit
              jeder Anweisung mit
            </p>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            multiple
            accept={DESIGNER_ATTACHMENT_ACCEPT}
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              // Reset so picking the same file again fires a change.
              e.target.value = "";
              if (files.length > 0) session.addFiles(files, "pick");
            }}
          />
          <Tooltip content={`Höchstens ${L.maxCount} Anhänge — erst einen entfernen.`} disabled={!full}>
            <Button variant="outline" size="sm" onClick={pickFiles} disabled={full}>
              <Paperclip aria-hidden /> Datei anhängen
            </Button>
          </Tooltip>
          <InfoTip label="Was Anhänge bewirken" panelClassName="max-w-sm">
            <p>
              Screenshots, PDFs und HTML-Dateien (auch gespeicherte Mails als .eml) sind ein Vorbild: Die KI baut Aufbau und Stil
              nach — mit unseren Produkten, Links und der Pflicht-Fußzeile.
            </p>
            <p>{OUTLOOK_MAIL_ADVICE}</p>
            <p>Fotos sind Material: Sag z. B. „nimm das Foto als Banner“, dann steht es in der Mail.</p>
            <p>
              Bis zu {L.maxCount} Dateien — Bilder, PDF bis {formatFileSize(L.maxPdfBytes)}, HTML und Text bis{" "}
              {formatFileSize(L.maxTextBytes)}, zusammen etwa {formatFileSize(DESIGNER_ATTACHMENT_BUDGET_BYTES)}; große Bilder werden vorher
              verkleinert. Anhänge gelten für das ganze Gespräch, bis du sie entfernst. Hierher ziehen oder ein Bild ins Textfeld
              einfügen geht auch.
            </p>
          </InfoTip>
          {/* the send group — the active choice (opens the same settings as the header), the shortcut, „Gestalten“; it wraps as one */}
          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
            <Popover
              open={settingsAt === "footer"}
              onOpenChange={(o) => setSettingsAt(o ? "footer" : null)}
              label={SETTINGS_TITLE}
              side="top"
              align="end"
              className={SETTINGS_POPOVER}
              trigger={
                <Button
                  variant="ghost"
                  size="xs"
                  className="text-muted-foreground"
                  aria-label={`Einstellungen der KI: ${choiceShort}`}
                >
                  <SlidersHorizontal aria-hidden /> {choiceShort}
                </Button>
              }
            >
              {settingsPanel}
            </Popover>
            <span className="hidden items-center gap-1 text-2xs text-muted-foreground sm:inline-flex" aria-hidden>
              <Kbd>{mod}</Kbd>+<Kbd>Enter</Kbd>
            </span>
            <Button size="sm" onClick={send} disabled={!session.canSend} loading={running}>
              {!running && <Sparkles aria-hidden />} {answered ? "Ändern" : "Gestalten"}
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}

function TurnView({
  turn,
  fields,
  ref,
}: {
  turn: DesignerTurn;
  fields: DesignerPanelProps["fields"];
  /** the newest turn's item — DesignerPanel scrolls to it */
  ref?: React.Ref<HTMLLIElement>;
}) {
  if (turn.role === "user") {
    return (
      <li ref={ref} className="ml-auto flex max-w-[88%] flex-col items-end gap-1">
        <span className="text-2xs font-semibold text-muted-foreground">Du</span>
        <div className="min-w-0 rounded-lg bg-accent-soft px-3 py-2 text-sm text-foreground">
          {turn.text ? (
            <p className="whitespace-pre-wrap break-words leading-relaxed">{turn.text}</p>
          ) : (
            <p className="italic text-muted-foreground">Nur Anhänge</p>
          )}
          {turn.attachments.length > 0 && (
            <p className="mt-1 flex items-start gap-1 text-2xs text-muted-foreground">
              <Paperclip className="mt-0.5 size-3 shrink-0" aria-hidden />
              <span className="break-words">{turn.attachments.join(", ")}</span>
            </p>
          )}
        </div>
      </li>
    );
  }
  if (turn.role === "assistant") {
    // The notes are model output: plain text with its line breaks — never Markdown, so never a link.
    const notes = designerNotesText(turn.text).trim();
    return (
      <li ref={ref} className="mr-auto flex max-w-[94%] flex-col gap-1">
        <span className="flex items-center gap-1 text-2xs font-semibold text-accent">
          <Sparkles className="size-3" aria-hidden /> KI-Gestalter
          {turn.undone && <span className="font-normal text-muted-foreground">· rückgängig gemacht</span>}
        </span>
        <div className="flex min-w-0 flex-col gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2">
          {notes ? (
            <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">{notes}</p>
          ) : (
            <p className="text-sm">Fertig — die Mail ist aktualisiert.</p>
          )}
          {turn.warnings.length > 0 && (
            <ul className="flex flex-col gap-1">
              {turn.warnings.map((w, i) => (
                <li key={i} className="flex items-start gap-1.5 text-xs">
                  <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden />
                  <span>{w}</span>
                </li>
              ))}
            </ul>
          )}
          {fields && turn.subject && (
            <Suggestion label="Betreff" value={turn.subject} current={fields.subject} onApply={fields.onSubject} disabled={fields.disabled} />
          )}
          {fields && turn.preheader && (
            <Suggestion
              label="Vorschauzeile"
              value={turn.preheader}
              current={fields.preheader}
              onApply={fields.onPreheader}
              disabled={fields.disabled}
            />
          )}
        </div>
        {turn.run && <RunLine run={turn.run} />}
      </li>
    );
  }
  if (turn.role === "error") {
    return (
      <li ref={ref} className="flex flex-col gap-1">
        <Callout tone="destructive" compact>
          {turn.text}
        </Callout>
        {turn.run && <RunLine run={turn.run} />}
      </li>
    );
  }
  return (
    <li ref={ref} className="text-center text-2xs text-muted-foreground">
      {turn.text}
    </li>
  );
}

/** What a run used, how long it took and what it cost — „Gründlich · Claude Opus 5.5 · Denktiefe Hoch · 1:42 min · ≈ 0,38 €“. */
function RunLine({ run }: { run: DesignerRun }) {
  return <p className="text-2xs tabular-nums text-muted-foreground">{designerRunLine(run)}</p>;
}

/** A label with its explanation (one paragraph per entry) for a control of the settings popover. */
function ChoiceLabel({ title, info }: { title: string; info: readonly string[] }) {
  return (
    <div className="flex items-center gap-1.5 text-xs font-medium">
      {title}
      <InfoTip label={`Was „${title}“ bedeutet`} panelClassName="max-w-sm">
        {info.map((p) => (
          <p key={p}>{p}</p>
        ))}
      </InfoTip>
    </div>
  );
}

/**
 * „Einstellungen für diese Unterhaltung“: Qualität (a level is a model and an
 * effort — a stored default that is an own combination shows as no level,
 * with „Standard: …“ and „Standard verwenden“), Gestaltungsfreiheit,
 * „Mo-Funktionen von sich aus einbauen“ and the link to the team's defaults
 * and house style. Every change applies to the next instruction; while the
 * AI works the controls are locked.
 */
function DesignerChoiceFields({ session, designerSettings }: { session: DesignerSession; designerSettings: DesignerSettings }) {
  const { choice, setChoice, running } = session;
  const quality = designerQualityOf(choice);
  const ownDefault = designerQualityOf(designerSettings) === null;
  return (
    <div className="flex flex-col gap-3">
      {/* takes the focus when the popover opens (the levels are a radio group — Tab reaches the chosen one) */}
      <p tabIndex={-1} data-autofocus className="text-sm font-semibold outline-none">
        {SETTINGS_TITLE}
      </p>
      {running && (
        <Callout tone="info" compact>
          Die KI gestaltet gerade — die Einstellungen lassen sich ändern, sobald sie fertig ist.
        </Callout>
      )}
      <div className="flex flex-col gap-1.5">
        <ChoiceLabel title="Qualität" info={DESIGNER_TEXTS.quality} />
        <SegmentedControl
          label="Qualität"
          value={quality ?? ""}
          onChange={(q) => setChoice(designerChoiceWithQuality(choice, q))}
          options={QUALITY_OPTIONS}
          fullWidth
          disabled={running}
        />
        {ownDefault && (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-2xs text-muted-foreground">
            <span>Standard: {designerSettingsLabel(designerSettings)}</span>
            {!sameDesignerQuality(choice, designerSettings) && (
              <Button
                size="xs"
                variant="outline"
                disabled={running}
                onClick={() => setChoice({ ...choice, model: designerSettings.model, effort: designerSettings.effort })}
              >
                Standard verwenden
              </Button>
            )}
          </div>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <ChoiceLabel title="Gestaltungsfreiheit" info={DESIGNER_TEXTS.freedom} />
        <SegmentedControl
          label="Gestaltungsfreiheit"
          value={choice.freedom}
          onChange={(freedom) => setChoice({ ...choice, freedom })}
          options={FREEDOM_OPTIONS}
          fullWidth
          disabled={running}
          className="flex-wrap"
        />
      </div>
      <div className="flex items-center gap-1.5">
        <label className="flex cursor-pointer items-center gap-2 text-xs font-medium">
          <Checkbox
            checked={choice.proactive}
            disabled={running}
            onChange={(e) => setChoice({ ...choice, proactive: e.target.checked })}
          />
          Mo-Funktionen von sich aus einbauen
        </label>
        <InfoTip label="Was „Mo-Funktionen von sich aus einbauen“ bedeutet" panelClassName="max-w-sm">
          {DESIGNER_TEXTS.proactive.map((p) => (
            <p key={p}>{p}</p>
          ))}
        </InfoTip>
      </div>
      <Link
        href={DESIGNER_SETTINGS_HREF}
        target="_blank"
        rel="noopener noreferrer"
        prefetch={false}
        className="inline-flex items-center gap-1 self-start rounded-sm text-xs font-semibold text-accent underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        Standard und Hausstil ändern <ExternalLink className="size-3.5 shrink-0" aria-hidden />
        <span className="sr-only"> (öffnet in einem neuen Tab)</span>
      </Link>
    </div>
  );
}

function Suggestion({
  label,
  value,
  current,
  onApply,
  disabled,
}: {
  label: string;
  value: string;
  current: string;
  onApply: (value: string) => void;
  disabled?: boolean;
}) {
  const applied = current.trim() === value.trim();
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1.5">
      <p className="min-w-0 flex-1 text-xs">
        <span className="text-muted-foreground">{label}-Vorschlag: </span>
        <span className="break-words font-medium">„{value}“</span>
      </p>
      <Button
        size="xs"
        variant={applied ? "ghost" : "outline"}
        disabled={disabled || applied}
        onClick={() => onApply(value)}
        aria-label={applied ? `${label} übernommen` : `${label} übernehmen`}
      >
        {applied ? (
          <>
            <Check aria-hidden /> Übernommen
          </>
        ) : (
          "Übernehmen"
        )}
      </Button>
    </div>
  );
}

function AttachmentChip({ entry, onRemove }: { entry: DesignerAttachmentEntry; onRemove: () => void }) {
  const p = entry.prepared;
  const Icon = p?.mediaType === "text/html" ? FileCode2 : p?.mediaType === "message/rfc822" ? Mail : FileText;
  return (
    <li className="flex max-w-full items-center gap-2 rounded-md border border-border bg-surface-2 py-1 pl-1 pr-0.5 text-xs">
      {!p ? (
        <span className="flex size-8 shrink-0 items-center justify-center rounded border border-border bg-card">
          <Spinner size="xs" />
        </span>
      ) : p.thumbUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={p.thumbUrl}
          alt=""
          className={cn(
            "size-8 shrink-0 rounded border border-border bg-card",
            // a wide picture (logo, banner) whole; a tall screenshot from its top
            (p.width ?? 0) > (p.height ?? 0) ? "object-contain" : "object-cover object-top"
          )}
        />
      ) : (
        <span className="flex size-8 shrink-0 items-center justify-center rounded border border-border bg-card text-muted-foreground">
          <Icon className="size-4" aria-hidden />
        </span>
      )}
      <span className="flex min-w-0 flex-col leading-tight">
        <span className="max-w-[12rem] truncate font-medium">{entry.name}</span>
        <span className="text-2xs text-muted-foreground">
          {p ? `${attachmentKindLabel(p.mediaType)} · ${formatFileSize(p.size)}` : "wird vorbereitet …"}
        </span>
      </span>
      <IconButton label={`„${entry.name}“ entfernen`} size="icon-sm" onClick={onRemove}>
        <X />
      </IconButton>
    </li>
  );
}

/**
 * „Mit KI gestalten“ — opens and closes the KI-Gestalter. Disabled with the
 * reason in a Tooltip without ANTHROPIC_API_KEY, and while a request runs
 * (the panel stays open until the result or „Abbrechen“).
 */
export function DesignerToggle({
  open,
  onToggle,
  aiConfigured,
  running,
}: {
  open: boolean;
  onToggle: () => void;
  aiConfigured: boolean;
  running: boolean;
}) {
  const reason = !aiConfigured
    ? "„Mit KI gestalten“ braucht ANTHROPIC_API_KEY."
    : running && open
      ? "Die KI gestaltet gerade — erst das Ergebnis abwarten oder abbrechen."
      : null;
  return (
    <Tooltip content={reason ?? ""} disabled={!reason}>
      <Button variant={open ? "secondary" : "outline"} size="sm" aria-pressed={open} onClick={onToggle} disabled={Boolean(reason)}>
        {running ? <Spinner size="xs" /> : <Sparkles aria-hidden />} Mit KI gestalten
      </Button>
    </Tooltip>
  );
}
