import statement from "@root/SECURITY.md";
import type { Metadata } from "next";

import { VulnerabilityDisclosurePageBody } from "@/components/marketing/legal/vulnerability-disclosure-page";
import { legalVulnerabilityFr } from "@/i18n/marketing/legal-vulnerability-disclosure";
import { buildMetadata } from "@/lib/marketing/seo";

const PATH = "/fr/divulgation-vulnerabilites";

export const metadata: Metadata = buildMetadata({
  title: legalVulnerabilityFr.metaTitle,
  description: legalVulnerabilityFr.metaDescription,
  path: PATH,
});

export default function VulnerabilityDisclosurePageFr() {
  return (
    <VulnerabilityDisclosurePageBody locale="fr-CA" statement={statement} />
  );
}
