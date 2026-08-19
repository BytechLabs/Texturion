import type { Metadata } from "next";

import { RefundsPageBody } from "@/components/marketing/legal/refunds-page";
import { legalRefundsFr } from "@/i18n/marketing/legal-refunds";
import { buildMetadata } from "@/lib/marketing/seo";

const PATH = "/fr/remboursements";

export const metadata: Metadata = buildMetadata({
  title: legalRefundsFr.metaTitle,
  description: legalRefundsFr.metaDescription,
  path: PATH,
});

/** /fr/remboursements — the French 30-day guarantee. Body shared with /legal/refunds. */
export default function RefundsPageFr() {
  return <RefundsPageBody locale="fr-CA" />;
}
