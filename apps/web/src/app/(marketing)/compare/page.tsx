/**
 * /compare — the comparison index (BLUEPRINT §6, §11). The landing page the
 * "Compare" breadcrumb crumb points at (it previously pointed at /pricing — a
 * mismatch this page fixes), and a real hub the three head-to-head pages link
 * back to instead of being orphaned deep links.
 *
 * Content: a benefit-first hero, three cards linking to the sourced comparisons
 * (Podium / Heymarket / Quo, each with its honest one-line "who it's for"), the
 * flat-vs-per-seat "at a glance" chart (the static SVG twin of the crew-size
 * slider — the one visual the mandate asks compare surfaces to carry), and a
 * single "Start for $29" CTA with the risk-reducer. buildMetadata + a
 * BreadcrumbList that terminates on /compare itself; NO FAQPage (§11.2).
 */

import Link from "next/link";
import { ArrowRight, Building2, Check, Scale } from "lucide-react";
import type { Metadata } from "next";

import { Button } from "@/components/ui/button";
import { Container } from "@/components/marketing/ui/container";
import { GlowBackdrop } from "@/components/marketing/ui/glow-backdrop";
import { JsonLd } from "@/components/marketing/ui/json-ld";
import { Reveal } from "@/components/marketing/ui/reveal";
import { Section } from "@/components/marketing/ui/section";
import { ArtReveal, FlatVsPerSeatChart } from "@/components/marketing/art";
import { breadcrumbJsonLd, buildMetadata } from "@/lib/marketing/seo";

const PATH = "/compare";

export const metadata: Metadata = buildMetadata({
  title: "Compare JobText: honest, dated side-by-sides",
  description:
    "See how JobText's flat $29/mo shared text inbox stacks up against Podium, Heymarket, and Quo — every competitor price dated and sourced, every trade-off stated plainly.",
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
      "An all-in-one platform with reviews, payments, and AI call answering — sold through a demo, on an annual term.",
    fact: "$29/mo, on the page vs. reported ~$399/mo, quote required",
  },
  {
    competitor: "Heymarket",
    href: "/compare/heymarket",
    angle:
      "An enterprise-grade shared inbox with SOC 2, a HIPAA BAA, and email — priced per user with a two-seat minimum.",
    fact: "$29 flat for the crew vs. $49/user, texts billed on top",
  },
  {
    competitor: "Quo",
    href: "/compare/quo",
    angle:
      "A full business phone system (formerly OpenPhone) with calling included — billed per user, texting metered.",
    fact: "Flat, texting included vs. $15–19/user, texting per segment",
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

      {/* Hero — the one petrol/amber atmosphere behind the LCP text. */}
      <section className="relative overflow-hidden pb-8 pt-24 sm:pt-28">
        <GlowBackdrop />
        <Container>
          <div className="mx-auto max-w-3xl text-center">
            <p className="flex items-center justify-center gap-1.5 text-[13px] font-semibold text-primary">
              <Scale className="size-4" strokeWidth={1.75} aria-hidden />
              Honest comparisons
            </p>
            <h1 className="display-hero mt-4 text-balance text-foreground">
              How JobText compares — with the price on the page.
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground">
              We put JobText next to the tools you&apos;re weighing it against and
              tell the truth about both — every competitor number dated and
              sourced, every place they beat us named outright. JobText is a
              shared text inbox at one flat price: $29 a month for the whole crew,
              month to month, no sales call in the way.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button asChild size="lg">
                <Link href="/signup">
                  Start for $29
                  <ArrowRight strokeWidth={1.75} aria-hidden />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href="/pricing">See pricing</Link>
              </Button>
            </div>
          </div>
        </Container>
      </section>

      {/* The three comparisons — cards linking to each sourced page. */}
      <Section>
        <div className="mx-auto max-w-5xl">
          <h2 className="display-h2 max-w-3xl text-foreground">
            Pick the one you&apos;re deciding between.
          </h2>
          <p className="mt-5 max-w-2xl text-lg leading-relaxed text-muted-foreground">
            Three head-to-head breakdowns, each with a dated pricing table, a
            &ldquo;who each is really for,&rdquo; and where the other tool
            genuinely wins.
          </p>
          <div className="mt-10 grid gap-6 md:grid-cols-3">
            {CARDS.map((card, i) => (
              <Reveal key={card.href} delay={Math.min(i, 3) * 60}>
                <Link
                  href={card.href}
                  className="group flex h-full flex-col rounded-2xl border border-border bg-card p-6 transition-colors hover:border-primary/40"
                >
                  <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <Building2 className="size-5" strokeWidth={1.75} aria-hidden />
                  </span>
                  <h3 className="mt-4 text-lg font-semibold text-foreground">
                    JobText vs {card.competitor}
                  </h3>
                  <p className="mt-2 flex-1 text-[15px] leading-relaxed text-muted-foreground">
                    {card.angle}
                  </p>
                  <p className="mt-4 border-t border-border pt-4 text-[13px] font-medium tabular-nums text-foreground">
                    {card.fact}
                  </p>
                  <span className="mt-4 inline-flex items-center gap-1 text-[14px] font-medium text-primary">
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

      {/* "At a glance" visual — flat vs per-seat (the mandated compare visual). */}
      <Section
        bleed
        className="bg-gradient-to-b from-stone-50 to-teal-50 py-16 dark:from-background dark:to-teal-950/20 sm:py-24"
      >
        <Container>
          <div className="mx-auto max-w-4xl">
            <div className="mx-auto max-w-2xl text-center">
              <h2 className="display-h2 text-foreground">
                The whole story, at a glance.
              </h2>
              <p className="mt-5 text-lg leading-relaxed text-muted-foreground">
                Most of the tools above bill per user. JobText is flat — $29 up to
                three people, $79 up to ten. The more your crew grows, the wider
                the gap. Here&apos;s a flat line against a typical per-user tool as
                the team scales.
              </p>
            </div>
            <ArtReveal className="mt-10 rounded-2xl border border-border bg-card p-6 sm:p-8">
              <FlatVsPerSeatChart className="mx-auto max-w-2xl" />
            </ArtReveal>
            <p className="mx-auto mt-4 max-w-2xl text-center text-[13px] leading-relaxed text-muted-foreground">
              Per-user line: $19/user/mo, a published seat price as of July 2026;
              the exact, sourced math is on the{" "}
              <Link
                href="/compare/quo"
                className="font-medium text-primary underline-offset-2 hover:underline"
              >
                Quo comparison
              </Link>
              .
            </p>
          </div>
        </Container>
      </Section>

      {/* What every comparison shares — the honesty method, as trust proof. */}
      <Section>
        <div className="mx-auto max-w-3xl">
          <h2 className="text-2xl font-semibold text-foreground">
            How we compare — and why you can trust it.
          </h2>
          <ul className="mt-8 space-y-4">
            {[
              "Every competitor price is dated and sourced from their own public pricing page — we re-verify it each time we touch the page.",
              "We recommend the other tool outright for the buyer it fits better. If you need calling, reviews, or SOC 2, we say so.",
              "No fake logos, no invented stats, no scraped screenshots — just the numbers, in writing, next to ours.",
            ].map((point) => (
              <li key={point} className="flex gap-3">
                <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <Check className="size-4" strokeWidth={2.25} aria-hidden />
                </span>
                <span className="text-[15px] leading-relaxed text-muted-foreground">
                  {point}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </Section>

      {/* Closing CTA — the second allowed wash, one primary CTA + risk-reducer. */}
      <Section
        bleed
        className="bg-gradient-to-b from-stone-50 to-teal-50 py-16 dark:from-background dark:to-teal-950/20 sm:py-24"
      >
        <div className="mx-auto w-full max-w-3xl px-4 text-center sm:px-6">
          <h2 className="display-h2 text-foreground">
            Skip the demo. See the price and start today.
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-lg leading-relaxed text-muted-foreground">
            A shared text inbox for the whole crew, $29 a month flat, month to
            month — with a full refund in your first 30 days if it&apos;s not for
            you.
          </p>
          <div className="mt-8 flex justify-center">
            <Button asChild size="lg">
              <Link href="/signup">
                Start for $29
                <ArrowRight strokeWidth={1.75} aria-hidden />
              </Link>
            </Button>
          </div>
          <p className="mt-4 text-[13px] tabular-nums text-muted-foreground">
            $29/mo flat · Month to month · 30-day money-back guarantee
          </p>
        </div>
      </Section>
    </>
  );
}
