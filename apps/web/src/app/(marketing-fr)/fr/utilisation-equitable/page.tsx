import type { Metadata } from "next";

import { FairUsePageBody } from "@/components/marketing/legal/fair-use-page";
import { legalFairUseFr } from "@/i18n/marketing/legal-fair-use";
import { buildMetadata } from "@/lib/marketing/seo";

const PATH = "/fr/utilisation-equitable";

export const metadata: Metadata = buildMetadata({
  title: legalFairUseFr.metaTitle,
  description: legalFairUseFr.metaDescription,
  path: PATH,
});

export default function FairUsePageFr() {
  return <FairUsePageBody locale="fr-CA" />;
}
