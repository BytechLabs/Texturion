import type { MarketingLocale } from "@/i18n/marketing/footer";
import {
  EMPTY_STATUS_FEED,
  readStatusFeed,
  type StatusFeedStore,
} from "@/lib/marketing/status-feed";

import { StatusContent } from "./status-content";

/** Shared data-loading shell for the English and French status routes. */
export async function StatusPageBody({
  locale = "en",
}: {
  locale?: MarketingLocale;
}) {
  let feed = EMPTY_STATUS_FEED;
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const { env } = await getCloudflareContext({ async: true });
    feed = await readStatusFeed((env as { STATUS_FEED?: StatusFeedStore }).STATUS_FEED);
  } catch {
    // A missing adapter or binding must fail toward the honest static state.
  }

  return <StatusContent feed={feed} locale={locale} />;
}
