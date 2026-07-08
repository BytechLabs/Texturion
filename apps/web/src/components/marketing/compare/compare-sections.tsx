/**
 * Shared skeletons for /compare and the three /compare/* pages, on the v4
 * "FIRST RESPONSE" identity (DESIGN-DIRECTION v4, BINDING). The COMPARE
 * template (§6): Dateline Header (the arithmetic) → Honesty Ledger centerpiece
 * (ledger-table.tsx) → slider chart (cobalt flat line vs Flare climbing line)
 * → "when they fit better" honest section → switching/porting Truth Strip →
 * CTA. No competitor logos, no dark patterns, no cheap shots.
 *
 * These carry the SKELETON only; every sentence is passed in per page, so the
 * three head-to-head pages share zero sentences (the no-shared-sentences
 * guard). Server components throughout; the only interactivity is the lazily
 * loaded crew-size slider island and native links.
 */

import type { ReactNode } from "react";

import {
  ConvergedField,
  CtaButton,
  Dateline,
  FrCard,
  FrSection,
} from "@/components/marketing/fr";
import {
  PRIMARY_CTA_LABEL,
  SECONDARY_CTA_LABEL,
} from "@/components/marketing/nav-links";
import { CrewSizeSliderStatic } from "@/components/marketing/interactive/crew-size-slider-static";
import { LazyCrewSizeSlider } from "@/components/marketing/lazy/lazy-crew-size-slider";
import {
  TruthStrip,
  type TruthStripItem,
} from "@/components/marketing/pricing/truth-strip";
import { Reveal } from "@/components/marketing/ui/reveal";
import { APP_LINKS, LIVE_ROUTES } from "@/lib/marketing/site";

/* -------------------------------------------------------------------------- */
/* Dateline header (§5.1): converged mark, the arithmetic chip, H1, lead, CTAs. */
/* -------------------------------------------------------------------------- */

export function CompareHero({
  dateline,
  title,
  lead,
}: {
  /** The page's load-bearing arithmetic, e.g. "$49/USER/MO · THEIR PUBLISHED STARTER SEAT". */
  dateline: string;
  title: string;
  lead: ReactNode;
}) {
  return (
    <FrSection as="header" className="pb-10 md:pb-14">
      <div className="mx-auto max-w-3xl text-center">
        <ConvergedField variant="mark" className="mx-auto h-9 w-auto" />
        <div className="mt-6">
          <Dateline>{dateline}</Dateline>
        </div>
        <h1 className="fr-h1 mt-5 text-[color:var(--fr-ink)]">{title}</h1>
        <p className="fr-body mx-auto mt-6 max-w-2xl text-[color:var(--fr-ink-70)]">
          {lead}
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row">
          <CtaButton href={APP_LINKS.signup}>{PRIMARY_CTA_LABEL}</CtaButton>
          <CtaButton href={LIVE_ROUTES.pricing} variant="secondary">
            {SECONDARY_CTA_LABEL}
          </CtaButton>
        </div>
      </div>
    </FrSection>
  );
}

/* -------------------------------------------------------------------------- */
/* Ledger band: the centerpiece section around a <LedgerTable>.                */
/* -------------------------------------------------------------------------- */

export function LedgerBand({
  heading,
  lead,
  children,
  footnote,
}: {
  heading: string;
  lead: ReactNode;
  children: ReactNode;
  footnote: ReactNode;
}) {
  return (
    <FrSection ground="frost">
      <div className="mx-auto max-w-5xl">
        <h2 className="fr-h2 text-[color:var(--fr-ink)]">{heading}</h2>
        <p className="fr-body mt-4 max-w-2xl text-[color:var(--fr-ink-70)]">
          {lead}
        </p>
        <Reveal className="mt-8">{children}</Reveal>
        <p className="mt-4 text-[0.8125rem] leading-relaxed text-[color:var(--fr-ink-55)]">
          {footnote}
        </p>
      </div>
    </FrSection>
  );
}

/* -------------------------------------------------------------------------- */
/* Slider chart band (§6): cobalt flat line vs the Flare climbing line.        */
/* -------------------------------------------------------------------------- */

export function SliderBand({
  heading,
  lead,
}: {
  heading: string;
  lead: ReactNode;
}) {
  return (
    <FrSection>
      <div className="mx-auto max-w-2xl text-center">
        <h2 className="fr-h2 text-[color:var(--fr-ink)]">{heading}</h2>
        <p className="fr-body mt-4 text-[color:var(--fr-ink-70)]">{lead}</p>
      </div>
      <Reveal className="mx-auto mt-10 max-w-xl">
        <LazyCrewSizeSlider fallback={<CrewSizeSliderStatic />} />
      </Reveal>
    </FrSection>
  );
}

/* -------------------------------------------------------------------------- */
/* "When they fit better": the honest-fit section, one band. Two "reach for"   */
/* cards, the explicit concession points, and the plain recommendation.        */
/* -------------------------------------------------------------------------- */

export function HonestFit({
  heading,
  intro,
  loonextTitle,
  loonextBody,
  competitorTitle,
  competitorBody,
  points,
  recommendation,
}: {
  heading: string;
  intro: ReactNode;
  loonextTitle: string;
  loonextBody: ReactNode;
  competitorTitle: string;
  competitorBody: ReactNode;
  points: { title: string; body: ReactNode }[];
  recommendation: ReactNode;
}) {
  return (
    <FrSection>
      <div className="mx-auto max-w-4xl">
        <h2 className="fr-h2 text-[color:var(--fr-ink)]">{heading}</h2>
        <p className="fr-body mt-4 max-w-2xl text-[color:var(--fr-ink-70)]">
          {intro}
        </p>

        <div className="mt-10 grid gap-6 md:grid-cols-2">
          <Reveal className="h-full">
            <FrCard className="h-full p-6 sm:p-8">
              <h3 className="fr-h3 text-[color:var(--fr-cobalt)]">
                {loonextTitle}
              </h3>
              <div className="mt-3 space-y-3 text-[0.9375rem] leading-relaxed text-[color:var(--fr-ink)]">
                {loonextBody}
              </div>
            </FrCard>
          </Reveal>
          <Reveal delay={60} className="h-full">
            <FrCard well className="h-full p-6 sm:p-8">
              <h3 className="fr-h3 text-[color:var(--fr-ink)]">
                {competitorTitle}
              </h3>
              <div className="mt-3 space-y-3 text-[0.9375rem] leading-relaxed text-[color:var(--fr-ink-70)]">
                {competitorBody}
              </div>
            </FrCard>
          </Reveal>
        </div>

        <ul className="mt-8 space-y-4">
          {points.map((point) => (
            <li key={point.title}>
              <FrCard well className="p-5">
                <p className="text-[0.9375rem] font-semibold text-[color:var(--fr-ink)]">
                  {point.title}
                </p>
                <p className="mt-1.5 text-[0.875rem] leading-relaxed text-[color:var(--fr-ink-70)]">
                  {point.body}
                </p>
              </FrCard>
            </li>
          ))}
        </ul>

        <FrCard className="mt-8 p-6">
          <p className="text-[0.9375rem] leading-relaxed text-[color:var(--fr-ink)]">
            {recommendation}
          </p>
        </FrCard>
      </div>
    </FrSection>
  );
}

/* -------------------------------------------------------------------------- */
/* Switching/porting Truth Strip band (§5.4): candor with a learnable shape.   */
/* -------------------------------------------------------------------------- */

export function SwitchBand({
  heading,
  lead,
  items,
}: {
  heading: string;
  lead: ReactNode;
  items: TruthStripItem[];
}) {
  return (
    <FrSection ground="frost">
      <div className="mx-auto max-w-3xl">
        <h2 className="fr-h2 text-[color:var(--fr-ink)]">{heading}</h2>
        <p className="fr-body mt-4 text-[color:var(--fr-ink-70)]">{lead}</p>
        {/* On the Frost band the strip sits in the white card voice so the
            cobalt edge + mono treatment stays legible (§5.4). */}
        <TruthStrip
          className="mt-8 bg-white shadow-[var(--fr-shadow-card)]"
          items={items}
        />
      </div>
    </FrSection>
  );
}

/* -------------------------------------------------------------------------- */
/* Final CTA band: white, quiet, one promise, one button, mono microcopy.      */
/* -------------------------------------------------------------------------- */

export function CompareCta({
  heading,
  sub,
}: {
  heading: string;
  sub: ReactNode;
}) {
  return (
    <FrSection>
      <div className="mx-auto max-w-3xl text-center">
        <h2 className="fr-h2 text-[color:var(--fr-ink)]">{heading}</h2>
        <p className="fr-body mx-auto mt-5 max-w-xl text-[color:var(--fr-ink-70)]">
          {sub}
        </p>
        <div className="mt-8 flex justify-center">
          <CtaButton href={APP_LINKS.signup} size="lg">
            {PRIMARY_CTA_LABEL}
          </CtaButton>
        </div>
        <p className="fr-eyebrow mt-5 text-[color:var(--fr-ink-55)]">
          $29/MO FLAT · MONTH TO MONTH · 30-DAY MONEY-BACK
        </p>
      </div>
    </FrSection>
  );
}
