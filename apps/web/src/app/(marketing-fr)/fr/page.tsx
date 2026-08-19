import { formatMoney, PLAN_PRICE_CENTS } from "@loonext/shared";
import type { Metadata } from "next";

import { HomePageBody } from "@/components/marketing/home-page";
import { homeFr } from "@/i18n/marketing/home";
import { buildMetadata } from "@/lib/marketing/seo";
import { absoluteUrl } from "@/lib/marketing/site";

const PATH = "/fr";

/**
 * #328's rule holds here for the same reason it holds on `/`: `metadata` is
 * evaluated once, on the server, for one URL, and the country choice is a
 * client-side signal. So the figure in the description is the USD one, and
 * everything the page RENDERS still follows the reader's own country.
 */
const STARTER_USD = formatMoney(PLAN_PRICE_CENTS.usd.starter, "usd");

const OG_DESCRIPTION = `${homeFr.ogDescription} ${STARTER_USD} ${homeFr.metaPrice}`;

export const metadata: Metadata = {
  ...buildMetadata({
    title: homeFr.metaTitle,
    description: `${homeFr.metaDescription} ${STARTER_USD} ${homeFr.metaPrice}`,
    path: PATH,
    absoluteTitle: true,
  }),
  openGraph: {
    type: "website",
    siteName: "Loonext",
    url: absoluteUrl(PATH),
    title: homeFr.ogTitle,
    description: OG_DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: homeFr.ogTitle,
    description: OG_DESCRIPTION,
  },
};

/** The French home page. Body shared with `/`. */
export default function HomePageFr() {
  return <HomePageBody locale="fr-CA" />;
}
