import type { Metadata } from "next";

import { StatusResultPage } from "@/components/marketing/status-result-page";
import { statusEn } from "@/i18n/marketing/status";
import { buildMetadata } from "@/lib/marketing/seo";

/**
 * #477 — where the unsubscribe link lands.
 *
 * States one fact and offers no way back in. A page that answers "are you
 * sure?", or that puts a resubscribe button under the confirmation, is a page
 * arguing with somebody who already decided — and the exit from a mailing list
 * is the single place in this product where friction is unambiguously wrong.
 * /status is linked in the footer for anyone who changes their mind later.
 *
 * `robots: noindex`, and absent from LIVE_ROUTES, so it stays out of the
 * sitemap.
 */
export const metadata: Metadata = {
  ...buildMetadata({
    title: statusEn.unsubscribedMetadataTitle,
    description: statusEn.unsubscribedMetadataDescription,
    path: "/status/unsubscribed",
  }),
  robots: { index: false, follow: false },
};

export default function StatusUnsubscribedPage() {
  return <StatusResultPage result="unsubscribed" />;
}
