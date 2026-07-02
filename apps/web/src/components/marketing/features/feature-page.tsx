/**
 * Feature-page building blocks (features track) — BLUEPRINT §4 template.
 *
 * The four /features/* pages share this skeleton (hero → alternating job-named
 * sections → honest-details block → mini-pricing strip → page-specific FAQ →
 * CTA band) but ZERO copy: every page passes its own hand-written content, so
 * there are no shared sentences across pages (the §5/§6 scaled-content guard,
 * applied to features too). These are pure presentational primitives that reuse
 * the shared marketing UI (Container, Section, Reveal, Button) and the app's
 * token language — no new design system.
 *
 * Server components throughout; the only client islands a page mounts are the
 * shared thread-demo / interactive widgets it drops into `visual` slots.
 */

import Link from "next/link";
import { ArrowRight, Check, type LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Container } from "@/components/marketing/ui/container";
import { Reveal } from "@/components/marketing/ui/reveal";
import { Section } from "@/components/marketing/ui/section";
import { cn } from "@/lib/utils";

/* -------------------------------------------------------------------------- */
/* Hero — eyebrow → H1 → sub → CTA row → truth chips + one framed visual.      */
/* -------------------------------------------------------------------------- */

export function FeatureHero({
  eyebrow,
  title,
  sub,
  truthChips,
  visual,
}: {
  eyebrow: string;
  title: string;
  sub: string;
  /** Short, verifiable truth chips under the CTAs (no adjectives-as-stats). */
  truthChips: string[];
  /** The feature-specific product visual (live thread demo, widget, or DOM). */
  visual: React.ReactNode;
}) {
  return (
    <Container className="pb-8 pt-24 sm:pt-28">
      <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-16">
        <div>
          <p className="text-[13px] font-semibold text-primary">{eyebrow}</p>
          <h1 className="display-hero mt-4 text-balance text-foreground">
            {title}
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground">
            {sub}
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

          <ul className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-[13px] text-muted-foreground">
            {truthChips.map((chip) => (
              <li key={chip} className="flex items-center gap-1.5">
                <Check
                  className="size-3.5 shrink-0 text-primary"
                  strokeWidth={2}
                  aria-hidden
                />
                {chip}
              </li>
            ))}
          </ul>
        </div>

        <div className="relative">{visual}</div>
      </div>
    </Container>
  );
}

/* -------------------------------------------------------------------------- */
/* Alternating job-named content section (copy ↔ visual).                      */
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
  heading: string;
  /** Prose — one or more <p>/lists; the page supplies unique body copy. */
  children: React.ReactNode;
  visual?: React.ReactNode;
  /** When true, the visual sits on the LEFT (alternating rhythm, §1.4). */
  flip?: boolean;
  /** The one-of-two allowed stone→teal wash bands (§1.2). */
  wash?: boolean;
  id?: string;
}) {
  const copy = (
    <div className={cn(!visual && "mx-auto max-w-3xl")}>
      {eyebrow && (
        <p className="text-[13px] font-semibold text-primary">{eyebrow}</p>
      )}
      <h2 className={cn("display-h2 text-foreground", eyebrow && "mt-2")}>
        {heading}
      </h2>
      <div className="prose-feature mt-5 space-y-4 text-lg leading-relaxed text-muted-foreground">
        {children}
      </div>
    </div>
  );

  return (
    <Section
      id={id}
      bleed={wash}
      className={cn(
        wash &&
          "bg-gradient-to-b from-stone-50 to-teal-50 py-16 dark:from-background dark:to-teal-950/20 sm:py-24",
      )}
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
  copy: React.ReactNode;
  visual?: React.ReactNode;
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
/* Honest-details block — limits stated plainly (BLUEPRINT §4).                */
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
        <h2 className="display-h2 text-foreground">{heading}</h2>
        <p className="mt-5 text-lg leading-relaxed text-muted-foreground">
          {lead}
        </p>
        <dl className="mt-8 divide-y divide-border rounded-2xl border border-border bg-card">
          {items.map(({ term, detail }) => (
            <div key={term} className="p-5 sm:p-6">
              <dt className="text-[15px] font-semibold text-foreground">
                {term}
              </dt>
              <dd className="mt-1.5 text-[15px] leading-relaxed text-muted-foreground">
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
/* Feature-mapped strip — small icon rows tying the feature to the workflow.   */
/* -------------------------------------------------------------------------- */

export function FeatureStrip({
  heading,
  items,
}: {
  heading: string;
  items: { icon: LucideIcon; title: string; body: string }[];
}) {
  return (
    <Section>
      <h2 className="display-h2 text-foreground">{heading}</h2>
      <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item, i) => {
          const Icon = item.icon;
          return (
            <Reveal key={item.title} delay={Math.min(i, 3) * 60}>
              <div className="flex h-full flex-col rounded-[10px] border border-border bg-card p-5">
                <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Icon className="size-5" strokeWidth={1.75} aria-hidden />
                </span>
                <h3 className="mt-4 text-[16px] font-semibold text-foreground">
                  {item.title}
                </h3>
                <p className="mt-1.5 text-[14px] leading-relaxed text-muted-foreground">
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
/* Mini-pricing strip — the whole price list, compact (BLUEPRINT §4).          */
/* -------------------------------------------------------------------------- */

export function MiniPricing({ body }: { body: React.ReactNode }) {
  return (
    <Section
      bleed
      className="bg-gradient-to-b from-stone-50 to-teal-50 py-16 dark:from-background dark:to-teal-950/20 sm:py-24"
    >
      <Container>
        <div className="mx-auto max-w-3xl rounded-2xl border border-border bg-card p-6 sm:p-8">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-[40px] font-semibold leading-none tabular-nums text-foreground">
              $29
            </span>
            <span className="text-[15px] text-muted-foreground">
              /mo — the whole crew, month to month
            </span>
          </div>
          <div className="prose-feature mt-5 space-y-3 text-[15px] leading-relaxed text-muted-foreground">
            {body}
          </div>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Button asChild>
              <Link href="/signup">
                Start for $29
                <ArrowRight strokeWidth={1.75} aria-hidden />
              </Link>
            </Button>
            <Link
              href="/pricing"
              className="text-[15px] font-medium text-primary underline-offset-2 hover:underline"
            >
              See full pricing →
            </Link>
          </div>
        </div>
      </Container>
    </Section>
  );
}

/* -------------------------------------------------------------------------- */
/* Internal-link block — related trade + compare pages (BLUEPRINT §4/§11).     */
/* Every /features page links out to relevant trade pages and a comparison, so */
/* the four pages weave into the site's link graph instead of being dead ends. */
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
/* Page-specific FAQ — native <details>, NO FAQPage JSON-LD (§11.2).           */
/* Each feature page passes its own questions; no two pages share a Q or A.     */
/* -------------------------------------------------------------------------- */

export function FeatureFaq({
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
                <span
                  className="shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-45"
                  aria-hidden
                >
                  +
                </span>
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
/* Closing CTA band — the second allowed wash (BLUEPRINT §4).                   */
/* -------------------------------------------------------------------------- */

export function FeatureCta({
  heading,
  sub,
}: {
  heading: string;
  sub: string;
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
