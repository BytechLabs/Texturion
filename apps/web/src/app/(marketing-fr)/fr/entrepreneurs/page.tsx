import type { Metadata } from "next";

import { ContractorsPageBody } from "@/components/marketing/contractors-page";
import { contractorsFr } from "@/i18n/marketing/for-contractors";
import { fill } from "@/i18n/marketing/home";
import { ACTIVATION_CLAIM_SHORT_FR } from "@/lib/marketing/activation";
import { buildMetadata } from "@/lib/marketing/seo";

const PATH = "/fr/entrepreneurs";

export const metadata: Metadata = buildMetadata({
  title: contractorsFr.metaTitle,
  description: fill(contractorsFr.metaDescription, {
    claim: ACTIVATION_CLAIM_SHORT_FR,
  }),
  path: PATH,
});

/** /fr/entrepreneurs — the French contractors page. Body shared with /for/contractors. */
export default function ContractorsPageFr() {
  return <ContractorsPageBody locale="fr-CA" />;
}
