"use client";

// „Testkontakte…“ — the operator's own inboxes as campaign contacts that stay
// in the queue after every send (docs/CAMPAIGNS.md §5, migration 0057). The
// sheet lists the existing test contacts with their state and offers a small
// form: e-mail, first name, language and, optionally, a real customer's
// e-mail whose purchase history the draft borrows so the mail is realistic.
// Creating drafts the contact right away with the desk's Vorbereiten
// settings; the card then sits in the queue like any other.

import * as React from "react";
import { FlaskConical, Plus, Trash2 } from "lucide-react";
import { Button, Callout, EmptyState, InfoTip, Input, Label, SegmentedControl, Sheet, Spinner, StatusBadge, toast } from "../ui";
import { adminFetch, errorMessage } from "../lib/admin-fetch";
import { contactName, type CampaignTestContactProps } from "./types";
import type { PrepareSettings } from "./useCampaignActions";

const STATUS_LABEL: Record<string, { label: string; tone: "neutral" | "success" | "warning" | "info" }> = {
  pending: { label: "Ohne Entwurf", tone: "warning" },
  drafted: { label: "In der Warteschlange", tone: "success" },
  sending: { label: "Wird gesendet", tone: "info" },
  skipped: { label: "Übersprungen", tone: "neutral" },
  draft_failed: { label: "Entwurf fehlgeschlagen", tone: "warning" },
  suppressed: { label: "Unterdrückt (abgemeldet)", tone: "warning" },
  sent: { label: "Gesendet", tone: "neutral" },
};

export function TestContactsSheet({
  open,
  onOpenChange,
  queueIds,
  prepareSettings,
  restoring,
  onOpenContact,
  onDraft,
  onUnskip,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Ids currently in the working queue (for „Öffnen“). */
  queueIds: number[];
  prepareSettings: PrepareSettings;
  restoring: Set<number>;
  onOpenContact: (contactId: number) => void;
  onDraft: (contactId: number) => void;
  /** A skipped test contact goes back to the queue via unskip (keeps its draft). */
  onUnskip: (contactId: number) => void;
  /** The server-side queue changed (created / deleted) — refresh the desk. */
  onChanged: () => void;
}) {
  const [contacts, setContacts] = React.useState<CampaignTestContactProps[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [email, setEmail] = React.useState("");
  const [firstName, setFirstName] = React.useState("");
  const [language, setLanguage] = React.useState<"de" | "en">("de");
  const [sourceEmail, setSourceEmail] = React.useState("");
  const [creating, setCreating] = React.useState(false);
  const [deleting, setDeleting] = React.useState<number | null>(null);

  const load = React.useCallback(async () => {
    try {
      const json = await adminFetch<{ contacts: CampaignTestContactProps[] }>(
        "/api/admin/campaign/test-contacts"
      );
      setContacts(json.contacts);
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  React.useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (creating) return;
    setCreating(true);
    const pending = toast({ title: "Testkontakt wird angelegt — Entwurf wird generiert…", duration: 0 });
    try {
      const json = await adminFetch<{ contact: CampaignTestContactProps; drafted: boolean }>(
        "/api/admin/campaign/test-contacts",
        {
          body: {
            action: "create",
            email,
            firstName,
            language,
            sourceEmail,
            discountPercent: prepareSettings.depth,
            textMode: prepareSettings.textMode,
          },
        }
      );
      toast.dismiss(pending);
      toast({
        variant: json.drafted ? "success" : "warning",
        title: json.drafted ? `Testkontakt ${json.contact.email} ist in der Warteschlange` : "Testkontakt angelegt — Entwurf fehlgeschlagen",
        description: json.drafted ? undefined : "„Entwurf erstellen“ versucht es erneut.",
      });
      setEmail("");
      setFirstName("");
      setSourceEmail("");
      await load();
      onChanged();
    } catch (err) {
      toast.dismiss(pending);
      toast({ variant: "error", title: "Testkontakt konnte nicht angelegt werden", description: errorMessage(err) });
    } finally {
      setCreating(false);
    }
  };

  const remove = async (c: CampaignTestContactProps) => {
    if (deleting !== null) return;
    setDeleting(c.id);
    try {
      await adminFetch("/api/admin/campaign/test-contacts", { body: { action: "delete", contactId: c.id } });
      toast({ variant: "success", title: `Testkontakt ${c.email} entfernt` });
      await load();
      onChanged();
    } catch (err) {
      toast({ variant: "error", title: "Entfernen fehlgeschlagen", description: errorMessage(err) });
    } finally {
      setDeleting(null);
    }
  };

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Testkontakte"
      description="Eigene Postfächer als Kampagnen-Kontakte: jede Sendung geht echt raus (Rabattcode, Set, Abmeldelink), der Kontakt bleibt danach in der Warteschlange und zählt nicht in den KPIs."
      size="md"
    >
      <div className="flex flex-col gap-5 text-sm">
        <form onSubmit={create} className="flex flex-col gap-3 rounded-lg border border-border bg-surface-2 p-3">
          <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <FlaskConical className="size-3.5" aria-hidden /> Neuer Testkontakt
            <InfoTip>
              Der Entwurf wird sofort mit den aktuellen Vorbereiten-Einstellungen erzeugt
              (Rabatt {prepareSettings.depth} %, Textmodus {prepareSettings.textMode}). Mit der
              E-Mail eines echten Kunden übernimmt der Entwurf dessen Kaufhistorie und
              Empfehlungen — die Mail geht trotzdem nur an die Testadresse. Sync und
              „Warteschlange neu aufbauen“ lassen Testkontakte unberührt; Sperrfrist und
              Unterdrückungsliste gelten für sie nicht.
            </InfoTip>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="test-contact-email" className="mb-1 block text-xs text-muted-foreground">
                E-Mail (Testadresse)
              </Label>
              <Input
                id="test-contact-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@firma.de"
                className="h-8 text-xs"
                disabled={creating}
                data-autofocus
              />
            </div>
            <div>
              <Label htmlFor="test-contact-name" className="mb-1 block text-xs text-muted-foreground">
                Vorname (Anrede)
              </Label>
              <Input
                id="test-contact-name"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="optional"
                className="h-8 text-xs"
                disabled={creating}
              />
            </div>
            <div>
              <Label htmlFor="test-contact-source" className="mb-1 block text-xs text-muted-foreground">
                Kaufhistorie von (Kunden-E-Mail)
              </Label>
              <Input
                id="test-contact-source"
                type="email"
                value={sourceEmail}
                onChange={(e) => setSourceEmail(e.target.value)}
                placeholder="optional — für realistische Empfehlungen"
                className="h-8 text-xs"
                disabled={creating}
              />
            </div>
            <div>
              <span className="mb-1 block text-xs text-muted-foreground">Sprache</span>
              <SegmentedControl
                label="Sprache des Testkontakts"
                value={language}
                onChange={setLanguage}
                disabled={creating}
                options={[
                  { value: "de", label: "DE" },
                  { value: "en", label: "EN" },
                ]}
              />
            </div>
          </div>
          <div className="flex justify-end">
            <Button type="submit" size="sm" loading={creating} disabled={!email.trim()}>
              <Plus /> Anlegen und Entwurf erstellen
            </Button>
          </div>
        </form>

        <div>
          <div className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Vorhandene Testkontakte
          </div>
          {error ? (
            <Callout tone="destructive" compact>
              {error}
            </Callout>
          ) : contacts === null ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Spinner size="xs" /> Lädt…
            </div>
          ) : contacts.length === 0 ? (
            <EmptyState plain compact title="Noch keine Testkontakte." />
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {contacts.map((c) => {
                const state = STATUS_LABEL[c.status] ?? { label: c.status, tone: "neutral" as const };
                const inQueue = queueIds.includes(c.id);
                return (
                  <li key={c.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-xs">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">
                        {contactName(c)}
                        {contactName(c) !== c.email && <span className="text-muted-foreground"> · {c.email}</span>}
                      </span>
                      <span className="block truncate text-muted-foreground">
                        {c.language.toUpperCase()}
                        {c.sourceEmail ? ` · Kaufhistorie von ${c.sourceEmail}` : " · ohne Kaufhistorie"}
                      </span>
                    </span>
                    <StatusBadge tone={state.tone}>{state.label}</StatusBadge>
                    {inQueue ? (
                      <Button variant="outline" size="xs" onClick={() => onOpenContact(c.id)}>
                        Öffnen
                      </Button>
                    ) : c.status === "skipped" ? (
                      <Button
                        variant="outline"
                        size="xs"
                        loading={restoring.has(c.id)}
                        onClick={() => onUnskip(c.id)}
                      >
                        Wiederherstellen
                      </Button>
                    ) : c.status === "pending" || c.status === "draft_failed" ? (
                      <Button
                        variant="outline"
                        size="xs"
                        loading={restoring.has(c.id)}
                        onClick={() => onDraft(c.id)}
                      >
                        Entwurf erstellen
                      </Button>
                    ) : null}
                    <Button
                      variant="ghost"
                      size="xs"
                      className="text-muted-foreground hover:text-destructive"
                      loading={deleting === c.id}
                      onClick={() => void remove(c)}
                    >
                      <Trash2 /> Entfernen
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </Sheet>
  );
}
