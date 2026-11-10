import statement from "@root/docs/DPA.fr.md";
import type { Metadata } from "next";

import { DpaPageBody, DPA_FR_PATH } from "@/components/marketing/legal/dpa-page";
import { legalDpaFr } from "@/i18n/marketing/legal-dpa";
import { buildMetadata } from "@/lib/marketing/seo";

export const metadata: Metadata = buildMetadata({
  title: legalDpaFr.metaTitle,
  description: legalDpaFr.metaDescription,
  path: DPA_FR_PATH,
});

export default function DpaPageFr() {
  return <DpaPageBody locale="fr-CA" statement={statement} />;
}
