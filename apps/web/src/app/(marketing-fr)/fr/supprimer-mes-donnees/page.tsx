import type { Metadata } from "next";

import { DeleteMyDataPageBody } from "@/components/marketing/legal/delete-my-data-page";
import { legalDeleteMyDataFr } from "@/i18n/marketing/legal-delete-my-data";
import { buildMetadata } from "@/lib/marketing/seo";

const PATH = "/fr/supprimer-mes-donnees";

export const metadata: Metadata = buildMetadata({
  title: legalDeleteMyDataFr.metaTitle,
  description: legalDeleteMyDataFr.metaDescription,
  path: PATH,
});

export default function DeleteMyDataPageFr() {
  return <DeleteMyDataPageBody locale="fr-CA" />;
}
