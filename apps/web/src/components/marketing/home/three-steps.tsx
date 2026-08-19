import { homeCopy, type HomeCopy } from "@/i18n/marketing/home";
import type { MarketingLocale } from "@/i18n/marketing/footer";
import { FrSection } from "@/components/marketing/fr";

import { FirstWeekTimeline } from "./first-week-timeline";

/**
 * S5 · FROM SIGNUP TO ANSWERING CUSTOMERS (COPY-DECK v2). Conversion job: collapse
 * perceived setup effort to minutes, and turn the one-week US carrier wait
 * from a hidden gotcha into a trust signal.
 *
 * Numbered Steps (§5.5: mono numerals in cobalt circles), then the
 * first-week timeline flagship with its Flare YOU ARE HERE tab.
 */

const steps = (copy: HomeCopy): readonly { title: string; body: string }[] => [
  { title: copy.stepsNumberTitle, body: copy.stepsNumberBody },
  { title: copy.stepsCrewTitle, body: copy.stepsCrewBody },
  { title: copy.stepsAnswerTitle, body: copy.stepsAnswerBody },
];

export function ThreeSteps({
  locale = "en",
}: {
  locale?: MarketingLocale;
} = {}) {
  const copy = homeCopy(locale);
  const STEPS = steps(copy);
  return (
    <FrSection ground="white" id="steps">
      <h2 className="fr-h2 max-w-2xl">
        {copy.stepsTitle}
      </h2>

      <ol className="mt-12 grid gap-8 md:grid-cols-3">
        {STEPS.map((step, i) => (
          <li key={step.title} className="flex gap-4">
            <span
              className="font-mono-mkt mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-[color:var(--fr-olive)] text-[0.9375rem] font-medium tabular-nums text-[color:var(--fr-on-olive)]"
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
        <FirstWeekTimeline locale={locale} />
      </div>
    </FrSection>
  );
}
