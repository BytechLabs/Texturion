import type { Metadata } from "next";

import { CompareQuoPageBody } from "@/components/marketing/compare-quo-page";
import { compareQuoFr } from "@/i18n/marketing/compare-quo";
import { buildMetadata } from "@/lib/marketing/seo";

const PATH = "/fr/comparer/quo";

export const metadata: Metadata = buildMetadata({
  title: compareQuoFr.metadataTitle,
  description: compareQuoFr.metadataDescription,
  path: PATH,
});

export default function ComparerQuoPage() {
  return <CompareQuoPageBody locale="fr-CA" />;
}
