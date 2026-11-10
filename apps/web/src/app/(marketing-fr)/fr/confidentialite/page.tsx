import type { Metadata } from "next";

import { PrivacyPageBody, PRIVACY_FR_PATH } from "@/components/marketing/legal/privacy-page";
import { legalPrivacyFr } from "@/i18n/marketing/legal-privacy";
import { buildMetadata } from "@/lib/marketing/seo";

export const metadata: Metadata = buildMetadata({
  title: legalPrivacyFr.metaTitle,
  description: legalPrivacyFr.metaDescription,
  path: PRIVACY_FR_PATH,
});

export default function PrivacyPageFr() {
  return <PrivacyPageBody locale="fr-CA" />;
}
