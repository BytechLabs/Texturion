import type { Metadata } from "next";

import { SalonsPageBody } from "@/components/marketing/salons-page";
import { salonsFr } from "@/i18n/marketing/for-salons";
import { fill } from "@/i18n/marketing/home";
import { ACTIVATION_CLAIM_SHORT_FR } from "@/lib/marketing/activation";
import { buildMetadata } from "@/lib/marketing/seo";

const PATH = "/fr/salons";

export const metadata: Metadata = buildMetadata({
  title: salonsFr.metaTitle,
  description: fill(salonsFr.metaDescription, {
    claim: ACTIVATION_CLAIM_SHORT_FR,
  }),
  path: PATH,
});

/** /fr/salons — the French salons page. Body shared with /for/salons. */
export default function SalonsPageFr() {
  return <SalonsPageBody locale="fr-CA" />;
}
