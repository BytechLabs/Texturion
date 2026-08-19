import type { Metadata } from "next";

import { CompliancePageBody } from "@/components/marketing/compliance-page";
import { complianceFr } from "@/i18n/marketing/compliance";
import { buildMetadata } from "@/lib/marketing/seo";

const PATH = "/fr/conformite";

export const metadata: Metadata = buildMetadata({
  title: complianceFr.metaTitle,
  description: complianceFr.metaDescription,
  path: PATH,
});

/** /fr/conformite — no accent in the slug, so it survives a keyboard. */
export default function CompliancePageFr() {
  return <CompliancePageBody locale="fr-CA" />;
}
