import type { Metadata } from "next";

import { WHATS_NEW } from "@loonext/shared";

/*
 * #228 — the marketing site is English, deliberately and separately.
 *
 * `check-hardcoded-strings.mjs` skips this tree because it is its own
 * deliverable with its own URLs; the French marketing site is a different piece
 * of work. So the changelog's keys resolve against ENGLISH here rather than
 * against a reader whose language this page does not ask about.
 */
import { EN } from "@/i18n/catalog";

/**
 * The changelog's keys, said in English, on the server.
 *
 * NOT `sayEnglish` from the provider, and the difference is not stylistic: that
 * module is `"use client"`, so calling it from this server component fails the
 * build with "Attempted to call sayEnglish() from the server". `catalog.ts` is
 * plain data with no directive, so it is safe on either side.
 *
 * English on purpose. The marketing site is its own deliverable with its own
 * URLs — `check-hardcoded-strings.mjs` skips the whole tree — and this page
 * never asks the reader what language they want.
 */
const sayEnglish = (key: string): string => {
  const [section, name] = key.split(".");
  return (EN as unknown as Record<string, Record<string, string>>)[section]?.[name] ?? key;
};

import { FrCard, FrSection } from "@/components/marketing/fr";
import { Breadcrumbs } from "@/components/marketing/ui/breadcrumbs";
import { JsonLd } from "@/components/marketing/ui/json-ld";
import { Reveal } from "@/components/marketing/ui/reveal";
import {
  breadcrumbJsonLd,
  buildMetadata,
  type Breadcrumb,
} from "@/lib/marketing/seo";
import { LIVE_ROUTES } from "@/lib/marketing/site";

/**
 * #321 — /whats-new: what shipped, for the person paying for it.
 *
 * # Why a page and not just the in-app marker
 *
 * #321 asks for it "published where it can be linked from an email or a support
 * reply". That is the job: when somebody asks whether the product is still
 * being worked on, or when a fix they reported ships, there has to be a URL.
 *
 * # Why this is not the release-please changelog
 *
 * Those are per-app, generated from every `feat` and `fix`, and they are honest
 * developer history. A customer does not want history — they want to know the
 * thing they use got better, in a grain they can read in ten seconds. The
 * entries are curated in `packages/shared/src/whats-new.ts`, and being curated
 * is the feature: not every commit is news, and pretending otherwise trains
 * people to ignore it.
 *
 * # The honesty rule
 *
 * Entries report what SHIPPED. Never what is planned. A roadmap presented as
 * news is how a changelog loses credibility, and `whats-new.test.ts` fails on
 * the shapes that rule takes when broken.
 *
 * *Applying: the Safety Principle — a dated list, newest first, which is what
 * every changelog looks like and therefore what nobody has to learn. Zen of
 * Clarity — one line, two sentences, and a way in. No version numbers, no
 * categories, no filters over five items.*
 */

const PATH = LIVE_ROUTES.whatsNew;

export const metadata: Metadata = buildMetadata({
  title: "What's new",
  description:
    "What shipped in Loonext recently, in plain English: saved views, quote reporting, voicemail transcripts, calling in the app.",
  path: PATH,
});

/** "1 August 2026" — the form a customer reads, not an ISO stamp. */
function readableDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export default function WhatsNewPage() {
  const crumbs: Breadcrumb[] = [
    { name: "Home", path: "/" },
    { name: "What's new", path: PATH },
  ];

  return (
    <>
      <JsonLd data={breadcrumbJsonLd(crumbs)} />
      <FrSection>
        <div className="mx-auto max-w-3xl">
          <Breadcrumbs crumbs={crumbs} />
          <h1 className="fr-h1 mt-6 text-[color:var(--fr-ink)]">
            What&apos;s new
          </h1>
          <p className="fr-body mt-4 text-[color:var(--fr-ink-70)]">
            Everything here has already shipped and is in the product now. We
            do not list what we are planning: a roadmap dressed up as news is
            how a page like this stops being worth reading.
          </p>

          <ol className="mt-10 space-y-4">
            {WHATS_NEW.map((entry) => (
              <li key={`${entry.date}-${sayEnglish(entry.title)}`}>
                <Reveal>
                  <FrCard className="p-6">
                    <time
                      dateTime={entry.date}
                      className="text-[0.8125rem] font-medium tabular-nums text-[color:var(--fr-ink-70)]"
                    >
                      {readableDate(entry.date)}
                    </time>
                    <h2 className="fr-h3 mt-2 text-[color:var(--fr-ink)]">
                      {sayEnglish(entry.title)}
                    </h2>
                    <p className="mt-2 text-[0.9375rem] leading-relaxed text-[color:var(--fr-ink-70)]">
                      {sayEnglish(entry.body)}
                    </p>
                  </FrCard>
                </Reveal>
              </li>
            ))}
          </ol>

          <p className="mt-10 text-[0.9375rem] text-[color:var(--fr-ink-70)]">
            Smaller repairs ship most days and are not listed here. If you
            reported something and want to know where it got to, reply to the
            thread you reported it on and we will tell you.
          </p>
        </div>
      </FrSection>
    </>
  );
}
