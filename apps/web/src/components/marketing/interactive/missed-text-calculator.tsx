"use client";

/**
 * Missed-text calculator (Track B) — §3.8 / COPY §H8.
 *
 * Demoted breather (BLUEPRINT panel resolution): pure arithmetic done in the
 * open, never an asserted industry stat. The formula is always visible and the
 * defaults are honest ("your numbers, not ours — change them"). Keyboard-
 * accessible controlled inputs, tabular numerals, aria-live on the output.
 *
 * Math (§3.8): missed/week × booking-rate × avg job value = weekly revenue at
 * risk; × 4.33 weeks = monthly. We only multiply what the user types.
 */

import { useId, useState } from "react";

const WEEKS_PER_MONTH = 4.33;

function usd(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

/** A labelled numeric field with a stepper-friendly range + number input. */
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
        className="flex items-baseline justify-between text-[14px] font-medium text-foreground"
      >
        <span>{label}</span>
        <span className="tabular-nums text-primary">
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
        className="mt-2 h-1.5 w-full cursor-pointer appearance-none rounded-full bg-secondary accent-primary"
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
        className="mt-2 w-full rounded-md border border-input bg-background px-3 py-1.5 text-[14px] tabular-nums text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      />
    </div>
  );
}

export function MissedTextCalculator() {
  const [missed, setMissed] = useState(5);
  const [ratePct, setRatePct] = useState(25);
  const [value, setValue] = useState(250);

  const rate = ratePct / 100;
  const weekly = missed * rate * value;
  const monthly = Math.round(weekly * WEEKS_PER_MONTH);

  return (
    <div className="rounded-[10px] border border-border bg-card p-6 shadow-[0_24px_64px_-32px_rgba(28,25,23,0.25)]">
      <div className="grid gap-5">
        <Field
          label="Calls or texts you miss in a week"
          value={missed}
          min={0}
          max={50}
          step={1}
          onChange={setMissed}
        />
        <Field
          label="How many of those would've booked"
          value={ratePct}
          min={0}
          max={100}
          step={5}
          suffix="%"
          onChange={setRatePct}
        />
        <Field
          label="Average job value"
          value={value}
          min={0}
          max={5000}
          step={50}
          prefix="$"
          onChange={setValue}
        />
      </div>

      <div className="mt-6 rounded-lg bg-primary/5 p-4">
        <p aria-live="polite" className="text-[15px] text-foreground">
          That&apos;s about{" "}
          <span className="font-semibold tabular-nums text-primary">
            {usd(monthly)} a month
          </span>{" "}
          in work that went somewhere else.
        </p>
        {/* Formula always visible — we show our work (§3.8). */}
        <p className="mt-2 font-mono text-[13px] tabular-nums text-muted-foreground">
          {missed} × {ratePct}% × {usd(value)} × 4.33 weeks
        </p>
      </div>

      <p className="mt-4 text-[13px] leading-relaxed text-muted-foreground">
        Your numbers, not ours — change any of them. That&apos;s{" "}
        <span className="font-medium text-foreground">$29 a month</span> against
        the figure above.
      </p>
    </div>
  );
}
