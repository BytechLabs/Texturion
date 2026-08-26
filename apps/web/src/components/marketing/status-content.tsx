/**
 * The /status markup, as a pure function of the live feed (#242).
 *
 * Lives outside `page.tsx` because Next validates a page module's exports: a
 * named export that is not a recognised page export (`metadata`, `revalidate`,
 * …) fails route typegen with an unhelpful `{ [x: string]: never }` error. The
 * page stays a thin shell that reads KV and renders this.
 *
 * Split out for testing as much as for typegen. The gates have to be asserted
 * against every feed state — including the ones that only happen when something
 * is broken (no binding, KV unreachable, a garbled value) — and a test that can
 * only render the happy path cannot assert the failure direction, which is the
 * entire point of this page.
 */
import { CountryOnly } from "@/components/marketing/country";
import { FrCard, FrSection } from "@/components/marketing/fr";
import { StatusSubscribeCard } from "@/components/marketing/status-subscribe-card";
import { JsonLd } from "@/components/marketing/ui/json-ld";
import { SUPPORT_EMAIL } from "@/lib/marketing/business";
import { breadcrumbJsonLd } from "@/lib/marketing/seo";
import type { MarketingLocale } from "@/i18n/marketing/footer";
import { statusCopy } from "@/i18n/marketing/status";
import {
  formatConfirmedDisplay,
  type StatusFeed,
} from "@/lib/marketing/status-feed";

/**
 * When a report was last POSTED — not when the service was last checked.
 * #242: those are different facts and the page must not blur them.
 */
const LAST_POSTED = { iso: "2026-07-07" };

/** Posted incident reports, newest first. Empty means none to report. */
const INCIDENTS: {
  date: string;
  iso: string;
  title: string;
  body: string;
}[] = [];

const inlineLink =
  "font-medium text-[color:var(--fr-olive)] underline decoration-[color:var(--fr-olive)]/35 underline-offset-4 transition-colors duration-200 ease-out hover:decoration-[color:var(--fr-olive)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--fr-olive)]";

/**
 * The page's markup, as a pure function of the live feed.
 *
 * Split out so the QA gates can be tested directly against every feed state —
 * including the ones that only occur when something is broken (no binding, KV
 * unreachable, a garbled value). A test that can only render the happy path
 * cannot assert the failure direction, and the failure direction is the entire
 * point of this page.
 */
export function StatusContent({
  feed,
  canSubscribe = false,
  locale = "en",
}: {
  feed: StatusFeed;
  locale?: MarketingLocale;
  /**
   * #477: whether this worker can actually send the emails. False everywhere
   * the mailer or the KV binding is missing — local dev, a preview build, or
   * production before the secrets are set — and the card then does not render
   * at all. Defaulting to false is the same rule the rest of this page follows:
   * an affordance nothing backs must not appear, and a subscribe form that
   * silently drops addresses is the same lie as a green dot with no probe.
   */
  canSubscribe?: boolean;
}) {
  const copy = statusCopy(locale);
  const path = locale === "fr-CA" ? "/fr/etat-du-service" : "/status";
  const home = locale === "fr-CA" ? "/fr" : "/";
  const incident = feed.incident
    ? locale === "fr-CA"
      ? feed.incidentFr ?? copy.incidentFallback
      : feed.incident
    : null;
  return (
    <>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: copy.home, path: home },
          { name: copy.breadcrumb, path },
        ])}
      />
      <FrSection ground="white">
        <div className="mx-auto max-w-2xl">
          <h1 className="fr-h1 text-[color:var(--fr-ink)]">{copy.title}</h1>
          <p className="fr-body mt-4 text-[color:var(--fr-ink-70)]">
            {copy.intro}
          </p>
          {/* #242: the page is maintained by hand, and saying so is the
              difference between a quiet page and a misleading one. Without this,
              no report reads as a claim that nothing is wrong. */}
          <p className="fr-body mt-3 text-[color:var(--fr-ink-70)]">
            {copy.manualBefore}{" "}
            <a href={`mailto:${SUPPORT_EMAIL}`} className={inlineLink}>
              {copy.writeToUs}
            </a>
            . {copy.manualAfter}
          </p>

          {/* #242: the live line, ABOVE the historical card, because during an
              incident it is the only thing on the page anybody came for. Ink on
              a tinted ground rather than a colour-coded alert: colour here would
              be read as an operational indicator, and no probe backs it. */}
          {incident ? (
            <FrCard
              className="mt-10 border-[color:var(--fr-ink)]/15 bg-[color:var(--fr-ink)]/[0.04] p-6 sm:p-8"
              aria-live="polite"
            >
              <h2 className="fr-eyebrow text-[color:var(--fr-ink)]">
                {copy.happeningNow}
              </h2>
              <p className="fr-body mt-3 text-[color:var(--fr-ink)]">
                {incident}
              </p>
              <p className="mt-3 text-sm leading-relaxed text-[color:var(--fr-ink-70)]">
                {copy.happeningNote}
              </p>
            </FrCard>
          ) : null}

          <FrCard className="mt-10 p-6 sm:p-8">
            <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
              <h2 className="fr-eyebrow text-[color:var(--fr-ink)]">
                {copy.reports}
              </h2>
              <p className="fr-eyebrow text-[color:var(--fr-ink-55)]">
                {copy.lastPosted}{" "}
                <time dateTime={LAST_POSTED.iso}>{copy.lastPostedDisplay}</time>
              </p>
            </div>

            {INCIDENTS.length === 0 ? (
              <p className="fr-mono-data mt-6 text-[color:var(--fr-ink-70)]">
                {copy.nonePosted}
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
              {copy.reportsNote}
            </p>

            {/* #242 acceptance: state when status was last CONFIRMED, which is a
                different fact from when a report was last posted. The stale
                branch is the honest one and it is the default: a date is only
                offered as reassurance while it still is any. */}
            <p className="mt-4 text-sm leading-relaxed text-[color:var(--fr-ink-70)]">
              {feed.confirmedIso && !feed.confirmedIsStale ? (
                <>
                  {copy.confirmedBefore}{" "}
                  <time dateTime={feed.confirmedIso} className="fr-mono-data text-[0.8125rem]">
                    {formatConfirmedDisplay(feed.confirmedIso, locale)}
                  </time>
                  .
                </>
              ) : (
                <>
                  {copy.stale}
                </>
              )}
            </p>
          </FrCard>

          {/* #477: below the reports, not above them. Somebody who opened this
              page during an incident came for the incident; the offer to be
              told next time is worth making, and worth making second. */}
          {canSubscribe ? <StatusSubscribeCard locale={locale} /> : null}

          <div className="mt-12">
            <h2 className="fr-h3 text-[color:var(--fr-ink)]">
              {copy.outageHeading}
            </h2>
            <div className="mt-4 space-y-3 text-sm leading-relaxed text-[color:var(--fr-ink-70)]">
              <CountryOnly country="us">
                <p>
                  {copy.usApprovalBefore}{" "}
                  <span className="fr-mono-data text-[0.8125rem]">
                    {copy.usApprovalDays}
                  </span>{" "}
                  {copy.usApprovalAfter}
                </p>
              </CountryOnly>
              <CountryOnly country="ca">
                <p>
                  {copy.caApproval}
                </p>
              </CountryOnly>
              <p>
                {copy.carrier}
              </p>
              <p>
                {copy.brokenBefore}{" "}
                <a href={`mailto:${SUPPORT_EMAIL}`} className={inlineLink}>
                  {SUPPORT_EMAIL}
                </a>{" "}
                {copy.brokenAfter}
              </p>
            </div>
          </div>
        </div>
      </FrSection>
    </>
  );
}
