// "Einstellungen" tab body (server component): everything email — the
// registered CODE designs (src/lib/email-designs/registry.ts) with per-type
// live previews, the per-email-type design selection, and the read-only send
// configuration (env-derived). Data is fetched here on the server and handed
// to the client EmailSettingsWorkspace, which owns the selection state and
// calls the /api/admin/email-designs routes.

import { listEmailDesignMeta } from "@/lib/email-designs/registry";
import { listEmailDesignSelections } from "@/lib/email-design-store";
import { isEmailConfigured, senderAddress } from "@/lib/email";
import { inboundEmailAddress } from "@/lib/email-inbound";
import { EmailSettingsWorkspace } from "./EmailSettingsWorkspace";

export async function EinstellungenTab({ dbReady }: { dbReady: boolean }) {
  const designs = listEmailDesignMeta();
  const selections = dbReady ? await listEmailDesignSelections() : {};

  return (
    <EmailSettingsWorkspace
      dbReady={dbReady}
      designs={designs}
      initialSelections={selections}
      sendConfig={{
        configured: isEmailConfigured(),
        senderAddress: senderAddress() ?? null,
        inboundAddress: inboundEmailAddress() ?? null,
        logoOverride: process.env.EMAIL_LOGO_URL ?? null,
      }}
    />
  );
}
