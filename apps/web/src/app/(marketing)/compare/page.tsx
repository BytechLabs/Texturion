/**
 * /compare, the comparison hub, v4 "FIRST RESPONSE" (DESIGN-DIRECTION §6
 * COMPARE template; COPY-DECK v2). Dateline Header (the arithmetic: 3 people,
 * 500 texts, July 2026) → the Honesty Ledger centerpiece (the same
 * four-column, per-cell-sourced table /pricing renders, imported from the
 * SAME module so the two pages can never disagree) → the three head-to-head
 * cards → the honest-fit section (what Loonext deliberately doesn't do: no
 * blasts, no review management, no full dialer) → switching Truth Strip →
 * CTA. No competitor logos, no dark patterns.
 *
 * JSON-LD: buildMetadata + a BreadcrumbList terminating on /compare itself.
 * Fully static. No em-dashes anywhere in rendered text (Law 6).
 */

import Link from "next/link";
import type { Metadata } from "next";

import { CountryOnly } from "@/components/marketing/country";
import {
  CompareCta,
  CompareHero,
  LedgerBand,
  SwitchBand,
} from "@/components/marketing/compare/compare-sections";
import { LedgerTable } from "@/components/marketing/compare/ledger-table";
import { FrCard, FrSection } from "@/components/marketing/fr";
import { Reveal } from "@/components/marketing/ui/reveal";
import { JsonLd } from "@/components/marketing/ui/json-ld";
import {
  ELSEWHERE_COLUMNS,
  ELSEWHERE_FOOTNOTE,
  ELSEWHERE_ROWS,
} from "@/app/(marketing)/pricing/pricing-data";
import { breadcrumbJsonLd, buildMetadata } from "@/lib/marketing/seo";
import { LIVE_ROUTES } from "@/lib/marketing/site";

const PATH = LIVE_ROUTES.compareIndex;

export const metadata: Metadata = buildMetadata({
  title: "Compare Loonext: the same crew, priced elsewhere",
  description:
    "Loonext next to Heymarket and Quo for a 3-person crew sending 500 texts a month: every competitor price dated July 2026 and sourced from their own pricing page, and every place they fit better named outright.",
  path: PATH,
});

/** The two head-to-heads, each led by its page's own load-bearing fact. */
const CARDS = [
  {
    competitor: "Heymarket",
    href: LIVE_ROUTES.compareHeymarket,
    fact: "$49/user/mo · their published Starter seat",
    angle:
      "An enterprise-grade shared inbox with SOC 2, a HIPAA BAA, and email, priced per user with a two-seat minimum and texts billed on top.",
  },
  {
    competitor: "Quo",
    href: LIVE_ROUTES.compareQuo,
    fact: "$19/user/mo + 1¢/text",
    angle:
      "A full business phone system (formerly OpenPhone) with calling included, billed per user, texting metered by the segment.",
  },
] as const;

export default function CompareIndexPage() {
  return (
    <>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Home", path: "/" },
          { name: "Compare", path: PATH },
        ])}
      />

      <CompareHero
        dateline="3 PEOPLE · 500 TEXTS · JULY 2026"
        title="The same crew, priced elsewhere."
        lead="One 3-person crew sending 500 texts a month, priced at Loonext and at the two tools you're most likely weighing it against. Every competitor number is dated, comes from their own public pricing page, and is sourced cell by cell on the matching head-to-head page, where we also say when the other tool fits you better."
      />

      <LedgerBand
        heading="Three pricing pages, one table."
        lead="This is the same table our pricing page shows, rendered from the same data, so the two can never quietly disagree."
        footnote={ELSEWHERE_FOOTNOTE}
      >
        <LedgerTable
          caption="Monthly cost for a 3-person crew sending 500 texts: Loonext next to Heymarket and Quo, at published prices as of July 2026."
          columns={ELSEWHERE_COLUMNS}
          rows={ELSEWHERE_ROWS}
        />
      </LedgerBand>

      {/* The three head-to-heads. */}
      <FrSection>
        <div className="mx-auto max-w-5xl">
          <h2 className="fr-h2 text-[color:var(--fr-ink)]">
            Pick the one you&apos;re deciding between.
          </h2>
          <p className="fr-body mt-4 max-w-2xl text-[color:var(--fr-ink-70)]">
            Each page carries the full sourced ledger, the crew-size math, and
            a plain section on when that tool is the better buy.
          </p>
          <div className="mt-10 grid gap-6 md:grid-cols-2">
            {CARDS.map((card, i) => (
              <Reveal key={card.href} delay={Math.min(i, 3) * 60} className="h-full">
                <FrCard className="h-full p-0">
                  <Link
                    href={card.href}
                    className="flex h-full flex-col rounded-[12px] p-6 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--fr-cobalt)]"
                  >
                    <span className="fr-eyebrow inline-flex w-fit items-center rounded-[6px] bg-[color:var(--fr-frost)] px-2.5 py-1.5 text-[color:var(--fr-ink)]">
                      {card.fact}
                    </span>
                    <span className="fr-h3 mt-4 block text-[color:var(--fr-ink)]">
                      Loonext vs {card.competitor}
                    </span>
                    <span className="mt-2 block flex-1 text-[0.9375rem] leading-relaxed text-[color:var(--fr-ink-70)]">
                      {card.angle}
                    </span>
                    <span className="mt-4 inline-flex items-center gap-1 text-[0.9375rem] font-semibold text-[color:var(--fr-cobalt)]">
                      See the comparison
                      <span aria-hidden>→</span>
                    </span>
                  </Link>
                </FrCard>
              </Reveal>
            ))}
          </div>
        </div>
      </FrSection>

      {/* The honest-fit section: what Loonext deliberately doesn't do. */}
      <FrSection ground="frost">
        <div className="mx-auto max-w-4xl">
          <h2 className="fr-h2 text-[color:var(--fr-ink)]">
            What Loonext doesn&apos;t do, on purpose.
          </h2>
          <p className="fr-body mt-4 max-w-2xl text-[color:var(--fr-ink-70)]">
            Loonext is a shared text inbox at a flat price, and holding that
            line means leaving real capabilities to the bigger platforms. If
            one of these is the job, the head-to-head pages name the tool that
            does it.
          </p>
          <div className="mt-10 grid gap-6 md:grid-cols-3">
            {[
              {
                title: "No mass text blasts.",
                body: "Loonext is for conversations with your customers, not campaigns at them. If you need list broadcasts, Heymarket and the marketing-texting tools do that.",
              },
              {
                title: "No review management.",
                body: "We don't chase Google reviews. That's Podium's home turf, and if reviews are load-bearing for you, it's the better buy.",
              },
              {
                title: "No full dialer.",
                body: "Loonext can't place calls. The $8/mo call-forwarding add-on rings your cell and texts back the calls you miss, but a phone-first business belongs on Quo.",
              },
            ].map((point) => (
              <Reveal key={point.title} className="h-full">
                <FrCard className="h-full p-6">
                  <h3 className="fr-h3 text-[color:var(--fr-ink)]">
                    {point.title}
                  </h3>
                  <p className="mt-2 text-[0.9375rem] leading-relaxed text-[color:var(--fr-ink-70)]">
                    {point.body}
                  </p>
                </FrCard>
              </Reveal>
            ))}
          </div>
        </div>
      </FrSection>

      {/* The switch band's country-specific lines (the money-back fee clause
          and the activation timeline) split so a US visitor reads the carrier
          wait and a Canadian reads the day-one story, never both. */}
      <CountryOnly country="us">
        <SwitchBand
          heading="Whatever you run today, switching is small."
          lead="Loonext sits comfortably next to your current tool while you move: sign up, pick or transfer a number, invite the crew by link, and shift the texting at your own pace."
          items={[
            {
              text: "Keep your number: transfers are free, self-serve at signup or later, and typically take 1 to 7 business days.",
              good: true,
            },
            {
              text: "Your number keeps working on your current provider until the scheduled switch.",
              good: true,
            },
            {
              text: "Month to month, with a 30-day full money-back guarantee, registration fee included.",
              good: true,
            },
            {
              text: "Receiving texts work day one; texting US numbers turns on once the phone companies approve you, typically 3 to 7 business days.",
            },
          ]}
        />
      </CountryOnly>
      <CountryOnly country="ca">
        <SwitchBand
          heading="Whatever you run today, switching is small."
          lead="Loonext sits comfortably next to your current tool while you move: sign up, pick or transfer a number, invite the crew by link, and shift the texting at your own pace."
          items={[
            {
              text: "Keep your number: transfers are free, self-serve at signup or later, and typically take 1 to 7 business days.",
              good: true,
            },
            {
              text: "Your number keeps working on your current provider until the scheduled switch.",
              good: true,
            },
            {
              text: "Month to month, with a 30-day full money-back guarantee.",
              good: true,
            },
            {
              text: "Texting Canadian customers works the day you sign up, with no registration to wait on. Receiving texts work day one too.",
              good: true,
            },
          ]}
        />
      </CountryOnly>

      <CompareCta
        heading="Skip the demo. See the price and start today."
        sub="A shared text inbox for the whole crew, $29 a month flat, month to month, with a full refund in your first 30 days if it's not for you."
      />
    </>
  );
}
