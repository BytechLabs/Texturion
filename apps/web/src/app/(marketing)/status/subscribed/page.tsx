import type { Metadata } from "next";

import { StatusResultPage } from "@/components/marketing/status-result-page";
import { statusEn } from "@/i18n/marketing/status";
import { buildMetadata } from "@/lib/marketing/seo";

/**
 * #477 — where the confirmation link lands.
 *
 * A plain static page rather than a query parameter on /status, which would
 * make that page render per-request and give up the edge cache the incident
 * line depends on (`revalidate = 60`). The redirect also takes the token out of
 * the address bar, and the token is also the unsubscribe token.
 *
 * `robots: noindex` because this page is only meaningful to the one person who
 * just clicked the link. It is not in LIVE_ROUTES either, so it stays out of
 * the sitemap.
 */
export const metadata: Metadata = {
  ...buildMetadata({
    title: statusEn.subscribedMetadataTitle,
    description: statusEn.subscribedMetadataDescription,
    path: "/status/subscribed",
  }),
  robots: { index: false, follow: false },
};

export default function StatusSubscribedPage() {
  return <StatusResultPage result="subscribed" />;
}
