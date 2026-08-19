import type { Metadata } from "next";

import { HvacPageBody } from "@/components/marketing/hvac-page";
import { hvacEn } from "@/i18n/marketing/for-hvac";
import { fill } from "@/i18n/marketing/home";
import { ACTIVATION_CLAIM_SHORT } from "@/lib/marketing/activation";
import { buildMetadata } from "@/lib/marketing/seo";

const PATH = "/for/hvac";

/**
 * #328 — the snippet keeps the CLAIM and drops the FIGURE. `metadata` is one
 * string per URL, baked at build time, and the country is a client-side choice.
 */
export const metadata: Metadata = buildMetadata({
  title: hvacEn.metaTitle,
  description: fill(hvacEn.metaDescription, { claim: ACTIVATION_CLAIM_SHORT }),
  path: PATH,
});

/** The English /for/hvac page. Body shared with /fr/cvca. */
export default function HvacPage() {
  return <HvacPageBody locale="en" />;
}
