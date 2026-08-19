"use client";

/**
 * Missed-text calculator, v4 "FIRST RESPONSE" (COPY-DECK v2 §S8 "DO THE
 * MATH"). Pure arithmetic done in the open, never an asserted industry stat:
 * we only multiply what the visitor types, and the formula is always visible.
 *
 * Color law: the output figure is the ONE sanctioned Flare display element
 * (whitelist §3.4.3: 48px or larger, bold, mono, via <MonoFigure
 * tone="flare">). Everything else is ink and cobalt. Law 5 note for callers:
 * this figure is a display-scale accent, so its band must not also carry a
 * cobalt display element.
 *
 * Math (§S8): missed/week × booking rate × average job value × 4.33 weeks.
 * Keyboard-accessible controlled inputs, tabular numerals, aria-live output.
 */

import type { MarketingLocale } from "@/i18n/marketing/footer";
import { homeCopy } from "@/i18n/marketing/home";
import { useId, useState } from "react";

import { formatMoney, type BillingCurrency } from "@loonext/shared";

import { MonoFigure } from "@/components/marketing/fr";
import {
  PlanPrice,
  useMarketingCurrency,
} from "@/components/marketing/pricing/plan-price";

const WEEKS_PER_MONTH = 4.33;

/**
 * The visitor's own dollars, in the currency their country implies (#328).
 *
 * ONE currency across the whole card, deliberately. The job value they type,
 * the monthly figure we multiply out of it, and the plan price at the bottom
 * are set against each other in the same sentence, so a Canadian reading a CAD
 * plan price under a USD loss would be comparing two different things — and it
 * would look right, because both start with a "$".
 *
 * It used to say `currency: "USD"` outright, which was a claim about somebody
 * else's money: these are the reader's numbers, not a price of ours.
 */
function money(dollars: number, currency: BillingCurrency): string {
  return formatMoney(Math.round(dollars * 100), currency);
}

/** A labelled numeric field with a range slider + exact number input. */
function Field({
  label,
  value,
  min,
  max,
  step,
  suffix,
  prefix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  prefix?: string;
  onChange: (n: number) => void;
}) {
  const id = useId();
  return (
    <div>
      <label
        htmlFor={id}
        className="flex items-baseline justify-between text-[0.875rem] font-semibold text-[color:var(--fr-ink)]"
      >
        <span>{label}</span>
        <span className="fr-mono-data text-[color:var(--fr-ink)]">
          {prefix}
          {value.toLocaleString("en-US")}
          {suffix}
        </span>
      </label>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-2 h-1.5 w-full cursor-pointer appearance-none rounded-full bg-[color:var(--fr-frost)] accent-[color:var(--fr-olive)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--fr-olive)]"
      />
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (!Number.isNaN(n)) onChange(Math.min(max, Math.max(min, n)));
        }}
        aria-label={`${label} (exact value)`}
        className="fr-mono-data mt-2 w-full rounded-[10px] border border-[color:var(--fr-frost)] bg-[color:var(--fr-card)] px-3 py-1.5 text-[color:var(--fr-ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--fr-olive)]"
      />
    </div>
  );
}

export function MissedTextCalculator({
  locale = "en",
}: {
  locale?: MarketingLocale;
} = {}) {
  const copy = homeCopy(locale);
  const [missed, setMissed] = useState(5);
  const [ratePct, setRatePct] = useState(25);
  const [value, setValue] = useState(250);
  const currency = useMarketingCurrency();

  const rate = ratePct / 100;
  const weekly = missed * rate * value;
  const monthly = Math.round(weekly * WEEKS_PER_MONTH);

  return (
    <div className="fr-card p-6">
      <div className="grid gap-5">
        <Field
          label={copy.mathMissed}
          value={missed}
          min={0}
          max={50}
          step={1}
          onChange={setMissed}
        />
        <Field
          label={copy.mathBooked}
          value={ratePct}
          min={0}
          max={100}
          step={5}
          suffix="%"
          onChange={setRatePct}
        />
        <Field
          label={copy.mathJobValue}
          value={value}
          min={0}
          max={5000}
          step={50}
          prefix="$"
          onChange={setValue}
        />
      </div>

      <div className="mt-6 rounded-[10px] bg-[color:var(--fr-frost)] p-5">
        <p aria-live="polite">
          <span className="block text-[0.9375rem] text-[color:var(--fr-ink)]">
            {copy.mathThatsAbout}
          </span>
          {/* The one Flare display element (§3.4.3): 48px+, bold, mono. */}
          <MonoFigure
            value={money(monthly, currency)}
            suffix={copy.mathPerMonth}
            tone="flare"
            className="mt-1"
          />
          <span className="mt-1 block text-[0.9375rem] text-[color:var(--fr-ink)]">
            {copy.mathLost}
          </span>
        </p>
        {/* The formula, always visible: we show our work (§S8). */}
        <p className="fr-mono-data mt-3 text-[0.8125rem] text-[color:var(--fr-ink-55)]">
          {missed} × {ratePct}% × {money(value, currency)} × 4.33 weeks
        </p>
      </div>

      <p className="mt-4 text-[0.8125rem] leading-relaxed text-[color:var(--fr-ink-55)]">
        This is arithmetic on your numbers, not a claim of ours. Change any of
        them. We only multiply what you type. That&apos;s{" "}
        <span className="fr-mono-data text-[color:var(--fr-ink)]">
          <PlanPrice plan="starter" />
        </span>{" "}
        a month against the figure above.
      </p>
    </div>
  );
}
