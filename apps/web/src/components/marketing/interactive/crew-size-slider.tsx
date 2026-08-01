"use client";

/**
 * Crew-size slider, v4 "FIRST RESPONSE" (DESIGN-DIRECTION §6 COMPARE/PRICING;
 * COPY-DECK v2 §S9). Drag 1 to 10 people and watch a typical per-user tool's
 * line climb past Loonext's flat line.
 *
 * Color law: the Loonext flat line is COBALT (§2, named cobalt use); the
 * rival's climbing line is FLARE (whitelist §3.4.5, a non-text mark). The
 * figures themselves are mono ink (the mono law, §3); Flare never carries
 * text below 24px bold.
 *
 * The per-user figure is REAL, labeled, and dated: a leading tool's published
 * monthly Starter seat price, $19/user/mo as of July 2026, sourced in full on
 * /compare/quo (that tool also bills texting separately, so the comparison is
 * conservative in Loonext's favor). Loonext follows SPEC §2: up to 3 people =
 * Starter $29, 4 and up = Pro $79 (Pro seats up to 15; unlimited is the
 * contact-sales Enterprise tier), both flat.
 *
 * Keyboard-accessible (native range input), tabular numerals, aria-live.
 */

import { useId, useState } from "react";

import { APP_LINKS, LIVE_ROUTES } from "@/lib/marketing/site";
import { PLAN_PRICING } from "@/lib/api/types";
import { COMPARE_AS_OF } from "@/app/(marketing)/compare/verification";

/** The published monthly Starter seat price of a leading per-user tool (July 2026). */
/**
 * #370 — the rival's seat rate is a PROP, not a constant.
 *
 * It was `const perUserMonthly = 19`, written for the Quo comparison where
 * $19 is right, and then reused verbatim on the Heymarket page where the rate
 * is $49 with a two-seat minimum. That page's prose correctly said "$98 floor"
 * while the chart underneath drew $19/user — the page argued against itself,
 * and it understated a competitor by 2.6x.
 *
 * Understating a rival is the safe direction to be wrong in legally, and it is
 * still wrong: it is a dated, sourced, public claim about somebody else's
 * price, and `compare-facts.test.ts` exists precisely because those rot. The
 * rate now travels with the page that states it, and a test ties each page's
 * slider to the ledger beside it.
 *
 * The MINIMUM matters as much as the rate. Heymarket will not sell one seat, so
 * a solo operator pays for two — which is invisible in any comparison that
 * starts at three people, and is the single most surprising number on the page.
 */
export const DEFAULT_PER_USER_MONTHLY = 19;
export const DEFAULT_MINIMUM_SEATS = 1;

/** Largest crew the slider illustrates. A fixed marketing range, decoupled from
 *  the plan seat caps (Starter 3, Pro 15) — the slider only shows the flat-vs-
 *  per-user story, not the caps. */
export const MAX_CREW = 10;

/** Starter's included seats — the flat-price threshold the slider draws. */
const STARTER_SEATS = PLAN_PRICING.starter.seats;

/**
 * Loonext's flat plan for a crew of `seats`, sourced from PLAN_PRICING (never
 * retyped): up to Starter's seat count = Starter, above it = Pro. Both flat.
 */
export function loonextPrice(
  seats: number,
): { plan: "Starter" | "Pro"; price: number } {
  return seats <= STARTER_SEATS
    ? { plan: "Starter", price: PLAN_PRICING.starter.monthlyDollars }
    : { plan: "Pro", price: PLAN_PRICING.pro.monthlyDollars };
}

function usd(n: number): string {
  return `$${n.toLocaleString("en-US")}`;
}

export interface RivalSeatPricing {
  /** Their published per-user monthly rate, as the ledger states it. */
  perUserMonthly?: number;
  /** The fewest seats they will sell. A floor, not a discount. */
  minimumSeats?: number;
}

export function CrewSizeSlider({
  perUserMonthly = DEFAULT_PER_USER_MONTHLY,
  minimumSeats = DEFAULT_MINIMUM_SEATS,
}: RivalSeatPricing = {}) {
  const [seats, setSeats] = useState(6);
  const sliderId = useId();

  const loonext = loonextPrice(seats);
  const perUser = Math.max(seats, minimumSeats) * perUserMonthly;
  const savings = perUser - loonext.price;

  // Bar widths are relative to the max the per-user line reaches at full crew.
  const maxPerUser = MAX_CREW * perUserMonthly;
  const loonextWidth = Math.max(6, (loonext.price / maxPerUser) * 100);
  const perUserWidth = Math.max(6, (perUser / maxPerUser) * 100);

  return (
    <div className="fr-card p-6">
      <label
        htmlFor={sliderId}
        className="flex items-baseline justify-between text-[0.875rem] font-semibold text-[color:var(--fr-ink)]"
      >
        <span>People on your crew</span>
        <span className="fr-mono-data text-2xl text-[color:var(--fr-ink)]">
          {seats}
        </span>
      </label>
      <input
        id={sliderId}
        type="range"
        min={1}
        max={MAX_CREW}
        step={1}
        value={seats}
        onChange={(e) => setSeats(Number(e.target.value))}
        aria-valuetext={`${seats} ${seats === 1 ? "person" : "people"}`}
        className="mt-3 h-1.5 w-full cursor-pointer appearance-none rounded-full bg-[color:var(--fr-frost)] accent-[color:var(--fr-olive)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--fr-olive)]"
      />
      <div className="fr-mono-data mt-1 flex justify-between text-[0.6875rem] text-[color:var(--fr-ink-55)]">
        <span>1</span>
        <span>{MAX_CREW}</span>
      </div>

      <div className="mt-6 space-y-4" aria-live="polite">
        {/* Loonext: the cobalt flat line. */}
        <div>
          <div className="flex items-baseline justify-between gap-3 text-[0.875rem]">
            <span className="font-medium text-[color:var(--fr-ink)]">
              Loonext {loonext.plan}
            </span>
            <span className="whitespace-nowrap">
              <span className="fr-mono-data text-[color:var(--fr-ink)]">
                {usd(loonext.price)}/mo
              </span>
              <span className="text-[color:var(--fr-ink-55)]">, flat</span>
            </span>
          </div>
          <div className="mt-1.5 h-3 w-full overflow-hidden rounded-full bg-[color:var(--fr-frost)]">
            <div
              className="h-full rounded-full bg-[color:var(--fr-olive)] transition-[width] duration-200 ease-out"
              style={{ width: `${loonextWidth}%` }}
            />
          </div>
        </div>

        {/* The rival: the Flare climbing line (§3.4.5, non-text mark). */}
        <div>
          <div className="flex items-baseline justify-between gap-3 text-[0.875rem]">
            <span className="font-medium text-[color:var(--fr-ink)]">
              Typical per-user tool at {usd(perUserMonthly)}/user/mo
            </span>
            <span className="whitespace-nowrap">
              <span className="fr-mono-data text-[color:var(--fr-ink)]">
                {usd(perUser)}/mo
              </span>
              <span className="text-[color:var(--fr-ink-55)]">
                {seats > 1 ? ", and climbing" : ""}
              </span>
            </span>
          </div>
          <div className="mt-1.5 h-3 w-full overflow-hidden rounded-full bg-[color:var(--fr-frost)]">
            <div
              className="h-full rounded-full bg-[color:var(--fr-flare)] transition-[width] duration-200 ease-out"
              style={{ width: `${perUserWidth}%` }}
            />
          </div>
        </div>
      </div>

      {savings > 0 && (
        <p className="mt-5 text-[0.9375rem] text-[color:var(--fr-ink)]">
          At {seats} people, that&apos;s{" "}
          <span className="fr-mono-data text-[color:var(--fr-ink)]">
            {usd(savings)} less a month
          </span>{" "}
          with Loonext, {usd(loonext.price)} flat instead of {seats} ×{" "}
          {usd(perUserMonthly)}.
        </p>
      )}

      <a
        href={APP_LINKS.signup}
        className="mt-4 inline-flex items-center gap-1 text-[0.9375rem] font-semibold text-[color:var(--fr-olive)] underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--fr-olive)]"
      >
        Start for {usd(loonext.price)} flat →
      </a>

      <p className="mt-3 text-[0.8125rem] leading-relaxed text-[color:var(--fr-ink-55)]">
        The $19/user figure is the published monthly Starter seat price of a
        leading per-user business-texting tool {COMPARE_AS_OF} (that tool bills
        texting separately, so real totals run higher). See the named, sourced
        math on{" "}
        <a
          href={LIVE_ROUTES.compareQuo}
          className="font-medium text-[color:var(--fr-olive)] underline-offset-2 hover:underline"
        >
          our comparison pages
        </a>
        .
      </p>
    </div>
  );
}
