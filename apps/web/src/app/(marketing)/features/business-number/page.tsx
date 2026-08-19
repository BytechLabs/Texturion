import type { Metadata } from "next";

import { BusinessNumberPageBody } from "@/components/marketing/business-number-page";
import { businessNumberEn } from "@/i18n/marketing/business-number";
import { buildMetadata } from "@/lib/marketing/seo";

const PATH = "/features/business-number";

export const metadata: Metadata = buildMetadata({
  title: businessNumberEn.metaTitle,
  description: businessNumberEn.metaDescription,
  path: PATH,
});

/** The English /features/business-number page. Body shared with /fr/numero-entreprise. */
export default function BusinessNumberPage() {
  return <BusinessNumberPageBody locale="en" />;
}
