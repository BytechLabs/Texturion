import type { Metadata } from "next";

import { CompliancePageBody } from "@/components/marketing/compliance-page";
import { complianceEn } from "@/i18n/marketing/compliance";
import { buildMetadata } from "@/lib/marketing/seo";

const PATH = "/features/compliance";

export const metadata: Metadata = buildMetadata({
  title: complianceEn.metaTitle,
  description: complianceEn.metaDescription,
  path: PATH,
});

/** The English /features/compliance page. Body shared with /fr/conformite. */
export default function CompliancePage() {
  return <CompliancePageBody locale="en" />;
}
