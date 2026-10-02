"use client";

// One customer's detail: header (identity, Shopify / Mo, the one consent) and
// seven sub-tabs (Überblick · Aktivität · Käufe · Gespräche · Marketing ·
// Korrespondenz · Brief). Panels stay mounted while hidden so an in-progress
// edit survives switching. Without consent for e-mail advertising the person
// is flagged in the header and every advertising action is blocked (the
// server gates enforce it; the UI says why).
// Mutations call `refresh()` from the actions context, which re-loads this
// detail and the list.

import * as React from "react";
import { RotateCcw, Trash2 } from "lucide-react";
import type { CustomerDetail as CustomerDetailData } from "@/lib/customer-detail";
import { ADMIN_DATE, formatAdmin } from "@/lib/admin-datetime.mjs";
import { num } from "@/lib/admin-format.mjs";
import {
  Button,
  Card,
  Spinner,
  StatusBadge,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Tooltip,
  toast,
  useConfirm,
} from "../ui";
import { adminFetch } from "../lib/admin-fetch";
import { useAsyncAction } from "../lib/use-async-action";
import { ConsentBadge, MoBadge, PersonaBadge, ShopBadge, TierBadge } from "./badges";
import { UeberblickTab } from "./tabs/UeberblickTab";
import { AktivitaetTab } from "./tabs/AktivitaetTab";
import { BeratungenTab } from "./tabs/BeratungenTab";
import { KaeufeTab } from "./tabs/KaeufeTab";
import { MarketingTab } from "./tabs/MarketingTab";
import { KorrespondenzTab } from "./tabs/KorrespondenzTab";
import { BriefTab } from "./tabs/BriefTab";

interface CustomerActions {
  /** Re-load this customer's detail and the list (after a mutation). */
  refresh: () => void;
}

const CustomerActionsContext = React.createContext<CustomerActions>({ refresh: () => {} });

export function useCustomerActions(): CustomerActions {
  return React.useContext(CustomerActionsContext);
}

const DETAIL_TABS = ["ueberblick", "aktivitaet", "kaeufe", "beratungen", "marketing", "korrespondenz", "brief"];

export function CustomerDetail({
  customer,
  initialTab,
  onRefresh,
  onErased,
  reloading = false,
}: {
  customer: CustomerDetailData;
  /** ?ctab= deep link (e.g. from an Eingang mail item → korrespondenz). */
  initialTab?: string | null;
  onRefresh: () => void;
  /** Called after the customer was erased — the workspace drops the selection. */
  onErased: () => void;
  reloading?: boolean;
}) {
  const actions = React.useMemo(() => ({ refresh: onRefresh }), [onRefresh]);
  const returning = customer.sessions.length > 1;
  const { confirm, confirmDialog } = useConfirm();
  const erase = useAsyncAction(
    () =>
      adminFetch<{ deletedConversations: number }>("/api/admin/customers/erase", {
        body: { customerId: customer.id, confirm: true },
      }),
    {
      errorToast: "Löschen fehlgeschlagen",
      onSuccess: () => {
        toast({ variant: "success", title: "Kunde vollständig gelöscht", description: customer.email });
        onErased();
      },
    }
  );
  async function onErase() {
    const ok = await confirm({
      title: "Kunde vollständig löschen?",
      description: customer.isShopifyCustomer
        ? customer.shopifyErasureSync
          ? "Löscht alles über diese Person bei Mo: Profil, Gespräche, Einwilligung, Bestellkopien, Kampagnen-Mails, Korrespondenz und Briefe. Zusätzlich wird Shopify gebeten, die Kundendaten dort ebenfalls zu löschen (Shopify erledigt das nach seinen Fristen; Bestellungen bleiben dort aus steuerlichen Gründen erhalten). Die Adresse wird gesperrt und nie wieder angeschrieben oder importiert. Das lässt sich nicht rückgängig machen."
          : "Löscht alles über diese Person bei Mo: Profil, Gespräche, Einwilligung, Bestellkopien, Kampagnen-Mails, Korrespondenz und Briefe. In Shopify wird sie von E-Mail-Werbung abgemeldet; die Löschung des Shop-Kundenkontos wird vorgemerkt und erst weitergegeben, wenn die Weitergabe von Löschungen eingeschaltet ist (SHOPIFY_ERASURE_SYNC). Die Adresse wird gesperrt und nie wieder angeschrieben oder importiert. Das lässt sich nicht rückgängig machen."
        : "Löscht alles über diese Person: Profil, Gespräche, Einwilligung, Kampagnen-Mails, Korrespondenz und Briefe. Die Adresse wird gesperrt und nie wieder angeschrieben oder importiert. Das lässt sich nicht rückgängig machen.",
      confirmLabel: "Endgültig löschen",
      tone: "destructive",
    });
    if (ok) void erase.run();
  }

  return (
    <CustomerActionsContext.Provider value={actions}>
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-foreground">
              {customer.name ?? customer.email}
            </h2>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
              {customer.name && <span className="text-foreground/70">{customer.email}</span>}
              <span>
                Zuerst {formatAdmin(customer.firstSeenAt, ADMIN_DATE)} · Zuletzt{" "}
                {formatAdmin(customer.lastSeenAt, ADMIN_DATE)}
              </span>
              {reloading && <Spinner size="xs" label="Aktualisiert" />}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <ShopBadge isShopify={customer.isShopifyCustomer} />
            {customer.identityTier === 3 && <TierBadge tier={3} size="md" />}
            <MoBadge conversations={customer.sessions.length} />
            <PersonaBadge persona={customer.personaLabel} size="md" />
            {returning && (
              <Tooltip content="Mehrere Beratungen unter derselben E-Mail (wiederkehrender Kunde)">
                <StatusBadge tone="accent" icon={<RotateCcw />} size="md" tabIndex={0} className="cursor-help">
                  {num(customer.sessions.length)}×
                </StatusBadge>
              </Tooltip>
            )}
            <ConsentBadge state={customer.consent.state} blockReason={customer.consent.blockReason} full size="md" />
            <Tooltip content="Kunde vollständig löschen (DSGVO)">
              <Button
                variant="ghost"
                size="xs"
                onClick={() => void onErase()}
                loading={erase.pending}
                className="text-destructive"
              >
                <Trash2 /> Löschen
              </Button>
            </Tooltip>
          </div>
        </div>

        {!customer.consent.sendable && (
          <div className="mx-5 mt-3 rounded-md border border-border bg-surface-2 px-3 py-2 text-xs text-muted-foreground">
            {customer.consent.blockReason
              ? "Adresse gesperrt — keine Werbung per E-Mail. Profil und Daten bleiben einsehbar."
              : "Keine Einwilligung für E-Mail-Werbung — nur ansehen: keine Kampagne, keine Einzelansprache, kein Set-Angebot per Mail."}
          </div>
        )}

        <Tabs defaultValue={initialTab && DETAIL_TABS.includes(initialTab) ? initialTab : "ueberblick"} className="mt-4">
          <div className="overflow-x-auto px-5">
            <TabsList variant="underline" className="min-w-max">
              <TabsTrigger value="ueberblick">Überblick</TabsTrigger>
              <TabsTrigger value="aktivitaet">Aktivität</TabsTrigger>
              <TabsTrigger value="kaeufe" badge={customer.ordersTotal || undefined}>
                Käufe
              </TabsTrigger>
              <TabsTrigger value="beratungen" badge={customer.sessions.length || undefined}>
                Gespräche
              </TabsTrigger>
              <TabsTrigger value="marketing">Marketing</TabsTrigger>
              <TabsTrigger value="korrespondenz" badge={customer.correspondence.length || undefined}>
                Korrespondenz
              </TabsTrigger>
              <TabsTrigger value="brief" badge={customer.physicalLetters.length || undefined}>
                Brief
              </TabsTrigger>
            </TabsList>
          </div>
          <div className="px-5 pb-5 pt-4">
            <TabsContent value="ueberblick" forceMount>
              <UeberblickTab customer={customer} />
            </TabsContent>
            <TabsContent value="aktivitaet" forceMount>
              <AktivitaetTab customer={customer} />
            </TabsContent>
            <TabsContent value="beratungen" forceMount>
              <BeratungenTab customer={customer} />
            </TabsContent>
            <TabsContent value="kaeufe" forceMount>
              <KaeufeTab customer={customer} />
            </TabsContent>
            <TabsContent value="marketing" forceMount>
              <MarketingTab customer={customer} />
            </TabsContent>
            <TabsContent value="korrespondenz" forceMount>
              <KorrespondenzTab customer={customer} />
            </TabsContent>
            <TabsContent value="brief" forceMount>
              <BriefTab customer={customer} />
            </TabsContent>
          </div>
        </Tabs>
      </Card>
      {confirmDialog}
    </CustomerActionsContext.Provider>
  );
}
