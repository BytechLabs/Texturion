import type { Metadata } from "next";

import { PlumbersPageBody } from "@/components/marketing/plumbers-page";
import { plumbersFr } from "@/i18n/marketing/for-plumbers";
import { fill } from "@/i18n/marketing/home";
import { ACTIVATION_CLAIM_SHORT_FR } from "@/lib/marketing/activation";
import { buildMetadata } from "@/lib/marketing/seo";

const PATH = "/fr/plombiers";

export const metadata: Metadata = buildMetadata({
  title: plumbersFr.metaTitle,
  description: fill(plumbersFr.metaDescription, {
    claim: ACTIVATION_CLAIM_SHORT_FR,
  }),
  path: PATH,
});

/** /fr/plombiers — the French plumbers page. Body shared with /for/plumbers. */
export default function PlumbersPageFr() {
  return <PlumbersPageBody locale="fr-CA" />;
}
