/**
 * Feature-page building blocks (features track). BLUEPRINT §4 template, on the
 * v3 "Quiet daylight" identity (DESIGN-DIRECTION, BINDING).
 *
 * The four /features/* pages share this skeleton (hero -> alternating job-named
 * sections -> honest-details block -> mini-pricing strip -> page-specific FAQ ->
 * CTA band) but ZERO copy: every page passes its own hand-written content, so
 * there are no shared sentences across pages (the scaled-content guard).
 *
 * Identity notes (DESIGN-DIRECTION §2-§4):
 *  - Ground, not counters. Sections are separated by GROUND changes (the pale
 *    porcelain --paper to the one deep-petrol band and back) and by
 *    display-lettering rhythm. There are NO section numbers (§0).
 *  - Composed headlines. The hero and section headings are authored with the
 *    <Display> system: the page passes a ReactNode title composed with
 *    <Display.Mark> (the promise word, a clean petrol underline) and
 *    <Display.Accent> (the one petrol word). Boldness is spent here; everything
 *    else stays quiet.
 *  - Kickers, not eyebrows. Where a section needs a label it is a v3 <Kicker>
 *    (Public Sans 600, sentence case, --ink-55): §3 forbids mono eyebrows.
 *  - CTA copy is "Start for $29" and keeps the same words through the flow (§6).
 *
 * Server components throughout; the only client islands a page mounts are the
 * shared thread-demo / interactive widgets it drops into `visual` slots.
 */

import Link from "next/link";
import { ArrowRight, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Container } from "@/components/marketing/ui/container";
import { Kicker } from "@/components/marketing/ui/kicker";
import { Reveal } from "@/components/marketing/ui/reveal";
import { Section } from "@/components/marketing/ui/section";
import { Display } from "@/components/marketing/display";
import { MarkerCheck } from "@/components/marketing/display";
import { ArrowLink } from "@/components/marketing/ledger/arrow-link";
import { cn } from "@/lib/utils";

/* -------------------------------------------------------------------------- */
/* Hero: mono eyebrow -> composed <Display> H1 -> sub -> CTA row -> truth      */
/* chips + one framed visual, over the painted-panel paper ground.            */
/* -------------------------------------------------------------------------- */

export function FeatureHero({
  eyebrow,
  title,
  sub,
  truthChips,
  visual,
}: {
  eyebrow: string;
  /** A composed <Display> headline (page authors the marker/emph/accent). */
  title: ReactNode;
  sub: ReactNode;
  /** Short, verifiable truth chips under the CTAs (no adjectives-as-stats). */
  truthChips: string[];
  /** The feature-specific product visual (live thread demo, widget, or DOM). */
  visual: ReactNode;
}) {
  return (
    <section className="relative overflow-hidden pb-14 pt-28 sm:pb-20 sm:pt-32">
      <Container>
        <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-16">
          <div>
            <Kicker>{eyebrow}</Kicker>

            <Display as="h1" size="hero" className="mt-3 text-balance">
              {title}
            </Display>

            <p className="mt-6 max-w-xl text-lg leading-relaxed text-[color:var(--ink-70)]">
              {sub}
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

            <ul className="mt-7 flex flex-wrap gap-x-5 gap-y-2.5">
              {truthChips.map((chip) => (
                <li
                  key={chip}
                  className="flex items-center gap-2 text-[13px] text-[color:var(--ink-70)]"
                >
                  <MarkerCheck
                    color="petrol"
                    draw={false}
                    className="size-4 shrink-0"
                  />
                  {chip}
                </li>
              ))}
            </ul>
          </div>

          <Reveal className="relative">{visual}</Reveal>
        </div>
      </Container>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Alternating job-named content section (copy <-> visual). Ground alternates  */
/* paper <-> a half-step lighter panel so adjacent bands never share a         */
/* silhouette (§4), no gradient wash costume.                                  */
/* -------------------------------------------------------------------------- */

export function FeatureSection({
  eyebrow,
  heading,
  children,
  visual,
  flip = false,
  wash = false,
  id,
}: {
  eyebrow?: string;
  /** Composed <Display> heading (ReactNode) or a plain string. */
  heading: ReactNode;
  /** Prose, one or more <p>/lists; the page supplies unique body copy. */
  children: ReactNode;
  visual?: ReactNode;
  /** When true, the visual sits on the LEFT (alternating rhythm). */
  flip?: boolean;
  /** Paint this band on the half-step-lighter panel ground (a ground change). */
  wash?: boolean;
  id?: string;
}) {
  const copy = (
    <div className={cn(!visual && "mx-auto max-w-3xl")}>
      {eyebrow && <Kicker>{eyebrow}</Kicker>}
      <Display as="h2" size="h2" className={cn(eyebrow && "mt-3")}>
        {heading}
      </Display>
      <div className="prose-feature mt-5 space-y-4 text-lg leading-relaxed text-[color:var(--ink-70)]">
        {children}
      </div>
    </div>
  );

  return (
    <Section
      id={id}
      bleed={wash}
      className={cn(wash && "bg-[color:var(--paper-2)] py-16 sm:py-24")}
      /* wash paints the half-step-lighter panel ground (a ground change, §4),
         no gradient costume. */
    >
      {wash ? (
        <Container>
          <SectionInner copy={copy} visual={visual} flip={flip} />
        </Container>
      ) : (
        <SectionInner copy={copy} visual={visual} flip={flip} />
      )}
    </Section>
  );
}

function SectionInner({
  copy,
  visual,
  flip,
}: {
  copy: ReactNode;
  visual?: ReactNode;
  flip: boolean;
}) {
  if (!visual) return <>{copy}</>;
  return (
    <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
      <div className={cn(flip && "lg:order-2")}>{copy}</div>
      <Reveal className={cn(flip && "lg:order-1")}>{visual}</Reveal>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Honest-details block: limits stated plainly (BLUEPRINT §4). A ruled ledger  */
/* of terms on paper cards, warm hairlines, not a broadsheet grid.             */
/* -------------------------------------------------------------------------- */

export function HonestDetails({
  heading = "The honest details",
  lead,
  items,
}: {
  heading?: string;
  lead: string;
  items: { term: string; detail: string }[];
}) {
  return (
    <Section>
      <div className="mx-auto max-w-3xl">
        <Display as="h2" size="h2">
          {heading}
        </Display>
        <p className="mt-5 text-lg leading-relaxed text-[color:var(--ink-70)]">
          {lead}
        </p>
        <dl className="mt-8 divide-y divide-[color:var(--hairline)] overflow-hidden rounded-2xl border border-[color:var(--hairline)] bg-[color:var(--paper-2)]">
          {items.map(({ term, detail }) => (
            <div key={term} className="p-5 sm:p-6">
              <dt className="text-[15px] font-semibold text-[color:var(--ink)]">
                {term}
              </dt>
              <dd className="mt-1.5 text-[15px] leading-relaxed text-[color:var(--ink-70)]">
                {detail}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </Section>
  );
}

/* -------------------------------------------------------------------------- */
/* Feature-mapped strip: small icon rows tying the feature to the workflow.    */
/* -------------------------------------------------------------------------- */

export function FeatureStrip({
  heading,
  items,
}: {
  heading: ReactNode;
  items: { icon: LucideIcon; title: string; body: string }[];
}) {
  return (
    <Section>
      <Display as="h2" size="h2">
        {heading}
      </Display>
      <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item, i) => {
          const Icon = item.icon;
          return (
            <Reveal key={item.title} delay={Math.min(i, 3) * 60}>
              <div className="flex h-full flex-col rounded-2xl border border-[color:var(--hairline)] bg-[color:var(--paper-2)] p-5">
                <span className="flex size-9 items-center justify-center rounded-lg bg-[color:var(--petrol-12)] text-[color:var(--petrol)]">
                  <Icon className="size-5" strokeWidth={1.75} aria-hidden />
                </span>
                <h3 className="mt-4 text-[16px] font-semibold text-[color:var(--ink)]">
                  {item.title}
                </h3>
                <p className="mt-1.5 text-[14px] leading-relaxed text-[color:var(--ink-70)]">
                  {item.body}
                </p>
              </div>
            </Reveal>
          );
        })}
      </div>
    </Section>
  );
}

/* -------------------------------------------------------------------------- */
/* Mini-pricing strip: the whole price list, compact, with the $29 in the      */
/* work-order mono (BLUEPRINT §4). On the paper ground, a bordered panel.       */
/* -------------------------------------------------------------------------- */

export function MiniPricing({ body }: { body: ReactNode }) {
  return (
    <Section bleed className="bg-[color:var(--paper-2)] py-16 sm:py-24">
      <Container>
        <div className="mx-auto max-w-3xl rounded-2xl border border-[color:var(--hairline)] bg-[color:var(--paper)] p-6 sm:p-8">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="font-mono-mkt text-[44px] font-semibold leading-none tabular-nums text-[color:var(--petrol)]">
              $29
            </span>
            <span className="text-[15px] text-[color:var(--ink-70)]">
              /mo, the whole crew, month to month
            </span>
          </div>
          <div className="prose-feature mt-5 space-y-3 text-[15px] leading-relaxed text-[color:var(--ink-70)]">
            {body}
          </div>
          <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-6">
            <Button asChild>
              <Link href="/signup">
                Start for $29
                <ArrowRight strokeWidth={1.75} aria-hidden />
              </Link>
            </Button>
            <ArrowLink href="/pricing">See full pricing</ArrowLink>
          </div>
        </div>
      </Container>
    </Section>
  );
}

/* -------------------------------------------------------------------------- */
/* Internal-link block: related trade + compare pages (BLUEPRINT §4/§11).      */
/* -------------------------------------------------------------------------- */

export interface RelatedLink {
  label: string;
  href: string;
  hint: string;
}

export function RelatedLinks({
  heading,
  intro,
  links,
}: {
  heading: string;
  intro: string;
  links: RelatedLink[];
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
/* Page-specific FAQ: native <details>, NO FAQPage JSON-LD (§11.2).            */
/* -------------------------------------------------------------------------- */

export function FeatureFaq({
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
/* Closing CTA band: the ONE deep-petrol ground per page (§3 "used once"),     */
/* the earned crescendo. Paper gives way to the dark band; light type, one     */
/* paper-white button, a single marker check. No fake indicators.              */
/* -------------------------------------------------------------------------- */

export function FeatureCta({
  heading,
  sub,
}: {
  heading: ReactNode;
  sub: string;
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
