import {
  softwareApplicationJsonLd,
  websiteJsonLd,
} from "@/lib/marketing/seo";

import { JsonLd } from "./ui/json-ld";

/**
 * Home-page JSON-LD (BLUEPRINT §11.2): WebSite + SoftwareApplication (with the
 * two real USD offers, no aggregateRating). Organization is already emitted by
 * the (marketing) layout for every page. Track B's home page renders this once,
 * near the top, a single line, so JSON-LD emission stays in Track A's SEO lane
 * without Track A editing Track B's page.tsx.
 */
export function HomeJsonLd() {
  return <JsonLd data={[websiteJsonLd(), softwareApplicationJsonLd()]} />;
}
