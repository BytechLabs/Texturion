/**
 * Registration-stepper visual (features track), the /features/compliance
 * product visual. A live-DOM render of the app's registration state machine
 * (SPEC §4.4: brand → campaign → approved) as the friendly stepper G7/G8
 * describe, in an "In review" state. It shows the honest US timeline as a
 * designed object: what's already done, what the carriers are reviewing, and
 * what turns on at the end, the same win-first frame as the home first-week
 * timeline, scoped to the registration flow.
 *
 * Server component, pure DOM. The "in review" state carries the sanctioned
 * review-pending amber via the v3 --marker tokens (as the home first-week
 * timeline does), not raw Tailwind amber; everything else is petrol-cast.
 */

import { Check, Clock, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

type StepState = "done" | "active" | "upcoming";

interface Step {
  title: string;
  detail: string;
  state: StepState;
}

const STEPS: Step[] = [
  {
    title: "Business registered with the phone companies",
    detail: "Legal name, address, and EIN submitted the minute you paid.",
    state: "done",
  },
  {
    title: "Carrier review, in progress",
    detail: "Typically 3–7 business days. Nothing for you to do.",
    state: "active",
  },
  {
    title: "US texting turns on",
    detail: "We email you the moment it's approved.",
    state: "upcoming",
  },
];

function StepDot({ state }: { state: StepState }) {
  if (state === "done") {
    return (
      <span
        className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[color:var(--petrol)] text-white"
        aria-hidden
      >
        <Check className="size-4" strokeWidth={2.5} />
      </span>
    );
  }
  if (state === "active") {
    return (
      <span
        className="flex size-7 shrink-0 items-center justify-center rounded-full border border-[color:var(--marker)] bg-[color:var(--marker-40)] text-[color:var(--day-ink)]"
        aria-hidden
      >
        <Loader2 className="size-4 animate-spin motion-reduce:animate-none" strokeWidth={2} />
      </span>
    );
  }
  return (
    <span
      className="flex size-7 shrink-0 items-center justify-center rounded-full border border-[color:var(--hairline)] bg-[rgba(11,43,38,0.06)] text-[color:var(--ink-55)]"
      aria-hidden
    >
      <span className="size-1.5 rounded-full bg-current" />
    </span>
  );
}

export function RegistrationStepperVisual({
  className,
}: {
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-[10px] border border-[color:var(--hairline)] bg-white p-5 shadow-[0_24px_64px_-32px_rgba(28,25,23,0.25)] sm:p-6",
        className,
      )}
    >
      <div className="flex items-center justify-between">
        <p className="text-[14px] font-semibold text-[color:var(--day-ink)]">
          US texting registration
        </p>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-[color:var(--marker)] bg-[color:var(--marker-40)] px-2.5 py-1 text-[12px] font-medium text-[color:var(--day-ink)]">
          <Clock className="size-3.5" strokeWidth={1.75} aria-hidden />
          In review
        </span>
      </div>

      <ol className="mt-5 space-y-0">
        {STEPS.map((step, i) => (
          <li key={step.title} className="flex gap-3.5">
            <div className="flex flex-col items-center">
              <StepDot state={step.state} />
              {i < STEPS.length - 1 && (
                <span
                  className={cn(
                    "my-1 w-px flex-1",
                    step.state === "done"
                      ? "bg-[color:var(--petrol-24)]"
                      : "bg-[color:var(--hairline)]",
                  )}
                  aria-hidden
                />
              )}
            </div>
            <div className={cn(i < STEPS.length - 1 && "pb-4")}>
              <p
                className={cn(
                  "text-[14px] font-semibold",
                  step.state === "upcoming"
                    ? "text-[color:var(--ink-55)]"
                    : "text-[color:var(--day-ink)]",
                )}
              >
                {step.title}
              </p>
              <p className="mt-0.5 text-[13px] leading-relaxed text-[color:var(--ink-70)]">
                {step.detail}
              </p>
            </div>
          </li>
        ))}
      </ol>

      <p className="mt-2 rounded-lg bg-[rgba(11,43,38,0.06)] px-3 py-2 text-[13px] leading-relaxed text-[color:var(--ink-70)]">
        Receiving texts and texting Canadian numbers already work, this only
        gates US-bound texting.
      </p>
    </div>
  );
}
