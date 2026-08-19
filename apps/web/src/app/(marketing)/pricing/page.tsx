import { formatMoney, PLAN_PRICE_CENTS, US_REGISTRATION_FEE_CENTS } from "@loonext/shared";
import type { Metadata } from "next";

import { PricingPageBody } from "@/components/marketing/pricing-page";
import { fill } from "@/i18n/marketing/home";
import { pricingEn } from "@/i18n/marketing/pricing";
import { buildMetadata } from "@/lib/marketing/seo";
import { absoluteUrl } from "@/lib/marketing/site";

const PATH = "/pricing";

const STARTER_USD = formatMoney(PLAN_PRICE_CENTS.usd.starter, "usd");
const PRO_USD = formatMoney(PLAN_PRICE_CENTS.usd.pro, "usd");
const REGISTRATION_USD = formatMoney(US_REGISTRATION_FEE_CENTS.usd, "usd");

const FIGURES = {
  starter: STARTER_USD,
  pro: PRO_USD,
  fee: REGISTRATION_USD,
};

const OG_TITLE = fill(pricingEn.ogTitle, FIGURES);
const OG_DESCRIPTION = fill(pricingEn.ogDescription, FIGURES);

export const metadata: Metadata = {
  ...buildMetadata({
    title: fill(pricingEn.metaTitle, FIGURES),
    description: fill(pricingEn.metaDescription, FIGURES),
    path: PATH,
  }),
  // Override openGraph WITHOUT `images` so Next serves the page's own
  // file-convention card (pricing/opengraph-image.tsx — the flat-price truth
  // chip). buildMetadata always injects the generic default card, which
  // SHADOWS the file convention (seo.ts precedence note); omitting images here
  // is exactly how the home page wires its own card.
  openGraph: {
    type: "website",
    siteName: "Loonext",
    url: absoluteUrl(PATH),
    title: OG_TITLE,
    description: OG_DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: OG_TITLE,
    description: OG_DESCRIPTION,
  },
};

/** The English /pricing page. Body shared with /fr/tarifs. */
export default function PricingPage() {
  return <PricingPageBody locale="en" />;
}
