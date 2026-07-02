"use client";

/**
 * Crew-size slider (Track B) — §3.9 / COPY §H9. THE converting interaction
 * (BLUEPRINT §0 weapon #1, panel resolution: this replaces the missed-text
 * calculator as the home page's flagship interactive).
 *
 * Drag 1→10 people; watch a typical per-user tool's line climb past JobText's
 * flat line. The per-user figure is REAL, labeled, and dated: Quo's published
 * monthly Starter seat price is $19/user/mo as of July 2026
 * (docs/marketing/competitor-site-teardowns.md line 129–130); Quo also bills
 * texting separately ($0.01/segment) and charges $5/mo per extra number, so the
 * comparison is conservative in JobText's favor. Links /compare/quo for the
 * sourced math (§13.7 — no bare unverified competitor number).
 *
 * JobText plan follows SPEC §2: ≤3 people = Starter $29, 4–10 = Pro $79 — both
 * flat, whatever the crew size. Keyboard-accessible, tabular numerals, aria-live.
 */

import { useId, useState } from "react";

import { HOME_ANCHORS } from "@/lib/marketing/site";

/** Quo published monthly Starter seat price, July 2026 (teardown line 129). */
const PER_USER_MONTHLY = 19;

function jobtextPrice(seats: number): { plan: "Starter" | "Pro"; price: number } {
  return seats <= 3
    ? { plan: "Starter", price: 29 }
    : { plan: "Pro", price: 79 };
}

function usd(n: number): string {
  return `$${n.toLocaleString("en-US")}`;
}

export function CrewSizeSlider() {
  const [seats, setSeats] = useState(6);
  const sliderId = useId();

  const jobtext = jobtextPrice(seats);
  const perUser = seats * PER_USER_MONTHLY;
  const savings = perUser - jobtext.price;

  // Bar widths are relative to the max the per-user line reaches at 10 seats.
  const maxPerUser = 10 * PER_USER_MONTHLY; // $190
  const jobtextWidth = Math.max(6, (jobtext.price / maxPerUser) * 100);
  const perUserWidth = Math.max(6, (perUser / maxPerUser) * 100);

  return (
    <div className="rounded-[10px] border border-border bg-card p-6 shadow-[0_24px_64px_-32px_rgba(28,25,23,0.25)]">
      <label
        htmlFor={sliderId}
        className="flex items-baseline justify-between text-[14px] font-medium text-foreground"
      >
        <span>People on your crew</span>
        <span className="text-2xl font-semibold tabular-nums text-primary">
          {seats}
        </span>
      </label>
      <input
        id={sliderId}
        type="range"
        min={1}
        max={10}
        step={1}
        value={seats}
        onChange={(e) => setSeats(Number(e.target.value))}
        aria-valuetext={`${seats} ${seats === 1 ? "person" : "people"}`}
        className="mt-3 h-1.5 w-full cursor-pointer appearance-none rounded-full bg-secondary accent-primary"
      />
      <div className="mt-1 flex justify-between text-[11px] tabular-nums text-muted-foreground">
        <span>1</span>
        <span>10</span>
      </div>

      <div className="mt-6 space-y-4" aria-live="polite">
        {/* JobText — flat line */}
        <div>
          <div className="flex items-baseline justify-between text-[14px]">
            <span className="font-medium text-foreground">
              JobText {jobtext.plan}
            </span>
            <span className="tabular-nums">
              <span className="font-semibold text-primary">
                {usd(jobtext.price)}
              </span>
              <span className="text-muted-foreground">/mo — flat</span>
            </span>
          </div>
          <div className="mt-1.5 h-3 w-full overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-200 ease-out"
              style={{ width: `${jobtextWidth}%` }}
            />
          </div>
        </div>

        {/* Per-user — climbing line */}
        <div>
          <div className="flex items-baseline justify-between text-[14px]">
            <span className="font-medium text-foreground">
              Typical per-user tool
            </span>
            <span className="tabular-nums">
              <span className="font-semibold text-stone-700 dark:text-stone-300">
                {usd(perUser)}
              </span>
              <span className="text-muted-foreground">
                /mo{seats > 1 ? " — and climbing" : ""}
              </span>
            </span>
          </div>
          <div className="mt-1.5 h-3 w-full overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full rounded-full bg-stone-400 transition-[width] duration-200 ease-out dark:bg-stone-500"
              style={{ width: `${perUserWidth}%` }}
            />
          </div>
        </div>
      </div>

      {savings > 0 && (
        <p className="mt-5 text-[15px] text-foreground">
          At {seats} people, that&apos;s{" "}
          <span className="font-semibold tabular-nums text-primary">
            {usd(savings)} less a month
          </span>{" "}
          with JobText — {usd(jobtext.price)} flat instead of {seats} ×{" "}
          {usd(PER_USER_MONTHLY)}.
        </p>
      )}

      <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">
        Per-user figure is a leading tool&apos;s published monthly seat price
        (${PER_USER_MONTHLY}/user/mo) as of July 2026 — and that tool bills
        texting separately, so real totals run higher.{" "}
        {/* /compare/quo ships later; lands on the on-page pricing/comparison
            beat until then (site.ts guard, HOME_ANCHORS.compare) — zero dead
            links. The figure above stays dated + sourced in place. */}
        <a
          href={HOME_ANCHORS.compare}
          className="font-medium text-primary underline-offset-2 hover:underline"
        >
          See the sourced math
        </a>
        .
      </p>
    </div>
  );
}
