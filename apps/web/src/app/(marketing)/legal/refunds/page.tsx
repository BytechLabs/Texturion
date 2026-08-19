import type { Metadata } from "next";

import { RefundsPageBody } from "@/components/marketing/legal/refunds-page";
import { legalRefundsEn } from "@/i18n/marketing/legal-refunds";
import { buildMetadata } from "@/lib/marketing/seo";

const PATH = "/legal/refunds";

export const metadata: Metadata = buildMetadata({
  title: legalRefundsEn.metaTitle,
  description: legalRefundsEn.metaDescription,
  path: PATH,
});

/** The English 30-day guarantee. Body shared with /fr/remboursements. */
export default function RefundsPage() {
  return <RefundsPageBody locale="en" />;
}
