import type { Metadata } from "next";

import { CountryOnly } from "@/components/marketing/country";
import { FrCard, FrSection } from "@/components/marketing/fr";
import { JsonLd } from "@/components/marketing/ui/json-ld";
import { SUPPORT_EMAIL } from "@/lib/marketing/business";
import { breadcrumbJsonLd, buildMetadata } from "@/lib/marketing/seo";
import {
  EMPTY_STATUS_FEED,
  formatConfirmedDisplay,
  readStatusFeed,
  type StatusFeed,
} from "@/lib/marketing/status-feed";

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
 * When a report was last POSTED — not when the service was last checked.
 * #242: those are different facts and the page must not blur them.
 */
const LAST_POSTED = { display: "JULY 7, 2026", iso: "2026-07-07" };

/** Posted incident reports, newest first. Empty means none to report. */
const INCIDENTS: {
  date: string;
  iso: string;
  title: string;
  body: string;
}[] = [];

const inlineLink =
  "font-medium text-[color:var(--fr-cobalt)] underline decoration-[color:var(--fr-cobalt)]/35 underline-offset-4 transition-colors duration-200 ease-out hover:decoration-[color:var(--fr-cobalt)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--fr-cobalt)]";

/**
 * The page's markup, as a pure function of the live feed.
 *
 * Split out so the QA gates can be tested directly against every feed state —
 * including the ones that only occur when something is broken (no binding, KV
 * unreachable, a garbled value). A test that can only render the happy path
 * cannot assert the failure direction, and the failure direction is the entire
 * point of this page.
 */
export function StatusContent({ feed }: { feed: StatusFeed }) {
  return (
    <>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Home", path: "/" },
          { name: "Status", path: PATH },
        ])}
      />
      <FrSection ground="white">
        <div className="mx-auto max-w-2xl">
          <h1 className="fr-h1 text-[color:var(--fr-ink)]">Status.</h1>
          <p className="fr-body mt-4 text-[color:var(--fr-ink-70)]">
            Service status for texting, the inbox, and notifications is
            published on this page.
          </p>
          {/* #242: the page is maintained by hand, and saying so is the
              difference between a quiet page and a misleading one. Without this,
              no report reads as a claim that nothing is wrong. */}
          <p className="fr-body mt-3 text-[color:var(--fr-ink-70)]">
            This page is written by a person, not by an automatic monitor, so it
            shows what we have posted rather than a live reading. If something
            looks wrong to you right now and there is nothing here about it,{" "}
            <a href={`mailto:${SUPPORT_EMAIL}`} className={inlineLink}>
              write to us
            </a>
            . That reaches us whether or not this page has caught up.
          </p>

          {/* #242: the live line, ABOVE the historical card, because during an
              incident it is the only thing on the page anybody came for. Ink on
              a tinted ground rather than a colour-coded alert: colour here would
              be read as an operational indicator, and no probe backs it. */}
          {feed.incident ? (
            <FrCard
              className="mt-10 border-[color:var(--fr-ink)]/15 bg-[color:var(--fr-ink)]/[0.04] p-6 sm:p-8"
              aria-live="polite"
            >
              <h2 className="fr-eyebrow text-[color:var(--fr-ink)]">
                Happening now
              </h2>
              <p className="fr-body mt-3 text-[color:var(--fr-ink)]">
                {feed.incident}
              </p>
              <p className="mt-3 text-sm leading-relaxed text-[color:var(--fr-ink-70)]">
                Written by hand as we learn more. A full report goes below once
                it&apos;s resolved.
              </p>
            </FrCard>
          ) : null}

          <FrCard className="mt-10 p-6 sm:p-8">
            <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
              <h2 className="fr-eyebrow text-[color:var(--fr-ink)]">
                Incident reports
              </h2>
              <p className="fr-eyebrow text-[color:var(--fr-ink-55)]">
                LAST POSTED{" "}
                <time dateTime={LAST_POSTED.iso}>{LAST_POSTED.display}</time>
              </p>
            </div>

            {INCIDENTS.length === 0 ? (
              <p className="fr-mono-data mt-6 text-[color:var(--fr-ink-70)]">
                No incidents posted.
              </p>
            ) : (
              <ul className="mt-6 space-y-6">
                {INCIDENTS.map((incident) => (
                  <li key={`${incident.iso}-${incident.title}`}>
                    <p className="fr-mono-data text-[0.8125rem] text-[color:var(--fr-ink-55)]">
                      <time dateTime={incident.iso}>{incident.date}</time>
                    </p>
                    <p className="mt-1 font-semibold text-[color:var(--fr-ink)]">
                      {incident.title}
                    </p>
                    <p className="mt-1 text-sm leading-relaxed text-[color:var(--fr-ink-70)]">
                      {incident.body}
                    </p>
                  </li>
                ))}
              </ul>
            )}

            <p className="mt-6 text-sm leading-relaxed text-[color:var(--fr-ink-70)]">
              When texting, the inbox, or notifications have a problem, the
              report goes here: what&apos;s affected, what we know, and when
              it&apos;s resolved.
            </p>

            {/* #242 acceptance: state when status was last CONFIRMED, which is a
                different fact from when a report was last posted. The stale
                branch is the honest one and it is the default: a date is only
                offered as reassurance while it still is any. */}
            <p className="mt-4 text-sm leading-relaxed text-[color:var(--fr-ink-70)]">
              {feed.confirmedIso && !feed.confirmedIsStale ? (
                <>
                  A person last checked texting, the inbox and notifications on{" "}
                  <time dateTime={feed.confirmedIso} className="fr-mono-data text-[0.8125rem]">
                    {formatConfirmedDisplay(feed.confirmedIso)}
                  </time>
                  .
                </>
              ) : (
                <>
                  Nobody has checked recently enough for us to tell you the
                  service is fine right now, and we would rather say that than
                  show you a date that answers a different question. If something
                  looks wrong to you, write to us.
                </>
              )}
            </p>
          </FrCard>

          <div className="mt-12">
            <h2 className="fr-h3 text-[color:var(--fr-ink)]">
              Looks like an outage, usually isn&apos;t
            </h2>
            <div className="mt-4 space-y-3 text-sm leading-relaxed text-[color:var(--fr-ink-70)]">
              <CountryOnly country="us">
                <p>
                  US texting activates after carrier approval, typically{" "}
                  <span className="fr-mono-data text-[0.8125rem]">3 to 7</span>{" "}
                  business days after you pay. If your US texts aren&apos;t
                  sending yet, that&apos;s the approval wait, not an outage;
                  receiving texts work the whole time.
                </p>
              </CountryOnly>
              <CountryOnly country="ca">
                <p>
                  Texting Canadian customers works the same day your number is
                  active, with no registration to wait on, so there&apos;s no
                  approval delay to mistake for an outage. Receiving texts work
                  right away too.
                </p>
              </CountryOnly>
              <p>
                Delivery depends on the phone companies and carriers, which we
                don&apos;t control. When they have trouble, texts can be
                delayed even though Loonext is up.
              </p>
              <p>
                Seeing something broken that this page doesn&apos;t mention?
                Email{" "}
                <a href={`mailto:${SUPPORT_EMAIL}`} className={inlineLink}>
                  {SUPPORT_EMAIL}
                </a>{" "}
                and a person will take a look.
              </p>
            </div>
          </div>
        </div>
      </FrSection>
    </>
  );
}

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
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const { env } = await getCloudflareContext({ async: true });
    feed = await readStatusFeed(
      (env as { STATUS_FEED?: { get(key: string): Promise<string | null> } })
        .STATUS_FEED,
    );
  } catch {
    // Not on Workers, or the adapter is unavailable: the compiled-in page stands.
  }
  return <StatusContent feed={feed} />;
}
