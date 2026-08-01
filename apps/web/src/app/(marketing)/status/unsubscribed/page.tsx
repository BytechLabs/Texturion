import type { Metadata } from "next";

import { FrCard, FrSection } from "@/components/marketing/fr";
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
    title: "Unsubscribed",
    description: "You're off the Loonext status email list.",
    path: "/status/unsubscribed",
  }),
  robots: { index: false, follow: false },
};

export default function StatusUnsubscribedPage() {
  return (
    <FrSection ground="white">
      <div className="mx-auto max-w-2xl">
        <h1 className="fr-h1 text-[color:var(--fr-ink)]">Unsubscribed.</h1>
        <FrCard className="mt-8 p-6 sm:p-8">
          <p className="fr-body text-[color:var(--fr-ink-70)]">
            You won&apos;t get status emails from us again. Your address is
            gone, not flagged.
          </p>
        </FrCard>
      </div>
    </FrSection>
  );
}
