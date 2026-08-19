import { formatMoney, PLAN_PRICE_CENTS, US_REGISTRATION_FEE_CENTS } from "@loonext/shared";
import type { Metadata } from "next";

import { PricingPageBody } from "@/components/marketing/pricing-page";
import { fill } from "@/i18n/marketing/home";
import { pricingFr } from "@/i18n/marketing/pricing";
import { buildMetadata } from "@/lib/marketing/seo";
import { absoluteUrl } from "@/lib/marketing/site";

const PATH = "/fr/tarifs";

/**
 * #328's rule again: `metadata` is one string per URL, resolved on the server
 * before any reader is known, and the country is a client-side choice. So the
 * figures here are the USD ones while everything the page RENDERS follows the
 * reader's own country.
 */
const FIGURES = {
  starter: formatMoney(PLAN_PRICE_CENTS.usd.starter, "usd"),
  pro: formatMoney(PLAN_PRICE_CENTS.usd.pro, "usd"),
  fee: formatMoney(US_REGISTRATION_FEE_CENTS.usd, "usd"),
};

const OG_TITLE = fill(pricingFr.ogTitle, FIGURES);
const OG_DESCRIPTION = fill(pricingFr.ogDescription, FIGURES);

export const metadata: Metadata = {
  ...buildMetadata({
    title: fill(pricingFr.metaTitle, FIGURES),
    description: fill(pricingFr.metaDescription, FIGURES),
    path: PATH,
  }),
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

/** /fr/tarifs — the French pricing page. Body shared with /pricing. */
export default function PricingPageFr() {
  return <PricingPageBody locale="fr-CA" />;
}
