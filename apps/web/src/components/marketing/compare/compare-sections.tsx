/**
 * Shared presentational building blocks for the three /compare/* pages
 * (BLUEPRINT §6). These carry the *skeleton* (hero, concede block, advantages,
 * switching note, FAQ, CTA) but NO copy — every sentence is passed in per page,
 * so the three pages share zero sentences (§6 no-shared-sentences guard, the
 * scaled-content defense).
 *
 * Server components throughout (the compare pages have no interactivity beyond
 * native <details> and links).
 */

import Link from "next/link";
import { ArrowRight, Check, Scale } from "lucide-react";

import { Container } from "@/components/marketing/ui/container";
import { Photo } from "@/components/marketing/photo";
import { Reveal } from "@/components/marketing/ui/reveal";
import { Section } from "@/components/marketing/ui/section";
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
  title: string;
  lead: string;
  /**
   * The hero's real image — a warm, on-brand tradesperson/owner photo (VISUALS-V2
   * §2). Every compare page opens on a real photo, not text-on-white: the buyer
   * sees a human like them before the sourced table. When present the hero is a
   * two-column split; when omitted it falls back to the centered layout.
   */
  visual?: React.ReactNode;
}) {
  if (visual) {
    return (
      <Container className="pt-16 sm:pt-24">
        <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)] lg:gap-16">
          <div>
            <p className="text-sm font-semibold text-primary">{eyebrow}</p>
            <h1 className="display-hero mt-2 text-balance text-foreground">
              {title}
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-muted-foreground">
              {lead}
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
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
          <div className="relative">{visual}</div>
        </div>
      </Container>
    );
  }

  return (
    <Container className="pt-16 sm:pt-24">
      <div className="mx-auto max-w-3xl text-center">
        <p className="text-sm font-semibold text-primary">{eyebrow}</p>
        <h1 className="display-hero mt-2 text-foreground">{title}</h1>
        <p className="mx-auto mt-5 max-w-2xl text-lg leading-relaxed text-muted-foreground">
          {lead}
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
  );
}

/* -------------------------------------------------------------------------- */
/* <CompareHeroPhoto> — the framed real photo the compare heroes pass into the  */
/* CompareHero visual slot. One shared shell so all three head-to-heads frame   */
/* their hero image identically (VISUALS-V2 §2 pipeline + the ticket frame:     */
/* 10px radius, 1px border, ambient product shadow). Each page picks its own    */
/* warm photo id + honest caption.                                             */
/* -------------------------------------------------------------------------- */

export function CompareHeroPhoto({
  photoId,
  caption,
}: {
  photoId: string;
  caption: string;
}) {
  return (
    <figure className="overflow-hidden rounded-2xl border border-border bg-card shadow-[0_24px_64px_-32px_rgba(28,25,23,0.25)]">
      <Photo
        id={photoId}
        priority
        sizes="(min-width: 1024px) 34rem, 100vw"
        imgClassName="aspect-[4/3] object-cover"
      />
      <figcaption className="border-t border-border px-5 py-4 text-[13px] leading-relaxed text-muted-foreground">
        {caption}
      </figcaption>
    </figure>
  );
}

/* -------------------------------------------------------------------------- */
/* "Who each is for" — the honest concession (§6). Two side-by-side cards.      */
/* Conceding genuinely builds trust and is legally safer.                      */
/* -------------------------------------------------------------------------- */

export function WhoEachIsFor({
  heading,
  jobtextTitle,
  jobtextBody,
  competitorTitle,
  competitorBody,
}: {
  heading: string;
  jobtextTitle: string;
  jobtextBody: React.ReactNode;
  competitorTitle: string;
  competitorBody: React.ReactNode;
}) {
  return (
    <Section>
      <div className="mx-auto max-w-4xl">
        <h2 className="display-h2 text-foreground">{heading}</h2>
        <div className="mt-10 grid gap-6 md:grid-cols-2">
          <Reveal>
            <div className="h-full rounded-2xl border border-primary/40 bg-primary/5 p-6 sm:p-8">
              <h3 className="text-lg font-semibold text-primary">
                {jobtextTitle}
              </h3>
              <div className="mt-3 space-y-3 text-[15px] leading-relaxed text-foreground">
                {jobtextBody}
              </div>
            </div>
          </Reveal>
          <Reveal delay={60}>
            <div className="h-full rounded-2xl border border-border bg-card p-6 sm:p-8">
              <h3 className="text-lg font-semibold text-foreground">
                {competitorTitle}
              </h3>
              <div className="mt-3 space-y-3 text-[15px] leading-relaxed text-muted-foreground">
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
/* "Where {competitor} may be the better pick" — the explicit concession (§6). */
/* -------------------------------------------------------------------------- */

export function BetterPickCallout({
  heading,
  intro,
  points,
  recommendation,
}: {
  heading: string;
  intro: React.ReactNode;
  points: { title: string; body: React.ReactNode }[];
  recommendation: React.ReactNode;
}) {
  return (
    <Section
      bleed
      className="bg-gradient-to-b from-stone-50 to-teal-50 py-16 dark:from-background dark:to-teal-950/20 sm:py-24"
    >
      <Container>
        <div className="mx-auto max-w-3xl">
          <div className="flex items-center gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Scale className="size-5" strokeWidth={1.75} aria-hidden />
            </span>
            <h2 className="display-h2 text-foreground">{heading}</h2>
          </div>
          <p className="mt-5 text-lg leading-relaxed text-muted-foreground">
            {intro}
          </p>
          <ul className="mt-8 space-y-5">
            {points.map((point) => (
              <li
                key={point.title}
                className="rounded-2xl border border-border bg-card p-5"
              >
                <p className="text-[15px] font-semibold text-foreground">
                  {point.title}
                </p>
                <p className="mt-1.5 text-[14px] leading-relaxed text-muted-foreground">
                  {point.body}
                </p>
              </li>
            ))}
          </ul>
          <p className="mt-8 rounded-2xl border border-primary/40 bg-primary/5 p-5 text-[15px] leading-relaxed text-foreground">
            {recommendation}
          </p>
        </div>
      </Container>
    </Section>
  );
}

/* -------------------------------------------------------------------------- */
/* JobText advantages — framed factually (§6). Checklist of real wins.         */
/* -------------------------------------------------------------------------- */

export function Advantages({
  heading,
  lead,
  items,
}: {
  heading: string;
  lead?: React.ReactNode;
  items: { title: string; body: React.ReactNode }[];
}) {
  return (
    <Section>
      <div className="mx-auto max-w-4xl">
        <h2 className="display-h2 text-foreground">{heading}</h2>
        {lead && (
          <p className="mt-5 max-w-2xl text-lg leading-relaxed text-muted-foreground">
            {lead}
          </p>
        )}
        <div className="mt-10 grid gap-6 sm:grid-cols-2">
          {items.map((item, i) => (
            <Reveal key={item.title} delay={Math.min(i, 3) * 60}>
              <div className="flex h-full gap-3.5 rounded-2xl border border-border bg-card p-6">
                <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <Check className="size-4" strokeWidth={2.25} aria-hidden />
                </span>
                <div>
                  <h3 className="text-[15px] font-semibold text-foreground">
                    {item.title}
                  </h3>
                  <p className="mt-1.5 text-[14px] leading-relaxed text-muted-foreground">
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
/* "Switching is easy" — honest bring-your-number note (§6).                   */
/* Porting is roadmap; forwarding works today — say exactly that.              */
/* -------------------------------------------------------------------------- */

export function SwitchingNote({
  heading,
  body,
}: {
  heading: string;
  body: React.ReactNode;
}) {
  return (
    <Section>
      <div className="mx-auto max-w-3xl rounded-2xl border border-border bg-card p-6 sm:p-10">
        <h2 className="text-2xl font-semibold text-foreground">{heading}</h2>
        <div className="mt-4 space-y-4 text-[15px] leading-relaxed text-muted-foreground">
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
  heading: string;
  faqs: { q: string; a: React.ReactNode }[];
}) {
  return (
    <Section>
      <div className="mx-auto max-w-3xl">
        <h2 className="display-h2 text-center text-foreground">{heading}</h2>
        <div className="mt-12 divide-y divide-border border-y border-border">
          {faqs.map((item) => (
            <details key={item.q} className="group">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-5 text-left text-[17px] font-medium text-foreground [&::-webkit-details-marker]:hidden">
                {item.q}
                <ArrowRight
                  className="size-5 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-90"
                  strokeWidth={1.75}
                  aria-hidden
                />
              </summary>
              <div className="pb-5 pr-8 text-[15px] leading-relaxed text-muted-foreground">
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
/* Final CTA band (§6). Second allowed wash.                                   */
/* -------------------------------------------------------------------------- */

export function CompareCta({
  heading,
  sub,
}: {
  heading: string;
  sub: React.ReactNode;
}) {
  return (
    <Section
      bleed
      className="bg-gradient-to-b from-stone-50 to-teal-50 py-16 dark:from-background dark:to-teal-950/20 sm:py-24"
    >
      <div className="mx-auto w-full max-w-3xl px-4 text-center sm:px-6">
        <h2 className="display-h2 text-foreground">{heading}</h2>
        <p className="mx-auto mt-5 max-w-xl text-lg leading-relaxed text-muted-foreground">
          {sub}
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
  );
}

/* -------------------------------------------------------------------------- */
/* "At a glance" flat-vs-per-seat chart (VISUALS §3 comparison-page rule: a     */
/* small at-a-glance visual PLUS the table, not just a table on white). The     */
/* static SVG twin of the crew-size slider; per-user figure dated + sourced to  */
/* /compare/quo. Reused by all three compare pages; each passes its own lead.   */
/* -------------------------------------------------------------------------- */

export function AtAGlanceChart({
  heading,
  lead,
}: {
  heading: string;
  lead: React.ReactNode;
}) {
  return (
    <Section
      bleed
      className="bg-gradient-to-b from-stone-50 to-teal-50 py-16 dark:from-background dark:to-teal-950/20 sm:py-24"
    >
      <Container>
        <div className="mx-auto max-w-4xl">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="display-h2 text-foreground">{heading}</h2>
            <p className="mt-5 text-lg leading-relaxed text-muted-foreground">
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
/* Internal-link block (VISUALS §3 / SEO: compare pages were flagged for thin   */
/* internal linking). Links out to the relevant feature + trade pages so the    */
/* three comparisons weave into the site's link graph instead of dead-ending.   */
/* Each page passes its own links; no shared copy.                              */
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
        <h2 className="text-2xl font-semibold text-foreground">{heading}</h2>
        <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-muted-foreground">
          {intro}
        </p>
        <ul className="mt-8 grid gap-4 sm:grid-cols-2">
          {links.map((link) => (
            <li key={link.href + link.label}>
              <Link
                href={link.href}
                className="group flex items-start justify-between gap-4 rounded-[10px] border border-border bg-card p-4 transition-colors hover:border-primary/30"
              >
                <span>
                  <span className="text-[15px] font-medium text-foreground">
                    {link.label}
                  </span>
                  <span className="mt-0.5 block text-[13px] leading-relaxed text-muted-foreground">
                    {link.hint}
                  </span>
                </span>
                <ArrowRight
                  className="mt-0.5 size-4 shrink-0 text-primary opacity-0 transition-all group-hover:translate-x-0.5 group-hover:opacity-100"
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
/* "What you'll actually pay" math block wrapper (§6). Renders a monthly-cost   */
/* breakdown with an always-visible dated + sourced footnote.                  */
/* -------------------------------------------------------------------------- */

export function PayMathBlock({
  heading,
  lead,
  children,
  footnote,
}: {
  heading: string;
  lead: React.ReactNode;
  children: React.ReactNode;
  footnote: React.ReactNode;
}) {
  return (
    <Section>
      <div className="mx-auto max-w-4xl">
        <h2 className="display-h2 text-foreground">{heading}</h2>
        <p className="mt-5 max-w-2xl text-lg leading-relaxed text-muted-foreground">
          {lead}
        </p>
        <div className="mt-8">{children}</div>
        <p className="mt-4 text-[13px] leading-relaxed text-muted-foreground">
          {footnote}
        </p>
      </div>
    </Section>
  );
}
