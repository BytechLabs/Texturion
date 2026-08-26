import type { Metadata } from "next";

import { StatusPageBody } from "@/components/marketing/status-page";
import { statusFr } from "@/i18n/marketing/status";
import { buildMetadata } from "@/lib/marketing/seo";

const PATH = "/fr/etat-du-service";

export const metadata: Metadata = buildMetadata({
  title: statusFr.metadataTitle,
  description: statusFr.metadataDescription,
  path: PATH,
});

export const revalidate = 60;

export default function EtatDuServicePage() {
  return <StatusPageBody locale="fr-CA" />;
}
