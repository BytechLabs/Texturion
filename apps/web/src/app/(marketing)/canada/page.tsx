import type { Metadata } from "next";

import { CanadaPageBody } from "@/components/marketing/canada-page";
import { canadaEn } from "@/i18n/marketing/canada";
import { buildMetadata } from "@/lib/marketing/seo";

const PATH = "/canada";

export const metadata: Metadata = buildMetadata({
  title: canadaEn.metaTitle,
  // #328: no figure. A description is one string per URL, and the rendered
  // page follows the site-wide country toggle, so a typed number here would be
  // the one price a reader could see in the search snippet and not on the
  // page. The currency itself IS worth saying: it is the differentiator this
  // URL exists for, and it is true of a Canadian workspace whoever reads it.
  description: canadaEn.metaDescription,
  path: PATH,
});

/**
 * The English /canada page.
 *
 * D138: the body lives in `components/marketing/canada-page.tsx` so this file
 * and `(marketing-fr)/fr/canada/page.tsx` render the same markup in different
 * languages. The metadata is genuinely per-route — including the hreflang pair
 * `buildMetadata` derives from the translated-pages registry.
 */
export default function CanadaPage() {
  return <CanadaPageBody locale="en" />;
}
