// "Einstellungen" tab body (server component): the Shopify-Abgleich (import,
// sync health, write-back outbox) and everything e-mail — the
// registered CODE designs (src/lib/email-designs/registry.ts) with live
// previews, the per-email-type design selection, the read-only send
// configuration, the editable contact-frequency warning (admin_settings,
// migration 0078) and the Systemstatus overview (decision D-5, env-derived
// booleans only). Data is gathered here on the server and handed to the client
// EmailSettingsWorkspace, which owns the selection state and calls the
// /api/admin/email-designs routes.

import { listEmailDesignMeta } from "@/lib/email-designs/registry";
import { listEmailDesignSelections } from "@/lib/email-design-store";
import { isEmailConfigured, senderAddress } from "@/lib/email";
import { inboundEmailAddress, inboundWebhookSecret } from "@/lib/email-inbound";
import { isShopifyConfigured } from "@/lib/shopify";
import { isPingenConfigured, isPingenStaging } from "@/lib/pingen";
import { isPhysicalMailSendsApproved } from "@/lib/pingen-flag.mjs";
import {
  campaignAutoPrepareConfig,
  isCampaignReleaseEnabled,
  isCampaignSendsApproved,
  isSingleOptInAllowed,
  marketingMinSendIntervalDays,
} from "@/lib/campaign-flags.mjs";
import { getContactFrequencySettings } from "@/lib/admin-settings-store";
import { DEFAULT_CONTACT_FREQUENCY } from "@/lib/contact-frequency.mjs";
import {
  aiProfileScope,
  appProxySigninMaxAgeHours,
  inboxAiDailyLimit,
  isAppProxySigninEnabled,
  isAttributionSessionAnchorEnabled,
  isChatOrderStatusEnabled,
  isChatPageContextEnabled,
  isConsentRewardEnabled,
  isConsentValueMomentEnabled,
  isShopifyConsentWritebackEnabled,
  isShopifyCustomerSyncEnabled,
  isShopifyErasureSyncEnabled,
  isShopifyInsightsWritebackEnabled,
} from "@/lib/platform-flags.mjs";
import { pageContextHoldoutPct } from "@/lib/page-context";
import { activeSigninVariants, parseRewardTermsUrl } from "@/lib/consent-variants.mjs";
import { getSyncHealth, listSyncRuns } from "@/lib/shopify-sync";
import { getOutboxStats } from "@/lib/shopify-outbox";
import { shopifySyncFlags } from "@/lib/shopify-sync-flags";
import { getConsentAlignmentReport } from "@/lib/consent-alignment";
import { listMailTemplateMeta } from "@/lib/mail-template-store";
import { templateDesignKey } from "@/lib/mail-template-doc.mjs";
import { TEMPLATE_DESIGN_KINDS } from "@/lib/mail-template-design";
import { defaultSenderInfo, listSenderIdentities, senderDomains } from "@/lib/sender-store";
import { EmailSettingsWorkspace } from "./lazy";
import type { SystemStatus } from "./einstellungen/types";

export async function EinstellungenTab({ dbReady }: { dbReady: boolean }) {
  const [selections, health, runs, outbox, alignment, contactFrequency, templates, senders] = dbReady
    ? await Promise.all([
        listEmailDesignSelections(),
        getSyncHealth(),
        listSyncRuns(8),
        getOutboxStats(),
        getConsentAlignmentReport(),
        getContactFrequencySettings(),
        listMailTemplateMeta(),
        listSenderIdentities(),
      ])
    : [{}, null, [], null, null, { ...DEFAULT_CONTACT_FREQUENCY }, [], []];
  // Code designs, then the operator's templates („Vorlagen“, 0081) that carry
  // „Mos persönlicher Text“ — selectable for the marketing kinds.
  const designs = [
    ...listEmailDesignMeta(),
    ...templates
      .filter((t) => t.supportsPersonal)
      .map((t) => ({
        key: templateDesignKey(t.id),
        name: `Vorlage: ${t.name}`,
        description: t.description ?? "Selbst gebaute Vorlage aus dem Bildschirm „Vorlagen“.",
        addedAt: t.updatedAt ?? new Date().toISOString(),
        supportedKinds: [...TEMPLATE_DESIGN_KINDS] as string[],
        isDefault: false,
        templateId: t.id,
      })),
  ];
  const defaultSender = defaultSenderInfo();

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
    kv: Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN),
    features: {
      customerSync: isShopifyCustomerSyncEnabled(),
      consentWriteback: isShopifyConsentWritebackEnabled(),
      erasureSync: isShopifyErasureSyncEnabled(),
      insightsWriteback: isShopifyInsightsWritebackEnabled(),
      campaignRelease: isCampaignReleaseEnabled(),
      chatOrderStatus: isChatOrderStatusEnabled(),
      aiProfilesAll: aiProfileScope() === "all",
      inboxAiPerDay: inboxAiDailyLimit(),
      autoPreparePerNight: campaignAutoPrepareConfig().count,
      pingenStaging: isPingenStaging(),
      pageContext: isChatPageContextEnabled(),
      pageContextHoldoutPct: pageContextHoldoutPct(),
      appProxySignin: isAppProxySigninEnabled(),
      appProxySigninMaxAgeHours: appProxySigninMaxAgeHours(),
      attributionSessionAnchor: isAttributionSessionAnchorEnabled(),
      consentSigninVariants: activeSigninVariants("de", process.env.CONSENT_SIGNIN_VARIANTS).map((v) => v.id),
      consentReward: isConsentRewardEnabled(),
      consentRewardTermsLink: parseRewardTermsUrl(process.env.CONSENT_REWARD_TERMS_URL) !== null,
      consentValueMoment: isConsentValueMomentEnabled(),
    },
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
      contactFrequency={{ settings: contactFrequency, minSendIntervalDays: marketingMinSendIntervalDays() }}
      senders={{
        defaultFrom: defaultSender.from,
        repliesTo: defaultSender.repliesTo,
        domains: senderDomains(),
        identities: senders,
      }}
      systemStatus={systemStatus}
      shopifySync={dbReady ? { health, runs, outbox, alignment, flags: shopifySyncFlags() } : null}
    />
  );
}
