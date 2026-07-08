/**
 * /pricing, v4 "FIRST RESPONSE" (DESIGN-DIRECTION v4 §6 PRICING template +
 * COPY-DECK v2 /pricing, copy verbatim; owner amendment 13). The trust
 * weapon: the most mono-dense page on the site, every cost on the page, and
 * a buy button instead of a sales call.
 *
 * Band order: Dateline Header ($58 FIRST MONTH (US) · $29 AFTER) → THE PLAN
 * BUILDER (the centerpiece per the 2026-07-07 owner ruling: pick a plan,
 * toggle the three sellable add-ons, live totals from the shared constants,
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
 */

import Link from "next/link";
import type { Metadata } from "next";

import {
  ConvergedField,
  CtaButton,
  Dateline,
  FrCard,
  FrSection,
  PanelFrame,
} from "@/components/marketing/fr";
import { PRIMARY_CTA_LABEL } from "@/components/marketing/nav-links";
import { LedgerTable } from "@/components/marketing/compare/ledger-table";
import { CrewSizeSliderStatic } from "@/components/marketing/interactive/crew-size-slider-static";
import { LazyCrewSizeSlider } from "@/components/marketing/lazy/lazy-crew-size-slider";
import { PlanAddons } from "@/components/marketing/plan-addons";
import { CountryProvider } from "@/components/marketing/pricing/country-context";
import { CountryToggle } from "@/components/marketing/pricing/country-toggle";
import { FirstWeekTimeline } from "@/components/marketing/pricing/first-week-timeline";
import { HonestyLedger } from "@/components/marketing/pricing/honesty-ledger";
import { PlanBuilder } from "@/components/marketing/pricing/plan-builder";
import { TruthStrip } from "@/components/marketing/pricing/truth-strip";
import { UsageMeterEmbed } from "@/components/marketing/pricing/usage-meter-embed";
import { JsonLd } from "@/components/marketing/ui/json-ld";
import { Reveal } from "@/components/marketing/ui/reveal";
import {
  breadcrumbJsonLd,
  buildMetadata,
  softwareApplicationJsonLd,
} from "@/lib/marketing/seo";
import { APP_LINKS, LIVE_ROUTES } from "@/lib/marketing/site";

import { LazySegmentCounter } from "./lazy-segment-counter";
import {
  ELSEWHERE_COLUMNS,
  ELSEWHERE_FOOTNOTE,
  ELSEWHERE_ROWS,
  FAQS,
  LEDGER,
  PLANS,
  PRICING_DATELINE,
} from "./pricing-data";
import { SegmentCounterStatic } from "./segment-counter-static";

const PATH = LIVE_ROUTES.pricing;

export const metadata: Metadata = buildMetadata({
  title: "Pricing, $29/mo flat for the whole crew",
  description:
    "Build your plan and see the total before you pay: Starter $29/mo (3 people, 500 texts), Pro $79/mo (10 people, 2,500). Optional add-ons: picture messages $5, call forwarding $8, extra storage $5. One-time $29 US registration fee. No per-user fees, no quote calls.",
  path: PATH,
});

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
          stroke="#fff"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

export default function PricingPage() {
  return (
    <>
      <JsonLd
        data={[
          softwareApplicationJsonLd(),
          breadcrumbJsonLd([
            { name: "Home", path: "/" },
            { name: "Pricing", path: PATH },
          ]),
        ]}
      />

      {/* Dateline Header (§5.1): the chip is the page's load-bearing fact. */}
      <FrSection as="header" className="pb-6 md:pb-10">
        <div className="mx-auto max-w-3xl text-center">
          <ConvergedField variant="mark" className="mx-auto h-9 w-auto" />
          <div className="mt-6">
            <Dateline>{PRICING_DATELINE}</Dateline>
          </div>
          <h1 className="fr-h1 mt-5 text-[color:var(--fr-ink)]">
            One price for the whole crew. Nothing hidden.
          </h1>
          <p className="fr-body mx-auto mt-6 max-w-2xl text-[color:var(--fr-ink-70)]">
            Two plans, every cost on this page, and a buy button instead of a
            sales call. If you can&apos;t find a price on a texting
            company&apos;s pricing page, that&apos;s the price talking.
          </p>
        </div>
      </FrSection>

      {/* The plan section shares one country (US default, Canada one tap) so
          the toggle branches only the country-specific facts: the registration
          fee line and the "first month" math in the builder receipt, and the
          activation timeline card below. Base and add-on prices never change
          (USD, plus tax). The provider defaults to US, so the whole section is
          server-rendered and complete without JavaScript. */}
      <CountryProvider>
        {/* THE PLAN BUILDER: the page's centerpiece (owner ruling 2026-07-07).
            Pick Starter or Pro, toggle the three sellable add-ons, and the
            receipt totals live from the same shared constants checkout bills
            from. Server-rendered at its true default (Starter, no add-ons,
            $29/mo, $58 first month US), so the page is complete without JS. */}
        <FrSection ground="frost" id="build" className="pt-12 md:pt-16">
          <div className="mx-auto max-w-5xl">
            <h2 className="fr-h2 text-[color:var(--fr-ink)]">
              Build your plan. The total updates as you go.
            </h2>
            <p className="fr-body mt-4 max-w-2xl text-[color:var(--fr-ink-70)]">
              Pick a plan, switch on only what you need, and see the whole bill
              before you ever type a card number. What you build here is exactly
              what checkout starts from.
            </p>
            {/* The country toggle: US shops see the $29 registration fee and
                the carrier wait; Canadian businesses texting Canadian
                customers see neither. */}
            <CountryToggle className="mt-8" />
            <div className="mt-8">
              <PlanBuilder plans={PLANS} />
            </div>
          </div>
        </FrSection>

        {/* The add-on fine print: the exact limits behind the three toggles. */}
        <PlanAddons />

        {/* Crew-size slider (demoted below the builder per the owner ruling):
            the cobalt flat line vs the Flare climbing line. */}
        <FrSection ground="frost">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="fr-h2 text-[color:var(--fr-ink)]">
              Flat beats per-user. Slide to see by how much.
            </h2>
          </div>
          <Reveal className="mx-auto mt-10 max-w-xl">
            <LazyCrewSizeSlider fallback={<CrewSizeSliderStatic />} />
          </Reveal>
        </FrSection>

        {/* The Honesty Ledger band: every cost, the day-one Truth Strip, the
            first-week timeline (country-aware), and the usage-meter embed. */}
        <FrSection>
          <div className="mx-auto max-w-3xl">
            <h2 className="fr-h2 text-[color:var(--fr-ink)]">
              Every cost, before you pay.
            </h2>

            <Reveal className="mt-10">
              <HonestyLedger entries={LEDGER} />
            </Reveal>

            {/* The day-one truth (§5.4): what works now vs what waits. */}
            <TruthStrip
              className="mt-6"
              items={[
                {
                  text: "Receiving texts works the moment your number is ready, usually live in a minute or two. Texting Canadian numbers works immediately.",
                  good: true,
                },
                {
                  text: "Texting US numbers turns on after the phone companies approve you, typically 3 to 7 business days. We file everything and email you the moment you're approved.",
                },
              ]}
            />

            <Reveal className="mt-6">
              <FirstWeekTimeline />
            </Reveal>

            {/* The usage meter, staged with the app's own tokens (Law 2). */}
            <Reveal className="mt-10">
              <PanelFrame
                className="mx-auto max-w-md"
                caption="You set the cap; we email you at 80% and 100%. No surprise bills."
                ariaLabel="The usage meter: 212 of 500 texts used this billing period, with the alert marker at 80% and the owner-set spending cap"
              >
                <UsageMeterEmbed />
              </PanelFrame>
            </Reveal>
          </div>
        </FrSection>
      </CountryProvider>

      {/* "The same crew, priced elsewhere": dated, per-cell sourced. */}
      <FrSection ground="frost">
        <div className="mx-auto max-w-5xl">
          <h2 className="fr-h2 text-[color:var(--fr-ink)]">
            The same crew, priced elsewhere.
          </h2>
          <p className="fr-body mt-4 max-w-2xl text-[color:var(--fr-ink-70)]">
            A 3-person crew sending 500 single-segment texts a month, at
            published prices as of July 2026 (every number below cites its
            source on our{" "}
            <Link
              href={LIVE_ROUTES.compareIndex}
              className="font-medium text-[color:var(--fr-cobalt)] underline-offset-2 hover:underline"
            >
              comparison pages
            </Link>
            ):
          </p>

          <Reveal className="mt-8">
            <LedgerTable
              caption="Monthly cost for a 3-person crew sending 500 texts: Loonext next to Heymarket and Quo, at published prices as of July 2026."
              columns={ELSEWHERE_COLUMNS}
              rows={ELSEWHERE_ROWS}
            />
          </Reveal>

          <p className="mt-4 text-[0.8125rem] leading-relaxed text-[color:var(--fr-ink-55)]">
            {ELSEWHERE_FOOTNOTE}
          </p>
        </div>
      </FrSection>

      {/* Text-length explainer + the counter running the real billing code,
          staged in a Panel Frame with the app's own tokens (Law 2). */}
      <FrSection>
        <div className="mx-auto grid max-w-4xl gap-10 lg:grid-cols-2 lg:items-center lg:gap-16">
          <div>
            <h2 className="fr-h2 text-[color:var(--fr-ink)]">
              What&apos;s a &quot;text,&quot; exactly?
            </h2>
            <p className="fr-body mt-5 text-[color:var(--fr-ink-70)]">
              A plain text up to 160 characters counts as one text. Longer
              texts, or texts with emoji, count as more than one, the texting
              networks split them behind the scenes (the technical word is
              &quot;segments,&quot; but you never have to think about it). Your
              500 is 500 of these, and the composer always shows the count
              before you send, so there&apos;s no mystery on your bill.
            </p>
          </div>
          <Reveal>
            <PanelFrame ariaLabel="A message to Karen from Reyes Plumbing being counted: one text, 122 characters, plain">
              <LazySegmentCounter fallback={<SegmentCounterStatic />} />
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
                Try it for a month, on us if it&apos;s not for you.
              </h2>
              <p className="mt-4 text-[0.9375rem] leading-relaxed text-[color:var(--fr-ink-70)]">
                If Loonext isn&apos;t right for your crew, email us within 30
                days of signing up and we&apos;ll refund your first invoice in
                full, subscription and registration fee included. No
                &quot;minus credits used&quot;, no forms, no retention call.
                We&apos;d rather have your trust than your $29.
              </p>
              <p className="mt-4">
                <Link
                  href={LIVE_ROUTES.refunds}
                  className="text-[0.9375rem] font-semibold text-[color:var(--fr-cobalt)] underline-offset-2 hover:underline"
                >
                  Read the whole policy. It&apos;s three paragraphs.
                </Link>
              </p>
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
            Pricing questions, straight answers.
          </h2>
          <div className="mt-12 space-y-3">
            {FAQS.map((item) => (
              <details
                key={item.q}
                className="group rounded-xl bg-[color:var(--fr-frost)]"
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-xl px-5 py-4 text-left text-[1.0625rem] font-medium text-[color:var(--fr-ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--fr-cobalt)] [&::-webkit-details-marker]:hidden">
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
          className="pointer-events-none absolute inset-0 h-full w-full text-[color:var(--fr-cobalt)] opacity-[0.08]"
        />
        <div className="relative mx-auto max-w-3xl text-center">
          <h2 className="fr-h2 text-[color:var(--fr-ink)]">
            You&apos;ve seen the whole price list. That&apos;s the point.
          </h2>
          <div className="mt-8 flex justify-center">
            <CtaButton href={APP_LINKS.signup} size="lg">
              {PRIMARY_CTA_LABEL}
            </CtaButton>
          </div>
          <p className="fr-mono-data mt-5 text-[0.8125rem] text-[color:var(--fr-ink-55)]">
            Live in minutes · Month to month · 30-day money-back guarantee
          </p>
        </div>
      </FrSection>
    </>
  );
}
