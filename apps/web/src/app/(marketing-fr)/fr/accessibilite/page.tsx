import statement from "@root/docs/ACCESSIBILITY.md";
import type { Metadata } from "next";

import { AccessibilityPageBody } from "@/components/marketing/legal/accessibility-page";
import { legalAccessibilityFr } from "@/i18n/marketing/legal-accessibility";
import { buildMetadata } from "@/lib/marketing/seo";

const PATH = "/fr/accessibilite";

export const metadata: Metadata = buildMetadata({
  title: legalAccessibilityFr.metaTitle,
  description: legalAccessibilityFr.metaDescription,
  path: PATH,
});

export default function AccessibilityStatementPageFr() {
  return <AccessibilityPageBody locale="fr-CA" statement={statement} />;
}
