import type { Metadata } from "next";

import { TERMS_FR_PATH, TermsPageBody } from "@/components/marketing/legal/terms-page";
import { legalTermsFr } from "@/i18n/marketing/legal-terms";
import { buildMetadata } from "@/lib/marketing/seo";

export const metadata: Metadata = buildMetadata({
  title: legalTermsFr.metaTitle,
  description: legalTermsFr.metaDescription,
  path: TERMS_FR_PATH,
});

export default function TermsPageFr() {
  return <TermsPageBody locale="fr-CA" />;
}
