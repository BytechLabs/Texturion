/**
 * Feature-page building blocks (features crew), the v4 "FIRST RESPONSE"
 * FEATURE template (DESIGN-DIRECTION v4 §6):
 *
 *   Dateline Header → one large Panel Frame with the capability's real
 *   component staged mid-task → use-case blocks (Numbered Steps) → Truth
 *   Strip for any honest limitation → pricing snippet → feature FAQ → CTA
 *   band (Frost, never cobalt: the one cobalt band is home-only, Law 3).
 *
 * Everything assembles from the FR kit primitives (§5); nothing bespoke.
 * The four /features/* pages and /canada share this skeleton but ZERO copy:
 * every page passes its own hand-written content (the scaled-content guard).
 *
 * Law 6: no em-dashes anywhere in rendered strings. Law 10: no hairline
 * rules; separation is space, radius, and the Frost wash. Law 1: nothing in
 * here talks about the site as an artifact.
 *
 * Server components throughout.
 */

import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import type { ReactNode } from "react";

import { CountryText } from "@/components/marketing/country";
import {
  ConvergedField,
  CtaButton,
  Dateline,
  Eyebrow,
  FrCard,
  FrSection,
  MonoFigure,
} from "@/components/marketing/fr";
import {
  PRIMARY_CTA_LABEL,
  SECONDARY_CTA_LABEL,
  SIGNUP_HREF,
} from "@/components/marketing/nav-links";
import { cn } from "@/lib/utils";

/* -------------------------------------------------------------------------- */
/* DATELINE HEADER (§5.1): the static converged-arrival mark, the ink fact    */
/* chip, H1, sub, CTA row, and the page's large Panel Frame on the right.     */
/* -------------------------------------------------------------------------- */

export function FeatureHero({
  dateline,
  title,
  sub,
  panel,
}: {
  /** The page's load-bearing fact (coverage map), e.g. "1 OWNER PER CONVERSATION". */
  dateline: string;
  title: ReactNode;
  sub: ReactNode;
  /** The capability's real component staged mid-task, inside a <PanelFrame>. */
  panel: ReactNode;
}) {
  return (
    <FrSection
      className="pt-10 md:pt-16"
      containerClassName="grid items-center gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.95fr)] lg:gap-16"
    >
      <div>
        {/* The sole decorative page-header mark on subpages (Law 3): the
            static converged Arrival Field derivative. */}
        <ConvergedField variant="mark" className="h-8 w-auto" />
        <div className="mt-5">
          <Dateline>{dateline}</Dateline>
        </div>
        <h1 className="fr-h1 mt-5 text-[color:var(--fr-ink)]">{title}</h1>
        <p className="fr-body mt-6 max-w-xl text-[color:var(--fr-ink-70)]">
          {sub}
        </p>
        <div className="mt-8 flex flex-col gap-4 sm:flex-row sm:items-center">
          <CtaButton href={SIGNUP_HREF} size="lg">
            {PRIMARY_CTA_LABEL}
          </CtaButton>
          <CtaButton href="/pricing" variant="secondary" size="lg">
            {SECONDARY_CTA_LABEL}
          </CtaButton>
        </div>
      </div>
      <div>{panel}</div>
    </FrSection>
  );
}

/* -------------------------------------------------------------------------- */
/* Content band: eyebrow + H2 + prose, with an optional visual column.        */
/* Bands alternate white and Frost (Law 10: ground changes, never rules).     */
/* -------------------------------------------------------------------------- */

export function FeatureSection({
  ground = "white",
  eyebrow,
  heading,
  children,
  visual,
  flip = false,
  id,
}: {
  ground?: "white" | "frost";
  eyebrow?: string;
  heading: ReactNode;
  /** Prose paragraphs; the page supplies unique body copy. */
  children: ReactNode;
  visual?: ReactNode;
  /** When true, the visual sits on the LEFT (alternating rhythm). */
  flip?: boolean;
  id?: string;
}) {
  const copy = (
    <div className={cn(!visual && "mx-auto max-w-3xl")}>
      {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
      <h2 className={cn("fr-h2 text-[color:var(--fr-ink)]", eyebrow && "mt-4")}>
        {heading}
      </h2>
      <div className="fr-body mt-5 space-y-4 text-[color:var(--fr-ink-70)]">
        {children}
      </div>
    </div>
  );

  return (
    <FrSection ground={ground} id={id}>
      {visual ? (
        <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
          <div className={cn(flip && "lg:order-2")}>{copy}</div>
          <div className={cn(flip && "lg:order-1")}>{visual}</div>
        </div>
      ) : (
        copy
      )}
    </FrSection>
  );
}

/* -------------------------------------------------------------------------- */
/* NUMBERED STEPS (§5.5): use-case blocks with mono numerals in cobalt        */
/* circles, on the Frost band as white cards.                                 */
/* -------------------------------------------------------------------------- */

export function UseCaseSteps({
  eyebrow,
  heading,
  lead,
  steps,
  ground = "frost",
}: {
  eyebrow?: string;
  heading: ReactNode;
  lead?: string;
  steps: { title: string; body: string }[];
  ground?: "white" | "frost";
}) {
  return (
    <FrSection ground={ground}>
      <div className="max-w-3xl">
        {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
        <h2 className={cn("fr-h2 text-[color:var(--fr-ink)]", eyebrow && "mt-4")}>
          {heading}
        </h2>
        {lead && (
          <p className="fr-body mt-5 text-[color:var(--fr-ink-70)]">{lead}</p>
        )}
      </div>
      <ol className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {steps.map((step, i) => (
          <FrCard as="li" key={step.title} className="p-6">
            <span
              className="fr-mono-data flex size-8 items-center justify-center rounded-full bg-[color:var(--fr-cobalt)] text-white"
              aria-hidden
            >
              {i + 1}
            </span>
            <h3 className="fr-h3 mt-4 text-[color:var(--fr-ink)]">
              {step.title}
            </h3>
            <p className="font-body-mkt mt-2 text-[15px] leading-relaxed text-[color:var(--fr-ink-70)]">
              {step.body}
            </p>
          </FrCard>
        ))}
      </ol>
    </FrSection>
  );
}

/* -------------------------------------------------------------------------- */
/* TRUTH STRIP (§5.4): the one repeated component for every honesty claim,    */
/* site-wide, so candor has a learnable shape: Frost ground, 3px cobalt left  */
/* edge, mono text, green tick where the news is good.                        */
/* -------------------------------------------------------------------------- */

export interface TruthItem {
  text: string;
  /** Green tick: only when something got handled (the green whitelist). */
  good?: boolean;
}

export function TruthStrip({
  items,
  className,
}: {
  items: TruthItem[];
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-r-xl border-l-[3px] border-[color:var(--fr-cobalt)] bg-[color:var(--fr-frost)] px-5 py-4",
        className,
      )}
    >
      <ul className="space-y-3">
        {items.map((item) => (
          <li key={item.text} className="flex items-start gap-2.5">
            {item.good ? (
              <Check
                className="mt-0.5 size-4 shrink-0 text-[color:var(--fr-green)]"
                strokeWidth={2.5}
                aria-hidden
              />
            ) : (
              <span
                className="mt-[7px] size-1.5 shrink-0 rounded-full bg-[color:var(--fr-ink-55)]"
                aria-hidden
              />
            )}
            <span className="fr-mono-data leading-relaxed text-[color:var(--fr-ink)]">
              {item.text}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A Truth Strip in its own band, for the template's honest-limitation slot. */
export function TruthStripSection({
  heading,
  items,
  ground = "white",
}: {
  heading?: string;
  items: TruthItem[];
  ground?: "white" | "frost";
}) {
  return (
    <FrSection ground={ground} className="py-10 md:py-14">
      <div className="mx-auto max-w-3xl">
        {heading && (
          <h2 className="fr-h3 mb-4 text-[color:var(--fr-ink)]">{heading}</h2>
        )}
        <TruthStrip items={items} />
      </div>
    </FrSection>
  );
}

/* -------------------------------------------------------------------------- */
/* Plain-words details: the page's precise edges (limits stated plainly),     */
/* as Frost card wells. Facts live here so honesty survives redesigns.        */
/* -------------------------------------------------------------------------- */

export function PlainDetails({
  heading,
  lead,
  items,
  ground = "white",
}: {
  heading: string;
  lead?: string;
  items: { term: string; detail: string }[];
  ground?: "white" | "frost";
}) {
  return (
    <FrSection ground={ground}>
      <div className="mx-auto max-w-3xl">
        <h2 className="fr-h2 text-[color:var(--fr-ink)]">{heading}</h2>
        {lead && (
          <p className="fr-body mt-5 text-[color:var(--fr-ink-70)]">{lead}</p>
        )}
        <dl className="mt-8 space-y-4">
          {items.map(({ term, detail }) => (
            <FrCard key={term} well className="p-5 sm:p-6">
              <dt className="font-body-mkt text-[15px] font-semibold text-[color:var(--fr-ink)]">
                {term}
              </dt>
              <dd className="font-body-mkt mt-1.5 text-[15px] leading-relaxed text-[color:var(--fr-ink-70)]">
                {detail}
              </dd>
            </FrCard>
          ))}
        </dl>
      </div>
    </FrSection>
  );
}

/* -------------------------------------------------------------------------- */
/* Pricing snippet: the whole price list, compact, price as art (the mono     */
/* law), with the deck's guarantee microcopy under the CTAs.                  */
/* -------------------------------------------------------------------------- */

export function PricingSnippet({ children }: { children: ReactNode }) {
  return (
    <FrSection ground="frost">
      <FrCard className="mx-auto max-w-3xl p-6 sm:p-10">
        <MonoFigure value="$29" suffix="/mo · the whole crew" size="display" />
        <div className="font-body-mkt mt-5 space-y-3 text-[15px] leading-relaxed text-[color:var(--fr-ink-70)]">
          {children}
        </div>
        <div className="mt-7 flex flex-col gap-4 sm:flex-row sm:items-center">
          <CtaButton href={SIGNUP_HREF}>{PRIMARY_CTA_LABEL}</CtaButton>
          <CtaButton href="/pricing" variant="secondary">
            {SECONDARY_CTA_LABEL}
          </CtaButton>
        </div>
        <p className="font-body-mkt mt-5 flex items-start gap-2 text-[13px] text-[color:var(--fr-ink-55)]">
          <Check
            className="mt-0.5 size-3.5 shrink-0 text-[color:var(--fr-green)]"
            strokeWidth={2.5}
            aria-hidden
          />
          <CountryText
            us="30-day money-back guarantee. Full refund, including the registration fee. No fine print."
            ca="30-day money-back guarantee. Full refund, no fine print."
          />
        </p>
      </FrCard>
    </FrSection>
  );
}

/* -------------------------------------------------------------------------- */
/* Related links: trades, features, compares. Every href a real route.        */
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
    <FrSection>
      <div className="mx-auto max-w-4xl">
        <h2 className="fr-h2 text-[color:var(--fr-ink)]">{heading}</h2>
        <p className="fr-body mt-4 max-w-2xl text-[color:var(--fr-ink-70)]">
          {intro}
        </p>
        <ul className="mt-8 grid gap-4 sm:grid-cols-2">
          {links.map((link) => (
            <li key={link.href + link.label}>
              <Link
                href={link.href}
                className="group flex h-full items-start justify-between gap-4 rounded-xl bg-[color:var(--fr-frost)] p-5 transition-colors duration-200 ease-out hover:bg-[color:var(--fr-card)] hover:shadow-[var(--fr-shadow-card)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--fr-cobalt)]"
              >
                <span>
                  <span className="font-body-mkt text-[15px] font-semibold text-[color:var(--fr-ink)]">
                    {link.label}
                  </span>
                  <span className="font-body-mkt mt-1 block text-[13px] leading-relaxed text-[color:var(--fr-ink-70)]">
                    {link.hint}
                  </span>
                </span>
                <ArrowRight
                  className="mt-0.5 size-4 shrink-0 text-[color:var(--fr-cobalt)] opacity-0 transition-all duration-200 ease-out group-hover:translate-x-0.5 group-hover:opacity-100"
                  strokeWidth={1.75}
                  aria-hidden
                />
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </FrSection>
  );
}

/* -------------------------------------------------------------------------- */
/* Page-specific FAQ: native <details>, Frost wells, no hairlines (Law 10).   */
/* -------------------------------------------------------------------------- */

export function FeatureFaq({
  heading,
  faqs,
}: {
  heading: ReactNode;
  faqs: { q: string; a: ReactNode }[];
}) {
  return (
    <FrSection>
      <div className="mx-auto max-w-3xl">
        <h2 className="fr-h2 text-[color:var(--fr-ink)]">{heading}</h2>
        <div className="mt-10 space-y-3">
          {faqs.map((item) => (
            <details
              key={item.q}
              className="group rounded-xl bg-[color:var(--fr-frost)] px-5"
            >
              <summary className="font-body-mkt flex cursor-pointer list-none items-center justify-between gap-4 py-4 text-left text-[16px] font-semibold text-[color:var(--fr-ink)] [&::-webkit-details-marker]:hidden">
                {item.q}
                <span
                  className="shrink-0 text-[color:var(--fr-ink-55)] transition-transform duration-200 ease-out group-open:rotate-45"
                  aria-hidden
                >
                  +
                </span>
              </summary>
              <div className="font-body-mkt pb-5 pr-8 text-[15px] leading-relaxed text-[color:var(--fr-ink-70)]">
                {item.a}
              </div>
            </details>
          ))}
        </div>
      </div>
    </FrSection>
  );
}

/* -------------------------------------------------------------------------- */
/* Closing CTA band: Frost, never cobalt (the one cobalt band is home-only).  */
/* -------------------------------------------------------------------------- */

export function FeatureCta({
  heading,
  sub,
}: {
  heading: ReactNode;
  sub: string;
}) {
  return (
    <FrSection ground="frost">
      <div className="mx-auto max-w-3xl text-center">
        <h2 className="fr-h2 text-[color:var(--fr-ink)]">{heading}</h2>
        <p className="fr-body mx-auto mt-5 max-w-xl text-[color:var(--fr-ink-70)]">
          {sub}
        </p>
        <div className="mt-8 flex justify-center">
          <CtaButton href={SIGNUP_HREF} size="lg">
            {PRIMARY_CTA_LABEL}
          </CtaButton>
        </div>
        <p className="fr-eyebrow mt-6 text-[color:var(--fr-ink-55)]">
          $29/MO FLAT · MONTH TO MONTH · 30-DAY MONEY-BACK
        </p>
      </div>
    </FrSection>
  );
}
