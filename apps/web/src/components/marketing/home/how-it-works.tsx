/**
 * How it works + the first week (Track B) — §3.5 / COPY §H5.
 *
 * Part A: three steps joined by a hand-crafted dashed SVG connector (petrol,
 * 1.75 stroke), numbered petrol circles, responsive vertical stack on mobile.
 * Part B: the first-week timeline as art (the §0.2 expressive object).
 *
 * Server component — pure DOM/SVG, part of the static LCP-safe render.
 */

import { MapPinned, MessageSquareText, Users } from "lucide-react";

import { Reveal } from "@/components/marketing/ui/reveal";
import { Section } from "@/components/marketing/ui/section";

import { FirstWeekTimeline } from "./first-week-timeline";

const STEPS = [
  {
    n: 1,
    icon: MapPinned,
    title: "Pick your number.",
    body:
      "Type your city or area code and we'll find you a local number. It's usually live in a minute or two, and it belongs to your business — not to anyone's phone.",
  },
  {
    n: 2,
    icon: Users,
    title: "Invite the crew.",
    body:
      "Send your team a link. They open it on whatever phone they already have — nothing to install, nothing to configure. Starter covers 3 people, Pro covers 10.",
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
    <Section id="how-it-works">
      <div className="mx-auto max-w-2xl text-center">
        <h2 className="display-h2 text-foreground">
          From signup to texting, in three steps.
        </h2>
      </div>

      {/* Part A — three steps with the dashed SVG connector. */}
      <div className="relative mt-14">
        {/* Desktop connector: a dashed petrol path behind the three circles. */}
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
            stroke="var(--color-primary)"
            strokeWidth="1.75"
            strokeDasharray="6 7"
            strokeLinecap="round"
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
                <span className="relative z-10 mx-auto flex size-12 items-center justify-center rounded-full border border-primary/20 bg-card text-primary">
                  <Icon className="size-5" strokeWidth={1.75} aria-hidden />
                  <span className="absolute -right-1 -top-1 flex size-5 items-center justify-center rounded-full bg-primary text-[11px] font-semibold tabular-nums text-primary-foreground">
                    {step.n}
                  </span>
                </span>
                <h3 className="mt-5 text-lg font-semibold text-foreground">
                  {step.title}
                </h3>
                <p className="mx-auto mt-2 max-w-xs text-[15px] leading-relaxed text-muted-foreground">
                  {step.body}
                </p>
              </Reveal>
            );
          })}
        </ol>
      </div>

      {/* Part B — the first-week timeline as the expressive honesty object. */}
      <Reveal className="mt-16">
        <FirstWeekTimeline />
      </Reveal>
    </Section>
  );
}
