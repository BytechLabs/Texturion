import type { Metadata } from "next";

import { StatusResultPage } from "@/components/marketing/status-result-page";
import { statusFr } from "@/i18n/marketing/status";
import { buildMetadata } from "@/lib/marketing/seo";

export const metadata: Metadata = {
  ...buildMetadata({
    title: statusFr.subscribedMetadataTitle,
    description: statusFr.subscribedMetadataDescription,
    path: "/fr/etat-du-service/abonnement-confirme",
  }),
  robots: { index: false, follow: false },
};

export default function AbonnementConfirmePage() {
  return <StatusResultPage locale="fr-CA" result="subscribed" />;
}
