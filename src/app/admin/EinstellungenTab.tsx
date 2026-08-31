// "Einstellungen" tab body (server component): everything email — the stored
// design templates ("Vorlagen") with editor + live preview, the per-email-type
// assignment, and the read-only send configuration (env-derived). Data is
// fetched here on the server and handed to the client EmailSettingsWorkspace,
// which owns the edit state and calls the /api/admin/email-templates routes.

import {
  listEmailTemplates,
  listEmailTemplateAssignments,
} from "@/lib/email-theme-store";
import { isEmailConfigured, senderAddress } from "@/lib/email";
import { inboundEmailAddress } from "@/lib/email-inbound";
import { EmailSettingsWorkspace } from "./EmailSettingsWorkspace";

export async function EinstellungenTab({ dbReady }: { dbReady: boolean }) {
  const [templates, assignments] = dbReady
    ? await Promise.all([listEmailTemplates(), listEmailTemplateAssignments()])
    : [[], {}];

  return (
    <EmailSettingsWorkspace
      dbReady={dbReady}
      initialTemplates={templates}
      initialAssignments={assignments}
      sendConfig={{
        configured: isEmailConfigured(),
        senderAddress: senderAddress() ?? null,
        inboundAddress: inboundEmailAddress() ?? null,
        logoOverride: process.env.EMAIL_LOGO_URL ?? null,
      }}
    />
  );
}
