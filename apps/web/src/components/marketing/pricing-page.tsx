/**
 * /pricing, v4 "FIRST RESPONSE" (DESIGN-DIRECTION v4 §6 PRICING template +
 * COPY-DECK v2 /pricing, copy verbatim; owner amendment 13). The trust
 * weapon: the most mono-dense page on the site, every cost on the page, and
 * a buy button instead of a sales call.
 *
 * Band order: Dateline Header ($58 FIRST MONTH (US) · $29 AFTER) → THE PLAN
 * BUILDER (the centerpiece per the 2026-07-07 owner ruling: pick a plan,
 * toggle the sellable add-ons, live totals from the shared constants,
 * the $29 US registration fee always a separate first-month line, CTA carries
 * the configuration into signup) → add-on fine print (#12 module model;
 * prices render from the shared catalog mirror so nothing can drift from
 * checkout) → crew-size slider (demoted below the builder; cobalt flat line
 * vs Flare climbing line) → Honesty Ledger with the day-one Truth Strip, the
 * first-week timeline (Flare YOU ARE HERE tab) and the usage-meter embed →
 * "the same crew, priced elsewhere" ledger (dated, per-cell sourced) → the
 * segment counter running the real billing code in a Panel Frame → guarantee
 * → pricing FAQ (9) → final CTA (Frost; the cobalt band is home-only).
 *
 * SoftwareApplication + BreadcrumbList JSON-LD only, NO FAQPage (dead rich
 * result). No em-dashes anywhere in rendered text (Law 6).
 *
 * #328 CURRENCY RULE, which the figures quoted above now obey: every US figure
 * on this page is USD and every Canada figure is CAD, and neither is typed. The
 * country branch IS the currency branch (pricing-data.ts explains why that is a
 * fact about the page rather than an assumption about the reader), and prose
 * that sits outside a branch uses <PlanPrice>, which reads the same site-wide
 * country signal. The one exception is `metadata`, which cannot follow a reader
 * it is resolved before; the note on STARTER_USD says so out loud.
 */

import Link from "next/link";

import {
  ConvergedField,
  CtaButton,
  Dateline,
  FrCard,
  FrSection,
  PanelFrame,
} from "@/components/marketing/fr";
import { PRIMARY_CTA_LABEL } from "@/components/marketing/nav-links";
import { CountryOnly, CountryText } from "@/components/marketing/country";
import { LedgerTable } from "@/components/marketing/compare/ledger-table";
import { CrewSizeSliderStatic } from "@/components/marketing/interactive/crew-size-slider-static";
import { LazyCrewSizeSlider } from "@/components/marketing/lazy/lazy-crew-size-slider";
import { PlanAddons } from "@/components/marketing/plan-addons";
import { CountryToggle } from "@/components/marketing/pricing/country-toggle";
import { FirstWeekTimeline } from "@/components/marketing/pricing/first-week-timeline";
import { HonestyLedger } from "@/components/marketing/pricing/honesty-ledger";
import { PlanBuilder } from "@/components/marketing/pricing/plan-builder";
import { PlanPrice } from "@/components/marketing/pricing/plan-price";
import { TruthStrip } from "@/components/marketing/pricing/truth-strip";
import { UsageMeterEmbed } from "@/components/marketing/pricing/usage-meter-embed";
import { JsonLd } from "@/components/marketing/ui/json-ld";
import { Reveal } from "@/components/marketing/ui/reveal";
import { breadcrumbJsonLd, softwareApplicationJsonLd } from "@/lib/marketing/seo";
import { APP_LINKS, LIVE_ROUTES } from "@/lib/marketing/site";
import { LazySegmentCounter } from "@/app/(marketing)/pricing/lazy-segment-counter";
import {
  elsewhereColumns,
  elsewhereFootnote,
  elsewhereRows,
  faqs,
  ledger,
  ledgerCa,
  planFairUseNote,
  plansFor,
  pricingDateline,
  pricingDatelineCa,
} from "@/app/(marketing)/pricing/pricing-data";
import { SegmentCounterStatic } from "@/app/(marketing)/pricing/segment-counter-static";
import { COMPARE_AS_OF } from "@/app/(marketing)/compare/verification";
import { activationChip } from "@/lib/marketing/activation";
import type { MarketingLocale } from "@/i18n/marketing/footer";
import { fill } from "@/i18n/marketing/home";
import { pricingCopy } from "@/i18n/marketing/pricing";

const PATH = LIVE_ROUTES.pricing;

function GuaranteeTick() {
  return (
    <span
      className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[color:var(--fr-green)]"
      aria-hidden
    >
      <svg viewBox="0 0 16 16" className="size-5" focusable="false">
        <path
          d="M3.5 8.5 6.5 11.5 12.5 4.5"
          fill="none"
          stroke="var(--fr-on-green)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

export function PricingPageBody({
  locale = "en",
}: {
  locale?: MarketingLocale;
}) {
  const copy = pricingCopy(locale);
  const french = locale === "fr-CA";
  return (
    <>
      <JsonLd
        data={[
          softwareApplicationJsonLd(),
          breadcrumbJsonLd([
            { name: copy.breadcrumbHome, path: french ? "/fr" : "/" },
            { name: copy.breadcrumbSelf, path: french ? "/fr/tarifs" : PATH },
          ]),
        ]}
      />

      {/* Dateline Header (§5.1): the chip is the page's load-bearing fact. */}
      <FrSection as="header" className="pb-6 md:pb-10">
        <div className="mx-auto max-w-3xl text-center">
          <ConvergedField variant="mark" className="mx-auto h-9 w-auto" />
          <div className="mt-6">
            {/* The load-bearing fact follows the site-wide country: a US visitor
                sees the $58-first-month-then-$29 arithmetic, a Canadian visitor
                the flat monthly price with no registration fee. Never paired. */}
            <Dateline>
              <CountryText
                us={pricingDateline(locale)}
                ca={pricingDatelineCa(locale)}
              />
            </Dateline>
          </div>
          <h1 className="fr-h1 mt-5 text-[color:var(--fr-ink)]">
            {copy.h1}
          </h1>
          <p className="fr-body mx-auto mt-6 max-w-2xl text-[color:var(--fr-ink-70)]">
            {copy.heroSub}
          </p>
        </div>
      </FrSection>

      {/* The plan section reads the single site-wide country (provided by the
          marketing layout), so the pricing toggle and the nav selector move the
          same state. The toggle branches only the country-specific facts: the
          registration fee line and the "first month" math in the builder
          receipt, and the activation timeline card below. Base and add-on prices
          never change (USD, plus tax). The default is US, so the whole section
          is server-rendered and complete without JavaScript. */}
      <>
        {/* THE PLAN BUILDER: the page's centerpiece (owner ruling 2026-07-07).
            Pick Starter or Pro, toggle the sellable add-ons, and the
            receipt totals live from the same shared constants checkout bills
            from. Server-rendered at its true default (Starter, no add-ons,
            $29/mo, $58 first month US), so the page is complete without JS. */}
        <FrSection ground="frost" id="build" className="pt-12 md:pt-16">
          <div className="mx-auto max-w-5xl">
            <h2 className="fr-h2 text-[color:var(--fr-ink)]">
              {copy.buildTitle}
            </h2>
            <p className="fr-body mt-4 max-w-2xl text-[color:var(--fr-ink-70)]">
              {copy.buildSub}
            </p>
            {/* The country toggle: US shops see the $29 registration fee and
                the carrier wait; Canadian businesses texting Canadian
                customers see neither. */}
            <CountryToggle className="mt-8" locale={locale} />
            <div className="mt-8">
              <PlanBuilder plans={plansFor("usd", locale)} locale={locale} />
            </div>
            {/* #85: the plan's allowances are a fair-use line, not a hard wall.
                This footnote is the plan-card fair-use reference the dynamic
                limits model leans on. */}
            <p className="mt-8 max-w-3xl text-[0.8125rem] leading-relaxed text-[color:var(--fr-ink-55)]">
              {planFairUseNote(locale)}{" "}
              <Link
                href={LIVE_ROUTES.fairUse}
                className="font-medium text-[color:var(--fr-olive)] underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--fr-olive)]"
              >
                {copy.fairUseLink}
              </Link>
            </p>
          </div>
        </FrSection>

        {/* Enterprise: the contact-sales tier for crews past Pro's 15 seats
            (#83). Deliberately NOT part of the interactive builder above (no
            self-serve checkout, no Stripe price) — a quiet "talk to us" card
            that keeps the flat, no-per-user promise at custom scale. */}
        <FrSection>
          <FrCard className="mx-auto flex max-w-3xl flex-col gap-6 p-6 md:flex-row md:items-center md:justify-between md:p-8">
            <div>
              <h2 className="fr-h3 text-[color:var(--fr-ink)]">
                {copy.enterpriseTitle}
              </h2>
              <p className="fr-body mt-2 max-w-xl text-[color:var(--fr-ink-70)]">
                {copy.enterpriseBody}
              </p>
            </div>
            <CtaButton
              href={LIVE_ROUTES.contact}
              variant="secondary"
              className="shrink-0"
            >
              {copy.enterpriseCta}
            </CtaButton>
          </FrCard>
        </FrSection>

        {/* The add-on fine print: the exact limits behind the builder toggles. */}
        <PlanAddons locale={locale} />

        {/* Crew-size slider (demoted below the builder per the owner ruling):
            the cobalt flat line vs the Flare climbing line. */}
        <FrSection ground="frost">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="fr-h2 text-[color:var(--fr-ink)]">
              {copy.sliderTitle}
            </h2>
          </div>
          <Reveal className="mx-auto mt-10 max-w-xl">
            <LazyCrewSizeSlider
              locale={locale}
              fallback={<CrewSizeSliderStatic locale={locale} />}
            />
          </Reveal>
        </FrSection>

        {/* The Honesty Ledger band: every cost, the day-one Truth Strip, the
            first-week timeline (country-aware), and the usage-meter embed. */}
        <FrSection>
          <div className="mx-auto max-w-3xl">
            <h2 className="fr-h2 text-[color:var(--fr-ink)]">
              {copy.ledgerTitle}
            </h2>

            {/* The cost list follows the site-wide country. A US visitor sees
                the $29 registration / $58-first-month row; a Canadian visitor
                sees the no-registration, no-fee row in its place, and never the
                US fee that doesn't apply to them (owner ruling v1). */}
            <Reveal className="mt-10">
              <CountryOnly country="us">
                <HonestyLedger entries={ledger(locale)} />
              </CountryOnly>
              <CountryOnly country="ca">
                <HonestyLedger entries={ledgerCa(locale)} />
              </CountryOnly>
            </Reveal>

            {/* The day-one truth (§5.4): what works now vs what waits, told for
                the visitor's own country. The US strip carries the honest
                carrier wait; the Canada strip carries the same-day story with no
                mention of a US wait that doesn't apply to them (owner ruling
                v1). Never paired in one strip. */}
            <CountryOnly country="us">
              <TruthStrip
                className="mt-6"
                items={[
                  {
                    text: copy.truthUsWorks,
                    good: true,
                  },
                  {
                    text: copy.truthUsWait,
                  },
                ]}
              />
            </CountryOnly>
            <CountryOnly country="ca">
              <TruthStrip
                className="mt-6"
                items={[
                  {
                    text: copy.truthCaWorks,
                    good: true,
                  },
                  {
                    text: copy.truthCaReceiving,
                    good: true,
                  },
                ]}
              />
            </CountryOnly>

            <Reveal className="mt-6">
              <FirstWeekTimeline locale={locale} />
            </Reveal>

            {/* The usage meter, staged with the app's own tokens (Law 2). */}
            <Reveal className="mt-10">
              <PanelFrame
                className="mx-auto max-w-md"
                caption={copy.meterCaption}
                ariaLabel={copy.meterAria}
              >
                <UsageMeterEmbed locale={locale} />
              </PanelFrame>
            </Reveal>
          </div>
        </FrSection>
      </>

      {/* "The same crew, priced elsewhere": dated, per-cell sourced. */}
      <FrSection ground="frost">
        <div className="mx-auto max-w-5xl">
          <h2 className="fr-h2 text-[color:var(--fr-ink)]">
            {copy.elsewhereTitle}
          </h2>
          <p className="fr-body mt-4 max-w-2xl text-[color:var(--fr-ink-70)]">
            {fill(copy.elsewhereIntroBefore, { asOf: COMPARE_AS_OF })}{" "}
            <Link
              href={LIVE_ROUTES.compareIndex}
              className="font-medium text-[color:var(--fr-olive)] underline-offset-2 hover:underline"
            >
              {copy.elsewhereIntroLink}
            </Link>
            {copy.elsewhereIntroAfter}
          </p>

          <Reveal className="mt-8">
            <LedgerTable
              caption={fill(copy.elsewhereTableCaption, {
                asOf: COMPARE_AS_OF,
              })}
              columns={elsewhereColumns(locale)}
              rows={elsewhereRows(locale)}
            />
          </Reveal>

          <p className="mt-4 text-[0.8125rem] leading-relaxed text-[color:var(--fr-ink-55)]">
            {elsewhereFootnote(locale)}
          </p>
        </div>
      </FrSection>

      {/* Text-length explainer + the counter running the real billing code,
          staged in a Panel Frame with the app's own tokens (Law 2). */}
      <FrSection>
        <div className="mx-auto grid max-w-4xl gap-10 lg:grid-cols-2 lg:items-center lg:gap-16">
          <div>
            <h2 className="fr-h2 text-[color:var(--fr-ink)]">
              {copy.segmentTitle}
            </h2>
            <p className="fr-body mt-5 text-[color:var(--fr-ink-70)]">
              {copy.segmentBody}
            </p>
          </div>
          <Reveal>
            <PanelFrame ariaLabel={copy.segmentAria}>
              <LazySegmentCounter
              locale={locale}
              fallback={<SegmentCounterStatic locale={locale} />}
            />
            </PanelFrame>
          </Reveal>
        </div>
      </FrSection>

      {/* Guarantee (green: something got handled). */}
      <FrSection ground="frost">
        <FrCard className="mx-auto max-w-3xl p-6 sm:p-10">
          <div className="flex gap-4">
            <GuaranteeTick />
            <div>
              <h2 className="fr-h3 text-[color:var(--fr-ink)]">
                {copy.guaranteeTitle}
              </h2>
              <p className="mt-4 text-[0.9375rem] leading-relaxed text-[color:var(--fr-ink-70)]">
                {copy.guaranteeBefore}{" "}
                <CountryText
                  us={copy.guaranteeUs}
                  ca={copy.guaranteeCa}
                />
                {copy.guaranteeAfter}{" "}
                <PlanPrice plan="starter" />.
              </p>
              <p className="mt-4">
                <Link
                  href={LIVE_ROUTES.refunds}
                  className="text-[0.9375rem] font-semibold text-[color:var(--fr-olive)] underline-offset-2 hover:underline"
                >
                  {copy.refundLink}
                </Link>
              </p>

              {/* #425. The block above answers "what if I hate it in week
                  one?". This answers "what if I leave in month eight?", which
                  is the objection actually live for a tradesperson who has
                  been burned by a contract before. It is not hypothetical
                  positioning: the dominant player in this category holds a D-
                  from the BBB, and the complaints are about billing after an
                  attempted cancellation and not being able to reach anybody.

                  Deliberately SECONDARY in weight, not a section of its own.
                  This reassures; it should not foreground leaving on the page
                  where somebody is deciding to start.

                  Every line is checkable against a shipped behaviour, which is
                  the whole point (#425 ask 4): cancel from billing settings
                  (#421), a human reachable inside the app (#382), and the
                  number told honestly (#413). The number sentence in
                  particular says the uncomfortable thing rather than the
                  comfortable one, because "the differentiator is honesty about
                  the exit, not a painless exit." */}
              <div className="mt-8 border-t border-[color:var(--fr-frost)] pt-6">
                <h3 className="fr-h4 text-[color:var(--fr-ink)]">
                  {copy.leaveTitle}
                </h3>
                <ul className="mt-3 space-y-2 text-[0.9375rem] leading-relaxed text-[color:var(--fr-ink-70)]">
                  <li>
                    {copy.leaveCancel}
                  </li>
                  <li>
                    {copy.leaveNoCharge}
                  </li>
                  <li>
                    {copy.leaveNumber}
                  </li>
                  <li>
                    {copy.leavePerson}
                  </li>
                </ul>
                <p className="mt-4">
                  <Link
                    href={LIVE_ROUTES.terms}
                    className="text-[0.9375rem] font-semibold text-[color:var(--fr-olive)] underline-offset-2 hover:underline"
                  >
                    {copy.termsLink}
                  </Link>
                </p>
              </div>
            </div>
          </div>
        </FrCard>
      </FrSection>

      {/* Pricing FAQ (9). Native <details>; separation is space and Frost,
          not rules (Law 10). Numbers in FAQ prose stay in the body face (the
          prose exception, §3). */}
      <FrSection>
        <div className="mx-auto max-w-3xl">
          <h2 className="fr-h2 text-center text-[color:var(--fr-ink)]">
            {copy.faqTitle}
          </h2>
          <div className="mt-12 space-y-3">
            {faqs(locale).map((item) => (
              <details
                key={item.q}
                className="group rounded-xl bg-[color:var(--fr-frost)]"
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-xl px-5 py-4 text-left text-[1.0625rem] font-medium text-[color:var(--fr-ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--fr-olive)] [&::-webkit-details-marker]:hidden">
                  {item.q}
                  <span
                    className="shrink-0 text-[color:var(--fr-ink-55)] transition-transform duration-200 group-open:rotate-45"
                    aria-hidden
                  >
                    +
                  </span>
                </summary>
                <p className="px-5 pb-5 text-[0.9375rem] leading-relaxed text-[color:var(--fr-ink-70)]">
                  {item.a}
                </p>
              </details>
            ))}
          </div>
        </div>
      </FrSection>

      {/* Final CTA (Frost; the one cobalt band lives on home only). */}
      <FrSection ground="frost" className="relative overflow-hidden">
        <ConvergedField
          variant="backdrop"
          className="pointer-events-none absolute inset-0 h-full w-full text-[color:var(--fr-olive)] opacity-[0.08]"
        />
        <div className="relative mx-auto max-w-3xl text-center">
          <h2 className="fr-h2 text-[color:var(--fr-ink)]">
            {copy.ctaTitle}
          </h2>
          <div className="mt-8 flex justify-center">
            <CtaButton href={APP_LINKS.signup} size="lg">
              {PRIMARY_CTA_LABEL}
            </CtaButton>
          </div>
          {/* #328 sweep, found while removing price literals: this line read
              "$Set up today". The `$` is a leftover from the "$29/mo" chip that
              ACTIVATION_CHIP replaced in #437, and it survived because a stray
              dollar sign in front of an interpolation looks like part of the
              interpolation. On a pricing page it is worse than a typo: it is a
              price mark attached to no price. */}
          <p className="fr-mono-data mt-5 text-[0.8125rem] text-[color:var(--fr-ink-55)]">
            {activationChip(locale)} {copy.ctaChipAfter}
          </p>
        </div>
      </FrSection>
    </>
  );
}
