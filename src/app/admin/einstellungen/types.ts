// Serialized registry metadata (email-designs/registry.ts listEmailDesignMeta).
export interface EmailDesignMetaItem {
  key: string;
  name: string;
  description: string;
  addedAt: string;
  supportedKinds: string[];
  isDefault: boolean;
}

export interface SendConfigProps {
  configured: boolean;
  senderAddress: string | null;
  inboundAddress: string | null;
  logoOverride: string | null;
}

/** Read-only integration/flag overview (decision D-5) — booleans only, never
 *  values: "konfiguriert" means the env var(s) are present. */
export interface SystemStatus {
  db: boolean;
  shopify: boolean;
  resendSend: boolean;
  resendWebhook: boolean;
  pingen: boolean;
  anthropic: boolean;
  openai: boolean;
  campaignSendsApproved: boolean;
  singleOptInAllowed: boolean;
  physicalMailApproved: boolean;
  /** Upstash KV (rate limits; without it they fail open). */
  kv: boolean;
  /** Feature switches — what is live (flag readers, never values). */
  features: {
    customerSync: boolean;
    consentWriteback: boolean;
    erasureSync: boolean;
    insightsWriteback: boolean;
    campaignRelease: boolean;
    chatOrderStatus: boolean;
    aiProfilesAll: boolean;
    inboxAiPerDay: number;
    autoPreparePerNight: number;
    pingenStaging: boolean;
  };
}
