import type { Metadata } from "next";

import { PlumbersPageBody } from "@/components/marketing/plumbers-page";
import { plumbersEn } from "@/i18n/marketing/for-plumbers";
import { fill } from "@/i18n/marketing/home";
import { ACTIVATION_CLAIM_SHORT } from "@/lib/marketing/activation";
import { buildMetadata } from "@/lib/marketing/seo";

const PATH = "/for/plumbers";

/**
 * #328 — why the search snippet names no figure, when the page does.
 *
 * Everything the page renders quotes the price through `<PlanPrice>`, so a
 * Canadian reader sees the CAD figure their card will be charged. A
 * `metadata.description` cannot: it is one string per URL, baked at build time,
 * and the country is a client-side choice. "flat $29/mo" in a Google result for
 * a Hamilton plumber is exactly the promise #328 exists to stop, and there is
 * no wording that is true at both $29 and $39.
 *
 * So the snippet keeps the CLAIM and drops the FIGURE, the same call
 * `lib/marketing/activation.ts` already made for this class of string.
 */
export const metadata: Metadata = buildMetadata({
  title: plumbersEn.metaTitle,
  description: fill(plumbersEn.metaDescription, {
    claim: ACTIVATION_CLAIM_SHORT,
  }),
  path: PATH,
});

/** The English /for/plumbers page. Body shared with /fr/plombiers. */
export default function PlumbersPage() {
  return <PlumbersPageBody locale="en" />;
}
