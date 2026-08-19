import type { Metadata } from "next";

import { TemplatesPageBody } from "@/components/marketing/templates-page";
import { templatesEn } from "@/i18n/marketing/templates";
import { buildMetadata } from "@/lib/marketing/seo";

const PATH = "/features/templates-and-tags";

export const metadata: Metadata = buildMetadata({
  title: templatesEn.metaTitle,
  description: templatesEn.metaDescription,
  path: PATH,
});

/** The English /features/templates-and-tags page. Body shared with /fr/modeles-etiquettes. */
export default function TemplatesAndTagsPage() {
  return <TemplatesPageBody locale="en" />;
}
