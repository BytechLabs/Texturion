import type { Metadata } from "next";

import { compareMonth } from "@/app/(marketing)/compare/verification";
import { CompareIndexPageBody } from "@/components/marketing/compare-index-page";
import { compareIndexFr } from "@/i18n/marketing/compare-index";
import { buildMetadata } from "@/lib/marketing/seo";

const PATH = "/fr/comparer";

export const metadata: Metadata = buildMetadata({
  title: compareIndexFr.metadataTitle,
  description: compareIndexFr.metadataDescription.replace(
    "{month}",
    compareMonth("fr-CA"),
  ),
  path: PATH,
});

export default function ComparerPage() {
  return <CompareIndexPageBody locale="fr-CA" />;
}
