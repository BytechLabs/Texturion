import type { Metadata } from "next";

import { WhatsNewPageBody } from "@/components/marketing/whats-new-page";
import { whatsNewFr } from "@/i18n/marketing/whats-new";
import { buildMetadata } from "@/lib/marketing/seo";

const PATH = "/fr/nouveautes";

export const metadata: Metadata = buildMetadata({
  title: whatsNewFr.metadataTitle,
  description: whatsNewFr.metadataDescription,
  path: PATH,
});

export default function NouveautesPage() {
  return <WhatsNewPageBody locale="fr-CA" />;
}
