/**
 * Shared presentational building blocks for the three /compare/* pages
 * (BLUEPRINT §6), on the v3 "Quiet daylight" identity (DESIGN-DIRECTION,
 * BINDING). These carry the *skeleton* (hero, concede block, advantages,
 * switching note, FAQ, CTA) but NO copy, every sentence is passed in per page,
 * so the three pages share zero sentences (§6 no-shared-sentences guard).
 *
 * Identity: composed <Display> headings, v3 <Kicker> labels (Public Sans 600,
 * sentence case — never mono, §3), the porcelain paper ground with
 * half-step-lighter ground changes, marker checks on the advantage list, and
 * the ONE deep-petrol final band. The sourced comparison tables are kept
 * verbatim and framed in comparison-table.tsx.
 *
 * Server components throughout (the compare pages have no interactivity beyond
 * native <details> and links).
 */

import Link from "next/link";
import { ArrowRight, Scale } from "lucide-react";
import type { ReactNode } from "react";

import { Container } from "@/components/marketing/ui/container";
import { Kicker } from "@/components/marketing/ui/kicker";
import { Photo } from "@/components/marketing/photo";
import { Reveal } from "@/components/marketing/ui/reveal";
import { Section } from "@/components/marketing/ui/section";
import { Display, MarkerCheck } from "@/components/marketing/display";
import { ArrowLink } from "@/components/marketing/ledger/arrow-link";
import { CrewSizeSliderStatic } from "@/components/marketing/interactive/crew-size-slider-static";
import { Button } from "@/components/ui/button";

/* -------------------------------------------------------------------------- */
/* Hero                                                                        */
/* -------------------------------------------------------------------------- */

export function CompareHero({
  eyebrow,
  title,
  lead,
  visual,
}: {
  eyebrow: string;
  /** A composed <Display> headline (page authors the marker/emph/accent). */
  title: ReactNode;
  lead: ReactNode;
  /**
   * The hero's real image, a warm duotone tradesperson/owner photo (§4). Every
   * compare page opens on a real photo, not text-on-white: the buyer sees a
   * human like them before the sourced table. When present the hero is a
   * two-column split; when omitted it falls back to the centered layout.
   */
  visual?: ReactNode;
}) {
  if (visual) {
    return (
      <section className="relative overflow-hidden pb-14 pt-28 sm:pb-20 sm:pt-32">
        <Container>
          <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.92fr)] lg:gap-16">
            <div>
              <Kicker>{eyebrow}</Kicker>
              <Display as="h1" size="hero" className="mt-3 text-balance">
                {title}
              </Display>
              <p className="mt-6 max-w-xl text-lg leading-relaxed text-[color:var(--ink-70)]">
                {lead}
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
            <Reveal className="relative">{visual}</Reveal>
          </div>
        </Container>
      </section>
    );
  }

  return (
    <section className="relative overflow-hidden pb-14 pt-28 sm:pb-20 sm:pt-32">
      <Container>
        <div className="mx-auto max-w-3xl text-center">
          <Kicker>{eyebrow}</Kicker>
          <Display as="h1" size="hero" className="mt-3 text-balance">
            {title}
          </Display>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-[color:var(--ink-70)]">
            {lead}
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row sm:gap-6">
            <Button asChild size="lg">
              <Link href="/signup">
                Start for $29
                <ArrowRight strokeWidth={1.75} aria-hidden />
              </Link>
            </Button>
            <ArrowLink href="/pricing">See pricing</ArrowLink>
          </div>
        </div>
      </Container>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* <CompareHeroPhoto>, the framed real duotone photo the compare heroes pass    */
/* into the CompareHero visual slot. One shared shell so all three head-to-     */
/* heads frame their hero image identically (§4 duotone frame).                 */
/* -------------------------------------------------------------------------- */

export function CompareHeroPhoto({
  photoId,
  caption,
}: {
  photoId: string;
  caption: string;
}) {
  return (
    <figure className="overflow-hidden rounded-2xl border border-[color:var(--hairline)] bg-[color:var(--paper-2)] shadow-[0_24px_64px_-32px_rgba(11,79,73,0.25)]">
      <Photo
        id={photoId}
        priority
        sizes="(min-width: 1024px) 34rem, 100vw"
        imgClassName="aspect-[4/3] object-cover"
      />
      <figcaption className="border-t border-[color:var(--hairline)] px-5 py-4 text-[13px] leading-relaxed text-[color:var(--ink-70)]">
        {caption}
      </figcaption>
    </figure>
  );
}

/* -------------------------------------------------------------------------- */
/* "Who each is for", the honest concession (§6). Two side-by-side cards.      */
/* -------------------------------------------------------------------------- */

export function WhoEachIsFor({
  heading,
  loonextTitle,
  loonextBody,
  competitorTitle,
  competitorBody,
}: {
  heading: ReactNode;
  loonextTitle: string;
  loonextBody: ReactNode;
  competitorTitle: string;
  competitorBody: ReactNode;
}) {
  return (
    <Section>
      <div className="mx-auto max-w-4xl">
        <Display as="h2" size="h2">
          {heading}
        </Display>
        <div className="mt-10 grid gap-6 md:grid-cols-2">
          <Reveal>
            <div className="h-full rounded-2xl border border-[color:var(--petrol)]/40 bg-[color:var(--petrol-12)] p-6 sm:p-8">
              <h3 className="text-lg font-semibold text-[color:var(--petrol)]">
                {loonextTitle}
              </h3>
              <div className="mt-3 space-y-3 text-[15px] leading-relaxed text-[color:var(--ink)]">
                {loonextBody}
              </div>
            </div>
          </Reveal>
          <Reveal delay={60}>
            <div className="h-full rounded-2xl border border-[color:var(--hairline)] bg-[color:var(--paper-2)] p-6 sm:p-8">
              <h3 className="text-lg font-semibold text-[color:var(--ink)]">
                {competitorTitle}
              </h3>
              <div className="mt-3 space-y-3 text-[15px] leading-relaxed text-[color:var(--ink-70)]">
                {competitorBody}
              </div>
            </div>
          </Reveal>
        </div>
      </div>
    </Section>
  );
}

/* -------------------------------------------------------------------------- */
/* "Where {competitor} may be the better pick", the explicit concession (§6). */
/* -------------------------------------------------------------------------- */

export function BetterPickCallout({
  heading,
  intro,
  points,
  recommendation,
}: {
  heading: ReactNode;
  intro: ReactNode;
  points: { title: string; body: ReactNode }[];
  recommendation: ReactNode;
}) {
  return (
    <Section bleed className="bg-[color:var(--paper-2)] py-16 sm:py-24">
      <Container>
        <div className="mx-auto max-w-3xl">
          <div className="flex items-center gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[color:var(--petrol-12)] text-[color:var(--petrol)]">
              <Scale className="size-5" strokeWidth={1.75} aria-hidden />
            </span>
            <Display as="h2" size="h2">
              {heading}
            </Display>
          </div>
          <p className="mt-5 text-lg leading-relaxed text-[color:var(--ink-70)]">
            {intro}
          </p>
          <ul className="mt-8 space-y-5">
            {points.map((point) => (
              <li
                key={point.title}
                className="rounded-2xl border border-[color:var(--hairline)] bg-[color:var(--paper)] p-5"
              >
                <p className="text-[15px] font-semibold text-[color:var(--ink)]">
                  {point.title}
                </p>
                <p className="mt-1.5 text-[14px] leading-relaxed text-[color:var(--ink-70)]">
                  {point.body}
                </p>
              </li>
            ))}
          </ul>
          <p className="mt-8 rounded-2xl border border-[color:var(--petrol)]/40 bg-[color:var(--petrol-12)] p-5 text-[15px] leading-relaxed text-[color:var(--ink)]">
            {recommendation}
          </p>
        </div>
      </Container>
    </Section>
  );
}

/* -------------------------------------------------------------------------- */
/* Loonext advantages, framed factually (§6). Marker-checked list of real wins. */
/* -------------------------------------------------------------------------- */

export function Advantages({
  heading,
  lead,
  items,
}: {
  heading: ReactNode;
  lead?: ReactNode;
  items: { title: string; body: ReactNode }[];
}) {
  return (
    <Section>
      <div className="mx-auto max-w-4xl">
        <Display as="h2" size="h2">
          {heading}
        </Display>
        {lead && (
          <p className="mt-5 max-w-2xl text-lg leading-relaxed text-[color:var(--ink-70)]">
            {lead}
          </p>
        )}
        <div className="mt-10 grid gap-6 sm:grid-cols-2">
          {items.map((item, i) => (
            <Reveal key={item.title} delay={Math.min(i, 3) * 60}>
              <div className="flex h-full gap-3.5 rounded-2xl border border-[color:var(--hairline)] bg-[color:var(--paper-2)] p-6">
                <MarkerCheck
                  color="petrol"
                  draw={false}
                  className="mt-0.5 size-5 shrink-0"
                />
                <div>
                  <h3 className="text-[15px] font-semibold text-[color:var(--ink)]">
                    {item.title}
                  </h3>
                  <p className="mt-1.5 text-[14px] leading-relaxed text-[color:var(--ink-70)]">
                    {item.body}
                  </p>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </Section>
  );
}

/* -------------------------------------------------------------------------- */
/* "Switching is easy", honest bring-your-number note (§6).                   */
/* -------------------------------------------------------------------------- */

export function SwitchingNote({
  heading,
  body,
}: {
  heading: string;
  body: ReactNode;
}) {
  return (
    <Section>
      <div className="mx-auto max-w-3xl rounded-2xl border border-[color:var(--hairline)] bg-[color:var(--paper-2)] p-6 sm:p-10">
        <h2 className="font-display text-[24px] font-bold leading-tight tracking-[-0.005em] text-[color:var(--ink)]">
          {heading}
        </h2>
        <div className="mt-4 space-y-4 text-[15px] leading-relaxed text-[color:var(--ink-70)]">
          {body}
        </div>
      </div>
    </Section>
  );
}

/* -------------------------------------------------------------------------- */
/* Switching-objections FAQ (§6). Native <details>, NO FAQPage JSON-LD.        */
/* -------------------------------------------------------------------------- */

export function CompareFaq({
  heading,
  faqs,
}: {
  heading: ReactNode;
  faqs: { q: string; a: ReactNode }[];
}) {
  return (
    <Section>
      <div className="mx-auto max-w-3xl">
        <Display as="h2" size="h2" className="text-center">
          {heading}
        </Display>
        <div className="mt-12 divide-y divide-[color:var(--hairline)] border-y border-[color:var(--hairline)]">
          {faqs.map((item) => (
            <details key={item.q} className="group">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-5 text-left text-[17px] font-medium text-[color:var(--ink)] [&::-webkit-details-marker]:hidden">
                {item.q}
                <span
                  className="shrink-0 text-[color:var(--graphite)] transition-transform duration-200 group-open:rotate-45"
                  aria-hidden
                >
                  +
                </span>
              </summary>
              <div className="pb-5 pr-8 text-[15px] leading-relaxed text-[color:var(--ink-70)]">
                {item.a}
              </div>
            </details>
          ))}
        </div>
      </div>
    </Section>
  );
}

/* -------------------------------------------------------------------------- */
/* Final CTA band (§6): the ONE deep-petrol ground per page.                   */
/* -------------------------------------------------------------------------- */

export function CompareCta({
  heading,
  sub,
}: {
  heading: ReactNode;
  sub: ReactNode;
}) {
  return (
    <Section
      bleed
      className="relative overflow-hidden bg-[color:var(--deep)] py-16 text-[color:var(--paper)] sm:py-24"
    >
      <div className="mx-auto w-full max-w-3xl px-4 text-center sm:px-6">
        <h2 className="font-display text-balance text-[30px] font-bold leading-[1.08] tracking-[-0.005em] text-[color:var(--paper)] sm:text-[44px]">
          {heading}
        </h2>
        <p className="mx-auto mt-5 max-w-xl text-lg leading-relaxed text-[color:var(--paper)]/85">
          {sub}
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
        <p className="mt-4 text-[13px] text-[color:var(--paper)]/70">
          $29/mo flat · Month to month · 30-day money-back guarantee
        </p>
      </div>
    </Section>
  );
}

/* -------------------------------------------------------------------------- */
/* "At a glance" flat-vs-per-seat chart (VISUALS §3 comparison-page rule).      */
/* -------------------------------------------------------------------------- */

export function AtAGlanceChart({
  heading,
  lead,
}: {
  heading: ReactNode;
  lead: ReactNode;
}) {
  return (
    <Section bleed className="bg-[color:var(--paper-2)] py-16 sm:py-24">
      <Container>
        <div className="mx-auto max-w-4xl">
          <div className="mx-auto max-w-2xl text-center">
            <Display as="h2" size="h2">
              {heading}
            </Display>
            <p className="mt-5 text-lg leading-relaxed text-[color:var(--ink-70)]">
              {lead}
            </p>
          </div>
          <Reveal className="mt-10">
            <CrewSizeSliderStatic />
          </Reveal>
        </div>
      </Container>
    </Section>
  );
}

/* -------------------------------------------------------------------------- */
/* Internal-link block (SEO). Links out to relevant feature + trade pages.     */
/* -------------------------------------------------------------------------- */

export interface CompareRelatedLink {
  label: string;
  href: string;
  hint: string;
}

export function CompareRelatedLinks({
  heading,
  intro,
  links,
}: {
  heading: string;
  intro: string;
  links: CompareRelatedLink[];
}) {
  return (
    <Section>
      <div className="mx-auto max-w-4xl">
        <h2 className="font-display text-[26px] font-bold leading-tight tracking-[-0.01em] text-[color:var(--ink)] sm:text-[30px]">
          {heading}
        </h2>
        <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-[color:var(--ink-70)]">
          {intro}
        </p>
        <ul className="mt-8 grid gap-4 sm:grid-cols-2">
          {links.map((link) => (
            <li key={link.href + link.label}>
              <Link
                href={link.href}
                className="group flex items-start justify-between gap-4 rounded-2xl border border-[color:var(--hairline)] bg-[color:var(--paper-2)] p-4 transition-colors hover:border-[color:var(--petrol)]/40"
              >
                <span>
                  <span className="text-[15px] font-medium text-[color:var(--ink)]">
                    {link.label}
                  </span>
                  <span className="mt-0.5 block text-[13px] leading-relaxed text-[color:var(--ink-70)]">
                    {link.hint}
                  </span>
                </span>
                <ArrowRight
                  className="mt-0.5 size-4 shrink-0 text-[color:var(--petrol)] opacity-0 transition-all group-hover:translate-x-0.5 group-hover:opacity-100"
                  strokeWidth={1.75}
                  aria-hidden
                />
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </Section>
  );
}

/* -------------------------------------------------------------------------- */
/* "What you'll actually pay" math block wrapper (§6). Dated + sourced.        */
/* -------------------------------------------------------------------------- */

export function PayMathBlock({
  heading,
  lead,
  children,
  footnote,
}: {
  heading: ReactNode;
  lead: ReactNode;
  children: ReactNode;
  footnote: ReactNode;
}) {
  return (
    <Section>
      <div className="mx-auto max-w-4xl">
        <Display as="h2" size="h2">
          {heading}
        </Display>
        <p className="mt-5 max-w-2xl text-lg leading-relaxed text-[color:var(--ink-70)]">
          {lead}
        </p>
        <div className="mt-8">{children}</div>
        <p className="mt-4 text-[13px] leading-relaxed text-[color:var(--ink-70)]">
          {footnote}
        </p>
      </div>
    </Section>
  );
}
