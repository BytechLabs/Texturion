"use client";

/**
 * The /pricing centerpiece (owner ruling 2026-07-07, amendment 13): the REAL
 * interactive plan builder, not static plan cards. Choose Starter or Pro,
 * switch the three sellable add-ons on or off, and the receipt column totals
 * it live, computed by plan-math.ts from the product's shared constants
 * (PLAN_PRICING + PLAN_MODULE_CARDS + US_REGISTRATION_FEE_DOLLARS in
 * lib/api/types.ts): zero retyped numbers, zero fake state.
 *
 * - SSR default state: Starter, no add-ons, $29/mo, $58 first month (US).
 *   The server renders that complete receipt, so the page stands without
 *   JavaScript (the controls are progressive enhancement on top).
 * - The one-time US registration fee is ALWAYS its own first-month line,
 *   never rolled into the monthly figure.
 * - regions_ca never appears: plan-math.ts filters to the API's sellable set.
 * - The CTA carries the chosen configuration into signup
 *   (/signup?plan=…&modules=…), so what you built here is what checkout
 *   starts from.
 *
 * Styling is marketing chrome (this is a configurator, not a product embed),
 * so cobalt selection states and the cobalt CTA are correct here (§2); every
 * countable truth is mono (§3). Accessible as a real form: a labelled
 * radiogroup for the plan (arrow keys move between plans), role="switch"
 * buttons for the add-ons, and an aria-live receipt.
 */

import { useState, type KeyboardEvent } from "react";

import { CtaButton } from "@/components/marketing/fr";
import { PRIMARY_CTA_LABEL } from "@/components/marketing/nav-links";
import type { Plan } from "@/app/(marketing)/pricing/pricing-data";
import {
  US_REGISTRATION_FEE_DOLLARS,
  type PlanId,
  type PlanModule,
} from "@/lib/api/types";
import { cn } from "@/lib/utils";

import { useCountry } from "./country-context";
import {
  DEFAULT_SELECTION,
  SELLABLE_ADDON_CARDS,
  addonMonthlyDollars,
  firstMonthTotalDollars,
  monthlyTotalDollars,
  signupHref,
  usd,
} from "./plan-math";

function InkTick() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="mt-1 size-3.5 shrink-0"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M3 8.5 6.5 12 13 4.5"
        fill="none"
        stroke="var(--fr-ink-55)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function GreenTick() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="size-4 shrink-0"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M3 8.5 6.5 12 13 4.5"
        fill="none"
        stroke="var(--fr-green)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** The two-position switch drawn as marketing chrome (cobalt = on). */
function Switch({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors duration-200 ease-out",
        on ? "bg-[color:var(--fr-cobalt)]" : "bg-[color:var(--fr-ink-55)]/25",
      )}
    >
      <span
        className={cn(
          "absolute top-1/2 size-[1.125rem] -translate-y-1/2 rounded-full bg-white shadow-[0_1px_2px_rgba(16,23,59,0.2)] transition-[left] duration-200 ease-out",
          on ? "left-[calc(100%-1.375rem)]" : "left-1",
        )}
      />
    </span>
  );
}

export function PlanBuilder({ plans }: { plans: Plan[] }) {
  const { country } = useCountry();
  const [plan, setPlan] = useState<PlanId>(DEFAULT_SELECTION.plan);
  const [addons, setAddons] = useState<readonly PlanModule[]>(
    DEFAULT_SELECTION.addons,
  );

  const selection = { plan, addons };
  const monthly = monthlyTotalDollars(selection);
  const firstMonth = firstMonthTotalDollars(selection);
  const chosenPlan = plans.find((p) => p.id === plan) ?? plans[0];

  function toggleAddon(id: PlanModule) {
    setAddons((current) =>
      current.includes(id)
        ? current.filter((m) => m !== id)
        : [...current, id],
    );
  }

  /** Standard radiogroup keyboard behavior: arrows move the selection. */
  function onPlanKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
      e.preventDefault();
      setPlan((current) => (current === "starter" ? "pro" : "starter"));
    }
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,24rem)] lg:items-start">
      {/* ------------------------------------------------------------------ */}
      {/* Left column: the two choices.                                       */}
      {/* ------------------------------------------------------------------ */}
      <div>
        <p className="fr-eyebrow text-[color:var(--fr-ink-55)]">
          Step 1 · Pick your plan
        </p>
        <div
          role="radiogroup"
          aria-label="Plan"
          className="mt-4 grid gap-4 sm:grid-cols-2"
        >
          {plans.map((p) => {
            const selected = p.id === plan;
            return (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setPlan(p.id)}
                onKeyDown={onPlanKeyDown}
                className={cn(
                  "fr-card flex h-full flex-col p-5 text-left transition-shadow duration-200 ease-out sm:p-6",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--fr-cobalt)]",
                  selected
                    ? "shadow-[inset_0_0_0_2px_var(--fr-cobalt),var(--fr-shadow-card)]"
                    : "hover:shadow-[inset_0_0_0_2px_var(--fr-frost),var(--fr-shadow-card)]",
                )}
              >
                <span className="flex items-center justify-between gap-3">
                  <span className="font-body-mkt text-[1.0625rem] font-bold text-[color:var(--fr-ink)]">
                    {p.name}
                  </span>
                  <span
                    aria-hidden
                    className={cn(
                      "flex size-5 shrink-0 items-center justify-center rounded-full transition-colors duration-200",
                      selected
                        ? "bg-[color:var(--fr-cobalt)]"
                        : "bg-[color:var(--fr-frost)]",
                    )}
                  >
                    {selected ? (
                      <svg
                        viewBox="0 0 16 16"
                        className="size-3"
                        focusable="false"
                      >
                        <path
                          d="M3.5 8.5 6.5 11.5 12.5 4.5"
                          fill="none"
                          stroke="#fff"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    ) : null}
                  </span>
                </span>
                <span className="mt-3 flex items-baseline gap-1.5">
                  <span className="fr-mono-data text-3xl font-medium text-[color:var(--fr-ink)]">
                    {p.price}
                  </span>
                  <span className="text-sm text-[color:var(--fr-ink-55)]">
                    /mo, flat
                  </span>
                </span>
                <span className="mt-1 block text-[0.875rem] text-[color:var(--fr-ink-55)]">
                  {p.tagline}
                </span>
                <ul className="mt-4 flex-1 space-y-2">
                  {p.features.map((f) => (
                    <li
                      key={f}
                      className="flex gap-2 text-[0.8125rem] leading-relaxed text-[color:var(--fr-ink-70)]"
                    >
                      <InkTick />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
              </button>
            );
          })}
        </div>
        <p className="mt-3 text-[0.8125rem] text-[color:var(--fr-ink-55)]">
          Change plans anytime in billing settings: upgrades apply immediately,
          downgrades at the end of your billing period.
        </p>

        <p className="fr-eyebrow mt-10 text-[color:var(--fr-ink-55)]">
          Step 2 · Add only what you need
        </p>
        <div className="mt-4 space-y-3">
          {SELLABLE_ADDON_CARDS.map((card) => {
            const on = addons.includes(card.id);
            return (
              <button
                key={card.id}
                type="button"
                role="switch"
                aria-checked={on}
                onClick={() => toggleAddon(card.id)}
                className={cn(
                  "fr-card flex w-full items-start gap-4 p-5 text-left transition-shadow duration-200 ease-out",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--fr-cobalt)]",
                  on
                    ? "shadow-[inset_0_0_0_2px_var(--fr-cobalt),var(--fr-shadow-card)]"
                    : "hover:shadow-[inset_0_0_0_2px_var(--fr-frost),var(--fr-shadow-card)]",
                )}
              >
                <Switch on={on} />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <span className="font-body-mkt text-[0.9375rem] font-semibold text-[color:var(--fr-ink)]">
                      {card.label}
                    </span>
                    <span className="fr-mono-data shrink-0 text-[color:var(--fr-ink)]">
                      {card.price}
                      <span className="text-[color:var(--fr-ink-55)]">/mo</span>
                    </span>
                  </span>
                  <span className="mt-1 block text-[0.875rem] leading-relaxed text-[color:var(--fr-ink-70)]">
                    {card.blurb}
                    {card.detail ? ` ${card.detail}` : ""}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
        <p className="mt-3 text-[0.8125rem] text-[color:var(--fr-ink-55)]">
          All three are off by default and none is required to text. Turn them
          on here or later in settings, and off the same way.
        </p>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Right column: the receipt. Live totals, registration fee its own    */}
      {/* first-month line, CTA carrying the configuration.                   */}
      {/* ------------------------------------------------------------------ */}
      <div className="fr-card p-6 sm:p-7 lg:sticky lg:top-24">
        <p className="fr-eyebrow text-[color:var(--fr-ink-55)]">
          Your plan, priced
        </p>

        <div aria-live="polite">
          <dl className="mt-4 space-y-2.5">
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-[0.9375rem] text-[color:var(--fr-ink)]">
                {chosenPlan.name}
              </dt>
              <dd className="fr-mono-data text-[color:var(--fr-ink)]">
                {chosenPlan.price}/mo
              </dd>
            </div>
            {SELLABLE_ADDON_CARDS.filter((card) =>
              addons.includes(card.id),
            ).map((card) => (
              <div
                key={card.id}
                className="flex items-baseline justify-between gap-4"
              >
                <dt className="text-[0.9375rem] text-[color:var(--fr-ink)]">
                  {card.label}
                </dt>
                <dd className="fr-mono-data text-[color:var(--fr-ink)]">
                  + {usd(addonMonthlyDollars(card))}/mo
                </dd>
              </div>
            ))}
          </dl>

          <div className="mt-5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 rounded-[10px] bg-[color:var(--fr-frost)] px-4 py-3.5">
            <span className="text-[0.9375rem] font-semibold text-[color:var(--fr-ink)]">
              Every month
            </span>
            <span className="fr-figure text-[color:var(--fr-ink)]">
              {usd(monthly)}
              <span className="fr-mono-data ml-1 text-[color:var(--fr-ink-55)]">
                /mo
              </span>
            </span>
          </div>

          {/* The one country-specific block. US: the one-time $29 registration
              fee is ALWAYS its own first-month line, never rolled into the
              monthly figure (owner ruling), so the first month is $58 then $29.
              Canada: no registration fee and no carrier wait, so the first
              month equals every month. Base and add-on prices are identical
              either way (USD, plus tax). */}
          {country === "us" ? (
            <dl className="mt-4 space-y-2">
              <div className="flex items-baseline justify-between gap-4">
                <dt className="text-[0.875rem] text-[color:var(--fr-ink-70)]">
                  One-time US registration, first month only
                </dt>
                <dd className="fr-mono-data text-[color:var(--fr-ink)]">
                  + {usd(US_REGISTRATION_FEE_DOLLARS)}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-4">
                <dt className="text-[0.875rem] font-semibold text-[color:var(--fr-ink)]">
                  First month, US shops
                </dt>
                <dd className="fr-mono-data font-medium text-[color:var(--fr-ink)]">
                  {usd(firstMonth)}
                </dd>
              </div>
            </dl>
          ) : (
            <div className="mt-4 flex items-start gap-2 rounded-[10px] bg-[color:var(--fr-frost)] px-4 py-3.5">
              <GreenTick />
              <p className="text-[0.875rem] leading-relaxed text-[color:var(--fr-ink)]">
                No registration fee in Canada. Your first month is{" "}
                {usd(monthly)}, the same as every month after, and texting
                Canadian customers works the same day.
              </p>
            </div>
          )}
        </div>

        {country === "us" ? (
          <p className="mt-3 text-[0.8125rem] leading-relaxed text-[color:var(--fr-ink-55)]">
            Canadian businesses that don&apos;t text US numbers never pay the{" "}
            {usd(US_REGISTRATION_FEE_DOLLARS)} and never wait. Prices in USD,
            plus sales tax where it applies.
          </p>
        ) : (
          <p className="mt-3 text-[0.8125rem] leading-relaxed text-[color:var(--fr-ink-55)]">
            Prices in USD, plus sales tax where it applies. CAD billing
            isn&apos;t here yet, so your card is charged in USD for now and your
            bank converts it.
          </p>
        )}

        <CtaButton
          href={signupHref(selection)}
          className="mt-6 w-full"
          ariaLabel={`${PRIMARY_CTA_LABEL}: start with ${chosenPlan.name} at ${usd(monthly)} a month`}
        >
          {PRIMARY_CTA_LABEL}
        </CtaButton>

        <p className="mt-4 flex items-start gap-2 text-[0.8125rem] leading-relaxed text-[color:var(--fr-ink)]">
          <GreenTick />
          30-day money-back guarantee. Full refund, including the registration
          fee. No fine print.
        </p>
      </div>
    </div>
  );
}
