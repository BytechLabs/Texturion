import type { Metadata } from "next";

import { TemplatesPageBody } from "@/components/marketing/templates-page";
import { templatesFr } from "@/i18n/marketing/templates";
import { buildMetadata } from "@/lib/marketing/seo";

const PATH = "/fr/modeles-etiquettes";

export const metadata: Metadata = buildMetadata({
  title: templatesFr.metaTitle,
  description: templatesFr.metaDescription,
  path: PATH,
});

/** /fr/modeles-etiquettes — no accent in the slug, so it survives a keyboard. */
export default function TemplatesPageFr() {
  return <TemplatesPageBody locale="fr-CA" />;
}
