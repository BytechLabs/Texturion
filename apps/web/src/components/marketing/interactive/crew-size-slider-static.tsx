/**
 * <CrewSizeSliderStatic>, the crew-size slider at its default resting state
 * (6 people), as pure server DOM in the v4 voice. The no-JS / pre-hydration
 * frame so the converting comparison is meaningful before (and without) the
 * interactive island; <LazyIsland> swaps in the draggable version on viewport
 * approach.
 *
 * Values and color law mirror the interactive slider exactly (cobalt flat
 * Loonext line, Flare rival climbing line per whitelist §3.4.5, mono ink
 * figures): Loonext is flat ($29 up to 3 people, $79 for 4 to 10); the
 * per-user figure is the dated, sourced $19/user/mo (July 2026), linked to
 * /compare/quo. At the default 6 people that is $79 flat vs 6 × $19 = $114,
 * so the island swap is seamless.
 */

import { LIVE_ROUTES } from "@/lib/marketing/site";
import { PLAN_PRICING } from "@/lib/api/types";

const PER_USER_MONTHLY = 19;
const SEATS = 6;
// 4 to 10 people is Pro (SPEC §2) — sourced, never retyped.
const LOONEXT_PRICE = PLAN_PRICING.pro.monthlyDollars; // $79
const PER_USER = SEATS * PER_USER_MONTHLY; // $114
const SAVINGS = PER_USER - LOONEXT_PRICE; // $35
const MAX_PER_USER = PLAN_PRICING.pro.seats * PER_USER_MONTHLY; // $190 at 10 seats

function usd(n: number): string {
  return `$${n.toLocaleString("en-US")}`;
}

export function CrewSizeSliderStatic() {
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
        <span>{PLAN_PRICING.pro.seats}</span>
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
              className="h-full rounded-full bg-[color:var(--fr-cobalt)]"
              style={{ width: `${loonextWidth}%` }}
            />
          </div>
        </div>

        {/* The rival: the Flare climbing line (§3.4.5, non-text mark). */}
        <div>
          <div className="flex items-baseline justify-between gap-3 text-[0.875rem]">
            <span className="font-medium text-[color:var(--fr-ink)]">
              Typical per-user tool at {usd(PER_USER_MONTHLY)}/user/mo
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
        {usd(PER_USER_MONTHLY)}.
      </p>

      <a
        href="/signup"
        className="mt-4 inline-flex items-center gap-1 text-[0.9375rem] font-semibold text-[color:var(--fr-cobalt)] underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--fr-cobalt)]"
      >
        Start for {usd(LOONEXT_PRICE)} flat →
      </a>

      <p className="mt-3 text-[0.8125rem] leading-relaxed text-[color:var(--fr-ink-55)]">
        The $19/user figure is the published monthly Starter seat price of a
        leading per-user business-texting tool as of July 2026 (that tool bills
        texting separately, so real totals run higher). See the named, sourced
        math on{" "}
        <a
          href={LIVE_ROUTES.compareQuo}
          className="font-medium text-[color:var(--fr-cobalt)] underline-offset-2 hover:underline"
        >
          our comparison pages
        </a>
        .
      </p>
    </div>
  );
}
