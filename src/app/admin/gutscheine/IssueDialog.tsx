"use client";

// „Gutschein ausstellen“ — a Geschenkgutschein issued by hand (Kulanz,
// Marketing, Gewinnspiel, Firmengeschenk, Sonstiges): value up to
// GIFT_VOUCHER_ADMIN_MAX_EUR, design, Für / Von / Nachricht, delivery (PDF
// for the admin download, E-Mail sent by Mo, Premium-Karte by post —
// marketing vouchers are PDF only) and an internal note. Checked in the
// browser with the route's own rules (gutscheine-core.mjs validateIssueInput),
// confirmed with value and delivery cost, then POST /api/admin/gutscheine/issue
// — the gift card exists in Shopify at once; the new voucher gets selected.

import * as React from "react";
import { Gift } from "lucide-react";
import { eurFromCents } from "@/lib/admin-format.mjs";
import { GIFT_VOUCHER_TEXT_LIMITS } from "@/lib/gift-voucher-core.mjs";
import {
  Button,
  Callout,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  SegmentedControl,
  Select,
  Textarea,
  useConfirm,
} from "../ui";
import { AdminApiError, adminFetch, errorMessage } from "../lib/admin-fetch";
import { useAsyncAction } from "../lib/use-async-action";
import {
  DEFAULT_ADMIN_SENDER,
  MANUAL_REASON_OPTIONS,
  NOTE_MAX,
  countryName,
  parseEuroInput,
  validateIssueInput,
  type IssueValue,
} from "./gutscheine-core.mjs";
import type { GutscheineEnv } from "./types";

type Delivery = IssueValue["delivery"];
type Reason = IssueValue["reason"];

interface IssueForm {
  amount: string;
  reason: Reason;
  designKey: string;
  recipientName: string;
  senderName: string;
  message: string;
  delivery: Delivery;
  recipientEmail: string;
  name: string;
  line1: string;
  line2: string;
  postalCode: string;
  city: string;
  country: string;
  adminNote: string;
}

const L = GIFT_VOUCHER_TEXT_LIMITS;

function emptyForm(env: GutscheineEnv, designs: Array<{ key: string }>): IssueForm {
  return {
    amount: "",
    reason: "kulanz",
    designKey: designs[0]?.key ?? "classic",
    recipientName: "",
    senderName: DEFAULT_ADMIN_SENDER,
    message: "",
    delivery: "pdf",
    recipientEmail: "",
    name: "",
    line1: "",
    line2: "",
    postalCode: "",
    city: "",
    country: env.printCountries[0] ?? "DE",
    adminNote: "",
  };
}

/** The form → the request body (the same shape the route checks). */
function requestBody(form: IssueForm, amountCents: number | null) {
  return {
    amountCents,
    reason: form.reason,
    designKey: form.designKey,
    recipientName: form.recipientName,
    senderName: form.senderName,
    message: form.message,
    delivery: form.delivery,
    recipientEmail: form.delivery === "email" ? form.recipientEmail : null,
    address:
      form.delivery === "print"
        ? { name: form.name, line1: form.line1, line2: form.line2, postalCode: form.postalCode, city: form.city, country: form.country }
        : null,
    adminNote: form.adminNote,
  };
}

/** The form field of an error key from the checks (address.line1 → line1). */
function formField(field: string | undefined | null): keyof IssueForm | "form" {
  if (!field) return "form";
  if (field === "amountCents") return "amount";
  if (field === "address") return "line1";
  if (field.startsWith("address.")) {
    const f = field.slice("address.".length);
    return f === "name" || f === "line1" || f === "line2" || f === "postalCode" || f === "city" || f === "country" ? f : "line1";
  }
  return (["reason", "designKey", "recipientName", "senderName", "message", "delivery", "recipientEmail", "adminNote"] as const).includes(
    field as "reason"
  )
    ? (field as keyof IssueForm)
    : "form";
}

const chars = (s: string) => Array.from(s).length;

/** „12 / 40“ in the label row (red once over the limit). */
function Counter({ value, max }: { value: string; max: number }) {
  const n = chars(value);
  return (
    <span className={n > max ? "text-2xs tabular-nums text-destructive" : "text-2xs tabular-nums text-muted-foreground"}>
      {n} / {max}
    </span>
  );
}

export function IssueDialog({
  open,
  onOpenChange,
  env,
  designs,
  onIssued,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  env: GutscheineEnv;
  designs: Array<{ key: string; name: string }>;
  onIssued: (id: number) => void;
}) {
  const [form, setForm] = React.useState<IssueForm>(() => emptyForm(env, designs));
  const [errors, setErrors] = React.useState<Partial<Record<keyof IssueForm | "form", string>>>({});
  const { confirm, confirmDialog } = useConfirm();
  React.useEffect(() => {
    if (open) setErrors({});
  }, [open]);

  const set = <K extends keyof IssueForm>(key: K, value: IssueForm[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => (e[key] || e.form ? { ...e, [key]: undefined, form: undefined } : e));
  };

  const submit = useAsyncAction(
    async (body: ReturnType<typeof requestBody>) =>
      adminFetch<{ ok: true; id: number; number: string | null }>("/api/admin/gutscheine/issue", { body }),
    {
      errorToast: false,
      successToast: (r) => (r.number ? `Gutschein ${r.number} ausgestellt` : "Gutschein ausgestellt"),
      onError: (e) => {
        const details = e instanceof AdminApiError ? (e.details as { error?: { field?: string } } | null) : null;
        setErrors({ [formField(details?.error?.field)]: errorMessage(e) });
      },
      onSuccess: (r) => {
        setForm(emptyForm(env, designs));
        onIssued(r.id);
      },
    }
  );

  const marketing = form.reason === "marketing";
  const maxEuro = eurFromCents(env.limits.adminMaxCents);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const amountCents = parseEuroInput(form.amount);
    if (amountCents === null) {
      setErrors({ amount: "Bitte einen Betrag in Euro angeben (z. B. 25 oder 25,50)." });
      return;
    }
    const body = requestBody(form, amountCents);
    const checked = validateIssueInput(body, { adminMaxCents: env.limits.adminMaxCents, printCountries: env.printCountries });
    if (!checked.ok) {
      setErrors({ [formField(checked.field)]: checked.message });
      return;
    }
    const value = checked.value;
    const reasonLabel = MANUAL_REASON_OPTIONS.find((o) => o.value === value.reason)?.label ?? value.reason;
    const delivery =
      value.delivery === "email"
        ? `E-Mail an ${value.recipientEmail}`
        : value.delivery === "print" && value.address
          ? `Premium-Karte an ${value.address.name}, ${value.address.postalCode} ${value.address.city} — Druck und Porto ≈ ${eurFromCents(env.cardCostCents)}`
          : "PDF zum Herunterladen hier im Admin";
    const ok = await confirm({
      title: `Gutschein über ${eurFromCents(value.amountCents)} ausstellen?`,
      description: `${reasonLabel} · ${delivery}. Die Geschenkkarte wird sofort in Shopify angelegt und ist ab dann im Shop einlösbar.`,
      confirmLabel: "Ausstellen",
    });
    if (ok) await submit.run(body);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Gift className="size-5 text-muted-foreground" aria-hidden /> Gutschein ausstellen
          </DialogTitle>
          <DialogDescription>Eine Shopify-Geschenkkarte, sofort einlösbar — von Hand, ohne Bestellung.</DialogDescription>
        </DialogHeader>
        <form className="mt-5 grid gap-4 sm:grid-cols-2" onSubmit={(e) => void onSubmit(e)} noValidate>
          <Field label="Wert (€)" required error={errors.amount} info={`Höchstens ${maxEuro} je Gutschein (GIFT_VOUCHER_ADMIN_MAX_EUR).`}>
            <Input
              value={form.amount}
              inputMode="decimal"
              autoComplete="off"
              placeholder="z. B. 25"
              onChange={(e) => set("amount", e.target.value)}
              data-autofocus=""
            />
          </Field>
          <Field label="Anlass" required error={errors.reason}>
            <Select
              value={form.reason}
              onChange={(e) => {
                const reason = e.target.value as Reason;
                setForm((f) => ({ ...f, reason, delivery: reason === "marketing" ? "pdf" : f.delivery }));
                setErrors({});
              }}
            >
              {MANUAL_REASON_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Für" error={errors.recipientName} labelEnd={<Counter value={form.recipientName} max={L.recipientName} />}>
            <Input
              value={form.recipientName}
              maxLength={L.recipientName}
              onChange={(e) => set("recipientName", e.target.value)}
              placeholder="z. B. Lena"
            />
          </Field>
          <Field label="Von" error={errors.senderName} labelEnd={<Counter value={form.senderName} max={L.senderName} />}>
            <Input value={form.senderName} maxLength={L.senderName} onChange={(e) => set("senderName", e.target.value)} />
          </Field>
          <Field
            label="Nachricht"
            className="sm:col-span-2"
            error={errors.message}
            info={`Steht handschriftlich auf der Innenseite — höchstens ${L.messageLines} Zeilen. Ohne Nachricht druckt Mo einen kurzen Gruß des Motivs. Emoji kann die Schrift nicht drucken.`}
            labelEnd={<Counter value={form.message} max={L.message} />}
          >
            <Textarea
              rows={3}
              value={form.message}
              maxLength={L.message}
              onChange={(e) => set("message", e.target.value)}
              placeholder="z. B. Danke für deine Geduld — viel Spaß beim Training!"
            />
          </Field>
          <Field label="Motiv" required error={errors.designKey}>
            <Select value={form.designKey} onChange={(e) => set("designKey", e.target.value)}>
              {designs.map((d) => (
                <option key={d.key} value={d.key}>
                  {d.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Versand"
            error={errors.delivery}
            info={`PDF: zum Herunterladen hier im Admin. E-Mail: Mo schickt den Gutschein mit PDF an die angegebene Adresse. Premium-Karte: gedruckt und per Post (≈ ${eurFromCents(
              env.cardCostCents
            )} je Karte; nur nach ${env.printCountries.map(countryName).join(", ")}). Marketing-Gutscheine gibt es nur als PDF — Mo verschickt Werbung nicht ohne Einwilligung per E-Mail oder Post.`}
          >
            <SegmentedControl<Delivery>
              label="Versand"
              value={form.delivery}
              onChange={(d) => set("delivery", d)}
              options={[
                { value: "pdf", label: "PDF" },
                { value: "email", label: "E-Mail", disabled: marketing },
                { value: "print", label: "Premium-Karte", disabled: marketing },
              ]}
            />
          </Field>
          {form.delivery === "email" && (
            <Field label="E-Mail-Adresse" required className="sm:col-span-2" error={errors.recipientEmail}>
              <Input
                type="email"
                value={form.recipientEmail}
                autoComplete="off"
                onChange={(e) => set("recipientEmail", e.target.value)}
                placeholder="name@beispiel.de"
              />
            </Field>
          )}
          {form.delivery === "print" && (
            <>
              <Field label="Name" required error={errors.name}>
                <Input value={form.name} maxLength={L.addressName} onChange={(e) => set("name", e.target.value)} autoComplete="off" />
              </Field>
              <Field label="Straße und Hausnummer" required error={errors.line1}>
                <Input value={form.line1} maxLength={L.addressLine} onChange={(e) => set("line1", e.target.value)} autoComplete="off" />
              </Field>
              <Field label="Adresszusatz" error={errors.line2}>
                <Input value={form.line2} maxLength={L.addressLine} onChange={(e) => set("line2", e.target.value)} autoComplete="off" />
              </Field>
              <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3">
                <Field label="PLZ" required error={errors.postalCode}>
                  <Input value={form.postalCode} inputMode="numeric" maxLength={10} onChange={(e) => set("postalCode", e.target.value)} autoComplete="off" />
                </Field>
                <Field label="Ort" required error={errors.city}>
                  <Input value={form.city} maxLength={L.city} onChange={(e) => set("city", e.target.value)} autoComplete="off" />
                </Field>
              </div>
              {env.printCountries.length > 1 && (
                <Field label="Land" error={errors.country}>
                  <Select value={form.country} onChange={(e) => set("country", e.target.value)}>
                    {env.printCountries.map((c) => (
                      <option key={c} value={c}>
                        {countryName(c)}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
            </>
          )}
          <Field label="Interne Notiz" className="sm:col-span-2" error={errors.adminNote} info="Nur hier im Admin sichtbar — z. B. Ticket-Nummer oder Gewinnspiel.">
            <Input value={form.adminNote} maxLength={NOTE_MAX} onChange={(e) => set("adminNote", e.target.value)} autoComplete="off" />
          </Field>
          {errors.form && (
            <Callout tone="destructive" className="sm:col-span-2">
              {errors.form}
            </Callout>
          )}
          <DialogFooter className="mt-1 sm:col-span-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Abbrechen
            </Button>
            <Button type="submit" loading={submit.pending}>
              Gutschein ausstellen…
            </Button>
          </DialogFooter>
        </form>
        {confirmDialog}
      </DialogContent>
    </Dialog>
  );
}
