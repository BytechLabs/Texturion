import type { Metadata } from "next";

import { compareMonth } from "@/app/(marketing)/compare/verification";
import { CompareHeymarketPageBody } from "@/components/marketing/compare-heymarket-page";
import { compareHeymarketFr } from "@/i18n/marketing/compare-heymarket";
import { buildMetadata } from "@/lib/marketing/seo";

const PATH = "/fr/comparer/heymarket";

export const metadata: Metadata = buildMetadata({
  title: compareHeymarketFr.metadataTitle,
  description: compareHeymarketFr.metadataDescription.replace(
    "{month}",
    compareMonth("fr-CA"),
  ),
  path: PATH,
});

export default function ComparerHeymarketPage() {
  return <CompareHeymarketPageBody locale="fr-CA" />;
}
