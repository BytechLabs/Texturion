import { Check } from "lucide-react";
import Link from "next/link";

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
 */

/** A plan line item: plain segments render in the body face, `{ m }` segments
 *  render mono (the mono law: invoice-grade numbers wear Spline Sans Mono). */
export type PlanItemSegment = string | { m: string };
export type PlanItem = readonly PlanItemSegment[];

export interface HomePlan {
  name: string;
  price: string;
  badge?: string;
  audience: string;
  items: readonly PlanItem[];
  cta: string;
}

/** The plain string a line item spells (what a lawyer would read). */
export function planItemText(item: PlanItem): string {
  return item.map((s) => (typeof s === "string" ? s : s.m)).join("");
}

/** COPY-DECK v2 §S9, verbatim. */
export const HOME_PLANS: readonly HomePlan[] = [
  {
    name: "Starter",
    price: "$29",
    audience: "For crews of one to three.",
    items: [
      [{ m: "3" }, " teammates included"],
      [{ m: "1" }, " local business number"],
      [
        { m: "500" },
        " texts a month (a plain text up to ",
        { m: "160" },
        " characters is one; the composer shows the count before you send)",
      ],
      ["Receiving texts: free, unlimited"],
      ["Extra texts: ", { m: "3¢" }, " each, with a spending cap you control"],
    ],
    cta: "Start with Starter",
  },
  {
    name: "Pro",
    price: "$79",
    badge: "For bigger crews",
    audience: "For crews up to ten, and a second number.",
    items: [
      [{ m: "10" }, " teammates included"],
      [
        { m: "2" },
        " local business numbers (two locations, or office and field)",
      ],
      [{ m: "2,500" }, " texts a month (same count rule)"],
      ["Receiving texts: free, unlimited"],
      [
        "Extra texts: ",
        { m: "2.5¢" },
        " each, with a spending cap you control",
      ],
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
 *  the flat $29, same-day story. Never both together (owner ruling v1). The
 *  closing USD line is shared, so it stays in each set. */
export const DEAL_TRUTH_LINES_US = [
  {
    text: "US shops: $29 a month plus a one-time $29 to register with the phone companies. That's $58 your first month, then $29 every month after. The registration fee is charged once, ever.",
  },
  {
    text: "Day one you're not idle: receiving texts works right away. Texting US customers turns on in about a week, 3 to 7 business days, once the phone companies approve you.",
    tick: true,
  },
  {
    text: "Prices in USD, plus sales tax where it applies. That's the whole list.",
  },
] as const;

export const DEAL_TRUTH_LINES_CA = [
  {
    text: "Canadian shops: $29 a month, flat. No registration, no setup fee, no first-month bump; $29 is $29 from month one.",
  },
  {
    text: "Day one you're texting: your number is active and you can text Canadian customers the same day, usually a minute or two after signup. No waiting.",
    tick: true,
  },
  {
    text: "Prices in USD, plus sales tax where it applies. That's the whole list.",
  },
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

      <p className="mt-3">
        <MonoFigure value={plan.price} suffix="/mo" size="display" />
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

export function TheDeal() {
  return (
    <FrSection ground="frost" id="deal">
      <div className="max-w-2xl">
        <h2 className="fr-h2">One flat price for the whole crew.</h2>
        <p className="fr-body mt-4 text-[color:var(--fr-ink-70)]">
          No per-user fees. No quote calls. No annual contracts. This is the
          whole price list.
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

      <CountryOnly country="us">
        <TruthStrip
          className="mx-auto mt-10 max-w-4xl"
          lines={DEAL_TRUTH_LINES_US}
        />
      </CountryOnly>
      <CountryOnly country="ca">
        <TruthStrip
          className="mx-auto mt-10 max-w-4xl"
          lines={DEAL_TRUTH_LINES_CA}
        />
      </CountryOnly>

      <div className="mx-auto mt-14 grid max-w-5xl gap-10 lg:grid-cols-2 lg:gap-8">
        <div>
          <p className="font-body-mkt max-w-[52ch] text-[15px] leading-[1.65] text-[color:var(--fr-ink-70)]">
            Slide from 1 to 10 people and watch a typical per-user tool climb
            past Loonext&apos;s flat line.
          </p>
          <div className="mt-5">
            <LazyCrewSizeSlider fallback={<CrewSizeSliderStatic />} />
          </div>
        </div>

        <div>
          <p className="font-body-mkt max-w-[52ch] text-[15px] leading-[1.65] text-[color:var(--fr-ink-70)]">
            This is the usage meter you&apos;ll see in the app. You set the
            cap; we email you at 80% and 100%. No surprise bills.
          </p>
          <PanelFrame
            className="mt-5"
            ariaLabel="The Loonext usage meter partway through a billing period"
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
          className="font-body-mkt text-[0.9375rem] font-semibold text-[color:var(--fr-cobalt)] underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--fr-cobalt)]"
        >
          See full pricing. Every cost is on that page.
        </Link>
      </p>
    </FrSection>
  );
}
