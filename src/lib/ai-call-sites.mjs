// German labels of the ai_usage call sites (lib/ai-usage-store `AiCallSite`) —
// one list for the KPI section „KI-Kosten“ and the business snapshot
// (business-snapshot-core costs table). Plain .mjs so the pure, node-tested
// cores can import it; AiCostSection types it as Record<AiCallSite, string>,
// so a new call site without a label fails the type check. An unknown key from
// old rows renders raw.

export const AI_CALL_SITE_LABELS = Object.freeze({
  chat: "Beratungs-Chat",
  embeddings: "Embeddings (Produktsuche)",
  tts: "Sprachausgabe (TTS)",
  summary_email: "Zusammenfassungs-E-Mail",
  summary_download: "Zusammenfassung (Download)",
  marketing_draft: "Marketing-Entwürfe",
  campaign_draft: "Kampagnen-Entwürfe",
  campaign_letter: "Kampagnen-Briefe",
  customer_profile: "Kundenprofile",
  top_questions: "Top-Fragen (Personas)",
  conversation_analysis: "Gesprächsanalyse",
  conversation_insights: "Insights-Rollup",
  analytics_report: "Komplettanalyse",
  qa_draft: "Wissen: Entwürfe",
  qa_translate: "Wissen: Übersetzung",
  bundle_suggestions: "Bundle-Vorschläge",
  hero_image: "KI-Titelbilder",
  campaign_assist: "Kampagnen: Zielgruppe & Briefing",
  inbox_suggestion: "Eingang: Vorschläge",
  inbox_mail_reply: "Eingang: E-Mail beantworten",
  customer_ask: "Kunden: Frag Mo",
  improvement: "Verbesserung",
});
