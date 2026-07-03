/**
 * Truth bar (§H2), the anti-logo-bar. The $29 rendered as the one expressive
 * display numeral (the work-order mono at display scale), the trade strip that
 * links each ICP to its own page, and three real product numbers where a logo
 * wall would go. Quantified proof, not borrowed logos.
 *
 * DESIGN-DIRECTION §0: no section number, no ledger spine. A true eyebrow label
 * opens it; structure is the ground/type rhythm. All figures are real (SPEC §2).
 * Sits on the paper ground. Server component.
 */

import Link from "next/link";
import { Fan, Scissors, Shovel, Sparkles, Wrench } from "lucide-react";

import { Reveal } from "@/components/marketing/ui/reveal";
import { Section } from "@/components/marketing/ui/section";
import { LIVE_ROUTES } from "@/lib/marketing/site";

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
  { figure: "$0", label: "to receive, always free" },
] as const;

export function TruthBar() {
  return (
    <Section defer intrinsic={420} className="py-14 sm:py-16">
      <div className="grid items-center gap-10 lg:grid-cols-[auto_1fr] lg:gap-16">
        {/* The $29 as art: the one expressive display numeral, sat on a warm
            hairline like a big work-order entry. */}
        <Reveal className="text-center lg:text-left">
          <p className="font-mono-mkt flex items-center justify-center gap-2.5 text-[13px] font-medium tracking-[0.04em] text-[color:var(--graphite)] lg:justify-start">
            <span aria-hidden className="h-px w-6 bg-[color:var(--petrol)]/50" />
            The whole price list
          </p>
          <div className="mt-3 flex items-baseline justify-center gap-3 border-t border-[color:var(--hairline)] pt-4 lg:justify-start">
            <span className="display-numeral text-[color:var(--petrol)]">$29</span>
            <span className="pb-2 text-left text-[15px] leading-tight text-[color:var(--graphite)]">
              /mo
              <br />
              the whole crew
            </span>
          </div>
        </Reveal>

        <div>
          <Reveal>
            <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-3 lg:justify-start">
              <span className="font-mono-mkt text-[13px] font-medium tracking-[0.02em] text-[color:var(--graphite)]">
                Built for
              </span>
              {TRADES.map(({ label, href, icon: Icon }) => (
                <Link
                  key={label}
                  href={href}
                  className="group inline-flex items-center gap-1.5 rounded-sm text-[15px] font-medium text-[color:var(--ink)] transition-colors hover:text-[color:var(--petrol)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--petrol)]/50"
                >
                  <Icon
                    className="size-4 text-[color:var(--petrol)]"
                    strokeWidth={1.75}
                    aria-hidden
                  />
                  {label}
                </Link>
              ))}
            </div>
          </Reveal>

          <Reveal className="mt-8">
            <dl className="grid grid-cols-1 gap-4 border-t border-[color:var(--hairline)] pt-6 sm:grid-cols-3">
              {CHIPS.map((chip) => (
                <div key={chip.label}>
                  <dt className="font-mono-mkt text-[28px] font-semibold leading-none tabular-nums text-[color:var(--ink)]">
                    {chip.figure}
                  </dt>
                  <dd className="font-mono-mkt mt-1.5 text-[13px] tracking-[0.02em] text-[color:var(--graphite)]">
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
