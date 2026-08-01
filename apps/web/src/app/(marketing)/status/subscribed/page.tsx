import type { Metadata } from "next";

import { FrCard, FrSection } from "@/components/marketing/fr";
import { SUPPORT_EMAIL } from "@/lib/marketing/business";
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
    title: "You're subscribed",
    description: "You'll get an email when Loonext has a service incident.",
    path: "/status/subscribed",
  }),
  robots: { index: false, follow: false },
};

export default function StatusSubscribedPage() {
  return (
    <FrSection ground="white">
      <div className="mx-auto max-w-2xl">
        <h1 className="fr-h1 text-[color:var(--fr-ink)]">You&apos;re on the list.</h1>
        <FrCard className="mt-8 p-6 sm:p-8">
          <p className="fr-body text-[color:var(--fr-ink-70)]">
            We&apos;ll email you when there&apos;s a service incident, and again
            when it&apos;s resolved. Nothing else: no newsletter, no product
            announcements.
          </p>
          <p className="mt-4 text-sm leading-relaxed text-[color:var(--fr-ink-70)]">
            Every one of those emails has an unsubscribe link, and it works in
            one click with nothing to confirm. If you&apos;d rather we took you
            off now, email{" "}
            <a
              href={`mailto:${SUPPORT_EMAIL}`}
              className="font-medium text-[color:var(--fr-olive)] underline decoration-[color:var(--fr-olive)]/35 underline-offset-4"
            >
              {SUPPORT_EMAIL}
            </a>
            .
          </p>
        </FrCard>
      </div>
    </FrSection>
  );
}
