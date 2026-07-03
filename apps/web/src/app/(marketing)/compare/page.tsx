/**
 * /compare, the comparison index (BLUEPRINT §6, §11). The landing page the
 * "Compare" breadcrumb crumb points at, and a real hub the three head-to-head
 * pages link back to instead of being orphaned deep links.
 *
 * Content: a composed "Caught" hero over a real duotone photo, three cards
 * linking to the sourced comparisons (Podium / Heymarket / Quo, each with its
 * honest one-line "who it's for"), the flat-vs-per-seat "at a glance" chart, an
 * honesty-method trust block, and the one deep-petrol close. buildMetadata + a
 * BreadcrumbList that terminates on /compare itself; NO FAQPage (§11.2).
 */

import Link from "next/link";
import { ArrowRight, Building2, Scale } from "lucide-react";
import type { Metadata } from "next";

import { Button } from "@/components/ui/button";
import { Container } from "@/components/marketing/ui/container";
import { JsonLd } from "@/components/marketing/ui/json-ld";
import { Reveal } from "@/components/marketing/ui/reveal";
import { Section } from "@/components/marketing/ui/section";
import { Display, MarkerCheck } from "@/components/marketing/display";
import { ArrowLink } from "@/components/marketing/ledger/arrow-link";
import { CrewSizeSliderStatic } from "@/components/marketing/interactive/crew-size-slider-static";
import { Photo } from "@/components/marketing/photo";
import { breadcrumbJsonLd, buildMetadata } from "@/lib/marketing/seo";

const PATH = "/compare";

export const metadata: Metadata = buildMetadata({
  title: "Compare JobText: honest, dated side-by-sides",
  description:
    "See how JobText's flat $29/mo shared text inbox stacks up against Podium, Heymarket, and Quo, every competitor price dated and sourced, every trade-off stated plainly.",
  path: PATH,
});

interface CompareCard {
  competitor: string;
  href: string;
  /** The honest, benefit-first one-liner (matches each page's positioning). */
  angle: string;
  /** The single dated head-to-head fact that sells the click. */
  fact: string;
}

const CARDS: CompareCard[] = [
  {
    competitor: "Podium",
    href: "/compare/podium",
    angle:
      "An all-in-one platform with reviews, payments, and AI call answering, sold through a demo, on an annual term.",
    fact: "$29/mo, on the page vs. reported ~$399/mo, quote required",
  },
  {
    competitor: "Heymarket",
    href: "/compare/heymarket",
    angle:
      "An enterprise-grade shared inbox with SOC 2, a HIPAA BAA, and email, priced per user with a two-seat minimum.",
    fact: "$29 flat for the crew vs. $49/user, texts billed on top",
  },
  {
    competitor: "Quo",
    href: "/compare/quo",
    angle:
      "A full business phone system (formerly OpenPhone) with calling included, billed per user, texting metered.",
    fact: "Flat, texting included vs. $15 to 19/user, texting per segment",
  },
];

export default function CompareIndexPage() {
  return (
    <>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Home", path: "/" },
          { name: "Compare", path: PATH },
        ])}
      />

      {/* Hero: composed "Caught" headline over a real duotone photo. */}
      <section className="relative overflow-hidden pb-14 pt-28 sm:pb-20 sm:pt-32">
        <Container>
          <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)] lg:gap-16">
            <div>
              <p className="font-mono-mkt flex items-center gap-2.5 text-[13px] font-medium tracking-[0.04em] text-[color:var(--graphite)]">
                <span aria-hidden className="h-px w-6 bg-[color:var(--petrol)]/50" />
                <Scale className="size-4 text-[color:var(--petrol)]" strokeWidth={1.75} aria-hidden />
                Honest comparisons
              </p>
              <Display as="h1" size="hero" className="mt-5 text-balance">
                How JobText compares, with the price{" "}
                <Display.Mark>on the page</Display.Mark>.
              </Display>
              <p className="mt-6 max-w-xl text-lg leading-relaxed text-[color:var(--ink-70)]">
                We put JobText next to the tools you&apos;re weighing it against
                and tell the truth about both, every competitor number dated and
                sourced, every place they beat us named outright. JobText is a
                shared text inbox at one flat price:{" "}
                <span className="font-mono-mkt text-[color:var(--petrol)]">
                  $29
                </span>{" "}
                a month for the whole crew, month to month, no sales call in the
                way.
              </p>
              <div className="mt-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-6">
                <Button asChild size="lg" className="w-full sm:w-auto">
                  <Link href="/signup">
                    Start for $29
                    <ArrowRight strokeWidth={1.75} aria-hidden />
                  </Link>
                </Button>
                <ArrowLink href="/pricing">See pricing</ArrowLink>
              </div>
            </div>
            <Reveal className="relative">
              <figure className="overflow-hidden rounded-2xl border border-[color:var(--hairline)] bg-[color:var(--paper-2)] shadow-[0_24px_64px_-32px_rgba(11,79,73,0.25)]">
                <Photo
                  id="texting-hands"
                  priority
                  sizes="(min-width: 1024px) 30rem, 100vw"
                  imgClassName="aspect-[4/3] object-cover"
                />
                <figcaption className="border-t border-[color:var(--hairline)] px-5 py-4 text-[13px] leading-relaxed text-[color:var(--ink-70)]">
                  The tool your customers already reach for. We just make the
                  business side of it shared, simple, and flat-priced.
                </figcaption>
              </figure>
            </Reveal>
          </div>
        </Container>
      </section>

      {/* The three comparisons, cards linking to each sourced page. */}
      <Section>
        <div className="mx-auto max-w-5xl">
          <Display as="h2" size="h2" className="max-w-3xl">
            Pick the one you&apos;re deciding between.
          </Display>
          <p className="mt-5 max-w-2xl text-lg leading-relaxed text-[color:var(--ink-70)]">
            Three head-to-head breakdowns, each with a dated pricing table, a
            &ldquo;who each is really for,&rdquo; and where the other tool
            genuinely wins.
          </p>
          <div className="mt-10 grid gap-6 md:grid-cols-3">
            {CARDS.map((card, i) => (
              <Reveal key={card.href} delay={Math.min(i, 3) * 60}>
                <Link
                  href={card.href}
                  className="group flex h-full flex-col rounded-2xl border border-[color:var(--hairline)] bg-[color:var(--paper-2)] p-6 transition-colors hover:border-[color:var(--petrol)]/40"
                >
                  <span className="flex size-10 items-center justify-center rounded-xl bg-[color:var(--petrol-12)] text-[color:var(--petrol)]">
                    <Building2 className="size-5" strokeWidth={1.75} aria-hidden />
                  </span>
                  <h3 className="mt-4 text-lg font-semibold text-[color:var(--ink)]">
                    JobText vs {card.competitor}
                  </h3>
                  <p className="mt-2 flex-1 text-[15px] leading-relaxed text-[color:var(--ink-70)]">
                    {card.angle}
                  </p>
                  <p className="font-mono-mkt mt-4 border-t border-[color:var(--hairline)] pt-4 text-[13px] font-medium tabular-nums text-[color:var(--ink)]">
                    {card.fact}
                  </p>
                  <span className="mt-4 inline-flex items-center gap-1 text-[14px] font-medium text-[color:var(--petrol)]">
                    See the comparison
                    <ArrowRight
                      className="size-4 transition-transform group-hover:translate-x-0.5"
                      strokeWidth={1.75}
                      aria-hidden
                    />
                  </span>
                </Link>
              </Reveal>
            ))}
          </div>
        </div>
      </Section>

      {/* "At a glance" visual, flat vs per-seat (the mandated compare visual).
          Ground change to the half-step-lighter panel. */}
      <Section bleed className="bg-[color:var(--paper-2)] py-16 sm:py-24">
        <Container>
          <div className="mx-auto max-w-4xl">
            <div className="mx-auto max-w-2xl text-center">
              <Display as="h2" size="h2">
                The whole story, at a glance.
              </Display>
              <p className="mt-5 text-lg leading-relaxed text-[color:var(--ink-70)]">
                Most of the tools above bill per user. JobText is flat, $29 up to
                three people, $79 up to ten. The more your crew grows, the wider
                the gap. Here&apos;s a flat line against a typical per-user tool
                as the team scales.
              </p>
            </div>
            <Reveal className="mx-auto mt-10 max-w-xl">
              <CrewSizeSliderStatic />
            </Reveal>
            <p className="mx-auto mt-4 max-w-2xl text-center text-[13px] leading-relaxed text-[color:var(--ink-70)]">
              Per-user line: $19/user/mo, a published seat price as of July 2026;
              the exact, sourced math is on the{" "}
              <Link
                href="/compare/quo"
                className="font-medium text-[color:var(--petrol)] underline-offset-2 hover:underline"
              >
                Quo comparison
              </Link>
              .
            </p>
          </div>
        </Container>
      </Section>

      {/* What every comparison shares, the honesty method, as trust proof. */}
      <Section>
        <div className="mx-auto max-w-3xl">
          <h2 className="font-display text-[26px] font-bold leading-tight tracking-[-0.01em] text-[color:var(--ink)] sm:text-[30px]">
            How we compare, and why you can trust it.
          </h2>
          <ul className="mt-8 space-y-4">
            {[
              "Every competitor price is dated and sourced from their own public pricing page, we re-verify it each time we touch the page.",
              "We recommend the other tool outright for the buyer it fits better. If you need calling, reviews, or SOC 2, we say so.",
              "No fake logos, no invented stats, no scraped screenshots, just the numbers, in writing, next to ours.",
            ].map((point) => (
              <li key={point} className="flex gap-3">
                <MarkerCheck
                  color="petrol"
                  draw={false}
                  className="mt-0.5 size-5 shrink-0"
                />
                <span className="text-[15px] leading-relaxed text-[color:var(--ink-70)]">
                  {point}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </Section>

      {/* Closing CTA: the one deep-petrol ground per page. */}
      <Section
        bleed
        className="relative overflow-hidden bg-[color:var(--deep)] py-16 text-[color:var(--paper)] sm:py-24"
      >
        <div className="mx-auto w-full max-w-3xl px-4 text-center sm:px-6">
          <h2 className="font-display text-balance text-[30px] font-bold leading-[1.08] tracking-[-0.005em] text-[color:var(--paper)] sm:text-[44px]">
            Skip the demo. See the price and start today.
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-lg leading-relaxed text-[color:var(--paper)]/85">
            A shared text inbox for the whole crew, $29 a month flat, month to
            month, with a full refund in your first 30 days if it&apos;s not for
            you.
          </p>
          <div className="mt-8 flex justify-center">
            <Button
              asChild
              size="lg"
              className="bg-[color:var(--paper)] text-[color:var(--deep)] hover:bg-white"
            >
              <Link href="/signup">
                Start for $29
                <ArrowRight strokeWidth={1.75} aria-hidden />
              </Link>
            </Button>
          </div>
          <p className="font-mono-mkt mt-4 text-[13px] text-[color:var(--paper)]/70">
            $29/mo flat · Month to month · 30-day money-back guarantee
          </p>
        </div>
      </Section>
    </>
  );
}
