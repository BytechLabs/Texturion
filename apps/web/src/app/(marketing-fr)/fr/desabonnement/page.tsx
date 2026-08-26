import type { Metadata } from "next";

import { FrSection } from "@/components/marketing/fr";
import { UnsubscribeClient } from "@/components/marketing/unsubscribe-client";
import { unsubscribeFr } from "@/i18n/marketing/unsubscribe";
import { buildMetadata } from "@/lib/marketing/seo";

export const metadata: Metadata = {
  ...buildMetadata({
    title: unsubscribeFr.metadataTitle,
    description: unsubscribeFr.metadataDescription,
    path: "/fr/desabonnement",
  }),
  robots: { index: false, follow: false },
};

export default async function DesabonnementPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  return (
    <FrSection>
      <UnsubscribeClient
        token={typeof token === "string" ? token : null}
        locale="fr-CA"
      />
    </FrSection>
  );
}
