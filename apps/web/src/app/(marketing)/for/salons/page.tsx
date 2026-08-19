import type { Metadata } from "next";

import { SalonsPageBody } from "@/components/marketing/salons-page";
import { salonsEn } from "@/i18n/marketing/for-salons";
import { fill } from "@/i18n/marketing/home";
import { ACTIVATION_CLAIM_SHORT } from "@/lib/marketing/activation";
import { buildMetadata } from "@/lib/marketing/seo";

const PATH = "/for/salons";

/**
 * #328 — the snippet keeps the CLAIM and drops the FIGURE. `metadata` is one
 * string per URL, baked at build time, and the country is a client-side choice.
 */
export const metadata: Metadata = buildMetadata({
  title: salonsEn.metaTitle,
  description: fill(salonsEn.metaDescription, {
    claim: ACTIVATION_CLAIM_SHORT,
  }),
  path: PATH,
});

/** The English /for/salons page. Body shared with /fr/salons. */
export default function SalonsPage() {
  return <SalonsPageBody locale="en" />;
}
