// Props of the Eingang screen (server EingangTab → client EingangWorkspace).

export interface EingangSystemCards {
  /** Active campaigns with drafts waiting on the desk. */
  campaigns: Array<{ id: number; slug: string; name: string; drafted: number }>;
  qaOpen: number;
  runningReports: number;
  runningImprovementRuns: number;
  /** Shopify sync trouble in plain German (empty = all good). */
  syncProblems: string[];
  /** The compact 30-day strip (the former Übersicht numbers). */
  strip: { chats: number | null; campaignMails: number; newSubscribers: number };
}

/** GET /api/admin/inbox/item — the customer mini-card of the right pane. */
export interface InboxCustomerCard {
  id: number;
  email: string;
  name: string | null;
  isShopifyCustomer: boolean;
  consentLabel: string;
  sendable: boolean;
  letterPossible: boolean;
  persona: string | null;
  profileDepth: "kauf" | "voll" | null;
  profileExcerpt: string | null;
  figures: {
    ordersCount: number;
    totalSpentCents: number;
    lastOrderAt: string | null;
    lifecycleSegment: string | null;
    valueTier: string | null;
    churnRisk: string | null;
    conversationsCount: number;
    /** null until the nightly facts run has computed this person's figures. */
    factsComputedAt: string | null;
  } | null;
}

/** GET /api/admin/inbox/item — the conversation of an „E-Mail beantworten“ item. */
export interface InboxMailThread {
  messages: Array<{
    id: number;
    direction: "sent" | "received";
    subject: string | null;
    fromAddress: string;
    occurredAt: string | null;
    text: string;
    attachmentCount: number;
    /** One of the mails this item is about (not answered yet). */
    isNew: boolean;
  }>;
  /** The newest received message — the reply answers it (threading). */
  replyToMessageId: number | null;
}
