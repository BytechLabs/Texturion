import type { Metadata } from "next";

import { StatusContent } from "@/components/marketing/status-content";
import { buildMetadata } from "@/lib/marketing/seo";
import { buildMailer } from "@/lib/marketing/status-mailer";
import { EMPTY_STATUS_FEED, readStatusFeed } from "@/lib/marketing/status-feed";
import {
  notifySubscribers,
  subscriptionsOpen,
  type SubscriberStore,
} from "@/lib/marketing/status-subscribe";

const PATH = "/status";


export const metadata: Metadata = buildMetadata({
  title: "Status",
  description:
    "Where Loonext publishes service status for texting, the inbox, and notifications: incident reports as they happen, plus the two things that can look like an outage but aren't.",
  path: PATH,
});

/**
 * STATUS (DESIGN-DIRECTION v4 §6 + owner amendment 11, binding): the page
 * renders NO operational indicators (no green dots, no gauges, no "all
 * systems operational") until it is wired to a real monitoring provider.
 * Until then it plainly states where status is published (this page), posts
 * incident reports as ops writes them, and explains the two conditions that
 * look like outages but aren't. QA gate 6: no green dot on /status while
 * unwired; Flare likewise appears nowhere here until it can be literal data.
 *
 * Ops posting flow: add an entry to INCIDENTS (newest first) and bump
 * LAST_UPDATED, then deploy. Nothing on this page pretends to be a probe.
 *
 * #242 — WHAT THIS PAGE DOES NOT CLAIM, said out loud rather than implied.
 *
 * "UPDATED <date>" was ambiguous in the one direction that matters. It is the
 * date somebody last EDITED this file, and a reader takes it as the date
 * somebody last CHECKED the service — so an eighteen-day-old date read as
 * eighteen days of confirmed health, when it actually meant nobody had touched
 * the page. During an incident that is worse than silence: the absence of a
 * report reads as an assertion that nothing is wrong.
 *
 * So the line now says what it is (when a report was last posted), and the page
 * states plainly that it is maintained by hand and is not a probe. A customer
 * who needs to know whether something is wrong RIGHT NOW is told to write to
 * support, which is a channel that does not share a failure domain with the
 * deploy pipeline this page does.
 *
 * #242, RESOLVED HALF: publishing while CI, the deploy pipeline and the API are
 * all broken. The live line comes from Cloudflare KV, which the founder edits
 * from the dashboard on a phone — no repo, no CI, no deploy, no API worker. See
 * `lib/marketing/status-feed.ts` for why KV and not a database table, and why
 * the value is plain text rather than JSON.
 *
 * The split follows the failure boundary, not the data shape: the KV line is the
 * URGENT half (one sentence, while things are broken), and INCIDENTS below is the
 * CONSIDERED half (the written record, added calmly afterward through a normal
 * deploy). Neither is a probe, so the no-indicator rule is untouched.
 */

/**
 * #242: a KV read per request would be a cost center on a page that gets linked
 * during an incident, so the edge caches it for a minute. That is the whole
 * trade: an incident line can be up to 60s stale, and in exchange a link storm
 * cannot turn our status page into a bill. Sixty seconds is far inside the
 * fifteen-minute first-message window `docs/INCIDENT-COMMS.md` §3 commits to.
 */
export const revalidate = 60;

/**
 * The page: read the live feed, then render.
 *
 * The binding is reached through `getCloudflareContext`, imported lazily so a
 * non-Workers context (vitest, `next build`'s prerender pass, a plain node
 * render) does not need it to exist. Anything that goes wrong here — no adapter,
 * no binding, KV unreachable — resolves to EMPTY_STATUS_FEED, which renders the
 * same page this was before the feed existed and says nobody has confirmed
 * anything. It cannot fail toward reassurance.
 */
export default async function StatusPage() {
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

    // #477: the fan-out rides on this render rather than a cron, because the
    // OpenNext worker entry is generated and has no `scheduled` handler to hang
    // one on. That is a smaller constraint than it looks: an incident line only
    // matters once somebody loads this page, this page is the first thing the
    // founder opens after editing KV, and `revalidate = 60` bounds how often
    // the check can run no matter how hard the page is hit. The send is
    // transition-only and marks before it sends, so a link storm cannot turn
    // into a mail storm.
    const mailer = buildMailer(bindings);
    if (bindings.STATUS_FEED && mailer) {
      canSubscribe = await subscriptionsOpen(bindings.STATUS_FEED);
      const store = bindings.STATUS_FEED;
      const work = notifySubscribers(store, mailer, feed.incident, new Date());
      // waitUntil so a reader never waits on our mail. Awaited when the runtime
      // has no waitUntil to give — dropping the promise there would abandon it
      // mid-flight, and this is the send that matters most.
      if (ctx?.waitUntil) ctx.waitUntil(work);
      else await work;
    }
  } catch {
    // Not on Workers, or the adapter is unavailable: the compiled-in page stands.
  }
  return <StatusContent feed={feed} canSubscribe={canSubscribe} />;
}
