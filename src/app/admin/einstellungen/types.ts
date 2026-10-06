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
    /** CHAT_PAGE_CONTEXT_ENABLED + CHAT_PAGE_CONTEXT_HOLDOUT_PCT (0–50). */
    pageContext: boolean;
    pageContextHoldoutPct: number;
    /** APP_PROXY_SIGNIN_ENABLED + APP_PROXY_SIGNIN_MAX_AGE_HOURS (0–720). */
    appProxySignin: boolean;
    appProxySigninMaxAgeHours: number;
    /** MO_ATTRIBUTION_SESSION_ANCHOR. */
    attributionSessionAnchor: boolean;
    /** CONSENT_SIGNIN_VARIANTS — the served sign-in framing variant ids. */
    consentSigninVariants: string[];
  };
}
