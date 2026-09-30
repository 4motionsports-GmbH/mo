"use client";

// One customer's detail: header (identity + status) and six sub-tabs
// (Profil · Beratungen · Käufe · Marketing · Korrespondenz · Brief). Panels
// stay mounted while hidden so an in-progress edit survives switching.
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
import { MarketingStatusBadge, PersonaBadge, SourceBadge, TierBadge } from "./badges";
import { ProfilTab } from "./tabs/ProfilTab";
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

export function CustomerDetail({
  customer,
  onRefresh,
  onErased,
  reloading = false,
}: {
  customer: CustomerDetailData;
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
      description:
        "Löscht alles über diese Person: Profil, alle Gespräche, Einwilligungen, Marketing- und Kampagnen-Mails, Newsletter-Kontakt, Korrespondenz und Briefe. Die Adresse wird gesperrt und nie wieder angeschrieben oder aus Shopify importiert. Das lässt sich nicht rückgängig machen.",
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
            <TierBadge tier={customer.identityTier} size="md" />
            <SourceBadge source={customer.source} />
            <PersonaBadge persona={customer.personaLabel} size="md" />
            {returning && (
              <Tooltip content="Mehrere Beratungen unter derselben E-Mail (wiederkehrender Kunde)">
                <StatusBadge tone="accent" icon={<RotateCcw />} size="md" tabIndex={0} className="cursor-help">
                  {num(customer.sessions.length)}×
                </StatusBadge>
              </Tooltip>
            )}
            <MarketingStatusBadge status={customer.marketingStatus} full size="md" />
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

        <Tabs defaultValue="profil" className="mt-4">
          <div className="overflow-x-auto px-5">
            <TabsList variant="underline" className="min-w-max">
              <TabsTrigger value="profil">Profil</TabsTrigger>
              <TabsTrigger value="beratungen" badge={customer.sessions.length}>
                Beratungen
              </TabsTrigger>
              <TabsTrigger value="kaeufe">Käufe</TabsTrigger>
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
            <TabsContent value="profil" forceMount>
              <ProfilTab customer={customer} />
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
