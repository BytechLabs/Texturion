import type { Metadata } from "next";

import { HvacPageBody } from "@/components/marketing/hvac-page";
import { hvacFr } from "@/i18n/marketing/for-hvac";
import { fill } from "@/i18n/marketing/home";
import { ACTIVATION_CLAIM_SHORT_FR } from "@/lib/marketing/activation";
import { buildMetadata } from "@/lib/marketing/seo";

const PATH = "/fr/cvca";

export const metadata: Metadata = buildMetadata({
  title: hvacFr.metaTitle,
  description: fill(hvacFr.metaDescription, {
    claim: ACTIVATION_CLAIM_SHORT_FR,
  }),
  path: PATH,
});

/** /fr/cvca — the French HVAC page. Body shared with /for/hvac. */
export default function HvacPageFr() {
  return <HvacPageBody locale="fr-CA" />;
}
