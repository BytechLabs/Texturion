import type { Metadata } from "next";

import { AupPageBody, AUP_EN_PATH } from "@/components/marketing/legal/aup-page";
import { legalAupEn } from "@/i18n/marketing/legal-aup";
import { buildMetadata } from "@/lib/marketing/seo";

export const metadata: Metadata = buildMetadata({
  title: legalAupEn.metaTitle,
  description: legalAupEn.metaDescription,
  path: AUP_EN_PATH,
});

export default function AupPage() {
  return <AupPageBody locale="en" />;
}
