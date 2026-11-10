import type { Metadata } from "next";

import { TermsPageBody, TERMS_EN_PATH } from "@/components/marketing/legal/terms-page";
import { legalTermsEn } from "@/i18n/marketing/legal-terms";
import { buildMetadata } from "@/lib/marketing/seo";

export const metadata: Metadata = buildMetadata({
  title: legalTermsEn.metaTitle,
  description: legalTermsEn.metaDescription,
  path: TERMS_EN_PATH,
});

export default function TermsPage() {
  return <TermsPageBody locale="en" />;
}
