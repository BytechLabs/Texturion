/**
 * <MissedTextCalculatorStatic>, the §3.7 calculator at its default resting
 * state, as pure server DOM. The LCP-neutral / no-JS / pre-hydration frame for
 * the missed-text calculator, so the section is meaningful before (and without)
 * the interactive island. <LazyIsland> swaps in the draggable version on
 * viewport approach.
 *
 * The defaults match the interactive calculator (missed 5 · booked 25% · job
 * $250) and the formula is shown in the open (BLUEPRINT §3.7 honesty rule: our
 * arithmetic on honest defaults, no asserted stat). The output is the same
 * multiplication the island computes, so the swap is seamless.
 */

const MISSED = 5;
const RATE_PCT = 25;
const JOB_VALUE = 250;
const WEEKS_PER_MONTH = 4.33;
const MONTHLY = Math.round(MISSED * (RATE_PCT / 100) * JOB_VALUE * WEEKS_PER_MONTH);

function usd(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function StaticField({
  label,
  display,
}: {
  label: string;
  display: string;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between text-[14px] font-medium text-[color:var(--day-ink)]">
        <span>{label}</span>
        <span className="tabular-nums text-[color:var(--petrol)]">{display}</span>
      </div>
      {/* Inert track, the interactive island replaces this with a real slider. */}
      <div className="mt-2 h-1.5 w-full rounded-full bg-[rgba(11,43,38,0.06)]" aria-hidden />
    </div>
  );
}

export function MissedTextCalculatorStatic() {
  return (
    <div className="rounded-[10px] border border-[color:var(--hairline)] bg-white p-6 shadow-[0_24px_64px_-32px_rgba(28,25,23,0.25)]">
      <div className="grid gap-5">
        <StaticField label="Calls or texts you miss in a week" display="5" />
        <StaticField label="How many of those would've booked" display="25%" />
        <StaticField label="Average job value" display="$250" />
      </div>

      <div className="mt-6 rounded-lg bg-[color:var(--petrol-12)] p-4">
        <p className="text-[15px] text-[color:var(--day-ink)]">
          That&apos;s about{" "}
          <span className="font-semibold tabular-nums text-[color:var(--petrol)]">
            {usd(MONTHLY)} a month
          </span>{" "}
          in work that went somewhere else.
        </p>
        <p className="mt-2 font-mono-mkt text-[13px] tabular-nums text-[color:var(--graphite)]">
          {MISSED} × {RATE_PCT}% × {usd(JOB_VALUE)} × 4.33 weeks
        </p>
      </div>

      <p className="mt-4 text-[13px] leading-relaxed text-[color:var(--ink-70)]">
        Your numbers, not ours, change any of them. That&apos;s{" "}
        <span className="font-medium text-[color:var(--day-ink)]">$29 a month</span> against
        the figure above.
      </p>
    </div>
  );
}
