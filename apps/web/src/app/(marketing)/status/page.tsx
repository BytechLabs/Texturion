import type { Metadata } from "next";

import { FrCard, FrSection } from "@/components/marketing/fr";
import { JsonLd } from "@/components/marketing/ui/json-ld";
import { SUPPORT_EMAIL } from "@/lib/marketing/business";
import { breadcrumbJsonLd, buildMetadata } from "@/lib/marketing/seo";

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
 */

/** Bump whenever the reports below change. Mono, load-bearing. */
const LAST_UPDATED = { display: "JULY 7, 2026", iso: "2026-07-07" };

/** Posted incident reports, newest first. Empty means none to report. */
const INCIDENTS: {
  date: string;
  iso: string;
  title: string;
  body: string;
}[] = [];

const inlineLink =
  "font-medium text-[color:var(--fr-cobalt)] underline decoration-[color:var(--fr-cobalt)]/35 underline-offset-4 transition-colors duration-200 ease-out hover:decoration-[color:var(--fr-cobalt)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--fr-cobalt)]";

export default function StatusPage() {
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

          <FrCard className="mt-10 p-6 sm:p-8">
            <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
              <h2 className="fr-eyebrow text-[color:var(--fr-ink)]">
                Incident reports
              </h2>
              <p className="fr-eyebrow text-[color:var(--fr-ink-55)]">
                UPDATED{" "}
                <time dateTime={LAST_UPDATED.iso}>{LAST_UPDATED.display}</time>
              </p>
            </div>

            {INCIDENTS.length === 0 ? (
              <p className="fr-mono-data mt-6 text-[color:var(--fr-ink-70)]">
                No incidents to report.
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
          </FrCard>

          <div className="mt-12">
            <h2 className="fr-h3 text-[color:var(--fr-ink)]">
              Looks like an outage, usually isn&apos;t
            </h2>
            <div className="mt-4 space-y-3 text-sm leading-relaxed text-[color:var(--fr-ink-70)]">
              <p>
                US texting activates after carrier approval, typically{" "}
                <span className="fr-mono-data text-[0.8125rem]">3 to 7</span>{" "}
                business days after you pay. If your US texts aren&apos;t
                sending yet, that&apos;s the approval wait, not an outage;
                receiving texts and texting Canadian numbers work the whole
                time.
              </p>
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
