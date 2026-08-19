import type { Metadata } from "next";

import { CanadaPageBody } from "@/components/marketing/canada-page";
import { canadaFr } from "@/i18n/marketing/canada";
import { buildMetadata } from "@/lib/marketing/seo";

const PATH = "/fr/canada";

export const metadata: Metadata = buildMetadata({
  title: canadaFr.metaTitle,
  description: canadaFr.metaDescription,
  path: PATH,
});

/**
 * /fr/canada — the page a Quebec buyer is most likely to land on, in the
 * language they are most likely to read it in.
 *
 * Same body as /canada, same markup, different locale and different metadata.
 * The title and description come from the catalogue rather than being typed
 * here, so the page's words and its search snippet cannot say different things.
 */
export default function CanadaPageFr() {
  return <CanadaPageBody locale="fr-CA" />;
}
