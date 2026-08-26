import type { Metadata } from "next";

import { FrSection } from "@/components/marketing/fr";
import { UnsubscribeClient } from "@/components/marketing/unsubscribe-client";
import { unsubscribeEn } from "@/i18n/marketing/unsubscribe";
import { buildMetadata } from "@/lib/marketing/seo";

/**
 * #312 /unsubscribe — where the link in a commercial email lands.
 *
 * `noindex`: this page is meaningless without a token and exists for one person
 * holding one link. Letting a crawler index it would put a page that says "you are
 * unsubscribed" into search results for a list nobody can browse.
 *
 * No nav emphasis, no CTA, nothing that tries to change their mind. Somebody who
 * clicked unsubscribe has decided, and a page that argues is a page that earns a
 * spam report instead.
 */
export const metadata: Metadata = {
  ...buildMetadata({
    title: unsubscribeEn.metadataTitle,
    description: unsubscribeEn.metadataDescription,
    path: "/unsubscribe",
  }),
  robots: { index: false, follow: false },
};

export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  return (
    <FrSection>
      <UnsubscribeClient token={typeof token === "string" ? token : null} />
    </FrSection>
  );
}
