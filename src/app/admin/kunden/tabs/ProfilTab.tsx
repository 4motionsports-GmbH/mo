"use client";

// Profil — the "current understanding" of the customer: the readable text
// plus the structured fields (persona, goals, owned, interests, level, budget,
// next steps). Kept current by the nightly upkeep; the button regenerates it
// now (costs tokens, so the last run's usage is disclosed).

import * as React from "react";
import { Sparkles } from "lucide-react";
import type { CustomerDetail } from "@/lib/customer-detail";
import type { CustomerProfileData } from "@/lib/customer-store";
import { ARCHETYPE_META } from "@/lib/persona";
import type { PersonaArchetype } from "@/lib/types";
import { ADMIN_DATE, formatAdmin } from "@/lib/admin-datetime.mjs";
import { num } from "@/lib/admin-format.mjs";
import { Button, DescriptionItem, DescriptionList, EmptyState, InfoTip, Markdown, toast } from "../../ui";
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
  const [data, setData] = React.useState<CustomerProfileData | null>(customer.profileData);

  const generate = useAsyncAction(
    () =>
      adminFetch<{
        profileSummary?: string;
        profileData?: CustomerProfileData;
        usage?: ProfileUsage;
        warning?: string;
      }>(
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
        if (json.profileData) setData(json.profileData);
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
            Das zentrale Kundenprofil aus allen Gesprächen, Käufen, der Korrespondenz und dem
            Newsletter. Es wird jede Nacht für alle Kunden mit neuen Daten aktualisiert und fließt
            in den Chat, alle E-Mails, die Kampagne und die Produktempfehlungen ein. Jede
            Generierung ist ein KI-Durchlauf und kostet Tokens.
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
        <div className="flex flex-col gap-4">
          {data && <ProfileFacts data={data} />}
          <div className="rounded-lg bg-surface-2 p-4">
            <Markdown content={profile} />
          </div>
        </div>
      ) : (
        <EmptyState
          compact
          title="Noch kein Profil"
          description="Wird in der nächsten Nacht automatisch erstellt, sobald Gespräche, Käufe oder Korrespondenz vorliegen — oder jetzt per Klick."
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

const LEVEL_LABEL: Record<string, string> = {
  einsteiger: "Einsteiger",
  fortgeschritten: "Fortgeschritten",
  profi: "Profi",
};
const BUDGET_LABEL: Record<string, string> = { niedrig: "Niedrig", mittel: "Mittel", hoch: "Hoch" };

/** The structured profile fields at a glance — only what is known. */
function ProfileFacts({ data }: { data: CustomerProfileData }) {
  const persona = ARCHETYPE_META[data.persona as PersonaArchetype];
  const lists: Array<[string, string[]]> = [
    ["Ziele", data.goals],
    ["Besitzt", data.owned],
    ["Interessen", data.interests],
    ["Nächste Schritte", data.nextSteps],
  ];
  const hasAny =
    (persona && data.persona !== "unknown") ||
    LEVEL_LABEL[data.level] ||
    BUDGET_LABEL[data.budget] ||
    lists.some(([, v]) => v.length > 0);
  if (!hasAny) return null;
  return (
    <DescriptionList columns={3}>
      {persona && data.persona !== "unknown" && (
        <DescriptionItem label="Persona">{persona.label}</DescriptionItem>
      )}
      {LEVEL_LABEL[data.level] && <DescriptionItem label="Niveau">{LEVEL_LABEL[data.level]}</DescriptionItem>}
      {BUDGET_LABEL[data.budget] && (
        <DescriptionItem label="Budget-Signal">{BUDGET_LABEL[data.budget]}</DescriptionItem>
      )}
      {lists
        .filter(([, v]) => v.length > 0)
        .map(([label, v]) => (
          <DescriptionItem key={label} label={label}>
            {v.join(" · ")}
          </DescriptionItem>
        ))}
    </DescriptionList>
  );
}
