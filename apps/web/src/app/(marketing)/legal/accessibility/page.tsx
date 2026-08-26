import statement from "@root/docs/ACCESSIBILITY.md";
import type { Metadata } from "next";

import { AccessibilityPageBody } from "@/components/marketing/legal/accessibility-page";
import { legalAccessibilityEn } from "@/i18n/marketing/legal-accessibility";
import { buildMetadata } from "@/lib/marketing/seo";

const PATH = "/legal/accessibility";

export const metadata: Metadata = buildMetadata({
  title: legalAccessibilityEn.metaTitle,
  description: legalAccessibilityEn.metaDescription,
  path: PATH,
});

export default function AccessibilityStatementPage() {
  return <AccessibilityPageBody locale="en" statement={statement} />;
}
