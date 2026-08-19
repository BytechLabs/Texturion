import type { Metadata } from "next";

import { LandscapersPageBody } from "@/components/marketing/landscapers-page";
import { landscapersFr } from "@/i18n/marketing/for-landscapers";
import { fill } from "@/i18n/marketing/home";
import { ACTIVATION_CLAIM_SHORT_FR } from "@/lib/marketing/activation";
import { buildMetadata } from "@/lib/marketing/seo";

const PATH = "/fr/paysagistes";

export const metadata: Metadata = buildMetadata({
  title: landscapersFr.metaTitle,
  description: fill(landscapersFr.metaDescription, {
    claim: ACTIVATION_CLAIM_SHORT_FR,
  }),
  path: PATH,
});

/** /fr/paysagistes — the French landscapers page. Body shared with /for/landscapers. */
export default function LandscapersPageFr() {
  return <LandscapersPageBody locale="fr-CA" />;
}
