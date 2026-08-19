"use client";

/**
 * FIRST-WEEK TIMELINE (DESIGN-DIRECTION v4 §5.5, the Numbered Steps flagship),
 * country-aware for the /pricing plan section.
 *
 * US (default): Day 0 (green node, something got handled: you are live) →
 * Days 1 to 7 (cobalt progress track, the bounded carrier review) → Approved
 * (green node), with the one YOU ARE HERE tab (ink text on a white tag with a
 * Flare border, whitelist §3.4.4; Flare itself carries no text below 24px).
 * The honest US carrier wait as a designed object, not fine print.
 *
 * Canada: the waiting segment does not exist. A single green day-one node
 * carries the whole story, and the US carrier-review segment is shown struck
 * from the timeline (it "doesn't apply here"), matching /canada. Green is
 * allowed to lead this card (green whitelist: the Canada day-one tick).
 *
 * Reads the shared country context (country-context.tsx); SSR default is US,
 * so the card is complete before and without JavaScript. No em-dashes.
 */

import type { MarketingLocale } from "@/i18n/marketing/footer";
import { pricingCopy, type PricingCopy } from "@/i18n/marketing/pricing";
import { useCountry } from "./country-context";

const usSteps = (copy: PricingCopy) => [
  {
    key: "day-0",
    label: copy.timelineDay0,
    node: "green" as const,
    title: copy.timelineDay0Title,
    body: copy.timelineDay0Body,
  },
  {
    key: "days-1-7",
    label: copy.timelineReviewLabel,
    node: "cobalt" as const,
    title: copy.timelineReviewTitle,
    body: copy.timelineReviewBody,
  },
  {
    key: "approved",
    label: copy.timelineApprovedLabel,
    node: "green" as const,
    title: copy.timelineApprovedTitle,
    body: copy.timelineApprovedBody,
  },
];

function GreenNode() {
  return (
    <span
      className="flex size-6 shrink-0 items-center justify-center rounded-full bg-[color:var(--fr-green)]"
      aria-hidden
    >
      <svg viewBox="0 0 16 16" className="size-3.5" focusable="false">
        <path
          d="M3.5 8.5 6.5 11.5 12.5 4.5"
          fill="none"
          stroke="var(--fr-on-green)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

function Node({ kind }: { kind: "green" | "cobalt" }) {
  return kind === "green" ? (
    <GreenNode />
  ) : (
    <span
      className="fr-eyebrow flex h-6 shrink-0 items-center justify-center rounded-full bg-[color:var(--fr-olive)] px-2 text-[10px] text-[color:var(--fr-on-olive)]"
      aria-hidden
    >
      1-7
    </span>
  );
}

function UsTimeline({ copy }: { copy: PricingCopy }) {
  const US_STEPS = usSteps(copy);
  return (
    <div className="fr-card p-6 sm:p-8">
      {/* The progress track: green dock, cobalt review segment, green dock.
          Purely decorative; the ol below carries the content. */}
      <div className="flex items-center gap-2" aria-hidden>
        <span className="size-2.5 shrink-0 rounded-full bg-[color:var(--fr-green)]" />
        <span className="h-1.5 flex-1 rounded-full bg-[color:var(--fr-frost)]">
          <span className="block h-full w-1/6 rounded-full bg-[color:var(--fr-olive)]" />
        </span>
        <span className="size-2.5 shrink-0 rounded-full bg-[color:var(--fr-green)]" />
      </div>

      {/* The YOU ARE HERE tab (§3.4.4): white tag, ink text, Flare border. */}
      <span className="fr-eyebrow mt-3 inline-flex items-center rounded-[6px] border-[1.5px] border-[color:var(--fr-flare)] bg-[color:var(--fr-card)] px-2 py-1 text-[color:var(--fr-ink)]">
        {copy.timelineYouAreHere}
      </span>

      <ol className="mt-6 grid gap-6 md:grid-cols-3 md:gap-8">
        {US_STEPS.map((step) => (
          <li key={step.key} className="flex flex-col">
            <div className="flex items-center gap-3">
              <Node kind={step.node} />
              <span className="fr-eyebrow text-[color:var(--fr-ink-55)]">
                {step.label}
              </span>
            </div>
            <p className="mt-3 font-body-mkt text-[0.9375rem] font-semibold text-[color:var(--fr-ink)]">
              {step.title}
            </p>
            <p className="mt-1.5 text-[0.875rem] leading-relaxed text-[color:var(--fr-ink-70)]">
              {step.body}
            </p>
          </li>
        ))}
      </ol>
    </div>
  );
}

function CanadaTimeline({ copy }: { copy: PricingCopy }) {
  return (
    <div className="fr-card p-6 sm:p-8">
      {/* The whole track is a green dock: in Canada there is no waiting
          segment. Purely decorative; the content sits below. */}
      <div className="flex items-center gap-2" aria-hidden>
        <span className="size-2.5 shrink-0 rounded-full bg-[color:var(--fr-green)]" />
        <span className="h-1.5 flex-1 rounded-full bg-[color:var(--fr-green)]/25" />
        <span className="size-2.5 shrink-0 rounded-full bg-[color:var(--fr-green)]" />
      </div>

      <div className="mt-5 flex items-start gap-3">
        <GreenNode />
        <div>
          <span className="fr-eyebrow text-[color:var(--fr-ink-55)]">
            {copy.timelineDayOneLabel}
          </span>
          <p className="mt-2 font-body-mkt text-[0.9375rem] font-semibold text-[color:var(--fr-ink)]">
            {copy.timelineDayOneTitle}
          </p>
          <p className="mt-1.5 text-[0.875rem] leading-relaxed text-[color:var(--fr-ink-70)]">
            {copy.timelineDayOneBody}
          </p>
        </div>
      </div>
    </div>
  );
}

export function FirstWeekTimeline({
  className,
  locale = "en",
}: {
  className?: string;
  locale?: MarketingLocale;
}) {
  const copy = pricingCopy(locale);
  const { country } = useCountry();
  return (
    <div className={className}>
      {country === "ca" ? (
        <CanadaTimeline copy={copy} />
      ) : (
        <UsTimeline copy={copy} />
      )}
    </div>
  );
}
