import { Check } from "lucide-react";

import { FrCard } from "@/components/marketing/fr";

/**
 * FIRST-WEEK TIMELINE (COPY-DECK v2 §S5; DESIGN-DIRECTION v4 §5.5), the
 * flagship Numbered Steps instance: Day 0 (green node, something got
 * handled) → Days 1 to 7 (the bounded cobalt review track) → Approved
 * (green node), with the `YOU ARE HERE` Flare tab (whitelist §3.4.4: ink
 * text on a white tag with a Flare border; Flare itself carries no text).
 *
 * The honest US carrier wait as a designed object, not fine print. Server
 * component, pure DOM. Also staged by /pricing and /features/compliance.
 */

const STAGES: readonly {
  label: string;
  title: string;
  body: string;
  node: "green" | "track";
  here?: boolean;
}[] = [
  {
    label: "DAY 0",
    title: "You're live, not waiting.",
    body: "Your number is up. Receiving texts works. Texting Canadian customers works. You can invite the crew and start today.",
    node: "green",
    here: true,
  },
  {
    label: "DAYS 1 TO 7",
    title: "The phone companies review you.",
    body: "US carriers require every business that texts to register. We filed yours the minute you paid. Approval typically takes 3 to 7 business days, about a week.",
    node: "track",
  },
  {
    label: "APPROVED",
    title: "US texting turns on.",
    body: "We email you the moment it's live. Nothing else for you to do.",
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
        <Check className="size-3.5 text-white" strokeWidth={3} />
      </span>
    );
  }
  return (
    <span
      className="flex size-6 shrink-0 items-center justify-center rounded-full border-2 border-[color:var(--fr-cobalt)] bg-white"
      aria-hidden
    >
      <span className="size-2 rounded-full bg-[color:var(--fr-cobalt)]" />
    </span>
  );
}

export function FirstWeekTimeline() {
  return (
    <FrCard className="p-6 sm:p-10">
      {/* The drawn track: live (green) → bounded review (cobalt) → live
          (green). Decorative; the stages below carry the meaning. */}
      <div className="mb-8 hidden items-center gap-1.5 md:flex" aria-hidden>
        <span className="h-1.5 flex-1 rounded-full bg-[color:var(--fr-green)]" />
        <span className="h-1.5 flex-[3] rounded-full bg-[color:var(--fr-cobalt)]" />
        <span className="h-1.5 flex-1 rounded-full bg-[color:var(--fr-green)]" />
      </div>

      <ol className="grid gap-8 md:grid-cols-3 md:gap-6">
        {STAGES.map((stage) => (
          <li key={stage.label} className="flex gap-4 md:flex-col md:gap-3">
            <div className="flex flex-col items-center gap-2 md:flex-row md:items-center">
              <Node kind={stage.node} />
              {/* The one Flare tab (§3.4.4): white tag, Flare border, ink text. */}
              {stage.here ? (
                <span className="fr-eyebrow inline-flex items-center rounded-[6px] border-[1.5px] border-[color:var(--fr-flare)] bg-white px-2 py-1 text-[color:var(--fr-ink)]">
                  You are here
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
    </FrCard>
  );
}
