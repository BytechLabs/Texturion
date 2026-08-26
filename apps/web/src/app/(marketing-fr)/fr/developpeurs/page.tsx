import type { Metadata } from "next";

import { DevelopersPageBody } from "@/components/marketing/developers-page";
import { developersFr } from "@/i18n/marketing/developers";
import { buildMetadata } from "@/lib/marketing/seo";

const PATH = "/fr/developpeurs";

export const metadata: Metadata = buildMetadata({
  title: developersFr.metadataTitle,
  description: developersFr.metadataDescription,
  path: PATH,
});

export default function DeveloppeursPage() {
  return <DevelopersPageBody locale="fr-CA" />;
}
