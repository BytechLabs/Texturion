import type { Metadata } from "next";

import { LandscapersPageBody } from "@/components/marketing/landscapers-page";
import { landscapersEn } from "@/i18n/marketing/for-landscapers";
import { fill } from "@/i18n/marketing/home";
import { ACTIVATION_CLAIM_SHORT } from "@/lib/marketing/activation";
import { buildMetadata } from "@/lib/marketing/seo";

const PATH = "/for/landscapers";

/**
 * #328 — the snippet keeps the CLAIM and drops the FIGURE. `metadata` is one
 * string per URL, baked at build time, and the country is a client-side choice.
 */
export const metadata: Metadata = buildMetadata({
  title: landscapersEn.metaTitle,
  description: fill(landscapersEn.metaDescription, {
    claim: ACTIVATION_CLAIM_SHORT,
  }),
  path: PATH,
});

/** The English /for/landscapers page. Body shared with /fr/paysagistes. */
export default function LandscapersPage() {
  return <LandscapersPageBody locale="en" />;
}
