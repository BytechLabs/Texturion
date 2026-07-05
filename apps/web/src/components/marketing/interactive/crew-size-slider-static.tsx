/**
 * <CrewSizeSliderStatic>, the crew-size slider at its default resting state (6
 * people), as pure server DOM. The LCP-neutral / no-JS / pre-hydration frame so
 * the converting comparison is meaningful before (and without) the interactive
 * island. <LazyIsland> swaps in the draggable version on viewport approach.
 *
 * Values mirror the interactive slider (BLUEPRINT §3.9 / COPY §H9): Loonext is
 * flat ($29 ≤3 people, $79 for 4–10); the per-user figure is the dated, sourced
 * Quo monthly seat price ($19/user/mo, July 2026), linked to /compare/quo. At
 * the default 6 people that is $79 flat vs 6 × $19 = $114, the swap is seamless.
 */

import { LIVE_ROUTES } from "@/lib/marketing/site";

const PER_USER_MONTHLY = 19;
const SEATS = 6;
const LOONEXT_PRICE = 79; // 4–10 people → Pro
const PER_USER = SEATS * PER_USER_MONTHLY; // $114
const SAVINGS = PER_USER - LOONEXT_PRICE; // $35
const MAX_PER_USER = 10 * PER_USER_MONTHLY; // $190

function usd(n: number): string {
  return `$${n.toLocaleString("en-US")}`;
}

export function CrewSizeSliderStatic() {
  const loonextWidth = Math.max(6, (LOONEXT_PRICE / MAX_PER_USER) * 100);
  const perUserWidth = Math.max(6, (PER_USER / MAX_PER_USER) * 100);

  return (
    <div className="rounded-[10px] border border-border bg-card p-6 shadow-[0_24px_64px_-32px_rgba(28,25,23,0.25)]">
      <div className="flex items-baseline justify-between text-[14px] font-medium text-foreground">
        <span>People on your crew</span>
        <span className="text-2xl font-semibold tabular-nums text-primary">
          {SEATS}
        </span>
      </div>
      {/* Inert track, the interactive island replaces this with a real slider. */}
      <div className="mt-3 h-1.5 w-full rounded-full bg-secondary" aria-hidden />
      <div className="mt-1 flex justify-between text-[11px] tabular-nums text-muted-foreground">
        <span>1</span>
        <span>10</span>
      </div>

      <div className="mt-6 space-y-4">
        <div>
          <div className="flex items-baseline justify-between text-[14px]">
            <span className="font-medium text-foreground">Loonext Pro</span>
            <span className="tabular-nums">
              <span className="font-semibold text-primary">
                {usd(LOONEXT_PRICE)}
              </span>
              <span className="text-muted-foreground">/mo, flat</span>
            </span>
          </div>
          <div className="mt-1.5 h-3 w-full overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full rounded-full bg-primary"
              style={{ width: `${loonextWidth}%` }}
            />
          </div>
        </div>

        <div>
          <div className="flex items-baseline justify-between text-[14px]">
            <span className="font-medium text-foreground">
              Typical per-user tool
            </span>
            <span className="tabular-nums">
              <span className="font-semibold text-stone-700 dark:text-stone-300">
                {usd(PER_USER)}
              </span>
              <span className="text-muted-foreground">/mo, and climbing</span>
            </span>
          </div>
          <div className="mt-1.5 h-3 w-full overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full rounded-full bg-stone-400 dark:bg-stone-500"
              style={{ width: `${perUserWidth}%` }}
            />
          </div>
        </div>
      </div>

      <p className="mt-5 text-[15px] text-foreground">
        At {SEATS} people, that&apos;s{" "}
        <span className="font-semibold tabular-nums text-primary">
          {usd(SAVINGS)} less a month
        </span>{" "}
        with Loonext, {usd(LOONEXT_PRICE)} flat instead of {SEATS} ×{" "}
        {usd(PER_USER_MONTHLY)}.
      </p>

      <a
        href="/signup"
        className="mt-4 inline-flex items-center gap-1 text-[15px] font-medium text-primary underline-offset-2 hover:underline"
      >
        Start for {usd(LOONEXT_PRICE)} flat →
      </a>

      <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">
        Per-user figure is a leading tool&apos;s published monthly seat price
        (${PER_USER_MONTHLY}/user/mo) as of July 2026, and that tool bills
        texting separately, so real totals run higher.{" "}
        <a
          href={LIVE_ROUTES.compareQuo}
          className="font-medium text-primary underline-offset-2 hover:underline"
        >
          See the sourced math
        </a>
        .
      </p>
    </div>
  );
}
