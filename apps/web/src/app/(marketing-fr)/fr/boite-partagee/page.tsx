import type { Metadata } from "next";

import { SharedInboxPageBody } from "@/components/marketing/shared-inbox-page";
import { sharedInboxFr } from "@/i18n/marketing/shared-inbox";
import { buildMetadata } from "@/lib/marketing/seo";

const PATH = "/fr/boite-partagee";

export const metadata: Metadata = buildMetadata({
  title: sharedInboxFr.metaTitle,
  description: sharedInboxFr.metaDescription,
  path: PATH,
});

/**
 * /fr/boite-partagee — the product's central claim, in French.
 *
 * The slug is translated for the reason /fr/taches is: a Quebec crew searches
 * for a "boîte partagée", not a "shared inbox". Written without the circumflex
 * so the URL survives a phone keyboard and a mail client.
 */
export default function SharedInboxPageFr() {
  return <SharedInboxPageBody locale="fr-CA" />;
}
