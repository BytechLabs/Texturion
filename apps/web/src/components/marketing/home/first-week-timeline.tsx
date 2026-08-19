import { homeCopy, type HomeCopy } from "@/i18n/marketing/home";
import type { MarketingLocale } from "@/i18n/marketing/footer";
import { Check } from "lucide-react";

import { CountryOnly } from "@/components/marketing/country";
import { FrCard } from "@/components/marketing/fr";

/**
 * FIRST-WEEK TIMELINE (COPY-DECK v2 §S5; DESIGN-DIRECTION v4 §5.5), the
 * flagship Numbered Steps instance, now country-aware (owner ruling v1,
 * 2026-07-08): the two countries never share a timeline.
 *
 * US (SSR default): Day 0 (green node, something got handled) -> Days 1 to 7
 * (the bounded cobalt review track) -> Approved (green node), with the one
 * `YOU ARE HERE` Flare tab (whitelist §3.4.4: ink text on a white tag with a
 * Flare border; Flare itself carries no text). The honest US carrier wait as a
 * designed object, not fine print.
 *
 * Canada: there is no waiting segment. A single green day-one beat carries the
 * whole story (live and texting the same day, no registration, no fee, no
 * wait). The card leads green (the green whitelist: the news is good) and never
 * shows the US review track.
 *
 * Server component, pure DOM; the branch primitives read the shared context.
 */

const usStages = (
  copy: HomeCopy,
): readonly {
  label: string;
  title: string;
  body: string;
  node: "green" | "track";
  here?: boolean;
}[] => [
  {
    label: copy.timelineDay0,
    title: copy.timelineDay0Title,
    body: copy.timelineDay0Body,
    node: "green",
    here: true,
  },
  {
    label: copy.timelineReviewLabel,
    title: copy.timelineReviewTitle,
    body: copy.timelineReviewBody,
    node: "track",
  },
  {
    label: copy.timelineApprovedLabel,
    title: copy.timelineApprovedTitle,
    body: copy.timelineApprovedBody,
    node: "green",
  },
];

function Node({ kind }: { kind: "green" | "track" }) {
  if (kind === "green") {
    return (
      <span
        className="flex size-6 shrink-0 items-center justify-center rounded-full bg-[color:var(--fr-green)]"
        aria-hidden
      >
        <Check
          className="size-3.5 text-[color:var(--fr-on-green)]"
          strokeWidth={3}
        />
      </span>
    );
  }
  return (
    <span
      className="flex size-6 shrink-0 items-center justify-center rounded-full border-2 border-[color:var(--fr-olive)] bg-[color:var(--fr-card)]"
      aria-hidden
    >
      <span className="size-2 rounded-full bg-[color:var(--fr-olive)]" />
    </span>
  );
}

function UsTimeline({ copy }: { copy: HomeCopy }) {
  const US_STAGES = usStages(copy);
  return (
    <>
      {/* The drawn track: live (green) -> bounded review (cobalt) -> live
          (green). Decorative; the stages below carry the meaning. */}
      <div className="mb-8 hidden items-center gap-1.5 md:flex" aria-hidden>
        <span className="h-1.5 flex-1 rounded-full bg-[color:var(--fr-green)]" />
        <span className="h-1.5 flex-[3] rounded-full bg-[color:var(--fr-olive)]" />
        <span className="h-1.5 flex-1 rounded-full bg-[color:var(--fr-green)]" />
      </div>

      <ol className="grid gap-8 md:grid-cols-3 md:gap-6">
        {US_STAGES.map((stage) => (
          <li key={stage.label} className="flex gap-4 md:flex-col md:gap-3">
            <div className="flex flex-col items-center gap-2 md:flex-row md:items-center">
              <Node kind={stage.node} />
              {/* The one Flare tab (§3.4.4): white tag, Flare border, ink text. */}
              {stage.here ? (
                <span className="fr-eyebrow inline-flex items-center rounded-[6px] border-[1.5px] border-[color:var(--fr-flare)] bg-[color:var(--fr-card)] px-2 py-1 text-[color:var(--fr-ink)]">
                  {copy.timelineYouAreHereLabel}
                </span>
              ) : null}
            </div>
            <div>
              <p className="fr-eyebrow text-[color:var(--fr-ink-55)]">
                {stage.label}
              </p>
              <h3 className="font-body-mkt mt-2 text-[15px] font-bold leading-snug text-[color:var(--fr-ink)]">
                {stage.title}
              </h3>
              <p className="font-body-mkt mt-1.5 text-[15px] leading-[1.65] text-[color:var(--fr-ink-70)]">
                {stage.body}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </>
  );
}

function CaTimeline({ copy }: { copy: HomeCopy }) {
  return (
    <>
      {/* No waiting segment in Canada: the whole track is a green dock.
          Decorative; the day-one beat below carries the meaning. */}
      <div className="mb-8 hidden items-center gap-1.5 md:flex" aria-hidden>
        <span className="h-1.5 flex-1 rounded-full bg-[color:var(--fr-green)]" />
        <span className="h-1.5 flex-1 rounded-full bg-[color:var(--fr-green)]" />
        <span className="h-1.5 flex-1 rounded-full bg-[color:var(--fr-green)]" />
      </div>

      <div className="flex gap-4 md:flex-col md:gap-3">
        <div className="flex flex-col items-center gap-2 md:flex-row md:items-center">
          <Node kind="green" />
          <span className="fr-eyebrow inline-flex items-center rounded-[6px] bg-[color:var(--fr-frost)] px-2 py-1 text-[color:var(--fr-ink)]">
            {copy.timelineNoWait}
          </span>
        </div>
        <div>
          <p className="fr-eyebrow text-[color:var(--fr-ink-55)]">
            {copy.timelineDayOneLabel}
          </p>
          <h3 className="font-body-mkt mt-2 text-[15px] font-bold leading-snug text-[color:var(--fr-ink)]">
            {copy.timelineDayOneTitle}
          </h3>
          <p className="font-body-mkt mt-1.5 max-w-[52ch] text-[15px] leading-[1.65] text-[color:var(--fr-ink-70)]">
            {copy.timelineDayOneBody}
          </p>
        </div>
      </div>
    </>
  );
}

export function FirstWeekTimeline({
  locale = "en",
}: {
  locale?: MarketingLocale;
} = {}) {
  const copy = homeCopy(locale);
  return (
    <FrCard className="p-6 sm:p-10">
      <CountryOnly country="us">
        <UsTimeline copy={copy} />
      </CountryOnly>
      <CountryOnly country="ca">
        <CaTimeline copy={copy} />
      </CountryOnly>
    </FrCard>
  );
}
