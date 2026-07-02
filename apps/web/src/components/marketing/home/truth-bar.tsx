/**
 * Truth bar (Track B) — §3.2 / COPY §H2, the anti-logo-bar.
 *
 * Occupies the logo-bar slot with verifiable product truths instead of fake
 * proof (BLUEPRINT §13.1). Two beats: (1) the $29 as art — the first of the two
 * numeral-display moments (§0.2), 120px+ tabular petrol; (2) the trade strip
 * (five ICP trades linking to /for/ pages) + three real-number stat chips.
 *
 * Stat chips are all real product numbers (SPEC §2): 500 texts included, 2
 * numbers on Pro, month to month. Server component.
 */

import Link from "next/link";
import { Fan, Scissors, Shovel, Sparkles, Wrench } from "lucide-react";

import { Reveal } from "@/components/marketing/ui/reveal";
import { Section } from "@/components/marketing/ui/section";
import { LIVE_ROUTES } from "@/lib/marketing/site";

// The trade strip links each ICP trade to its own /for/<trade> page (BLUEPRINT
// §3.4), all of which are live routes in site.ts.
const TRADES = [
  { label: "Plumbers", href: LIVE_ROUTES.forPlumbers, icon: Wrench },
  { label: "Landscapers", href: LIVE_ROUTES.forLandscapers, icon: Shovel },
  { label: "Cleaners", href: LIVE_ROUTES.forCleaners, icon: Sparkles },
  { label: "HVAC", href: LIVE_ROUTES.forHvac, icon: Fan },
  { label: "Salons", href: LIVE_ROUTES.forSalons, icon: Scissors },
] as const;

const CHIPS = [
  { figure: "500", label: "outgoing texts included" },
  { figure: "2", label: "numbers on Pro" },
  { figure: "Month to month", label: "cancel anytime" },
] as const;

export function TruthBar() {
  return (
    <Section id="trades" className="py-14 sm:py-16">
      <div className="grid items-center gap-10 lg:grid-cols-[auto_1fr] lg:gap-16">
        {/* (1) The $29 as art. */}
        <Reveal className="text-center lg:text-left">
          <div className="flex items-baseline justify-center gap-3 lg:justify-start">
            <span className="display-numeral text-primary">$29</span>
            <span className="pb-2 text-left text-[15px] leading-tight text-muted-foreground">
              /mo
              <br />
              the whole crew
            </span>
          </div>
        </Reveal>

        {/* (2) Trade strip + stat chips. */}
        <div>
          <Reveal>
            <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-3 lg:justify-start">
              <span className="text-[13px] font-medium text-muted-foreground">
                Built for
              </span>
              {TRADES.map(({ label, href, icon: Icon }) => (
                <Link
                  key={label}
                  href={href}
                  className="group inline-flex items-center gap-1.5 text-[15px] font-medium text-foreground transition-colors hover:text-primary"
                >
                  <Icon
                    className="size-4 text-primary"
                    strokeWidth={1.75}
                    aria-hidden
                  />
                  {label}
                </Link>
              ))}
            </div>
          </Reveal>

          <Reveal className="mt-8">
            <dl className="grid grid-cols-1 gap-4 border-t border-border pt-6 sm:grid-cols-3">
              {CHIPS.map((chip) => (
                <div key={chip.label}>
                  <dt className="text-xl font-semibold tabular-nums text-foreground">
                    {chip.figure}
                  </dt>
                  <dd className="mt-0.5 text-[13px] text-muted-foreground">
                    {chip.label}
                  </dd>
                </div>
              ))}
            </dl>
          </Reveal>
        </div>
      </div>
    </Section>
  );
}
