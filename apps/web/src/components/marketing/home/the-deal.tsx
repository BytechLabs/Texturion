import { fill, homeCopy, type HomeCopy } from "@/i18n/marketing/home";
import type { MarketingLocale } from "@/i18n/marketing/footer";
import { Check } from "lucide-react";
import Link from "next/link";

import {
  formatMoney,
  PLAN_PRICE_CENTS,
  US_REGISTRATION_FEE_CENTS,
  type BillingCurrency,
} from "@loonext/shared";

import { CountryOnly, CountryText } from "@/components/marketing/country";
import {
  CtaButton,
  FrCard,
  FrSection,
  MonoFigure,
  PanelFrame,
} from "@/components/marketing/fr";
import { CrewSizeSliderStatic } from "@/components/marketing/interactive/crew-size-slider-static";
import { LazyCrewSizeSlider } from "@/components/marketing/lazy/lazy-crew-size-slider";
import { SIGNUP_HREF } from "@/components/marketing/nav-links";
import { AppSurface } from "@/components/marketing/thread-demo/app-surface";
import type { PlanId } from "@/lib/api/types";
import { LIVE_ROUTES } from "@/lib/marketing/site";

import { TruthStrip } from "./truth-strip";
import { UsageMeterEmbed } from "./usage-meter";

/**
 * S9 · THE DEAL (COPY-DECK v2, the pricing preview). Conversion job: remove
 * every pricing unknown so the only step left is the button.
 *
 * Plan cards (mono price-as-art figures), the deck's guarantee microcopy
 * under the pricing CTAs, the site-wide Truth Strip with the $58 first-month
 * arithmetic, the crew-size slider (cobalt flat line vs the whitelisted Flare
 * climbing line), and the real usage-meter pattern inside a PanelFrame with
 * app tokens (Law 2).
 *
 * Plan line items are segment arrays so every countable truth renders in the
 * mono voice (the mono law) while the tests read the same plain string
 * (`planItemText`), one source, no retyped facts.
 *
 * #328: and the prices are no longer facts this file knows. A card carries the
 * plan's ID and the price is read from the shared book at render, in the
 * currency the reader's country is billed in; the truth-strip arithmetic below
 * is derived the same way. The country branch IS the currency branch here (the
 * band already renders the US story and the Canada story as separate subtrees),
 * so no new control appears on the page and there is nothing a second one could
 * disagree with.
 */

/** A plan line item: plain segments render in the body face, `{ m }` segments
 *  render mono (the mono law: invoice-grade numbers wear Spline Sans Mono). */
export type PlanItemSegment = string | { m: string };
export type PlanItem = readonly PlanItemSegment[];

export interface HomePlan {
  /** The plan the card sells; its price is read from the book, never typed. */
  id: PlanId;
  name: string;
  badge?: string;
  audience: string;
  items: readonly PlanItem[];
  cta: string;
}

/** "$29" / "$39", from the price book. */
const price = (plan: PlanId, currency: BillingCurrency) =>
  formatMoney(PLAN_PRICE_CENTS[currency][plan], currency);

/** The one-time US registration fee, on the invoice it actually lands on. */
const registrationFee = (currency: BillingCurrency) =>
  formatMoney(US_REGISTRATION_FEE_CENTS[currency], currency);

/**
 * Plan plus the one-time fee: what a US shop pays in month one.
 *
 * Added rather than written. It is the only figure in the band that is a SUM,
 * so it is the only one that can go wrong while both of its parts stay right,
 * and "$58 your first month" is the sentence a reader checks against their
 * first statement.
 */
const firstMonth = (plan: PlanId, currency: BillingCurrency) =>
  formatMoney(
    PLAN_PRICE_CENTS[currency][plan] + US_REGISTRATION_FEE_CENTS[currency],
    currency,
  );

/** The plain string a line item spells (what a lawyer would read). */
export function planItemText(item: PlanItem): string {
  return item.map((s) => (typeof s === "string" ? s : s.m)).join("");
}

/** COPY-DECK v2 §S9, verbatim: the words. The price is not one of them. */
export const HOME_PLANS: readonly HomePlan[] = [
  {
    id: "starter",
    name: "Starter",
    audience: "For crews of one to three.",
    items: [
      [{ m: "3" }, " teammates included"],
      [{ m: "1" }, " local business number"],
      ["Send and receive texts and pictures*"],
    ],
    cta: "Start with Starter",
  },
  {
    id: "pro",
    name: "Pro",
    badge: "For bigger crews",
    audience: "For crews up to fifteen, and a second number.",
    items: [
      [{ m: "15" }, " teammates included"],
      [
        { m: "2" },
        " local business numbers (two locations, or office and field)",
      ],
      ["Send and receive texts and pictures*"],
    ],
    cta: "Start with Pro",
  },
];

/** The deck's §Global guarantee microcopy, under the pricing CTAs. US default
 *  (mentions the registration fee); the Canada variant drops it (there is none
 *  to refund). */
export const GUARANTEE_MICROCOPY =
  "30-day money-back guarantee. Full refund, including the registration fee. No fine print.";
export const GUARANTEE_MICROCOPY_CA =
  "30-day money-back guarantee. Full refund, no fine print.";

/** The Truth Strip lines branch on the site-wide country: a US visitor reads
 *  the one-time registration fee and the carrier wait; a Canadian visitor reads
 *  the flat monthly price, same-day story. Never both together (owner ruling
 *  v1). Each set is built with the currency its country is billed in, so the
 *  closing currency line is no longer the same sentence in both. */
export const dealTruthLinesUs = (copy: HomeCopy) =>
  [
    {
      text: fill(copy.dealTruthUsPrice, {
        starter: price("starter", "usd"),
        registration: registrationFee("usd"),
        firstMonth: firstMonth("starter", "usd"),
      }),
    },
    { text: copy.dealActivationUs, tick: true },
    { text: copy.dealTaxUs },
  ] as const;

export const dealTruthLinesCa = (copy: HomeCopy) =>
  [
    {
      text: fill(copy.dealTruthCaPrice, { starter: price("starter", "cad") }),
    },
    { text: copy.dealActivationCa, tick: true },
    // #328 rewrote this line rather than reprinting it. A strip that quoted a
    // Canadian price and then said "prices in USD" would be the same four
    // inches of the page contradicting itself, and the USD sentence is the half
    // that stopped being true when CAD billing shipped.
    { text: copy.dealTaxCa },
  ] as const;

function PlanCard({ plan }: { plan: HomePlan }) {
  return (
    <FrCard className="flex h-full flex-col p-6 sm:p-8">
      <div className="flex items-center justify-between gap-3">
        <h3 className="fr-h3 text-[color:var(--fr-ink)]">{plan.name}</h3>
        {plan.badge ? (
          <span className="fr-eyebrow rounded-[6px] bg-[color:var(--fr-frost)] px-2.5 py-1.5 text-[color:var(--fr-ink)]">
            {plan.badge}
          </span>
        ) : null}
      </div>

      {/* The price-as-art figure, in the reader's own money. The two branches
          are the same figure at the same scale, never both, and the qualifier
          that has to travel with a price (#385) is the audience line directly
          under it. A PlanCard is a server component, so the currency crosses
          the boundary as a branch rather than as a hook. */}
      <p className="mt-3">
        <CountryOnly country="us">
          <MonoFigure
            value={price(plan.id, "usd")}
            suffix="/mo"
            size="display"
          />
        </CountryOnly>
        <CountryOnly country="ca">
          <MonoFigure
            value={price(plan.id, "cad")}
            suffix="/mo"
            size="display"
          />
        </CountryOnly>
      </p>
      <p className="font-body-mkt mt-2 text-[15px] text-[color:var(--fr-ink-70)]">
        {plan.audience}
      </p>

      <ul className="mt-6 space-y-2.5">
        {plan.items.map((item) => (
          <li
            key={planItemText(item)}
            className="font-body-mkt flex items-start gap-2.5 text-[15px] leading-[1.55] text-[color:var(--fr-ink-70)]"
          >
            <span
              className="mt-[9px] size-1.5 shrink-0 rounded-full bg-[color:var(--fr-frost)]"
              aria-hidden
            />
            <span>
              {item.map((seg, i) =>
                typeof seg === "string" ? (
                  seg
                ) : (
                  <span key={i} className="fr-mono-data text-[color:var(--fr-ink)]">
                    {seg.m}
                  </span>
                ),
              )}
            </span>
          </li>
        ))}
      </ul>

      <div className="mt-auto pt-8">
        <CtaButton href={SIGNUP_HREF} className="w-full">
          {plan.cta}
        </CtaButton>
      </div>
    </FrCard>
  );
}

export function TheDeal({ locale = "en" }: { locale?: MarketingLocale } = {}) {
  const copy = homeCopy(locale);
  return (
    <FrSection ground="frost" id="deal">
      <div className="max-w-2xl">
        <h2 className="fr-h2">{copy.dealTitle}</h2>
        <p className="fr-body mt-4 text-[color:var(--fr-ink-70)]">
          {copy.dealSub}
        </p>
      </div>

      <div className="mx-auto mt-12 grid max-w-4xl items-stretch gap-6 md:grid-cols-2">
        {HOME_PLANS.map((plan) => (
          <PlanCard key={plan.name} plan={plan} />
        ))}
      </div>

      {/* The deck's guarantee microcopy, once, under both pricing CTAs
          (green tick: the news is good). The registration-fee clause is a US
          detail, so the Canada variant drops it. */}
      <p className="font-body-mkt mx-auto mt-6 flex max-w-4xl items-start justify-center gap-2 text-center text-sm text-[color:var(--fr-ink-70)]">
        <Check
          className="mt-0.5 size-4 shrink-0 text-[color:var(--fr-green)]"
          strokeWidth={2.5}
          aria-hidden
        />
        <CountryText us={GUARANTEE_MICROCOPY} ca={GUARANTEE_MICROCOPY_CA} />
      </p>

      {/* #121: the home page carries no allowance or per-text figures; the
          concrete mechanics live in one place, and this is the "*" the plan
          cards point to. */}
      <p className="font-body-mkt mx-auto mt-3 max-w-4xl text-center text-sm text-[color:var(--fr-ink-70)]">
        * Texting, pictures, and calling are included under an automated
        fair-use policy, and almost every crew stays well inside it.{" "}
        <Link
          href={LIVE_ROUTES.fairUse}
          className="font-semibold text-[color:var(--fr-olive)] underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--fr-olive)]"
        >
          {copy.dealFairUse}
        </Link>
      </p>

      {/* Enterprise escape hatch: Pro caps at 15, so a bigger crew needs to know
          the contact-sales tier exists (#83). One quiet line, not a third card. */}
      <p className="font-body-mkt mx-auto mt-4 max-w-4xl text-center text-sm text-[color:var(--fr-ink-70)]">
        More than 15 on the crew?{" "}
        <Link
          href={LIVE_ROUTES.contact}
          className="font-semibold text-[color:var(--fr-olive)] underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--fr-olive)]"
        >
          {copy.dealEnterprise}
        </Link>
        , unlimited seats at the same flat, no-per-user price.
      </p>

      <CountryOnly country="us">
        <TruthStrip
          className="mx-auto mt-10 max-w-4xl"
          lines={dealTruthLinesUs(copy)}
        />
      </CountryOnly>
      <CountryOnly country="ca">
        <TruthStrip
          className="mx-auto mt-10 max-w-4xl"
          lines={dealTruthLinesCa(copy)}
        />
      </CountryOnly>

      <div className="mx-auto mt-14 grid max-w-5xl gap-10 lg:grid-cols-2 lg:gap-8">
        <div>
          <p className="font-body-mkt max-w-[52ch] text-[15px] leading-[1.65] text-[color:var(--fr-ink-70)]">
            {copy.dealSliderCaption}
          </p>
          {/* #328: the slider's figures stay USD — the rival's rate is a
              published US price, and converting our half would subtract two
              currencies and print a saving nobody gets. What changes for a
              Canadian is the LABEL: an unlabelled "$79" sitting under a $109
              plan card made our own price look self-contradictory. The
              interactive twin reads the country itself; the static fallback
              cannot, so it is told. */}
          <div className="mt-5">
            <CountryOnly country="us">
              <LazyCrewSizeSlider
                fallback={<CrewSizeSliderStatic audience="usd" />}
              />
            </CountryOnly>
            <CountryOnly country="ca">
              <LazyCrewSizeSlider
                fallback={<CrewSizeSliderStatic audience="cad" />}
              />
            </CountryOnly>
          </div>
        </div>

        <div>
          <p className="font-body-mkt max-w-[52ch] text-[15px] leading-[1.65] text-[color:var(--fr-ink-70)]">
            {copy.dealMeterCaption}
          </p>
          <PanelFrame
            className="mt-5"
            ariaLabel={copy.dealMeterAria}
          >
            <AppSurface>
              <UsageMeterEmbed />
            </AppSurface>
          </PanelFrame>
        </div>
      </div>

      <p className="mt-12 text-center">
        <Link
          href={LIVE_ROUTES.pricing}
          className="font-body-mkt text-[0.9375rem] font-semibold text-[color:var(--fr-olive)] underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--fr-olive)]"
        >
          {copy.dealSeePricing}
        </Link>
      </p>
    </FrSection>
  );
}
