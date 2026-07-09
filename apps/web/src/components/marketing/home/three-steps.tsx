import { FrSection } from "@/components/marketing/fr";

import { FirstWeekTimeline } from "./first-week-timeline";

/**
 * S5 · FROM SIGNUP TO TEXTING (COPY-DECK v2). Conversion job: collapse
 * perceived setup effort to minutes, and turn the one-week US carrier wait
 * from a hidden gotcha into a trust signal.
 *
 * Numbered Steps (§5.5: mono numerals in cobalt circles), then the
 * first-week timeline flagship with its Flare YOU ARE HERE tab.
 */

const STEPS: readonly { title: string; body: string }[] = [
  {
    title: "Pick your number.",
    body: "Type your city or area code and we'll find you a local number. It's usually live in a minute or two, and it belongs to your business, not to anyone's phone.",
  },
  {
    title: "Invite the crew.",
    body: "Send your team a link. They open it on whatever phone they already have. Nothing to install, nothing to configure. Starter covers 3 people, Pro covers 15.",
  },
  {
    title: "Text customers.",
    body: 'Put "call or text" on your trucks, your site, and your invoices. Every reply lands in the shared inbox, where anyone can pick it up.',
  },
];

export function ThreeSteps() {
  return (
    <FrSection ground="white" id="steps">
      <h2 className="fr-h2 max-w-2xl">From signup to texting, in three steps.</h2>

      <ol className="mt-12 grid gap-8 md:grid-cols-3">
        {STEPS.map((step, i) => (
          <li key={step.title} className="flex gap-4">
            <span
              className="font-mono-mkt mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-[color:var(--fr-cobalt)] text-[0.9375rem] font-medium tabular-nums text-white"
              aria-hidden
            >
              {i + 1}
            </span>
            <div>
              <h3 className="fr-h3 text-[color:var(--fr-ink)]">{step.title}</h3>
              <p className="font-body-mkt mt-2 text-[15px] leading-[1.65] text-[color:var(--fr-ink-70)]">
                {step.body}
              </p>
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-14" data-reveal="">
        <FirstWeekTimeline />
      </div>
    </FrSection>
  );
}
