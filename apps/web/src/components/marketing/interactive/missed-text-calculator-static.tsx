/**
 * <MissedTextCalculatorStatic>, the §S8 calculator at its default resting
 * state, as pure server DOM in the v4 voice. The no-JS / pre-hydration frame
 * so the "do the math" section is meaningful before (and without) the
 * interactive island; <LazyIsland> swaps in the draggable version on viewport
 * approach.
 *
 * Defaults match the interactive calculator (missed 5 · booked 25% · job
 * $250), the formula is shown in the open, and the output is the same
 * multiplication the island computes (Flare display figure per whitelist
 * §3.4.3), so the swap is seamless.
 */

import { formatMoney } from "@loonext/shared";

import type { MarketingLocale } from "@/i18n/marketing/footer";
import { homeCopy } from "@/i18n/marketing/home";
import { MonoFigure } from "@/components/marketing/fr";
import { PlanPrice } from "@/components/marketing/pricing/plan-price";

const MISSED = 5;
const RATE_PCT = 25;
const JOB_VALUE = 250;
const WEEKS_PER_MONTH = 4.33;
const MONTHLY = Math.round(
  MISSED * (RATE_PCT / 100) * JOB_VALUE * WEEKS_PER_MONTH,
);

function StaticField({ label, display }: { label: string; display: string }) {
  return (
    <div>
      <div className="flex items-baseline justify-between text-[0.875rem] font-semibold text-[color:var(--fr-ink)]">
        <span>{label}</span>
        <span className="fr-mono-data text-[color:var(--fr-ink)]">
          {display}
        </span>
      </div>
      {/* Inert track; the interactive island replaces this with a real slider. */}
      <div
        className="mt-2 h-1.5 w-full rounded-full bg-[color:var(--fr-frost)]"
        aria-hidden
      />
    </div>
  );
}

export function MissedTextCalculatorStatic({
  locale = "en",
}: {
  locale?: MarketingLocale;
} = {}) {
  const copy = homeCopy(locale);
  const money = (dollars: number) => formatMoney(dollars * 100, "usd", "usd", locale);
  return (
    <div className="fr-card p-6">
      <div className="grid gap-5">
        {/* Derived from the constants above, so the resting frame cannot drift
            from the formula printed under it. */}
        <StaticField
          label={copy.mathMissed}
          display={String(MISSED)}
        />
        <StaticField
          label={copy.mathBooked}
          display={`${RATE_PCT}%`}
        />
        <StaticField label={copy.mathJobValue} display={money(JOB_VALUE)} />
      </div>

      <div className="mt-6 rounded-[10px] bg-[color:var(--fr-frost)] p-5">
        <p>
          <span className="block text-[0.9375rem] text-[color:var(--fr-ink)]">
            {copy.mathThatsAbout}
          </span>
          {/* The one Flare display element (§3.4.3): 48px+, bold, mono. */}
          <MonoFigure
            value={money(MONTHLY)}
            suffix={copy.mathPerMonth}
            tone="flare"
            className="mt-1"
          />
          <span className="mt-1 block text-[0.9375rem] text-[color:var(--fr-ink)]">
            {copy.mathLost}
          </span>
        </p>
        <p className="fr-mono-data mt-3 text-[0.8125rem] text-[color:var(--fr-ink-55)]">
          {MISSED} × {RATE_PCT}% × {money(JOB_VALUE)} × {copy.mathWeeks}
        </p>
      </div>

      <p className="mt-4 text-[0.8125rem] leading-relaxed text-[color:var(--fr-ink-55)]">
        {copy.mathNoteBefore}{" "}
        <span className="fr-mono-data text-[color:var(--fr-ink)]">
          <PlanPrice plan="starter" />
        </span>{" "}
        {copy.mathNoteAfter}
      </p>
    </div>
  );
}
