import type { NextConfig } from "next";

// The gift voucher renderer (src/lib/gift-voucher-render.ts) reads its fonts
// from src/assets/fonts with fs.readFile at runtime, which the file tracer
// cannot follow — so every route that renders a voucher (PDF, previews, print
// files: storefront API, admin, cron, the Shopify webhook's after()) or serves
// the storefront font gets the folder traced in explicitly.
const GIFT_VOUCHER_FONTS = ["./src/assets/fonts/**/*"];

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "cdn.shopify.com",
      },
    ],
  },
  outputFileTracingIncludes: {
    "/api/gift-vouchers/**": GIFT_VOUCHER_FONTS,
    "/api/admin/gutscheine/**": GIFT_VOUCHER_FONTS,
    "/api/cron/gift-vouchers": GIFT_VOUCHER_FONTS,
    "/api/webhooks/shopify": GIFT_VOUCHER_FONTS,
  },
};

export default nextConfig;
