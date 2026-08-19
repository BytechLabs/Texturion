import type { Metadata } from "next";

import { ContractorsPageBody } from "@/components/marketing/contractors-page";
import { contractorsEn } from "@/i18n/marketing/for-contractors";
import { fill } from "@/i18n/marketing/home";
import { ACTIVATION_CLAIM_SHORT } from "@/lib/marketing/activation";
import { buildMetadata } from "@/lib/marketing/seo";

const PATH = "/for/contractors";

/**
 * #328 — the snippet keeps the CLAIM and drops the FIGURE. `metadata` is one
 * string per URL, baked at build time, and the country is a client-side choice.
 */
export const metadata: Metadata = buildMetadata({
  title: contractorsEn.metaTitle,
  description: fill(contractorsEn.metaDescription, {
    claim: ACTIVATION_CLAIM_SHORT,
  }),
  path: PATH,
});

/** The English /for/contractors page. Body shared with /fr/entrepreneurs. */
export default function ContractorsPage() {
  return <ContractorsPageBody locale="en" />;
}
