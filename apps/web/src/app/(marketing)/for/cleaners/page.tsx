import type { Metadata } from "next";

import { CleanersPageBody } from "@/components/marketing/cleaners-page";
import { cleanersEn } from "@/i18n/marketing/for-cleaners";
import { fill } from "@/i18n/marketing/home";
import { ACTIVATION_CLAIM_SHORT } from "@/lib/marketing/activation";
import { buildMetadata } from "@/lib/marketing/seo";

const PATH = "/for/cleaners";

/**
 * #328 — the snippet keeps the CLAIM and drops the FIGURE. `metadata` is one
 * string per URL, baked at build time, and the country is a client-side choice,
 * so no figure here can be true for both a US and a Canadian reader.
 */
export const metadata: Metadata = buildMetadata({
  title: cleanersEn.metaTitle,
  description: fill(cleanersEn.metaDescription, {
    claim: ACTIVATION_CLAIM_SHORT,
  }),
  path: PATH,
});

/** The English /for/cleaners page. Body shared with /fr/menage. */
export default function CleanersPage() {
  return <CleanersPageBody locale="en" />;
}
