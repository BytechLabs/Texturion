import type { Metadata } from "next";

import { CleanersPageBody } from "@/components/marketing/cleaners-page";
import { cleanersFr } from "@/i18n/marketing/for-cleaners";
import { fill } from "@/i18n/marketing/home";
import { ACTIVATION_CLAIM_SHORT_FR } from "@/lib/marketing/activation";
import { buildMetadata } from "@/lib/marketing/seo";

const PATH = "/fr/menage";

export const metadata: Metadata = buildMetadata({
  title: cleanersFr.metaTitle,
  description: fill(cleanersFr.metaDescription, {
    claim: ACTIVATION_CLAIM_SHORT_FR,
  }),
  path: PATH,
});

/** /fr/menage — the French cleaners page. Body shared with /for/cleaners. */
export default function CleanersPageFr() {
  return <CleanersPageBody locale="fr-CA" />;
}
