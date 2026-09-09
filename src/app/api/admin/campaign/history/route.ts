// GET /api/admin/campaign/history?q=&from=&to=&page=&pageSize= — the paged,
// searchable "Gesendet" view of the Kampagne screen. Redemption status is
// looked up in Shopify for THIS page's codes only (bounded by the page size;
// null = unknown — never silently "not redeemed").

import { guardAdminGet, adminJson } from "@/lib/admin-api";
import { searchCampaignSendHistory } from "@/lib/campaign-store";
import { isShopifyConfigured } from "@/lib/shopify";
import { wasDiscountCodeRedeemed } from "@/lib/shopify-orders";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const blocked = await guardAdminGet();
  if (blocked) return blocked;

  const sp = new URL(req.url).searchParams;
  const page = await searchCampaignSendHistory({
    query: sp.get("q") ?? "",
    from: sp.get("from"),
    to: sp.get("to"),
    page: Number(sp.get("page") ?? 1),
    pageSize: Number(sp.get("pageSize") ?? 25),
  });

  const redemption = new Map<string, boolean | null>();
  if (isShopifyConfigured()) {
    const codes = [
      ...new Set(page.rows.map((r) => r.discountCode).filter((c): c is string => Boolean(c))),
    ];
    const results = await Promise.all(codes.map((c) => wasDiscountCodeRedeemed(c)));
    codes.forEach((c, i) => redemption.set(c, results[i]));
  }

  return adminJson({
    ...page,
    rows: page.rows.map((r) => ({
      ...r,
      redeemed: r.discountCode ? (redemption.get(r.discountCode) ?? null) : null,
    })),
  });
}
