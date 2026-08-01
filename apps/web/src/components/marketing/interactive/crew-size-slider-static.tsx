/**
 * <CrewSizeSliderStatic>, the crew-size slider at its default resting state
 * (6 people), as pure server DOM in the v4 voice. The no-JS / pre-hydration
 * frame so the converting comparison is meaningful before (and without) the
 * interactive island; <LazyIsland> swaps in the draggable version on viewport
 * approach.
 *
 * Values and color law mirror the interactive slider exactly (cobalt flat
 * Loonext line, Flare rival climbing line per whitelist §3.4.5, mono ink
 * figures): Loonext is flat ($29 up to 3 people, $79 for 4 and up); the
 * per-user figure is the dated, sourced $19/user/mo (July 2026), linked to
 * /compare/quo. At the default 6 people that is $79 flat vs 6 × $19 = $114,
 * so the island swap is seamless.
 */

import { APP_LINKS, LIVE_ROUTES } from "@/lib/marketing/site";
import { PLAN_PRICING } from "@/lib/api/types";
import { COMPARE_AS_OF } from "@/app/(marketing)/compare/verification";

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
const DEFAULT_PER_USER_MONTHLY = 19;
const SEATS = 6;
// Largest crew the slider illustrates. Pro's seats are unlimited (#83), so this
// is a fixed marketing range, mirroring the interactive slider's MAX_CREW.
const MAX_CREW = 10;
// 4 and up is Pro (SPEC §2) — sourced, never retyped.
const LOONEXT_PRICE = PLAN_PRICING.pro.monthlyDollars; // $79


function usd(n: number): string {
  return `$${n.toLocaleString("en-US")}`;
}

export function CrewSizeSliderStatic({
  perUserMonthly = DEFAULT_PER_USER_MONTHLY,
  minimumSeats = 1,
}: { perUserMonthly?: number; minimumSeats?: number } = {}) {
  // Derived per render rather than at module scope: the rate is now a prop, and
  // a module constant would silently keep the default on every page that passes
  // a different one — which is exactly the bug this is fixing.
  const PER_USER = Math.max(SEATS, minimumSeats) * perUserMonthly;
  const SAVINGS = PER_USER - LOONEXT_PRICE;
  const MAX_PER_USER = MAX_CREW * perUserMonthly;
  const loonextWidth = Math.max(6, (LOONEXT_PRICE / MAX_PER_USER) * 100);
  const perUserWidth = Math.max(6, (PER_USER / MAX_PER_USER) * 100);

  return (
    <div className="fr-card p-6">
      <div className="flex items-baseline justify-between text-[0.875rem] font-semibold text-[color:var(--fr-ink)]">
        <span>People on your crew</span>
        <span className="fr-mono-data text-2xl text-[color:var(--fr-ink)]">
          {SEATS}
        </span>
      </div>
      {/* Inert track; the interactive island replaces this with a real slider. */}
      <div
        className="mt-3 h-1.5 w-full rounded-full bg-[color:var(--fr-frost)]"
        aria-hidden
      />
      <div className="fr-mono-data mt-1 flex justify-between text-[0.6875rem] text-[color:var(--fr-ink-55)]">
        <span>1</span>
        <span>{MAX_CREW}</span>
      </div>

      <div className="mt-6 space-y-4">
        {/* Loonext: the cobalt flat line. */}
        <div>
          <div className="flex items-baseline justify-between gap-3 text-[0.875rem]">
            <span className="font-medium text-[color:var(--fr-ink)]">
              Loonext Pro
            </span>
            <span className="whitespace-nowrap">
              <span className="fr-mono-data text-[color:var(--fr-ink)]">
                {usd(LOONEXT_PRICE)}/mo
              </span>
              <span className="text-[color:var(--fr-ink-55)]">, flat</span>
            </span>
          </div>
          <div className="mt-1.5 h-3 w-full overflow-hidden rounded-full bg-[color:var(--fr-frost)]">
            <div
              className="h-full rounded-full bg-[color:var(--fr-olive)]"
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
                {usd(PER_USER)}/mo
              </span>
              <span className="text-[color:var(--fr-ink-55)]">
                , and climbing
              </span>
            </span>
          </div>
          <div className="mt-1.5 h-3 w-full overflow-hidden rounded-full bg-[color:var(--fr-frost)]">
            <div
              className="h-full rounded-full bg-[color:var(--fr-flare)]"
              style={{ width: `${perUserWidth}%` }}
            />
          </div>
        </div>
      </div>

      <p className="mt-5 text-[0.9375rem] text-[color:var(--fr-ink)]">
        At {SEATS} people, that&apos;s{" "}
        <span className="fr-mono-data text-[color:var(--fr-ink)]">
          {usd(SAVINGS)} less a month
        </span>{" "}
        with Loonext, {usd(LOONEXT_PRICE)} flat instead of {SEATS} ×{" "}
        {usd(perUserMonthly)}.
      </p>

      <a
        href={APP_LINKS.signup}
        className="mt-4 inline-flex items-center gap-1 text-[0.9375rem] font-semibold text-[color:var(--fr-olive)] underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--fr-olive)]"
      >
        Start for {usd(LOONEXT_PRICE)} flat →
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
