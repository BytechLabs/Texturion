import type { Metadata } from "next";

import { AupPageBody, AUP_FR_PATH } from "@/components/marketing/legal/aup-page";
import { legalAupFr } from "@/i18n/marketing/legal-aup";
import { buildMetadata } from "@/lib/marketing/seo";

export const metadata: Metadata = buildMetadata({
  title: legalAupFr.metaTitle,
  description: legalAupFr.metaDescription,
  path: AUP_FR_PATH,
});

export default function AupPageFr() {
  return <AupPageBody locale="fr-CA" />;
}
