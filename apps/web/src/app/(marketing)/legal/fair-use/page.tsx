import type { Metadata } from "next";

import { FairUsePageBody } from "@/components/marketing/legal/fair-use-page";
import { legalFairUseEn } from "@/i18n/marketing/legal-fair-use";
import { buildMetadata } from "@/lib/marketing/seo";

/**
 * #328 — D34 makes this the canonical home of the allowance figures. Plan
 * prices remain components so they follow the site-wide country selection.
 */
const PATH = "/legal/fair-use";

export const metadata: Metadata = buildMetadata({
  title: legalFairUseEn.metaTitle,
  description: legalFairUseEn.metaDescription,
  path: PATH,
});

export default function FairUsePage() {
  return <FairUsePageBody locale="en" />;
}
