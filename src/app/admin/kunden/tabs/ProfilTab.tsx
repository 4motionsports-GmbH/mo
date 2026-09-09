"use client";

// Profil — the regenerated "current understanding" of the customer (an
// Anthropic pass over all linked consultations + purchase history; costs
// tokens, so the last run's usage is disclosed after each generation).

import * as React from "react";
import { Sparkles } from "lucide-react";
import type { CustomerDetail } from "@/lib/customer-detail";
import { ADMIN_DATE, formatAdmin } from "@/lib/admin-datetime.mjs";
import { num } from "@/lib/admin-format.mjs";
import { Button, EmptyState, InfoTip, Markdown, toast } from "../../ui";
import { adminFetch } from "../../lib/admin-fetch";
import { useAsyncAction } from "../../lib/use-async-action";
import { useCustomerActions } from "../CustomerDetail";

interface ProfileUsage {
  inputTokens: number;
  outputTokens: number;
  approxCostUsd: number;
}

export function ProfilTab({ customer }: { customer: CustomerDetail }) {
  const { refresh } = useCustomerActions();
  const [profile, setProfile] = React.useState(customer.profileSummary);
  const [updatedAt, setUpdatedAt] = React.useState(customer.profileSummaryUpdatedAt);
  const [lastUsage, setLastUsage] = React.useState<ProfileUsage | null>(null);

  const generate = useAsyncAction(
    () =>
      adminFetch<{ profileSummary?: string; usage?: ProfileUsage; warning?: string }>(
        "/api/admin/customers/profile",
        { body: { customerId: customer.id } }
      ),
    {
      errorToast: "Kundenverständnis fehlgeschlagen",
      onSuccess: (json) => {
        if (json.profileSummary) {
          setProfile(json.profileSummary);
          setUpdatedAt(new Date().toISOString());
        }
        if (json.usage) setLastUsage(json.usage);
        if (json.warning) {
          toast({ variant: "warning", title: "Hinweis", description: json.warning });
        } else {
          toast({
            variant: "success",
            title: "Kundenverständnis generiert",
            description: customer.email,
          });
        }
        refresh();
      },
    }
  );

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          Aktuelles Kundenverständnis
          <InfoTip>
            Jede Generierung ist ein KI-Durchlauf (Anthropic Claude) über alle verknüpften
            Gespräche und die Kaufhistorie und kostet Tokens. Der Text wird gespeichert und fließt
            in personalisierte E-Mails ein.
          </InfoTip>
          {updatedAt && (
            <span className="text-xs font-normal text-muted-foreground">
              · Stand {formatAdmin(updatedAt, ADMIN_DATE)}
            </span>
          )}
        </div>
        <Button size="sm" onClick={() => void generate.run()} loading={generate.pending}>
          <Sparkles /> {profile ? "Neu generieren" : "Kundenverständnis generieren"}
        </Button>
      </div>

      {profile ? (
        <div className="rounded-lg bg-surface-2 p-4">
          <Markdown content={profile} />
        </div>
      ) : (
        <EmptyState
          compact
          title="Noch kein Profil generiert"
          description="Ein Klick auf „Kundenverständnis generieren“ fasst alle Beratungen und Käufe zusammen."
        />
      )}

      {lastUsage && (
        <p className="mt-2 text-2xs text-muted-foreground">
          Letzter Lauf: {num(lastUsage.inputTokens)} Input- / {num(lastUsage.outputTokens)}{" "}
          Output-Tokens (~${lastUsage.approxCostUsd.toFixed(3)}).
        </p>
      )}
    </div>
  );
}
