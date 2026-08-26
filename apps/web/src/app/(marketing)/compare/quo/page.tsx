import type { Metadata } from "next";

import { CompareQuoPageBody } from "@/components/marketing/compare-quo-page";
import { compareQuoEn } from "@/i18n/marketing/compare-quo";
import { buildMetadata } from "@/lib/marketing/seo";

const PATH = "/compare/quo";

export const metadata: Metadata = buildMetadata({
  title: compareQuoEn.metadataTitle,
  description: compareQuoEn.metadataDescription,
  path: PATH,
});

export default function CompareQuoPage() {
  return <CompareQuoPageBody />;
}
