import type { Metadata } from "next";

import { StatusResultPage } from "@/components/marketing/status-result-page";
import { statusFr } from "@/i18n/marketing/status";
import { buildMetadata } from "@/lib/marketing/seo";

export const metadata: Metadata = {
  ...buildMetadata({
    title: statusFr.unsubscribedMetadataTitle,
    description: statusFr.unsubscribedMetadataDescription,
    path: "/fr/etat-du-service/desabonnement-confirme",
  }),
  robots: { index: false, follow: false },
};

export default function DesabonnementConfirmePage() {
  return <StatusResultPage locale="fr-CA" result="unsubscribed" />;
}
