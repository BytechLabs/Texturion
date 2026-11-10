import type { Metadata } from "next";

import { PrivacyPageBody, PRIVACY_EN_PATH } from "@/components/marketing/legal/privacy-page";
import { legalPrivacyEn } from "@/i18n/marketing/legal-privacy";
import { buildMetadata } from "@/lib/marketing/seo";

export const metadata: Metadata = buildMetadata({
  title: legalPrivacyEn.metaTitle,
  description: legalPrivacyEn.metaDescription,
  path: PRIVACY_EN_PATH,
});

export default function PrivacyPage() {
  return <PrivacyPageBody locale="en" />;
}
