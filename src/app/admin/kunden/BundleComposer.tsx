"use client";

// Set-Angebot (bundle) composer + per-customer bundle list. Workflow: suggest
// (AI) → edit composition (remove / add via catalog search) → set price / title
// / expiry → create. A created, active bundle is attached to the open email
// draft and rendered as a special-offer block at send time.

import * as React from "react";
import { ExternalLink, Gift, Sparkles, Trash2, X } from "lucide-react";
import type { CustomerDetailBundle } from "@/lib/customer-detail";
import { ADMIN_DATE, formatAdmin } from "@/lib/admin-datetime.mjs";
import { money, num, plural } from "@/lib/admin-format.mjs";
import {
  Button,
  Callout,
  CatalogProductPicker,
  Disclosure,
  Field,
  IconButton,
  InfoTip,
  Input,
  StatusBadge,
  toast,
  useConfirm,
  type CatalogSearchHit,
  type CatalogVariantHit,
  type StatusTone,
} from "../ui";
import { AdminApiError, adminFetch, errorMessage } from "../lib/admin-fetch";
import { useCustomerActions } from "./CustomerDetail";

const DEFAULT_BUNDLE_TITLE = "Dein persönliches Set";
const DEFAULT_EXPIRY_DAYS = 7;
const BUNDLE_MIN = 2;
const BUNDLE_MAX = 5;

interface ComposerComponent {
  productId: string;
  /** Numeric Shopify variant id when the operator pinned a variant; null =
   *  default variant (also what the AI suggest path produces). */
  variantId?: string | null;
  title: string;
  imageUrl: string | null;
  unitPrice: number;
  currency: string;
  inStock: boolean;
  rationale?: string;
}

/** Composite key — the same product may appear once per pinned variant. */
function componentKey(c: { productId: string; variantId?: string | null }): string {
  return c.variantId ? `${c.productId}~${c.variantId}` : c.productId;
}

interface SuggestResponse {
  title?: string;
  components?: ComposerComponent[];
}

interface CreateResponse {
  ok?: boolean;
  redirectUrl?: string | null;
  offer?: {
    id: number;
    title: string | null;
    status: CustomerDetailBundle["status"];
    components?: Array<{ productId: string; title: string; quantity: number }>;
    componentsSum: string;
    bundlePrice: string;
    currency: string;
    cartUrl: string | null;
    createdAt: string | null;
    expiresAt: string | null;
    error: string | null;
  };
}

function bundleStatus(b: CustomerDetailBundle): { label: string; tone: StatusTone } {
  if (b.status === "failed") return { label: "Fehlgeschlagen", tone: "destructive" };
  if (b.status === "expired") return { label: "Abgelaufen", tone: "neutral" };
  if (b.status === "pending") return { label: "Wird erstellt…", tone: "warning" };
  if (b.emailSentAt) return { label: "Versendet", tone: "success" };
  return { label: "Aktiv", tone: "info" };
}

export function BundleComposer({
  customerId,
  customerEmail,
  sendId,
  initialBundles,
}: {
  customerId: number;
  customerEmail: string;
  /** The open (un-sent) draft id, so a created bundle attaches to it. */
  sendId: number | null;
  initialBundles: CustomerDetailBundle[];
}) {
  const { refresh } = useCustomerActions();
  const { confirm, confirmDialog } = useConfirm();
  const [components, setComponents] = React.useState<ComposerComponent[]>([]);
  const [title, setTitle] = React.useState(DEFAULT_BUNDLE_TITLE);
  const [price, setPrice] = React.useState<string>("");
  const [priceEdited, setPriceEdited] = React.useState(false);
  const [expiryDays, setExpiryDays] = React.useState<number>(DEFAULT_EXPIRY_DAYS);
  const [busy, setBusy] = React.useState<null | "suggest" | "create">(null);
  const [bundles, setBundles] = React.useState<CustomerDetailBundle[]>(initialBundles);

  const componentSum = components.reduce((s, c) => s + c.unitPrice, 0);
  const priceNum = Number(price.replace(",", "."));
  const priceValid = Number.isFinite(priceNum) && priceNum > 0;
  const aboveSum = priceValid && priceNum > componentSum + 0.0001;
  const countOk = components.length >= BUNDLE_MIN && components.length <= BUNDLE_MAX;

  const fail = (e: unknown, fallback: string) =>
    toast({ variant: "error", title: "Fehler", description: errorMessage(e, fallback) });

  // Keep the price defaulted to the live component sum until the admin edits it.
  function applyComponents(next: ComposerComponent[]) {
    setComponents(next);
    if (!priceEdited) {
      const sum = next.reduce((s, c) => s + c.unitPrice, 0);
      setPrice(next.length ? sum.toFixed(2) : "");
    }
  }

  async function onSuggest() {
    setBusy("suggest");
    try {
      const json = await adminFetch<SuggestResponse>("/api/admin/bundles/suggest", {
        body: { customerId },
      });
      const next: ComposerComponent[] = (json.components ?? []).map((c) => ({
        productId: c.productId,
        title: c.title,
        imageUrl: c.imageUrl,
        unitPrice: c.unitPrice,
        currency: c.currency,
        inStock: c.inStock,
        rationale: c.rationale,
      }));
      applyComponents(next);
      if (json.title && (!title || title === DEFAULT_BUNDLE_TITLE)) setTitle(json.title);
      toast({
        variant: "success",
        title: "KI-Vorschlag erstellt",
        description: `${plural(next.length, "Produkt", "Produkte")} — du kannst frei anpassen.`,
      });
    } catch (e) {
      fail(e, "Vorschlag fehlgeschlagen.");
    } finally {
      setBusy(null);
    }
  }

  function addProduct(hit: CatalogSearchHit, variant: CatalogVariantHit | null) {
    const next: ComposerComponent = {
      productId: hit.productId,
      variantId: variant?.variantId ?? null,
      title: variant?.title ? `${hit.title} – ${variant.title}` : hit.title,
      imageUrl: hit.imageUrl,
      unitPrice: variant?.unitPrice ?? hit.unitPrice,
      currency: variant?.currency ?? hit.currency,
      inStock: variant ? variant.available : hit.inStock,
    };
    if (components.some((c) => componentKey(c) === componentKey(next))) return;
    applyComponents([...components, next]);
  }

  function removeProduct(key: string) {
    applyComponents(components.filter((c) => componentKey(c) !== key));
  }

  async function onCreate() {
    if (!countOk) {
      toast({
        variant: "warning",
        title: "Ungültige Auswahl",
        description: `Ein Set braucht ${BUNDLE_MIN}–${BUNDLE_MAX} Produkte.`,
      });
      return;
    }
    if (!priceValid) {
      toast({
        variant: "warning",
        title: "Preis fehlt",
        description: "Bitte einen Set-Preis größer als 0 € angeben.",
      });
      return;
    }
    setBusy("create");
    try {
      const json = await adminFetch<CreateResponse>("/api/admin/bundles/create", {
        body: {
          customerId,
          components: components.map((c) => ({
            productId: c.productId,
            ...(c.variantId ? { variantId: c.variantId } : {}),
          })),
          bundlePriceOverride: priceNum,
          title: title.trim() || DEFAULT_BUNDLE_TITLE,
          expiryDays,
          ...(sendId != null ? { marketingSendId: sendId } : {}),
        },
      });
      const offer = json.offer;
      if (!json.ok || !offer) {
        toast({
          variant: "error",
          title: "Fehler",
          description: "Set erstellt, aber die Antwort enthielt keine Angebotsdaten.",
        });
        return;
      }
      const created: CustomerDetailBundle = {
        id: offer.id,
        title: offer.title,
        status: offer.status,
        components: (offer.components ?? []).map((c) => ({
          productId: c.productId,
          title: c.title,
          quantity: c.quantity,
        })),
        componentsSum: offer.componentsSum,
        bundlePrice: offer.bundlePrice,
        currency: offer.currency,
        cartUrl: offer.cartUrl,
        redirectUrl: json.redirectUrl ?? null,
        createdAt: offer.createdAt,
        expiresAt: offer.expiresAt,
        error: offer.error,
        emailSentAt: null,
        clicked: false,
      };
      setBundles([created, ...bundles]);
      setComponents([]);
      setTitle(DEFAULT_BUNDLE_TITLE);
      setPrice("");
      setPriceEdited(false);
      toast({
        variant: "success",
        title: "Set erstellt",
        description:
          sendId != null
            ? "An die E-Mail angehängt. Tipp: E-Mail neu generieren, damit der Text das Set erwähnt."
            : "Es wird an die nächste generierte E-Mail angehängt.",
      });
      refresh();
    } catch (e) {
      // Sold-out components come back as a 4xx with the offending titles.
      if (e instanceof AdminApiError && e.code === "sold_out") {
        const offenders = (e.details as { offenders?: string[] } | null)?.offenders ?? [];
        toast({
          variant: "error",
          title: "Ausverkauft",
          description: offenders.length
            ? `${e.message} Ausverkauft: ${offenders.join(", ")}. Bitte entfernen und erneut versuchen.`
            : e.message,
        });
        return;
      }
      fail(e, "Set-Erstellung fehlgeschlagen.");
    } finally {
      setBusy(null);
    }
  }

  async function onArchive(id: number) {
    const ok = await confirm({
      title: "Set archivieren?",
      description: "Der Angebots-Link wird ungültig.",
      confirmLabel: "Archivieren",
      tone: "destructive",
    });
    if (!ok) return;
    try {
      await adminFetch("/api/admin/bundles/archive", { body: { id } });
      setBundles((prev) => prev.map((b) => (b.id === id ? { ...b, status: "expired" as const } : b)));
      toast({ variant: "success", title: "Set archiviert" });
      refresh();
    } catch (e) {
      fail(e, "Archivieren fehlgeschlagen.");
    }
  }

  // DELETE a never-published bundle (pending / failed). Active/expired offers
  // use Archive instead (server-enforced; the button only appears for deletable rows).
  async function onDelete(id: number) {
    const ok = await confirm({
      title: "Set löschen?",
      description: "Es kann nicht wiederhergestellt werden.",
      confirmLabel: "Löschen",
      tone: "destructive",
    });
    if (!ok) return;
    try {
      await adminFetch("/api/admin/bundles/delete", { body: { id } });
      setBundles((prev) => prev.filter((b) => b.id !== id));
      toast({ variant: "success", title: "Set gelöscht" });
      refresh();
    } catch (e) {
      fail(e, "Löschen fehlgeschlagen.");
    }
  }

  return (
    <Disclosure
      title={
        <span className="inline-flex items-center gap-1.5">
          <Gift className="size-4 text-muted-foreground" aria-hidden /> Set-Angebot (Bundle)
        </span>
      }
      meta={bundles.length > 0 ? `${num(bundles.length)} vorhanden` : undefined}
      defaultOpen={bundles.length > 0}
    >
      {confirmDialog}
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" onClick={onSuggest} loading={busy === "suggest"} disabled={busy !== null}>
            <Sparkles /> Set vorschlagen
          </Button>
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            {BUNDLE_MIN}–{BUNDLE_MAX} Produkte zu einem Preis
            <InfoTip>
              Ein Set bündelt {BUNDLE_MIN}–{BUNDLE_MAX} Produkte zu einem Preis mit eigenem, getracktem
              Angebots-Link. „Set vorschlagen“ ist ein KI-Durchlauf über Profil, Gespräche und Käufe
              (kostet Tokens); die Zusammenstellung lässt sich danach frei ändern.
            </InfoTip>
          </span>
        </div>

        {components.length > 0 && (
          <div className="flex flex-col gap-1.5">
            {components.map((c) => (
              <div
                key={componentKey(c)}
                className="flex items-center gap-2.5 rounded-md bg-surface-2 px-2.5 py-1.5"
              >
                {c.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={c.imageUrl}
                    alt=""
                    width={36}
                    height={36}
                    className="size-9 rounded-md object-cover"
                  />
                ) : (
                  <div className="size-9 rounded-md bg-muted" aria-hidden />
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{c.title}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {money(c.unitPrice, c.currency)}
                    {c.rationale ? ` · ${c.rationale}` : ""}
                  </div>
                </div>
                <IconButton
                  label={`${c.title} aus dem Set entfernen`}
                  size="icon-sm"
                  onClick={() => removeProduct(componentKey(c))}
                >
                  <X />
                </IconButton>
              </div>
            ))}
            <div className="text-right text-xs text-muted-foreground">
              Komponentensumme: <strong className="text-foreground">{money(componentSum)}</strong>
            </div>
          </div>
        )}

        <CatalogProductPicker
          placeholder="Produkt hinzufügen (Name suchen)…"
          onSelect={addProduct}
          isSelected={(hit, variant) =>
            components.some(
              (c) =>
                componentKey(c) ===
                componentKey({ productId: hit.productId, variantId: variant?.variantId ?? null })
            )
          }
          disableReason={(hit, variant) =>
            (variant ? !variant.available : !hit.inStock) ? "Ausverkauft — nicht hinzufügbar" : null
          }
          onError={(e) =>
            toast({ variant: "error", title: "Suche fehlgeschlagen", description: e.message })
          }
        />

        {components.length > 0 && (
          <>
            <div className="flex flex-wrap items-end gap-3">
              <Field label="Set-Preis (€)">
                <Input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step={0.01}
                  value={price}
                  aria-invalid={!priceValid}
                  onChange={(e) => {
                    setPrice(e.target.value);
                    setPriceEdited(true);
                  }}
                  className="w-28"
                />
              </Field>
              <Field label="Titel" className="min-w-[12rem] flex-1">
                <Input value={title} onChange={(e) => setTitle(e.target.value)} />
              </Field>
              <Field label="Gültig (Tage)">
                <Input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  step={1}
                  value={expiryDays}
                  onChange={(e) =>
                    setExpiryDays(Math.max(1, Math.floor(e.target.valueAsNumber || DEFAULT_EXPIRY_DAYS)))
                  }
                  className="w-24"
                />
              </Field>
              <Button onClick={onCreate} loading={busy === "create"} disabled={busy !== null || !countOk || !priceValid}>
                Set erstellen
              </Button>
            </div>
            {aboveSum && (
              <Callout tone="warning" compact>
                Preis über der Komponentensumme ({money(componentSum)}) — es wird keine „statt“-Zeile
                angezeigt, das Set ist nicht günstiger als die Einzelprodukte.
              </Callout>
            )}
          </>
        )}

        {bundles.length > 0 && (
          <div className="border-t border-border pt-3">
            <div className="mb-2 text-xs font-medium text-muted-foreground">
              Sets für {customerEmail} ({num(bundles.length)})
            </div>
            <div className="flex flex-col gap-2">
              {bundles.map((b) => {
                const status = bundleStatus(b);
                return (
                  <div key={b.id} className="rounded-md bg-surface-2 px-3 py-2 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <strong>{b.title ?? "Set"}</strong>
                      <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                      {b.clicked && (
                        <StatusBadge tone="accent" icon={<ExternalLink />}>
                          Klick erfasst
                        </StatusBadge>
                      )}
                      <span className="text-muted-foreground">
                        {money(b.bundlePrice, b.currency)}
                        {Number(b.bundlePrice) < Number(b.componentsSum)
                          ? ` (statt ${money(b.componentsSum, b.currency)})`
                          : ""}
                      </span>
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {b.components.map((c) => c.title).join(" + ")}
                    </div>
                    <div className="mt-0.5 text-2xs text-muted-foreground">
                      Erstellt {formatAdmin(b.createdAt, ADMIN_DATE)}
                      {b.expiresAt ? ` · läuft ab ${formatAdmin(b.expiresAt, ADMIN_DATE)}` : ""}
                    </div>
                    {b.status === "failed" && b.error && (
                      <div className="mt-1 text-xs text-destructive">{b.error}</div>
                    )}
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      {(b.status === "pending" || b.status === "failed") && (
                        <Button
                          variant="ghost"
                          size="xs"
                          className="text-destructive hover:text-destructive"
                          onClick={() => onDelete(b.id)}
                        >
                          <Trash2 /> Löschen
                        </Button>
                      )}
                      {b.status === "active" && b.redirectUrl && (
                        <a
                          href={b.redirectUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
                        >
                          <ExternalLink className="size-3.5" aria-hidden /> Angebots-Link
                        </a>
                      )}
                      {b.status === "active" && (
                        <Button variant="outline" size="xs" onClick={() => onArchive(b.id)}>
                          Archivieren
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </Disclosure>
  );
}
