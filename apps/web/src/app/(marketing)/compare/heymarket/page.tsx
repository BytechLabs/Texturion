import type { Metadata } from "next";

import { CompareHeymarketPageBody } from "@/components/marketing/compare-heymarket-page";
import { compareHeymarketEn } from "@/i18n/marketing/compare-heymarket";
import { buildMetadata } from "@/lib/marketing/seo";

import { compareMonth } from "../verification";

const PATH = "/compare/heymarket";

export const metadata: Metadata = buildMetadata({
  title: compareHeymarketEn.metadataTitle,
  description: compareHeymarketEn.metadataDescription.replace(
    "{month}",
    compareMonth(),
  ),
  path: PATH,
});

export default function CompareHeymarketPage() {
  return <CompareHeymarketPageBody />;
}
