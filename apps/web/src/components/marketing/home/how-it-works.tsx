/**
 * How it works + the first week (§H5).
 *
 * Part A: three steps joined by a dashed petrol connector, petrol step circles.
 * Part B: the first-week timeline, the honest US wait rendered win-first with
 * the Day 0 expressive numeral.
 *
 * DESIGN-DIRECTION §0: no section number. A composed <Display> headline opens it;
 * sits on the paper ground. Server component, pure DOM/SVG, LCP-safe static.
 */

import { MapPinned, MessageSquareText, Users } from "lucide-react";

import { Reveal } from "@/components/marketing/ui/reveal";
import { Section } from "@/components/marketing/ui/section";
import { Display } from "@/components/marketing/display";

import { FirstWeekTimeline } from "./first-week-timeline";

const STEPS = [
  {
    n: 1,
    icon: MapPinned,
    title: "Pick your number.",
    body:
      "Type your city or area code and we'll find you a local number. It's usually live in a minute or two, and it belongs to your business, not to anyone's phone.",
  },
  {
    n: 2,
    icon: Users,
    title: "Invite the crew.",
    body:
      "Send your team a link. They open it on whatever phone they already have, nothing to install, nothing to configure. Starter covers 3 people, Pro covers 10.",
  },
  {
    n: 3,
    icon: MessageSquareText,
    title: "Text customers.",
    body:
      "Put “call or text” on your trucks, your site, and your invoices. Every reply lands in the shared inbox, where anyone can pick it up.",
  },
] as const;

export function HowItWorks() {
  return (
    <Section id="how-it-works" defer intrinsic={900}>
      <div className="mx-auto max-w-2xl text-center">
        <p className="font-mono-mkt flex items-center justify-center gap-2.5 text-[13px] font-medium tracking-[0.04em] text-[color:var(--graphite)]">
          <span aria-hidden className="h-px w-6 bg-[color:var(--petrol)]/50" />
          How it works
        </p>
        <Display as="h2" size="h2" className="mt-4">
          From signup to texting, in three steps.
        </Display>
      </div>

      {/* Part A, three steps with the dashed connector. */}
      <div className="relative mt-14">
        <svg
          className="pointer-events-none absolute inset-x-0 top-6 hidden h-2 w-full md:block"
          viewBox="0 0 1000 8"
          fill="none"
          preserveAspectRatio="none"
          aria-hidden
        >
          <line
            x1="167"
            y1="4"
            x2="833"
            y2="4"
            stroke="var(--petrol)"
            strokeWidth="1.75"
            strokeDasharray="6 7"
            strokeLinecap="round"
            opacity="0.5"
          />
        </svg>

        <ol className="grid gap-10 md:grid-cols-3 md:gap-8">
          {STEPS.map((step, i) => {
            const Icon = step.icon;
            return (
              <Reveal
                key={step.n}
                as="li"
                delay={Math.min(i, 3) * 60}
                className="relative text-center"
              >
                <span className="relative z-10 mx-auto flex size-12 items-center justify-center rounded-full border border-[color:var(--hairline)] bg-[color:var(--paper-2)] text-[color:var(--petrol)]">
                  <Icon className="size-5" strokeWidth={1.75} aria-hidden />
                  <span className="font-mono-mkt absolute -right-1 -top-1 flex size-5 items-center justify-center rounded-full bg-[color:var(--petrol)] text-[11px] font-semibold tabular-nums text-white">
                    {step.n}
                  </span>
                </span>
                <h3 className="mt-5 text-lg font-semibold text-[color:var(--ink)]">
                  {step.title}
                </h3>
                <p className="mx-auto mt-2 max-w-xs text-[15px] leading-relaxed text-[color:var(--ink-70)]">
                  {step.body}
                </p>
              </Reveal>
            );
          })}
        </ol>
      </div>

      {/* Part B, the first-week timeline with the Day 0 expressive numeral. */}
      <Reveal className="mt-16">
        <FirstWeekTimeline />
      </Reveal>
    </Section>
  );
}
