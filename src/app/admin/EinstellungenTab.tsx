// "Einstellungen" tab body (server component): everything e-mail — the
// registered CODE designs (src/lib/email-designs/registry.ts) with live
// previews, the per-email-type design selection, the read-only send
// configuration and the Systemstatus overview (decision D-5, env-derived
// booleans only). Data is gathered here on the server and handed to the client
// EmailSettingsWorkspace, which owns the selection state and calls the
// /api/admin/email-designs routes.

import { listEmailDesignMeta } from "@/lib/email-designs/registry";
import { listEmailDesignSelections } from "@/lib/email-design-store";
import { isEmailConfigured, senderAddress } from "@/lib/email";
import { inboundEmailAddress, inboundWebhookSecret } from "@/lib/email-inbound";
import { isShopifyConfigured } from "@/lib/shopify";
import { isPingenConfigured } from "@/lib/pingen";
import { isPhysicalMailSendsApproved } from "@/lib/pingen-flag.mjs";
import { isCampaignSendsApproved, isSingleOptInAllowed } from "@/lib/campaign-flags.mjs";
import { EmailSettingsWorkspace } from "./lazy";
import type { SystemStatus } from "./einstellungen/types";

export async function EinstellungenTab({ dbReady }: { dbReady: boolean }) {
  const designs = listEmailDesignMeta();
  const selections = dbReady ? await listEmailDesignSelections() : {};

  // Presence checks only — the values never leave the server.
  const systemStatus: SystemStatus = {
    db: dbReady,
    shopify: isShopifyConfigured(),
    resendSend: isEmailConfigured(),
    resendWebhook: Boolean(inboundWebhookSecret()),
    pingen: isPingenConfigured(),
    anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
    openai: Boolean(process.env.OPENAI_API_KEY),
    campaignSendsApproved: isCampaignSendsApproved(),
    singleOptInAllowed: isSingleOptInAllowed(),
    physicalMailApproved: isPhysicalMailSendsApproved(),
  };

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
      systemStatus={systemStatus}
    />
  );
}
