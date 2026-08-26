import type { Metadata } from "next";

import { compareMonth } from "./verification";

import { CompareIndexPageBody } from "@/components/marketing/compare-index-page";
import { compareIndexEn } from "@/i18n/marketing/compare-index";
import { buildMetadata } from "@/lib/marketing/seo";

const PATH = "/compare";

export const metadata: Metadata = buildMetadata({
  title: compareIndexEn.metadataTitle,
  description: compareIndexEn.metadataDescription.replace(
    "{month}",
    compareMonth(),
  ),
  path: PATH,
});

export default function CompareIndexPage() {
  return <CompareIndexPageBody />;
}
