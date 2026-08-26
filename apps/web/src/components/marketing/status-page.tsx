import type { MarketingLocale } from "@/i18n/marketing/footer";
import { buildMailer } from "@/lib/marketing/status-mailer";
import { EMPTY_STATUS_FEED, readStatusFeed } from "@/lib/marketing/status-feed";
import {
  notifySubscribers,
  subscriptionsOpen,
  type SubscriberStore,
} from "@/lib/marketing/status-subscribe";

import { StatusContent } from "./status-content";

/** Shared data-loading shell for the English and French status routes. */
export async function StatusPageBody({
  locale = "en",
}: {
  locale?: MarketingLocale;
}) {
  let feed = EMPTY_STATUS_FEED;
  let canSubscribe = false;
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const { env, ctx } = await getCloudflareContext({ async: true });
    const bindings = env as {
      STATUS_FEED?: SubscriberStore;
      RESEND_API_KEY?: string;
      RESEND_FROM?: string;
    };
    feed = await readStatusFeed(bindings.STATUS_FEED);

    const mailer = buildMailer(bindings);
    if (bindings.STATUS_FEED && mailer) {
      canSubscribe = await subscriptionsOpen(bindings.STATUS_FEED);
      const work = notifySubscribers(
        bindings.STATUS_FEED,
        mailer,
        { en: feed.incident, "fr-CA": feed.incidentFr },
        new Date(),
      );
      if (ctx?.waitUntil) ctx.waitUntil(work);
      else await work;
    }
  } catch {
    // A missing adapter or binding must fail toward the honest static state.
  }

  return (
    <StatusContent
      feed={feed}
      canSubscribe={canSubscribe}
      locale={locale}
    />
  );
}
