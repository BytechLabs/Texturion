import type { Metadata } from "next";

import { BusinessNumberPageBody } from "@/components/marketing/business-number-page";
import { businessNumberFr } from "@/i18n/marketing/business-number";
import { buildMetadata } from "@/lib/marketing/seo";

const PATH = "/fr/numero-entreprise";

export const metadata: Metadata = buildMetadata({
  title: businessNumberFr.metaTitle,
  description: businessNumberFr.metaDescription,
  path: PATH,
});

/** /fr/numero-entreprise — no accent in the slug, so it survives a keyboard. */
export default function BusinessNumberPageFr() {
  return <BusinessNumberPageBody locale="fr-CA" />;
}
